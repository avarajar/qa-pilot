import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'

type Finding = {
  kind: 'test-failed' | 'flaky' | 'visual-diff' | 'a11y' | 'error'
  message: string
  journey?: string
  file?: string
  artifact?: string
}

const isScreenshot = (msg: string) => /toHaveScreenshot|Screenshot comparison failed|screenshot.*differ/i.test(msg)
const isA11y = (msg: string) => /^(Error: )?a11y:/m.test(msg)

function journeyOf(test: TestCase): string | undefined {
  const tag = test.tags.find(t => /^@J\d+$/.test(t))
  return tag?.slice(1)
}

export function classify(test: TestCase, result: TestResult): Finding[] {
  const project = test.parent.project()?.name
  const label = project ? `${project} › ${test.title}` : test.title
  const journey = journeyOf(test)
  const file = `${relative(process.cwd(), test.location.file).replace(/^.*?(e2e\/)/, '$1')}:${test.location.line}`
  const base = { ...(journey ? { journey } : {}), file }
  const outcome = test.outcome()

  if (outcome === 'flaky') return [{ kind: 'flaky', message: `${label} pasó al reintentar`, ...base }]
  if (outcome !== 'unexpected') return []

  const messages = result.errors.map(e => e.message ?? '')
  if (messages.length && messages.every(isScreenshot)) return [{ kind: 'visual-diff', message: `${label}: la captura cambió`, ...base }]
  const a11y = messages.find(isA11y)
  if (a11y && messages.every(m => isA11y(m) || isScreenshot(m))) {
    return [{ kind: 'a11y', message: `${label}: ${a11y.replace(/^Error: /, '').split('\n')[0]}`, ...base }]
  }
  return [{ kind: 'test-failed', message: `${label}: ${(messages[0] ?? 'falló').split('\n')[0]}`, ...base }]
}

export default class QaReporter implements Reporter {
  private findings: Finding[] = []
  private executed = 0
  private outputDir: string

  constructor(opts: { outputDir?: string } = {}) {
    this.outputDir = opts.outputDir ?? process.env.QA_PILOT_OUT ?? 'qa-results'
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== 'skipped') this.executed++
    // con reintentos llegan varios resultados; solo cuenta el último
    if (test.outcome() === 'unexpected' && result.retry < test.retries && result.status !== 'passed') return
    for (const f of classify(test, result)) {
      if (f.kind === 'visual-diff') {
        const diff = result.attachments.find(a => a.name.endsWith('-diff.png') && a.path && existsSync(a.path))
        if (diff?.path) {
          const project = test.parent.project()?.name ?? 'default'
          const name = `${project}-${diff.name}`
          mkdirSync(join(this.outputDir, 'artifacts'), { recursive: true })
          copyFileSync(diff.path, join(this.outputDir, 'artifacts', name))
          f.artifact = `artifacts/${name}`
        }
      }
      this.findings.push(f)
    }
  }

  onEnd(result?: FullResult): void {
    // falla cerrado: un e2e que no corrió nada, o que Playwright dio por fallido sin decir por qué, no es un pass
    if (this.executed === 0) this.findings.push({ kind: 'error', message: 'No se ejecutó ningún test e2e' })
    else if (result && (result.status === 'timedout' || result.status === 'interrupted')) {
      // una corrida cortada a la mitad no puede quedar en warn por los hallazgos que alcanzó a ver
      this.findings.push({ kind: 'error', message: `Playwright terminó con estado ${result.status}: no corrieron todos los tests` })
    } else if (result && result.status !== 'passed' && this.findings.length === 0) {
      this.findings.push({ kind: 'error', message: `Playwright terminó con estado ${result.status}` })
    }
    const blocking = this.findings.some(f => f.kind === 'test-failed' || f.kind === 'a11y' || f.kind === 'error')
    const status = blocking ? 'fail' : this.findings.length ? 'warn' : 'pass'
    mkdirSync(this.outputDir, { recursive: true })
    writeFileSync(join(this.outputDir, 'e2e.json'), JSON.stringify({ check: 'e2e', status, findings: this.findings }, null, 2))
  }

  printsToStdio(): boolean {
    return false
  }
}
