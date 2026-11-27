import { Avatar } from '@/shared/components/Avatar'
import { Icon, type IconName } from '@/shared/components/Icon'
import type { ChatConversation, ChatLastMessage } from './chatApi'
import type { ChatCopy } from './copy'

/** Shared presentation helpers for the chat workspace (list, thread, info). */

export const isGroup = (c: Pick<ChatConversation, 'type'>) => c.type !== 'direct'

/** A row's name: the group's own title, else the child, else the other members, else its kind. */
export function conversationName(c: ChatConversation, selfId: string | undefined, copy: ChatCopy): string {
  if (c.title) return c.title
  if (c.learner?.name) return c.learner.name
  const others = (c.members ?? []).filter((m) => m.actorId !== selfId && m.displayName)
  if (others.length > 0) return others.map((m) => m.displayName).join('، ')
  return copy.kind[c.type] ?? c.type
}

const CARD_FAMILIES = ['call', 'case', 'leave', 'trial', 'lesson'] as const

/**
 * The one-line preview under a row's name, worded by the client (never raw
 * JSON): what was said, and "You" when the viewer said it. Kept apart so the
 * line can take the direction of what was said, not of the word "You".
 */
export function previewParts(
  m: ChatLastMessage | null | undefined,
  selfId: string | undefined,
  copy: ChatCopy,
): { who: string | null; text: string } {
  if (!m) return { who: null, text: '' }
  if (m.deleted) return { who: null, text: copy.preview.deleted ?? '' }
  // A card has no text of its own: it is named by its family (a call, a lesson, a case...);
  // one this client does not know leaves the line to the row's fallback.
  const family = m.type === 'card' ? CARD_FAMILIES.find((f) => m.cardKind?.startsWith(`${f}_`)) : undefined
  const kind = family ? `card.${family}` : m.type
  const text = m.text ?? (m.systemKind ? (copy.system[m.systemKind] ?? copy.system.fallback)!({}) : copy.preview[kind] ?? '')
  return { who: text !== '' && m.authorId && m.authorId === selfId && !m.systemKind ? copy.you : null, text }
}

export function previewText(m: ChatLastMessage | null | undefined, selfId: string | undefined, copy: ChatCopy): string {
  const { who, text } = previewParts(m, selfId, copy)
  return who ? `${who}: ${text}` : text
}

/** The direction a line of text reads in, by its first letter; 'auto' when it has none. */
export function textDir(text: string): 'rtl' | 'ltr' | 'auto' {
  const first = /[A-Za-z\u00C0-\u024F\u0590-\u08FF\uFB1D-\uFEFC]/.exec(text)?.[0]
  if (!first) return 'auto'
  return /[\u0590-\u08FF\uFB1D-\uFEFC]/.test(first) ? 'rtl' : 'ltr'
}

/** A small glyph on the avatar says what kind of conversation it is. */
const TYPE_GLYPH: Record<string, IconName | undefined> = {
  student_group: 'users',
  class_group: 'academy',
  family_group: 'users',
  official: 'notifications',
  teacher_supervision: 'teams',
  trial_group: 'calendar',
  department_room: 'teams',
}

/**
 * The picture a conversation is shown with, WhatsApp-style: a 1:1 shows the
 * other person's photo, a group about one child shows the child's (the server
 * sends it as the group's `avatarUrl`, for family groups too). A group with
 * neither keeps its initials. `selfId` is the viewer.
 */
export function conversationPhoto(c: ChatConversation, selfId: string | undefined): string | null {
  if (c.type === 'direct') {
    const others = (c.members ?? []).filter((m) => m.actorId !== selfId)
    return others.length === 1 ? others[0]!.avatarUrl ?? null : null
  }
  return c.avatarUrl ?? c.learner?.avatarUrl ?? null
}

/**
 * Who a monogram stands for, said by its tint: a parent (gold), a teacher
 * (teal), a family still on trial (lilac), or Jawwid's own staff and rooms
 * (neutral). The tint is never the only cue: the kind glyph and the role word
 * say it too.
 */
export type WhoTone = 'parent' | 'teacher' | 'lead' | 'staff'

export const toneOfKind = (actorKind: string): WhoTone =>
  actorKind === 'contact' ? 'parent' : actorKind === 'teacher' ? 'teacher' : 'staff'

/** `members` is absent from some list rows; the type alone then decides. */
export function conversationTone(
  c: { type: string; familyId?: string | null; members?: Array<{ actorId: string; actorKind: string }> },
  selfId?: string,
): WhoTone {
  if (c.type === 'trial_group') return 'lead'
  if (c.type === 'teacher_supervision') return 'teacher'
  if (c.type === 'department_room' || c.type === 'official') return 'staff'
  if (c.type === 'direct') {
    const kinds = (c.members ?? []).filter((m) => m.actorId !== selfId).map((m) => m.actorKind)
    if (kinds.includes('contact')) return 'parent'
    if (kinds.includes('teacher')) return 'teacher'
    return kinds.length === 0 && c.familyId ? 'parent' : 'staff'
  }
  return 'parent'
}

export function ConversationAvatar({
  c,
  name,
  size,
  selfId,
}: {
  c: ChatConversation
  name: string
  size?: 'sm' | 'md' | 'lg'
  selfId?: string
}) {
  const glyph = TYPE_GLYPH[c.type]
  return (
    <span className={`typed-avatar cw-who cw-who--${conversationTone(c, selfId)}`}>
      <Avatar name={name} seed={c.id} size={size} src={conversationPhoto(c, selfId)} />
      {glyph && (
        <span className="typed-avatar__glyph" aria-hidden="true">
          <Icon name={glyph} size={11} />
        </span>
      )}
    </span>
  )
}

/**
 * A card's plain-text body is what the server wrote for clients that cannot
 * draw the card; it leads with a pictograph. The workspace shows the words only.
 */
export const cardFallbackText = (body: string) => body.replace(/[\p{Extended_Pictographic}\uFE0F]+[ \t]*/gu, '')

export const isMuted = (c: ChatConversation, now = Date.now()) => {
  const until = c.viewerState?.mutedUntil
  return !!until && new Date(until).getTime() > now
}

/** An indefinite mute, expressed exactly as the mobile app does: now + 3650 days. */
export const muteForeverUntil = (now = Date.now()) => new Date(now + 3650 * 86_400_000).toISOString()
