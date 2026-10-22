import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VideoPlan, VideoScript, VideoFacts } from 'qa-pilot'
import { render, mediaPlan } from './render.js'

const script: VideoScript = { cover: { title: 'PR #7 · Notas', subtitle: 'Prueba' }, captions: { J1: 'J1 · Entra' }, closing: 'Listo.', ai: false }
const facts: VideoFacts = { pr: { number: 7, title: 'Notas' }, decision: 'escalate', gates: [{ id: 'G1', reason: 'toca admin' }], journeys: [{ id: 'J1', name: 'Entra', status: 'pass' }] }

describe('mediaPlan', () => {
  it('solo deja rutas de artifacts/ que existen y quita las demás', () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-video-'))
    mkdirSync(join(out, 'artifacts'))
    writeFileSync(join(out, 'artifacts', 'a.png'), 'x'); writeFileSync(join(out, 'artifacts', 'j1.webm'), 'x')
    const plan: VideoPlan = { version: 1, fps: 30, width: 1280, height: 720, totalSeconds: 17, segments: [
      { kind: 'clip', journey: 'J1', status: 'pass', video: 'artifacts/j1.webm', fromMs: 0, toMs: 1000, playbackRate: 1, seconds: 1 },
      { kind: 'clip', journey: 'J2', status: 'pass', video: 'artifacts/../secreto.webm', fromMs: 0, toMs: 1000, playbackRate: 1, seconds: 1 },
      { kind: 'stop', journey: 'J1', images: { before: 'artifacts/a.png', after: 'artifacts/falta.png' }, text: 't', ai: false, seconds: 5 },
      { kind: 'stop', journey: 'J1', images: { before: '/etc/passwd', after: 'artifacts/a.png.exe' }, text: 't', ai: false, seconds: 5 },
    ] }
    const { plan: p, files } = mediaPlan(out, plan)
    expect(files.sort()).toEqual(['artifacts/a.png', 'artifacts/j1.webm'])
    expect(p.segments.map(s => s.kind === 'clip' ? s.video : s.kind === 'stop' ? s.images : null))
      .toEqual(['artifacts/j1.webm', '', { before: 'artifacts/a.png' }, {}])
  })
})

describe('render', () => {
  // descarga Chrome Headless Shell: solo con QA_PILOT_RENDER_TEST=1
  it.runIf(process.env.QA_PILOT_RENDER_TEST)('escribe mp4, gif y video.json', async () => {
    const out = mkdtempSync(join(tmpdir(), 'qa-video-'))
    mkdirSync(join(out, 'artifacts'))
    copyFileSync(new URL('../test/fixtures/clip-64x36.webm', import.meta.url), join(out, 'artifacts', 'video-j1.webm'))
    const plan: VideoPlan = { version: 1, fps: 30, width: 1280, height: 720, totalSeconds: 9, segments: [
      { kind: 'cover', seconds: 3 },
      { kind: 'clip', journey: 'J1', status: 'pass', video: 'artifacts/video-j1.webm', fromMs: 0, toMs: 2000, playbackRate: 1, seconds: 2 },
      { kind: 'verdict', seconds: 4 },
    ] }
    const r = await render({ out, plan, script, facts })
    expect(r.mp4).toBe(join(out, 'video', 'video.mp4'))
    expect(readFileSync(r.mp4).subarray(4, 8).toString('latin1')).toBe('ftyp')
    expect(r.seconds).toBeCloseTo(plan.totalSeconds, 1)
    expect(readFileSync(r.gif).subarray(0, 4).toString('latin1')).toBe('GIF8')
    expect(statSync(r.gif).size).toBeLessThan(5 * 1024 * 1024)
    expect(existsSync(join(out, 'video', 'video.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(out, 'video', 'video.json'), 'utf8'))).toMatchObject({ seconds: r.seconds })
  }, 600_000)
})
