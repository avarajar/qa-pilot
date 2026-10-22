import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import QaReporter, { classify } from './reporter.js'
import { timelineEntry } from './timeline.js'

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
  it('con PNG reales dice cuánto y dónde cambió, y marca la zona en lo recibido', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-rep-'))
    const img = (name: string, red = false) => {
      const p = new PNG({ width: 100, height: 50 })
      for (let i = 0; i < 5000; i++) p.data.set([240, 240, 240, 255], i * 4)
      if (red) for (let y = 5; y < 9; y++) for (let x = 80; x < 90; x++) p.data.set([255, 0, 0, 255], (y * 100 + x) * 4)
      const path = join(out, `src-${name}`)
      writeFileSync(path, PNG.sync.write(p))
      return { name, path }
    }
    const r = new QaReporter({ outputDir: out })
    r.onTestEnd(tc('notas', 'unexpected'), res('failed', ['toHaveScreenshot: pixels differ'], [
      img('notas-light-expected.png'), img('notas-light-actual.png'), img('notas-light-diff.png', true),
      { name: 'notas-light-elements.json', body: Buffer.from(JSON.stringify([
        { kind: 'button', label: 'Borrar', box: { x: 80, y: 4, w: 12, h: 6 } },
        { kind: 'h1', label: 'Notas', box: { x: 2, y: 2, w: 20, h: 8 } },
      ])) } as never,
    ]))
    r.onEnd()
    const [snap] = JSON.parse(readFileSync(join(out, 'e2e.json'), 'utf8')).findings[0].images
    expect(snap.change).toEqual({ pixels: 40, percent: 0.8, zone: 'arriba a la derecha' })
    expect(snap.elements).toEqual(['botón «Borrar»'])
    expect(snap.marked).toBe('artifacts/owner-mobile-notas-light-marked.png')
    expect(PNG.sync.read(readFileSync(join(out, snap.marked))).width).toBe(100)
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

describe('timeline', () => {
  const t0 = 1_000_000
  const video = (out: string, size = 10) => { const path = join(out, 'src.webm'); writeFileSync(path, Buffer.alloc(size)); return { name: 'video', path } }
  const rec = (status: string, attachments: unknown[], extra: Record<string, unknown> = {}) =>
    ({ status, errors: [], attachments, retry: 0, startTime: new Date(t0), duration: 3000, steps: [
      { title: 'page.goto(/notes)', startTime: new Date(t0 + 500), category: 'pw:api' },
      { title: 'expect.soft(page).toHaveScreenshot(notas-light.png)', startTime: new Date(t0 + 2000), category: 'expect' },
      { title: 'Before Hooks', startTime: new Date(t0), category: 'hook' },
    ], ...extra }) as unknown as Parameters<typeof classify>[1]
  const copyTo = (out: string) => (src: string, name: string) => { writeFileSync(join(out, name), readFileSync(src)); return `artifacts/${name}` }

  it('@J1 con adjunto video → entrada con pasos y marcas', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-tl-'))
    const e = timelineEntry(tc('entra', 'expected', ['@J1'], 'admin-desktop'), rec('passed', [video(out)]), copyTo(out))!
    expect(e.steps).toEqual([{ title: 'page.goto(/notes)', atMs: 500 }, { title: 'expect.soft(page).toHaveScreenshot(notas-light.png)', atMs: 2000 }])
    expect(e.marks).toEqual([{ kind: 'snap', name: 'notas-light', atMs: 2000 }])
    expect(e.video).toMatch(/^artifacts\/video-admin-desktop-j1-\d+\.webm$/)
    expect(e).toMatchObject({ journey: 'J1', title: 'entra', project: 'admin-desktop', status: 'passed', durationMs: 3000 })
  })
  it('test fallido → marca failure al final', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-tl-'))
    const e = timelineEntry(tc('entra', 'unexpected', ['@J1']), rec('failed', [video(out)]), copyTo(out))!
    expect(e.status).toBe('failed')
    expect(e.marks).toContainEqual({ kind: 'failure', atMs: 3000 })
  })
  it('test fallido → la marca failure va al inicio del paso más profundo con error', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-tl-'))
    const steps = [
      { title: 'page.goto(/notes)', startTime: new Date(t0 + 500), category: 'pw:api', steps: [] },
      { title: 'lista', startTime: new Date(t0 + 1000), category: 'test.step', error: { message: 'x' }, steps: [
        { title: 'page.click', startTime: new Date(t0 + 1100), category: 'pw:api', steps: [] },
        { title: 'expect(locator).toHaveCount(4)', startTime: new Date(t0 + 1200), category: 'expect', error: { message: 'x' }, steps: [] },
      ] },
    ]
    const e = timelineEntry(tc('entra', 'unexpected', ['@J1']), rec('failed', [video(out)], { steps }), copyTo(out))!
    expect(e.marks).toContainEqual({ kind: 'failure', atMs: 1200 })
  })
  it('acota marcas a 20 con la failure incluida, pasos a 50 y títulos a 120', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-tl-'))
    const steps = Array.from({ length: 70 }, (_, i) => ({ title: `expect.soft(page).toHaveScreenshot(s${i}.png) ${'x'.repeat(200)}`, startTime: new Date(t0 + i), category: 'expect' }))
    const e = timelineEntry(tc('entra', 'unexpected', ['@J1']), rec('failed', [video(out)], { steps }), copyTo(out))!
    expect(e.marks).toHaveLength(20)
    expect(e.marks.at(-1)).toEqual({ kind: 'failure', atMs: 3000 })
    expect(e.steps).toHaveLength(50)
    expect(e.steps[0]!.title).toHaveLength(120)
  })
  it('con varias páginas usa el video de la primera (video.webm), no el de una página auxiliar', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-tl-'))
    // @axe-core/playwright abre una página en blanco: Playwright la adjunta como video-1.webm y a veces primero
    const aux = join(out, 'video-1.webm'), main = join(out, 'video.webm')
    writeFileSync(aux, 'aux'); writeFileSync(main, 'main')
    const e = timelineEntry(tc('entra', 'expected', ['@J1']), rec('passed', [{ name: 'video', path: aux }, { name: 'video', path: main }]), copyTo(out))!
    expect(readFileSync(join(out, e.video.slice('artifacts/'.length)), 'utf8')).toBe('main')
  })
  it('sin adjunto video o sin @J → null', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-tl-'))
    expect(timelineEntry(tc('entra', 'expected', ['@J1']), rec('passed', []), copyTo(out))).toBeNull()
    expect(timelineEntry(tc('entra', 'expected'), rec('passed', [video(out)]), copyTo(out))).toBeNull()
  })
  it('clip de más de 20 MB → null', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-tl-'))
    const path = join(out, 'big.webm')
    writeFileSync(path, Buffer.alloc(20 * 1024 * 1024 + 1))
    expect(timelineEntry(tc('entra', 'expected', ['@J1']), rec('passed', [{ name: 'video', path }]), copyTo(out))).toBeNull()
  })
  it('onEnd escribe timeline.json ordenado por journey y con el último intento', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-tl-'))
    const withId = (id: string, title: string, tag: string) => ({ ...tc(title, 'flaky', [tag], 'admin-desktop'), id }) as unknown as Fake
    const r = new QaReporter({ outputDir: out })
    const j2 = withId('b', 'segundo', '@J2'), j1 = withId('a', 'primero', '@J1')
    r.onTestEnd(j2, rec('passed', [video(out)]))
    r.onTestEnd(j1, rec('failed', [video(out)], { retry: 0 }))
    r.onTestEnd(j1, rec('passed', [video(out)], { retry: 1 }))
    r.onEnd()
    const tl = JSON.parse(readFileSync(join(out, 'timeline.json'), 'utf8'))
    expect(tl.version).toBe(1)
    expect(tl.entries.map((e: { journey: string; status: string }) => [e.journey, e.status])).toEqual([['J1', 'passed'], ['J2', 'passed']])
  })
  it('onEnd escribe timeline.json aunque no haya entradas', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-tl-'))
    new QaReporter({ outputDir: out }).onEnd()
    expect(JSON.parse(readFileSync(join(out, 'timeline.json'), 'utf8'))).toEqual({ version: 1, entries: [] })
  })
})
