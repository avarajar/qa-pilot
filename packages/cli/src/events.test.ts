import { describe, it, expect } from 'vitest'
import { prFromEvent, approvalFromEvent } from './events.js'

describe('eventos de GitHub', () => {
  it('pull_request: número de PR y etiqueta aplicada', () => {
    const ev = { action: 'labeled', number: 42, pull_request: { number: 42 }, label: { name: 'qa:approved' }, sender: { login: 'avarajar' } }
    expect(prFromEvent(ev)).toBe(42)
    expect(approvalFromEvent(ev)).toEqual({ action: 'labeled', actor: 'avarajar', label: 'qa:approved' })
  })
  it('issue_comment sobre un PR: número y comentario', () => {
    const ev = { action: 'created', issue: { number: 42, pull_request: { url: 'x' } }, comment: { id: 5, body: '/qa approve', user: { login: 'avarajar' } }, sender: { login: 'avarajar' } }
    expect(prFromEvent(ev)).toBe(42)
    expect(approvalFromEvent(ev)).toEqual({ action: 'created', actor: 'avarajar', comment: '/qa approve', commentId: 5 })
  })
  it('issue_comment sobre un issue que no es PR → sin PR', () => {
    expect(prFromEvent({ issue: { number: 3 } })).toBeNull()
  })
  it('otra acción → sin aprobación', () => {
    expect(approvalFromEvent({ action: 'synchronize', pull_request: { number: 1 }, sender: { login: 'x' } })).toBeNull()
  })
})
