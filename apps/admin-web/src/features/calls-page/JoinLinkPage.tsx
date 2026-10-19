import { Link, useParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ApiError } from '@/core/api/errors'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { adminSectionPath } from '@/features/admin/sections'
import { useCallActions, useCallsCopy, useConversationNaming, useConversations, useScheduledCall } from './hooks'
import { chatPathFor, isJoinable } from './model'
import { useNow } from './ScheduledCallCard'
import { StateBadge } from './CallsPage'
import './calls-page.css'

/**
 * `/calls/join/:scheduledCallId` -- where a members-only call link lands. It
 * asks the server for the call (404 for anyone who cannot read its chat, and
 * that is indistinguishable from "no such call"), shows it, and offers Join.
 * There is no guest path: this page exists only inside a signed-in session.
 */
export function JoinLinkPage() {
  const { scheduledCallId = '' } = useParams<{ scheduledCallId: string }>()
  const copy = useCallsCopy()
  const { dateTime } = useI18n()
  const { staff } = useSession()
  const query = useScheduledCall(scheduledCallId)
  const { byId } = useConversations()
  const name = useConversationNaming()
  const actions = useCallActions()
  const now = useNow()
  const callsPath = staff && isSuperAdmin(staff.role) ? adminSectionPath('calls') : '/calls'

  let body
  if (query.isLoading) {
    body = <LoadingState />
  } else if (query.error) {
    const missing = query.error instanceof ApiError && (query.error.isNotFound || query.error.isForbidden)
    body = missing ? (
      <EmptyState
        icon="link"
        title={copy.landingNotAvailable}
        action={
          <Link className="btn btn--sm" to={callsPath}>
            {copy.landingBackToCalls}
          </Link>
        }
      />
    ) : (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    )
  } else if (query.data) {
    const sc = query.data
    const conversation = byId.get(sc.conversationId)
    const label = sc.title ?? name(conversation, copy.landingTitle)
    const open = sc.state !== 'cancelled' && isJoinable(sc.joinableFrom, sc.joinableUntil, now)
    body = (
      <div className="cp-landing__card" role="group" aria-label={label}>
        <span className="cp-landing__glyph" aria-hidden="true">
          <Icon name={sc.kind === 'link' ? 'link' : 'calendar'} size={28} />
        </span>
        <h1 className="cp-landing__title">{label}</h1>
        {sc.title && conversation && <p className="cp-row__sub">{name(conversation)}</p>}
        <p className="cp-row__sub">{dateTime(sc.startsAt)}</p>
        <div className="cp-landing__badges">
          {sc.kind === 'link' && <Badge tone="info">{copy.linkBadge}</Badge>}
          <StateBadge state={sc.state} />
        </div>
        {sc.createdBy.displayName && <p className="cp-row__sub">{copy.cardBy(sc.createdBy.displayName)}</p>}
        <div className="cp-landing__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!open || !actions.available || actions.busy}
            onClick={() => void actions.join(sc)}
          >
            <Icon name="calls" size={16} />
            {copy.join}
          </button>
          <Link className="btn btn--ghost" to={chatPathFor(staff?.role, sc.conversationId)}>
            <Icon name="conversations" size={16} />
            {copy.openChat}
          </Link>
        </div>
        {!open && sc.state !== 'cancelled' && (
          <p className="cp-card__hint">{now < Date.parse(sc.joinableFrom) ? copy.cardNotOpenYet : copy.cardClosed}</p>
        )}
        <p className="cp-link__note">{copy.linkNote}</p>
      </div>
    )
  }

  return <div className="cp-landing">{body}</div>
}
