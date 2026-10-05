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

  describe('uploadEvidence', () => {
    function gitFetch(opts: { branch?: string; conflicts?: number } = {}) {
      const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = []
      let conflicts = opts.conflicts ?? 0
      const fn = (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        calls.push({ method, url, body })
        const ok = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
        if (url.endsWith('/git/ref/heads/qa-pilot/evidence')) return opts.branch ? ok({ object: { sha: opts.branch } }) : ok({ message: 'Not Found' }, 404)
        if (url.includes('/git/commits/') && method === 'GET') return ok({ tree: { sha: 'tree-padre' } })
        if (url.endsWith('/git/blobs')) return ok({ sha: `blob-${calls.length}` })
        if (url.endsWith('/git/trees')) return ok({ sha: 'tree-nuevo' })
        if (url.endsWith('/git/commits')) return ok({ sha: 'commit-nuevo' })
        if (url.endsWith('/git/refs/heads/qa-pilot/evidence') && conflicts-- > 0) return ok({ message: 'Update is not a fast forward' }, 422)
        return ok({})
      }) as unknown as typeof fetch
      return { fn, calls }
    }
    const files = [{ path: 'pr-7/abc/artifacts/a.png', content: Buffer.from('png') }]

    it('crea la rama si no existe y devuelve la URL de las imágenes en ese commit', async () => {
      const { fn, calls } = gitFetch()
      const base = await restGitHub({ repo: 'o/r', token: 't', fetchFn: fn }).uploadEvidence(files, 'msg')
      expect(base).toBe('https://github.com/o/r/raw/commit-nuevo/')
      expect(calls.find(c => c.url.endsWith('/git/blobs'))!.body).toEqual({ content: Buffer.from('png').toString('base64'), encoding: 'base64' })
      expect(calls.find(c => c.url.endsWith('/git/trees'))!.body).toEqual({ tree: [{ path: 'pr-7/abc/artifacts/a.png', mode: '100644', type: 'blob', sha: 'blob-1' }] })
      expect(calls.find(c => c.url.endsWith('/git/commits'))!.body).toEqual({ message: 'msg', tree: 'tree-nuevo', parents: [] })
      expect(calls.at(-1)).toMatchObject({ method: 'POST', url: 'https://api.github.com/repos/o/r/git/refs', body: { ref: 'refs/heads/qa-pilot/evidence', sha: 'commit-nuevo' } })
    })

    it('si la rama existe agrega encima, y reintenta si otro PR la movió', async () => {
      const { fn, calls } = gitFetch({ branch: 'padre', conflicts: 1 })
      await restGitHub({ repo: 'o/r', token: 't', fetchFn: fn, web: 'https://ghe.test' }).uploadEvidence(files, 'msg')
      expect(calls.find(c => c.url.endsWith('/git/trees'))!.body).toMatchObject({ base_tree: 'tree-padre' })
      expect(calls.find(c => c.url.endsWith('/git/commits'))!.body).toMatchObject({ parents: ['padre'] })
      const updates = calls.filter(c => c.method === 'PATCH')
      expect(updates).toHaveLength(2)
      expect(updates[0]!.body).toEqual({ sha: 'commit-nuevo', force: false })
    })
  })
})
