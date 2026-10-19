import type { ChatConversation } from '@/features/chat/chatApi'
import type { ChatCopy } from '@/features/chat/copy'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { adminSectionPath } from '@/features/admin/sections'
import type { StaffRole } from '@/shared/types/domain'
import type { AccountCallRow } from './api'

/**
 * Pure helpers for the Calls page. Presentation only: none of them decides
 * whether anything is allowed -- the server answers that on every request.
 */

/** Name search: case-, diacritic- and tashkeel-insensitive. Names only, never numbers. */
export function nameMatches(name: string | null | undefined, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  if (!name) return false
  const norm = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ًͯ-ٰٟ]/g, '')
      .toLocaleLowerCase()
  return norm(name).includes(norm(q))
}

/** A conversation's name, as the chat list shows it. */
export function conversationLabel(c: ChatConversation, selfId: string | undefined, chat: ChatCopy): string {
  if (c.title) return c.title
  if (c.learner?.name) return c.learner.name
  const others = (c.members ?? []).filter((m) => m.actorId !== selfId && m.displayName)
  if (others.length > 0) return others.map((m) => m.displayName).join('، ')
  return chat.kind[c.type] ?? c.type
}

export const isGroupConversation = (c: ChatConversation | undefined): boolean => !!c && c.type !== 'direct'

/**
 * Who placed the call, from THIS account's side. The history row names the
 * initiator; the direction is only whether that is us.
 */
export function callDirection(row: AccountCallRow, selfId: string | undefined): 'outgoing' | 'incoming' {
  return selfId !== undefined && row.initiatorId === selfId ? 'outgoing' : 'incoming'
}

/**
 * A history row's name. A group call is named after its conversation (the
 * conversation list's title); a 1:1 after the other person, as the server
 * named them. Falls back to the conversation, then to the other participants.
 */
export function historyName(
  row: AccountCallRow,
  selfId: string | undefined,
  conversation: ChatConversation | undefined,
  chat: ChatCopy,
): string {
  const others = row.participants
    .filter((p) => p.actorId !== selfId && p.displayName)
    .map((p) => p.displayName as string)
  const isGroup = row.type === 'group' || isGroupConversation(conversation)
  if (isGroup) {
    if (conversation) return conversationLabel(conversation, selfId, chat)
    return others.join('، ') || chat.kind.student_group || ''
  }
  if (others.length > 0) return others[0]!
  if (conversation) return conversationLabel(conversation, selfId, chat)
  return chat.kind.direct ?? ''
}

/** Inside the join window? The server's answer to Join is still final. */
export function isJoinable(joinableFrom: string, joinableUntil: string, now: number = Date.now()): boolean {
  const from = Date.parse(joinableFrom)
  const until = Date.parse(joinableUntil)
  if (Number.isNaN(from) || Number.isNaN(until)) return false
  return now >= from && now <= until
}

/** Where a conversation opens for this role: the operator workspace, or the portal's. */
export function chatPathFor(role: StaffRole | undefined, conversationId: string): string {
  if (role && isSuperAdmin(role)) return `${adminSectionPath('conversations')}?c=${encodeURIComponent(conversationId)}`
  return `/chat/${encodeURIComponent(conversationId)}`
}

/** The members-only link a call link is shared as. */
export function joinLinkFor(scheduledCallId: string, origin: string = window.location.origin): string {
  return `${origin}/calls/join/${encodeURIComponent(scheduledCallId)}`
}

/** Local `<input type=date>` + `<input type=time>` values as an instant. */
export function localDateTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  const [h, mi] = time.split(':').map(Number) as [number, number]
  const at = new Date(y, mo - 1, d, h, mi, 0, 0)
  return Number.isNaN(at.getTime()) ? null : at
}

const pad = (n: number) => String(n).padStart(2, '0')
export const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
