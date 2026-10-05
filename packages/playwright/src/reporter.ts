import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { describeDiff, elementsInZone, markChange, type PageElement } from './visual.js'

type Finding = {
  kind: 'test-failed' | 'flaky' | 'visual-diff' | 'a11y' | 'error'
  message: string
  journey?: string
  file?: string
  artifact?: string
  images?: Snapshot[]
}

// una captura que cambió: rutas relativas a qa-results, como las sube publish
// marked: lo recibido con la zona que cambió encerrada; change: cuánto y dónde, para decirlo en texto
type Snapshot = {
  name: string; expected?: string; actual?: string; diff?: string; marked?: string
  change?: { pixels: number; percent: number; zone: string }
  elements?: string[]
}

const SNAPSHOT_PART = /^(.+)-(expected|actual|diff)\.png$/

// los errores de expect vienen coloreados para la terminal
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

// la primera línea de un expect fallido no dice qué salió: se le suma lo esperado y lo recibido
function summarize(message: string): string {
  const first = message.split('\n')[0]!
  const expected = /^\s*Expected[^:\n]*:\s*(.+)$/m.exec(message)?.[1]?.trim()
  const received = /^\s*Received[^:\n]*:\s*(.+)$/m.exec(message)?.[1]?.trim()
  return expected && received ? `${first} (esperado: ${expected} · recibido: ${received})` : first
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

  const messages = result.errors.map(e => stripAnsi(e.message ?? ''))
  if (messages.length && messages.every(isScreenshot)) return [{ kind: 'visual-diff', message: `${label}: la captura cambió`, ...base }]
  const a11y = messages.find(isA11y)
  if (a11y && messages.every(m => isA11y(m) || isScreenshot(m))) {
    return [{ kind: 'a11y', message: `${label}: ${a11y.replace(/^Error: /, '').split('\n')[0]}`, ...base }]
  }
  return [{ kind: 'test-failed', message: `${label}: ${summarize(messages[0] ?? 'falló')}`, ...base }]
}

// lo que anotó qa.snap al fallar la captura: <nombre>-elements.json
function pageElements(result: TestResult, stem: string): PageElement[] {
  const a = result.attachments.find(x => x.name === `${stem}-elements.json`)
  try {
    const raw = a?.body ? a.body.toString('utf8') : a?.path ? readFileSync(a.path, 'utf8') : '[]'
    const list = JSON.parse(raw) as PageElement[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
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
        const images = this.copySnapshots(test, result)
        if (images.length) f.images = images
        const diff = images.find(i => i.diff)?.diff
        if (diff) f.artifact = diff
      }
      this.findings.push(f)
    }
  }

  // Playwright adjunta <nombre>-expected/-actual/-diff.png por cada toHaveScreenshot que falló
  private copySnapshots(test: TestCase, result: TestResult): Snapshot[] {
    const project = test.parent.project()?.name ?? 'default'
    const byName = new Map<string, Snapshot>()
    for (const a of result.attachments) {
      const m = SNAPSHOT_PART.exec(a.name)
      if (!m || !a.path || !existsSync(a.path)) continue
      const [, stem, part] = m as unknown as [string, string, 'expected' | 'actual' | 'diff']
      const file = `${project}-${a.name}`
      mkdirSync(join(this.outputDir, 'artifacts'), { recursive: true })
      copyFileSync(a.path, join(this.outputDir, 'artifacts', file))
      const snap = byName.get(stem) ?? { name: `${project} · ${stem}` }
      snap[part] = `artifacts/${file}`
      byName.set(stem, snap)
    }
    for (const [stem, snap] of byName) {
      if (!snap.diff) continue
      const summary = describeDiff(join(this.outputDir, snap.diff))
      if (!summary) continue
      snap.change = { pixels: summary.pixels, percent: summary.percent, zone: summary.zone }
      const elements = elementsInZone(pageElements(result, stem), summary.box)
      if (elements.length) snap.elements = elements
      const marked = `${project}-${stem}-marked.png`
      if (snap.actual && markChange(join(this.outputDir, snap.actual), summary.box, join(this.outputDir, 'artifacts', marked))) {
        snap.marked = `artifacts/${marked}`
      }
    }
    return [...byName.values()]
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
