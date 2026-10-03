import { describe, it, expect } from 'vitest'
import { realProc } from './proc.js'

describe('realProc.sh', () => {
  it('el timeout mata también a los nietos y devuelve 124 sin esperar los pipes', async () => {
    const t0 = Date.now()
    const r = await realProc.sh('sleep 30 & sleep 30; wait', { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' }, timeoutS: 1, quiet: true })
    expect(r.code).toBe(124)
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(r.out).toMatch(/timeout/i)
  })
})
