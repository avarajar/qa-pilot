export type VideoConfig = { enabled: boolean; max_seconds: number; project?: string }

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
  video: VideoConfig
}

// description: prosa bajo el "## J<n> · nombre", sin el encabezado
export type Journey = { id: string; name: string; description: string }

export type QaContract = { root: string; config: QaConfig; protectedPaths: string[]; journeys: Journey[] }

export type Finding = {
  kind: 'test-failed' | 'flaky' | 'visual-diff' | 'a11y' | 'security' | 'error'
  message: string
  journey?: string
  file?: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
  artifact?: string
  // capturas que cambiaron; rutas relativas a qa-results (artifacts/<archivo>.png)
  images?: Snapshot[]
}

// marked: lo recibido con la zona que cambió encerrada; change: cuánto y dónde, para decirlo en texto
export type Snapshot = {
  name: string; expected?: string; actual?: string; diff?: string; marked?: string
  change?: { pixels: number; percent: number; zone: string }
  // elements: qué hay en la zona que cambió (del reporter); ai: la frase de Claude (de publish)
  elements?: string[]
  ai?: string
}

export type CheckResult = { check: string; status: 'pass' | 'fail' | 'warn'; findings: Finding[] }

export type Gate = { id: 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'SEC' | 'AI' | 'ERR'; reason: string }

export type Decision = {
  version: 1
  decision: 'auto' | 'escalate' | 'blocked'
  sha: string
  gates: Gate[]
  diff: { files: number; added: number; removed: number }
  checks: Record<string, CheckResult['status']>
  findings: Array<Finding & { check: string }>
  omittedFindings?: number
  // base de las URLs de las imágenes subidas por publish: <evidence><ruta de images>
  evidence?: string
  video?: VideoState
  approvedBy?: string
}

// Video de QA por PR
export type TimelineEntry = {
  journey: string // 'J1'
  title: string // título del test, ≤ 120
  project: string // 'admin-desktop'
  status: 'passed' | 'failed'
  video: string // 'artifacts/video-<algo>.webm'
  durationMs: number
  steps: Array<{ title: string; atMs: number }> // ≤ 50, title ≤ 120
  marks: Array<{ kind: 'snap' | 'failure'; name?: string; atMs: number }> // name = stem de la captura, p. ej. 'notas-light'
}
export type Timeline = { version: 1; entries: TimelineEntry[] }

export type JourneyStatus = 'pass' | 'changed' | 'failed'
export type VideoSegment =
  | { kind: 'cover'; seconds: number }
  | { kind: 'clip'; journey: string; status: JourneyStatus; video: string; fromMs: number; toMs: number; playbackRate: number; seconds: number }
  | { kind: 'stop'; journey: string; images?: { before?: string; after?: string }; text: string; ai: boolean; seconds: number }
  | { kind: 'summary'; journeys: Array<{ journey: string; status: JourneyStatus }>; more: number; seconds: number }
  | { kind: 'verdict'; seconds: number }
export type VideoPlan = { version: 1; fps: 30; width: 1280; height: 720; segments: VideoSegment[]; totalSeconds: number }

export type VideoFacts = {
  pr: { number: number; title: string }
  decision: Decision['decision']
  gates: Gate[]
  journeys: Array<{ id: string; name: string; status: JourneyStatus }>
}
export type VideoScript = {
  cover: { title: string; subtitle: string } // title lo pone el código: 'PR #<n> · <título>'
  captions: Record<string, string> // por journey: 'J1 · La persona entra y ve sus notas', ≤ 90
  closing: string // ≤ 140
  ai: boolean
}

export type VideoState =
  | { state: 'pending' }
  | { state: 'ready'; mp4: string; gif: string; seconds: number }
  | { state: 'failed'; reason: string }
