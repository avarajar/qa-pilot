import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import QaReporter, { classify } from './reporter.js'

type Fake = Parameters<typeof classify>[0]

const tc = (title: string, outcome: string, tags: string[] = [], project = 'owner-mobile') =>
  ({ title, tags, outcome: () => outcome, parent: { project: () => ({ name: project }) }, location: { file: '/repo/e2e/j1.spec.ts', line: 3 } }) as unknown as Fake
const res = (status: string, errors: string[] = [], attachments: Array<{ name: string; path?: string }> = []) =>
  ({ status, errors: errors.map(message => ({ message })), attachments, retry: 0 }) as unknown as Parameters<typeof classify>[1]

describe('classify', () => {
  it('test que pasó → sin hallazgo', () => {
    expect(classify(tc('entra', 'expected', ['@J1']), res('passed'))).toEqual([])
  })
  it('flaky lleva el journey', () => {
    expect(classify(tc('entra', 'flaky', ['@J1']), res('passed'))).toEqual([
      { kind: 'flaky', message: 'owner-mobile › entra pasó al reintentar', journey: 'J1', file: 'e2e/j1.spec.ts:3' },
    ])
  })
  it('falla solo por screenshots → visual-diff, no test-failed', () => {
    const f = classify(tc('muro', 'unexpected', ['@J3']), res('failed', ['Error: expect(page).toHaveScreenshot(expected)\n  12 pixels are different']))
    expect(f).toEqual([{ kind: 'visual-diff', message: 'owner-mobile › muro: la captura cambió', journey: 'J3', file: 'e2e/j1.spec.ts:3' }])
  })
  it('violación de accesibilidad → a11y', () => {
    const f = classify(tc('panal', 'unexpected'), res('failed', ['Error: a11y: 2 violaciones graves: color-contrast']))
    expect(f[0]).toMatchObject({ kind: 'a11y', message: 'owner-mobile › panal: a11y: 2 violaciones graves: color-contrast' })
  })
  it('cualquier otro error → test-failed', () => {
    const f = classify(tc('crea', 'unexpected', ['@J2']), res('failed', ['Error: Timed out waiting for getByRole(button)', 'Error: toHaveScreenshot failed']))
    expect(f[0]).toMatchObject({ kind: 'test-failed', journey: 'J2' })
  })
  it('quita los colores ANSI y agrega lo esperado y lo recibido', () => {
    const msg = 'Error: \x1b[2mexpect(\x1b[22m\x1b[31mreceived\x1b[39m\x1b[2m).\x1b[22mtoBe\x1b[2m(\x1b[22m\x1b[32mexpected\x1b[39m\x1b[2m) // Object.is equality\x1b[22m\n\nExpected: \x1b[32m403\x1b[39m\nReceived: \x1b[31m200\x1b[39m\n\n    at e2e/j2.spec.ts:9'
    expect(classify(tc('borra', 'unexpected', ['@J2']), res('failed', [msg]))[0]!.message)
      .toBe('owner-mobile › borra: Error: expect(received).toBe(expected) // Object.is equality (esperado: 403 · recibido: 200)')
  })
  it('con toHaveURL toma "Expected pattern" y "Received string"', () => {
    const msg = 'Error: expect(page).toHaveURL(expected) failed\n\nExpected pattern: /\\/login$/\nReceived string:  "http://localhost:3100/notes"\nTimeout: 5000ms'
    expect(classify(tc('sale', 'unexpected'), res('failed', [msg]))[0]!.message)
      .toBe('owner-mobile › sale: Error: expect(page).toHaveURL(expected) failed (esperado: /\\/login$/ · recibido: "http://localhost:3100/notes")')
  })
  it('test omitido → sin hallazgo', () => {
    expect(classify(tc('x', 'skipped'), res('skipped'))).toEqual([])
  })
})

describe('QaReporter', () => {
  it('escribe e2e.json: warn con visual-diff, fail con test-failed, copia el diff', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-rep-'))
    const png = join(out, 'src-diff.png')
    writeFileSync(png, 'png')
    const r = new QaReporter({ outputDir: out })
    r.onTestEnd(tc('muro', 'unexpected', ['@J3']), res('failed', ['toHaveScreenshot: pixels differ'], [{ name: 'muro-dark-diff.png', path: png }]))
    r.onEnd()
    const first = JSON.parse(readFileSync(join(out, 'e2e.json'), 'utf8'))
    expect(first.status).toBe('warn')
    expect(first.findings[0].artifact).toBe('artifacts/owner-mobile-muro-dark-diff.png')
    expect(readFileSync(join(out, 'artifacts/owner-mobile-muro-dark-diff.png'), 'utf8')).toBe('png')

    const r2 = new QaReporter({ outputDir: out })
    r2.onTestEnd(tc('crea', 'unexpected'), res('failed', ['Error: boom']))
    r2.onEnd()
    expect(JSON.parse(readFileSync(join(out, 'e2e.json'), 'utf8')).status).toBe('fail')
  })
  it('copia lo esperado, lo recibido y el diff de cada captura que cambió', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-rep-'))
    const att = (name: string) => { const path = join(out, `src-${name}`); writeFileSync(path, name); return { name, path } }
    const r = new QaReporter({ outputDir: out })
    r.onTestEnd(tc('notas', 'unexpected', ['@J2']), res('failed', ['toHaveScreenshot: pixels differ', 'toHaveScreenshot: pixels differ'], [
      att('notas-light-expected.png'), att('notas-light-actual.png'), att('notas-light-diff.png'),
      att('notas-dark-expected.png'), att('notas-dark-actual.png'), att('notas-dark-diff.png'),
      { name: 'trace', path: join(out, 'no-existe.zip') },
    ]))
    r.onEnd()
    const [f] = JSON.parse(readFileSync(join(out, 'e2e.json'), 'utf8')).findings
    expect(f.artifact).toBe('artifacts/owner-mobile-notas-light-diff.png')
    expect(f.images).toEqual([
      { name: 'owner-mobile · notas-light', expected: 'artifacts/owner-mobile-notas-light-expected.png', actual: 'artifacts/owner-mobile-notas-light-actual.png', diff: 'artifacts/owner-mobile-notas-light-diff.png' },
      { name: 'owner-mobile · notas-dark', expected: 'artifacts/owner-mobile-notas-dark-expected.png', actual: 'artifacts/owner-mobile-notas-dark-actual.png', diff: 'artifacts/owner-mobile-notas-dark-diff.png' },
    ])
    expect(readFileSync(join(out, 'artifacts/owner-mobile-notas-dark-actual.png'), 'utf8')).toBe('notas-dark-actual.png')
  })
  it('captura nueva sin imagen base: solo lo recibido', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-rep-'))
    const path = join(out, 'src.png')
    writeFileSync(path, 'png')
    const r = new QaReporter({ outputDir: out })
    r.onTestEnd(tc('nueva', 'unexpected'), res('failed', ['toHaveScreenshot: snapshot doesn\'t exist'], [{ name: 'nueva-light-actual.png', path }]))
    r.onEnd()
    const [f] = JSON.parse(readFileSync(join(out, 'e2e.json'), 'utf8')).findings
    expect(f.artifact).toBeUndefined()
    expect(f.images).toEqual([{ name: 'owner-mobile · nueva-light', actual: 'artifacts/owner-mobile-nueva-light-actual.png' }])
  })
  it('si Playwright termina en failed sin hallazgos (p. ej. "No tests found") → fail con error', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-rep-'))
    const r = new QaReporter({ outputDir: out })
    r.onEnd({ status: 'failed' } as never)
    expect(JSON.parse(readFileSync(join(out, 'e2e.json'), 'utf8'))).toMatchObject({ status: 'fail', findings: [{ kind: 'error' }] })
  })

  it('si no corrió ningún test → fail con error', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-rep-'))
    const r = new QaReporter({ outputDir: out })
    r.onTestEnd(tc('x', 'skipped'), res('skipped'))
    r.onEnd({ status: 'passed' } as never)
    expect(JSON.parse(readFileSync(join(out, 'e2e.json'), 'utf8'))).toMatchObject({ status: 'fail', findings: [{ kind: 'error', message: 'No se ejecutó ningún test e2e' }] })
  })
  it('timedout o interrupted agrega un error aunque haya otros hallazgos', () => {
    for (const status of ['timedout', 'interrupted']) {
      const out = mkdtempSync(join(tmpdir(), 'qa-rep-'))
      const r = new QaReporter({ outputDir: out })
      r.onTestEnd(tc('x', 'flaky'), res('passed'))
      r.onEnd({ status } as never)
      expect(JSON.parse(readFileSync(join(out, 'e2e.json'), 'utf8')).status).toBe('fail')
    }
  })
})
