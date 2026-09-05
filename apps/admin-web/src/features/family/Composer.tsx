import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { newIdempotencyKey, useSendMessage } from './hooks'
import type { FamilyCapabilities } from '@/shared/types/domain'

/**
 * Two modes with deliberately different affordances.
 *
 * Internal-note mode is always available: brief §5 says any admin may write an
 * internal note on any family at any time. Customer-reply mode is gated by the
 * server's `capabilities` — and when it is closed we say *why* rather than
 * silently hiding the control, so an off-duty admin understands she is off duty
 * instead of thinking the app is broken.
 */
export function Composer({
  familyId,
  capabilities,
  activeCaseId,
}: {
  familyId: string
  capabilities: FamilyCapabilities
  activeCaseId: string | null
}) {
  const { t, locale } = useI18n()
  const [visibility, setVisibility] = useState<'customer' | 'internal'>('customer')
  const [body, setBody] = useState('')
  const send = useSendMessage(familyId)

  const canSendCustomer = capabilities.can_send_customer_message
  const effectiveVisibility = canSendCustomer ? visibility : 'internal'
  const isInternal = effectiveVisibility === 'internal'

  const submit = () => {
    const trimmed = body.trim()
    if (!trimmed || send.isPending) return
    send.mutate(
      {
        body: trimmed,
        visibility: effectiveVisibility,
        case_id: activeCaseId,
        // Minted per submission so a retry cannot post twice.
        idempotencyKey: newIdempotencyKey(),
      },
      { onSuccess: () => setBody('') },
    )
  }

  return (
    <div className="composer">
      <div className="composer__tabs">
        <button
          type="button"
          className="composer__tab"
          aria-pressed={!isInternal}
          disabled={!canSendCustomer}
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
          {t('composer.internal')}
        </button>
      </div>

      {!canSendCustomer && (
        <div className="banner banner--info" style={{ paddingInline: 0 }}>
          {capabilities.assist_blocked_reason
            ? t('composer.assistBlocked', { reason: capabilities.assist_blocked_reason })
            : t('composer.notOnDuty')}
        </div>
      )}

      <textarea
        className={isInternal ? 'composer__input composer__input--internal' : 'composer__input'}
        value={body}
        onChange={(event) => setBody(event.target.value)}
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

      {send.error && (
        <div className="field__error" role="alert">
          {send.error instanceof ApiError ? send.error.localized(locale) : t('common.offline')}
        </div>
      )}

      <div className="composer__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!body.trim() || send.isPending}
          onClick={submit}
        >
          {send.isPending ? t('composer.sending') : t('composer.send')}
        </button>
        <span className="composer__hint">
          {isInternal ? t('composer.internalPlaceholder') : 'Enter ⏎'}
        </span>
      </div>
    </div>
  )
}
