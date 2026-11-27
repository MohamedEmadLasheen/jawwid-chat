import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { RowActions } from '@/shared/components/RowActions'
import type { SessionDto } from './api'
import { D, PLATFORM, useCopy } from './copy'

/** iOS reports a model code ("iPhone18,1"), not a name: show its family ("iPhone"). */
const APPLE_MODEL_CODE = /^(iPhone|iPad|iPod)\d+,\d+$/

export function readableDeviceName(name: string | null): string {
  const trimmed = name?.trim() ?? ''
  return APPLE_MODEL_CODE.exec(trimmed)?.[1] ?? trimmed
}

export function useDeviceName() {
  const tx = useCopy()
  return (s: SessionDto) => readableDeviceName(s.deviceName) || tx(PLATFORM[s.platform ?? 'unknown']) || tx(D.unknownDevice)
}

/**
 * PD-23: the sessions of one account, one row a device -- the staff member's
 * own (My devices) or, for an administrator, another account's (Accounts page).
 *
 * A row is the device and its kind, when it signed in and was last active as
 * one quiet line, and one action. The device in use comes first and is tagged.
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
  const { dateTime } = useI18n()
  const name = useDeviceName()
  // The server lists this browser first; the order is kept, and holds if it ever does not.
  const ordered = [...sessions].sort((a, b) => Number(b.current) - Number(a.current))
  return (
    <div className={compact ? 'table-wrap dev-list dev-list--compact' : 'dev-list'}>
      <table className="dev-table">
        <thead>
          <tr>
            <th scope="col">{tx(D.device)}</th>
            <th scope="col">{tx(D.lastActive)}</th>
            {onSignOut && <th scope="col">{tx(D.actions)}</th>}
          </tr>
        </thead>
        <tbody>
          {ordered.map((s) => (
            <tr key={s.id} data-session={s.id} className={s.current ? 'dev-row dev-row--current' : 'dev-row'}>
              <td className="dev-cell-what">
                <span className="dev-what">
                  <span className="dev-icon" aria-hidden="true">
                    <Icon name={s.platform === 'ios' || s.platform === 'android' ? 'device' : 'screen'} size={22} />
                  </span>
                  <span className="dev-what__text">
                    <span className="dev-name" dir="auto">
                      <strong>{name(s)}</strong>
                      {s.current && <Badge tone="info">{tx(D.thisBrowser)}</Badge>}
                      {s.remembered && <Badge tone="outline">{tx(D.kept)}</Badge>}
                    </span>
                    <span className="dev-kind">
                      <span>{tx(PLATFORM[s.platform ?? 'unknown'])}</span>
                      {s.appVersion && <span dir="auto">{tx(D.app, { version: s.appVersion })}</span>}
                    </span>
                  </span>
                </span>
              </td>
              <td className="dev-cell-when">
                <span className="dev-when">
                  <span>
                    {tx(D.signedIn)}: <time dateTime={s.signedInAt}>{dateTime(s.signedInAt)}</time>
                  </span>
                  <span>
                    {tx(D.lastActive)}: {s.lastSeenAt ? <time dateTime={s.lastSeenAt}>{dateTime(s.lastSeenAt)}</time> : tx(D.notYet)}
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
          ))}
        </tbody>
      </table>
    </div>
  )
}
