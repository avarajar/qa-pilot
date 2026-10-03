import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { CheckResult, Finding } from './types.js'

export type IngestTool = 'junit' | 'semgrep' | 'gitleaks'

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])

type XmlCase = { '@_name'?: string; '@_classname'?: string; '@_file'?: string; failure?: unknown; error?: unknown }
type XmlSuite = { testcase?: XmlCase | XmlCase[]; testsuite?: XmlSuite | XmlSuite[] }

function problemMessage(p: unknown): string {
  const first = Array.isArray(p) ? p[0] : p
  if (first && typeof first === 'object' && '@_message' in first) return String((first as { '@_message': unknown })['@_message'])
  return typeof first === 'string' ? first.split('\n')[0]! : 'falló'
}

function junit(raw: string, check: string): CheckResult {
  if (XMLValidator.validate(raw) !== true) return broken(check, 'JUnit ilegible')
  const doc = new XMLParser({ ignoreAttributes: false }).parse(raw) as { testsuites?: XmlSuite; testsuite?: XmlSuite }
  const findings: Finding[] = []
  let cases = 0
  const walk = (suite: XmlSuite) => {
    for (const tc of asArray(suite.testcase)) {
      cases++
      const problem = tc.failure ?? tc.error
      if (problem === undefined) continue
      const file = tc['@_file'] ?? tc['@_classname']
      findings.push({ kind: 'test-failed', message: `${tc['@_name'] ?? 'test'}: ${problemMessage(problem)}`, ...(file ? { file } : {}) })
    }
    for (const child of asArray(suite.testsuite)) walk(child)
  }
  if (doc.testsuites) walk(doc.testsuites)
  if (doc.testsuite) for (const s of asArray(doc.testsuite)) walk(s)
  // un reporte sin tests no prueba nada: falla cerrado
  if (cases === 0) return broken(check, 'JUnit sin tests')
  return { check, status: findings.length ? 'fail' : 'pass', findings }
}

const SEMGREP_SEVERITY: Record<string, Finding['severity']> = { ERROR: 'high', WARNING: 'medium', INFO: 'low' }

function semgrep(raw: string, check: string): CheckResult {
  type R = { check_id: string; path: string; start?: { line?: number }; extra?: { message?: string; severity?: string } }
  const data = JSON.parse(raw) as { results?: R[] }
  const findings: Finding[] = (data.results ?? []).map(r => ({
    kind: 'security',
    message: `${r.check_id}: ${r.extra?.message ?? ''}`.trim(),
    file: r.start?.line ? `${r.path}:${r.start.line}` : r.path,
    severity: SEMGREP_SEVERITY[r.extra?.severity ?? ''] ?? 'medium',
  }))
  // seguridad escala; no bloquea
  return { check, status: findings.length ? 'warn' : 'pass', findings }
}

function gitleaks(raw: string, check: string): CheckResult {
  type L = { RuleID: string; File: string; StartLine?: number }
  const data = (JSON.parse(raw) as L[] | null) ?? []
  // nunca se copia Secret ni Match: el resultado se publica en el PR
  const findings: Finding[] = data.map(l => ({
    kind: 'security',
    message: l.RuleID,
    file: l.StartLine ? `${l.File}:${l.StartLine}` : l.File,
    severity: 'critical',
  }))
  return { check, status: findings.length ? 'warn' : 'pass', findings }
}

function broken(check: string, message: string): CheckResult {
  return { check, status: 'fail', findings: [{ kind: 'error', message }] }
}

export function ingest(tool: IngestTool, raw: string, check?: string): CheckResult {
  const name = check ?? (tool === 'junit' ? 'unit' : tool)
  try {
    if (tool === 'junit') return junit(raw, name)
    if (tool === 'semgrep') return semgrep(raw, name)
    return gitleaks(raw, name)
  } catch (err) {
    return broken(name, `${tool}: salida ilegible (${(err as Error).message})`)
  }
}
