import { describe, it, expect } from 'vitest'
import { journeyStatuses, planVideo, previewPlan } from './video-plan.js'
import type { Decision, Timeline, TimelineEntry } from './types.js'

const entry = (n: number, over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  journey: `J${n}`, title: `t${n}`, project: 'admin-desktop', status: 'passed', video: `artifacts/video-${n}.webm`,
  durationMs: 10000, steps: [], marks: [], ...over,
})
const tl = (...entries: TimelineEntry[]): Timeline => ({ version: 1, entries })
const dec = (findings: Decision['findings'] = []): Decision => ({
  version: 1, decision: 'escalate', sha: 'a', gates: [], diff: { files: 1, added: 1, removed: 0 }, checks: {}, findings,
})
const visual = (journey: string, over: Record<string, unknown> = {}): Decision['findings'][number] => ({
  kind: 'visual-diff', check: 'visual', message: 'cambió', journey,
  images: [{ name: 'admin-desktop · notas-light', expected: 'artifacts/e.png', actual: 'artifacts/a.png', marked: 'artifacts/m.png', change: { pixels: 10, percent: 2, zone: 'arriba' }, ...over }],
})
const kinds = (p: ReturnType<typeof planVideo>) => p.segments.map(s => s.kind + ('journey' in s ? `:${s.journey}` : ''))

describe('planVideo', () => {
  it('escalado con un visual-diff en J2', () => {
    const t = tl(entry(1), entry(2, { marks: [{ kind: 'snap', name: 'notas-light', atMs: 4000 }] }), entry(3))
    const p = planVideo({ decision: dec([visual('J2')]), timeline: t, maxSeconds: 90 })
    expect(kinds(p)).toEqual(['cover', 'summary', 'clip:J2', 'stop:J2', 'clip:J2', 'summary', 'verdict'])
    const [, s1, c1, stop, c2, s3] = p.segments
    expect(s1).toMatchObject({ journeys: [{ journey: 'J1', status: 'pass' }], seconds: 2 })
    expect(c1).toMatchObject({ fromMs: 0, toMs: 4000, status: 'changed' })
    expect(c2).toMatchObject({ fromMs: 4000, toMs: 10000 })
    expect(stop).toMatchObject({ images: { before: 'artifacts/e.png', after: 'artifacts/m.png' }, ai: false, seconds: 5 })
    expect((s3 as { journeys: unknown[] }).journeys).toHaveLength(1)
  })
  it('usa la frase de Claude si existe', () => {
    const t = tl(entry(1, { marks: [{ kind: 'snap', name: 'notas-light', atMs: 4000 }] }))
    const p = planVideo({ decision: dec([visual('J1', { ai: 'Se movió el botón' })]), timeline: t, maxSeconds: 90 })
    expect(p.segments.find(s => s.kind === 'stop')).toMatchObject({ text: 'Se movió el botón', ai: true })
  })
  it('bloqueado por fallo en J1', () => {
    const t = tl(entry(1, { status: 'failed', marks: [{ kind: 'failure', atMs: 6000 }] }))
    const d = dec([{ kind: 'test-failed', check: 'e2e', message: 'no vio el botón', journey: 'J1' }])
    const p = planVideo({ decision: d, timeline: t, maxSeconds: 90 })
    expect(kinds(p)).toEqual(['cover', 'clip:J1', 'stop:J1', 'clip:J1', 'verdict'])
    expect(p.segments[2]).toMatchObject({ text: 'no vio el botón', ai: false, seconds: 5 })
  })
  it('sin marca: clip entero y stop', () => {
    const d = dec([{ kind: 'error', check: 'e2e', message: 'x', journey: 'J1' }])
    expect(kinds(planVideo({ decision: d, timeline: tl(entry(1)), maxSeconds: 90 }))).toEqual(['cover', 'clip:J1', 'stop:J1', 'verdict'])
  })
  it('clip de 60 s: playbackRate 4 y ≤ 15 s', () => {
    const t = tl(entry(1, { durationMs: 60000, marks: [{ kind: 'snap', name: 'notas-light', atMs: 20000 }] }))
    const p = planVideo({ decision: dec([visual('J1')]), timeline: t, maxSeconds: 90 })
    const clips = p.segments.filter(s => s.kind === 'clip')
    expect(clips.every(c => c.kind === 'clip' && c.playbackRate === 4)).toBe(true)
    expect(clips.reduce((a, c) => a + c.seconds, 0)).toBeLessThanOrEqual(15)
  })
  it('30 journeys fallidos con clips de 20 s: ≤ 90 y quedan completos los de número más bajo', () => {
    const ns = Array.from({ length: 30 }, (_, i) => i + 1)
    const t = tl(...ns.map(n => entry(n, { status: 'failed', durationMs: 20000, marks: [{ kind: 'failure', atMs: 10000 }] })))
    const d = dec(ns.map(n => ({ kind: 'test-failed' as const, check: 'e2e', message: 'm', journey: `J${n}` })))
    const p = planVideo({ decision: d, timeline: t, maxSeconds: 90 })
    expect(p.totalSeconds).toBeLessThanOrEqual(90)
    const full = [...new Set(p.segments.filter(s => s.kind === 'stop').map(s => 'journey' in s ? s.journey : ''))]
    expect(full.length).toBeGreaterThan(0)
    expect(full).toEqual(ns.slice(0, full.length).map(n => `J${n}`))
    expect(p.totalSeconds).toBe(p.segments.reduce((a, s) => a + s.seconds, 0))
  })
  it('200 journeys: more > 0 y ≤ 90', () => {
    const t = tl(...Array.from({ length: 200 }, (_, i) => entry(i + 1)))
    const p = planVideo({ decision: dec(), timeline: t, maxSeconds: 90 })
    const last = [...p.segments].reverse().find(s => s.kind === 'summary')
    expect(last).toMatchObject({ kind: 'summary' })
    expect((last as { more: number }).more).toBeGreaterThan(0)
    expect(p.totalSeconds).toBeLessThanOrEqual(90)
  })
  it('varios tests por journey: usa el que falló', () => {
    const t = tl(entry(1, { video: 'artifacts/a.webm' }), entry(1, { status: 'failed', video: 'artifacts/b.webm', marks: [{ kind: 'failure', atMs: 5000 }] }))
    const d = dec([{ kind: 'test-failed', check: 'e2e', message: 'm', journey: 'J1' }])
    const p = planVideo({ decision: d, timeline: t, maxSeconds: 90 })
    expect(p.segments.filter(s => s.kind === 'clip').every(c => c.kind === 'clip' && c.video === 'artifacts/b.webm')).toBe(true)
  })
  it('varios tests por journey: sin fallo, usa el de la captura del hallazgo', () => {
    const t = tl(entry(1, { video: 'artifacts/a.webm' }), entry(1, { video: 'artifacts/b.webm', marks: [{ kind: 'snap', name: 'notas-light', atMs: 3000 }] }))
    const p = planVideo({ decision: dec([visual('J1')]), timeline: t, maxSeconds: 90 })
    expect(p.segments.find(s => s.kind === 'clip')).toMatchObject({ video: 'artifacts/b.webm', toMs: 3000 })
  })
  it('el texto del stop no queda escapado para tabla', () => {
    const t = tl(entry(1, { marks: [{ kind: 'snap', name: 'notas-light', atMs: 3000 }] }))
    const d = dec([visual('J1', { elements: ['a > b | c'] })])
    const stop = planVideo({ decision: d, timeline: t, maxSeconds: 90 }).segments.find(s => s.kind === 'stop')
    expect(stop).toMatchObject({ text: expect.stringContaining('a > b | c') })
  })
  it('clip de 120 s con marca en 90 s: ≤ 15 s y el primer clip termina en la marca', () => {
    const t = tl(entry(1, { durationMs: 120000, marks: [{ kind: 'snap', name: 'notas-light', atMs: 90000 }] }))
    const p = planVideo({ decision: dec([visual('J1')]), timeline: t, maxSeconds: 90 })
    const clips = p.segments.filter(s => s.kind === 'clip')
    expect(clips[0]).toMatchObject({ toMs: 90000, playbackRate: 4 })
    expect(clips.reduce((a, c) => a + c.seconds, 0)).toBeLessThanOrEqual(15)
  })
  it('journey fallido solo por el timeline: stop de respaldo', () => {
    const p = planVideo({ decision: dec(), timeline: tl(entry(1, { status: 'failed' })), maxSeconds: 90 })
    expect(p.segments.find(s => s.kind === 'stop')).toMatchObject({ text: 'El journey falló', ai: false })
  })
  it('el texto de la IA se recorta a 200', () => {
    const t = tl(entry(1, { marks: [{ kind: 'snap', name: 'notas-light', atMs: 3000 }] }))
    const stop = planVideo({ decision: dec([visual('J1', { ai: 'x'.repeat(500) })]), timeline: t, maxSeconds: 90 }).segments.find(s => s.kind === 'stop')
    expect((stop as { text: string }).text).toHaveLength(200)
  })
  it('en apuros, los que van a more son los de menor prioridad', () => {
    const ns = Array.from({ length: 200 }, (_, i) => i + 1)
    const d = dec([{ kind: 'test-failed', check: 'e', message: 'm', journey: 'J200' }])
    const p = planVideo({ decision: d, timeline: tl(...ns.map(n => entry(n))), maxSeconds: 90 })
    const sum = p.segments.find(s => s.kind === 'summary') as { journeys: Array<{ journey: string }>; more: number }
    expect(sum.more).toBeGreaterThan(0)
    expect(sum.journeys.some(j => j.journey === 'J200')).toBe(true)
    expect(sum.journeys.some(j => j.journey === 'J1')).toBe(true)
  })
  it('timeline vacío: cover y verdict', () => {
    expect(kinds(planVideo({ decision: dec(), timeline: tl(), maxSeconds: 90 }))).toEqual(['cover', 'verdict'])
  })
  it('journey con hallazgo pero sin video va en resumen con su estado', () => {
    const d = dec([{ kind: 'test-failed', check: 'e2e', message: 'm', journey: 'J2' }])
    const p = planVideo({ decision: d, timeline: tl(entry(1)), maxSeconds: 90 })
    expect(kinds(p)).toEqual(['cover', 'summary', 'verdict'])
    expect(p.segments[1]).toMatchObject({ journeys: [{ journey: 'J1', status: 'pass' }, { journey: 'J2', status: 'failed' }] })
  })
  it('ordena los journeys numéricamente', () => {
    const p = planVideo({ decision: dec(), timeline: tl(entry(10), entry(2)), maxSeconds: 90 })
    expect(p.segments[1]).toMatchObject({ journeys: [{ journey: 'J2' }, { journey: 'J10' }] })
  })
})

describe('journeyStatuses', () => {
  it('failed > changed > pass', () => {
    const d = dec([visual('J2'), visual('J3'), { kind: 'a11y', check: 'a', message: 'm', journey: 'J3' }])
    const s = journeyStatuses(d, tl(entry(1), entry(2), entry(3), entry(4, { status: 'failed' })))
    expect([...s]).toEqual([['J1', 'pass'], ['J2', 'changed'], ['J3', 'failed'], ['J4', 'failed']])
  })
  it('un test que Playwright marca fallido solo por la captura queda como cambió', () => {
    const s = journeyStatuses(dec([visual('J1')]), tl(entry(1, { status: 'failed' })))
    expect([...s]).toEqual([['J1', 'changed']])
  })
})

describe('previewPlan', () => {
  it('cover + primer stop + verdict, ≤ 8 s', () => {
    const t = tl(entry(1, { marks: [{ kind: 'snap', name: 'notas-light', atMs: 4000 }] }))
    const p = previewPlan(planVideo({ decision: dec([visual('J1')]), timeline: t, maxSeconds: 90 }))
    expect(kinds(p)).toEqual(['cover', 'stop:J1', 'verdict'])
    expect(p.totalSeconds).toBeLessThanOrEqual(8)
  })
  it('sin stop usa el primer clip recortado', () => {
    const p = previewPlan(planVideo({ decision: dec(), timeline: tl(entry(1)), maxSeconds: 90 }))
    expect(kinds(p)).toEqual(['cover', 'verdict'])
    const d = dec([{ kind: 'error', check: 'e', message: 'm', journey: 'J1' }])
    const q = previewPlan({ ...planVideo({ decision: d, timeline: tl(entry(1)), maxSeconds: 90 }), segments: planVideo({ decision: d, timeline: tl(entry(1)), maxSeconds: 90 }).segments.filter(s => s.kind !== 'stop') })
    expect(kinds(q)).toEqual(['cover', 'clip:J1', 'verdict'])
    expect(q.totalSeconds).toBeLessThanOrEqual(8)
  })
})
