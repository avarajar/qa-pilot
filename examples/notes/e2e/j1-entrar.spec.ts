import { test, expect } from '@qa-pilot/playwright'

test.describe('J1 · Entrar', { tag: '@J1' }, () => {
  test('con sesión ve la lista de notas', async ({ page, qa }) => {
    test.skip(qa.role === 'anon', 'sin sesión')
    await page.goto('/notes')
    await expect(page.getByRole('heading', { name: 'Notas' })).toBeVisible()
    await expect(page.getByRole('listitem')).toHaveCount(3)
    await qa.snap(page, 'notas')
    await qa.a11y(page)
  })

  test('al salir, /notes ya no deja entrar', async ({ page, qa }) => {
    test.skip(qa.role === 'anon', 'sin sesión')
    await page.goto('/notes')
    await page.getByRole('button', { name: 'Salir' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/notes')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('sin sesión /notes manda a /login', async ({ page, qa }) => {
    test.skip(qa.role !== 'anon', 'solo sin sesión')
    await page.goto('/notes')
    await expect(page).toHaveURL(/\/login$/)
    await qa.snap(page, 'login')
    await qa.a11y(page)
  })

  test('contraseña incorrecta muestra error y no entra', async ({ page, qa }) => {
    test.skip(qa.role !== 'anon', 'solo sin sesión')
    await page.goto('/login')
    await page.getByLabel('Correo').fill('user@notes.test')
    await page.getByLabel('Contraseña').fill('no-es')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.')
    await expect(page).toHaveURL(/\/login\?error=1$/)
  })
})
