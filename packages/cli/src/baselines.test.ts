import { describe, it, expect } from 'vitest'
import { dockerize, playwrightVersion } from './baselines.js'

describe('baselines', () => {
  it('lee la versión de "npx playwright --version"', () => {
    expect(playwrightVersion('Version 1.63.0\n')).toBe('1.63.0')
    expect(playwrightVersion('nada')).toBeNull()
  })
  it('envuelve un comando en la imagen oficial de Playwright, con el repo montado en la misma ruta', () => {
    expect(dockerize("pnpm exec playwright test --update-snapshots", { mount: '/repo dir', cwd: '/repo dir/examples/notes', version: '1.63.0', env: ['QA_PILOT_OUT', 'NOTES_ADMIN_PASSWORD'] }))
      .toBe("docker run --rm --ipc=host --network=host -v '/repo dir':'/repo dir' -w '/repo dir/examples/notes' -e QA_PILOT_OUT -e NOTES_ADMIN_PASSWORD mcr.microsoft.com/playwright:v1.63.0-noble bash -c 'pnpm exec playwright test --update-snapshots'")
  })
})
