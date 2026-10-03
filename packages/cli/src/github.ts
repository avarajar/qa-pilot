export interface GitHub {
  getPr(n: number): Promise<{ number: number; headSha: string; labels: string[]; nodeId: string }>
  setLabels(n: number, add: string[], remove: string[]): Promise<void>
  upsertComment(n: number, marker: string, body: string): Promise<void>
  findComment(n: number, marker: string): Promise<string | null>
  setStatus(sha: string, state: 'success' | 'pending' | 'failure', description: string): Promise<void>
  enableAutoMerge(nodeId: string): Promise<void>
}

export const STATUS_CONTEXT = 'qa-pilot/decision'

// solo cuenta el comentario que escribió el bot de Actions: cualquiera puede comentar el marcador en un PR
export const BOT_LOGIN = 'github-actions[bot]'

export function restGitHub(opts: { repo: string; token: string; api?: string; fetchFn?: typeof fetch; botLogin?: string }): GitHub {
  const api = opts.api ?? 'https://api.github.com'
  const f = opts.fetchFn ?? fetch
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await f(`${api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${opts.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
      throw new Error(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`)
    }
    return (res.status === 204 ? undefined : await res.json()) as T
  }
  const repo = `/repos/${opts.repo}`
  type Comment = { id: number; body: string; user: { login: string } }
  const bot = opts.botLogin ?? BOT_LOGIN

  async function comments(n: number): Promise<Comment[]> {
    return (await call<Comment[]>('GET', `${repo}/issues/${n}/comments?per_page=100`)).filter(c => c.user?.login === bot)
  }

  return {
    async getPr(n) {
      const pr = await call<{ number: number; node_id: string; head: { sha: string }; labels: Array<{ name: string }> }>('GET', `${repo}/pulls/${n}`)
      return { number: pr.number, headSha: pr.head.sha, labels: pr.labels.map(l => l.name), nodeId: pr.node_id }
    },
    async setLabels(n, add, remove) {
      for (const name of remove) await call('DELETE', `${repo}/issues/${n}/labels/${encodeURIComponent(name)}`)
      if (add.length) await call('POST', `${repo}/issues/${n}/labels`, { labels: add })
    },
    async upsertComment(n, marker, body) {
      const existing = (await comments(n)).find(c => c.body.includes(marker))
      if (existing) await call('PATCH', `${repo}/issues/comments/${existing.id}`, { body })
      else await call('POST', `${repo}/issues/${n}/comments`, { body })
    },
    async findComment(n, marker) {
      return (await comments(n)).find(c => c.body.includes(marker))?.body ?? null
    },
    async setStatus(sha, state, description) {
      await call('POST', `${repo}/statuses/${sha}`, { state, context: STATUS_CONTEXT, description: description.slice(0, 140) })
    },
    async enableAutoMerge(nodeId) {
      const query = 'mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) { clientMutationId } }'
      const res = await call<{ errors?: Array<{ message: string }> }>('POST', '/graphql', { query, variables: { id: nodeId } })
      // si el repo no tiene auto-merge habilitado, GitHub responde con errors; no es fatal para la decisión
      if (res.errors?.length) console.error(`qa-pilot: no se pudo activar auto-merge: ${res.errors.map(e => e.message).join('; ')}`)
    },
  }
}
