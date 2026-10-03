import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PlaywrightTestConfig, Project } from '@playwright/test'
import { loadContract, type QaContract } from 'qa-pilot'

export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const

export function findRoot(from = process.cwd()): string {
  if (process.env.QA_PILOT_ROOT) return resolve(process.env.QA_PILOT_ROOT)
  let dir = resolve(from)
  while (true) {
    if (existsSync(join(dir, 'qa', 'qa-pilot.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error('No encuentro qa/qa-pilot.yaml subiendo desde ' + from)
    dir = parent
  }
}

export function outDir(root: string): string {
  return process.env.QA_PILOT_OUT ? resolve(process.env.QA_PILOT_OUT) : join(root, 'qa-results')
}

export const authFile = (root: string, role: string) => join(outDir(root), '.auth', `${role}.json`)

export function contract(opts: { root?: string } = {}): QaContract {
  return loadContract(opts.root ?? findRoot())
}

// isolationHeader: cada test manda ese header con un id propio, para que la app separe sus datos
// por test (los tests corren en paralelo contra el mismo servidor). Opt-in: un header propio en
// peticiones a otros dominios puede romper CORS.
export function defineQaConfig(overrides: PlaywrightTestConfig = {}, opts: { root?: string; isolationHeader?: string } = {}): PlaywrightTestConfig {
  const root = opts.root ?? findRoot()
  const { config } = loadContract(root)
  // el globalSetup corre en este mismo proceso y lee la raíz de aquí
  process.env.QA_PILOT_ROOT = root

  const projects: Project[] = []
  for (const [role, def] of Object.entries(config.roles)) {
    for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
      projects.push({
        name: `${role}-${vp}`,
        use: {
          viewport,
          ...(def.expect === 'rejected' ? {} : { storageState: authFile(root, role) }),
          qaRole: role,
        } as Project['use'],
      })
    }
  }
  if (projects.length === 0) {
    for (const [vp, viewport] of Object.entries(VIEWPORTS)) projects.push({ name: vp, use: { viewport } })
  }

  return {
    testDir: 'e2e',
    retries: 1,
    fullyParallel: true,
    snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
    reporter: [['list'], ['@qa-pilot/playwright/reporter', { outputDir: outDir(root) }]],
    globalSetup: fileURLToPath(new URL('./global-setup.js', import.meta.url)),
    outputDir: join(outDir(root), 'playwright'),
    ...overrides,
    use: {
      baseURL: config.app.url, reducedMotion: 'reduce', trace: 'retain-on-failure',
      ...(opts.isolationHeader ? { qaIsolationHeader: opts.isolationHeader } : {}),
      ...overrides.use,
    } as PlaywrightTestConfig['use'],
    projects: overrides.projects ?? projects,
  }
}
