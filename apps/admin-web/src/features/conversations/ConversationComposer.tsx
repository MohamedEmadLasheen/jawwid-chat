import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { useRealtime } from '@/core/realtime/RealtimeProvider'
import { Icon } from '@/shared/components/Icon'
import type { Message } from '@/shared/types/conversation'
import { useMessageActions } from './hooks'

/**
 * THE COMPOSER.
 *
 * Two modes with deliberately different affordances: an internal note is
 * always available, because any family-facing admin may write one on any
 * conversation in scope; a customer-visible reply may be refused, and when it
 * is we say WHY rather than hiding the control — an off-duty admin should
 * understand she is off duty instead of thinking the console is broken (DD-10).
 *
 * "Why you cannot reply" comes from the SEND ERROR's code rather than from a
 * `capabilities` flag the API does not serve. That is more honest as well as
 * simpler: the server's refusal is the authority, and the console renders it
 * instead of predicting it.
 *
 * ## What the redesign changed
 *
 * Switching to an internal note recolours the ENTIRE composer, not just a tab.
 * The single most expensive mistake available on this screen is sending an
 * internal note to a family, and a violet field the operator can see from the
 * corner of their eye is worth more than a label they have already stopped
 * reading. It is the same violet, and the same rule, as the note itself.
 */
export function ConversationComposer({
  conversationId,
  replyingTo,
  onCancelReply,
}: {
  conversationId: string
  replyingTo: Message | null
  onCancelReply: () => void
}) {
  const { t, locale } = useI18n()
  const { setTyping } = useRealtime()
  const [visibility, setVisibility] = useState<'customer' | 'internal'>('customer')
  const [body, setBody] = useState('')
  const { send } = useMessageActions(conversationId)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isInternal = visibility === 'internal'

  /**
   * Typing is debounced to one frame per run of keystrokes.
   *
   * A frame per keystroke would fan out hundreds of frames to every participant
   * to communicate one bit, and the server's own TTL expects a refresh rather
   * than a stream.
   */
  const lastSent = useRef<number>(0)
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopTyping = () => {
    if (idle.current) clearTimeout(idle.current)
    idle.current = null
    if (lastSent.current === 0) return
    lastSent.current = 0
    setTyping(conversationId, false)
  }

  useEffect(() => {
    // Leaving the conversation — or the component — must not leave a phantom
    // "…is typing" on somebody else's screen.
    return stopTyping
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // A new conversation is a new draft. Carrying the previous one across is how
  // a reply meant for one family reaches another.
  useEffect(() => {
    setBody('')
    setVisibility('customer')
  }, [conversationId])

  /**
   * The field grows with the message, up to the cap in CSS.
   *
   * Reset to `auto` first: `scrollHeight` never shrinks below the current
   * height, so measuring without the reset makes a field that only ever grows.
   */
  useEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [body])

  const onChanged = (value: string) => {
    setBody(value)
    const now = Date.now()
    if (now - lastSent.current > 5_000) {
      lastSent.current = now
      setTyping(conversationId, true)
    }
    if (idle.current) clearTimeout(idle.current)
    idle.current = setTimeout(stopTyping, 3_000)
  }

  const submit = () => {
    const trimmed = body.trim()
    if (!trimmed || send.isPending) return
    send.mutate(
      {
        body: trimmed,
        visibility,
        replyToMessageId: replyingTo?.id,
      },
      {
        onSuccess: () => {
          setBody('')
          onCancelReply()
          // Sending IS stopping typing; leaving the indicator up until the
          // debounce expires would show the recipient a phantom.
          stopTyping()
        },
      },
    )
  }

  const refusal =
    send.error instanceof ApiError
      ? send.error.code === 'COMM.NOT_ON_DUTY'
        ? t('composer.notOnDuty')
        : send.error.localized(locale)
      : send.error
        ? t('common.offline')
        : null

  return (
    <div className={isInternal ? 'composer composer--internal' : 'composer'}>
      {replyingTo && (
        <div className="composer__reply">
          <Icon name="reply" size={16} />
          <span className="composer__reply-text">
            <span className="composer__reply-label">{t('message.replyingTo')}</span>
            <span className="composer__reply-body">{replyingTo.body}</span>
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('common.cancel')}
            onClick={onCancelReply}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <div className="composer__modes">
        <button
          type="button"
          className="composer__tab"
          aria-pressed={!isInternal}
          onClick={() => setVisibility('customer')}
        >
          {t('composer.customer')}
        </button>
        <button
          type="button"
          className="composer__tab composer__tab--internal"
          aria-pressed={isInternal}
          onClick={() => setVisibility('internal')}
        >
          <Icon name="lock" size={12} />
          {t('composer.internal')}
        </button>
      </div>

      <div className="composer__box">
        <textarea
          ref={inputRef}
          className="composer__input"
          rows={1}
          value={body}
          onChange={(event) => onChanged(event.target.value)}
          placeholder={isInternal ? t('composer.internalPlaceholder') : t('composer.placeholder')}
          aria-label={isInternal ? t('composer.internal') : t('composer.customer')}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. The obvious productivity win.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button
          type="button"
          className="composer__send"
          disabled={!body.trim() || send.isPending}
          aria-label={send.isPending ? t('composer.sending') : t('composer.send')}
          title={send.isPending ? t('composer.sending') : t('composer.send')}
          onClick={submit}
        >
          <Icon name="send" size={20} className="composer__send-icon" />
        </button>
      </div>

      {refusal && (
        <div className="field__error" role="alert">
          {refusal}
        </div>
      )}

      <div className="composer__footer">
        {isInternal && <span>{t('composer.internalPlaceholder')}</span>}
        <span className="composer__hint">
          <span className="composer__kbd">Enter</span> {t('composer.send')}
        </span>
      </div>
    </div>
  )
}
