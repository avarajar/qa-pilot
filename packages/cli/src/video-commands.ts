import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { register, githubContext, type Io } from './cli.js'
import { loadContract } from './config.js'
import { prFromEvent, prTitleFromEvent } from './events.js'
import { extractDecision, MARKER } from './comment.js'
import { parseTimeline } from './timeline.js'
import { journeyStatuses, planVideo } from './video-plan.js'
import { claudeScript, templateScript } from './video-script.js'
import { publishVideo, wantsVideo } from './publish.js'
import type { GitHub } from './github.js'
import type { Decision, VideoFacts, VideoPlan, VideoScript } from './types.js'

type RenderFn = (i: { out: string; plan: VideoPlan; script: VideoScript; facts: VideoFacts }) => Promise<{ mp4: string; gif: string; seconds: number }>
type Importer = () => Promise<{ render: RenderFn }>

// @qa-pilot/video no es dependencia de este paquete: el especificador va en una variable para que tsc no lo resuelva
const VIDEO_PKG = '@qa-pilot/video'
const defaultImporter: Importer = () => import(VIDEO_PKG) as Promise<{ render: RenderFn }>
let importer: Importer = defaultImporter
export function setVideoImporter(i: Importer | null): void { importer = i ?? defaultImporter }

const MAX_VIDEO_BYTES = 20_000_000
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function args(a: string[]) {
  const { values } = parseArgs({ args: a, options: { root: { type: 'string', default: '.' }, out: { type: 'string' }, reason: { type: 'string' } }, strict: false })
  const root = resolve(String(values.root ?? '.'))
  return { root, out: values.out ? resolve(String(values.out)) : join(root, 'qa-results'), reason: typeof values.reason === 'string' ? values.reason : undefined }
}

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return undefined }
}

// decision.json viene del job que corrió código del PR: se valida la forma
function readDecision(out: string): Decision | null {
  const raw = readJson(join(out, 'decision.json'))
  if (!obj(raw) || !['auto', 'escalate', 'blocked'].includes(String(raw.decision)) || typeof raw.sha !== 'string') return null
  const gates = Array.isArray(raw.gates) ? raw.gates.filter(g => obj(g) && typeof g.id === 'string' && typeof g.reason === 'string') : []
  const findings = Array.isArray(raw.findings) ? raw.findings.filter(obj) : []
  return { ...raw, version: 1, gates, findings, checks: obj(raw.checks) ? raw.checks : {}, diff: obj(raw.diff) ? raw.diff : { files: 0, added: 0, removed: 0 } } as unknown as Decision
}

function readEvent(): unknown {
  const f = process.env.GITHUB_EVENT_PATH
  return f ? readJson(f) : undefined
}

const sub: Record<string, (a: string[], io: Io) => Promise<number>> = {
  async wanted(a, io) {
    const { root, out } = args(a)
    const d = readDecision(out)
    let want = false
    try { want = !!d && wantsVideo(d, loadContract(root).config) } catch { /* sin contrato, sin video */ }
    io.out(String(want))
    return 0
  },

  // evento labeled: la decisión sale del comentario del bot, solo si sigue siendo del head del PR
  async source(a, io) {
    const { out } = args(a)
    const ctx = githubContext(io)
    if (!ctx) return 1
    const pr = prFromEvent(ctx.event)
    if (!pr) { io.err('El evento no es de un pull request'); return 1 }
    const head = (await ctx.gh.getPr(pr)).headSha
    const body = await ctx.gh.findComment(pr, MARKER)
    const d = body ? extractDecision(body) : null
    if (!d) { io.err(`El PR #${pr} no tiene comentario de decisión de qa-pilot`); return 1 }
    if (d.sha !== head) { io.err(`La decisión es de ${d.sha.slice(0, 7)} y el PR ya está en ${head.slice(0, 7)}: espera a que qa-pilot corra de nuevo`); return 1 }
    const run = await ctx.gh.findArtifactRun('qa-results', head)
    if (run === null) { io.err(`No hay un artefacto qa-results para ${head.slice(0, 7)}`); return 1 }
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'decision.json'), JSON.stringify(d, null, 2))
    io.out(String(run))
    return 0
  },

  async script(a, io) {
    const { root, out } = args(a)
    const d = readDecision(out)
    if (!d) { io.err(`${join(out, 'decision.json')} falta o no es una decisión válida de qa-pilot`); return 1 }
    const timeline = parseTimeline(readJson(join(out, 'timeline.json')))
    const contract = loadContract(root)
    const ev = readEvent()
    const number = prFromEvent(ev)
    if (!number) { io.err('El evento no es de un pull request'); return 1 }
    const plan = planVideo({ decision: d, timeline, maxSeconds: contract.config.video.max_seconds })
    const names = new Map(contract.journeys.map(j => [j.id, j.name]))
    const status = journeyStatuses(d, timeline)
    const inPlan = new Set(plan.segments.flatMap(s => ('journey' in s ? [s.journey] : s.kind === 'summary' ? s.journeys.map(j => j.journey) : [])))
    const facts: VideoFacts = {
      pr: { number, title: prTitleFromEvent(ev) },
      decision: d.decision,
      gates: d.gates,
      journeys: [...status].filter(([id]) => inPlan.has(id)).map(([id, st]) => ({ id, name: names.get(id) ?? id, status: st })),
    }
    // con clave y sin ella el video sale igual: claudeScript nunca lanza y cae a la plantilla
    const script = process.env.ANTHROPIC_API_KEY
      ? await claudeScript({ ...(process.env.QA_PILOT_AI_MODEL ? { model: process.env.QA_PILOT_AI_MODEL } : {}) })(facts, contract.journeys)
      : templateScript(facts)
    const dir = join(out, 'video')
    mkdirSync(dir, { recursive: true })
    for (const [n, v] of [['plan', plan], ['facts', facts], ['script', script]] as const) writeFileSync(join(dir, `${n}.json`), JSON.stringify(v, null, 2))
    io.out(`video: ${plan.totalSeconds}s, ${plan.segments.length} segmentos${script.ai ? ' (guion con IA)' : ''}`)
    return 0
  },

  async render(a, io) {
    const { out } = args(a)
    let mod: { render: RenderFn }
    try { mod = await importer() } catch (e) {
      // solo si falta el paquete se pide instalarlo; cualquier otro error se muestra tal cual
      const missing = (e as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' || /Cannot find (package|module)/.test(String((e as Error).message))
      io.err(missing ? 'instala @qa-pilot/video para generar videos' : `No se pudo cargar @qa-pilot/video: ${(e as Error).message}`)
      return 1
    }
    const [plan, facts, script] = ['plan', 'facts', 'script'].map(n => readJson(join(out, 'video', `${n}.json`)))
    if (!plan || !facts || !script) { io.err(`Faltan plan.json, facts.json o script.json en ${join(out, 'video')}: corre qa-pilot video script antes`); return 1 }
    const r = await mod.render({ out, plan: plan as VideoPlan, facts: facts as VideoFacts, script: script as VideoScript })
    io.out(`video: ${r.seconds}s`)
    return 0
  },

  async publish(a, io) {
    const { out, reason } = args(a)
    const ctx = githubContext(io)
    if (!ctx) return 1
    const pr = prFromEvent(ctx.event)
    if (!pr) { io.err('El evento no es de un pull request'); return 1 }
    const ev = obj(ctx.event) ? ctx.event : {}
    const label = ev.action === 'labeled' && obj(ev.label) && typeof ev.label.name === 'string' ? ev.label.name : undefined
    return videoPublish(ctx.gh, pr, out, reason, io, label)
  },
}

// solo archivos comunes y chicos: salen de un job que no es de fiar
function readFile(file: string): Buffer | null {
  try {
    const st = lstatSync(file)
    return st.isFile() && st.size <= MAX_VIDEO_BYTES ? readFileSync(file) : null
  } catch { return null }
}

// label: el evento fue poner ese label; si la decisión no es del head (o no hay), el PR recibe un aviso aparte
export async function videoPublish(gh: GitHub, pr: number, out: string, reason: string | undefined, io: Io, label?: string): Promise<number> {
  const sha = readDecision(out)?.sha ?? (await gh.getPr(pr)).headSha
  const failed = { failed: reason?.slice(0, 200) || 'no se pudo generar el video' }
  const done = async (r: Awaited<ReturnType<typeof publishVideo>>) => {
    io.out(r)
    if (label && r !== 'updated') {
      await gh.comment(pr, `qa-pilot: el label ${label} llegó antes de que terminara la corrida de este commit; quítalo y vuelve a ponerlo cuando salga la decisión.`)
    }
    return 0
  }
  // con --reason el render no terminó bien: lo que haya en video/ no es de fiar y no se publica
  if (reason) return done(await publishVideo(gh, pr, sha, failed))
  const dir = join(out, 'video')
  const mp4 = readFile(join(dir, 'video.mp4'))
  const gif = readFile(join(dir, 'preview.gif'))
  const meta = existsSync(join(dir, 'video.json')) ? readJson(join(dir, 'video.json')) : undefined
  const seconds = obj(meta) && typeof meta.seconds === 'number' && Number.isFinite(meta.seconds) ? meta.seconds : null
  const files = mp4 && gif && seconds !== null ? { mp4, gif, seconds } : failed
  return done(await publishVideo(gh, pr, sha, files))
}

register('video', async (a, io) => {
  const [name, ...rest] = a
  const handler = name ? sub[name] : undefined
  if (!handler) { io.err('Uso: qa-pilot video <wanted|source|script|render|publish> [--root dir] [--out dir]'); return 1 }
  return handler(rest, io)
})
