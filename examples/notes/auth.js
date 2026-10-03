// Usuarios y reglas de la app de ejemplo. Este archivo está en qa/protected-paths:
// cualquier cambio aquí escala a un humano.
import { timingSafeEqual } from 'node:crypto'

export function users(env = process.env) {
  return [
    { email: 'admin@notes.test', role: 'admin', password: env.NOTES_ADMIN_PASSWORD },
    { email: 'user@notes.test', role: 'user', password: env.NOTES_USER_PASSWORD },
  ].filter(u => u.password)
}

const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export function verify(list, email, password) {
  const u = list.find(x => x.email === email)
  return u && typeof password === 'string' && same(u.password, password) ? { email: u.email, role: u.role } : null
}

export function canDelete(user) {
  return user?.role === 'admin'
}
