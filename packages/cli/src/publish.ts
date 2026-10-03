import { MARKER, extractDecision, renderComment } from './comment.js'
import type { GitHub } from './github.js'
import type { Decision } from './types.js'

export const LABELS = {
  auto: 'qa:auto',
  needsHuman: 'qa:needs-human',
  blocked: 'qa:blocked',
  approved: 'qa:approved',
} as const

const FOR_DECISION: Record<Decision['decision'], string> = { auto: LABELS.auto, escalate: LABELS.needsHuman, blocked: LABELS.blocked }
const STATUS: Record<Decision['decision'], 'success' | 'pending' | 'failure'> = { auto: 'success', escalate: 'pending', blocked: 'failure' }
const DESCRIPTION: Record<Decision['decision'], string> = {
  auto: 'Aprobado automáticamente',
  escalate: 'Esperando aprobación humana',
  blocked: 'Hay checks en rojo',
}

export async function publish(gh: GitHub, pr: number, d: Decision): Promise<void> {
  const current = await gh.getPr(pr)
  const label = FOR_DECISION[d.decision]
  // una aprobación vale solo para el SHA que se vio: cada corrida nueva la quita
  const remove = [...Object.values(FOR_DECISION), LABELS.approved].filter(l => l !== label && current.labels.includes(l))
  await gh.setLabels(pr, current.labels.includes(label) ? [] : [label], remove)
  // primero el status: es lo que exige branch protection, y no depende de que el comentario quepa
  const gates = d.gates.map(g => g.id).join(', ')
  await gh.setStatus(d.sha, STATUS[d.decision], gates ? `${DESCRIPTION[d.decision]} (${gates})` : DESCRIPTION[d.decision])
  await gh.upsertComment(pr, MARKER, renderComment(d))
  if (d.decision === 'auto') await gh.enableAutoMerge({ number: pr, nodeId: current.nodeId, sha: d.sha })
}

export type ApprovalEvent = { action: 'labeled' | 'created'; actor: string; label?: string; comment?: string; commentId?: number }

export async function approveCheck(
  gh: GitHub,
  pr: number,
  ev: ApprovalEvent,
  approvers: string[],
): Promise<{ approved: boolean; reason: string }> {
  const asks = (ev.action === 'labeled' && ev.label === LABELS.approved) || (ev.action === 'created' && /^\/qa approve\b/.test(ev.comment?.trim() ?? ''))
  if (!asks) return { approved: false, reason: 'el evento no es una aprobación de qa-pilot' }
  const r = await validateApproval(gh, pr, ev, approvers)
  // el status y el merge no se ven en la conversación del PR: quien aprobó tiene que ver que pasó algo
  if (r.approved) {
    const current = await gh.getPr(pr)
    const remove = [LABELS.needsHuman].filter(l => current.labels.includes(l))
    await gh.setLabels(pr, current.labels.includes(LABELS.approved) ? [] : [LABELS.approved], remove)
    await gh.upsertComment(pr, MARKER, renderComment(r.decision, { approvedBy: ev.actor }))
    if (ev.commentId) await gh.react(ev.commentId, '+1')
    await gh.enableAutoMerge({ number: pr, nodeId: current.nodeId, sha: r.decision.sha })
    return { approved: true, reason: r.reason }
  }
  await gh.comment(pr, `qa-pilot: la aprobación de @${ev.actor} no se aplicó: ${r.reason}.`)
  if (ev.commentId) await gh.react(ev.commentId, '-1')
  return { approved: false, reason: r.reason }
}

async function validateApproval(
  gh: GitHub,
  pr: number,
  ev: ApprovalEvent,
  approvers: string[],
): Promise<{ approved: true; reason: string; decision: Decision } | { approved: false; reason: string }> {
  if (!approvers.some(a => a.toLowerCase() === ev.actor.toLowerCase())) return { approved: false, reason: `${ev.actor} no está en approvers de qa/qa-pilot.yaml` }

  const body = await gh.findComment(pr, MARKER)
  const d = body ? extractDecision(body) : null
  if (!d) return { approved: false, reason: 'no hay un comentario de decisión de qa-pilot válido en el PR' }
  if (d.decision !== 'escalate') return { approved: false, reason: `la decisión es ${d.decision}; solo se aprueba lo escalado` }

  const current = await gh.getPr(pr)
  if (d.sha !== current.headSha) {
    return { approved: false, reason: `la decisión es del commit ${d.sha.slice(0, 7)} pero el PR va en ${current.headSha.slice(0, 7)}; espera la corrida nueva` }
  }
  await gh.setStatus(d.sha, 'success', `Aprobado por ${ev.actor}`)
  return { approved: true, reason: `aprobado por ${ev.actor}`, decision: d }
}
