import { describe, it, expect } from 'vitest'
import { claudeDescriber, DEFAULT_MODEL } from './describe.js'

function fakeClient(reply: { stop_reason?: string; content?: Array<{ type: string; text?: string }> } | Error) {
  const calls: Array<Record<string, unknown>> = []
  const client = {
    beta: {
      messages: {
        async create(params: Record<string, unknown>) {
          calls.push(params)
          if (reply instanceof Error) throw reply
          return { stop_reason: 'end_turn', content: [], ...reply }
        },
      },
    },
  }
  return { client: client as never, calls }
}

const input = { expected: Buffer.from('antes'), actual: Buffer.from('despues'), zone: 'arriba a la derecha', elements: ['botón «Borrar» ×3'] }

describe('claudeDescriber', () => {
  it('manda las dos capturas en orden, con la zona y los elementos, y devuelve una frase limpia', async () => {
    const { client, calls } = fakeClient({ content: [{ type: 'thinking' }, { type: 'text', text: '  Los botones «Borrar»\npasaron de rojo a verde.  ' }] })
    expect(await claudeDescriber({ client })(input)).toBe('Los botones «Borrar» pasaron de rojo a verde.')
    const p = calls[0] as { model: string; fallbacks: string; messages: Array<{ content: Array<{ type: string; text?: string; source?: { data: string } }> }> }
    expect(p.model).toBe(DEFAULT_MODEL)
    expect(p.fallbacks).toBe('default')
    const c = p.messages[0]!.content
    expect(c.map(b => b.type)).toEqual(['text', 'image', 'text', 'image', 'text'])
    expect(c[1]!.source!.data).toBe(Buffer.from('antes').toString('base64'))
    expect(c[4]!.text).toBe('La zona que cambió está arriba a la derecha. Elementos en esa zona: botón «Borrar» ×3.')
  })

  it('si el modelo declina, falla la llamada o no hay texto → null', async () => {
    expect(await claudeDescriber({ client: fakeClient({ stop_reason: 'refusal', content: [{ type: 'text', text: 'no' }] }).client })(input)).toBeNull()
    expect(await claudeDescriber({ client: fakeClient(new Error('429')).client })(input)).toBeNull()
    expect(await claudeDescriber({ client: fakeClient({ content: [] }).client })(input)).toBeNull()
  })

  it('recorta una respuesta demasiado larga', async () => {
    const { client } = fakeClient({ content: [{ type: 'text', text: 'a'.repeat(500) }] })
    expect((await claudeDescriber({ client })(input))!.length).toBe(200)
  })
})
