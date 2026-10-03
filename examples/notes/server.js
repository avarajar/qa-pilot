import express from 'express'
import { randomBytes } from 'node:crypto'
import { users, verify, canDelete } from './auth.js'

const app = express()
app.use(express.urlencoded({ extended: false }))

const sessions = new Map()
let notes = [
  { id: 1, text: 'Revisar el contrato de qa/' },
  { id: 2, text: 'Grabar la demo' },
  { id: 3, text: 'Pedir feedback al equipo' },
]

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function currentUser(req) {
  const sid = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1]
  return sid ? sessions.get(sid) ?? null : null
}

const page = (title, body) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Notas</title>
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --fg: #1b1b1f; --muted: #55555e; --accent: #1d4ed8; --danger: #b42318; --line: #d4d4dc }
  @media (prefers-color-scheme: dark) { :root { --bg: #141417; --fg: #ececf1; --muted: #a7a7b3; --accent: #8ab4ff; --danger: #ff8a7a; --line: #34343c } }
  body { font: 16px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 24px 16px; }
  main { max-width: 560px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0 0 16px; }
  label { display: block; margin: 12px 0 4px; }
  input { font: inherit; width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--fg); }
  button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: var(--bg); cursor: pointer; }
  button.danger { background: transparent; color: var(--danger); border-color: var(--danger); padding: 4px 10px; }
  ul { list-style: none; padding: 0; } li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .muted { color: var(--muted); } .error { color: var(--danger); }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
</style></head><body><main>${body}</main></body></html>`

app.get('/', (req, res) => res.redirect(currentUser(req) ? '/notes' : '/login'))

app.get('/login', (req, res) => {
  const error = req.query.error ? '<p class="error" role="alert">Correo o contraseña incorrectos.</p>' : ''
  res.send(page('Entrar', `<h1>Entrar</h1>${error}
  <form method="post" action="/login">
    <label for="email">Correo</label><input id="email" name="email" type="email" autocomplete="username" required>
    <label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" required>
    <p><button type="submit">Entrar</button></p>
  </form>`))
})

app.post('/login', (req, res) => {
  const user = verify(users(), req.body.email, req.body.password)
  if (!user) return res.redirect('/login?error=1')
  const sid = randomBytes(16).toString('hex')
  sessions.set(sid, user)
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/`)
  res.redirect('/notes')
})

app.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/')
  res.redirect('/login')
})

app.get('/notes', (req, res) => {
  const user = currentUser(req)
  if (!user) return res.redirect('/login')
  const items = notes.map(n => `<li><span>${esc(n.text)}</span>${user
    ? `<form method="post" action="/notes/${n.id}/delete"><button class="danger" type="submit" aria-label="Borrar «${esc(n.text)}»">Borrar</button></form>` : ''}</li>`).join('')
  res.send(page('Notas', `<header><h1>Notas</h1><span class="muted">${esc(user.email)} · ${esc(user.role)}</span></header>
  <ul>${items || '<li class="muted">No hay notas.</li>'}</ul>
  <form method="post" action="/logout"><button type="submit">Salir</button></form>`))
})

app.post('/notes/:id/delete', (req, res) => {
  const user = currentUser(req)
  if (!user) return res.redirect('/login')
  if (!canDelete(user)) return res.status(403).send(page('Sin permiso', '<h1>Sin permiso</h1><p>Solo un admin puede borrar notas.</p>'))
  notes = notes.filter(n => String(n.id) !== req.params.id)
  res.redirect('/notes')
})

const port = Number(process.env.PORT ?? 3100)
app.listen(port, () => console.log(`notes en http://localhost:${port}`))
