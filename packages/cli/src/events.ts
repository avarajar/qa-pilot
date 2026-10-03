import type { ApprovalEvent } from './publish.js'

type Event = {
  action?: string
  number?: number
  pull_request?: { number?: number }
  issue?: { number?: number; pull_request?: unknown }
  label?: { name?: string }
  comment?: { body?: string; user?: { login?: string } }
  sender?: { login?: string }
}

export function prFromEvent(raw: unknown): number | null {
  const ev = raw as Event
  if (ev.pull_request?.number) return ev.pull_request.number
  if (ev.issue?.pull_request && ev.issue.number) return ev.issue.number
  return null
}

export function approvalFromEvent(raw: unknown): ApprovalEvent | null {
  const ev = raw as Event
  if (ev.action === 'labeled' && ev.label?.name && ev.sender?.login) {
    return { action: 'labeled', actor: ev.sender.login, label: ev.label.name }
  }
  if (ev.action === 'created' && ev.comment?.body !== undefined && ev.comment.user?.login) {
    return { action: 'created', actor: ev.comment.user.login, comment: ev.comment.body }
  }
  return null
}
