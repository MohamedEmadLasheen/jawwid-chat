import { useMemo } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { relativeTime } from '@/features/admin/copy'
import { Badge } from '@/shared/components/Badge'
import type { ChatConversation } from './chatApi'
import { ConversationAvatar, conversationName, previewText } from './chatView'
import { chatCopyFor } from './copy'

const at = (c: ChatConversation) => new Date(c.lastActivityAt).getTime()

/**
 * The conversations still owed an answer, the one to take first leading:
 * those the server marks as needing a reply before those merely unread, and
 * within each the one that has waited longest. The viewer's own archive and
 * closed conversations are left out, as the list's main view leaves them out.
 */
export function waitingFirst(conversations: ChatConversation[]): ChatConversation[] {
  return conversations
    .filter((c) => !c.viewerState?.archived && c.archivedAt === null && (c.needsReply || (c.unreadCount ?? 0) > 0))
    .sort((a, b) => Number(b.needsReply) - Number(a.needsReply) || at(a) - at(b))
}

/**
 * The thread pane before a conversation is chosen. Not a blank pane: it names
 * the conversation to answer first and opens it; when nothing is waiting it
 * says so in one line.
 */
export function ThreadStart({ conversations, onOpen }: { conversations: ChatConversation[]; onOpen: (id: string) => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const { staff } = useSession()
  const waiting = useMemo(() => waitingFirst(conversations), [conversations])
  const first = waiting[0]

  return (
    <div className="cw-start">
      {first ? (
        <div className="cw-start__first">
          {first.needsReply ? <Badge tone="now">{copy.needsReply}</Badge> : <Badge tone="info">{copy.startUnread}</Badge>}
          <div className="cw-start__who">
            <ConversationAvatar c={first} name={conversationName(first, staff?.id, copy)} selfId={staff?.id} />
            <h2 className="cw-start__name" dir="auto">
              {conversationName(first, staff?.id, copy)}
            </h2>
          </div>
          <p className="cw-start__preview">
            <span dir="auto">{previewText(first.lastMessage, staff?.id, copy) || (copy.kind[first.type] ?? first.type)}</span>
            <time dateTime={first.lastActivityAt}>{relativeTime(first.lastActivityAt, locale)}</time>
          </p>
          <div className="cw-start__actions">
            <button type="button" className="btn btn--primary" onClick={() => onOpen(first.id)}>
              {copy.startOpen}
            </button>
            {waiting.length > 1 && <span className="cw-start__more">{copy.startMore(waiting.length - 1)}</span>}
          </div>
        </div>
      ) : (
        <div className="cw-start__first">
          <p className="cw-start__none">{copy.startNone}</p>
          <p className="cw-start__hint">{copy.pick}</p>
        </div>
      )}
      <p className="cw-start__keys">
        <span>
          <kbd className="kbd">J</kbd>
          <kbd className="kbd">K</kbd>
          {copy.keysMove}
        </span>
        <span>
          <kbd className="kbd">Enter</kbd>
          {copy.keysOpen}
        </span>
        <span>
          <kbd className="kbd">Esc</kbd>
          {copy.keysBack}
        </span>
      </p>
    </div>
  )
}
