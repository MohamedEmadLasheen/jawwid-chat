import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { useTypingIn } from '@/core/realtime/RealtimeProvider'
import { Badge } from '@/shared/components/Badge'
import { REACTION_EMOJI, type Conversation, type Message } from '@/shared/types/conversation'
import { useConversationMessages, useReadReceipts } from './hooks'
import { MessageActions } from './MessageActions'

/**
 * One conversation, as an operator reads it.
 *
 * Four kinds of entry must never be confusable, and that rule is carried over
 * unchanged from the thread this replaces:
 *   - customer-visible messages,
 *   - system event cards,
 *   - internal notes, which the family never sees,
 *   - withdrawn messages.
 *
 * Internal notes differ by colour, border style, a leading rule AND an explicit
 * label — never by colour alone.
 */
function MessageItem({
  message,
  conversation,
  viewerActorId,
}: {
  message: Message
  conversation: Conversation
  viewerActorId: string | null
}) {
  const { t, time, locale } = useI18n()
  const [showActions, setShowActions] = useState(false)

  const kind =
    message.deletedForAll ? 'deleted'
    : message.visibility === 'internal' ? 'internal'
    : message.authorKind === 'system' ? 'system'
    : message.authorKind === 'staff' ? 'staff'
    : 'contact'

  const authorName =
    conversation.members?.find((m) => m.actorId === message.authorId)?.displayName ?? ''

  /**
   * The strongest receipt across recipients.
   *
   * An operator's own message shows one state, and "read by somebody" is the
   * useful one — a family with two contacts should not read as unread because
   * the second parent has not opened it.
   */
  const receiptState = message.receipts.reduce<'sent' | 'delivered' | 'read'>((best, r) => {
    if (r.state === 'read') return 'read'
    if (r.state === 'delivered' && best === 'sent') return 'delivered'
    return best
  }, 'sent')

  const isMine = message.authorId !== null && message.authorId === viewerActorId

  return (
    <article
      className={`msg msg--${kind}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {kind === 'internal' && (
        <div className="msg__meta">
          <Badge tone="internal">{t('common.internalNote')}</Badge>
        </div>
      )}

      {message.isForwarded && !message.deletedForAll && (
        <div className="msg__meta">
          {/*
            Says only THAT it was forwarded, never from where: the source
            conversation is usually one this reader may not access, which is
            why the API serves a boolean rather than a reference.
          */}
          <span className="msg__forwarded">↪ {t('message.forwarded')}</span>
        </div>
      )}

      {/*
        A quote of a message that is gone, restricted, or hidden renders as a
        notice with no text. The server decided which; the console never
        substitutes an excerpt it was not given.
      */}
      {message.replyPreview && !message.deletedForAll && (
        <blockquote className="msg__quote">
          {message.replyPreview.available ? (
            <>
              <span className="msg__quote-author">
                {conversation.members?.find(
                  (m) => m.actorId === message.replyPreview?.authorId,
                )?.displayName ?? ''}
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

      <div className="msg__bubble">
        {message.deletedForAll ? (
          <em>{t('message.deleted')}</em>
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

      <div className="msg__meta">
        {authorName && <span>{authorName}</span>}
        {/* The SEND time. An edit does not move a message, so it must not
            look as though it did; "edited" beside it says the body changed. */}
        <span>{time(message.createdAt)}</span>
        {message.editedAt && <span className="msg__edited">{t('message.edited')}</span>}
        {/* Coverage and assist replies are labelled, so the family history
            stays readable months later: who answered, under what authority. */}
        {message.onBehalfMode && message.onBehalfMode !== 'owner' && (
          <Badge tone={message.onBehalfMode === 'assist' ? 'internal' : 'coverage'}>
            {t(`handling.${message.onBehalfMode}` as 'handling.coverage')}
          </Badge>
        )}
        {message.moderation === 'pending' && (
          <Badge tone="internal">{t('message.pendingApproval')}</Badge>
        )}
        {isMine && !message.deletedForAll && (
          // Icon plus an accessible label: state is never colour or glyph alone.
          <span className="msg__receipt" aria-label={t(`receipt.${receiptState}` as 'receipt.read')}>
            {receiptState === 'read' ? '✓✓' : receiptState === 'delivered' ? '✓✓' : '✓'}
          </span>
        )}
        {message.attachments.length > 0 && <span>📎 {message.attachments.length}</span>}
      </div>

      {/*
        Still rendered for a withdrawn message: the only action it offers is
        hiding the tombstone, which the API allows and the mobile client offers
        too.
      */}
      {showActions && (
        <MessageActions
          message={message}
          conversation={conversation}
          viewerActorId={viewerActorId}
          locale={locale}
        />
      )}
    </article>
  )
}

export function ConversationView({
  conversation,
  onReplyTo,
}: {
  conversation: Conversation
  onReplyTo: (message: Message) => void
}) {
  const { t } = useI18n()
  const { staff } = useSession()
  const viewerActorId = staff?.id ?? null

  const { messages, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useConversationMessages(conversation.id)
  const typing = useTypingIn(conversation.id)

  // Opening the conversation IS reading it, and holding the messages IS
  // receiving them. Both are asserted from here, where both are true.
  useReadReceipts(conversation.id, messages, viewerActorId)

  return (
    <div className="column__scroll">
      <div className="thread">
        {hasNextPage && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {t('common.loadMore')}
          </button>
        )}

        {!isLoading && messages.length === 0 && (
          <p className="empty">{t('conversation.empty')}</p>
        )}

        {messages.map((message) => (
          <div key={message.id} className="msg__row">
            <MessageItem
              message={message}
              conversation={conversation}
              viewerActorId={viewerActorId}
            />
            {!message.deletedForAll && message.moderation === 'published' && (
              <button
                type="button"
                className="btn btn--sm msg__reply"
                onClick={() => onReplyTo(message)}
              >
                {t('message.reply')}
              </button>
            )}
          </div>
        ))}

        {typing.length > 0 && (
          <p className="thread__typing" aria-live="polite">
            {typing.length === 1
              ? t('conversation.typingOne', { name: typing[0] ?? '' })
              : t('conversation.typingMany', { count: String(typing.length) })}
          </p>
        )}
      </div>
    </div>
  )
}

/** Re-exported so the reaction picker and the view share one list. */
export { REACTION_EMOJI }
