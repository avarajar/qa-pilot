import { AbsoluteFill, OffthreadVideo, staticFile, useVideoConfig } from 'remotion'
import type { VideoSegment } from 'qa-pilot'
import { Mark } from '../theme.js'

type ClipSeg = Extract<VideoSegment, { kind: 'clip' }>

// reproduce [fromMs, toMs] del clip a playbackRate; sin video (faltaba el archivo) queda solo el marco
export function Clip({ seg, caption }: { seg: ClipSeg; caption?: string }) {
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill>
      {seg.video ? (
        <OffthreadVideo src={staticFile(seg.video)} muted playbackRate={seg.playbackRate}
          trimBefore={Math.round((seg.fromMs / 1000) * fps)} trimAfter={Math.max(Math.round((seg.toMs / 1000) * fps), Math.round((seg.fromMs / 1000) * fps) + 1)}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : null}
      <div style={{ position: 'absolute', top: 24, left: 24, padding: '8px 18px', borderRadius: 8, backgroundColor: 'rgba(15,23,42,0.85)', display: 'flex', gap: 14, alignItems: 'center' }}>
        <span style={{ fontSize: 28, fontWeight: 700 }}>{seg.journey}</span>
        <Mark status={seg.status} />
      </div>
      {caption ? (
        <div style={{ position: 'absolute', bottom: 32, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <div style={{ maxWidth: 1100, padding: '12px 24px', borderRadius: 8, backgroundColor: 'rgba(15,23,42,0.85)', fontSize: 32, textAlign: 'center' }}>{caption}</div>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}
