import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium, type FullConfig } from '@playwright/test'
import { loadContract } from 'qa-pilot'
import { authFile, findRoot } from './config.js'
import { formLogin } from './auth/form.js'
import { magicLinkUrl } from './auth/supabase-magiclink.js'

// Inicia sesión una vez por rol y guarda el storageState que usan los proyectos.
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const root = findRoot()
  const { config } = loadContract(root)
  const { adapter } = config.auth
  if (adapter === 'none') return
  const browser = await chromium.launch()
  try {
    for (const [role, def] of Object.entries(config.roles)) {
      if (def.expect === 'rejected') continue
      const context = await browser.newContext({ baseURL: config.app.url })
      const page = await context.newPage()
      if (adapter === 'supabase-magiclink') {
        await page.goto(await magicLinkUrl({ email: def.email, baseURL: config.app.url, callback: config.auth.callback ?? '/auth/callback' }))
        await page.waitForLoadState('networkidle')
      } else {
        if (!config.auth.login_url || !config.auth.fields) throw new Error('auth.adapter form necesita login_url y fields')
        const password = def.password_env ? process.env[def.password_env] : undefined
        if (!password) throw new Error(`El rol ${role} necesita la contraseña en la variable ${def.password_env ?? '(password_env no definido)'}`)
        await formLogin(page, { loginUrl: config.auth.login_url, fields: config.auth.fields, email: def.email, password })
      }
      const file = authFile(root, role)
      mkdirSync(dirname(file), { recursive: true })
      await context.storageState({ path: file })
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
