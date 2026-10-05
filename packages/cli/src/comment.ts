import type { Decision } from './types.js'

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

// antes, después y diferencia de cada captura que cambió, con las imágenes que subió publish
function visualChanges(d: Decision): string[] {
  if (!d.evidence || !EVIDENCE_BASE.test(d.evidence)) return []
  const cell = (path?: string) => {
    if (!path || !EVIDENCE_PATH.test(path)) return '—'
    const url = `${d.evidence}${path}`
    return `<a href="${url}"><img src="${url}" width="220"></a>`
  }
  const rows = d.findings.flatMap(f => (f.images ?? []).map(img => ({ f, img })))
    .filter(({ img }) => [img.expected, img.actual, img.diff].some(p => p && EVIDENCE_PATH.test(p)))
  if (!rows.length) return []
  const lines = ['', '**Cambios visuales**', '', '| Captura | Antes | Después | Diferencia |', '|---|---|---|---|']
  for (const { f, img } of rows.slice(0, MAX_VISUAL_ROWS)) {
    const name = esc(String(img.name)).replace(/\|/g, '\\|') + (f.journey ? ` (${esc(f.journey)})` : '')
    lines.push(`| ${name} | ${cell(img.expected)} | ${cell(img.actual)} | ${cell(img.diff)} |`)
  }
  if (rows.length > MAX_VISUAL_ROWS) lines.push('', `<sub>${rows.length - MAX_VISUAL_ROWS} capturas más en el artifact qa-results</sub>`)
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
