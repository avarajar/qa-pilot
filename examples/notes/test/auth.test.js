import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verify, canDelete, users } from '../auth.js'

const env = { NOTES_ADMIN_PASSWORD: 'a', NOTES_USER_PASSWORD: 'u' }

test('verify acepta la contraseña correcta y devuelve el usuario', () => {
  assert.deepEqual(verify(users(env), 'admin@notes.test', 'a'), { email: 'admin@notes.test', role: 'admin' })
})

test('verify rechaza contraseña incorrecta o usuario desconocido', () => {
  assert.equal(verify(users(env), 'admin@notes.test', 'u'), null)
  assert.equal(verify(users(env), 'nadie@notes.test', 'a'), null)
})

test('solo admin puede borrar notas', () => {
  assert.equal(canDelete({ role: 'admin' }), true)
  assert.equal(canDelete({ role: 'user' }), false)
  assert.equal(canDelete(null), false)
})
