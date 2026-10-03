import type { Page } from '@playwright/test'

export async function formLogin(page: Page, opts: { loginUrl: string; fields: { email: string; password: string; submit: string }; email: string; password: string }): Promise<void> {
  await page.goto(opts.loginUrl)
  await page.locator(opts.fields.email).fill(opts.email)
  await page.locator(opts.fields.password).fill(opts.password)
  await Promise.all([page.waitForLoadState('networkidle'), page.locator(opts.fields.submit).click()])
}
