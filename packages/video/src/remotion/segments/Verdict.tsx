import { AbsoluteFill } from 'remotion'
import type { VideoFacts, VideoScript } from 'qa-pilot'
import { MUTED } from '../theme.js'

// a 720p caben 4 compuertas de una línea; el resto se cuenta
const MAX_GATES = 4, MAX_REASON = 90
const cut = (s: string) => (s.length > MAX_REASON ? `${s.slice(0, MAX_REASON - 1)}…` : s)

const DECISION: Record<VideoFacts['decision'], { text: string; color: string }> = {
  auto: { text: 'Aprobado automáticamente', color: '#22c55e' },
  escalate: { text: 'Necesita un humano', color: '#f59e0b' },
  blocked: { text: 'Bloqueado', color: '#ef4444' },
}

export function Verdict({ facts, script, gateNames }: { facts: VideoFacts; script: VideoScript; gateNames: Record<string, string> }) {
  const d = DECISION[facts.decision]
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 120px', gap: 20 }}>
      <div style={{ fontSize: 56, fontWeight: 700, color: d.color }}>{d.text}</div>
      {facts.gates.slice(0, MAX_GATES).map((g, i) => (
        <div key={i} style={{ fontSize: 28, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.id} · {gateNames[g.id] ?? g.id}: {cut(g.reason)}</div>
      ))}
      {facts.gates.length > MAX_GATES ? <div style={{ fontSize: 26, color: MUTED }}>y {facts.gates.length - MAX_GATES} más</div> : null}
      <div style={{ fontSize: 30, color: MUTED, marginTop: 16 }}>{script.closing}</div>
    </AbsoluteFill>
  )
}
