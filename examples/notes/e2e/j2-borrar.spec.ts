import { test, expect } from '@qa-pilot/playwright'

test.describe('J2 · Solo admin borra', { tag: '@J2' }, () => {
  test('el usuario no ve Borrar y el POST directo da 403', async ({ page, qa }) => {
    test.skip(qa.role !== 'user', 'solo user')
    await page.goto('/notes')
    await expect(page.getByRole('button', { name: /Borrar/ })).toHaveCount(0)
    const res = await page.request.post('/notes/1/delete')
    expect(res.status()).toBe(403)
  })

  test('el admin ve Borrar en cada nota', async ({ page, qa }) => {
    test.skip(qa.role !== 'admin', 'solo admin')
    await page.goto('/notes')
    await expect(page.getByRole('button', { name: /Borrar/ })).toHaveCount(3)
  })
})
