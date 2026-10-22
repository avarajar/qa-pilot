import { describe, it, expect } from 'vitest'
import { parseTimeline } from './timeline.js'

const entry = (over: Record<string, unknown> = {}) => ({
  journey: 'J1', title: 'entra', project: 'admin-desktop', status: 'passed', video: 'artifacts/video-admin-desktop-j1-1.webm',
  durationMs: 3000, steps: [{ title: 'page.goto(/notes)', atMs: 500 }], marks: [{ kind: 'snap', name: 'notas-light', atMs: 2000 }], ...over,
})

describe('parseTimeline', () => {
  it('acepta la forma que escribe el reporter', () => {
    const t = { version: 1, entries: [entry(), entry({ journey: 'J2', status: 'failed', marks: [{ kind: 'failure', atMs: 3000 }] })] }
    expect(parseTimeline(t)).toEqual(t)
  })
  it('descarta entradas con video fuera de artifacts/', () => {
    for (const video of ['../x.webm', 'artifacts/a/b.webm', 'artifacts/x.mp4']) {
      expect(parseTimeline({ version: 1, entries: [entry({ video })] }).entries).toEqual([])
    }
  })
  it('descarta entradas con números no finitos o negativos', () => {
    const bad = [entry({ durationMs: -1 }), entry({ durationMs: null }), entry({ steps: [{ title: 'x', atMs: -5 }] }), entry({ marks: [{ kind: 'snap', name: 'a', atMs: 'x' }] })]
    expect(parseTimeline({ version: 1, entries: bad }).entries).toEqual([])
  })
  it('recorta textos y listas', () => {
    const long = 'a'.repeat(300)
    const steps = Array.from({ length: 80 }, () => ({ title: long, atMs: 1 }))
    const marks = Array.from({ length: 40 }, () => ({ kind: 'snap', name: 'n', atMs: 1 }))
    const [e] = parseTimeline({ version: 1, entries: [entry({ title: long, steps, marks })] }).entries
    expect(e!.title).toHaveLength(120)
    expect(e!.steps).toHaveLength(50)
    expect(e!.steps[0]!.title).toHaveLength(120)
    expect(e!.marks).toHaveLength(20)
  })
  it('version distinta o no-objeto → vacío', () => {
    const empty = { version: 1, entries: [] }
    for (const raw of [null, 'x', 42, [], { version: 2, entries: [entry()] }, { version: 1 }, { version: 1, entries: 'x' }]) {
      expect(parseTimeline(raw)).toEqual(empty)
    }
  })
})
