import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { navAreas, visibleAreas, type NavArea } from '@/core/permissions/capabilities'
import { ADMIN_SECTIONS } from '@/features/admin/sections'
import type { StaffRole } from '@/shared/types/domain'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { AREA_PATH, destinationsFor, entriesOf } from './navigation'

/**
 * Conversation-first navigation (2026-10-13): "/" opens the role's
 * conversations, a desktop icon rail holds five destinations, the drawer holds
 * the same ones below desktop width, and no page a role may open has become
 * unreachable. Every actor here is synthetic, so this proves the UI's routing
 * and listing only; what each role may actually read is decided server-side.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/v1/, '').split('?')[0]!
    if (path in routes) return jsonResponse(routes[path])
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404)
  })
}

/** Answers min-width/max-width queries for a window of the given width. */
function viewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    const max = /max-width:\s*(\d+)px/.exec(query)
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])) && Boolean(min || max)
    return { matches, media: query, addEventListener: () => {}, removeEventListener: () => {} }
  })
}

function Where() {
  const { pathname, search } = useLocation()
  return <output data-testid="where">{pathname + search}</output>
}

const staff = (role: StaffRole) => makeStaff({ id: `staff_${role}`, name: `Synthetic ${role}`, role })
const superAdmin = staff('super_admin')
const OPERATOR_ROLES: StaffRole[] = ['manager', 'admin', 'coverage', 'finance', 'technical', 'academic']

/** PD-44: what GET /dashboard/chats and /dashboard/cases answer a manager here. */
const DASHBOARD_ROUTES = {
  '/dashboard/chats': { generatedAt: '2026-10-28T09:00:00.000Z', tiles: [{ key: 'chats.waiting', count: 2, oldestAt: null, capped: false }] },
  '/dashboard/cases': {
    generatedAt: '2026-10-28T09:00:00.000Z',
    tiles: [
      { key: 'cases.mine_open', count: 0, oldestAt: null, capped: false },
      { key: 'cases.department_open', count: 1, oldestAt: null, capped: false },
      { key: 'cases.overdue', count: 0, oldestAt: null, capped: false },
    ],
  },
}
const dashboardManager = makeStaff({ id: 'staff_manager', role: 'manager', permissions: ['chat.use', 'cases.view'] })

beforeEach(() => {
  localStorage.clear()
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('The navigation registry', () => {
  it('gives each of the twenty-one sections exactly one destination, with the Dashboard under More', () => {
    const destinations = destinationsFor('super_admin')
    expect(destinations.map((d) => d.key)).toEqual(['conversations', 'calls', 'people', 'stories', 'more'])
    const keys = destinations.flatMap((d) => entriesOf(d).map((e) => e.key))
    // The twenty-one sections, plus Chat (PD-8: where the super admin replies),
    // Accounts (PD-21: where every staff role administers accounts),
    // Materials (PD-29: the library the super admin manages), the Schedule
    // (PD-38: the academy's calendar), Trials & new students (PD-11 T4,
    // PD-16), Teacher credentials review and Escalations (PD-35 B5).
    expect(keys).toHaveLength(28)
    expect([...keys].sort()).toEqual([...ADMIN_SECTIONS.map((s) => s.key), 'chat', 'accounts', 'materials', 'schedule', 'trials', 'teacher-profiles', 'cases'].sort())
    const conversations = destinations.find((d) => d.key === 'conversations')!
    expect(entriesOf(conversations).map((e) => e.path)).toEqual(['/chat', '/admin/conversations'])
    const more = destinations.find((d) => d.key === 'more')!
    expect(entriesOf(more).map((e) => e.key)).toContain('dashboard')
  })

  it('lists for each role exactly the pages it may open: nothing hidden, nothing extra', () => {
    for (const role of OPERATOR_ROLES) {
      for (const [lessonManager, billingReader] of [[false, false], [true, false], [false, true], [true, true]] as const) {
        const listed = destinationsFor(role, { lessonManager, billingReader }).flatMap((d) => entriesOf(d).map((e) => e.path))
        // Exactly the openable areas, with one deliberate exception: Teacher
        // statistics is offered only when the server confirms the Teachers
        // department (GET /lessons/access), which the role alone cannot tell --
        // and Instalments likewise waits for Operations (GET /instalments/access).
        const allowed = navAreas(role, { lessonManager, billingReader })
          .filter((a): a is Exclude<NavArea, 'settings'> => a !== 'settings')
          .map((a) => AREA_PATH[a])
        expect([...listed].sort(), role).toEqual([...allowed].sort())
        expect(listed, role).not.toContain('/inbox')
        const withheld = [
          ...(!lessonManager && visibleAreas(role).includes('teachers') ? ['teachers'] : []),
          // PD-38: the Schedule waits for GET /lessons/access to say `calendar`.
          ...(visibleAreas(role).includes('schedule') ? ['schedule'] : []),
          ...(!billingReader && visibleAreas(role).includes('instalments') ? ['instalments'] : []),
          // PD-17: the Parent Profile follows the money's rule (GET /instalments/access).
          ...(!billingReader && visibleAreas(role).includes('parents') ? ['parents'] : []),
          // PD-27: Payments likewise.
          ...(!billingReader && visibleAreas(role).includes('payments') ? ['payments'] : []),
          ...(!lessonManager && visibleAreas(role).includes('trials') ? ['trials'] : []),
          // PD-29: Materials waits for the Teachers manager (GET /materials/admin/access).
          ...(visibleAreas(role).includes('materials') ? ['materials'] : []),
        ]
        expect(visibleAreas(role).filter((a) => !navAreas(role, { lessonManager, billingReader }).includes(a)), role).toEqual(withheld)
        expect(listed.some((p) => p.startsWith('/admin/')), role).toBe(false)
      }
    }
    // And the super admin's navigation is the portal, not the operator screens
    // -- except Chat, the one workspace it writes in (PD-8), Accounts, the
    // one page every staff role shares (PD-21), the Schedule it shares with
    // the Teachers department and Operations (PD-38), Trials & new students,
    // which it shares with Sales and Operations (PD-11 T4, PD-16), Teacher
    // credentials review (the queue it reviews with operators), Escalations
    // (PD-35 B5) and Materials, the library it manages with the Teachers
    // manager (PD-29).
    const listed = destinationsFor('super_admin').flatMap((d) => entriesOf(d).map((e) => e.path))
    expect(listed.filter((p) => !p.startsWith('/admin/'))).toEqual(['/chat', '/accounts', '/schedule', '/trials', '/teacher-profiles', '/cases', '/materials'])
    // PD-38: an operator is offered the Schedule on the server's word only
    // (the department roles -- finance, technical, academic -- never are).
    for (const role of ['manager', 'admin', 'coverage'] as const) {
      expect(destinationsFor(role, { calendar: true }).flatMap((d) => entriesOf(d).map((e) => e.path)), role).toContain('/schedule')
      expect(destinationsFor(role, {}).flatMap((d) => entriesOf(d).map((e) => e.path)), role).not.toContain('/schedule')
    }
    // The Teachers manager is offered Materials on the server's word only.
    expect(destinationsFor('manager', { materialsManager: true }).flatMap((d) => entriesOf(d).map((e) => e.path))).toContain('/materials')
    expect(destinationsFor('admin', { materialsManager: true }).flatMap((d) => entriesOf(d).map((e) => e.path))).not.toContain('/materials')
  })
})

describe('Landing and deep links', () => {
  it('"/" opens each role\'s conversations, and a department\'s tasks', async () => {
    const expected: [StaffRole, string][] = [
      ['super_admin', '/admin/conversations'],
      ['manager', '/chat'],
      ['admin', '/chat'],
      ['coverage', '/chat'],
      ['finance', '/tasks'],
    ]
    for (const [role, home] of expected) {
      vi.stubGlobal('fetch', routeFetch({}))
      const { unmount } = renderWithProviders(
        <>
          <AppRoutes />
          <Where />
        </>,
        { staff: staff(role), route: '/' },
      )
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(home))
      unmount()
    }
  })

  it('keeps a deep link where it points, including the Dashboard that left the rail', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(
      <>
        <AppRoutes />
        <Where />
      </>,
      { staff: superAdmin, route: '/admin/dashboard' },
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/dashboard')
  })

  it('PD-13: opens the Calls page at /calls for operators and /admin/calls for the super admin', async () => {
    for (const [role, route] of [['admin', '/calls'], ['coverage', '/calls'], ['manager', '/calls'], ['super_admin', '/admin/calls']] as const) {
      vi.stubGlobal('fetch', routeFetch({}))
      const { unmount } = renderWithProviders(<AppRoutes />, { staff: staff(role), route })
      expect(await screen.findByRole('heading', { level: 1, name: 'Calls' }), role).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Schedule call' }), role).toBeInTheDocument()
      unmount()
    }
    // A department has no calls page; the route answers Forbidden.
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: staff('finance'), route: '/calls' })
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission")
  })

  it('sends an unknown path home, never to a page the role cannot open', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(
      <>
        <AppRoutes />
        <Where />
      </>,
      { staff: staff('finance'), route: '/no-such-page' },
    )
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/tasks'))
  })

  it('answers a page outside the role with Forbidden, and does not list it', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: staff('admin'), route: '/dashboard' })
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission")
    expect(within(screen.getByRole('navigation')).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
  })
})

describe('The retired Coverage page', () => {
  // Shifts, coverage rules and absences were replaced by PD-8 backups and
  // PD-33 covers on the Organization page; the API never had /coverage routes.
  it('is listed for no role', () => {
    for (const role of [...OPERATOR_ROLES, 'super_admin'] as StaffRole[]) {
      const entries = destinationsFor(role, { lessonManager: true, billingReader: true }).flatMap(entriesOf)
      expect(entries.map((e) => e.path)).not.toContain('/coverage')
      expect(entries.map((e) => e.key)).not.toContain('coverage')
    }
  })

  it('is not a route: /coverage falls to the unknown-path handling, like any other', async () => {
    for (const [role, home] of [['manager', '/chat'], ['super_admin', '/admin/conversations']] as const) {
      vi.stubGlobal('fetch', routeFetch({}))
      const { unmount } = renderWithProviders(
        <>
          <AppRoutes />
          <Where />
        </>,
        { staff: staff(role), route: '/coverage' },
      )
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(home))
      expect(screen.queryByRole('heading', { name: 'Coverage' })).not.toBeInTheDocument()
      unmount()
    }
  })
})

describe('The retired Families page', () => {
  // The API never served GET /families: family records live in Chat, the
  // Parent Profile (/parents) and Accounts (/accounts).
  it('is listed for no role', () => {
    for (const role of [...OPERATOR_ROLES, 'super_admin'] as StaffRole[]) {
      expect(visibleAreas(role), role).not.toContain('families')
      const entries = destinationsFor(role, { lessonManager: true, billingReader: true }).flatMap(entriesOf)
      expect(entries.map((e) => e.path)).not.toContain('/families')
      expect(entries.map((e) => e.key)).not.toContain('families')
    }
  })

  it('is not a route: /families falls to the unknown-path handling, like any other', async () => {
    for (const [role, home] of [['manager', '/chat'], ['super_admin', '/admin/conversations']] as const) {
      vi.stubGlobal('fetch', routeFetch({}))
      const { unmount } = renderWithProviders(
        <>
          <AppRoutes />
          <Where />
        </>,
        { staff: staff(role), route: '/families?bucket=now' },
      )
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(home))
      expect(screen.queryByRole('heading', { name: 'Families' })).not.toBeInTheDocument()
      unmount()
    }
  })

  it('is no longer where the Dashboard sends the manager', async () => {
    const fetchMock = routeFetch(DASHBOARD_ROUTES)
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AppRoutes />, { staff: dashboardManager, route: '/dashboard' })
    // PD-44: every tile opens a working page; none opens the retired families list.
    await screen.findByRole('link', { name: /Chats waiting for our reply/ })
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href') ?? '')
    expect(hrefs.filter((h) => /^\/families(\/|\?|$)/.test(h))).toEqual([])
    expect(fetchMock.mock.calls.some(([url]) => /\/families(\?|$)/.test(String(url)))).toBe(false)
  })
})

describe('The desktop rail', () => {
  beforeEach(() => viewport(1440))

  it('shows the super admin five destinations, Conversations current and More last', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/' })
    const nav = await screen.findByRole('navigation', { name: 'Admin Portal' })
    const items = [...nav.querySelectorAll('[data-destination]')]
    expect(items.map((el) => el.getAttribute('data-destination'))).toEqual([
      'conversations', 'calls', 'people', 'stories', 'more',
    ])
    // Conversations is a menu now -- Chat and All conversations -- and it is
    // where the super admin lands.
    await waitFor(() =>
      expect(within(nav).getByRole('button', { name: 'Conversations' })).toHaveAttribute('aria-current', 'true'),
    )
    // PD-13: Calls is built, so its single icon links straight to the page, unmarked.
    expect(within(nav).getByRole('link', { name: 'Calls' })).toHaveAttribute('href', '/admin/calls')
    // A placeholder still says so, inside its menu.
    expect(within(nav).queryByRole('link', { name: /In development/ })).not.toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'People & teams' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(nav).getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false')
    // The Dashboard is not a primary destination; it waits in the closed More menu.
    expect(within(nav).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('opens More as a grouped menu; choosing a page goes there and closes it', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations' })
    const nav = await screen.findByRole('navigation', { name: 'Admin Portal' })
    const more = within(nav).getByRole('button', { name: 'More' })
    await userEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')

    const menu = document.getElementById(more.getAttribute('aria-controls')!)!
    // 13 + Payments (PD-27, beside Instalments under Operations & performance)
    // + Materials (PD-29, under Overview).
    expect(within(menu).getAllByRole('link')).toHaveLength(15)
    expect(within(menu).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
      'Overview', 'Communication', 'Operations & performance', 'Administration',
    ])
    await userEvent.click(within(menu).getByRole('link', { name: 'Dashboard' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveAttribute('aria-current', 'true')
  })

  it('works from the keyboard: ArrowDown enters, arrows move and wrap, Escape returns', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories' })
    const nav = await screen.findByRole('navigation', { name: 'Admin Portal' })
    const people = within(nav).getByRole('button', { name: 'People & teams' })
    people.focus()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName('Users'))
    await userEvent.keyboard('{ArrowDown}')
    // PD-8: the people group's second page is the built Organization page (no badge).
    expect(document.activeElement).toHaveAccessibleName('Organization')
    await userEvent.keyboard('{ArrowDown}')
    // PD-10: then the Teachers page,
    expect(document.activeElement).toHaveAccessibleName('Teachers')
    await userEvent.keyboard('{ArrowDown}')
    // PD-21: then Accounts,
    expect(document.activeElement).toHaveAccessibleName('Accounts')
    await userEvent.keyboard('{ArrowDown}')
    // PD-38: then the Schedule,
    expect(document.activeElement).toHaveAccessibleName('Schedule')
    await userEvent.keyboard('{ArrowDown}')
    // PD-11 T4 / PD-16: then Trials & new students,
    expect(document.activeElement).toHaveAccessibleName('Trials & new students')
    await userEvent.keyboard('{ArrowDown}')
    // then Teacher credentials review,
    expect(document.activeElement).toHaveAccessibleName('Teacher credentials review')
    await userEvent.keyboard('{ArrowDown}')
    // PD-35 B5: then Escalations, closing the first People group,
    expect(document.activeElement).toHaveAccessibleName('Escalations')
    await userEvent.keyboard('{ArrowDown}')
    // PD-17: then Parents (an Operations section under People), then the menu wraps.
    expect(document.activeElement).toHaveAccessibleName('Parents')
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveAccessibleName('Users')
    await userEvent.keyboard('{Escape}')
    expect(people).toHaveAttribute('aria-expanded', 'false')
    expect(people).toHaveFocus()
  })

  it('closes an open menu on a click elsewhere', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories' })
    const nav = await screen.findByRole('navigation', { name: 'Admin Portal' })
    const more = within(nav).getByRole('button', { name: 'More' })
    await userEvent.click(more)
    await userEvent.click(screen.getByRole('heading', { level: 1 }))
    expect(more).toHaveAttribute('aria-expanded', 'false')
  })

  it('gives each operator role only its own destinations, and links a one-page destination directly', async () => {
    const cases: [StaffRole, string[], string[], string[]][] = [
      // role, destinations, direct links, menus
      // Conversations is a direct link to /chat (the legacy Inbox is retired).
      // PD-13: Calls is its own destination for every operating role.
      // Teacher Profile V2: the certificate review queue sits under People beside
      // the other people pages, so for admin and coverage People is a menu.
      // PD-44: the Dashboard is its own destination for a manager, beside Conversations.
      ['manager', ['conversations', 'dashboard', 'calls', 'people', 'stories', 'more'], ['Conversations', 'Dashboard', 'Calls', 'Stories'], ['People & teams', 'More']],
      ['admin', ['conversations', 'calls', 'people', 'stories', 'more'], ['Conversations', 'Calls', 'Stories', 'Tasks'], ['People & teams']],
      ['coverage', ['conversations', 'calls', 'people', 'stories', 'more'], ['Conversations', 'Calls', 'Stories', 'Tasks'], ['People & teams']],
      // PD-21: Accounts is every role's, so a department has two one-page destinations.
      ['finance', ['people', 'more'], ['Accounts', 'Tasks'], []],
    ]
    for (const [role, keys, links, menus] of cases) {
      vi.stubGlobal('fetch', routeFetch({}))
      const { unmount } = renderWithProviders(<AppRoutes />, { staff: staff(role), route: '/' })
      const nav = await screen.findByRole('navigation', { name: 'Jawwid Operations' })
      expect([...nav.querySelectorAll('[data-destination]')].map((el) => el.getAttribute('data-destination')), role).toEqual(keys)
      expect(within(nav).getAllByRole('link').map((l) => l.textContent), role).toEqual(links)
      expect(within(nav).queryAllByRole('button').map((b) => b.textContent), role).toEqual(menus)
      unmount()
    }
  })
})

describe('The retired Inbox', () => {
  // The legacy Inbox and everything it read (/inbox, /inbox/away-summary,
  // /inbox/shift-banner, /me/duty, /config, /staff, /families/:id) answer 404
  // for every persona: conversations live in Chat (/chat).
  it('no role can open it, and no role is shown a link to /inbox (menus opened); operators\' Conversations goes to /chat', async () => {
    for (const role of [...OPERATOR_ROLES, 'super_admin'] as StaffRole[]) {
      expect(visibleAreas(role), role).not.toContain('inbox')
    }
    for (const role of ['manager', 'admin', 'coverage', 'finance'] as StaffRole[]) {
      vi.stubGlobal('fetch', routeFetch({}))
      const { unmount } = renderWithProviders(<AppRoutes />, { staff: staff(role), route: '/' })
      const nav = await screen.findByRole('navigation', { name: 'Jawwid Operations' })
      for (const b of within(nav).queryAllByRole('button')) await userEvent.click(b)
      const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
      expect(hrefs.filter((h) => h?.startsWith('/inbox')), role).toEqual([])
      if (role !== 'finance') {
        expect(within(nav).getByRole('link', { name: 'Conversations' }), role).toHaveAttribute('href', '/chat')
      }
      unmount()
    }
  })

  it('is not a route: /inbox and /inbox/:familyId fall to the unknown-path handling, like any other', async () => {
    for (const route of ['/inbox', '/inbox/fam_1']) {
      for (const [role, home] of [['admin', '/chat'], ['manager', '/chat']] as const) {
        vi.stubGlobal('fetch', routeFetch({}))
        const { unmount } = renderWithProviders(
          <>
            <AppRoutes />
            <Where />
          </>,
          { staff: staff(role), route },
        )
        await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(home))
        unmount()
      }
    }
  })

  it('the shell no longer asks for duty, shift banners, config or staff', async () => {
    for (const role of ['manager', 'admin', 'coverage'] as StaffRole[]) {
      const fetchMock = routeFetch({})
      vi.stubGlobal('fetch', fetchMock)
      const { unmount } = renderWithProviders(<AppRoutes />, { staff: staff(role), route: '/tasks' })
      await screen.findByRole('navigation', { name: 'Jawwid Operations' })
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      const paths = fetchMock.mock.calls.map(([url]) => String(url).replace(/^.*\/api\/v1/, '').split('?')[0])
      expect(paths.filter((p) => /^\/(inbox|me\/duty|config|staff)(\/|$)/.test(p!)), role).toEqual([])
      unmount()
    }
  })

  it("is no longer where the Dashboard's cases send the manager", async () => {
    vi.stubGlobal('fetch', routeFetch(DASHBOARD_ROUTES))
    renderWithProviders(<AppRoutes />, { staff: dashboardManager, route: '/dashboard' })
    // PD-44: an escalation is counted and opens the Cases page, never the retired Inbox.
    expect(await screen.findByRole('link', { name: /Open cases in the department/ })).toHaveAttribute('href', '/cases?tab=department')
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href') ?? '')
    expect(hrefs.filter((h) => h.startsWith('/inbox'))).toEqual([])
  })
})

describe('The drawer, below desktop width', () => {
  it('lists every destination open, in Arabic and right to left', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations', locale: 'ar' })
    const nav = await screen.findByRole('navigation', { name: 'بوابة الإدارة' })
    expect(document.documentElement.dir).toBe('rtl')
    const conversations = within(nav).getByRole('group', { name: 'المحادثات' })
    expect(within(conversations).getByRole('link', { name: 'كل المحادثات' })).toHaveAttribute('aria-current', 'page')
    expect(within(conversations).getByRole('link', { name: 'الدردشة' })).toHaveAttribute('href', '/chat')
    expect(within(nav).getByRole('group', { name: 'الأشخاص والفرق' })).toBeInTheDocument()
    const more = within(nav).getByRole('group', { name: 'المزيد' })
    expect(within(more).getByRole('link', { name: 'لوحة المتابعة' })).toBeInTheDocument()
    expect(within(more).getByRole('link', { name: 'المواد التعليمية' })).toHaveAttribute('href', '/materials')
    expect(within(nav).getAllByRole('link', { name: 'التصعيدات' })[0]).toHaveAttribute('href', '/cases')
    const people = within(nav).getByRole('group', { name: 'الأشخاص والفرق' })
    expect(within(people).getByRole('link', { name: 'الحصص التجريبية والطلاب الجدد' })).toHaveAttribute('href', '/trials')
    expect(within(people).getByRole('link', { name: 'مراجعة مؤهلات المعلمين' })).toHaveAttribute('href', '/teacher-profiles')
    expect(within(nav).getAllByRole('link')).toHaveLength(28)
  })

  it('opens from the menu button and closes with Escape, giving focus back', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations' })
    expect(document.documentElement.dir).toBe('ltr')
    const open = await screen.findByRole('button', { name: 'Open navigation' })
    await userEvent.click(open)
    expect(open).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Escape}')
    expect(open).toHaveAttribute('aria-expanded', 'false')
    expect(open).toHaveFocus()
  })
})

describe('Conversation tools live in the conversation workspace', () => {
  const conversation = (id: string, type: string, name: string) => ({
    id, type, state: 'open', title: null, familyId: 'f', familyName: name, liveMembers: 2,
    lastActivityAt: new Date().toISOString(), createdAt: new Date().toISOString(), archivedAt: null,
  })
  const CONVERSATIONS = {
    truncated: false,
    conversations: [
      conversation('c1', 'direct', 'Direct one'),
      conversation('c2', 'direct', 'Direct two'),
      conversation('c3', 'student_group', 'Student group one'),
      conversation('c4', 'class_group', 'Class group one'),
      conversation('c5', 'official', 'Announcements'),
    ],
  }
  const names = () => [...document.querySelectorAll('.conv-row__name')].map((n) => n.textContent)

  it('offers All, Direct, Groups and Official in the inbox, and no unread or favourites view', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/conversations': CONVERSATIONS }))
    renderWithProviders(
      <>
        <AppRoutes />
        <Where />
      </>,
      { staff: superAdmin, route: '/admin/conversations' },
    )
    await screen.findByText('Direct one')
    const list = document.getElementById('conversation-list')!
    const views = within(list).getByRole('group', { name: 'Conversation type' })
    expect(within(views).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All5', 'Direct2', 'Groups2', 'Official1',
    ])
    await userEvent.click(within(views).getByRole('button', { name: /Groups/ }))
    expect(names()).toEqual(['Student group one', 'Class group one'])
    expect(screen.getByTestId('where')).toHaveTextContent('type=groups')
    // Neither exists in the admin API, so neither is offered.
    expect(screen.queryByRole('button', { name: /unread|favou?rite/i })).not.toBeInTheDocument()
    // And the navigation carries none of these filters.
    expect(within(screen.getByRole('navigation')).queryByRole('button', { name: /Groups/ })).not.toBeInTheDocument()
  })

  it('still honours an older link to a single group type', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/conversations': CONVERSATIONS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations?type=student_group' })
    await screen.findByText('Student group one')
    expect(screen.getByRole('button', { name: /Student group/, pressed: true })).toBeInTheDocument()
    expect(names()).toEqual(['Student group one'])
  })
})
