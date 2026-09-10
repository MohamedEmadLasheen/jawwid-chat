import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import type { Message } from '@/shared/types/domain'
import { VoiceMessage, isVoiceAttachment } from './VoiceMessage'

/**
 * One continuous thread per family (brief §8). Three kinds of entry must never
 * be confusable:
 *   - customer-visible messages,
 *   - system event cards,
 *   - internal notes, which the family never sees.
 *
 * Internal notes therefore differ by colour, border style, a leading rule AND
 * an explicit label — not by colour alone.
 */
function MessageItem({ message }: { message: Message }) {
  const { t, time } = useI18n()

  const voice = message.attachments.filter(isVoiceAttachment)
  const others = message.attachments.filter((a) => !isVoiceAttachment(a))

  const kind =
    message.visibility === 'internal' ? 'internal'
    : message.author_type === 'system' ? 'system'
    : message.author_type === 'staff' ? 'staff'
    : 'contact'

  return (
    <article className={`msg msg--${kind}`}>
      {kind === 'internal' && (
        <div className="msg__meta">
          <Badge tone="internal">{t('common.internalNote')}</Badge>
        </div>
      )}

      {/*
        A voice note is the message, not a decoration on it, so it renders inside
        the bubble. The bubble itself is unchanged: same surface, same radius,
        same author and time meta below.
      */}
      {(message.body || voice.length === 0) && (
        <div className="msg__bubble">{message.body}</div>
      )}
      {voice.map((attachment) => (
        <div className="msg__bubble" key={attachment.id}>
          <VoiceMessage attachment={attachment} />
        </div>
      ))}

      <div className="msg__meta">
        {message.author_name && <span>{message.author_name}</span>}
        <span>{time(message.created_at)}</span>
        {/*
          Coverage and assist replies are labelled so the family history stays
          readable months later: "who answered, and under what authority".
        */}
        {message.on_behalf_mode && message.on_behalf_mode !== 'owner' && (
          <Badge tone={message.on_behalf_mode === 'assist' ? 'internal' : 'coverage'}>
            {t(`handling.${message.on_behalf_mode}` as const)}
          </Badge>
        )}
        {/* Voice notes have their own player above; only other files are counted. */}
        {others.length > 0 && <span>📎 {others.length}</span>}
      </div>
    </article>
  )
}

export function Thread({
  messages,
  isLoading,
  hasMore,
  onLoadMore,
}: {
  messages: Message[]
  isLoading: boolean
  hasMore: boolean
  onLoadMore: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="column__scroll">
      <div className="thread">
        {hasMore && (
          <button type="button" className="btn btn--sm" onClick={onLoadMore} disabled={isLoading}>
            {t('common.loadMore')}
          </button>
        )}
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
      </div>
    </div>
  )
}
