import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ConfigError, loadContract } from './config.js'
import { decide } from './cli.js'
import { gitDiff, headSha } from './diff.js'
import { envAdapter } from './env-adapters.js'
import { ingest } from './ingest.js'
import { realProc, shellQuote, waitForUrl, type Proc } from './proc.js'
import { dockerize, playwrightVersion } from './baselines.js'
import type { CheckResult, Decision, QaConfig } from './types.js'

export type RunOptions = {
  root: string
  base: string
  out?: string
  proc?: Proc
  waitUrl?: (url: string, timeoutS: number) => Promise<boolean>
  log?: (s: string) => void
}

// en un monorepo se monta el repo entero: pnpm enlaza dependencias fuera de la carpeta del proyecto
function gitTop(root: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return root
  }
}

const fail = (check: string, message: string): CheckResult => ({ check, status: 'fail', findings: [{ kind: 'error', message }] })

export async function run(opts: RunOptions): Promise<Decision> {
  const root = resolve(opts.root)
  const out = opts.out ? resolve(opts.out) : join(root, 'qa-results')
  const proc = opts.proc ?? realProc
  const waitUrl = opts.waitUrl ?? waitForUrl
  const log = opts.log ?? (() => {})
  let config: QaConfig
  try {
    config = loadContract(root).config
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err
    // falla cerrado también aquí: CI publica un ERR en vez de quedarse sin decisión
    rmSync(out, { recursive: true, force: true })
    return decide(root, out, headSha(root), gitDiff(root, opts.base))
  }
  const timeoutS = config.checks.timeout_s
  const diff = gitDiff(root, opts.base)

  rmSync(out, { recursive: true, force: true })
  mkdirSync(join(out, 'raw'), { recursive: true })
  const write = (r: CheckResult) => writeFileSync(join(out, `${r.check}.json`), JSON.stringify(r, null, 2))

  const appDir = resolve(root, config.app.dir)
  const baseEnv = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
  let env: Record<string, string> = { ...baseEnv, ...config.app.vars, QA_PILOT_ROOT: root, QA_PILOT_OUT: out, QA_PILOT_URL: config.app.url }
  const adapter = envAdapter(config.app.env)
  const ctx = { root, config, proc, env }
  let app: { stop(): Promise<void> } | undefined

  const step = async (name: string, cmd: string | undefined) => {
    if (!cmd) return true
    log(`qa-pilot: ${name}: ${cmd}`)
    const r = await proc.sh(cmd, { cwd: appDir, env, timeoutS })
    if (r.code !== 0) write(fail('app', `${name} falló (código ${r.code}): ${r.out.slice(-800)}`))
    return r.code === 0
  }

  try {
    env = { ...env, ...(await adapter.up(ctx)) }
    ctx.env = env
    if ((await step('setup', config.app.setup)) && (await step('seed', config.app.seed))) {
      if (config.app.start) app = proc.spawnBg(config.app.start, { cwd: appDir, env })
      if (!(await waitUrl(config.app.url, config.app.ready_timeout_s))) {
        write(fail('app', `La app no respondió en ${config.app.url} después de ${config.app.ready_timeout_s} s`))
      } else {
        await runChecks()
      }
    }
  } catch (err) {
    write(fail('app', (err as Error).message))
  } finally {
    if (app) await app.stop()
    await adapter.down(ctx)
  }

  async function runCheck(check: string, cmd: string, collect: (code: number, output: string) => CheckResult | null, cwd = appDir) {
    log(`qa-pilot: ${check}: ${cmd}`)
    try {
      const r = await proc.sh(cmd, { cwd, env, timeoutS })
      const result = collect(r.code, r.out)
      if (result) write(result)
    } catch (err) {
      write(fail(check, `${check} no pudo correr: ${(err as Error).message}`))
    }
  }

  async function runChecks() {
    const raw = (name: string) => join(out, 'raw', name)
    const { unit, e2e, security = [] } = config.checks
    if (unit) {
      await runCheck('unit', unit, (code, output) => {
        if (!existsSync(raw('unit.xml'))) return code === 0 ? { check: 'unit', status: 'pass', findings: [] } : fail('unit', output.slice(-800))
        const result = ingest('junit', readFileSync(raw('unit.xml'), 'utf8'), 'unit')
        // gana el código de salida: "vitest && tsc" puede dejar un JUnit verde y fallar después
        return code !== 0 && result.status === 'pass' ? fail('unit', output.slice(-800)) : result
      })
    }
    if (e2e) {
      // el reporter de @qa-pilot/playwright escribe e2e.json; si no lo hizo, el comando no llegó a correr bien
      const extra = process.env.QA_PILOT_E2E_ARGS?.trim()
      let cmd = extra ? `${e2e} ${extra}` : e2e
      if (process.env.QA_PILOT_E2E_DOCKER) {
        const v = playwrightVersion((await proc.sh('npx --no-install playwright --version', { cwd: appDir, env, timeoutS: 120, quiet: true })).out)
        if (!v) {
          write(fail('e2e', `QA_PILOT_E2E_DOCKER necesita @playwright/test instalado en ${appDir}`))
          return
        }
        cmd = dockerize(`corepack enable >/dev/null 2>&1 || true; ${cmd}`, {
          mount: realpathSync(gitTop(root)), cwd: realpathSync(appDir), version: v,
          env: ['QA_PILOT_ROOT', 'QA_PILOT_OUT', 'QA_PILOT_URL', ...Object.keys(config.app.vars ?? {}), ...Object.keys(config.app.env_map ?? {}),
            ...Object.values(config.roles).flatMap(r => (r.password_env ? [r.password_env] : []))],
        })
      }
      await runCheck('e2e', cmd, (code, output) => {
        const file = join(out, 'e2e.json')
        if (!existsSync(file)) return code === 0 ? null : fail('e2e', output.slice(-800))
        // si el comando falló pero el resultado dice pass, gana el código de salida
        const result = JSON.parse(readFileSync(file, 'utf8')) as CheckResult
        return code !== 0 && result.status === 'pass' ? fail('e2e', output.slice(-800)) : null
      })
    }
    // seguridad solo sobre lo que trae el PR: lo que ya existía en main no debe escalar cada PR para siempre
    if (security.includes('semgrep')) {
      const changed = diff.files.filter(f => f.status !== 'D' && existsSync(join(root, f.path))).map(f => shellQuote(f.path))
      if (changed.length === 0) write({ check: 'semgrep', status: 'pass', findings: [] })
      else await runCheck('semgrep', `semgrep scan --config auto --json -o ${shellQuote(raw('semgrep.json'))} ${changed.join(' ')}`, (_c, output) =>
        existsSync(raw('semgrep.json')) ? ingest('semgrep', readFileSync(raw('semgrep.json'), 'utf8')) : fail('semgrep', `semgrep no produjo resultado: ${output.slice(-300)}`), root)
    }
    if (security.includes('gitleaks')) {
      await runCheck('gitleaks', `gitleaks git --redact --no-banner --log-opts=${shellQuote(`${opts.base}..HEAD`)} -f json -r ${shellQuote(raw('gitleaks.json'))} ${shellQuote(root)}`, (_c, output) =>
        existsSync(raw('gitleaks.json')) ? ingest('gitleaks', readFileSync(raw('gitleaks.json'), 'utf8')) : fail('gitleaks', `gitleaks no produjo resultado: ${output.slice(-300)}`), root)
    }
  }

  return decide(root, out, headSha(root), diff)
}
