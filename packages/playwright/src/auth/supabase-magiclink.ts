// Inicia sesión con un magic link generado con la service role de un Supabase LOCAL.
// Nunca contra la nube: la service role salta RLS.
type Env = Record<string, string | undefined>

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', 'host.docker.internal', '[::1]'])

// se compara el hostname ya parseado: un prefijo como "localhost.evil.com" no pasa
function isLocal(raw: string): boolean {
  try {
    const u = new URL(raw)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && LOCAL_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

export async function magicLinkUrl(opts: { email: string; baseURL: string; callback: string; env?: Env; fetchFn?: typeof fetch }): Promise<string> {
  const env = opts.env ?? process.env
  const f = opts.fetchFn ?? fetch
  const supabase = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabase || !key) throw new Error('supabase-magiclink necesita NEXT_PUBLIC_SUPABASE_URL (o SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY')
  if (!isLocal(supabase)) throw new Error(`supabase-magiclink funciona solo contra Supabase local; recibí ${supabase}`)

  const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  const created = await f(`${supabase}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify({ email: opts.email, email_confirm: true }) })
  if (!created.ok && created.status !== 422) throw new Error(`No pude crear ${opts.email}: ${created.status} ${await created.text()}`)

  const link = await f(`${supabase}/auth/v1/admin/generate_link`, { method: 'POST', headers, body: JSON.stringify({ type: 'magiclink', email: opts.email }) })
  if (!link.ok) throw new Error(`No pude generar el magic link de ${opts.email}: ${link.status} ${await link.text()}`)
  const data = (await link.json()) as { hashed_token?: string; properties?: { hashed_token?: string } }
  const hash = data.hashed_token ?? data.properties?.hashed_token
  if (!hash) throw new Error('generate_link no devolvió hashed_token')

  const url = new URL(opts.callback, opts.baseURL)
  url.searchParams.set('token_hash', hash)
  url.searchParams.set('type', 'magiclink')
  return url.toString()
}
