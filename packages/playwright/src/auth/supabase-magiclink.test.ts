import { describe, it, expect } from 'vitest'
import { magicLinkUrl } from './supabase-magiclink.js'

function fakeFetch() {
  const calls: Array<{ url: string; body: unknown; auth: string | null }> = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get('authorization') })
    if (url.endsWith('/admin/users')) return new Response(JSON.stringify({ msg: 'A user with this email address has already been registered' }), { status: 422 })
    return new Response(JSON.stringify({ hashed_token: 'h4sh', action_link: 'x' }), { status: 200 })
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe('magicLinkUrl', () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service' }

  it('crea el usuario (o acepta que ya existe) y arma la URL del callback', async () => {
    const { fn, calls } = fakeFetch()
    const url = await magicLinkUrl({ email: 'owner@example.com', baseURL: 'http://localhost:3000', callback: '/auth/dev-login', env, fetchFn: fn })
    expect(url).toBe('http://localhost:3000/auth/dev-login?token_hash=h4sh&type=magiclink')
    expect(calls[0]).toMatchObject({ url: 'http://127.0.0.1:54321/auth/v1/admin/users', body: { email: 'owner@example.com', email_confirm: true }, auth: 'Bearer service' })
    expect(calls[1]).toMatchObject({ url: 'http://127.0.0.1:54321/auth/v1/admin/generate_link', body: { type: 'magiclink', email: 'owner@example.com' } })
  })

  it('se niega contra un Supabase que no es local', async () => {
    const { fn } = fakeFetch()
    await expect(magicLinkUrl({ email: 'a@b.c', baseURL: 'http://localhost:3000', callback: '/cb', env: { ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' }, fetchFn: fn }))
      .rejects.toThrow(/solo contra Supabase local/)
  })

  it('no se deja engañar por hosts que empiezan como localhost', async () => {
    const { fn } = fakeFetch()
    for (const bad of ['http://localhost.evil.com', 'http://localhost@evil.com', 'http://127.0.0.1.nip.io', 'http://user@127.0.0.1:54321']) {
      await expect(magicLinkUrl({ email: 'a@b.c', baseURL: 'http://localhost:3000', callback: '/cb', env: { ...env, NEXT_PUBLIC_SUPABASE_URL: bad }, fetchFn: fn }))
        .rejects.toThrow(/solo contra Supabase local/)
    }
  })

  it('explica qué variable falta', async () => {
    await expect(magicLinkUrl({ email: 'a@b.c', baseURL: 'http://localhost:3000', callback: '/cb', env: {} }))
      .rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
