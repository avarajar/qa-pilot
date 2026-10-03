import { describe, it, expect } from 'vitest'
import { baselinesCommand, playwrightVersion } from './baselines.js'

describe('baselines', () => {
  it('lee la versión de "npx playwright --version"', () => {
    expect(playwrightVersion('Version 1.63.0\n')).toBe('1.63.0')
    expect(playwrightVersion('nada')).toBeNull()
  })
  it('corre Playwright con --update-snapshots en la imagen oficial de la misma versión', () => {
    expect(baselinesCommand({ root: '/repo', appDir: '/repo/web', version: '1.63.0', e2e: 'npx playwright test' })).toEqual([
      'docker', 'run', '--rm', '--ipc=host', '--network=host',
      '-v', '/repo:/work', '-w', '/work/web', '-e', 'QA_PILOT_ROOT=/work', '-e', 'QA_PILOT_OUT=/work/qa-results',
      'mcr.microsoft.com/playwright:v1.63.0-noble',
      'bash', '-c', 'npx playwright test --update-snapshots',
    ])
  })
})
