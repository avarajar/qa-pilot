import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium, type FullConfig } from '@playwright/test'
import { loadContract } from 'qa-pilot'
import { authFile, findRoot } from './config.js'
import { loginAs } from './auth/login.js'

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
      await loginAs(await context.newPage(), config, role)
      const file = authFile(root, role)
      mkdirSync(dirname(file), { recursive: true })
      await context.storageState({ path: file })
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
