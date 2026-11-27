import { useMemo, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon } from '@/shared/components/Icon'
import { RowActions } from '@/shared/components/RowActions'
import type { SessionDto } from './api'
import { D, PLATFORM, useCopy } from './copy'
import { useWhen } from './when'

/** iOS reports a model code ("iPhone18,1"), not a name: show its family ("iPhone"). */
const APPLE_MODEL_CODE = /^(iPhone|iPad|iPod)\d+,\d+$/

/** How many rows a long list shows before it asks to show the rest. */
const FIRST_ROWS = 25
/** Below this a list is read whole, so naming its devices as filters would only add noise. */
const KINDS_FROM = 8

export function readableDeviceName(name: string | null): string {
  const trimmed = name?.trim() ?? ''
  return APPLE_MODEL_CODE.exec(trimmed)?.[1] ?? trimmed
}

export function useDeviceName() {
  const tx = useCopy()
  return (s: SessionDto) => readableDeviceName(s.deviceName) || (s.platform ? tx(PLATFORM[s.platform]) : '') || tx(D.unknownDevice)
}

/** A session that names neither its device nor its kind: the one a person cannot recognise. */
const unrecognised = (s: SessionDto) => !readableDeviceName(s.deviceName) && !s.platform

/** Two times closer than this are one moment: the sign-in is not said apart from the last activity. */
const SAME_MOMENT_MS = 60 * 60_000

/**
 * PD-23: the sessions of one account, one row a session -- the staff member's
 * own (My devices) or, for an administrator, another account's (Accounts page).
 *
 * Built to answer "where am I signed in, and is anything unfamiliar?":
 *  - the device in use comes first, tinted and tagged, so the rest reads as "elsewhere";
 *  - a long list names its devices once, as filters with their counts, so an
 *    unfamiliar one stands out without reading every row, and narrows to it;
 *  - each row is one line: the device, its kind, when it was last active and
 *    when it signed in (as columns, so times compare down the list), one quiet action;
 *  - only the first rows are drawn until the reader asks for the rest.
 *
 * `onSignOut` absent = no action. `compact` (a side panel) sets the times
 * under the device, so the action is never pushed out of a narrow panel, and
 * gives the list a frame of its own; without it the list sits in its sheet.
 */
export function SessionList({
  sessions,
  onSignOut,
  compact = false,
}: {
  sessions: SessionDto[]
  onSignOut?: (session: SessionDto) => void
  compact?: boolean
}) {
  const tx = useCopy()
  const { number, locale } = useI18n()
  const when = useWhen()
  const name = useDeviceName()
  const [device, setDevice] = useState('all')
  const [all, setAll] = useState(false)
  // The server lists this browser first; the order is kept, and holds if it ever does not.
  const ordered = useMemo(() => [...sessions].sort((a, b) => Number(b.current) - Number(a.current)), [sessions])
  // The devices this account is signed in on, most sessions first.
  const kinds = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of ordered) counts.set(name(s), (counts.get(name(s)) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], locale))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered, locale])
  const showKinds = ordered.length >= KINDS_FROM && kinds.length > 1
  // A filter narrows the list to one device, the one in use included only when it is that device, so the count holds.
  const narrowed = device === 'all' || !showKinds ? ordered : ordered.filter((s) => name(s) === device)
  const shown = all ? narrowed : narrowed.slice(0, FIRST_ROWS)
  const hidden = narrowed.length - shown.length

  return (
    <div className={compact ? 'table-wrap dev-list dev-list--compact' : 'dev-list'}>
      {showKinds && (
        <div className="dev-kinds">
          <FilterChips
            label={tx(D.devicesFilter)}
            value={device}
            onChange={(v) => setDevice(v)}
            formatCount={number}
            options={[{ value: 'all', label: tx(D.allDevices), count: ordered.length }, ...kinds.map(([k, n]) => ({ value: k, label: k, count: n }))]}
          />
        </div>
      )}
      <table className="dev-table">
        <thead>
          <tr>
            <th scope="col">{tx(D.device)}</th>
            <th scope="col">{tx(D.lastActive)}</th>
            {onSignOut && (
              <th scope="col" className="cell-actions">
                <span className="sr-only">{tx(D.actions)}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => {
            const app = s.platform === 'ios' || s.platform === 'android'
            const unknown = unrecognised(s)
            // The sign-in is said apart only when it was not the same moment as the last activity.
            const signedInApart = !s.lastSeenAt || Math.abs(Date.parse(s.lastSeenAt) - Date.parse(s.signedInAt)) > SAME_MOMENT_MS
            return (
              <tr key={s.id} data-session={s.id} className={['dev-row', s.current ? 'dev-row--current' : '', unknown ? 'dev-row--unknown' : ''].filter(Boolean).join(' ')}>
                <td className="dev-cell-what">
                  <span className="dev-what">
                    <span className="dev-icon" aria-hidden="true">
                      <Icon name={unknown ? 'question' : app ? 'device' : 'screen'} size={18} />
                    </span>
                    <span className="dev-what__text">
                      <span className="dev-name">
                        <strong dir="auto">{name(s)}</strong>
                        {s.current && <Badge tone="info">{tx(D.thisBrowser)}</Badge>}
                        {s.remembered && <Badge tone="outline">{tx(D.kept)}</Badge>}
                      </span>
                      {/* The kind is said where the name does not say it already: an app, and its version. */}
                      {(app || s.appVersion) && (
                        <span className="dev-kind">
                          {app && <span>{tx(PLATFORM[s.platform!])}</span>}
                          {s.appVersion && <span dir="auto">{tx(D.app, { version: s.appVersion })}</span>}
                        </span>
                      )}
                    </span>
                  </span>
                </td>
                <td className="dev-cell-time" data-label={tx(D.lastActive)}>
                  {s.lastSeenAt ? <time dateTime={s.lastSeenAt}>{when(s.lastSeenAt, { start: true })}</time> : <span className="dev-none">{tx(D.notActiveYet)}</span>}
                  {signedInApart && (
                    <span className="dev-signed-in">
                      {tx(D.signedInOn, { when: when(s.signedInAt) })}
                    </span>
                  )}
                </td>
              {onSignOut && (
                <td className="cell-actions">
                  <RowActions
                    label={name(s)}
                    primary={
                      <button type="button" className="btn btn--sm dev-signout" onClick={() => onSignOut(s)}>
                        {tx(D.signOut)}
                      </button>
                    }
                  />
                </td>
              )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {hidden > 0 && (
        <p className="dev-foot">
          <span>{tx(D.showing, { shown: number(shown.length), total: number(narrowed.length) })}</span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setAll(true)}>
            {tx(D.showAll, { n: number(narrowed.length) })}
          </button>
        </p>
      )}
    </div>
  )
}
