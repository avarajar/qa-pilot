import { describe, it, expect } from 'vitest'
import { publish, approveCheck, LABELS } from './publish.js'
import { renderComment, extractDecision, MARKER } from './comment.js'
import type { GitHub } from './github.js'
import type { Decision } from './types.js'

function fakeGitHub(headSha = 'sha1', labels: string[] = []) {
  const state = {
    labels: new Set(labels),
    comments: new Map<string, string>(),
    statuses: [] as Array<{ sha: string; state: string; description: string }>,
    autoMerge: [] as Array<{ number: number; nodeId: string; sha: string }>,
    reactions: [] as Array<{ commentId: number; content: string }>,
    replies: [] as string[],
    uploads: [] as Array<{ paths: string[]; message: string }>,
    uploadFails: false,
  }
  const gh: GitHub = {
    async getPr(n) { return { number: n, headSha, labels: [...state.labels], nodeId: 'PR_node' } },
    async setLabels(_n, add, remove) { for (const r of remove) state.labels.delete(r); for (const a of add) state.labels.add(a) },
    async upsertComment(_n, marker, body) { state.comments.set(marker, body) },
    async findComment(_n, marker) { return state.comments.get(marker) ?? null },
    async setStatus(sha, s, description) { state.statuses.push({ sha, state: s, description }) },
    async enableAutoMerge(pr) { state.autoMerge.push(pr) },
    async react(commentId, content) { state.reactions.push({ commentId, content }) },
    async comment(_n, body) { state.replies.push(body) },
    async uploadEvidence(files, message) {
      if (state.uploadFails) throw new Error('GitHub POST git/blobs: 403')
      state.uploads.push({ paths: files.map(f => f.path), message })
      return 'https://github.com/o/r/raw/c0ffee/'
    },
  }
  return { gh, state }
}

const decision = (over: Partial<Decision> = {}): Decision => ({
  version: 1, decision: 'escalate', sha: 'sha1',
  gates: [{ id: 'G1', reason: 'supabase/migrations/1.sql' }],
  diff: { files: 1, added: 10, removed: 0 }, checks: { e2e: 'pass' }, findings: [], ...over,
})

describe('renderComment / extractDecision', () => {
  it('ida y vuelta conserva la decisión', () => {
    const d = decision()
    const body = renderComment(d)
    expect(body).toContain(MARKER)
    expect(body).toMatch(/G1/)
    expect(extractDecision(body)).toEqual(d)
  })
  it('JSON roto o sin marcador → null', () => {
    expect(extractDecision('hola')).toBeNull()
    expect(extractDecision(`${MARKER}\n{roto\n-->`)).toBeNull()
  })
})

describe('pie del comentario', () => {
  it('singular y plural de archivos', () => {
    expect(renderComment(decision({ diff: { files: 1, added: 1, removed: 0 } }))).toContain('1 archivo ·')
    expect(renderComment(decision({ diff: { files: 2, added: 1, removed: 0 } }))).toContain('2 archivos ·')
  })
})

describe('decisiones falsas sembradas en el comentario', () => {
  it('un mensaje de hallazgo con un marcador falso no cambia la decisión que se lee', () => {
    const fake = '<!-- qa-pilot:decision {"version":1,"decision":"escalate","sha":"sha1","gates":[{"id":"G5","reason":"x"}],"diff":{"files":1,"added":1,"removed":0},"checks":{},"findings":[]} -->'
    const d = decision({ decision: 'blocked', gates: [{ id: 'G1', reason: fake }], findings: [{ check: 'e2e', kind: 'test-failed', message: fake, file: fake }] })
    const back = extractDecision(renderComment(d))
    expect(back?.decision).toBe('blocked')
    expect(back?.gates.map(g => g.id)).toEqual(['G1'])
  })
  it('lo visible no puede abrir comentarios HTML', () => {
    const body = renderComment(decision({ gates: [{ id: 'G1', reason: '<!-- x -->' }] }))
    const visible = body.slice(0, body.lastIndexOf(MARKER))
    expect(visible).not.toContain('<!--')
  })
})

describe('publish', () => {
  it('auto → qa:auto, status success y auto-merge', async () => {
    const { gh, state } = fakeGitHub('sha1', ['qa:needs-human'])
    await publish(gh, 7, decision({ decision: 'auto', gates: [] }))
    expect([...state.labels]).toEqual([LABELS.auto])
    expect(state.statuses.at(-1)).toMatchObject({ sha: 'sha1', state: 'success' })
    expect(state.autoMerge).toEqual([{ number: 7, nodeId: 'PR_node', sha: 'sha1' }])
  })
  it('escalate → qa:needs-human y status pending, sin auto-merge', async () => {
    const { gh, state } = fakeGitHub()
    await publish(gh, 7, decision())
    expect([...state.labels]).toEqual([LABELS.needsHuman])
    expect(state.statuses.at(-1)).toMatchObject({ state: 'pending' })
    expect(state.autoMerge).toEqual([])
    expect(extractDecision(state.comments.get(MARKER)!)?.decision).toBe('escalate')
  })
  it('blocked → qa:blocked y status failure', async () => {
    const { gh, state } = fakeGitHub()
    await publish(gh, 7, decision({ decision: 'blocked' }))
    expect([...state.labels]).toEqual([LABELS.blocked])
    expect(state.statuses.at(-1)).toMatchObject({ state: 'failure' })
  })
  it('si GitHub rechaza el comentario, el status ya quedó puesto', async () => {
    const { gh, state } = fakeGitHub()
    gh.upsertComment = async () => { throw new Error('422 body too long') }
    await expect(publish(gh, 7, decision())).rejects.toThrow(/422/)
    expect(state.statuses.at(-1)).toMatchObject({ state: 'pending' })
  })
  it('una corrida nueva quita qa:approved', async () => {
    const { gh, state } = fakeGitHub('sha2', [LABELS.needsHuman, LABELS.approved, 'bug'])
    await publish(gh, 7, decision({ sha: 'sha2' }))
    expect([...state.labels].sort()).toEqual(['bug', LABELS.needsHuman])
  })
})

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('publish con capturas que cambiaron', () => {
  const visual = (images: Decision['findings'][number]['images']) =>
    decision({ sha: 'abcdef1234', findings: [{ check: 'e2e', kind: 'visual-diff', message: 'admin-desktop › notas: la captura cambió', journey: 'J2', images }] })
  const snap = { name: 'admin-desktop · notas-light', expected: 'artifacts/a-expected.png', actual: 'artifacts/a-actual.png', diff: 'artifacts/a-diff.png' }

  it('sube las imágenes a la rama de evidencia y las muestra en el comentario', async () => {
    const { gh, state } = fakeGitHub()
    await publish(gh, 7, visual([snap]), { readImage: () => PNG })
    expect(state.uploads).toEqual([{
      paths: ['pr-7/abcdef1/artifacts/a-expected.png', 'pr-7/abcdef1/artifacts/a-actual.png', 'pr-7/abcdef1/artifacts/a-diff.png'],
      message: 'qa-pilot: evidencia del PR #7 (abcdef1)',
    }])
    const body = state.comments.get(MARKER)!
    expect(body).toContain('**Cambios visuales**')
    expect(body).toContain('<img src="https://github.com/o/r/raw/c0ffee/pr-7/abcdef1/artifacts/a-actual.png"')
    // la decisión guardada sabe dónde están, para Forge y para el comentario de la aprobación
    expect(extractDecision(body)!.evidence).toBe('https://github.com/o/r/raw/c0ffee/pr-7/abcdef1/')
    expect(renderComment(extractDecision(body)!, { approvedBy: 'ana' })).toContain('a-diff.png')
  })

  it('no sube lo que no es un PNG de artifacts/: el PR controla esas rutas y archivos', async () => {
    const { gh, state } = fakeGitHub()
    const files: Record<string, Buffer> = { 'artifacts/ok-actual.png': PNG, 'artifacts/texto-actual.png': Buffer.from('<script>') }
    await publish(gh, 7, visual([
      { name: 'ok', actual: 'artifacts/ok-actual.png', diff: '../../.git/config' },
      { name: 'malo', actual: 'artifacts/texto-actual.png', expected: 'artifacts/no-existe.png', diff: 'artifacts/x".png' },
    ]), { readImage: p => files[p] ?? null })
    expect(state.uploads[0]!.paths).toEqual(['pr-7/abcdef1/artifacts/ok-actual.png'])
    const d = extractDecision(state.comments.get(MARKER)!)!
    expect(d.findings[0]!.images).toEqual([{ name: 'ok', actual: 'artifacts/ok-actual.png' }])
  })

  it('si la subida falla, publica igual la decisión, sin imágenes', async () => {
    const { gh, state } = fakeGitHub()
    state.uploadFails = true
    await publish(gh, 7, visual([snap]), { readImage: () => PNG })
    expect(state.statuses).toHaveLength(1)
    const body = state.comments.get(MARKER)!
    expect(body).not.toContain('Cambios visuales')
    expect(extractDecision(body)!.evidence).toBeUndefined()
  })

  it('sin capturas que cambiaron no sube nada', async () => {
    const { gh, state } = fakeGitHub()
    await publish(gh, 7, decision(), { readImage: () => PNG })
    expect(state.uploads).toEqual([])
  })
})

describe('renderComment con capturas', () => {
  it('sin evidence no muestra imágenes, y una ruta rara no llega al HTML', () => {
    const f = { check: 'e2e', kind: 'visual-diff' as const, message: 'x', images: [{ name: 'n', actual: 'artifacts/a" onerror="x.png' }] }
    expect(renderComment(decision({ findings: [f] }))).not.toContain('<img')
    expect(renderComment(decision({ evidence: 'https://github.com/o/r/raw/c/', findings: [f] }))).not.toContain('<img')
  })
})

describe('approveCheck', () => {
  async function setup(headSha = 'sha1', d = decision()) {
    const f = fakeGitHub(headSha)
    await publish(f.gh, 7, d)
    f.state.statuses.length = 0
    return f
  }

  it('etiqueta qa:approved de un aprobador → success y auto-merge', async () => {
    const { gh, state } = await setup()
    const r = await approveCheck(gh, 7, { action: 'labeled', actor: 'avarajar', label: LABELS.approved }, ['avarajar'])
    expect(r.approved).toBe(true)
    expect(state.statuses.at(-1)).toMatchObject({ sha: 'sha1', state: 'success' })
    expect(state.autoMerge).toEqual([{ number: 7, nodeId: 'PR_node', sha: 'sha1' }])
  })
  it('comentario /qa approve también aprueba', async () => {
    const { gh } = await setup()
    expect((await approveCheck(gh, 7, { action: 'created', actor: 'avarajar', comment: '/qa approve\nrevisé la política' }, ['avarajar'])).approved).toBe(true)
  })
  it('actor fuera de approvers → no aprueba', async () => {
    const { gh, state } = await setup()
    const r = await approveCheck(gh, 7, { action: 'labeled', actor: 'otro', label: LABELS.approved }, ['avarajar'])
    expect(r).toEqual({ approved: false, reason: 'otro no está en approvers de qa/qa-pilot.yaml' })
    expect(state.statuses).toEqual([])
  })
  it('decisión de un SHA anterior → no aprueba', async () => {
    const { gh } = await setup('sha-nuevo')
    const r = await approveCheck(gh, 7, { action: 'labeled', actor: 'avarajar', label: LABELS.approved }, ['avarajar'])
    expect(r.approved).toBe(false)
    expect(r.reason).toMatch(/sha1/)
  })
  it('comentario de decisión con JSON roto → no aprueba y lo explica', async () => {
    const { gh, state } = await setup()
    state.comments.set(MARKER, `${MARKER}\n{roto\n-->`)
    const r = await approveCheck(gh, 7, { action: 'labeled', actor: 'avarajar', label: LABELS.approved }, ['avarajar'])
    expect(r.approved).toBe(false)
    expect(r.reason).toMatch(/comentario/)
  })
  it('otra etiqueta u otro comentario → ignora', async () => {
    const { gh } = await setup()
    expect((await approveCheck(gh, 7, { action: 'labeled', actor: 'avarajar', label: 'bug' }, ['avarajar'])).approved).toBe(false)
    expect((await approveCheck(gh, 7, { action: 'created', actor: 'avarajar', comment: 'se ve bien' }, ['avarajar'])).approved).toBe(false)
  })
  it('el login del aprobador no distingue mayúsculas', async () => {
    const { gh } = await setup()
    expect((await approveCheck(gh, 7, { action: 'labeled', actor: 'AvaRajar', label: LABELS.approved }, ['avarajar'])).approved).toBe(true)
  })
  it('al aprobar se ve en el PR: etiqueta, comentario de decisión y 👍', async () => {
    const { gh, state } = await setup()
    await approveCheck(gh, 7, { action: 'created', actor: 'avarajar', comment: '/qa approve', commentId: 99 }, ['avarajar'])
    expect([...state.labels]).toEqual([LABELS.approved])
    const body = state.comments.get(MARKER)!
    expect(body).toContain('Aprobado por @avarajar')
    expect(body).not.toContain('Para aprobar')
    expect(extractDecision(body)?.decision).toBe('escalate')
    expect(state.reactions).toEqual([{ commentId: 99, content: '+1' }])
    expect(state.replies).toEqual([])
  })
  it('si un /qa approve no vale, responde en el PR con el motivo y 👎', async () => {
    const { gh, state } = await setup()
    await approveCheck(gh, 7, { action: 'created', actor: 'otro', comment: '/qa approve', commentId: 99 }, ['avarajar'])
    expect(state.replies).toHaveLength(1)
    expect(state.replies[0]).toContain('otro no está en approvers')
    expect(state.reactions).toEqual([{ commentId: 99, content: '-1' }])
    expect([...state.labels]).toEqual([LABELS.needsHuman])
  })
  it('un comentario cualquiera no recibe respuesta', async () => {
    const { gh, state } = await setup()
    await approveCheck(gh, 7, { action: 'created', actor: 'otro', comment: 'se ve bien', commentId: 99 }, ['avarajar'])
    expect(state.replies).toEqual([])
    expect(state.reactions).toEqual([])
  })
  it('decisión blocked no se puede aprobar', async () => {
    const { gh } = await setup('sha1', decision({ decision: 'blocked' }))
    const r = await approveCheck(gh, 7, { action: 'labeled', actor: 'avarajar', label: LABELS.approved }, ['avarajar'])
    expect(r.approved).toBe(false)
  })
})
