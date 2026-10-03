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

  describe('enableAutoMerge', () => {
    function graphqlFetch(errors?: Array<{ message: string }>) {
      const calls: Array<{ method: string; url: string; body?: unknown }> = []
      const fn = (async (url: string, init?: RequestInit) => {
        calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
        const json = url.endsWith('/graphql') ? { data: {}, ...(errors ? { errors } : {}) } : { merged: true }
        return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
      }) as unknown as typeof fetch
      return { fn, calls }
    }
    const pr = { number: 7, nodeId: 'PR_node', sha: 'abc123' }

    it('si GitHub acepta el auto-merge, no hace nada más', async () => {
      const { fn, calls } = graphqlFetch()
      await restGitHub({ repo: 'o/r', token: 't', fetchFn: fn }).enableAutoMerge(pr)
      expect(calls.map(c => c.url)).toEqual(['https://api.github.com/graphql'])
    })

    it.each(['clean', 'unstable'])('si el PR ya se puede mergear (%s), lo mergea directo y solo ese SHA', async state => {
      const { fn, calls } = graphqlFetch([{ message: `Pull request Pull request is in ${state} status` }])
      await restGitHub({ repo: 'o/r', token: 't', fetchFn: fn }).enableAutoMerge(pr)
      expect(calls.at(-1)).toEqual({
        method: 'PUT',
        url: 'https://api.github.com/repos/o/r/pulls/7/merge',
        body: { merge_method: 'squash', sha: 'abc123' },
      })
    })

    it('otros errores (p. ej. auto-merge deshabilitado) no intentan mergear', async () => {
      const { fn, calls } = graphqlFetch([{ message: 'Auto merge is not allowed for this repository' }])
      await restGitHub({ repo: 'o/r', token: 't', fetchFn: fn }).enableAutoMerge(pr)
      expect(calls.map(c => c.method)).toEqual(['POST'])
    })
  })
})
