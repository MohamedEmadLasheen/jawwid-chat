import { useEffect, useState } from 'react'
import { Icon } from '@/shared/components/Icon'
import { useCallActions, useCallsCopy } from './hooks'
import { isJoinable } from './model'
import './calls-page.css'

/** The scheduled-call card kinds (PD-13). Any other card falls back to its body text. */
export const SCHEDULED_CALL_CARD_KINDS: ReadonlySet<string> = new Set([
  'call_scheduled',
  'call_link',
  'call_schedule_cancelled',
])

export interface ScheduledCallCardPayload {
  scheduledCallId: string
  kind: string | null
  title: string | null
  startsAt: string | null
  joinableFrom: string | null
  joinableUntil: string | null
  when: string | null
  byName: string | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/** A card payload reduced to what is drawn; null when it cannot be (then the body is shown). */
export function readScheduledCallCard(payload: Record<string, unknown> | null | undefined): ScheduledCallCardPayload | null {
  const p = payload ?? {}
  const scheduledCallId = str(p.scheduledCallId)
  if (!scheduledCallId) return null
  return {
    scheduledCallId,
    kind: str(p.kind),
    title: str(p.title),
    startsAt: str(p.startsAt),
    joinableFrom: str(p.joinableFrom),
    joinableUntil: str(p.joinableUntil),
    when: str(p.when),
    byName: str(p.byName),
  }
}

/** Re-reads the clock now and then, so a Join button opens and closes on time. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

/**
 * A scheduled call or call link, drawn inside a chat thread. The card's words
 * were written once by the server (`when` is already in the academy's zone);
 * the Join button is enabled only inside [joinableFrom, joinableUntil], and the
 * server's answer to Join is final either way.
 */
export function ScheduledCallCard({
  cardKind,
  card,
  conversationId,
}: {
  cardKind: string
  card: ScheduledCallCardPayload
  conversationId: string
}) {
  const copy = useCallsCopy()
  const actions = useCallActions()
  const now = useNow()
  const cancelled = cardKind === 'call_schedule_cancelled'
  const isLink = cardKind === 'call_link'
  const open = !!card.joinableFrom && !!card.joinableUntil && isJoinable(card.joinableFrom, card.joinableUntil, now)
  const notYet = !!card.joinableFrom && now < Date.parse(card.joinableFrom)
  const heading = cancelled ? copy.cardCancelled : isLink ? copy.cardLink : copy.cardScheduled

  return (
    <div
      className={cancelled ? 'cp-card cp-card--muted' : 'cp-card'}
      data-card-kind={cardKind}
      role="group"
      aria-label={heading}
    >
      <div className="cp-card__head">
        <span className="cp-card__glyph" aria-hidden="true">
          <Icon name={isLink ? 'link' : 'calendar'} size={18} />
        </span>
        <strong className="cp-card__heading">{heading}</strong>
      </div>
      {card.title && <div className="cp-card__title">{card.title}</div>}
      {card.when && !isLink && <div className="cp-card__line">{copy.cardWhen(card.when)}</div>}
      {card.byName && <div className="cp-card__line cp-card__line--sub">{copy.cardBy(card.byName)}</div>}
      {!cancelled && (
        <div className="cp-card__actions">
          <button
            type="button"
            className="btn btn--sm btn--primary"
            disabled={!open || !actions.available || actions.busy}
            onClick={() => void actions.join({ id: card.scheduledCallId, conversationId, title: card.title })}
          >
            <Icon name="calls" size={16} />
            {copy.join}
          </button>
          {!open && (
            <span className="cp-card__hint">{notYet ? copy.cardNotOpenYet : copy.cardClosed}</span>
          )}
        </div>
      )}
    </div>
  )
}
