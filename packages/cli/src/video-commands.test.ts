import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from './cli.js'
import './commands.js'
import { setVideoImporter, videoPublish } from './video-commands.js'
import { renderComment } from './comment.js'
import type { Decision } from './types.js'
import type { GitHub } from './github.js'

const decision = (over: Partial<Decision> = {}): Decision => ({
  version: 1, decision: 'escalate', sha: 'sha1',
  gates: [{ id: 'G1', reason: 'db/migrations/1.sql' }],
  diff: { files: 1, added: 10, removed: 0 }, checks: { e2e: 'pass' }, findings: [], ...over,
})

function project(enabled: boolean, d: Decision | string = decision()) {
  const root = mkdtempSync(join(tmpdir(), 'qa-video-'))
  mkdirSync(join(root, 'qa'))
  writeFileSync(join(root, 'qa/qa-pilot.yaml'), `app:\n  env: command\n  url: http://localhost:3000\n${enabled ? 'video:\n  enabled: true\n' : ''}`)
  writeFileSync(join(root, 'qa/critical-journeys.md'), '## J1 · Ver notas\n\nLa persona entra y ve sus notas.\n')
  const out = join(root, 'qa-results')
  mkdirSync(out)
  writeFileSync(join(out, 'decision.json'), typeof d === 'string' ? d : JSON.stringify(d))
  return { root, out }
}

function capture() {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) }, out, err }
}

const saved = { ...process.env }
beforeEach(() => { delete process.env.ANTHROPIC_API_KEY })
afterEach(() => { process.env = { ...saved }; setVideoImporter(null) })

describe('qa-pilot video wanted', () => {
  it.each([['escalate', true, 'true'], ['blocked', true, 'true'], ['auto', true, 'false'], ['escalate', false, 'false']] as const)('%s con video %s → %s', async (kind, enabled, want) => {
    const { root, out } = project(enabled, decision({ decision: kind }))
    const c = capture()
    expect(await main(['video', 'wanted', '--root', root, '--out', out], c.io)).toBe(0)
    expect(c.out).toEqual([want])
  })
})

describe('qa-pilot video script', () => {
  function withEvent(title = 'Notas nuevas') {
    const f = join(mkdtempSync(join(tmpdir(), 'qa-ev-')), 'event.json')
    writeFileSync(f, JSON.stringify({ pull_request: { number: 7, title } }))
    process.env.GITHUB_EVENT_PATH = f
  }
  it('sin clave → plan.json, facts.json y script.json con ai: false', async () => {
    const { root, out } = project(true)
    withEvent()
    const c = capture()
    expect(await main(['video', 'script', '--root', root, '--out', out], c.io)).toBe(0)
    const read = (n: string) => JSON.parse(readFileSync(join(out, 'video', n), 'utf8'))
    expect(read('script.json').ai).toBe(false)
    expect(read('script.json').cover.title).toBe('PR #7 · Notas nuevas')
    expect(read('facts.json').pr).toEqual({ number: 7, title: 'Notas nuevas' })
    expect(read('plan.json').segments.map((s: { kind: string }) => s.kind)).toEqual(['cover', 'verdict'])
  })
  it('timeline.json corrupto → plan con [cover, verdict]', async () => {
    const { root, out } = project(true)
    withEvent()
    writeFileSync(join(out, 'timeline.json'), '{no es json')
    expect(await main(['video', 'script', '--root', root, '--out', out], capture().io)).toBe(0)
    const plan = JSON.parse(readFileSync(join(out, 'video/plan.json'), 'utf8'))
    expect(plan.segments.map((s: { kind: string }) => s.kind)).toEqual(['cover', 'verdict'])
  })
  it('decision.json inválido → 1 con mensaje', async () => {
    const { root, out } = project(true, '{"decision":"nada"}')
    withEvent()
    const c = capture()
    expect(await main(['video', 'script', '--root', root, '--out', out], c.io)).toBe(1)
    expect(c.err.join()).toMatch(/decision\.json/)
  })
})

describe('qa-pilot video render', () => {
  it('sin el paquete → 1 y el mensaje', async () => {
    const { root, out } = project(true)
    mkdirSync(join(out, 'video'))
    setVideoImporter(async () => { throw new Error('Cannot find package') })
    const c = capture()
    expect(await main(['video', 'render', '--root', root, '--out', out], c.io)).toBe(1)
    expect(c.err).toEqual(['instala @qa-pilot/video para generar videos'])
  })
  it('con el paquete llama a render con los tres JSON', async () => {
    const { root, out } = project(true)
    mkdirSync(join(out, 'video'))
    for (const n of ['plan', 'facts', 'script']) writeFileSync(join(out, 'video', `${n}.json`), JSON.stringify({ n }))
    let got: unknown
    setVideoImporter(async () => ({ render: async (i) => { got = i; return { mp4: 'a', gif: 'b', seconds: 9 } } }))
    expect(await main(['video', 'render', '--root', root, '--out', out], capture().io)).toBe(0)
    expect(got).toEqual({ out, plan: { n: 'plan' }, facts: { n: 'facts' }, script: { n: 'script' } })
  })
})

describe('qa-pilot video publish', () => {
  function gh(comment: string | null) {
    const calls: string[] = []
    const g = {
      getPr: async (n: number) => ({ number: n, headSha: 'sha1', labels: [], nodeId: 'x' }),
      findComment: async () => comment,
      upsertComment: async (_n: number, _m: string, body: string) => { calls.push(body) },
      uploadEvidence: async () => 'https://x/raw/c/',
    } as unknown as GitHub
    return { g, calls }
  }
  it('sin archivos → publishVideo con failed y el motivo', async () => {
    const { out } = project(true)
    const { g, calls } = gh(renderComment(decision()))
    const c = capture()
    expect(await videoPublish(g, 7, out, 'se cayó Chrome', c.io)).toBe(0)
    expect(c.out).toEqual(['updated'])
    expect(calls[0]).toContain('se cayó Chrome')
  })
  it('sin archivos ni --reason → motivo por defecto', async () => {
    const { out } = project(true)
    const { g, calls } = gh(renderComment(decision()))
    await videoPublish(g, 7, out, undefined, capture().io)
    expect(calls[0]).toContain('no se pudo generar el video')
  })
  it('sha viejo → stale, exit 0', async () => {
    const { out } = project(true, decision({ sha: 'viejo' }))
    const { g } = gh(renderComment(decision()))
    const c = capture()
    expect(await videoPublish(g, 7, out, undefined, c.io)).toBe(0)
    expect(c.out).toEqual(['stale'])
  })
  it('con archivos válidos los sube y usa seconds de video.json', async () => {
    const { out } = project(true)
    mkdirSync(join(out, 'video'))
    const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(8)])
    writeFileSync(join(out, 'video/video.mp4'), mp4)
    writeFileSync(join(out, 'video/preview.gif'), Buffer.from('GIF89a'))
    writeFileSync(join(out, 'video/video.json'), JSON.stringify({ seconds: 12 }))
    const { g, calls } = gh(renderComment(decision()))
    await videoPublish(g, 7, out, undefined, capture().io)
    expect(calls[0]).toMatch(/video\.mp4/)
    expect(existsSync(join(out, 'video/video.mp4'))).toBe(true)
  })
  it('con --reason no publica archivos aunque estén: el render no terminó bien', async () => {
    const { out } = project(true)
    mkdirSync(join(out, 'video'))
    writeFileSync(join(out, 'video/video.mp4'), Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(8)]))
    writeFileSync(join(out, 'video/preview.gif'), Buffer.from('GIF89a'))
    writeFileSync(join(out, 'video/video.json'), JSON.stringify({ seconds: 12 }))
    const { g, calls } = gh(renderComment(decision()))
    let uploads = 0
    ;(g as unknown as { uploadEvidence: () => Promise<string> }).uploadEvidence = async () => { uploads++; return 'https://x/raw/c/' }
    await videoPublish(g, 7, out, 'el render falló o se pasó del tiempo', capture().io)
    expect(uploads).toBe(0)
    expect(calls[0]).toContain('el render falló o se pasó del tiempo')
    expect(calls[0]).not.toMatch(/video\.mp4/)
  })
})
