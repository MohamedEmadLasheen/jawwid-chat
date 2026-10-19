import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'

/**
 * The redesigned Dashboard, Conversations and Stories pages (2026-10-13).
 * Everything here is read-only and every figure comes from the mocked API:
 * these tests pin the new navigation (links, URL state), the honest states
 * (stale, error) and that no publishing control appeared with the new layout.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Routes each API path to a body, or to a status code when the value is a number. */
function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/v1/, '').split('?')[0]!
    if (path in routes) {
      const r = routes[path]
      return typeof r === 'number'
        ? jsonResponse({ error: { code: 'SERVER.ERROR', message: 'server error' } }, r)
        : jsonResponse(r)
    }
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404)
  })
}

const NOW = Date.now()
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const HOUR = 3_600_000
const DAY = 24 * HOUR
const superAdmin = makeStaff({ id: 'owner_o', name: 'Owner O', role: 'super_admin' })

const OVERVIEW = {
  organization: { id: 'org', slug: 'qa', displayName: 'QA Academy' },
  accounts: { staff: { active: 2, inactive: 0 } },
  staffByRole: { admin: 1, super_admin: 1 },
  teachers: 3,
  families: 7,
  contacts: 9,
  conversationsByType: { direct: 3, student_group: 1 },
  messages: 42,
  storiesByState: { draft: 1, published: 2 },
  generatedAt: new Date(NOW).toISOString(),
}

function conversation(id: string, over: Record<string, unknown> = {}) {
  return {
    id, type: 'direct', state: 'open', title: null, familyId: 'f', familyName: `Family ${id}`,
    liveMembers: 2, lastActivityAt: ago(HOUR), createdAt: ago(30 * DAY), archivedAt: null, ...over,
  }
}

// Newest first, as the API returns it.
const CONVERSATIONS = {
  truncated: false,
  conversations: [
    conversation('11111111-1111-4111-8111-111111111111', { familyName: 'Alpha', lastActivityAt: ago(60_000) }),
    conversation('22222222-2222-4222-8222-222222222222', { familyName: 'Charlie', state: 'waiting_on_jawwid', lastActivityAt: ago(3 * DAY) }),
    conversation('33333333-3333-4333-8333-333333333333', { familyName: 'Bravo', state: 'waiting_on_jawwid', lastActivityAt: ago(40 * DAY) }),
  ],
}

function story(id: string, over: Record<string, unknown> = {}) {
  return {
    id, kind: 'text', internalName: `Story ${id}`, title: null, body: 'hello', background: 'teal',
    mediaKind: null, mediaUrl: null, mediaDurationMs: null, cta: null, state: 'published',
    createdAt: ago(2 * DAY), publishedAt: ago(2 * DAY), expiresAt: null, deletedAt: null,
    createdBy: 'a', creatorName: 'Admin A', audiences: [{ kind: 'segment', refId: null, filter: { who: 'everyone' } }],
    recipientCount: 20, viewCount: 10, ctaTapCount: 0, ctaTapperCount: 0, ...over,
  }
}

const STORIES = {
  stories: [
    story('one', { viewCount: 5 }),
    story('two', { viewCount: 18 }),
    story('three', { state: 'draft', recipientCount: 0, viewCount: 0, publishedAt: null }),
  ],
}

beforeEach(() => {
  localStorage.clear()
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('Dashboard', () => {
  it('puts what needs attention first, with the oldest waiting activity, and links every count', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/overview': OVERVIEW, '/admin/conversations': CONVERSATIONS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/dashboard' })

    const attention = await screen.findByRole('region', { name: 'Needs attention' })
    const waiting = await within(attention).findByRole('link', { name: /waiting on a reply from us/ })
    // The least recent of the two waiting conversations is 40 days old.
    expect(waiting).toHaveTextContent('Oldest activity 40 days ago')

    expect(screen.getByRole('link', { name: /Families/ })).toHaveAttribute('href', '/admin/users?kind=contact')
    expect(screen.getByRole('link', { name: /People/ })).toHaveAttribute('href', '/admin/users')
    expect(screen.getByRole('link', { name: /^Waiting on us\s*2$/ })).toHaveAttribute(
      'href',
      '/admin/conversations?state=waiting_on_jawwid',
    )
  })

  it('keeps earlier figures only under an explicit "couldn’t refresh" warning', async () => {
    let fail = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url).replace(/^.*\/api\/v1/, '')
        if (path === '/admin/overview') return fail ? jsonResponse({ error: { code: 'X', message: 'x' } }, 404) : jsonResponse(OVERVIEW)
        if (path === '/admin/conversations') return jsonResponse(CONVERSATIONS)
        return jsonResponse({}, 404)
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/dashboard' })
    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(screen.queryByText(/Couldn’t refresh/)).not.toBeInTheDocument()

    fail = true
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText(/Couldn’t refresh\. Showing figures from/)).toBeInTheDocument()
    // The figures stay visible, labelled as old -- not replaced, not presented as current.
    expect(screen.getByText('42')).toBeInTheDocument()
  })
})

describe('Conversations', () => {
  it('groups the list by day and can sort oldest first, keeping the order in the URL', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/conversations': CONVERSATIONS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations' })
    await screen.findByText('Alpha')
    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Older' })).toBeInTheDocument()

    const names = () => [...document.querySelectorAll('.conv-row__name')].map((n) => n.textContent)
    expect(names()).toEqual(['Alpha', 'Charlie', 'Bravo'])
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'oldest')
    expect(names()).toEqual(['Bravo', 'Charlie', 'Alpha'])
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'name')
    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    // Name order has no day sections.
    expect(screen.queryByRole('heading', { level: 2, name: 'Today' })).not.toBeInTheDocument()
  })

  it('lets the list be resized from the keyboard, within limits, on a wide screen', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: /min-width: (1024|1280)px/.test(q),
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    vi.stubGlobal('fetch', routeFetch({ '/admin/conversations': CONVERSATIONS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations' })
    const splitter = await screen.findByRole('separator', { name: 'Resize conversation list' })
    expect(splitter).toHaveAttribute('aria-valuenow', '360')
    fireEvent.keyDown(splitter, { key: 'ArrowRight' })
    expect(splitter).toHaveAttribute('aria-valuenow', '376')
    fireEvent.keyDown(splitter, { key: 'End' })
    expect(splitter).toHaveAttribute('aria-valuenow', '520')
    fireEvent.keyDown(splitter, { key: 'Enter' })
    expect(splitter).toHaveAttribute('aria-valuenow', '360')
    expect(localStorage.getItem('jawwid.admin.listWidth')).toBe('360')
  })

  it('shows the read-only bar where a composer would be, and no way to type', async () => {
    const id = CONVERSATIONS.conversations[0]!.id
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/admin/conversations': CONVERSATIONS,
        [`/admin/conversations/${id}/messages`]: { messages: [] },
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: `/admin/conversations?c=${id}` })
    expect(await screen.findByText('Read-only. Replying is not available to this account.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('Stories', () => {
  it('filters by status through links that keep the filter in the URL', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/stories': STORIES }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories' })
    await screen.findByRole('link', { name: 'Story one' })

    const tiles = screen.getByRole('navigation', { name: 'Status' })
    // Every state is shown, with its real count, including zero.
    expect(within(tiles).getByRole('link', { name: /Deleted\s*0/ })).toBeInTheDocument()
    await userEvent.click(within(tiles).getByRole('link', { name: /Draft\s*1/ }))
    expect(screen.getByRole('link', { name: 'Story three' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Story one' })).not.toBeInTheDocument()
    expect(within(tiles).getByRole('link', { name: /Draft\s*1/ })).toHaveAttribute('aria-current', 'true')
    // A draft is published from its row.
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument()
  })

  it('sorts by views and shows reach as "N of M viewed"', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/stories': STORIES }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories' })
    await screen.findByRole('link', { name: 'Story one' })
    expect(screen.getByText('18 of 20 viewed')).toBeInTheDocument()
    expect(screen.getByText('Not published')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'views')
    const titles = [...document.querySelectorAll('.story-row__name')].map((n) => n.textContent)
    expect(titles).toEqual(['Story two', 'Story one', 'Story three'])
  })
})

describe('Users', () => {
  it('opens pre-filtered from the dashboard link (?kind=contact)', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/admin/users': {
          truncated: false,
          users: [
            { principalKind: 'staff', id: 's1', displayName: 'Staff S', staffRole: 'admin', familyId: null, isActive: true, hasLogin: true, accountStatus: 'active', lastLoginAt: null, createdAt: ago(DAY) },
            { principalKind: 'contact', id: 'c1', displayName: 'Parent P', staffRole: null, familyId: 'f', isActive: true, hasLogin: false, accountStatus: null, lastLoginAt: null, createdAt: ago(DAY) },
          ],
        },
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/users?kind=contact' })
    expect(await screen.findByRole('button', { name: 'Parent P' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Staff S' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Family contacts/, pressed: true })).toBeInTheDocument()
  })
})

describe('Users summary and sort', () => {
  const user = (id: string, displayName: string, over: Record<string, unknown> = {}) => ({
    principalKind: 'staff', id, displayName, staffRole: 'admin', familyId: null, isActive: true, hasLogin: true,
    accountStatus: 'active', lastLoginAt: null, createdAt: ago(DAY), ...over,
  })
  const USERS = {
    truncated: false,
    users: [
      user('z', 'Zed', { lastLoginAt: ago(HOUR), createdAt: ago(10 * DAY) }),
      user('a', 'Amy', { lastLoginAt: ago(DAY), createdAt: ago(2 * DAY), isActive: false, accountStatus: 'disabled' }),
      user('b', 'Bob', { principalKind: 'contact', staffRole: null, familyId: 'f', hasLogin: false, accountStatus: null, createdAt: ago(HOUR) }),
    ],
  }
  const names = () => [...document.querySelectorAll('.table .entity__name')].map((n) => n.textContent)

  it('counts the whole directory, whatever the filters, and deep-links the sort order', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/users': USERS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/users?sort=newest&kind=staff' })
    await screen.findByRole('button', { name: 'Zed' })

    const strip = document.querySelector('.summary-strip') as HTMLElement
    const figure = (label: string) => within(strip).getByText(label).nextElementSibling?.textContent
    expect([figure('People'), figure('Active'), figure('Inactive'), figure('No login')]).toEqual(['3', '2', '1', '1'])

    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('newest')
    expect(names()).toEqual(['Amy', 'Zed'])
  })

  it('sorts by name, by most recent sign-in (never-signed-in last), and by newest added', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/users': USERS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/users' })
    await screen.findByRole('button', { name: 'Zed' })
    expect(names()).toEqual(['Amy', 'Bob', 'Zed'])

    const sort = screen.getByRole('combobox', { name: 'Sort' })
    await userEvent.selectOptions(sort, 'signin')
    expect(names()).toEqual(['Zed', 'Amy', 'Bob'])
    await userEvent.selectOptions(sort, 'newest')
    expect(names()).toEqual(['Bob', 'Amy', 'Zed'])
  })
})

describe('Section placeholders', () => {
  it('points to the sections in the same group that work today, and to nothing else', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    // Notifications is unbuilt; its group (Communication) has two built sections.
    // (Teams was the example here until PD-8 built it as Organization.)
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/notifications' })
    await screen.findByTestId('development-placeholder')

    const aside = screen.getByRole('complementary', { name: 'Available now in this group' })
    const links = within(aside).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/admin/conversations', '/admin/stories'])
    expect(within(screen.getByTestId('development-placeholder')).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows no "available now" list in a group where nothing is built yet', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/audit' })
    await screen.findByTestId('development-placeholder')
    expect(screen.queryByRole('complementary', { name: 'Available now in this group' })).not.toBeInTheDocument()
  })
})
