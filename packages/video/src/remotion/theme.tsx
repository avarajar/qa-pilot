import type { JourneyStatus } from 'qa-pilot'

export const BG = '#0f172a'
export const PANEL = '#1e293b'
export const TEXT = '#e2e8f0'
export const MUTED = '#94a3b8'
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export const MARK: Record<JourneyStatus, { text: string; color: string }> = {
  pass: { text: '✓', color: '#22c55e' },
  changed: { text: '⚠ cambió', color: '#f59e0b' },
  failed: { text: '✗ falló', color: '#ef4444' },
}

export function Mark({ status, size = 28 }: { status: JourneyStatus; size?: number }) {
  const m = MARK[status]
  return <span style={{ color: m.color, fontWeight: 700, fontSize: size }}>{m.text}</span>
}
