import { changeText } from './comment.js'
import type { Decision, JourneyStatus, Snapshot, Timeline, TimelineEntry, VideoPlan, VideoSegment } from './types.js'

// plan puro: qué muestra el video, en qué orden y por cuánto tiempo (todo en centésimas para que la suma sea exacta)
const COVER = 300, VERDICT = 400, STOP = 500, SUMMARY = 200, MIN_EACH = 50, JOURNEY_CAP_MS = 15000
type Finding = Decision['findings'][number]
const FAIL_KINDS = new Set(['test-failed', 'a11y', 'error'])
const num = (j: string) => Number(j.slice(1))
const cents = (s: number) => Math.floor(s * 100 + 1e-6)
const stem = (name: string) => name.split(' · ').pop() ?? name

export function journeyStatuses(d: Decision, t: Timeline): Map<string, JourneyStatus> {
  const out = new Map<string, JourneyStatus>()
  const ids = new Set([...t.entries.map(e => e.journey), ...d.findings.flatMap(f => f.journey ?? [])])
  for (const j of [...ids].sort((a, b) => num(a) - num(b))) {
    const failed = d.findings.some(f => f.journey === j && FAIL_KINDS.has(f.kind)) || t.entries.some(e => e.journey === j && e.status === 'failed')
    out.set(j, failed ? 'failed' : d.findings.some(f => f.journey === j && f.kind === 'visual-diff') ? 'changed' : 'pass')
  }
  return out
}

type Full = { journey: string; status: JourneyStatus; segs: VideoSegment[]; cost: number }

// journey completo: clip hasta la marca, parada con el hallazgo y clip hasta el final
function fullJourney(journey: string, status: JourneyStatus, e: TimelineEntry, f: Finding): Full {
  const end = e.durationMs
  let at: number | undefined
  let stop: Extract<VideoSegment, { kind: 'stop' }>
  if (f.kind === 'visual-diff') {
    const snaps = f.images ?? []
    const marked = snaps.find(s => e.marks.some(m => m.kind === 'snap' && m.name === stem(s.name)))
    const snap: Snapshot | undefined = marked ?? snaps[0]
    at = marked && e.marks.find(m => m.kind === 'snap' && m.name === stem(marked.name))?.atMs
    const images = snap ? { ...(snap.expected ? { before: snap.expected } : {}), ...(snap.marked ?? snap.actual ? { after: (snap.marked ?? snap.actual)! } : {}) } : undefined
    stop = { kind: 'stop', journey, ...(images ? { images } : {}), text: (snap?.ai || (snap && changeText(snap))) || f.message.slice(0, 300), ai: !!snap?.ai, seconds: STOP / 100 }
  } else {
    at = e.marks.find(m => m.kind === 'failure')?.atMs
    stop = { kind: 'stop', journey, text: f.message.slice(0, 300), ai: false, seconds: STOP / 100 }
  }
  const mark = at === undefined ? end : Math.min(at, end)
  const rate = Math.min(4, Math.max(1, end / JOURNEY_CAP_MS))
  const clip = (fromMs: number, toMs: number): VideoSegment[] => toMs > fromMs
    ? [{ kind: 'clip', journey, status, video: e.video, fromMs, toMs, playbackRate: rate, seconds: cents((toMs - fromMs) / 1000 / rate) / 100 }] : []
  const segs = [...clip(0, mark), stop, ...(at === undefined ? [] : clip(mark, end))]
  return { journey, status, segs, cost: segs.reduce((a, s) => a + cents(s.seconds), 0) }
}

export function planVideo({ decision, timeline, maxSeconds }: { decision: Decision; timeline: Timeline; maxSeconds: number }): VideoPlan {
  const statuses = journeyStatuses(decision, timeline)
  const cap = cents(maxSeconds), budget = Math.max(0, cap - COVER - VERDICT)
  const full = new Map<string, Full>()
  for (const [j, status] of statuses) {
    const e = timeline.entries.find(x => x.journey === j)
    const mine = decision.findings.filter(f => f.journey === j)
    const f = mine.find(x => FAIL_KINDS.has(x.kind)) ?? mine.find(x => x.kind === 'visual-diff')
    if (e && f) full.set(j, fullJourney(j, status, e, f))
  }
  const ids = [...statuses.keys()]
  const used = () => ids.reduce((a, j) => a + (full.get(j)?.cost ?? SUMMARY), 0)
  // a resumen: primero pass, luego changed, luego failed; dentro de cada grupo, el número más alto primero
  for (const st of ['pass', 'changed', 'failed'] as const) {
    for (const j of [...full.keys()].filter(k => full.get(k)!.status === st).sort((a, b) => num(b) - num(a))) {
      if (used() <= budget) break
      full.delete(j)
    }
  }
  const squeeze = used() > budget
  const segments: VideoSegment[] = [{ kind: 'cover', seconds: COVER / 100 }]
  if (squeeze) {
    const shown = Math.min(ids.length, Math.floor(budget / MIN_EACH))
    if (shown > 0) segments.push({ kind: 'summary', journeys: ids.slice(0, shown).map(journey => ({ journey, status: statuses.get(journey)! })), more: ids.length - shown, seconds: Math.min(budget, SUMMARY * shown) / 100 })
  } else {
    let pending: Array<{ journey: string; status: JourneyStatus }> = []
    const flush = () => { if (pending.length) segments.push({ kind: 'summary', journeys: pending, more: 0, seconds: pending.length * SUMMARY / 100 }); pending = [] }
    for (const journey of ids) {
      const f = full.get(journey)
      if (f) { flush(); segments.push(...f.segs) } else pending.push({ journey, status: statuses.get(journey)! })
    }
    flush()
  }
  segments.push({ kind: 'verdict', seconds: VERDICT / 100 })
  return { version: 1, fps: 30, width: 1280, height: 720, segments, totalSeconds: segments.reduce((a, s) => a + cents(s.seconds), 0) / 100 }
}

// vista previa: portada + primera parada (o primer clip) + veredicto, en ≤ 8 s
export function previewPlan(plan: VideoPlan): VideoPlan {
  const cover = plan.segments.find(s => s.kind === 'cover')!, verdict = plan.segments.find(s => s.kind === 'verdict')!
  const mid = plan.segments.find(s => s.kind === 'stop') ?? plan.segments.find(s => s.kind === 'clip')
  const room = Math.max(0, 8 - cover.seconds - verdict.seconds)
  let seg: VideoSegment | undefined
  if (mid?.kind === 'stop') seg = { ...mid, seconds: Math.min(mid.seconds, room) }
  else if (mid?.kind === 'clip') { const s = Math.min(mid.seconds, room); seg = { ...mid, seconds: s, toMs: Math.min(mid.toMs, mid.fromMs + Math.floor(s * mid.playbackRate * 1000)) } }
  const segments = [cover, ...(seg && seg.seconds > 0 ? [seg] : []), verdict]
  return { ...plan, segments, totalSeconds: segments.reduce((a, s) => a + cents(s.seconds), 0) / 100 }
}
