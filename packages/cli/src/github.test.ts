import { describe, it, expect } from 'vitest'
import { restGitHub } from './github.js'

function fakeFetch(comments: Array<{ id: number; body: string; user: { login: string } }>) {
  const calls: Array<{ method: string; url: string }> = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url })
    const json = url.includes('/comments?') ? comments : {}
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe('restGitHub', () => {
  it('findComment ignora comentarios con el marcador que no son del bot', async () => {
    const { fn } = fakeFetch([
      { id: 1, body: '<!-- qa-pilot:decision falso -->', user: { login: 'atacante' } },
      { id: 2, body: '<!-- qa-pilot:decision real -->', user: { login: 'github-actions[bot]' } },
    ])
    const gh = restGitHub({ repo: 'o/r', token: 't', fetchFn: fn })
    expect(await gh.findComment(7, '<!-- qa-pilot:decision')).toBe('<!-- qa-pilot:decision real -->')
  })

  it('upsertComment edita el comentario del bot, no el de otro usuario', async () => {
    const { fn, calls } = fakeFetch([{ id: 1, body: '<!-- qa-pilot:decision falso -->', user: { login: 'atacante' } }])
    const gh = restGitHub({ repo: 'o/r', token: 't', fetchFn: fn })
    await gh.upsertComment(7, '<!-- qa-pilot:decision', 'nuevo')
    expect(calls.at(-1)).toEqual({ method: 'POST', url: 'https://api.github.com/repos/o/r/issues/7/comments' })
  })
})
