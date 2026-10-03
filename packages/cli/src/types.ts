export type Role = { email: string; password_env?: string; expect?: 'rejected' }

export type QaConfig = {
  app: {
    env: 'supabase-local' | 'docker-compose' | 'command'
    dir: string
    setup?: string
    start?: string
    url: string
    ready_timeout_s: number
    seed?: string
    compose_file?: string
    env_map?: Record<string, string>
    vars?: Record<string, string>
  }
  auth: {
    adapter: 'supabase-magiclink' | 'form' | 'none'
    callback?: string
    login_url?: string
    fields?: { email: string; password: string; submit: string }
  }
  roles: Record<string, Role>
  checks: { unit?: string; e2e?: string; security?: Array<'semgrep' | 'gitleaks'>; timeout_s: number }
  router: { auto_max_lines: number; visual_diff: 'warn' | 'escalate'; flaky_in_journey: 'warn' | 'escalate' }
  approvers: string[]
}

export type Journey = { id: string; name: string }

export type QaContract = { root: string; config: QaConfig; protectedPaths: string[]; journeys: Journey[] }

export type Finding = {
  kind: 'test-failed' | 'flaky' | 'visual-diff' | 'a11y' | 'security' | 'error'
  message: string
  journey?: string
  file?: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
  artifact?: string
}

export type CheckResult = { check: string; status: 'pass' | 'fail' | 'warn'; findings: Finding[] }

export type Gate = { id: 'G1' | 'G3' | 'G4' | 'G5' | 'SEC' | 'AI' | 'ERR'; reason: string }

export type Decision = {
  version: 1
  decision: 'auto' | 'escalate' | 'blocked'
  sha: string
  gates: Gate[]
  diff: { files: number; added: number; removed: number }
  checks: Record<string, CheckResult['status']>
  findings: Array<Finding & { check: string }>
  omittedFindings?: number
}
