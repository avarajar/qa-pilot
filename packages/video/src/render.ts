import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer'
import { GATE_NAMES, previewPlan, type VideoFacts, type VideoPlan, type VideoScript } from 'qa-pilot'
import type { QaVideoProps } from './remotion/QaVideo.js'

// las rutas ya vienen validadas, pero al publicDir solo entran archivos planos de artifacts/
const MEDIA = /^artifacts\/[A-Za-z0-9._-]+\.(webm|png)$/

// copia del plan sin las rutas que no pasan el filtro o no existen; el segmento sale sin ese medio
export function mediaPlan(out: string, plan: VideoPlan): { plan: VideoPlan; files: string[] } {
  const files = new Set<string>()
  const keep = (p: string | undefined, ext: string) => {
    if (!p || !MEDIA.test(p) || !p.endsWith(ext)) return undefined
    try { if (!lstatSync(join(out, p)).isFile()) return undefined } catch { return undefined }
    files.add(p)
    return p
  }
  const segments = plan.segments.map(s => {
    if (s.kind === 'clip') return { ...s, video: keep(s.video, '.webm') ?? '' }
    if (s.kind === 'stop' && s.images) {
      const before = keep(s.images.before, '.png'), after = keep(s.images.after, '.png')
      return { ...s, images: { ...(before ? { before } : {}), ...(after ? { after } : {}) } }
    }
    return s
  })
  return { plan: { ...plan, segments }, files: [...files] }
}

// en dist el entry es .js; corriendo desde src (tests) es .ts
function entryPoint() {
  const here = dirname(fileURLToPath(import.meta.url))
  return [join(here, 'remotion', 'index.js'), join(here, 'remotion', 'index.ts')].find(existsSync)!
}

export async function render(input: { out: string; plan: VideoPlan; script: VideoScript; facts: VideoFacts }): Promise<{ mp4: string; gif: string; seconds: number }> {
  const dir = join(input.out, 'video')
  mkdirSync(dir, { recursive: true })
  const mp4 = join(dir, 'video.mp4'), gif = join(dir, 'preview.gif')
  const { plan, files } = mediaPlan(input.out, input.plan)
  const pub = mkdtempSync(join(tmpdir(), 'qa-pilot-video-public-'))
  let serveUrl: string | undefined
  try {
    for (const f of files) { mkdirSync(dirname(join(pub, f)), { recursive: true }); copyFileSync(join(input.out, f), join(pub, f)) }
    // los imports llevan .js (NodeNext); desde src apuntan a .ts/.tsx
    serveUrl = await bundle({ entryPoint: entryPoint(), publicDir: pub, webpackOverride: c => ({ ...c, resolve: { ...c.resolve, extensionAlias: { '.js': ['.tsx', '.ts', '.js'] } } }) })
    await ensureBrowser()
    const props: QaVideoProps = { plan, script: input.script, facts: input.facts, gateNames: GATE_NAMES }
    const video = await selectComposition({ serveUrl, id: 'QaVideo', inputProps: props })
    await renderMedia({ composition: video, serveUrl, inputProps: props, codec: 'h264', crf: 28, muted: true, outputLocation: mp4 })
    const pprops: QaVideoProps = { ...props, plan: previewPlan(plan) }
    const preview = await selectComposition({ serveUrl, id: 'QaPreview', inputProps: pprops })
    await renderMedia({ composition: preview, serveUrl, inputProps: pprops, codec: 'gif', scale: 0.5, everyNthFrame: 3, outputLocation: gif })
    const seconds = video.durationInFrames / video.fps
    writeFileSync(join(dir, 'video.json'), JSON.stringify({ version: 1, mp4: 'video.mp4', gif: 'preview.gif', seconds }, null, 2) + '\n')
    return { mp4, gif, seconds }
  } finally {
    rmSync(pub, { recursive: true, force: true })
    if (serveUrl) rmSync(serveUrl, { recursive: true, force: true })
  }
}
