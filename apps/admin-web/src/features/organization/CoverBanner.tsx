import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import type { Cover } from './api'
import { T, describeError, useCopy } from './copy'
import { useEndCover, useExtendCover, useMyCover } from './hooks'
import { HandOverDialog } from './HandOverDialog'
import './organization.css'

/** Extend (one tap: the same window again) and End cover now, as this viewer may. */
export function CoverActions({ cover }: { cover: Cover }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const extend = useExtendCover()
  const end = useEndCover()
  const error = extend.error ?? end.error
  if (!cover.canExtend && !cover.canEnd) return null
  return (
    <span className="cover-actions">
      {cover.canExtend && (
        <button type="button" className="btn btn--sm" disabled={extend.isPending} onClick={() => extend.mutate(cover.id)}>
          {tx(T.extend)}
        </button>
      )}
      {cover.canEnd && (
        <button type="button" className="btn btn--sm btn--ghost" disabled={end.isPending} onClick={() => end.mutate(cover.id)}>
          {tx(T.endNow)}
        </button>
      )}
      {error ? (
        <span className="field__error" role="alert">
          {describeError(error, locale)}
        </span>
      ) : null}
    </span>
  )
}

/**
 * PD-33 on the supervisor's own home (the chat workspace): "I'm away" for an
 * Operations primary supervisor; while away, who covers and until when; for a
 * backup, whom they cover. Nothing renders for anyone else.
 */
export function MyCoverBanner() {
  const tx = useCopy()
  const { date } = useI18n()
  const { staff } = useSession()
  // Supervisors (admin) and backup supervisors (coverage); managers act from the Organization page.
  const enabled = !!staff && (staff.role === 'admin' || staff.role === 'coverage')
  const mine = useMyCover(enabled)
  const [handingOver, setHandingOver] = useState(false)
  if (!enabled || !mine.data || !staff) return null
  const { away, covering, canHandOver } = mine.data

  return (
    <>
      {away ? (
        <div className="banner banner--info cover-banner" role="status">
          <span dir="auto">
            {away.status === 'scheduled'
              ? tx(T.scheduled, { backup: away.backup.name, date: date(away.startsAt) })
              : tx(T.awayBanner, { backup: away.backup.name, date: date(away.endsAt) })}
          </span>
          <CoverActions cover={away} />
        </div>
      ) : canHandOver ? (
        <div className="cover-banner cover-banner--quiet">
          <button type="button" className="btn btn--sm" onClick={() => setHandingOver(true)}>
            {tx(T.imAway)}
          </button>
        </div>
      ) : null}
      {covering
        .filter((c) => c.status === 'active')
        .map((c) => (
          <div key={c.id} className="banner banner--info cover-banner" role="status">
            <span dir="auto">{tx(T.coveringBanner, { name: c.supervisor.name, date: date(c.endsAt) })}</span>
            <CoverActions cover={c} />
          </div>
        ))}
      {handingOver && (
        <HandOverDialog supervisor={{ id: staff.id, name: staff.name }} onClose={() => setHandingOver(false)} />
      )}
    </>
  )
}
