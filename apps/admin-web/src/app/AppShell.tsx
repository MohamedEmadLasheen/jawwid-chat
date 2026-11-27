import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { useRealtime } from '@/core/realtime/RealtimeProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { TEXT, useText } from '@/features/admin/copy'
import { chatApi, chatKeys } from '@/features/chat/chatApi'
import { NotificationBell } from '@/features/notification-center/NotificationBell'
import { SearchPalette, useSearchShortcut } from '@/features/search/SearchPalette'
import { S as SEARCH } from '@/features/search/copy'
import { Avatar } from '@/shared/components/Avatar'
import { BrandLogo } from '@/shared/components/BrandLogo'
import { Icon } from '@/shared/components/Icon'
import { Menu } from '@/shared/components/Menu'
import { useMediaQuery } from '@/shared/hooks/useMediaQuery'
import {
  AREA_PATH,
  destinationForPath,
  entriesOf,
  soleEntry,
  type Destination,
  type DestinationKey,
  type NavEntry,
} from './navigation'
import { useDestinations, useEntryLabel } from './useDestinations'

/* ------------------------------------------------------------- navigation */

/**
 * From this width up the navigation is a compact icon rail; below it, the
 * same destinations open as a drawer from the top bar's menu button.
 */
const RAIL_QUERY = '(min-width: 1024px)'
/** Below this the five most used destinations sit along the bottom edge. */
const TABBAR_QUERY = '(max-width: 767px)'

/** The Today page: where the logo goes. */
export const TODAY_PATH = '/today'
/** The unified requests queue: reached from Today and from search. */
export const REQUESTS_PATH = '/requests'
const TODAY_LABEL = { en: 'Today', ar: 'اليوم' }
const ACCOUNT_LABEL = { en: 'Account', ar: 'الحساب' }
/** Places whose full name does not fit the sidebar: the short word shown there. */
const SHORT_LABEL: Partial<Record<DestinationKey, { en: string; ar: string }>> = {
  people: { en: 'People', ar: 'الأشخاص' },
}

/** A hairline is drawn above these destinations: the rail's sections. */
const RAIL_RULE_BEFORE: ReadonlySet<DestinationKey> = new Set<DestinationKey>(['people', 'certificates', 'finance'])

/**
 * Unread conversations, for the rail's badge. It only reads what the chat
 * workspace has already loaded (it never asks the server itself), so the shell
 * adds no request of its own.
 */
function useUnreadChats(): number {
  const { staff } = useSession()
  const destinations = useDestinations()
  // Only for an account whose navigation offers the chat workspace; the same list the
  // workspace reads (one key, one request), refreshed slowly in the background.
  const hasChat = destinations.some((d) => entriesOf(d).some((e) => e.path === '/chat'))
  const q = useQuery({ queryKey: chatKeys.list, queryFn: chatApi.list, enabled: !!staff && hasChat, staleTime: 60_000 })
  const list = Array.isArray(q.data) ? q.data : []
  // A conversation waiting on the academy is the count that asks for action.
  return list.reduce((n, c) => n + (c.needsReply ? 1 : 0), 0)
}

function RailBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="side__count side__count--urgent" aria-hidden="true">
      {count > 99 ? '99+' : count}
    </span>
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
      end={entry.exact}
      className={entry.inDevelopment ? 'side__item side__item--pending' : 'side__item'}
      title={pendingTitle(label, entry, tx(TEXT.inDevelopment))}
    >
      <Icon name={entry.icon} size={20} />
      <span className="side__label">{label}</span>
      {entry.inDevelopment && <PendingMark />}
    </NavLink>
  )
}

function DrawerNav() {
  const tx = useText()
  const destinations = useDestinations()
  return (
    <nav className="side__nav" aria-label={useNavLabel()}>
      {destinations.map((d) => {
        const sole = soleEntry(d)
        if (sole) {
          return (
            <div className="side__group" key={d.key}>
              <ul className="ruled">
                <li>
                  <DrawerLink entry={sole} />
                </li>
              </ul>
            </div>
          )
        }
        const labelId = `nav-destination-${d.key}`
        return (
          <div className="side__group" key={d.key} role="group" aria-labelledby={labelId}>
            <p className="side__heading" id={labelId}>
              {tx(d.label)}
            </p>
            {d.groups.map((g) => (
              <Fragment key={g.key}>
                {g.label && g.entries.length > 1 && <p className="side__subheading">{tx(g.label)}</p>}
                <ul className="ruled">
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
      end={entry.exact}
      className={entry.inDevelopment ? 'side__menu-link side__menu-link--pending' : 'side__menu-link'}
      title={pendingTitle(label, entry, tx(TEXT.inDevelopment))}
    >
      <Icon name={entry.icon} size={18} />
      <span className="side__label">{label}</span>
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
  const unread = useUnreadChats()
  const badge = d.key === 'conversations' ? unread : 0
  // Admin & Settings sits at the foot of the list, apart from the everyday places.
  const itemClass = d.key === 'admin' ? 'side__entry side__entry--end' : RAIL_RULE_BEFORE.has(d.key) ? 'side__entry side__entry--rule' : 'side__entry'

  if (sole) {
    return (
      <li className={itemClass}>
        <NavLink to={sole.path} className="side__item" data-destination={d.key}>
          <Icon name={sole.icon} size={20} />
          <span className="side__label">{entryLabel(sole)}</span>
          <RailBadge count={badge} />
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
        // by the list, so a focus loss to nothing (a click on the menu's own
        // padding) does not.
        const next = e.relatedTarget as Node | null
        if (next && !e.currentTarget.contains(next)) onLeave()
      }}
    >
      <button
        type="button"
        className={current ? 'side__item is-current' : 'side__item'}
        data-destination={d.key}
        // A long name is said in full to assistive technology and shortened on screen.
        aria-label={SHORT_LABEL[d.key] ? tx(d.label) : undefined}
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
        <Icon name={d.icon} size={20} />
        <span className="side__label">{tx(SHORT_LABEL[d.key] ?? d.label)}</span>
        <RailBadge count={badge} />
        <span className="side__caret" aria-hidden="true">
          <Icon name="chevronForward" size={16} />
        </span>
      </button>
      {current && (
        // Where you are: the current place's pages, one click apart, under its name.
        <ul className="ruled side__sub" aria-label={tx(d.label)}>
          {entriesOf(d).map((e) => (
            <li key={e.key}>
              <NavLink to={e.path} end={e.exact} className="side__sub-link" tabIndex={-1}>
                {entryLabel(e)}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
      <div className="side__menu" id={menuId} hidden={!open} onKeyDown={onMenuKeyDown}>
        <p className="side__menu-title" aria-hidden="true">
          {tx(d.label)}
        </p>
        {d.groups.map((g) => (
          <div className="side__menu-group" key={g.key} role={g.label ? 'group' : undefined} aria-label={g.label ? tx(g.label) : undefined}>
            {g.label && (
              <p className="side__menu-heading" aria-hidden="true">
                {tx(g.label)}
              </p>
            )}
            <ul className="ruled">
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
    <nav className="side__nav" aria-label={useNavLabel()} ref={navRef}>
      <ul className="ruled side__list">
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
  onSearch,
}: {
  onClose: () => void
  closeRef: RefObject<HTMLButtonElement>
  onSearch: () => void
}) {
  const { t } = useI18n()
  const tx = useText()
  const { staff } = useSession()
  const rail = useMediaQuery(RAIL_QUERY)
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')

  return (
    <aside className="sidebar" id="app-sidebar">
      <div className="side__head">
        {/* The logo goes to Today. It sits outside the navigation landmark: it is not one of its destinations. */}
        <Link to={TODAY_PATH} className="side__brand" aria-label={`Jawwid — ${tx(TODAY_LABEL)}`} title={tx(TODAY_LABEL)}>
          <BrandLogo />
          <span className="side__product">{staff && isSuperAdmin(staff.role) ? tx(TEXT.adminPortal) : tx(TEXT.operations)}</span>
        </Link>
        {!rail && (
          <button
            type="button"
            ref={closeRef}
            className="btn btn--ghost btn--icon btn--sm side__close"
            onClick={onClose}
            aria-label={t('shell.closeMenu')}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      {staff && rail && (
        <div className="side__searchrow">
          <button type="button" className="side__search" onClick={onSearch} aria-label={tx(SEARCH.open)} aria-keyshortcuts="Control+K Meta+K /">
            <Icon name="search" size={17} />
            <span>{tx(SEARCH.short)}</span>
            <span className="kbd" aria-hidden="true">
              {mac ? '⌘K' : 'Ctrl K'}
            </span>
          </button>
          {/* PD-34: the staff member's own Notification Center. */}
          <NotificationBell />
        </div>
      )}
      {staff && (
        // Today is home: the first place, outside the navigation landmark like the logo.
        <NavLink to={TODAY_PATH} className="side__item side__today">
          <Icon name="home" size={20} />
          <span className="side__label">{tx(TODAY_LABEL)}</span>
        </NavLink>
      )}
      {rail ? <RailNav /> : <DrawerNav />}
      {staff && rail && <AccountBlock />}
    </aside>
  )
}

/** The foot of the sidebar: who is signed in, the language, the notifications, and the way out. */
function AccountBlock() {
  const { t, locale, setLocale } = useI18n()
  const tx = useText()
  const navigate = useNavigate()
  const { staff, signOut } = useSession()
  if (!staff) return null
  const superAdmin = isSuperAdmin(staff.role)
  return (
    <div className="side__foot">
      <Menu
        label={tx(ACCOUNT_LABEL)}
        className="side__account"
        align="start"
        trigger={
          <span className="side__me">
            <Avatar name={staff.name} seed={staff.id} size="sm" />
            <span className="side__me-text">
              <span className="side__me-name">{staff.name}</span>
              <span className="side__me-role">{superAdmin ? t('role.super_admin') : tx(TEXT.operations)}</span>
            </span>
            <Icon name="caretUpDown" size={16} />
          </span>
        }
        triggerClassName="side__me-button header__profile"
        items={[
          { key: 'profile', label: t('nav.profile'), icon: 'staff', onSelect: () => navigate('/profile') },
          { key: 'language', label: t('shell.switchLanguage'), icon: 'language', onSelect: () => setLocale(locale === 'ar' ? 'en' : 'ar') },
          { key: 'signOut', label: t('common.signOut'), icon: 'signOut', onSelect: () => void signOut() },
        ]}
      />
    </div>
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

function LanguageToggle() {
  const { t, locale, setLocale } = useI18n()
  return (
    <button
      type="button"
      className="side__tool topbar__lang"
      onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      aria-label={t('shell.switchLanguageLabel')}
      lang={locale === 'ar' ? 'en' : 'ar'}
    >
      <Icon name="language" size={18} />
      <span className="topbar__lang-text">{t('shell.switchLanguage')}</span>
    </button>
  )
}

/** Where you are: the section, then the page. Read from the same navigation the rail draws. */
function Where({ destinations }: { destinations: Destination[] }) {
  const { t } = useI18n()
  const tx = useText()
  const entryLabel = useEntryLabel()
  const { pathname } = useLocation()
  let section: string | null = null
  let page: string | null = null
  if (pathname === TODAY_PATH) page = tx(TODAY_LABEL)
  else if (pathname === REQUESTS_PATH) page = tx(SEARCH.requests)
  else if (pathname.startsWith('/profile')) page = t('nav.profile')
  else if (pathname.startsWith('/notifications')) page = tx(SEARCH.notifications)
  else {
    // The longest path that matches is the page: /trials/new-students before /trials.
    let best: { d: Destination; e: NavEntry } | null = null
    for (const d of destinations) {
      for (const e of entriesOf(d)) {
        if ((pathname === e.path || pathname.startsWith(`${e.path}/`)) && (!best || e.path.length > best.e.path.length)) best = { d, e }
      }
    }
    if (best) {
      page = entryLabel(best.e)
      section = soleEntry(best.d) ? null : tx(best.d.label)
    } else {
      const key = destinationForPath(destinations, pathname)
      const d = destinations.find((x) => x.key === key)
      if (d) page = tx(d.label)
      else {
        // A page reached by a link rather than from this role's rail still says its name.
        const area = (Object.keys(AREA_PATH) as Array<keyof typeof AREA_PATH>)
          .filter((a) => pathname === AREA_PATH[a] || pathname.startsWith(`${AREA_PATH[a]}/`))
          .sort((a, b) => AREA_PATH[b].length - AREA_PATH[a].length)[0]
        if (area) page = t(`nav.${area}`)
      }
    }
  }
  if (!page) return <span className="topbar__where" />
  return (
    <p className="topbar__where">
      {section && section !== page && (
        <>
          <span className="topbar__where-section">{section}</span>
          <span className="topbar__where-sep" aria-hidden="true">
            /
          </span>
        </>
      )}
      <span className="topbar__where-page">{page}</span>
    </p>
  )
}

function Topbar({
  navOpen,
  onOpenNav,
  onSearch,
  menuRef,
  destinations,
}: {
  navOpen: boolean
  onOpenNav: () => void
  onSearch: () => void
  menuRef: RefObject<HTMLButtonElement>
  destinations: Destination[]
}) {
  const { t, locale, setLocale } = useI18n()
  const tx = useText()
  const navigate = useNavigate()
  const { staff, signOut } = useSession()
  const rail = useMediaQuery(RAIL_QUERY)
  const phone = useMediaQuery(TABBAR_QUERY)
  // From desktop width the sidebar carries all of this; the bar is for narrow screens.
  if (rail) return null

  return (
    <header className="topbar">
      {/* On phones the bottom bar's "More" opens the menu; one trigger is enough. */}
      {!phone && (
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
      )}
      {phone ? (
        <Link to={TODAY_PATH} className="topbar__brand" aria-label={`Jawwid — ${tx(TODAY_LABEL)}`}>
          <BrandLogo />
        </Link>
      ) : (
        <Where destinations={destinations} />
      )}
      <span className="topbar__spacer" />
      {staff && (
        <button type="button" className="btn btn--ghost btn--icon" onClick={onSearch} aria-label={tx(SEARCH.open)} aria-keyshortcuts="Control+K Meta+K /">
          <Icon name="search" size={20} />
        </button>
      )}
      {/* PD-34: the staff member's own Notification Center. */}
      {staff && <NotificationBell />}
      {staff && (
        // One's own profile, the language and the way out live behind one's own face.
        <Menu
          label={tx(ACCOUNT_LABEL)}
          className="topbar__account"
          trigger={<Avatar name={staff.name} seed={staff.id} size="sm" />}
          triggerClassName="btn btn--ghost btn--icon topbar__me header__profile"
          items={[
            { key: 'profile', label: t('nav.profile'), icon: 'staff', onSelect: () => navigate('/profile') },
            { key: 'language', label: t('shell.switchLanguage'), icon: 'language', onSelect: () => setLocale(locale === 'ar' ? 'en' : 'ar') },
            { key: 'signOut', label: t('common.signOut'), icon: 'signOut', onSelect: () => void signOut() },
          ]}
        />
      )}
      {!staff && <LanguageToggle />}
    </header>
  )
}

/** A tab's word under its icon: the first word of a long name. */
const shortLabel = (label: string) => label.split(/\s+/)[0] ?? label

/** Narrow screens: the first destinations along the bottom edge, and the rest behind More (the drawer). */
function Tabbar({ destinations, onMore }: { destinations: Destination[]; onMore: () => void }) {
  const { t } = useI18n()
  const tx = useText()
  const entryLabel = useEntryLabel()
  const { pathname } = useLocation()
  const unread = useUnreadChats()
  const current = destinationForPath(destinations, pathname)
  // Four places and More: the everyday ones first, in the rail's own order of use.
  const order: DestinationKey[] = ['conversations', 'dashboard', 'finance', 'people', 'sales', 'scheduling', 'operations', 'certificates', 'materials', 'communication']
  const picked = order.map((k) => destinations.find((d) => d.key === k)).filter((d): d is Destination => !!d).slice(0, 3)
  return (
    <nav className="tabbar" aria-label={tx({ en: 'Quick navigation', ar: 'تنقّل سريع' })}>
      <Link to={TODAY_PATH} className="tabbar__item" aria-label={tx(TODAY_LABEL)} aria-current={pathname === TODAY_PATH ? 'true' : undefined}>
        <Icon name="home" size={22} />
        <span aria-hidden="true">{tx(TODAY_LABEL)}</span>
      </Link>
      {picked.map((d) => {
        const first = entriesOf(d)[0]!
        const label = soleEntry(d) ? entryLabel(first) : tx(d.label)
        return (
          <Link key={d.key} to={first.path} className="tabbar__item" aria-label={label} aria-current={current === d.key && pathname !== TODAY_PATH ? 'true' : undefined}>
            <Icon name={soleEntry(d) ? first.icon : d.icon} size={22} />
            <span aria-hidden="true">{shortLabel(label)}</span>
            {d.key === 'conversations' && <RailBadge count={unread} />}
          </Link>
        )
      })}
      <button type="button" className="tabbar__item" onClick={onMore} aria-label={t('shell.openMenu')}>
        <Icon name="grid" size={22} />
        <span aria-hidden="true">{tx({ en: 'More', ar: 'المزيد' })}</span>
      </button>
    </nav>
  )
}

/* ------------------------------------------------------------------ shell */

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const destinations = useDestinations()
  const { staff } = useSession()
  const tabbar = useMediaQuery(TABBAR_QUERY)
  const openSearch = useCallback(() => setSearching(true), [])
  useSearchShortcut(openSearch)

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
      <Sidebar onClose={closeNav} closeRef={closeRef} onSearch={openSearch} />
      <div className="sidebar-backdrop" onClick={closeNav} aria-hidden="true" />
      <div className="shell__main">
        <Topbar navOpen={navOpen} onOpenNav={() => setNavOpen(true)} onSearch={openSearch} menuRef={menuRef} destinations={destinations} />
        <main className="shell__content">
          <ConnectionBanner />
          <div className="shell__view">{children}</div>
        </main>
        {tabbar && staff && <Tabbar destinations={destinations} onMore={() => setNavOpen(true)} />}
      </div>
      {searching && staff && <SearchPalette onClose={() => setSearching(false)} />}
    </div>
  )
}
