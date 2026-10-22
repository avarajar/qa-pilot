import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion'
import type { ReactNode } from 'react'
import type { VideoFacts, VideoPlan, VideoScript } from 'qa-pilot'
import { Cover } from './segments/Cover.js'
import { Clip } from './segments/Clip.js'
import { Stop } from './segments/Stop.js'
import { Summary } from './segments/Summary.js'
import { Verdict } from './segments/Verdict.js'
import { BG, FONT, TEXT } from './theme.js'

// gateNames llega como prop: el bundle del navegador no importa nada de qa-pilot en runtime
export type QaVideoProps = { plan: VideoPlan; script: VideoScript; facts: VideoFacts; gateNames: Record<string, string> }

// el epsilon evita que 19.5 × 30 = 585.0000001 sume un frame de más
export const totalFrames = (plan: VideoPlan) => Math.ceil(plan.totalSeconds * plan.fps - 1e-6)

// bordes en frames sobre los segundos acumulados; el último llega al final de la composición
export function segmentFrames(plan: VideoPlan): Array<{ from: number; durationInFrames: number }> {
  const total = totalFrames(plan)
  let acc = 0
  return plan.segments.map((s, i) => {
    const from = Math.min(total, Math.round(acc * plan.fps))
    acc += s.seconds
    const end = i === plan.segments.length - 1 ? total : Math.min(total, Math.round(acc * plan.fps))
    return { from, durationInFrames: Math.max(0, end - from) }
  })
}

// fundido de entrada de 6 frames, sin más efectos
function Fade({ children }: { children: ReactNode }) {
  const frame = useCurrentFrame()
  return <AbsoluteFill style={{ opacity: interpolate(frame, [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>{children}</AbsoluteFill>
}

export function QaVideo({ plan, script, facts, gateNames }: QaVideoProps) {
  const frames = segmentFrames(plan)
  return (
    <AbsoluteFill style={{ backgroundColor: BG, color: TEXT, fontFamily: FONT }}>
      {plan.segments.map((s, i) => {
        const f = frames[i]!
        if (f.durationInFrames <= 0) return null
        return (
          <Sequence key={i} name={s.kind} from={f.from} durationInFrames={f.durationInFrames}>
            <Fade>
              {s.kind === 'cover' ? <Cover script={script} />
                : s.kind === 'clip' ? <Clip seg={s} caption={script.captions[s.journey]} />
                : s.kind === 'stop' ? <Stop seg={s} caption={script.captions[s.journey]} />
                : s.kind === 'summary' ? <Summary seg={s} facts={facts} />
                : <Verdict facts={facts} script={script} gateNames={gateNames} />}
            </Fade>
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
