import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { hasPermission } from '@/core/permissions/capabilities'
import { moderationApi, severityTone, type QueueItem } from '@/core/api/phase6'
import { qk } from '@/core/api/queryKeys'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { ApiError } from '@/core/api/errors'

/**
 * MODERATION, IN CONTEXT.
 *
 * Approved direction: a moderation event is part of the conversation, not a
 * destination. A message this conversation is holding, the rule that held it,
 * and the decision all sit here — directly above the composer, in the thread
 * the message belongs to — so an operator never leaves the conversation to
 * understand or act on one.
 *
 * ## What this is NOT
 *
 * It is not a second moderation system. Every byte of it goes through the same
 * `GET /moderation/queue?conversationId=…`, `POST /approvals/:id/approve` and
 * `POST /approvals/:id/reject` the queue page already used; the same
 * `messages.moderate` permission gates it; the server refuses exactly what it
 * refused before. The backlog queue at `/moderation` keeps its own existence,
 * because working forty held messages in a row is a different job from
 * deciding the one in front of you. This is a UX placement, not a redesign of
 * the workflow.
 *
 * ## Two rules carried over verbatim
 *
 * **The body is never truncated and never collapsed.** You cannot approve what
 * you cannot read, and a "show more" on an approval guarantees somebody
 * approves blind. A long message scrolls inside its own block.
 *
 * **Rejecting is one step slower than approving.** Approving is the common,
 * safe case and is one click. Rejecting opens a required reason field, because
 * the reason reaches the sender verbatim and is the only thing that makes a
 * rejection actionable.
 */
export function ConversationModeration({ conversationId }: { conversationId: string }) {
  const { t, locale } = useI18n()
  const qc = useQueryClient()
  const { permissions } = useSession()

  // UX affordance only. The server authorizes every one of these calls again,
  // and a person whose `messages.moderate` was denied individually sees
  // nothing here rather than a 403 after they have made a decision.
  const canModerate = hasPermission(permissions, 'messages.moderate')

  const filter = { conversationId }
  const queue = useQuery({
    queryKey: qk.moderationQueue(filter),
    queryFn: () => moderationApi.queue(filter),
    enabled: canModerate,
  })

  const decide = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      // The item leaves only when the server confirms. An approval that
      // silently failed is content that never reached a parent, and an
      // optimistic removal would hide exactly that.
      void qc.invalidateQueries({ queryKey: qk.moderationAll })
      void qc.invalidateQueries({ queryKey: qk.conversationMessages(conversationId) })
      void qc.invalidateQueries({ queryKey: qk.conversations })
    },
  })

  const items = queue.data ?? []
  if (!canModerate || items.length === 0) return null

  const error =
    decide.error instanceof ApiError
      ? decide.error.localized(locale)
      : decide.error
        ? t('common.offline')
        : null

  return (
    <section className="mod-strip" aria-label={t('moderation.inContext')}>
      <div className="mod-strip__head">
        <Icon name="shield" size={16} />
        <span>{t('moderation.inContext')}</span>
        <span className="mod-strip__count">{items.length}</span>
      </div>

      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}

      {items.map((item) => (
        <HeldMessage
          key={item.approvalId}
          item={item}
          busy={decide.isPending}
          onApprove={() => decide.mutate(() => moderationApi.approve(item.approvalId))}
          onReject={(reason) =>
            decide.mutate(() => moderationApi.reject(item.approvalId, reason))
          }
        />
      ))}
    </section>
  )
}

function HeldMessage({
  item,
  busy,
  onApprove,
  onReject,
}: {
  item: QueueItem
  busy: boolean
  onApprove: () => void
  onReject: (reason: string) => void
}) {
  const { t, duration } = useI18n()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  return (
    <article className="mod-item">
      <div className="mod-item__reasons">
        <strong style={{ fontSize: 'var(--type-body-sm)' }}>
          {t('moderation.by', { name: item.requestedByName ?? item.requestedBy })}
        </strong>
        {/* WHY it was held. A policy hold has no flags and says so, rather
            than showing an empty list that reads like a bug. */}
        {item.trigger === 'policy' ? (
          <Badge>{t('moderation.policyHold')}</Badge>
        ) : (
          item.flags.map((flag, index) => (
            <Badge key={index} tone={severityTone(flag.severity)}>
              {flag.ruleName}
            </Badge>
          ))
        )}
        {item.escalatedAt && <Badge tone="danger">{t('mode.escalation')}</Badge>}
        <span className="mod-strip__count">
          {/* The elapsed wait in the operator's own language. `humanDuration`
              from the queue page formats in English only, and an English
              "3h 12m" inside an Arabic strip is exactly the mixed-language
              seam the terminology rules exist to prevent. */}
          {t('moderation.waiting', { duration: duration(item.createdAt) })}
        </span>
      </div>

      <blockquote className="mod-item__body">
        {item.originalBody ?? <em>{t('common.none')}</em>}
      </blockquote>

      {!rejecting && (
        <div className="mod-item__actions">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onApprove}>
            {t('moderation.approve')}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setRejecting(true)}>
            {t('moderation.reject')}
          </button>
        </div>
      )}

      {rejecting && (
        <div className="mod-item__reason-field">
          <label className="field__label" htmlFor={`mod-reason-${item.approvalId}`}>
            {t('moderation.rejectReason')}
          </label>
          <input
            id={`mod-reason-${item.approvalId}`}
            className="field__input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="mod-item__actions">
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy || reason.trim() === ''}
              onClick={() => onReject(reason.trim())}
            >
              {t('moderation.reject')}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setRejecting(false)
                setReason('')
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
