import { AbsoluteFill } from 'remotion'
import type { VideoFacts, VideoSegment } from 'qa-pilot'
import { MUTED, Mark } from '../theme.js'

type SummarySeg = Extract<VideoSegment, { kind: 'summary' }>

// a 720p caben 8 filas por columna; con más de 8 van dos columnas y lo que no quepa se suma a "+N más"
const ROWS = 8, MAX_SHOWN = ROWS * 2

export function Summary({ seg, facts }: { seg: SummarySeg; facts: VideoFacts }) {
  const name = (id: string) => facts.journeys.find(j => j.id === id)?.name
  const shown = seg.journeys.slice(0, MAX_SHOWN)
  const more = seg.more + seg.journeys.length - shown.length
  const two = shown.length > ROWS
  const size = two ? 28 : 34
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 120px', gap: 18 }}>
      <div style={{ fontSize: 26, color: MUTED, marginBottom: 12 }}>Journeys</div>
      <div style={{ display: 'grid', gridTemplateColumns: two ? '1fr 1fr' : '1fr', gridTemplateRows: `repeat(${Math.min(ROWS, shown.length)}, auto)`, gridAutoFlow: 'column', columnGap: 60, rowGap: two ? 12 : 18 }}>
        {shown.map(j => (
          <div key={j.journey} data-row style={{ display: 'flex', gap: 20, alignItems: 'baseline', fontSize: size, minWidth: 0 }}>
            <span style={{ fontWeight: 700, minWidth: 70 }}>{j.journey}</span>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name(j.journey) ?? ''}</span>
            <Mark status={j.status} size={size - 4} />
          </div>
        ))}
      </div>
      {more > 0 ? <div style={{ fontSize: 28, color: MUTED }}>+{more} más</div> : null}
    </AbsoluteFill>
  )
}
