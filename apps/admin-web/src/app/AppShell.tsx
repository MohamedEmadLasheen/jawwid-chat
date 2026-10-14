import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { useRealtime } from '@/core/realtime/RealtimeProvider'
import { isSuperAdmin, visibleAreas, type NavArea } from '@/core/permissions/capabilities'
import { ADMIN_SECTIONS, adminSectionPath } from '@/features/admin/sections'
import { ShiftEndBanner } from '@/features/inbox/ShiftEndBanner'

const AREA_PATH: Record<NavArea, string> = {
  inbox: '/inbox',
  families: '/families',
  tasks: '/tasks',
  coverage: '/coverage',
  dashboard: '/dashboard',
  stories: '/stories',
  settings: '/settings',
}

/** Nav is a data-driven registry: adding a module is one entry, not a refactor. */
function Nav() {
  const { t } = useI18n()
  const { staff } = useSession()
  if (!staff) return null
  if (isSuperAdmin(staff.role)) return <AdminNav />

  return (
    <nav className="rail" aria-label={t('app.title')}>
      <div className="rail__group">
        {visibleAreas(staff.role)
          // Settings has no page in MVP; it stays out of the rail until it does.
          .filter((area) => area !== 'settings')
          .map((area) => (
            <NavLink key={area} to={AREA_PATH[area]} className="rail__item">
              <span>{t(`nav.${area}` as const)}</span>
            </NavLink>
          ))}
      </div>
    </nav>
  )
}

/**
 * The super admin's rail: EVERY planned section, including the unfinished ones,
 * each carrying its real status. Hiding an unbuilt section would hide how much
 * is left; showing it as if it worked would be worse.
 */
function AdminNav() {
  const { t, locale } = useI18n()
  return (
    <nav className="rail" aria-label={t('app.title')}>
      <div className="rail__group">
        {ADMIN_SECTIONS.map((section) => (
          <NavLink
            key={section.key}
            to={adminSectionPath(section.key)}
            className="rail__item"
            // The status sits UNDER the label: beside it, "In development" wraps
            // and crowds a 200px rail. A plain span, so the narrow-rail rule
            // (labels hidden, icons only) hides it together with the label.
            style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}
          >
            <span>{locale === 'ar' ? section.label.ar : section.label.en}</span>
            {section.status === 'in_development' && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
                {locale === 'ar' ? 'قيد التطوير' : 'In development'}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

function ConnectionBanner() {
  const { t } = useI18n()
  const { state } = useRealtime()
  const { staff } = useSession()
  if (state === 'connected') return null
  // The /admin sections are request/response and never subscribe to realtime;
  // a permanent "reconnecting" banner would claim a failure that affects
  // nothing the super admin can see.
  if (staff && isSuperAdmin(staff.role)) return null
  return (
    <div className="banner banner--warn" role="status" aria-live="polite">
      {t('common.offline')}
    </div>
  )
}

function DutyIndicator() {
  const { t, time } = useI18n()
  const { staff, duty } = useSession()
  if (!staff) return null

  return (
    <div className="header__duty">
      <strong>{staff.name}</strong>
      {duty?.in_shift && duty.shift_ends_at && <> · {time(duty.shift_ends_at)}</>}
      {duty && duty.covering_for.length > 0 && <> · {t('bucket.covering')}</>}
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
        <div className="header__brand">{t('app.title')}</div>
        <div className="header__spacer" />
        <DutyIndicator />
        <LocaleToggle />
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void signOut()}>
          {t('common.signOut')}
        </button>
      </header>
      <div className="shell__body">
        <Nav />
        <main className="main">
          <div className="column column--center" style={{ flex: 1 }}>
            <ConnectionBanner />
            <ShiftEndBanner />
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{children}</div>
          </div>
        </main>
      </div>
    </div>
  )
}
