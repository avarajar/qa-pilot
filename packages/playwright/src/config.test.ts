import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineQaConfig } from './config.js'

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qa-pwcfg-'))
  mkdirSync(join(dir, 'qa'))
  writeFileSync(join(dir, 'qa/qa-pilot.yaml'), `app:
  env: command
  url: http://localhost:3000
auth:
  adapter: form
  login_url: /login
  fields: { email: '#email', password: '#password', submit: 'button' }
roles:
  admin: { email: a@x.test, password_env: A_PASS }
  outsider: { email: o@y.test, expect: rejected }
`)
  return dir
}

describe('defineQaConfig', () => {
  it('crea un proyecto por rol y viewport, sin sesión para el rol rechazado', () => {
    const r = root()
    const c = defineQaConfig({}, { root: r })
    expect(c.projects!.map(p => p.name)).toEqual(['admin-mobile', 'admin-desktop', 'outsider-mobile', 'outsider-desktop'])
    const admin = c.projects![0]!.use!
    expect(admin.storageState).toBe(join(r, 'qa-results/.auth/admin.json'))
    expect(admin.viewport).toEqual({ width: 390, height: 844 })
    expect((admin as { qaRole?: string }).qaRole).toBe('admin')
    expect(c.projects![2]!.use!.storageState).toBeUndefined()
    expect(c.use!.baseURL).toBe('http://localhost:3000')
    expect(c.retries).toBe(1)
    expect(c.reporter).toEqual([['list'], ['@qa-pilot/playwright/reporter', { outputDir: join(r, 'qa-results') }]])
  })

  it('isolationHeader llega a los tests como opción; sin él no se manda nada', () => {
    const r = root()
    expect((defineQaConfig({}, { root: r, isolationHeader: 'x-qa-test' }).use as { qaIsolationHeader?: string }).qaIsolationHeader).toBe('x-qa-test')
    expect(defineQaConfig({}, { root: r }).use).not.toHaveProperty('qaIsolationHeader')
  })

  it('los overrides del proyecto ganan', () => {
    const c = defineQaConfig({ testDir: 'tests/e2e', retries: 0 }, { root: root() })
    expect(c.testDir).toBe('tests/e2e')
    expect(c.retries).toBe(0)
  })
})
