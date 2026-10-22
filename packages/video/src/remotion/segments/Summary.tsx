import { AbsoluteFill } from 'remotion'
import type { VideoFacts, VideoSegment } from 'qa-pilot'
import { MUTED, Mark } from '../theme.js'

type SummarySeg = Extract<VideoSegment, { kind: 'summary' }>

export function Summary({ seg, facts }: { seg: SummarySeg; facts: VideoFacts }) {
  const name = (id: string) => facts.journeys.find(j => j.id === id)?.name
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 120px', gap: 18 }}>
      <div style={{ fontSize: 26, color: MUTED, marginBottom: 12 }}>Journeys</div>
      {seg.journeys.map(j => (
        <div key={j.journey} style={{ display: 'flex', gap: 20, alignItems: 'baseline', fontSize: 34 }}>
          <span style={{ fontWeight: 700, minWidth: 70 }}>{j.journey}</span>
          <span style={{ flex: 1 }}>{name(j.journey) ?? ''}</span>
          <Mark status={j.status} size={30} />
        </div>
      ))}
      {seg.more > 0 ? <div style={{ fontSize: 28, color: MUTED }}>+{seg.more} más</div> : null}
    </AbsoluteFill>
  )
}
