import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { loadContract } from 'qa-pilot'
import { loginAs } from './auth/login.js'
import { findRoot } from './config.js'
import { collectElements } from './visual.js'

export type Qa = {
  role: string
  snap(page: Page, name: string, opts?: { mask?: Locator[] }): Promise<void>
  a11y(page: Page): Promise<void>
  // sesión nueva solo para este test: para tests que salen o invalidan la sesión, que la
  // compartida (storageState del rol) la usan los demás tests en paralelo
  login(page: Page): Promise<void>
}

export const test = base.extend<{ qa: Qa; qaIsolationHeader: string | undefined }, { qaRole: string }>({
  qaRole: ['anon', { option: true, scope: 'worker' }],
  qaIsolationHeader: [undefined, { option: true }],
  extraHTTPHeaders: async ({ extraHTTPHeaders, qaIsolationHeader }, use, testInfo) => {
    // con reintento cambia el id: el reintento no hereda lo que dejó el intento fallido
    await use(qaIsolationHeader ? { ...extraHTTPHeaders, [qaIsolationHeader]: `${testInfo.testId}-${testInfo.retry}` } : extraHTTPHeaders)
  },
  qa: async ({ qaRole }, use) => {
    await use({
      role: qaRole,
      async login(page) {
        if (qaRole === 'anon') throw new Error('qa.login: el rol anon no tiene sesión')
        await page.context().clearCookies()
        await loginAs(page, loadContract(findRoot()).config, qaRole)
      },
      async snap(page, name, opts = {}) {
        // claro y oscuro; soft para que un cambio en un tema no oculte el otro
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
          const before = test.info().errors.length
          await expect.soft(page).toHaveScreenshot(`${name}-${colorScheme}.png`, {
            animations: 'disabled', caret: 'hide', fullPage: true, mask: opts.mask ?? [], maxDiffPixels: 8,
          })
          // si la captura cambió, qué hay en la página y dónde: el reporter nombra lo que cae en la zona
          if (test.info().errors.length > before) {
            const elements = await page.evaluate(collectElements).catch(() => [])
            await test.info().attach(`${name}-${colorScheme}-elements.json`, { body: JSON.stringify(elements), contentType: 'application/json' })
          }
        }
        await page.emulateMedia({ colorScheme: null })
      },
      async a11y(page) {
        const { violations } = await new AxeBuilder({ page }).analyze()
        const serious = violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
        if (serious.length) {
          throw new Error(`a11y: ${serious.length} violaciones graves: ${serious.map(v => `${v.id} (${v.nodes.length})`).join(', ')}`)
        }
      },
    })
  },
})

export { expect }
