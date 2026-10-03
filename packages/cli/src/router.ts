import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import picomatch from 'picomatch'
import type { Diff } from './diff.js'
import type { CheckResult, Decision, Gate, QaContract } from './types.js'

const ORACLE_GLOBS = [
  'qa/**', 'e2e/**', '**/e2e/**', '**/__screenshots__/**', '**/*-snapshots/**',
  '**/playwright.config.*', 'playwright.config.*', '**/vitest.config.*', 'vitest.config.*',
]

// G2: lo que cambia cómo corre el CI, para cualquier proyecto del repo
const CI_GLOBS = ['.github/**', '.gitlab-ci.yml', '.circleci/**', '.buildkite/**']

export const MAX_FINDINGS = 50

// en protected-paths, ()[] son literales: rutas de Next como app/(app)/celdas/[slug]
const literal = (glob: string) => glob.replace(/[()[\]]/g, c => `\\${c}`)

// semántica tipo gitignore: "/x" anclado a la raíz, "x/" o "x" sin glob = carpeta completa,
// un nombre sin "/" coincide en cualquier nivel
export function expandProtected(pattern: string): string[] {
  const anchored = pattern.startsWith('/')
  let p = pattern.replace(/^\/+/, '')
  const dirOnly = p.endsWith('/')
  p = p.replace(/\/+$/, '')
  if (!p) return []
  const hasGlob = /[*?{]/.test(p)
  const forms = dirOnly ? [`${p}/**`] : hasGlob ? [p] : [p, `${p}/**`]
  const out = forms.map(literal)
  if (!anchored && !p.includes('/')) out.push(...forms.map(f => `**/${literal(f)}`))
  return out
}

function matcher(globs: string[]): (path: string) => boolean {
  if (globs.length === 0) return () => false
  return picomatch(globs, { dot: true })
}

export function readResults(dir: string): { results: CheckResult[]; errors: string[] } {
  const results: CheckResult[] = []
  const errors: string[] = []
  let names: string[] = []
  try {
    names = readdirSync(dir).filter(n => n.endsWith('.json') && n !== 'decision.json').sort()
  } catch {
    return { results, errors }
  }
  for (const name of names) {
    try {
      const data = JSON.parse(readFileSync(join(dir, name), 'utf8')) as CheckResult
      if (typeof data.check !== 'string' || !['pass', 'fail', 'warn'].includes(data.status) || !Array.isArray(data.findings)) {
        errors.push(`${name}: no tiene la forma de un resultado`)
        continue
      }
      results.push(data)
    } catch {
      errors.push(`${name}: JSON inválido`)
    }
  }
  return { results, errors }
}

export function route(input: {
  contract: QaContract
  results: CheckResult[]
  diff: Diff
  sha: string
  expectedChecks: string[]
  errors?: string[]
}): Decision {
  const { contract, results, diff, sha, expectedChecks } = input
  const { router } = contract.config
  const gates: Gate[] = []

  for (const e of input.errors ?? []) gates.push({ id: 'ERR', reason: e })
  const missing = expectedChecks.filter(c => !results.some(r => r.check === c))
  if (missing.length) gates.push({ id: 'ERR', reason: `Sin resultado de: ${missing.join(', ')}` })

  const paths = diff.files.flatMap(f => (f.from ? [f.path, f.from] : [f.path]))

  const isProtected = matcher(contract.protectedPaths.flatMap(expandProtected))
  const hitProtected = [...new Set(paths.filter(isProtected))]
  if (hitProtected.length) gates.push({ id: 'G1', reason: hitProtected.join(', ') })

  // con el proyecto en una subcarpeta, los archivos de la raíz del repo (lockfiles, package.json del
  // workspace) le afectan sin verse en su diff; con el proyecto en la raíz eso ya es protected-paths
  if (diff.repo) {
    const isSensitive = matcher(diff.repo.prefix ? [...CI_GLOBS, '*'] : CI_GLOBS)
    const hitSensitive = diff.repo.paths.filter(isSensitive)
    if (hitSensitive.length) gates.push({ id: 'G2', reason: hitSensitive.join(', ') })
  }

  const isOracle = matcher(ORACLE_GLOBS)
  const hitOracle = [...new Set(paths.filter(isOracle))]
  if (hitOracle.length) gates.push({ id: 'G3', reason: hitOracle.join(', ') })

  const findings = results.flatMap(r => r.findings.map(f => ({ ...f, check: r.check })))

  const journeyHits = findings.filter(f =>
    (f.kind === 'visual-diff' && (f.journey || router.visual_diff === 'escalate')) ||
    (f.kind === 'flaky' && f.journey && router.flaky_in_journey === 'escalate'),
  )
  if (journeyHits.length) {
    gates.push({ id: 'G4', reason: journeyHits.map(f => `${f.journey ?? 'fuera de journeys'}: ${f.message}`).join('; ') })
  }

  const added = diff.files.reduce((n, f) => n + f.added, 0)
  const removed = diff.files.reduce((n, f) => n + f.removed, 0)
  if (added + removed > router.auto_max_lines) {
    gates.push({ id: 'G5', reason: `${added + removed} líneas cambiadas (máximo ${router.auto_max_lines})` })
  }

  const security = findings.filter(f => f.kind === 'security')
  if (security.length) gates.push({ id: 'SEC', reason: security.map(f => `${f.check}: ${f.message}`).join('; ') })

  const ai = results.find(r => r.check === 'ai-review')
  if (ai && ai.status !== 'pass') gates.push({ id: 'AI', reason: ai.findings.map(f => f.message).join('; ') || 'el revisor IA marcó riesgo' })

  const blocked = results.some(r => r.status === 'fail' && r.check !== 'ai-review')
  return {
    version: 1,
    decision: blocked ? 'blocked' : gates.length ? 'escalate' : 'auto',
    sha,
    gates,
    diff: { files: diff.files.length, added, removed },
    checks: Object.fromEntries(results.map(r => [r.check, r.status])),
    // el comentario del PR tiene un límite de tamaño: se guardan los primeros y se cuentan los demás
    findings: findings.slice(0, MAX_FINDINGS),
    ...(findings.length > MAX_FINDINGS ? { omittedFindings: findings.length - MAX_FINDINGS } : {}),
  }
}
