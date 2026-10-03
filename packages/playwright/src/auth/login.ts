import type { Page } from '@playwright/test'
import type { QaConfig } from 'qa-pilot'
import { formLogin } from './form.js'
import { magicLinkUrl } from './supabase-magiclink.js'

// inicia sesión como el rol en el contexto de la página: lo usan el globalSetup y qa.login
export async function loginAs(page: Page, config: QaConfig, role: string): Promise<void> {
  const def = config.roles[role]
  if (!def) throw new Error(`El rol ${role} no está en qa/qa-pilot.yaml`)
  if (config.auth.adapter === 'supabase-magiclink') {
    await page.goto(await magicLinkUrl({ email: def.email, baseURL: config.app.url, callback: config.auth.callback ?? '/auth/callback' }))
    await page.waitForLoadState('networkidle')
    return
  }
  if (!config.auth.login_url || !config.auth.fields) throw new Error('auth.adapter form necesita login_url y fields')
  const password = def.password_env ? process.env[def.password_env] : undefined
  if (!password) throw new Error(`El rol ${role} necesita la contraseña en la variable ${def.password_env ?? '(password_env no definido)'}`)
  await formLogin(page, { loginUrl: config.auth.login_url, fields: config.auth.fields, email: def.email, password })
}
