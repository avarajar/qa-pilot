import { describe, it, expect } from 'vitest'
import { ingest } from './ingest.js'

const junitOk = `<?xml version="1.0"?>
<testsuites><testsuite name="a" tests="2"><testcase name="suma" classname="math"/><testcase name="resta" classname="math"/></testsuite></testsuites>`

const junitFail = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="a" tests="3">
    <testcase name="suma" classname="src/math.test.ts"><failure message="expected 3 to be 4">stack</failure></testcase>
    <testcase name="resta" classname="src/math.test.ts"/>
  </testsuite>
  <testsuite name="b"><testcase name="x" classname="b.test.ts"><error message="boom"/></testcase></testsuite>
</testsuites>`

describe('ingest junit', () => {
  it('sin fallos → pass', () => {
    expect(ingest('junit', junitOk)).toEqual({ check: 'unit', status: 'pass', findings: [] })
  })
  it('failure y error → test-failed y status fail', () => {
    const r = ingest('junit', junitFail, 'unit')
    expect(r.status).toBe('fail')
    expect(r.findings).toEqual([
      { kind: 'test-failed', message: 'suma: expected 3 to be 4', file: 'src/math.test.ts' },
      { kind: 'test-failed', message: 'x: boom', file: 'b.test.ts' },
    ])
  })
  it('JUnit sin ningún test → fail', () => {
    expect(ingest('junit', '<testsuites><testsuite name="a" tests="0"/></testsuites>')).toMatchObject({ status: 'fail', findings: [{ kind: 'error', message: 'JUnit sin tests' }] })
  })
  it('XML ilegible → fail con error', () => {
    expect(ingest('junit', 'no es xml')).toMatchObject({ status: 'fail', findings: [{ kind: 'error' }] })
  })
})

describe('ingest semgrep', () => {
  it('sin resultados → pass', () => {
    expect(ingest('semgrep', JSON.stringify({ results: [], errors: [] }))).toEqual({ check: 'semgrep', status: 'pass', findings: [] })
  })
  it('resultados → security con severidad, status warn', () => {
    const raw = JSON.stringify({
      results: [
        { check_id: 'js.sqli', path: 'web/db.ts', start: { line: 12 }, extra: { message: 'SQL injection', severity: 'ERROR' } },
        { check_id: 'js.weak', path: 'web/x.ts', start: { line: 3 }, extra: { message: 'weak hash', severity: 'WARNING' } },
        { check_id: 'js.info', path: 'web/y.ts', start: { line: 1 }, extra: { message: 'nota', severity: 'INFO' } },
      ],
    })
    const r = ingest('semgrep', raw)
    expect(r.status).toBe('warn')
    expect(r.findings).toEqual([
      { kind: 'security', message: 'js.sqli: SQL injection', file: 'web/db.ts:12', severity: 'high' },
      { kind: 'security', message: 'js.weak: weak hash', file: 'web/x.ts:3', severity: 'medium' },
      { kind: 'security', message: 'js.info: nota', file: 'web/y.ts:1', severity: 'low' },
    ])
  })
})

describe('ingest gitleaks', () => {
  it('vacío (null o []) → pass', () => {
    expect(ingest('gitleaks', 'null').status).toBe('pass')
    expect(ingest('gitleaks', '[]').status).toBe('pass')
  })
  it('hallazgos → security critical sin exponer el secreto', () => {
    const raw = JSON.stringify([{ RuleID: 'aws-access-token', File: '.env', StartLine: 2, Secret: 'AKIA123', Match: 'AKIA123' }])
    const r = ingest('gitleaks', raw)
    expect(r).toEqual({ check: 'gitleaks', status: 'warn', findings: [{ kind: 'security', message: 'aws-access-token', file: '.env:2', severity: 'critical' }] })
    expect(JSON.stringify(r)).not.toContain('AKIA123')
  })
})
