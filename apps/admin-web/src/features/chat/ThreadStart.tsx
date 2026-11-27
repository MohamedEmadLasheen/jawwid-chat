import { useMemo } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import type { ChatConversation } from './chatApi'
import { Icon } from '@/shared/components/Icon'
import { ConversationAvatar, conversationName, isGroup, previewParts } from './chatView'
import { chatCopyFor } from './copy'
import { Badge } from '@/shared/components/Badge'
import { asksViewer, isUnseenSummons, waitTone, waitedFor, waitingFirst } from './queue'

export { waitingFirst } from './queue'

/** How many of the queue the pane lists before it says "and N more". */
const SHOWN = 6

/**
 * The thread pane before a conversation is chosen: the reply queue. The
 * conversations owed an answer as large rows (who, the last message, how long
 * it has waited), each opened with one button; the first is the one to take
 * now. With nobody waiting it says so in one line and lists what is unread.
 */
export function ThreadStart({ conversations, onOpen }: { conversations: ChatConversation[]; onOpen: (id: string) => void }) {
  const { locale, number, dateTime } = useI18n()
  const copy = chatCopyFor(locale)
  const { staff } = useSession()
  const waiting = useMemo(() => waitingFirst(conversations), [conversations])
  // The same "needs" as the list's: owed an answer, or asked in (a summons).
  const needs = waiting.filter(asksViewer)
  const unread = waiting.filter((c) => !asksViewer(c))
  const queue = needs.length > 0 ? needs : unread
  const shown = queue.slice(0, SHOWN)

  return (
    <div className="cw-start">
      <div className="cw-queue">
        <header className="cw-queue__head">
          {needs.length > 0 ? (
            <>
              <h2 className="cw-queue__title">
                {copy.section.needs}
                <span className="count count--urgent">{number(needs.length)}</span>
              </h2>
              {/* The order is named by need, so the first row reads as the one to take now. */}
              <p className="cw-queue__sub">{copy.queueOrder}</p>
            </>
          ) : (
            <h2 className="cw-queue__title cw-queue__title--calm">{copy.startNone}</h2>
          )}
          {needs.length === 0 && unread.length > 0 && (
            <p className="cw-queue__sub">
              {copy.section.unread}
              <span className="count">{number(unread.length)}</span>
            </p>
          )}
          {waiting.length === 0 && <p className="cw-queue__sub">{copy.pick}</p>}
        </header>

        {shown.length > 0 && (
          <ol className="cw-queue__list sheet">
            {shown.map((c, i) => {
              const name = conversationName(c, staff?.id, copy)
              const said = previewParts(c.lastMessage, staff?.id, copy, isGroup(c) ? c.members : undefined)
              const age = waitedFor(c.lastActivityAt, locale)
              return (
                <li key={c.id} className="cw-queue__row">
                  <ConversationAvatar c={c} name={name} selfId={staff?.id} />
                  <div className="cw-queue__who">
                    <h3 className="cw-queue__name">
                      <bdi>{name}</bdi>
                    </h3>
                    <p className="cw-queue__said">
                      {said.who && (
                        <span>
                          <bdi>{said.who}</bdi>:
                        </span>
                      )}
                      <bdi className="cw-line">{said.text || (copy.kind[c.type] ?? c.type)}</bdi>
                    </p>
                  </div>
                  {isUnseenSummons(c) && !c.needsReply ? (
                    <Badge tone="info">{copy.mentionedBadge}</Badge>
                  ) : c.needsReply ? (
                    <span className={`cw-queue__waited cw-wait--${waitTone(c.lastActivityAt)}`} title={dateTime(c.lastActivityAt)} aria-label={copy.waitedLabel(age)}>
                      <Icon name="hourglass" size={16} />
                      {age}
                    </span>
                  ) : (
                    <span className="cw-unread" aria-label={copy.unread(c.unreadCount ?? 0)}>
                      {number(c.unreadCount ?? 0)}
                    </span>
                  )}
                  {/* One solid button on the pane: the conversation to take now. */}
                  <button type="button" className={i === 0 ? 'btn btn--primary' : 'btn btn--ghost'} onClick={() => onOpen(c.id)} aria-label={`${copy.queueOpen}: ${name}`}>
                    {copy.queueOpen}
                  </button>
                </li>
              )
            })}
          </ol>
        )}
        {queue.length > shown.length && <p className="cw-queue__more">{copy.startMore(queue.length - shown.length)}</p>}
      </div>

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
      </p>
    </div>
  )
}
