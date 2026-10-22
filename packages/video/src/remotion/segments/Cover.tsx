import { AbsoluteFill } from 'remotion'
import type { VideoScript } from 'qa-pilot'
import { MUTED } from '../theme.js'

export function Cover({ script }: { script: VideoScript }) {
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 120px', gap: 24 }}>
      <div style={{ fontSize: 24, color: MUTED, letterSpacing: 2, textTransform: 'uppercase' }}>qa-pilot · video de QA</div>
      <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.15 }}>{script.cover.title}</div>
      <div style={{ fontSize: 32, color: MUTED }}>{script.cover.subtitle}</div>
    </AbsoluteFill>
  )
}
