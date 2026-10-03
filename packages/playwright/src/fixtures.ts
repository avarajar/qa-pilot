import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'

export type Qa = {
  role: string
  snap(page: Page, name: string, opts?: { mask?: Locator[] }): Promise<void>
  a11y(page: Page): Promise<void>
}

export const test = base.extend<{ qa: Qa }, { qaRole: string }>({
  qaRole: ['anon', { option: true, scope: 'worker' }],
  qa: async ({ qaRole }, use) => {
    await use({
      role: qaRole,
      async snap(page, name, opts = {}) {
        // claro y oscuro; soft para que un cambio en un tema no oculte el otro
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
          await expect.soft(page).toHaveScreenshot(`${name}-${colorScheme}.png`, {
            animations: 'disabled', caret: 'hide', fullPage: true, mask: opts.mask ?? [], maxDiffPixels: 8,
          })
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
