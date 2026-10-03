import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { route, readResults } from './router.js'
import { parseDiff } from './diff.js'
import type { CheckResult, Diff, QaContract } from './types.js'

const contract: QaContract = {
  root: '/repo',
  protectedPaths: ['supabase/migrations/**', 'web/src/app/(app)/celdas/[slug]/memoria/**'],
  journeys: [{ id: 'J3', name: 'Editar memoria' }],
  config: {
    app: { env: 'command', dir: '.', url: 'http://localhost:3000', ready_timeout_s: 120 },
    auth: { adapter: 'none' },
    roles: {},
    checks: { e2e: 'npx playwright test' },
    router: { auto_max_lines: 200, visual_diff: 'warn', flaky_in_journey: 'escalate' },
    approvers: [],
  },
}

const pass = (check: string): CheckResult => ({ check, status: 'pass', findings: [] })
const file = (path: string, added = 1, removed = 0, status: 'A' | 'M' | 'D' | 'R' = 'M') => ({ path, status, added, removed })
const decide = (diff: Diff, results: CheckResult[], expectedChecks = ['e2e'], c = contract) =>
  route({ contract: c, results, diff, sha: 'abc123', expectedChecks })

describe('route', () => {
  it('PR #41: estilos, todo verde, diff visual fuera de journeys → auto', () => {
    const d = decide(
      { files: [file('web/src/components/panal/Hexagon.tsx', 10, 6), file('web/src/components/panal/panal.css', 8, 3)] },
      [{ check: 'e2e', status: 'warn', findings: [{ kind: 'visual-diff', message: 'panal-mobile cambió' }] }],
    )
    expect(d.decision).toBe('auto')
    expect(d.gates).toEqual([])
    expect(d.diff).toEqual({ files: 2, added: 18, removed: 9 })
    expect(d.sha).toBe('abc123')
    expect(d.version).toBe(1)
  })

  it('PR #42: migración + ruta de Next con () y [] + diff visual en J3 → escalate G1 y G4', () => {
    const d = decide(
      { files: [file('supabase/migrations/20261002_memoria.sql', 20), file('web/src/app/(app)/celdas/[slug]/memoria/actions.ts', 30, 12)] },
      [{ check: 'e2e', status: 'warn', findings: [{ kind: 'visual-diff', message: 'muro cambió', journey: 'J3' }] }],
    )
    expect(d.decision).toBe('escalate')
    expect(d.gates.map(g => g.id)).toEqual(['G1', 'G4'])
    expect(d.gates[0]!.reason).toContain('supabase/migrations/20261002_memoria.sql')
    expect(d.gates[0]!.reason).toContain('web/src/app/(app)/celdas/[slug]/memoria/actions.ts')
  })

  it('un check en fail → blocked aunque haya gates', () => {
    const d = decide({ files: [file('supabase/migrations/x.sql')] }, [{ check: 'e2e', status: 'fail', findings: [{ kind: 'test-failed', message: 'J1 falló' }] }])
    expect(d.decision).toBe('blocked')
    expect(d.findings[0]).toMatchObject({ check: 'e2e', kind: 'test-failed' })
  })

  it('renombrar desde una ruta protegida activa G1', () => {
    const d = decide({ files: [{ path: 'supabase/old.sql', from: 'supabase/migrations/1.sql', status: 'R', added: 0, removed: 0 }] }, [pass('e2e')])
    expect(d.gates.map(g => g.id)).toEqual(['G1'])
  })

  it('editar un test e2e, imágenes base o qa/ activa G3', () => {
    for (const p of ['web/e2e/j1.spec.ts', 'web/e2e/__screenshots__/owner-mobile/panal-light.png', 'e2e/j1.spec.ts-snapshots/a.png', 'qa/protected-paths']) {
      expect(decide({ files: [file(p)] }, [pass('e2e')]).gates.map(g => g.id)).toContain('G3')
    }
    expect(decide({ files: [file('web/src/lib/x.test.ts')] }, [pass('e2e')]).gates).toEqual([])
  })

  it('más líneas que auto_max_lines activa G5', () => {
    const d = decide({ files: [file('web/a.ts', 150, 51)] }, [pass('e2e')])
    expect(d.gates).toEqual([{ id: 'G5', reason: '201 líneas cambiadas (máximo 200)' }])
  })

  it('un hallazgo de seguridad activa SEC', () => {
    const d = decide({ files: [file('web/a.ts')] }, [pass('e2e'), { check: 'semgrep', status: 'warn', findings: [{ kind: 'security', message: 'sql injection', severity: 'high' }] }], ['e2e', 'semgrep'])
    expect(d.decision).toBe('escalate')
    expect(d.gates.map(g => g.id)).toEqual(['SEC'])
  })

  it('el revisor IA con aviso activa AI', () => {
    const d = decide({ files: [file('web/a.ts')] }, [pass('e2e'), { check: 'ai-review', status: 'warn', findings: [{ kind: 'security', message: 'política abierta' }] }])
    expect(d.gates.map(g => g.id)).toEqual(['SEC', 'AI'])
  })

  it('flaky en un journey escala según la configuración', () => {
    const results: CheckResult[] = [{ check: 'e2e', status: 'warn', findings: [{ kind: 'flaky', message: 'login', journey: 'J1' }] }]
    expect(decide({ files: [file('web/a.ts')] }, results).gates.map(g => g.id)).toEqual(['G4'])
    const lenient = { ...contract, config: { ...contract.config, router: { ...contract.config.router, flaky_in_journey: 'warn' as const } } }
    expect(decide({ files: [file('web/a.ts')] }, results, ['e2e'], lenient).gates).toEqual([])
  })

  it('visual_diff: escalate escala diffs fuera de journeys', () => {
    const strict = { ...contract, config: { ...contract.config, router: { ...contract.config.router, visual_diff: 'escalate' as const } } }
    const d = decide({ files: [file('web/a.ts')] }, [{ check: 'e2e', status: 'warn', findings: [{ kind: 'visual-diff', message: 'x' }] }], ['e2e'], strict)
    expect(d.gates.map(g => g.id)).toEqual(['G4'])
  })

  it('falla cerrado si falta un check esperado', () => {
    const d = decide({ files: [file('web/a.ts')] }, [], ['e2e', 'unit'])
    expect(d.decision).toBe('escalate')
    expect(d.gates).toEqual([{ id: 'ERR', reason: 'Sin resultado de: e2e, unit' }])
  })
})

describe('G2 · zonas sensibles del repo', () => {
  const g2 = (prefix: string, paths: string[]) =>
    decide({ files: [], repo: { prefix, paths } }, [pass('e2e')]).gates.find(g => g.id === 'G2')

  it('la config de CI escala, esté el proyecto en la raíz o en una subcarpeta', () => {
    expect(g2('', ['.github/workflows/qa.yml'])).toEqual({ id: 'G2', reason: '.github/workflows/qa.yml' })
    expect(g2('examples/notes/', ['.github/workflows/qa.yml'])).toBeDefined()
    expect(g2('apps/web/', ['.gitlab-ci.yml', '.circleci/config.yml'])?.reason).toBe('.gitlab-ci.yml, .circleci/config.yml')
  })
  it('con el proyecto en una subcarpeta, los archivos de la raíz del repo escalan', () => {
    expect(g2('examples/notes/', ['pnpm-lock.yaml', 'package.json'])?.reason).toBe('pnpm-lock.yaml, package.json')
  })
  it('con el proyecto en la raíz, sus archivos de raíz no escalan por G2 (para eso está protected-paths)', () => {
    expect(g2('', ['README.md', 'package.json'])).toBeUndefined()
  })
  it('otra app del monorepo no escala: tiene su propio qa-pilot', () => {
    const d = decide({ files: [], repo: { prefix: 'apps/web/', paths: ['apps/otra/src/x.ts', 'packages/ui/button.tsx'] } }, [pass('e2e')])
    expect(d.decision).toBe('auto')
  })
})

describe('protected-paths al estilo gitignore', () => {
  const withPaths = (protectedPaths: string[]) => ({ ...contract, protectedPaths })
  const g1 = (paths: string[], file: string) =>
    decide({ files: [{ path: file, status: 'M', added: 1, removed: 0 }] }, [pass('e2e')], ['e2e'], withPaths(paths)).gates.some(g => g.id === 'G1')

  it('directorio con / final, sin glob o con / inicial cubre todo lo de adentro', () => {
    expect(g1(['supabase/migrations/'], 'supabase/migrations/1.sql')).toBe(true)
    expect(g1(['supabase/migrations'], 'supabase/migrations/1.sql')).toBe(true)
    expect(g1(['/supabase/migrations/**'], 'supabase/migrations/1.sql')).toBe(true)
  })
  it('un nombre sin / coincide en cualquier carpeta', () => {
    expect(g1(['middleware.ts'], 'src/middleware.ts')).toBe(true)
    expect(g1(['middleware.ts'], 'middleware.ts')).toBe(true)
  })
  it('con / inicial queda anclado a la raíz', () => {
    expect(g1(['/middleware.ts'], 'src/middleware.ts')).toBe(false)
  })
  it('no coincide con prefijos parecidos', () => {
    expect(g1(['supabase/migrations'], 'supabase/migrations-old/1.sql')).toBe(false)
  })
})

describe('oráculo (G3)', () => {
  it('config de Playwright o Vitest y cualquier archivo bajo e2e/ cuentan como oráculo', () => {
    for (const p of ['web/playwright.config.ts', 'vitest.config.ts', 'web/e2e/helpers.ts', 'e2e/fixtures/seed.ts']) {
      expect(decide({ files: [file(p)] }, [pass('e2e')]).gates.map(g => g.id)).toContain('G3')
    }
  })
})

describe('tamaño de la decisión', () => {
  it('guarda como máximo 50 hallazgos y cuenta los omitidos', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ kind: 'flaky' as const, message: `t${i}` }))
    const d = decide({ files: [file('web/a.ts')] }, [{ check: 'e2e', status: 'warn', findings: many }])
    expect(d.findings).toHaveLength(50)
    expect(d.omittedFindings).toBe(30)
  })
})

describe('readResults', () => {
  it('lee los resultados y reporta como error el JSON ilegible', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-results-'))
    writeFileSync(join(dir, 'e2e.json'), JSON.stringify(pass('e2e')))
    writeFileSync(join(dir, 'unit.json'), '{roto')
    writeFileSync(join(dir, 'decision.json'), '{}')
    const { results, errors } = readResults(dir)
    expect(results.map(r => r.check)).toEqual(['e2e'])
    expect(errors).toEqual(['unit.json: JSON inválido'])
  })

  it('un resultado ilegible hace que el router escale con ERR', () => {
    const d = route({ contract, results: [pass('e2e')], diff: { files: [] }, sha: 'x', expectedChecks: ['e2e'], errors: ['unit.json: JSON inválido'] })
    expect(d.gates).toEqual([{ id: 'ERR', reason: 'unit.json: JSON inválido' }])
  })
})

describe('parseDiff', () => {
  it('combina --name-status y --numstat, con renombres y binarios', () => {
    const nameStatus = 'M\tweb/a.ts\nA\tsupabase/migrations/1.sql\nR087\told/b.ts\tnew/b.ts\nM\tweb/img.png\n'
    const numstat = '3\t1\tweb/a.ts\n10\t0\tsupabase/migrations/1.sql\n2\t2\told/b.ts => new/b.ts\n-\t-\tweb/img.png\n'
    expect(parseDiff(nameStatus, numstat)).toEqual({
      files: [
        { path: 'web/a.ts', status: 'M', added: 3, removed: 1 },
        { path: 'supabase/migrations/1.sql', status: 'A', added: 10, removed: 0 },
        { path: 'new/b.ts', from: 'old/b.ts', status: 'R', added: 2, removed: 2 },
        { path: 'web/img.png', status: 'M', added: 0, removed: 0 },
      ],
    })
  })
})
