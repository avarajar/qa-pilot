import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadContract, ConfigError } from './config.js'
import { gitDiff, headSha } from './diff.js'
import { ingest, type IngestTool } from './ingest.js'
import { readResults, route } from './router.js'
import type { Decision, QaConfig } from './types.js'
import { restGitHub } from './github.js'
import { publish, approveCheck } from './publish.js'
import { prFromEvent, approvalFromEvent } from './events.js'

function githubContext(io: Io): { gh: ReturnType<typeof restGitHub>; event: unknown } | null {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_EVENT_PATH: eventPath, GITHUB_API_URL: api } = process.env
  if (!token || !repo || !eventPath) {
    io.err('Faltan GITHUB_TOKEN, GITHUB_REPOSITORY o GITHUB_EVENT_PATH: este comando corre dentro de GitHub Actions')
    return null
  }
  return { gh: restGitHub({ repo, token, ...(api ? { api } : {}) }), event: JSON.parse(readFileSync(eventPath, 'utf8')) }
}

export type Io = { out(s: string): void; err(s: string): void }
const stdio: Io = { out: s => console.log(s), err: s => console.error(s) }

const USAGE = `Uso: qa-pilot <comando> [opciones]

Comandos:
  run            levanta el entorno, corre los checks y decide (lo mismo en CI y en local)
  route          decide sobre los resultados ya generados en qa-results/
  ingest <tool> <archivo>   normaliza junit | semgrep | gitleaks
  publish        publica la decisión en el PR (GitHub)
  approve-check  valida una aprobación humana (GitHub)
  baselines      regenera las imágenes base de screenshots en Linux (Docker)
  config get <clave>        imprime un valor de qa/qa-pilot.yaml

Opciones comunes: --root <dir> (default .)  --out <dir> (default <root>/qa-results)  --base <ref> (default origin/main)
  route acepta --head <sha>: decide sobre ese commit usando la configuración del checkout actual`

export function expectedChecks(config: QaConfig): string[] {
  return [
    ...(config.checks.unit ? ['unit'] : []),
    ...(config.checks.e2e ? ['e2e'] : []),
    ...(config.checks.security ?? []),
  ]
}

export function summarize(d: Decision): string {
  const head = { auto: 'auto · se aprueba solo', escalate: 'escalate · necesita un humano', blocked: 'blocked · hay checks en rojo' }[d.decision]
  const gates = d.gates.map(g => `  ${g.id}  ${g.reason}`).join('\n')
  return `qa-pilot: ${head}${gates ? `\n${gates}` : ''}`
}

type Handler = (args: string[], io: Io) => Promise<number>

const opts = {
  root: { type: 'string', default: '.' },
  out: { type: 'string' },
  base: { type: 'string', default: 'origin/main' },
  head: { type: 'string', default: 'HEAD' },
  check: { type: 'string' },
} as const

function parse(args: string[]) {
  const { values, positionals } = parseArgs({ args, options: opts, allowPositionals: true, strict: false })
  const root = resolve(String(values.root ?? '.'))
  const out = values.out ? resolve(String(values.out)) : join(root, 'qa-results')
  return { root, out, base: String(values.base ?? 'origin/main'), head: String(values.head ?? 'HEAD'), check: values.check as string | undefined, positionals }
}

const commands: Record<string, Handler> = {
  async config(args, io) {
    const { root, positionals } = parse(args)
    const [sub, key] = positionals
    if (sub !== 'get' || !key) {
      io.err('Uso: qa-pilot config get <clave.punteada>')
      return 1
    }
    let value: unknown = loadContract(root).config
    for (const part of key.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined
    if (value === undefined) {
      io.err(`No existe la clave ${key} en qa/qa-pilot.yaml`)
      return 1
    }
    io.out(typeof value === 'object' ? JSON.stringify(value) : String(value))
    return 0
  },

  async ingest(args, io) {
    const { out, check, positionals } = parse(args)
    const [tool, file] = positionals
    if (!tool || !file || !['junit', 'semgrep', 'gitleaks'].includes(tool)) {
      io.err('Uso: qa-pilot ingest <junit|semgrep|gitleaks> <archivo> [--check nombre] [--out dir]')
      return 1
    }
    const result = ingest(tool as IngestTool, existsSync(file) ? readFileSync(file, 'utf8') : '', check)
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, `${result.check}.json`), JSON.stringify(result, null, 2))
    io.out(`${result.check}: ${result.status} (${result.findings.length} hallazgos)`)
    return 0
  },

  async route(args, io) {
    // --head permite decidir sobre el commit del PR sin hacer checkout de su código:
    // la configuración (qa/) se lee del checkout actual, que en CI es la rama base
    const { root, out, base, head } = parse(args)
    let sha: string
    let diff
    try {
      sha = headSha(root, head)
      diff = gitDiff(root, base, sha)
    } catch (err) {
      io.err(`qa-pilot route necesita un repo git con la rama base ${base}: ${(err as Error).message.split('\n')[0]}`)
      return 2
    }
    const decision = decide(root, out, sha, diff)
    io.out(summarize(decision))
    return 0
  },
}

commands.publish = async (args, io) => {
  const { out } = parse(args)
  const ctx = githubContext(io)
  if (!ctx) return 1
  const pr = prFromEvent(ctx.event)
  if (!pr) { io.err('El evento no es de un pull request'); return 1 }
  const file = join(out, 'decision.json')
  if (!existsSync(file)) { io.err(`No existe ${file}: corre qa-pilot run o route antes`); return 1 }
  const d = JSON.parse(readFileSync(file, 'utf8')) as Decision
  await publish(ctx.gh, pr, d)
  io.out(`PR #${pr}: ${d.decision}`)
  return 0
}

commands['approve-check'] = async (args, io) => {
  const { root } = parse(args)
  const ctx = githubContext(io)
  if (!ctx) return 1
  const pr = prFromEvent(ctx.event)
  const ev = approvalFromEvent(ctx.event)
  if (!pr || !ev) { io.out('Nada que aprobar en este evento'); return 0 }
  const r = await approveCheck(ctx.gh, pr, ev, loadContract(root).config.approvers)
  io.out(`PR #${pr}: ${r.reason}`)
  return 0
}

export function decide(root: string, out: string, sha: string, diff: ReturnType<typeof gitDiff>): Decision {
  const { results, errors } = readResults(out)
  let decision: Decision
  try {
    const contract = loadContract(root)
    decision = route({ contract, results, diff, sha, expectedChecks: expectedChecks(contract.config), errors })
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err
    // falla cerrado: sin configuración válida no se aprueba nada
    decision = {
      version: 1, decision: 'escalate', sha,
      gates: [{ id: 'ERR', reason: err.message }],
      diff: { files: diff.files.length, added: 0, removed: 0 },
      checks: Object.fromEntries(results.map(r => [r.check, r.status])),
      findings: [],
    }
  }
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'decision.json'), JSON.stringify(decision, null, 2))
  return decision
}

export function register(name: string, handler: Handler): void {
  commands[name] = handler
}

export async function main(argv: string[], io: Io = stdio): Promise<number> {
  const [name, ...rest] = argv
  const handler = name ? commands[name] : undefined
  if (!handler) {
    io.err(USAGE)
    return 1
  }
  try {
    return await handler(rest, io)
  } catch (err) {
    io.err(err instanceof ConfigError ? err.message : `qa-pilot ${name}: ${(err as Error).stack ?? String(err)}`)
    return 1
  }
}
