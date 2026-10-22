import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import type { SessionDto } from './api'
import { D, PLATFORM, useCopy } from './copy'

export function useDeviceName() {
  const tx = useCopy()
  return (s: SessionDto) => s.deviceName?.trim() || tx(PLATFORM[s.platform ?? 'unknown']) || tx(D.unknownDevice)
}

/**
 * PD-23: the sessions of one account as a table -- the staff member's own
 * (My devices) or, for an administrator, another account's (Accounts page).
 * `onSignOut` absent = no actions column. `compact` (a side panel) folds the
 * kind and the times under the device name, so the Sign out button is never
 * pushed out of a narrow panel.
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
  return (
    <div className="table-wrap">
      <table className="table dev-table">
        <thead>
          <tr>
            <th scope="col">{tx(D.device)}</th>
            {!compact && <th scope="col">{tx(D.platform)}</th>}
            {!compact && <th scope="col">{tx(D.signedIn)}</th>}
            {!compact && <th scope="col">{tx(D.lastActive)}</th>}
            {onSignOut && <th scope="col">{tx(D.actions)}</th>}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} data-session={s.id}>
              <td>
                <div className="dev-name" dir="auto">
                  <strong>{name(s)}</strong>
                  {s.current && <Badge tone="ok" dot>{tx(D.thisBrowser)}</Badge>}
                  {s.remembered && <Badge tone="outline">{tx(D.kept)}</Badge>}
                </div>
                {s.appVersion && (
                  <div className="field__hint" dir="auto">
                    {tx(D.app, { version: s.appVersion })}
                  </div>
                )}
                {compact && (
                  <div className="field__hint dev-meta">
                    <span>{tx(PLATFORM[s.platform ?? 'unknown'])}</span>
                    <span>
                      {tx(D.signedIn)}: {dateTime(s.signedInAt)}
                    </span>
                    <span>
                      {tx(D.lastActive)}: {s.lastSeenAt ? dateTime(s.lastSeenAt) : tx(D.notYet)}
                    </span>
                  </div>
                )}
              </td>
              {!compact && <td>{tx(PLATFORM[s.platform ?? 'unknown'])}</td>}
              {!compact && <td>{dateTime(s.signedInAt)}</td>}
              {!compact && <td>{s.lastSeenAt ? dateTime(s.lastSeenAt) : tx(D.notYet)}</td>}
              {onSignOut && (
                <td>
                  <button type="button" className="btn btn--sm btn--danger" onClick={() => onSignOut(s)}>
                    {tx(D.signOut)}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
