import { Composition, type CalculateMetadataFunction } from 'remotion'
import { QaVideo, totalFrames, type QaVideoProps } from './QaVideo.js'

// la duración sale del plan que llega en inputProps
const metadata: CalculateMetadataFunction<QaVideoProps> = ({ props }) => ({
  durationInFrames: Math.max(1, totalFrames(props.plan)), fps: props.plan.fps, width: props.plan.width, height: props.plan.height,
})

const defaults: QaVideoProps = {
  plan: { version: 1, fps: 30, width: 1280, height: 720, totalSeconds: 7, segments: [{ kind: 'cover', seconds: 3 }, { kind: 'verdict', seconds: 4 }] },
  script: { cover: { title: 'PR #1 · Ejemplo', subtitle: '' }, captions: {}, closing: '', ai: false },
  facts: { pr: { number: 1, title: 'Ejemplo' }, decision: 'escalate', gates: [], journeys: [] },
  gateNames: {},
}

// QaPreview recibe el plan ya recortado con previewPlan (lo hace render.ts, del lado de Node)
export function Root() {
  return (
    <>
      <Composition id="QaVideo" component={QaVideo} durationInFrames={210} fps={30} width={1280} height={720} defaultProps={defaults} calculateMetadata={metadata} />
      <Composition id="QaPreview" component={QaVideo} durationInFrames={210} fps={30} width={1280} height={720} defaultProps={defaults} calculateMetadata={metadata} />
    </>
  )
}
