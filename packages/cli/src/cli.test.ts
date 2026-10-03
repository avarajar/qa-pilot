import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from './cli.js'
import type { Decision } from './types.js'

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'qa-cli-'))
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t.t')
  git('config', 'user.name', 't')
  mkdirSync(join(root, 'qa'))
  writeFileSync(join(root, 'qa/qa-pilot.yaml'), 'app:\n  env: command\n  url: http://localhost:3000\nrouter:\n  auto_max_lines: 50\n')
  writeFileSync(join(root, 'qa/protected-paths'), 'db/migrations/**\n')
  writeFileSync(join(root, 'app.ts'), 'export const a = 1\n')
  git('add', '-A')
  git('commit', '-qm', 'base')
  return root
}

function capture() {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) }, out, err }
}

describe('qa-pilot config get', () => {
  it('imprime un valor por ruta punteada, con defaults aplicados', async () => {
    const root = repo()
    const c = capture()
    expect(await main(['config', 'get', 'router.auto_max_lines', '--root', root], c.io)).toBe(0)
    expect(await main(['config', 'get', 'app.ready_timeout_s', '--root', root], c.io)).toBe(0)
    expect(c.out).toEqual(['50', '120'])
  })
  it('falla con código 1 si la clave no existe', async () => {
    const c = capture()
    expect(await main(['config', 'get', 'app.nada', '--root', repo()], c.io)).toBe(1)
    expect(c.err.join()).toMatch(/app\.nada/)
  })
})

describe('qa-pilot route', () => {
  it('un cambio en una ruta protegida escribe decision.json con escalate', async () => {
    const root = repo()
    execFileSync('git', ['checkout', '-qb', 'feat'], { cwd: root })
    mkdirSync(join(root, 'db/migrations'), { recursive: true })
    writeFileSync(join(root, 'db/migrations/1.sql'), 'create table x();\n')
    execFileSync('git', ['add', '-A'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'mig'], { cwd: root })
    const out = join(root, 'qa-results')
    mkdirSync(out)
    const c = capture()
    expect(await main(['route', '--root', root, '--base', 'main', '--out', out], c.io)).toBe(0)
    const d = JSON.parse(readFileSync(join(out, 'decision.json'), 'utf8')) as Decision
    expect(d.decision).toBe('escalate')
    expect(d.gates.map(g => g.id)).toEqual(['G1'])
    expect(c.out.join('\n')).toMatch(/escalate/)
  })
  it('con --head decide sobre ese commit con la config del checkout actual (la base)', async () => {
    const root = repo()
    execFileSync('git', ['checkout', '-qb', 'feat'], { cwd: root })
    // el PR intenta dejar de proteger las migraciones y además agrega una
    writeFileSync(join(root, 'qa/protected-paths'), '# nada\n')
    mkdirSync(join(root, 'db/migrations'), { recursive: true })
    writeFileSync(join(root, 'db/migrations/1.sql'), 'x\n')
    execFileSync('git', ['add', '-A'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'pr'], { cwd: root })
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: root })
    const out = join(root, 'qa-results')
    const c = capture()
    expect(await main(['route', '--root', root, '--base', 'main', '--head', head, '--out', out], c.io)).toBe(0)
    const d = JSON.parse(readFileSync(join(out, 'decision.json'), 'utf8')) as Decision
    expect(d.sha).toBe(head)
    expect(d.gates.map(g => g.id)).toEqual(['G1', 'G3'])
  })
  it('sin repo git devuelve 2', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-nogit-'))
    mkdirSync(join(root, 'qa'))
    writeFileSync(join(root, 'qa/qa-pilot.yaml'), 'app:\n  env: command\n  url: http://localhost:3000\n')
    const c = capture()
    expect(await main(['route', '--root', root, '--base', 'main'], c.io)).toBe(2)
  })
})

describe('qa-pilot ingest', () => {
  it('normaliza una salida externa a <out>/<check>.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-ing-'))
    writeFileSync(join(dir, 'g.json'), '[]')
    const c = capture()
    expect(await main(['ingest', 'gitleaks', join(dir, 'g.json'), '--out', dir], c.io)).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, 'gitleaks.json'), 'utf8'))).toEqual({ check: 'gitleaks', status: 'pass', findings: [] })
  })
})

describe('ayuda', () => {
  it('comando desconocido → 1 y muestra los comandos', async () => {
    const c = capture()
    expect(await main(['nada'], c.io)).toBe(1)
    expect(c.err.join('\n')).toMatch(/route/)
  })
})
