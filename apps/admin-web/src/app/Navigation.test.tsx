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

beforeEach(() => {
  localStorage.clear()
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('The navigation registry', () => {
  it('gives each of the nineteen sections exactly one destination, with the Dashboard under More', () => {
    const destinations = destinationsFor('super_admin')
    expect(destinations.map((d) => d.key)).toEqual(['conversations', 'calls', 'people', 'stories', 'more'])
    const keys = destinations.flatMap((d) => entriesOf(d).map((e) => e.key))
    expect(keys).toHaveLength(19)
    expect([...keys].sort()).toEqual(ADMIN_SECTIONS.map((s) => s.key).sort())
    const more = destinations.find((d) => d.key === 'more')!
    expect(entriesOf(more).map((e) => e.key)).toContain('dashboard')
  })

  it('lists for each role exactly the pages it may open: nothing hidden, nothing extra', () => {
    for (const role of OPERATOR_ROLES) {
      for (const [lessonManager, billingReader] of [[false, false], [true, false], [false, true], [true, true]] as const) {
        const listed = destinationsFor(role, { lessonManager, billingReader }).flatMap((d) => entriesOf(d).map((e) => e.path))
        // Exactly the openable areas, with TWO deliberate exceptions: the legacy
        // Inbox stays routable (old links) but is never offered -- its API
        // routes (/inbox, /families/*) exist on no branch; and Teacher
        // statistics is offered only when the server confirms the Teachers
        // department (GET /lessons/access), which the role alone cannot tell --
        // and Instalments likewise waits for Operations (GET /instalments/access).
        const allowed = navAreas(role, { lessonManager, billingReader })
          .filter((a): a is Exclude<NavArea, 'settings'> => a !== 'settings')
          .map((a) => AREA_PATH[a])
        expect([...listed].sort(), role).toEqual([...allowed].sort())
        expect(listed, role).not.toContain('/inbox')
        const withheld = [
          ...(visibleAreas(role).includes('inbox') ? ['inbox'] : []),
          ...(!lessonManager && visibleAreas(role).includes('teachers') ? ['teachers'] : []),
          ...(!billingReader && visibleAreas(role).includes('instalments') ? ['instalments'] : []),
        ]
        expect(visibleAreas(role).filter((a) => !navAreas(role, { lessonManager, billingReader }).includes(a)), role).toEqual(withheld)
        expect(listed.some((p) => p.startsWith('/admin/')), role).toBe(false)
      }
    }
    // And the super admin's navigation is the portal, not the operator screens.
    const listed = destinationsFor('super_admin').flatMap((d) => entriesOf(d).map((e) => e.path))
    expect(listed.every((p) => p.startsWith('/admin/'))).toBe(true)
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
    renderWithProviders(<AppRoutes />, { staff: staff('admin'), route: '/coverage' })
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission")
    expect(within(screen.getByRole('navigation')).queryByRole('link', { name: 'Coverage' })).not.toBeInTheDocument()
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
    await waitFor(() =>
      expect(within(nav).getByRole('link', { name: 'Conversations' })).toHaveAttribute('aria-current', 'page'),
    )
    // A placeholder says so, even as a single icon.
    expect(within(nav).getByRole('link', { name: 'Calls & media In development' })).toBeInTheDocument()
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
    expect(within(menu).getAllByRole('link')).toHaveLength(13)
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
    // PD-10: then the Teachers page, then the menu wraps.
    expect(document.activeElement).toHaveAccessibleName('Teachers')
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
      // Conversations is a direct link to /chat: the legacy Inbox is not offered.
      ['manager', ['conversations', 'people', 'stories', 'more'], ['Conversations', 'Stories'], ['People & teams', 'More']],
      ['admin', ['conversations', 'people', 'stories', 'more'], ['Conversations', 'Families', 'Stories', 'Tasks'], []],
      ['finance', ['more'], ['Tasks'], []],
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

describe('The legacy Inbox is not offered as a destination', () => {
  it('no role is shown a link to /inbox (menus opened); operators\' Conversations goes to /chat; /inbox itself still routes', async () => {
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
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: staff('admin'), route: '/inbox' })
    await screen.findByRole('navigation', { name: 'Jawwid Operations' })
    // Routed to the Inbox page itself, not refused: an old link still lands.
    expect(document.querySelector('.state--forbidden')).toBeNull()
  })
})

describe('The drawer, below desktop width', () => {
  it('lists every destination open, in Arabic and right to left', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations', locale: 'ar' })
    const nav = await screen.findByRole('navigation', { name: 'بوابة الإدارة' })
    expect(document.documentElement.dir).toBe('rtl')
    expect(within(nav).getByRole('link', { name: 'المحادثات' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('group', { name: 'الأشخاص والفرق' })).toBeInTheDocument()
    const more = within(nav).getByRole('group', { name: 'المزيد' })
    expect(within(more).getByRole('link', { name: 'لوحة المتابعة' })).toBeInTheDocument()
    expect(within(nav).getAllByRole('link')).toHaveLength(19)
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
