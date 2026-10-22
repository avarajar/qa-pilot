import { AbsoluteFill, Img, staticFile } from 'remotion'
import type { VideoSegment } from 'qa-pilot'
import { MUTED, PANEL } from '../theme.js'

type StopSeg = Extract<VideoSegment, { kind: 'stop' }>

function Panel({ label, src }: { label: string; src?: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ fontSize: 26, fontWeight: 600, color: MUTED }}>{label}</div>
      <div style={{ flex: 1, backgroundColor: PANEL, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {src ? <Img src={staticFile(src)} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <span style={{ fontSize: 24, color: MUTED }}>sin imagen</span>}
      </div>
    </div>
  )
}

// parada en un hallazgo: antes y después lado a lado con el texto del hallazgo
export function Stop({ seg, caption }: { seg: StopSeg; caption?: string }) {
  return (
    <AbsoluteFill style={{ padding: 48, gap: 24 }}>
      <div style={{ fontSize: 30, fontWeight: 700 }}>{caption ?? seg.journey}</div>
      <div style={{ flex: 1, display: 'flex', gap: 32, minHeight: 0 }}>
        <Panel label="Antes" src={seg.images?.before} />
        <Panel label="Después" src={seg.images?.after} />
      </div>
      <div style={{ fontSize: 30, lineHeight: 1.3 }}>{seg.text}{seg.ai ? <span style={{ color: MUTED }}> (IA)</span> : null}</div>
    </AbsoluteFill>
  )
}
