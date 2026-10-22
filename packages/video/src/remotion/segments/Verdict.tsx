import { AbsoluteFill } from 'remotion'
import type { VideoFacts, VideoScript } from 'qa-pilot'
import { MUTED } from '../theme.js'

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
      {facts.gates.map((g, i) => (
        <div key={i} style={{ fontSize: 28 }}>{g.id} · {gateNames[g.id] ?? g.id}: {g.reason}</div>
      ))}
      <div style={{ fontSize: 30, color: MUTED, marginTop: 16 }}>{script.closing}</div>
    </AbsoluteFill>
  )
}
