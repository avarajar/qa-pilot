import { statSync } from 'node:fs'
import type { TestCase, TestResult } from '@playwright/test/reporter'
import type { TimelineEntry } from 'qa-pilot'

const MAX_CLIP_BYTES = 20 * 1024 * 1024
const STEP_CATEGORIES = new Set(['test.step', 'pw:api', 'expect'])
const SNAP = /toHaveScreenshot\(([^)]+?)\.png\)/
let seq = 0

// la entrada de timeline de un test con video: pasos y marcas en ms desde que arrancó
// copy deja el clip en artifacts/ y devuelve su ruta relativa (o null si no pudo)
export function timelineEntry(test: TestCase, result: TestResult, copy: (src: string, name: string) => string | null): TimelineEntry | null {
  const journey = test.tags.find(t => /^@J\d+$/.test(t))?.slice(1)
  const clip = result.attachments.find(a => a.name === 'video' && a.path)
  if (!journey || !clip?.path || result.status === 'skipped') return null
  try {
    if (statSync(clip.path).size > MAX_CLIP_BYTES) return null
  } catch {
    return null
  }
  const project = test.parent.project()?.name ?? 'default'
  const video = copy(clip.path, `video-${project}-${journey.toLowerCase()}-${++seq}.webm`.replace(/[^A-Za-z0-9._-]/g, '-'))
  if (!video) return null
  const at = (d: Date) => Math.max(0, Math.round(d.getTime() - result.startTime.getTime()))
  const steps = result.steps.filter(s => STEP_CATEGORIES.has(s.category)).map(s => ({ title: s.title, atMs: at(s.startTime) }))
  const marks: TimelineEntry['marks'] = []
  for (const s of steps) {
    const stem = SNAP.exec(s.title)?.[1]
    if (stem) marks.push({ kind: 'snap', name: stem, atMs: s.atMs })
  }
  const failed = result.status !== 'passed'
  if (failed) marks.push({ kind: 'failure', atMs: result.duration })
  return { journey, title: test.title, project, status: failed ? 'failed' : 'passed', video, durationMs: result.duration, steps, marks }
}
