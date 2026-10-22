import { describe, it, expect } from 'vitest'
import { templateScript, validateScript, claudeScript } from './video-script.js'
import { DEFAULT_MODEL } from './describe.js'
import type { VideoFacts, Journey } from './types.js'

const facts: VideoFacts = {
  pr: { number: 42, title: 'Cambia permisos' },
  decision: 'escalate',
  gates: [{ id: 'G1', reason: 'toca src/auth' }],
  journeys: [{ id: 'J1', name: 'Entrar', status: 'pass' }, { id: 'J2', name: 'Ver notas', status: 'changed' }],
}
const journeys = [
  { id: 'J1', name: 'Entrar', description: 'La persona entra.' },
  { id: 'J2', name: 'Ver notas', description: 'Ve sus notas.' },
] as unknown as Journey[]

function fakeClient(reply: { stop_reason?: string; content?: Array<{ type: string; text?: string }> } | Error) {
  const calls: Array<Record<string, unknown>> = []
  const client = {
    beta: { messages: { async create(params: Record<string, unknown>) {
      calls.push(params)
      if (reply instanceof Error) throw reply
      return { stop_reason: 'end_turn', content: [], ...reply }
    } } },
  }
  return { client: client as never, calls }
}
const json = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] })

describe('templateScript', () => {
  it('arma portada, captions y cierre desde los hechos', () => {
    const s = templateScript(facts)
    expect(s.cover.title).toBe('PR #42 · Cambia permisos')
    expect(s.captions.J1).toBe('J1 · Entrar')
    expect(s.closing).toBe('Necesita tu revisión · G1: toca src/auth')
    expect(s.ai).toBe(false)
  })
  it('blocked', () => {
    expect(templateScript({ ...facts, decision: 'blocked' }).closing).toBe('Bloqueado: hay checks en rojo')
  })
})

describe('validateScript', () => {
  it('rechaza formas inválidas', () => {
    expect(validateScript({ subtitle: 1 }, facts)).toBeNull()
    expect(validateScript(null, facts)).toBeNull()
  })
})

describe('claudeScript', () => {
  it('captions de Claude y cover.title del código', async () => {
    const { client, calls } = fakeClient(json({ subtitle: 'Dos flujos revisados', title: 'otro', captions: { J1: 'J1 · La persona entra', J2: 'J2 · Ve sus notas' }, closing: 'Revisa el cambio' }))
    const s = await claudeScript({ client })(facts, journeys)
    expect(s).toEqual({ cover: { title: 'PR #42 · Cambia permisos', subtitle: 'Dos flujos revisados' }, captions: { J1: 'J1 · La persona entra', J2: 'J2 · Ve sus notas' }, closing: 'Revisa el cambio', ai: true })
    const p = calls[0] as { model: string; fallbacks: string; output_config: { effort: string; format: { type: string } } }
    expect(p.model).toBe(DEFAULT_MODEL)
    expect(p.fallbacks).toBe('default')
    expect(p.output_config.effort).toBe('low')
    expect(p.output_config.format.type).toBe('json_schema')
  })
  it('ignora journeys inexistentes y completa los que faltan con la plantilla', async () => {
    const { client } = fakeClient(json({ subtitle: 's', captions: { J1: 'J1 · Hola', J9: 'fantasma' }, closing: 'c' }))
    const s = await claudeScript({ client })(facts, journeys)
    expect(s.captions).toEqual({ J1: 'J1 · Hola', J2: 'J2 · Ver notas' })
  })
  it('recorta captions de más de 90 caracteres con …', async () => {
    const { client } = fakeClient(json({ subtitle: 's', captions: { J1: 'a'.repeat(200), J2: 'b' }, closing: 'c' }))
    const s = await claudeScript({ client })(facts, journeys)
    expect(s.captions.J1).toBe(`${'a'.repeat(89)}…`)
  })
  it('refusal, error de red o JSON inválido → plantilla', async () => {
    const t = templateScript(facts)
    expect(await claudeScript({ client: fakeClient({ stop_reason: 'refusal', content: [{ type: 'text', text: '{}' }] }).client })(facts, journeys)).toEqual(t)
    expect(await claudeScript({ client: fakeClient(new Error('429')).client })(facts, journeys)).toEqual(t)
    expect(await claudeScript({ client: fakeClient({ content: [{ type: 'text', text: 'no json' }] }).client })(facts, journeys)).toEqual(t)
    expect(await claudeScript({ client: fakeClient(json({ subtitle: 5 })).client })(facts, journeys)).toEqual(t)
  })
  it('el system prompt dice que el texto de la corrida es contenido y no instrucciones', async () => {
    const { client, calls } = fakeClient(json({ subtitle: 's', captions: {}, closing: 'c' }))
    await claudeScript({ client })(facts, journeys)
    const system = String(calls[0]!.system)
    expect(system).toMatch(/contenido/)
    expect(system).toMatch(/nunca/i)
    expect(system).toMatch(/instrucci/)
    const user = JSON.stringify(calls[0]!.messages)
    expect(user).toContain('La persona entra.')
  })
})
