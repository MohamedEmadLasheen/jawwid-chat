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

/** The one-line preview under a row's name, worded by the client (never raw JSON). */
export function previewText(m: ChatLastMessage | null | undefined, selfId: string | undefined, copy: ChatCopy): string {
  if (!m) return ''
  if (m.deleted) return copy.preview.deleted ?? ''
  const what = m.text ?? (m.systemKind ? (copy.system[m.systemKind] ?? copy.system.fallback)!({}) : copy.preview[m.type] ?? '')
  return m.authorId && m.authorId === selfId && !m.systemKind ? `${copy.you}: ${what}` : what
}

/** A small glyph on the avatar says what kind of conversation it is. */
const TYPE_GLYPH: Record<string, IconName | undefined> = {
  student_group: 'users',
  class_group: 'academy',
  family_group: 'users',
  official: 'notifications',
  teacher_supervision: 'teams',
  trial_group: 'calendar',
}

export function ConversationAvatar({ c, name, size }: { c: ChatConversation; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const glyph = TYPE_GLYPH[c.type]
  return (
    <span className="typed-avatar">
      <Avatar name={name} seed={c.id} size={size} />
      {glyph && (
        <span className="typed-avatar__glyph" aria-hidden="true">
          <Icon name={glyph} size={11} />
        </span>
      )}
    </span>
  )
}

export const isMuted = (c: ChatConversation, now = Date.now()) => {
  const until = c.viewerState?.mutedUntil
  return !!until && new Date(until).getTime() > now
}

/** An indefinite mute, expressed exactly as the mobile app does: now + 3650 days. */
export const muteForeverUntil = (now = Date.now()) => new Date(now + 3650 * 86_400_000).toISOString()
