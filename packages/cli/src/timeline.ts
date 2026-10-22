import type { Timeline, TimelineEntry } from './types.js'

// timeline.json lo escribe el código del PR: se valida la forma y se recorta el largo; nunca lanza
const VIDEO_PATH = /^artifacts\/[A-Za-z0-9._-]+\.webm$/
const MAX_STEPS = 50
const MAX_MARKS = 20
const MAX_TEXT = 120

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const ms = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const text = (v: unknown): string | null => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : null)

// al recortar se conserva la marca failure (la que más importa en el video) y las primeras demás
function capMarks(marks: unknown[]): unknown[] {
  if (marks.length <= MAX_MARKS) return marks
  const f = marks.findIndex(m => obj(m) && m.kind === 'failure')
  if (f < 0) return marks.slice(0, MAX_MARKS)
  return marks.filter((_, i) => i === f || i < f + (f < MAX_MARKS ? MAX_MARKS - 1 : 0)).slice(0, MAX_MARKS)
}

function parseEntry(raw: unknown): TimelineEntry | null {
  if (!obj(raw)) return null
  const { journey, title, project, status, video, durationMs, steps, marks } = raw
  if (typeof journey !== 'string' || !/^J\d+$/.test(journey)) return null
  const t = text(title), p = text(project)
  if (t === null || p === null || (status !== 'passed' && status !== 'failed')) return null
  if (typeof video !== 'string' || !VIDEO_PATH.test(video) || !ms(durationMs)) return null
  if (!Array.isArray(steps) || !Array.isArray(marks)) return null
  const outSteps: TimelineEntry['steps'] = []
  for (const s of steps.slice(0, MAX_STEPS)) {
    const st = obj(s) ? text(s.title) : null
    if (!obj(s) || st === null || !ms(s.atMs)) return null
    outSteps.push({ title: st, atMs: s.atMs })
  }
  const outMarks: TimelineEntry['marks'] = []
  for (const m of capMarks(marks)) {
    if (!obj(m) || (m.kind !== 'snap' && m.kind !== 'failure') || !ms(m.atMs)) return null
    const name = m.name === undefined ? undefined : text(m.name)
    if (name === null) return null
    outMarks.push({ kind: m.kind, ...(name !== undefined ? { name } : {}), atMs: m.atMs })
  }
  return { journey, title: t, project: p, status, video, durationMs, steps: outSteps, marks: outMarks }
}

export function parseTimeline(raw: unknown): Timeline {
  if (!obj(raw) || raw.version !== 1 || !Array.isArray(raw.entries)) return { version: 1, entries: [] }
  const entries = raw.entries.flatMap(e => parseEntry(e) ?? [])
  return { version: 1, entries }
}
