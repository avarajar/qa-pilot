export interface GitHub {
  getPr(n: number): Promise<{ number: number; headSha: string; labels: string[]; nodeId: string }>
  setLabels(n: number, add: string[], remove: string[]): Promise<void>
  upsertComment(n: number, marker: string, body: string): Promise<void>
  findComment(n: number, marker: string): Promise<string | null>
  setStatus(sha: string, state: 'success' | 'pending' | 'failure', description: string): Promise<void>
  // sha: el commit que se evaluó; si el PR ya se puede mergear, se mergea solo si el head sigue ahí
  enableAutoMerge(pr: { number: number; nodeId: string; sha: string }): Promise<void>
  react(commentId: number, content: '+1' | '-1'): Promise<void>
  comment(n: number, body: string): Promise<void>
  // sube archivos a la rama de evidencia en un commit; devuelve la URL base de esos archivos en ese commit
  uploadEvidence(files: Array<{ path: string; content: Buffer }>, message: string): Promise<string>
}

// rama aparte, sin historia del código: solo guarda las capturas que muestran los comentarios
export const EVIDENCE_BRANCH = 'qa-pilot/evidence'

export const STATUS_CONTEXT = 'qa-pilot/decision'

// solo cuenta el comentario que escribió el bot de Actions: cualquiera puede comentar el marcador en un PR
export const BOT_LOGIN = 'github-actions[bot]'

export function restGitHub(opts: { repo: string; token: string; api?: string; web?: string; fetchFn?: typeof fetch; botLogin?: string }): GitHub {
  const api = opts.api ?? 'https://api.github.com'
  const web = opts.web ?? 'https://github.com'
  const f = opts.fetchFn ?? fetch
  async function call<T>(method: string, path: string, body?: unknown, allow404 = false): Promise<T> {
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
    if (res.status === 404 && allow404) return null as T
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
    async react(commentId, content) {
      await call('POST', `${repo}/issues/comments/${commentId}/reactions`, { content })
    },
    async comment(n, body) {
      await call('POST', `${repo}/issues/${n}/comments`, { body })
    },
    async uploadEvidence(files, message) {
      const tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = []
      for (const f of files) {
        const blob = await call<{ sha: string }>('POST', `${repo}/git/blobs`, { content: f.content.toString('base64'), encoding: 'base64' })
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha })
      }
      // varios PRs publican a la vez: si otro movió la rama entre leerla y actualizarla, se arma encima de nuevo
      for (let attempt = 1; ; attempt++) {
        const head = await call<{ object: { sha: string } } | null>('GET', `${repo}/git/ref/heads/${EVIDENCE_BRANCH}`, undefined, true)
        const parent = head?.object.sha
        const baseTree = parent ? (await call<{ tree: { sha: string } }>('GET', `${repo}/git/commits/${parent}`)).tree.sha : undefined
        const t = await call<{ sha: string }>('POST', `${repo}/git/trees`, { ...(baseTree ? { base_tree: baseTree } : {}), tree })
        const commit = await call<{ sha: string }>('POST', `${repo}/git/commits`, { message, tree: t.sha, parents: parent ? [parent] : [] })
        try {
          if (parent) await call('PATCH', `${repo}/git/refs/heads/${EVIDENCE_BRANCH}`, { sha: commit.sha, force: false })
          else await call('POST', `${repo}/git/refs`, { ref: `refs/heads/${EVIDENCE_BRANCH}`, sha: commit.sha })
          return `${web}/${opts.repo}/raw/${commit.sha}/`
        } catch (e) {
          if (attempt >= 3) throw e
        }
      }
    },
    async enableAutoMerge(pr) {
      const query = 'mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) { clientMutationId } }'
      const res = await call<{ errors?: Array<{ message: string }> }>('POST', '/graphql', { query, variables: { id: pr.nodeId } })
      if (!res.errors?.length) return
      const why = res.errors.map(e => e.message).join('; ')
      // GitHub solo activa auto-merge si al PR le falta algo; si ya se puede mergear (el status que
      // acabamos de poner era lo último), responde "clean/unstable status" y hay que mergear directo
      if (/\b(clean|unstable) status\b/.test(why)) {
        try {
          await call('PUT', `${repo}/pulls/${pr.number}/merge`, { merge_method: 'squash', sha: pr.sha })
        } catch (e) {
          console.error(`qa-pilot: no se pudo mergear: ${(e as Error).message}`)
        }
        return
      }
      // si el repo no tiene auto-merge habilitado, GitHub responde con errors; no es fatal para la decisión
      console.error(`qa-pilot: no se pudo activar auto-merge: ${why}`)
    },
  }
}
