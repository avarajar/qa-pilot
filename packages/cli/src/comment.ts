import type { Decision, Snapshot } from './types.js'

export const MARKER = '<!-- qa-pilot:decision'

// las rutas de imágenes salen de resultados que controla el PR: solo PNG planos dentro de artifacts/
export const EVIDENCE_PATH = /^artifacts\/[A-Za-z0-9._-]+\.png$/
const EVIDENCE_BASE = /^https:\/\/[^\s"'<>]+\/$/
const MAX_VISUAL_ROWS = 10

const HEADLINE: Record<Decision['decision'], string> = {
  auto: '🟢 **Aprobado automáticamente.** Ningún gate activado.',
  escalate: '🟠 **Necesita un humano.**',
  blocked: '🔴 **Bloqueado.** Hay checks en rojo; el agente debe corregirlos.',
}

const GATE_NAMES: Record<string, string> = {
  G1: 'Ruta protegida', G2: 'Zona sensible del repo', G3: 'Cambia el oráculo', G4: 'Journey crítico',
  G5: 'Tamaño', SEC: 'Seguridad', AI: 'Revisor IA', ERR: 'Error de qa-pilot',
}

const ICON = { pass: '✅', warn: '⚠️', fail: '❌' } as const

// todo lo visible sale de mensajes de tests y rutas que controla el PR: sin esto un test
// podría escribir su propio "<!-- qa-pilot:decision ... -->" dentro del comentario
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderComment(d: Decision, opts: { approvedBy?: string } = {}): string {
  const approved = d.decision === 'escalate' && opts.approvedBy
  const lines = [`### qa-pilot`, '', approved ? `✅ **Aprobado por @${esc(opts.approvedBy!)}.**` : HEADLINE[d.decision]]
  if (d.gates.length) {
    lines.push('', '**Por qué escala**', '')
    for (const g of d.gates) lines.push(`- **${g.id} · ${GATE_NAMES[g.id] ?? esc(g.id)}:** ${esc(g.reason)}`)
  }
  const checks = Object.entries(d.checks)
  if (checks.length) {
    lines.push('', '| Check | Estado |', '|---|---|')
    for (const [name, status] of checks) lines.push(`| ${esc(name)} | ${ICON[status] ?? ''} ${esc(String(status))} |`)
  }
  lines.push(...visualChanges(d))
  if (d.findings.length) {
    lines.push('', '<details><summary>Hallazgos</summary>', '')
    for (const f of d.findings.slice(0, 30)) {
      lines.push(`- ${esc(f.check)} · ${esc(f.kind)}${f.journey ? ` (${esc(f.journey)})` : ''}: ${esc(f.message)}${f.file ? ` — ${esc(f.file)}` : ''}`)
    }
    lines.push('', '</details>')
  }
  if (d.decision === 'escalate' && !approved) lines.push('', 'Para aprobar: etiqueta `qa:approved` o comenta `/qa approve` (solo aprobadores de `qa/qa-pilot.yaml`).')
  lines.push('', `<sub>${d.diff.files} ${d.diff.files === 1 ? 'archivo' : 'archivos'} · +${d.diff.added} −${d.diff.removed} · ${d.sha.slice(0, 7)}</sub>`)
  if (d.omittedFindings) lines.push('', `<sub>${d.omittedFindings} hallazgos más en el artifact qa-results</sub>`)
  // dentro del JSON se escapan "<", ">" y "--": no puede abrir ni cerrar comentarios HTML
  const json = JSON.stringify(d).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/--/g, '\\u002d\\u002d')
  lines.push('', MARKER, json, '-->')
  return lines.join('\n')
}

// el resumen del cambio también sale del PR: solo se acepta con la forma que escribe el reporter
export function isChange(c: unknown): c is NonNullable<Snapshot['change']> {
  const v = c as Snapshot['change']
  return !!v && Number.isFinite(v.pixels) && Number.isFinite(v.percent) && typeof v.zone === 'string' && v.zone.length <= 60
}

export const isElements = (e: unknown): e is string[] =>
  Array.isArray(e) && e.length <= 6 && e.every(x => typeof x === 'string' && x.length <= 80)

// dentro de una celda de la tabla: escapado y sin romper columnas
const cellText = (s: string) => esc(s).replace(/\|/g, '\\|')

function changeText(snap: Snapshot): string {
  const c = snap.change
  if (!isChange(c)) return ''
  const amount = `${c.percent < 0.1 ? 'menos de 0,1 %' : `${String(c.percent).replace('.', ',')} %`} de la captura (${c.pixels} ${c.pixels === 1 ? 'píxel' : 'píxeles'})`
  if (isElements(snap.elements) && snap.elements.length) return `Cambió: ${cellText(snap.elements.join(', '))} · ${amount} · ${cellText(c.zone)}.`
  return `Cambió ${amount}, ${cellText(c.zone)}.`
}

// antes, después y diferencia de cada captura que cambió, con las imágenes que subió publish
function visualChanges(d: Decision): string[] {
  if (!d.evidence || !EVIDENCE_BASE.test(d.evidence)) return []
  const ok = (path?: string): path is string => !!path && EVIDENCE_PATH.test(path)
  const img = (src: string, href = src) => `<a href="${d.evidence}${href}"><img src="${d.evidence}${src}" width="220"></a>`
  const rows = d.findings.flatMap(f => (f.images ?? []).map(snap => ({ f, snap })))
    .filter(({ snap }) => [snap.expected, snap.actual, snap.diff, snap.marked].some(ok))
  if (!rows.length) return []
  const lines = ['', '**Cambios visuales**', '', '| Captura | Antes | Después | Diferencia |', '|---|---|---|---|']
  for (const { f, snap } of rows.slice(0, MAX_VISUAL_ROWS)) {
    const text = changeText(snap)
    const ai = typeof snap.ai === 'string' && snap.ai ? `<br>**${cellText(snap.ai.slice(0, 200))}** _(IA)_` : ''
    const name = cellText(String(snap.name)) + (f.journey ? ` (${esc(f.journey)})` : '') + ai + (text ? `<br><sub>${text}</sub>` : '')
    // en Después va la versión con la zona encerrada; el clic abre la captura limpia
    const after = ok(snap.marked) ? img(snap.marked, ok(snap.actual) ? snap.actual : snap.marked) : ok(snap.actual) ? img(snap.actual) : '—'
    lines.push(`| ${name} | ${ok(snap.expected) ? img(snap.expected) : '—'} | ${after} | ${ok(snap.diff) ? img(snap.diff) : '—'} |`)
  }
  if (rows.length > MAX_VISUAL_ROWS) lines.push('', `<sub>${rows.length - MAX_VISUAL_ROWS} capturas más en el artifact qa-results</sub>`)
  const marked = rows.some(({ snap }) => ok(snap.marked))
  const anyAi = rows.some(({ snap }) => typeof snap.ai === 'string' && snap.ai)
  lines.push('', `<sub>${anyAi ? '_(IA)_: descripción hecha por Claude mirando Antes y Después; puede equivocarse. ' : ''}${marked ? 'El recuadro rojo en **Después** marca la zona que cambió. ' : ''}En **Diferencia**, lo rojo son los píxeles distintos y lo amarillo, bordes suavizados que no cuentan. Clic en una imagen para verla en grande.</sub>`)
  return lines
}

export function extractDecision(body: string): Decision | null {
  // el bloque real es el último del comentario
  const start = body.lastIndexOf(MARKER)
  if (start < 0) return null
  const end = body.indexOf('-->', start + MARKER.length)
  if (end < 0) return null
  try {
    const d = JSON.parse(body.slice(start + MARKER.length, end).trim()) as Decision
    return d && d.version === 1 && typeof d.sha === 'string' ? d : null
  } catch {
    return null
  }
}
