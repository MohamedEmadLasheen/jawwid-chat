import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { useLessonAccess } from '@/features/teachers/hooks'
import { useInstalmentAccess } from '@/features/instalments/hooks'
import { useMaterialsAccess } from '@/features/materials/hooks'
import { useRealtime } from '@/core/realtime/RealtimeProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { TEXT, useText } from '@/features/admin/copy'
import { ShiftEndBanner } from '@/features/inbox/ShiftEndBanner'
import { NotificationBell } from '@/features/notification-center/NotificationBell'
import { Avatar } from '@/shared/components/Avatar'
import { BrandLogo } from '@/shared/components/BrandLogo'
import { Icon } from '@/shared/components/Icon'
import { useMediaQuery } from '@/shared/hooks/useMediaQuery'
import {
  destinationForPath,
  destinationsFor,
  soleEntry,
  type Destination,
  type DestinationKey,
  type NavEntry,
} from './navigation'

/* ------------------------------------------------------------- navigation */

/**
 * From this width up the navigation is a compact icon rail; below it, the
 * same destinations open as a drawer from the top bar's menu button.
 */
const RAIL_QUERY = '(min-width: 1024px)'

function useDestinations(): Destination[] {
  const { staff } = useSession()
  // Only operators need the answer; the super admin reaches statistics as a section.
  const operator = staff !== null && !isSuperAdmin(staff.role)
  const access = useLessonAccess(operator)
  const billing = useInstalmentAccess(operator)
  const lessonManager = access.data?.lessonManager === true
  const billingReader = billing.data?.billingReader === true
  const sales = access.data?.sales === true
  const operations = access.data?.operations === true
  const calendar = access.data?.calendar === true
  // PD-29: only a manager can be the Teachers manager (the super admin's entry is a section).
  const materials = useMaterialsAccess(staff?.role === 'manager')
  const materialsManager = materials.data?.canManage === true
  return useMemo(
    () => (staff ? destinationsFor(staff.role, { lessonManager, sales, operations, billingReader, materialsManager, calendar }) : []),
    [staff, lessonManager, sales, operations, billingReader, materialsManager, calendar],
  )
}

function useEntryLabel() {
  const { t } = useI18n()
  const tx = useText()
  return useCallback(
    (entry: NavEntry) => ('text' in entry.label ? tx(entry.label.text) : t(entry.label.message)),
    [t, tx],
  )
}

function useNavLabel(): string {
  const { t } = useI18n()
  const tx = useText()
  const { staff } = useSession()
  return staff && isSuperAdmin(staff.role) ? tx(TEXT.adminPortal) : t('app.title')
}

/** Marks a placeholder page, visibly and for assistive technology. */
function PendingMark() {
  const tx = useText()
  return (
    <>
      <span className="status-ring" aria-hidden="true" />{' '}
      <span className="sr-only">{tx(TEXT.inDevelopment)}</span>
    </>
  )
}

function pendingTitle(label: string, entry: NavEntry, inDevelopment: string): string | undefined {
  return entry.inDevelopment ? `${label} · ${inDevelopment}` : undefined
}

/* The drawer: every destination open, every page one tap away. */

function DrawerLink({ entry }: { entry: NavEntry }) {
  const tx = useText()
  const label = useEntryLabel()(entry)
  return (
    <NavLink
      to={entry.path}
      className={entry.inDevelopment ? 'nav__item nav__item--pending' : 'nav__item'}
      title={pendingTitle(label, entry, tx(TEXT.inDevelopment))}
    >
      <Icon name={entry.icon} />
      <span className="nav__label">{label}</span>
      {entry.inDevelopment && <PendingMark />}
    </NavLink>
  )
}

function DrawerNav() {
  const tx = useText()
  const destinations = useDestinations()
  return (
    <nav className="sidebar__nav" aria-label={useNavLabel()}>
      {destinations.map((d) => {
        const sole = soleEntry(d)
        if (sole) {
          return (
            <div className="nav__group" key={d.key}>
              <ul className="nav__list">
                <li>
                  <DrawerLink entry={sole} />
                </li>
              </ul>
            </div>
          )
        }
        const labelId = `nav-destination-${d.key}`
        return (
          <div className="nav__group" key={d.key} role="group" aria-labelledby={labelId}>
            <p className="nav__group-label" id={labelId}>
              {tx(d.label)}
            </p>
            {d.groups.map((g) => (
              <Fragment key={g.key}>
                {g.label && <p className="nav__subgroup-label">{tx(g.label)}</p>}
                <ul className="nav__list">
                  {g.entries.map((e) => (
                    <li key={e.key}>
                      <DrawerLink entry={e} />
                    </li>
                  ))}
                </ul>
              </Fragment>
            ))}
          </div>
        )
      })}
    </nav>
  )
}

/* The rail: one icon per destination. A destination with one page links
   straight to it; one with several opens a short menu beside the rail. */

function MenuLink({ entry }: { entry: NavEntry }) {
  const tx = useText()
  const label = useEntryLabel()(entry)
  return (
    <NavLink
      to={entry.path}
      className={entry.inDevelopment ? 'rail__menu-link rail__menu-link--pending' : 'rail__menu-link'}
      title={pendingTitle(label, entry, tx(TEXT.inDevelopment))}
    >
      <Icon name={entry.icon} />
      <span className="rail__menu-label">{label}</span>
      {entry.inDevelopment && <PendingMark />}
    </NavLink>
  )
}

/** Up and down arrows move between a menu's links, wrapping at the ends. */
function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>('a')]
  if (links.length === 0) return
  e.preventDefault()
  const at = links.indexOf(document.activeElement as HTMLAnchorElement)
  const step = e.key === 'ArrowDown' ? 1 : -1
  links[(at + step + links.length) % links.length]?.focus()
}

function RailItem({
  destination: d,
  current,
  open,
  onToggle,
  onOpenAndEnter,
  onLeave,
}: {
  destination: Destination
  current: boolean
  open: boolean
  onToggle: () => void
  onOpenAndEnter: () => void
  onLeave: () => void
}) {
  const tx = useText()
  const entryLabel = useEntryLabel()
  const sole = soleEntry(d)
  // More sits at the foot of the rail, apart from the everyday destinations.
  const itemClass = d.key === 'more' ? 'rail__item rail__item--end' : 'rail__item'

  if (sole) {
    return (
      <li className={itemClass}>
        <NavLink to={sole.path} className="rail__link" data-destination={d.key}>
          <Icon name={sole.icon} size={22} />
          <span className="rail__tip">{entryLabel(sole)}</span>
          {sole.inDevelopment && <PendingMark />}
        </NavLink>
      </li>
    )
  }

  const menuId = `rail-menu-${d.key}`
  return (
    <li
      className={itemClass}
      onBlur={(e: FocusEvent<HTMLLIElement>) => {
        // Tabbing out of an open menu closes it; a click elsewhere is handled
        // by the rail, so a focus loss to nothing (a click on the menu's own
        // padding) does not.
        const next = e.relatedTarget as Node | null
        if (next && !e.currentTarget.contains(next)) onLeave()
      }}
    >
      <button
        type="button"
        className="rail__link"
        data-destination={d.key}
        aria-expanded={open}
        aria-controls={menuId}
        aria-current={current ? 'true' : undefined}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            onOpenAndEnter()
          }
        }}
      >
        <Icon name={d.icon} size={22} />
        <span className="rail__tip">{tx(d.label)}</span>
      </button>
      <div className="rail__menu" id={menuId} hidden={!open} onKeyDown={onMenuKeyDown}>
        <p className="rail__menu-title" aria-hidden="true">
          {tx(d.label)}
        </p>
        {d.groups.map((g) => (
          <div className="rail__menu-group" key={g.key} role={g.label ? 'group' : undefined} aria-label={g.label ? tx(g.label) : undefined}>
            {g.label && (
              <p className="rail__menu-heading" aria-hidden="true">
                {tx(g.label)}
              </p>
            )}
            <ul className="rail__menu-list">
              {g.entries.map((e) => (
                <li key={e.key}>
                  <MenuLink entry={e} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </li>
  )
}

function RailNav() {
  const destinations = useDestinations()
  const { pathname } = useLocation()
  const [openKey, setOpenKey] = useState<DestinationKey | null>(null)
  // Set when a menu was opened from the keyboard (ArrowDown): focus its first link.
  const [enterKey, setEnterKey] = useState<DestinationKey | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const current = destinationForPath(destinations, pathname)

  // Choosing a page is the end of a menu's job.
  useEffect(() => setOpenKey(null), [pathname])

  useEffect(() => {
    if (!openKey) return
    const onMouseDown = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpenKey(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpenKey(null)
      navRef.current?.querySelector<HTMLElement>(`[data-destination="${openKey}"]`)?.focus()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openKey])

  useEffect(() => {
    if (!enterKey || openKey !== enterKey) return
    navRef.current?.querySelector<HTMLElement>(`#rail-menu-${enterKey} a`)?.focus()
    setEnterKey(null)
  }, [enterKey, openKey])

  const openAndEnter = (key: DestinationKey) => {
    setOpenKey(key)
    setEnterKey(key)
  }

  return (
    <nav className="rail" aria-label={useNavLabel()} ref={navRef}>
      <ul className="rail__list">
        {destinations.map((d) => (
          <RailItem
            key={d.key}
            destination={d}
            current={current === d.key}
            open={openKey === d.key}
            onToggle={() => setOpenKey((k) => (k === d.key ? null : d.key))}
            onOpenAndEnter={() => openAndEnter(d.key)}
            onLeave={() => setOpenKey((k) => (k === d.key ? null : k))}
          />
        ))}
      </ul>
    </nav>
  )
}

function Sidebar({
  onClose,
  closeRef,
}: {
  onClose: () => void
  closeRef: RefObject<HTMLButtonElement>
}) {
  const { t } = useI18n()
  const tx = useText()
  const { staff } = useSession()
  const superAdmin = staff ? isSuperAdmin(staff.role) : false
  const rail = useMediaQuery(RAIL_QUERY)

  if (rail) {
    return (
      <aside className="sidebar sidebar--rail" id="app-sidebar">
        <RailNav />
      </aside>
    )
  }

  return (
    <aside className="sidebar" id="app-sidebar">
      <div className="sidebar__brand">
        <Link to="/" className="sidebar__brand-link" aria-label="Jawwid">
          <BrandLogo />
          <span className="sidebar__product">{superAdmin ? tx(TEXT.adminPortal) : tx(TEXT.operations)}</span>
        </Link>
        <button
          type="button"
          ref={closeRef}
          className="btn btn--ghost btn--icon btn--sm sidebar__close"
          onClick={onClose}
          aria-label={t('shell.closeMenu')}
        >
          <Icon name="close" />
        </button>
      </div>
      <DrawerNav />
      {superAdmin && (
        <div className="sidebar__footer">
          <span className="status-ring" aria-hidden="true" />
          <span>{tx(TEXT.inDevelopment)}</span>
        </div>
      )}
    </aside>
  )
}

/* ----------------------------------------------------------------- topbar */

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
  if (!duty?.in_shift && !(duty && duty.covering_for.length > 0)) return null

  return (
    <span className="topbar__user-role">
      {duty?.in_shift && duty.shift_ends_at && time(duty.shift_ends_at)}
      {duty && duty.covering_for.length > 0 && <> · {t('bucket.covering')}</>}
    </span>
  )
}

function LanguageToggle() {
  const { t, locale, setLocale } = useI18n()
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      aria-label={t('shell.switchLanguageLabel')}
      lang={locale === 'ar' ? 'en' : 'ar'}
    >
      <Icon name="globe" size={16} />
      {t('shell.switchLanguage')}
    </button>
  )
}

function Topbar({
  navOpen,
  onOpenNav,
  menuRef,
}: {
  navOpen: boolean
  onOpenNav: () => void
  menuRef: RefObject<HTMLButtonElement>
}) {
  const { t } = useI18n()
  const tx = useText()
  const { staff, signOut } = useSession()
  const superAdmin = staff ? isSuperAdmin(staff.role) : false

  return (
    <header className="topbar">
      <button
        type="button"
        ref={menuRef}
        className="btn btn--ghost btn--icon topbar__menu"
        onClick={onOpenNav}
        aria-label={t('shell.openMenu')}
        aria-expanded={navOpen}
        aria-controls="app-sidebar"
      >
        <Icon name="menu" size={20} />
      </button>
      {/* The rail has no room for the lockup, so the top bar carries it at every width. */}
      <Link to="/" className="topbar__brand" aria-label="Jawwid">
        <BrandLogo />
        <span className="topbar__product" aria-hidden="true">
          {superAdmin ? tx(TEXT.adminPortal) : tx(TEXT.operations)}
        </span>
      </Link>
      <div className="topbar__spacer" />
      {/* No "Read-only access" chip: the super admin has written in conversations
          since PD-8 and publishes stories since 2026-10-17, so the claim was false. */}
      {/* PD-34: the staff member's own Notification Center. */}
      {staff && <NotificationBell />}
      <LanguageToggle />
      {staff && (
        <>
          <span className="topbar__divider" aria-hidden="true" />
          {/* The way to one's own profile: the person in the header, not a
              module in the rail. */}
          <Link
            to="/profile"
            className="topbar__user header__profile"
            aria-label={`${staff.name} — ${t('nav.profile')}`}
          >
            <Avatar name={staff.name} seed={staff.id} size="sm" />
            <span className="topbar__user-text">
              <span className="topbar__user-name">{staff.name}</span>
              {superAdmin ? (
                <span className="topbar__user-role">{t('role.super_admin')}</span>
              ) : (
                <DutyIndicator />
              )}
            </span>
          </Link>
        </>
      )}
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        onClick={() => void signOut()}
        aria-label={t('common.signOut')}
        title={t('common.signOut')}
      >
        <Icon name="signOut" />
      </button>
    </header>
  )
}

/* ------------------------------------------------------------------ shell */

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { staff } = useSession()
  const [navOpen, setNavOpen] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const closeNav = useCallback(() => {
    setNavOpen(false)
    menuRef.current?.focus()
  }, [])

  // Navigating is the end of the off-canvas menu's job.
  useEffect(() => setNavOpen(false), [pathname])

  useEffect(() => {
    if (!navOpen) return
    closeRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeNav()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navOpen, closeNav])

  return (
    <div className={navOpen ? 'shell shell--nav-open' : 'shell'}>
      <Sidebar onClose={closeNav} closeRef={closeRef} />
      <div className="sidebar-backdrop" onClick={closeNav} aria-hidden="true" />
      <div className="shell__main">
        <Topbar navOpen={navOpen} onOpenNav={() => setNavOpen(true)} menuRef={menuRef} />
        <main className="shell__content">
          <ConnectionBanner />
          {/* Shifts belong to operator roles; the super admin has none, and the
              banner's endpoint would only ever answer it with a 404. */}
          {staff && !isSuperAdmin(staff.role) && <ShiftEndBanner />}
          <div className="shell__view">{children}</div>
        </main>
      </div>
    </div>
  )
}
