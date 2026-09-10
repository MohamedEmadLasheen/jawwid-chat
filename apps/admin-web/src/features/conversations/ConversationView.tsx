import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { useTypingIn } from '@/core/realtime/RealtimeProvider'
import { Icon } from '@/shared/components/Icon'
import { REACTION_EMOJI, type Conversation, type Message } from '@/shared/types/conversation'
import { memberName } from './conversationDisplay'
import { presentSystemMessage } from './systemMessage'
import { useConversationMessages, useReadReceipts } from './hooks'
import { MessageActions } from './MessageActions'

/**
 * THE THREAD.
 *
 * Four kinds of entry must never be confusable, and that rule is older than
 * this redesign — what the redesign changes is how loudly each one says which
 * it is:
 *
 *   family message   incoming bubble, surface + hairline, tail on the
 *                    reading-start corner
 *   staff message    outgoing bubble, brand tint, tail on the reading-end
 *                    corner, delivery state in the footer
 *   internal note    NOT a bubble. Full-width violet block, 3px leading edge,
 *                    an explicit label row (DD-05). Four independent signals —
 *                    width, hue, edge, words — so it survives greyscale, a
 *                    colour-blind reader and a hurried glance.
 *   system event     a centred card, no author and no avatar
 *
 * Bubble sides are expressed with `flex-start` / `flex-end` and the corner with
 * `border-start-start-radius`, so the whole thread mirrors under RTL rather
 * than being mirrored by a second set of rules.
 */
function MessageItem({
  message,
  conversation,
  viewerActorId,
  showAuthor,
  onReplyTo,
}: {
  message: Message
  conversation: Conversation
  viewerActorId: string | null
  showAuthor: boolean
  onReplyTo: (message: Message) => void
}) {
  const { t, time, locale } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)

  const kind = kindOf(message)
  const isStaffSide = kind === 'staff'
  const authorName = memberName(conversation, message.authorId)

  /**
   * The strongest receipt across recipients.
   *
   * "Read by somebody" is the useful state: a family with two contacts should
   * not read as unread because the second parent has not opened it.
   */
  const receiptState = message.receipts.reduce<'sent' | 'delivered' | 'read'>((best, r) => {
    if (r.state === 'read') return 'read'
    if (r.state === 'delivered' && best === 'sent') return 'delivered'
    return best
  }, 'sent')

  const isMine = message.authorId !== null && message.authorId === viewerActorId
  const isPending = message.moderation === 'pending'

  const bubbleClasses = [
    'msg',
    `msg--${kind}`,
    isPending && kind !== 'internal' ? 'msg--pending' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={`msg__row msg__row--${kind}`}>
      <article className={bubbleClasses}>
        {/* A group conversation needs the speaker's name; a two-party one does
            not, and repeating it on every bubble is noise. */}
        {showAuthor && kind === 'contact' && authorName && (
          <div className="msg__author">{authorName}</div>
        )}

        <div className="msg__bubble">
          {kind === 'internal' && (
            <div className="msg__internal-label">
              <Icon name="lock" size={14} />
              <span>
                {t('common.internalNote')}
                {authorName ? ` · ${authorName}` : ''}
              </span>
            </div>
          )}

          {message.isForwarded && !message.deletedForAll && (
            /*
              Says only THAT it was forwarded, never from where: the source
              conversation is usually one this reader may not access, which is
              why the API serves a boolean rather than a reference.
            */
            <div className="msg__forwarded">
              <Icon name="reply" size={12} /> {t('message.forwarded')}
            </div>
          )}

          {/*
            A quote of a message that is gone, restricted, or hidden renders as
            a notice with no text. The server decided which; the console never
            substitutes an excerpt it was not given.
          */}
          {message.replyPreview && !message.deletedForAll && (
            <blockquote className="msg__quote">
              {message.replyPreview.available ? (
                <>
                  <span className="msg__quote-author">
                    {memberName(conversation, message.replyPreview.authorId)}
                  </span>
                  <span className="msg__quote-body">{message.replyPreview.excerpt}</span>
                </>
              ) : (
                <span className="msg__quote-body msg__quote-body--gone">
                  {message.replyPreview.unavailableReason === 'deleted'
                    ? t('message.quoteDeleted')
                    : t('message.quoteUnavailable')}
                </span>
              )}
            </blockquote>
          )}

          {message.deletedForAll ? (
            <em>{t('message.deleted')}</em>
          ) : kind === 'system' ? (
            // NEVER `message.body` for a system event. The server stores the
            // event as a JSON payload, and printing it is how an operator ends
            // up reading `{"kind":"group.created",…}` in a family's history.
            <SystemMessageBody body={message.body} />
          ) : (
            message.body
          )}
        </div>

        {message.reactions.length > 0 && !message.deletedForAll && (
          <div className="msg__reactions">
            {Object.entries(
              message.reactions.reduce<Record<string, { count: number; mine: boolean }>>(
                (acc, r) => {
                  const entry = acc[r.emoji] ?? { count: 0, mine: false }
                  acc[r.emoji] = {
                    count: entry.count + 1,
                    mine: entry.mine || r.actorId === viewerActorId,
                  }
                  return acc
                },
                {},
              ),
            ).map(([emoji, { count, mine }]) => (
              <span key={emoji} className={mine ? 'reaction reaction--mine' : 'reaction'}>
                {emoji}
                {count > 1 ? ` ${count}` : ''}
              </span>
            ))}
          </div>
        )}

        {kind !== 'system' && (
          <div className="msg__meta">
            {/* The SEND time. An edit does not move a message, so it must not
                look as though it did; "edited" beside it says the body
                changed. */}
            <span className="msg__time">{time(message.createdAt)}</span>
            {message.editedAt && <span className="msg__edited">{t('message.edited')}</span>}

            {/* Coverage and assist replies are labelled, so the family history
                stays readable months later: who answered, under what
                authority. `owner` is deliberately unlabelled — labelling the
                normal case makes it look exceptional. */}
            {message.onBehalfMode && message.onBehalfMode !== 'owner' && (
              <span
                className={
                  message.onBehalfMode === 'assist' ? 'chip chip--internal' : 'chip chip--brand'
                }
              >
                {t(`mode.${message.onBehalfMode}` as 'mode.coverage')}
              </span>
            )}

            {isPending && (
              <span className="chip chip--warning">
                <Icon name="clock" size={12} />
                {t('message.pendingApproval')}
              </span>
            )}

            {isStaffSide && isMine && !message.deletedForAll && !isPending && (
              // Ticks plus a real label: delivery state is never a glyph or a
              // colour on its own.
              <span
                className={
                  receiptState === 'read' ? 'msg__receipt msg__receipt--read' : 'msg__receipt'
                }
              >
                <span aria-hidden="true">{receiptState === 'sent' ? '✓' : '✓✓'}</span>
                <span className="sr-only">
                  {t(`receipt.${receiptState}` as 'receipt.read')}
                </span>
              </span>
            )}

            {message.attachments.length > 0 && (
              <span>📎 {message.attachments.length}</span>
            )}
          </div>
        )}
      </article>

      {/*
        Hover tools sit BESIDE the bubble, never over it: an operator deciding
        what to do with a message should never have a control covering the
        words they are deciding about. Kept in the DOM (and reachable by
        keyboard through :focus-within) rather than mounted on hover, so the
        thread does not reflow under the pointer.
      */}
      {kind !== 'system' && (
        <div
          className={
            menuOpen
              ? 'msg__tools msg__actions-anchor msg__tools--open'
              : 'msg__tools msg__actions-anchor'
          }
        >
          {!message.deletedForAll && message.moderation === 'published' && (
            <button
              type="button"
              className="icon-btn"
              aria-label={t('message.reply')}
              title={t('message.reply')}
              onClick={() => onReplyTo(message)}
            >
              <Icon name="reply" size={16} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={t('message.actions')}
            aria-expanded={menuOpen}
            title={t('message.more')}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name="more" size={16} />
          </button>

          {menuOpen && (
            <MessageActions
              message={message}
              conversation={conversation}
              viewerActorId={viewerActorId}
              locale={locale}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A system event, said in the reader's language.
 *
 * The mapping is a pure function in `systemMessage.ts`; this only chooses
 * between a localized sentence and a legacy plain-text body.
 */
function SystemMessageBody({ body }: { body: string | null }) {
  const { t } = useI18n()
  const presentation = presentSystemMessage(body)
  return presentation.kind === 'literal'
    ? <>{presentation.text}</>
    : <>{t(presentation.key, presentation.params)}</>
}

/** Which of the four kinds this message is. One place, so it cannot disagree. */
function kindOf(message: Message): 'deleted' | 'internal' | 'system' | 'staff' | 'contact' {
  if (message.deletedForAll) return 'deleted'
  if (message.visibility === 'internal') return 'internal'
  if (message.authorKind === 'system') return 'system'
  if (message.authorKind === 'staff') return 'staff'
  return 'contact'
}

export function ConversationView({
  conversation,
  onReplyTo,
}: {
  conversation: Conversation
  onReplyTo: (message: Message) => void
}) {
  const { t, date } = useI18n()
  const { staff } = useSession()
  const viewerActorId = staff?.id ?? null

  const { messages, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useConversationMessages(conversation.id)
  const typing = useTypingIn(conversation.id)

  // Opening the conversation IS reading it, and holding the messages IS
  // receiving them. Both are asserted from here, where both are true.
  useReadReceipts(conversation.id, messages, viewerActorId)

  const scrollRef = useRef<HTMLDivElement>(null)
  const lastSeenId = useRef<string | null>(null)

  /**
   * Land at the newest message, and stay there as new ones arrive.
   *
   * Only when the operator is already at the bottom: someone reading back
   * through history must not be yanked to the end by an arriving message
   * (DD-12). `scrollTop` is compared against a small threshold rather than
   * exactly, because sub-pixel layout makes exact equality unreliable.
   */
  useEffect(() => {
    const element = scrollRef.current
    if (!element || messages.length === 0) return

    const newest = messages[messages.length - 1]?.id ?? null
    if (newest === lastSeenId.current) return

    const isFirstPaint = lastSeenId.current === null
    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight
    lastSeenId.current = newest

    if (isFirstPaint || distanceFromBottom < 120) {
      element.scrollTop = element.scrollHeight
    }
  }, [messages])

  // A new conversation starts at its own bottom, not at the previous one's
  // scroll offset.
  useEffect(() => {
    lastSeenId.current = null
  }, [conversation.id])

  // `isPending` rather than `isLoading`: the gap between two retries reports
  // neither loading nor error, and falling through it would show "no messages
  // yet" for a conversation that simply has not answered.
  if (isPending) return <ThreadSkeleton />

  if (messages.length === 0) {
    return (
      <div className="thread" ref={scrollRef}>
        <div className="chat-empty">
          <span className="chat-empty__mark">
            <Icon name="chat" size={28} />
          </span>
          <span className="chat-empty__title">{t('conversation.empty')}</span>
          <span className="chat-empty__hint">{t('conversation.emptyHint')}</span>
        </div>
      </div>
    )
  }

  let previousDay = ''
  let previousAuthor = ''

  return (
    <div className="thread" ref={scrollRef}>
      {hasNextPage && (
        <button
          type="button"
          className="btn btn--sm thread__more"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
        </button>
      )}

      {messages.map((message) => {
        const day = message.createdAt.slice(0, 10)
        const isNewDay = day !== previousDay
        previousDay = day

        // Consecutive messages from one speaker are one turn: the name is
        // printed once, at the top of the run.
        const authorKey = `${message.authorKind}:${message.authorId ?? ''}`
        const showAuthor = isNewDay || authorKey !== previousAuthor
        previousAuthor = authorKey

        return (
          <div key={message.id}>
            {isNewDay && (
              <div className="thread__divider">
                <span className="thread__divider-label">
                  {relativeDay(message.createdAt, date, t)}
                </span>
              </div>
            )}
            <MessageItem
              message={message}
              conversation={conversation}
              viewerActorId={viewerActorId}
              showAuthor={showAuthor}
              onReplyTo={onReplyTo}
            />
          </div>
        )
      })}

      {typing.length > 0 && (
        <p className="thread__typing" aria-live="polite">
          {typing.length === 1
            ? t('conversation.typingOne', { name: typing[0] ?? '' })
            : t('conversation.typingMany', { count: String(typing.length) })}
        </p>
      )}
    </div>
  )
}

/**
 * "Today" and "Yesterday" by name, everything older by date.
 *
 * Compared on the LOCAL calendar day rather than by elapsed hours: a message
 * sent at 23:55 is yesterday's at 00:05, and an hours-based rule would still
 * call it today.
 */
function relativeDay(
  iso: string,
  date: (iso: string) => string,
  t: (key: 'thread.today' | 'thread.yesterday') => string,
): string {
  const then = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDay(then, today)) return t('thread.today')
  if (sameDay(then, yesterday)) return t('thread.yesterday')
  return date(iso)
}

/** Shape-matched to the thread it replaces: alternating sides, varied widths. */
export function ThreadSkeleton() {
  const widths = ['46%', '62%', '38%', '70%', '52%']
  return (
    <div className="thread" aria-hidden="true">
      {widths.map((width, index) => (
        <div
          key={index}
          className={`msg__row msg__row--${index % 2 === 0 ? 'contact' : 'staff'}`}
        >
          <div
            className="skeleton"
            style={{ inlineSize: width, blockSize: 48, borderRadius: 'var(--radius-lg)' }}
          />
        </div>
      ))}
    </div>
  )
}

/** Re-exported so the reaction picker and the view share one list. */
export { REACTION_EMOJI }
