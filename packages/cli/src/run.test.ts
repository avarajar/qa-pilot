import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './run.js'
import { parseSupabaseEnv } from './env-adapters.js'
import type { Proc } from './proc.js'
import type { CheckResult } from './types.js'

function repo(yaml: string): string {
  const root = mkdtempSync(join(tmpdir(), 'qa-run-'))
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t.t')
  git('config', 'user.name', 't')
  mkdirSync(join(root, 'qa'))
  writeFileSync(join(root, 'qa/qa-pilot.yaml'), yaml)
  git('add', '-A')
  git('commit', '-qm', 'base')
  return root
}

const yaml = (extra = '') => `app:
  env: command
  setup: echo setup
  seed: echo seed
  start: echo start
  url: http://localhost:4000
  ready_timeout_s: 1
checks:
  e2e: npx playwright test
${extra}`

type Call = { kind: 'sh' | 'bg' | 'stop'; cmd: string; env?: Record<string, string> }

function fakeProc(onSh: (cmd: string, env: Record<string, string>) => { code: number; out: string } = () => ({ code: 0, out: '' })) {
  const calls: Call[] = []
  const proc: Proc = {
    async sh(cmd, o) {
      calls.push({ kind: 'sh', cmd, env: o.env })
      return onSh(cmd, o.env)
    },
    spawnBg(cmd) {
      calls.push({ kind: 'bg', cmd })
      return { async stop() { calls.push({ kind: 'stop', cmd }) } }
    },
  }
  return { proc, calls }
}

const writeE2e = (env: Record<string, string>, result: CheckResult) =>
  writeFileSync(join(env.QA_PILOT_OUT!, 'e2e.json'), JSON.stringify(result))

describe('run', () => {
  it('sigue el orden setup → seed → start → checks → apaga, y decide auto', async () => {
    const root = repo(yaml())
    const { proc, calls } = fakeProc((cmd, env) => {
      if (cmd.includes('playwright')) writeE2e(env, { check: 'e2e', status: 'pass', findings: [] })
      return { code: 0, out: '' }
    })
    const d = await run({ root, base: 'main', proc, waitUrl: async () => true })
    expect(calls.map(c => `${c.kind}:${c.cmd}`)).toEqual(['sh:echo setup', 'sh:echo seed', 'bg:echo start', 'sh:npx playwright test', 'stop:echo start'])
    expect(d.decision).toBe('auto')
    const e2eCall = calls.find(c => c.cmd.includes('playwright'))!
    expect(e2eCall.env!.QA_PILOT_ROOT).toBe(root)
    expect(JSON.parse(readFileSync(join(root, 'qa-results/decision.json'), 'utf8')).decision).toBe('auto')
  })

  it('app.vars llega al entorno de setup, start y checks', async () => {
    const root = repo(yaml().replace('  ready_timeout_s: 1', '  ready_timeout_s: 1\n  vars:\n    APP_OWNERS: owner@example.com'))
    const { proc, calls } = fakeProc()
    await run({ root, base: 'main', proc, waitUrl: async () => true })
    expect(calls.find(c => c.cmd === 'echo setup')!.env!.APP_OWNERS).toBe('owner@example.com')
  })

  it('si un check lanza un error igual apaga la app', async () => {
    const root = repo(yaml())
    const { proc, calls } = fakeProc(cmd => {
      if (cmd.includes('playwright')) throw new Error('se colgó')
      return { code: 0, out: '' }
    })
    const d = await run({ root, base: 'main', proc, waitUrl: async () => true })
    expect(calls.at(-1)).toEqual({ kind: 'stop', cmd: 'echo start' })
    expect(d.decision).toBe('blocked')
    expect(d.findings[0]).toMatchObject({ check: 'e2e', kind: 'error' })
  })

  it('e2e termina mal sin producir resultado → fail con error', async () => {
    const root = repo(yaml())
    const { proc } = fakeProc(cmd => (cmd.includes('playwright') ? { code: 1, out: 'Error: no browsers' } : { code: 0, out: '' }))
    const d = await run({ root, base: 'main', proc, waitUrl: async () => true })
    expect(d.decision).toBe('blocked')
    expect(d.findings[0]!.message).toMatch(/no browsers/)
  })

  it('e2e termina con código ≠ 0 pero el resultado dice pass → fail', async () => {
    const root = repo(yaml())
    const { proc } = fakeProc((cmd, env) => {
      if (!cmd.includes('playwright')) return { code: 0, out: '' }
      writeE2e(env, { check: 'e2e', status: 'pass', findings: [] })
      return { code: 1, out: 'Error: No tests found' }
    })
    const d = await run({ root, base: 'main', proc, waitUrl: async () => true })
    expect(d.decision).toBe('blocked')
    expect(d.findings[0]!.message).toMatch(/No tests found/)
  })

  it('la app no responde a tiempo → blocked y no corre checks', async () => {
    const root = repo(yaml())
    const { proc, calls } = fakeProc()
    const d = await run({ root, base: 'main', proc, waitUrl: async () => false })
    expect(d.decision).toBe('blocked')
    expect(d.findings[0]).toMatchObject({ check: 'app', kind: 'error' })
    expect(calls.some(c => c.cmd.includes('playwright'))).toBe(false)
    expect(calls.at(-1)!.kind).toBe('stop')
  })

  it('ingiere JUnit de unit y la salida de gitleaks', async () => {
    const root = repo(yaml('  unit: npm test\n  security: [gitleaks]\n'))
    const { proc } = fakeProc((cmd, env) => {
      const raw = join(env.QA_PILOT_OUT!, 'raw')
      if (cmd === 'npm test') writeFileSync(join(raw, 'unit.xml'), '<testsuite><testcase name="a"/></testsuite>')
      if (cmd.startsWith('gitleaks')) writeFileSync(join(raw, 'gitleaks.json'), '[]')
      if (cmd.includes('playwright')) writeE2e(env, { check: 'e2e', status: 'pass', findings: [] })
      return { code: 0, out: '' }
    })
    const d = await run({ root, base: 'main', proc, waitUrl: async () => true })
    expect(d.checks).toEqual({ e2e: 'pass', gitleaks: 'pass', unit: 'pass' })
    expect(d.decision).toBe('auto')
  })

  it('QA_PILOT_E2E_ARGS se agrega al comando de e2e', async () => {
    const root = repo(yaml())
    const { proc, calls } = fakeProc()
    process.env.QA_PILOT_E2E_ARGS = '--update-snapshots'
    try {
      await run({ root, base: 'main', proc, waitUrl: async () => true })
    } finally {
      delete process.env.QA_PILOT_E2E_ARGS
    }
    expect(calls.some(c => c.cmd === 'npx playwright test --update-snapshots')).toBe(true)
  })

  it('docker-compose levanta y baja el entorno', async () => {
    const root = repo(yaml().replace('env: command', 'env: docker-compose\n  compose_file: compose.yml'))
    const { proc, calls } = fakeProc((cmd, env) => {
      if (cmd.includes('playwright')) writeE2e(env, { check: 'e2e', status: 'pass', findings: [] })
      return { code: 0, out: '' }
    })
    await run({ root, base: 'main', proc, waitUrl: async () => true })
    expect(calls[0]!.cmd).toBe('docker compose -f compose.yml up -d --build')
    expect(calls.at(-1)!.cmd).toBe('docker compose -f compose.yml down -v')
  })
})

describe('run · fallas cerradas', () => {
  it('config inválida → escribe decision.json con ERR en vez de reventar', async () => {
    const root = repo('app:\n  env: nada\n  url: http://x\n')
    const { proc, calls } = fakeProc()
    const d = await run({ root, base: 'main', proc, waitUrl: async () => true })
    expect(d.decision).toBe('escalate')
    expect(d.gates[0]!.id).toBe('ERR')
    expect(calls).toEqual([])
    expect(JSON.parse(readFileSync(join(root, 'qa-results/decision.json'), 'utf8')).gates[0].id).toBe('ERR')
  })

  it('unit con código ≠ 0 pero JUnit en verde → fail', async () => {
    const root = repo(yaml('  unit: npm test\n'))
    const { proc } = fakeProc((cmd, env) => {
      if (cmd === 'npm test') {
        writeFileSync(join(env.QA_PILOT_OUT!, 'raw', 'unit.xml'), '<testsuite><testcase name="a"/></testsuite>')
        return { code: 2, out: 'tsc: error TS2304' }
      }
      if (cmd.includes('playwright')) writeE2e(env, { check: 'e2e', status: 'pass', findings: [] })
      return { code: 0, out: '' }
    })
    const d = await run({ root, base: 'main', proc, waitUrl: async () => true })
    expect(d.checks.unit).toBe('fail')
    expect(d.decision).toBe('blocked')
  })

  it('cada check corre con el timeout de checks.timeout_s', async () => {
    const root = repo(yaml('  timeout_s: 42\n'))
    const seen: Array<number | undefined> = []
    const { proc } = fakeProc()
    const sh = proc.sh
    proc.sh = async (cmd, o) => { if (cmd.includes('playwright')) seen.push(o.timeoutS); return sh(cmd, o) }
    await run({ root, base: 'main', proc, waitUrl: async () => true })
    expect(seen).toEqual([42])
  })

  it('gitleaks revisa solo los commits del PR y con --redact; semgrep solo los archivos cambiados', async () => {
    const root = repo(yaml('  security: [semgrep, gitleaks]\n'))
    execFileSync('git', ['checkout', '-qb', 'feat'], { cwd: root })
    writeFileSync(join(root, 'app con espacio.ts'), 'x\n')
    execFileSync('git', ['add', '-A'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'x'], { cwd: root })
    const { proc, calls } = fakeProc()
    await run({ root, base: 'main', proc, waitUrl: async () => true })
    const gl = calls.find(c => c.cmd.startsWith('gitleaks'))!.cmd
    expect(gl).toContain('--redact')
    expect(gl).toContain("--log-opts='main..HEAD'")
    const sg = calls.find(c => c.cmd.startsWith('semgrep'))!.cmd
    expect(sg).toContain("'app con espacio.ts'")
    expect(sg).not.toContain('qa/qa-pilot.yaml')
  })
})

describe('parseSupabaseEnv', () => {
  it('lee KEY="valor" y mapea según env_map', () => {
    const out = 'API_URL="http://127.0.0.1:54321"\nANON_KEY="ey.anon"\nSERVICE_ROLE_KEY="ey.service"\n'
    expect(parseSupabaseEnv(out, { NEXT_PUBLIC_SUPABASE_URL: 'API_URL', SUPABASE_SERVICE_ROLE_KEY: 'SERVICE_ROLE_KEY' })).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'ey.service',
    })
  })
  it('falla claro si falta una variable mapeada', () => {
    expect(() => parseSupabaseEnv('API_URL="x"\n', { A: 'ANON_KEY' })).toThrow(/ANON_KEY/)
  })
})
