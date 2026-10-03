import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadContract, ConfigError, parseProtectedPaths, parseJourneys } from './config.js'

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'qa-config-'))
  mkdirSync(join(root, 'qa'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, 'qa', name), content)
  return root
}

const minimal = `
app:
  env: command
  start: npm start
  url: http://localhost:3000
`

describe('loadContract', () => {
  it('aplica defaults a una configuración mínima', () => {
    const c = loadContract(project({ 'qa-pilot.yaml': minimal }))
    expect(c.config.app.dir).toBe('.')
    expect(c.config.app.ready_timeout_s).toBe(120)
    expect(c.config.router).toEqual({ auto_max_lines: 200, visual_diff: 'warn', flaky_in_journey: 'escalate' })
    expect(c.config.auth.adapter).toBe('none')
    expect(c.config.approvers).toEqual([])
    expect(c.protectedPaths).toEqual([])
    expect(c.journeys).toEqual([])
  })

  it('mezcla extends por debajo del archivo local', () => {
    const c = loadContract(project({
      'studio.yaml': 'router:\n  auto_max_lines: 50\n  visual_diff: escalate\napprovers: [studio-lead]\n',
      'qa-pilot.yaml': `extends: ./studio.yaml\n${minimal}router:\n  auto_max_lines: 300\n`,
    }))
    expect(c.config.router.auto_max_lines).toBe(300)
    expect(c.config.router.visual_diff).toBe('escalate')
    expect(c.config.approvers).toEqual(['studio-lead'])
  })

  it('rechaza un valor inválido nombrando el campo', () => {
    const root = project({ 'qa-pilot.yaml': minimal.replace('env: command', 'env: foo') })
    expect(() => loadContract(root)).toThrow(ConfigError)
    expect(() => loadContract(root)).toThrow(/app\/env/)
  })

  it('explica cuando falta qa/qa-pilot.yaml', () => {
    const root = project({})
    expect(() => loadContract(root)).toThrow(/qa\/qa-pilot\.yaml/)
  })

  it('lee protected-paths y critical-journeys.md', () => {
    const c = loadContract(project({
      'qa-pilot.yaml': minimal,
      'protected-paths': 'supabase/migrations/**\n',
      'critical-journeys.md': '## J1 · Entrar\ntexto\n',
    }))
    expect(c.protectedPaths).toEqual(['supabase/migrations/**'])
    expect(c.journeys).toEqual([{ id: 'J1', name: 'Entrar' }])
  })
})

describe('parseProtectedPaths', () => {
  it('ignora líneas vacías y comentarios, también al final de la línea', () => {
    expect(parseProtectedPaths('# título\n\nauth/**   # login\n  qa/**\n')).toEqual(['auth/**', 'qa/**'])
  })
})

describe('parseJourneys', () => {
  it('acepta · y - como separador', () => {
    expect(parseJourneys('# Journeys\n## J1 · Entrar\n## J12 - Pagar con tarjeta\n## Otra cosa\n')).toEqual([
      { id: 'J1', name: 'Entrar' },
      { id: 'J12', name: 'Pagar con tarjeta' },
    ])
  })
})
