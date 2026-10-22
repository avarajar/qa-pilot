// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Player } from '@remotion/player'
import type { VideoPlan, VideoScript, VideoFacts } from 'qa-pilot'
import { QaVideo, segmentFrames, totalFrames, type QaVideoProps } from './remotion/QaVideo.js'
import { Stop } from './remotion/segments/Stop.js'

const plan: VideoPlan = {
  version: 1, fps: 30, width: 1280, height: 720, totalSeconds: 19.5,
  segments: [
    { kind: 'cover', seconds: 3 },
    { kind: 'clip', journey: 'J1', status: 'changed', video: 'artifacts/video-j1.webm', fromMs: 0, toMs: 3000, playbackRate: 1, seconds: 2.5 },
    { kind: 'stop', journey: 'J1', images: { before: 'artifacts/notas-before.png', after: 'artifacts/notas.png' }, text: 'Cambió la lista de notas', ai: true, seconds: 5 },
    { kind: 'summary', journeys: [{ journey: 'J1', status: 'changed' }, { journey: 'J2', status: 'pass' }], more: 1, seconds: 5 },
    { kind: 'verdict', seconds: 4 },
  ],
}
const script: VideoScript = {
  cover: { title: 'PR #7 · Notas nuevas', subtitle: 'Dos journeys revisados' },
  captions: { J1: 'J1 · La persona entra y ve sus notas' }, closing: 'Revisa la lista antes de aprobar.', ai: true,
}
const facts: VideoFacts = {
  pr: { number: 7, title: 'Notas nuevas' }, decision: 'escalate',
  gates: [{ id: 'G1', reason: 'toca app/admin/**' }],
  journeys: [{ id: 'J1', name: 'Entrar', status: 'changed' }, { id: 'J2', name: 'Salir', status: 'pass' }],
}
// en jsdom no hay decodificador: el video se reemplaza por un div que deja ver sus props
vi.mock('remotion', async orig => ({
  ...(await orig<typeof import('remotion')>()),
  OffthreadVideo: (p: { src: string; trimBefore: number; trimAfter: number; playbackRate: number }) =>
    <div data-testid="video" data-src={p.src} data-trim={`${p.trimBefore}-${p.trimAfter}@${p.playbackRate}`} />,
}))

const props: QaVideoProps = { plan, script, facts, gateNames: { G1: 'Ruta protegida' } }

// dibuja la composición en un frame, como la ve Remotion
const at = (frame: number) => render(
  <Player component={QaVideo} inputProps={props} compositionWidth={1280} compositionHeight={720}
    durationInFrames={totalFrames(plan)} fps={30} initialFrame={frame} acknowledgeRemotionLicense />).container

afterEach(cleanup)

describe('QaVideo', () => {
  it('un Sequence por segmento con from acumulado', () => {
    expect(segmentFrames(plan)).toEqual([
      { from: 0, durationInFrames: 90 }, { from: 90, durationInFrames: 75 }, { from: 165, durationInFrames: 150 },
      { from: 315, durationInFrames: 150 }, { from: 465, durationInFrames: 120 },
    ])
    expect(totalFrames(plan)).toBe(585)
  })

  it('el último segmento llega al final aunque los segundos no den frames exactos', () => {
    const odd: VideoPlan = { ...plan, totalSeconds: 7.01, segments: [{ kind: 'cover', seconds: 3.01 }, { kind: 'verdict', seconds: 4 }] }
    const f = segmentFrames(odd)
    expect(f.at(-1)!.from + f.at(-1)!.durationInFrames).toBe(totalFrames(odd))
  })

  it('portada con el título del guion', () => {
    expect(at(10).textContent).toContain('PR #7 · Notas nuevas')
  })

  it('clip con subtítulo y marca de cambio', () => {
    const c = at(100), t = c.textContent
    const v = c.querySelector('[data-testid=video]')!
    expect(v.getAttribute('data-src')).toMatch(/artifacts\/video-j1\.webm$/)
    expect(v.getAttribute('data-trim')).toBe('0-90@1')
    expect(t).toContain('J1 · La persona entra y ve sus notas')
    expect(t).toContain('⚠ cambió')
    expect(t).not.toContain('PR #7')
  })

  it('parada con Antes, Después y (IA)', () => {
    const t = at(200).textContent
    expect(t).toContain('Antes'); expect(t).toContain('Después')
    expect(t).toContain('Cambió la lista de notas'); expect(t).toContain('(IA)')
  })

  it('resumen con los journeys y los que no caben', () => {
    const t = at(400).textContent
    expect(t).toContain('J2'); expect(t).toContain('✓'); expect(t).toContain('+1')
  })

  it('veredicto con decisión, compuertas y cierre', () => {
    const t = at(500).textContent
    expect(t).toContain('G1 · Ruta protegida: toca app/admin/**')
    expect(t).toContain('Revisa la lista antes de aprobar.')
    expect(t).toContain('Necesita un humano')
  })
})

describe('Stop', () => {
  it('sin imágenes muestra solo el texto, sin paneles vacíos', () => {
    const c = render(<Stop seg={{ kind: 'stop', journey: 'J1', text: 'esperado: 4 · recibido: 3', ai: false, seconds: 5 }} caption="J1 · Entrar" />).container
    expect(c.textContent).toContain('esperado: 4 · recibido: 3')
    expect(c.textContent).not.toContain('sin imagen')
    expect(c.textContent).not.toContain('Antes')
  })
  it('con imágenes muestra el antes y el después', () => {
    // Img necesita el contexto de Remotion: se dibuja dentro de un Player
    const WithImages = () => <Stop seg={{ kind: 'stop', journey: 'J1', images: { before: 'artifacts/b.png' }, text: 't', ai: false, seconds: 5 }} />
    const c = render(<Player component={WithImages} compositionWidth={1280} compositionHeight={720} durationInFrames={30} fps={30} acknowledgeRemotionLicense />).container
    expect(c.textContent).toContain('Antes')
    expect(c.textContent).toContain('Después')
  })
})
