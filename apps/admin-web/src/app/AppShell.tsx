import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { useRealtime } from '@/core/realtime/RealtimeProvider'
import { visibleAreas, type NavArea } from '@/core/permissions/capabilities'
import { Avatar } from '@/shared/components/Avatar'
import { Icon, type IconName } from '@/shared/components/Icon'

const AREA_PATH: Record<NavArea, string> = {
  console: '/console',
  directory: '/directory',
  groups: '/groups',
  labels: '/labels',
  stories: '/stories',
  broadcast: '/broadcasts',
  moderation: '/moderation',
  command: '/command-center',
  attention: '/attention',
  knowledge: '/knowledge',
  inbox: '/inbox',
  families: '/families',
  tasks: '/tasks',
  coverage: '/coverage',
  dashboard: '/dashboard',
  settings: '/settings',
}

/**
 * One icon per area, product-wide (`design-system.md` §6).
 *
 * The rail collapses to 64px below 1280 and the label goes with it, so the
 * glyph is not decoration: it is the whole control at that width. The frozen
 * brief-era areas are still mapped because the registry is exhaustive — they
 * are filtered out of the rail, not typed out of it.
 */
const AREA_ICON: Record<NavArea, IconName> = {
  console: 'chat',
  directory: 'families',
  groups: 'groups',
  labels: 'labels',
  stories: 'stories',
  broadcast: 'broadcast',
  moderation: 'moderation',
  command: 'command',
  attention: 'attention',
  knowledge: 'knowledge',
  inbox: 'chat',
  families: 'families',
  tasks: 'note',
  coverage: 'clock',
  dashboard: 'command',
  settings: 'info',
}

/** Nav is a data-driven registry: adding a module is one entry, not a refactor. */
function Nav() {
  const { t } = useI18n()
  const { staff } = useSession()
  if (!staff) return null

  return (
    <nav className="rail" aria-label={t('app.title')}>
      <div className="rail__group">
        {visibleAreas(staff.role, staff.department)
          // Settings has no page in MVP; it stays out of the rail until it does.
          .filter((area) => area !== 'settings')
          .map((area) => (
            <NavLink key={area} to={AREA_PATH[area]} className="rail__item" title={t(`nav.${area}` as const)}>
              <span className="rail__icon">
                <Icon name={AREA_ICON[area]} size={18} />
              </span>
              <span>{t(`nav.${area}` as const)}</span>
            </NavLink>
          ))}
      </div>
    </nav>
  )
}

/**
 * Connection state, in flow rather than floating.
 *
 * A banner that covers content is a banner that hides the message an operator
 * is reading. It appears above the workspace and pushes it down, and it says
 * nothing at all while the socket is healthy.
 */
function ConnectionBanner() {
  const { t } = useI18n()
  const { state } = useRealtime()
  if (state === 'connected') return null
  return (
    <div className="banner banner--warn" role="status" aria-live="polite">
      <Icon name="clock" size={16} />
      {t('common.offline')}
    </div>
  )
}

/**
 * Who is signed in.
 *
 * Shift state is gone with `/me/duty`: it was never a client concern. Who is
 * responsible for a conversation arrives per conversation, and whether THIS
 * operator may reply is answered by the send endpoint's own refusal rather
 * than by a duty flag the console interprets for itself.
 */
function SignedInAs() {
  const { staff } = useSession()
  if (!staff) return null
  return (
    <div className="header__duty">
      <Avatar name={staff.name} size="sm" />
      <strong>{staff.name}</strong>
    </div>
  )
}

function LocaleToggle() {
  const { locale, setLocale } = useI18n()
  return (
    <button
      type="button"
      className="btn btn--sm btn--ghost"
      onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      aria-label={locale === 'ar' ? 'Switch to English' : 'التحويل إلى العربية'}
    >
      {locale === 'ar' ? 'EN' : 'ع'}
    </button>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const { signOut } = useSession()

  return (
    <div className="shell">
      <header className="header">
        <div className="header__brand">
          <span className="header__mark" aria-hidden="true">
            ج
          </span>
          {t('app.title')}
        </div>
        <div className="header__spacer" />
        <SignedInAs />
        <LocaleToggle />
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void signOut()}>
          {t('common.signOut')}
        </button>
      </header>
      <div className="shell__body">
        <Nav />
        <main className="main">
          <div className="main__inner">
            <ConnectionBanner />
            <div className="main__content">{children}</div>
          </div>
        </main>
      </div>
    </div>
  )
}
