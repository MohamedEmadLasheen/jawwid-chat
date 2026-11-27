import { useMemo, useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { RowActions } from '@/shared/components/RowActions'
import { countWords } from '@/features/instalments/copy'
import type { SessionDto } from './api'
import { D, PLATFORM, SESSIONS, useCopy } from './copy'
import { useWhen } from './when'

/** iOS reports a model code ("iPhone18,1"), not a name: show its family ("iPhone"). */
const APPLE_MODEL_CODE = /^(iPhone|iPad|iPod)\d+,\d+$/

/** How many sessions a device shows when opened, before it asks to show the rest. */
const FIRST_ROWS = 25
/** From this many sessions a list is read by device, not session by session. */
const GROUP_FROM = 8

export function readableDeviceName(name: string | null): string {
  const trimmed = name?.trim() ?? ''
  return APPLE_MODEL_CODE.exec(trimmed)?.[1] ?? trimmed
}

export function useDeviceName() {
  const tx = useCopy()
  return (s: SessionDto) => readableDeviceName(s.deviceName) || (s.platform ? tx(PLATFORM[s.platform]) : '') || tx(D.unknownDevice)
}

/** A session that names neither its device nor its kind: the one a person cannot recognise. */
export const isUnrecognised = (s: SessionDto) => !readableDeviceName(s.deviceName) && !s.platform
const unrecognised = isUnrecognised

/** Two times closer than this are one moment: the sign-in is not said apart from the last activity. */
const SAME_MOMENT_MS = 60 * 60_000

const lastActivity = (s: SessionDto) => Date.parse(s.lastSeenAt ?? s.signedInAt)

interface Group {
  name: string
  sessions: SessionDto[]
  current: boolean
  unknown: boolean
  latest: SessionDto
}

/**
 * PD-23: the sessions of one account -- the staff member's own (My devices)
 * or, for an administrator, another account's (Accounts page).
 *
 * Built to answer "where am I signed in, and is anything unfamiliar?":
 *  - a short list is read session by session, the device in use first, tinted and tagged;
 *  - a long one is read by device: one row a device (how many sessions, when
 *    last active), the device in use first, then any device that names neither
 *    itself nor its kind (an amber question mark), then the rest by how many
 *    sessions they hold. A device opens to its sessions, the first few until asked;
 *  - a session's line says when it was last active, and when it signed in only
 *    when that was another moment; one quiet action ends it.
 *
 * `onSignOut` absent = no action. `compact` (a side panel) gives the list a
 * frame of its own and keeps the action at the end of a narrow row.
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
  const name = useDeviceName()
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [whole, setWhole] = useState<Set<string>>(() => new Set())
  // The server lists this browser first; the order is kept, and holds if it ever does not.
  const ordered = useMemo(() => [...sessions].sort((a, b) => Number(b.current) - Number(a.current)), [sessions])
  const groups = useMemo<Group[]>(() => {
    const by = new Map<string, Group>()
    for (const s of ordered) {
      const key = name(s)
      const g = by.get(key) ?? { name: key, sessions: [], current: false, unknown: true, latest: s }
      g.sessions.push(s)
      g.current ||= s.current
      g.unknown &&= unrecognised(s)
      if (lastActivity(s) > lastActivity(g.latest)) g.latest = s
      by.set(key, g)
    }
    const rank = (g: Group) => (g.current ? 0 : g.unknown ? 1 : 2)
    return [...by.values()].sort((a, b) => rank(a) - rank(b) || b.sessions.length - a.sessions.length || a.name.localeCompare(b.name, locale))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered, locale])
  const grouped = ordered.length >= GROUP_FROM && groups.length > 1
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  const row = (s: SessionDto) => <SessionRow key={s.id} session={s} onSignOut={onSignOut} />

  return (
    <div className={compact ? 'table-wrap dev-list dev-list--compact' : 'dev-list'}>
      <table className={grouped ? 'dev-table dev-table--grouped' : 'dev-table'}>
        <thead>
          <tr>
            <th scope="col">{tx(D.device)}</th>
            {onSignOut && (
              <th scope="col" className="cell-actions">
                <span className="sr-only">{tx(D.actions)}</span>
              </th>
            )}
          </tr>
        </thead>
        {grouped ? (
          groups.map((g) => {
            const isOpen = open.has(g.name)
            const listed = whole.has(g.name) ? g.sessions : g.sessions.slice(0, FIRST_ROWS)
            return (
              <tbody key={g.name} className={isOpen ? 'dev-group dev-group--open' : 'dev-group'}>
                <tr className={['dev-group__head', g.unknown ? 'dev-row--unknown' : ''].filter(Boolean).join(' ')}>
                  <th scope="rowgroup" colSpan={onSignOut ? 2 : 1}>
                    <button type="button" className="dev-group__toggle" aria-expanded={isOpen} onClick={() => setOpen((o) => toggle(o, g.name))}>
                      <span className="dev-icon" aria-hidden="true">
                        <DeviceIcon session={g.latest} unknown={g.unknown} />
                      </span>
                      <span className="dev-what__text">
                        <span className="dev-name">
                          <strong dir="auto">{g.name}</strong>
                          {g.current && <Badge tone="info">{tx(D.thisBrowserIsOne)}</Badge>}
                        </span>
                        <span className="dev-when">
                          <ActiveWhen session={g.latest} />
                          <span>{countWords(g.sessions.length, SESSIONS, locale)}</span>
                        </span>
                      </span>
                      <span className="dev-group__chevron" aria-hidden="true">
                        <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={18} />
                      </span>
                    </button>
                  </th>
                </tr>
                {isOpen && listed.map(row)}
                {isOpen && listed.length < g.sessions.length && (
                  <tr className="dev-group__more">
                    <td colSpan={onSignOut ? 2 : 1}>
                      <span>{tx(D.showing, { shown: number(listed.length), total: number(g.sessions.length) })}</span>
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setWhole((w) => toggle(w, g.name))}>
                        {tx(D.showAll, { n: number(g.sessions.length) })}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            )
          })
        ) : (
          <tbody>{ordered.map(row)}</tbody>
        )}
      </table>
    </div>
  )
}

function DeviceIcon({ session: s, unknown }: { session: SessionDto; unknown: boolean }) {
  return <Icon name={unknown ? 'question' : s.platform === 'ios' || s.platform === 'android' ? 'device' : 'screen'} size={18} />
}

/** "Active today at 18:16", and the sign-in only when it was another moment. */
function ActiveWhen({ session: s }: { session: SessionDto }) {
  const tx = useCopy()
  const when = useWhen()
  const apart = !s.lastSeenAt || Math.abs(Date.parse(s.lastSeenAt) - Date.parse(s.signedInAt)) > SAME_MOMENT_MS
  return (
    <>
      <span>
        {s.lastSeenAt ? (
          <time dateTime={s.lastSeenAt}>{tx(D.activeWhen, { when: when(s.lastSeenAt) })}</time>
        ) : (
          tx(D.notActiveYet)
        )}
      </span>
      {apart && (
        <span>
          <time dateTime={s.signedInAt}>{tx(D.signedInOn, { when: when(s.signedInAt) })}</time>
        </span>
      )}
    </>
  )
}

/** One session: the device and its kind where the name does not say it, when, and one quiet way out. */
function SessionRow({ session: s, onSignOut }: { session: SessionDto; onSignOut?: (session: SessionDto) => void }) {
  const tx = useCopy()
  const name = useDeviceName()
  const app = s.platform === 'ios' || s.platform === 'android'
  const unknown = unrecognised(s)
  const facts: ReactNode[] = []
  if (app) facts.push(<span key="kind">{tx(PLATFORM[s.platform!])}</span>)
  if (s.appVersion) facts.push(<span key="app" dir="auto">{tx(D.app, { version: s.appVersion })}</span>)
  return (
    <tr data-session={s.id} className={['dev-row', s.current ? 'dev-row--current' : '', unknown ? 'dev-row--unknown' : ''].filter(Boolean).join(' ')}>
      <td className="dev-cell-what">
        <span className="dev-what">
          <span className="dev-icon" aria-hidden="true">
            <DeviceIcon session={s} unknown={unknown} />
          </span>
          <span className="dev-what__text">
            <span className="dev-name">
              <strong dir="auto">{name(s)}</strong>
              {s.current && <Badge tone="info">{tx(D.thisBrowser)}</Badge>}
              {s.remembered && <Badge tone="outline">{tx(D.kept)}</Badge>}
            </span>
            <span className="dev-when">
              {facts}
              <ActiveWhen session={s} />
            </span>
          </span>
        </span>
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
}
