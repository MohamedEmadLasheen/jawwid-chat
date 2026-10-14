import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { sessionApi, NOT_STAFF_CODE } from '@/core/api/endpoints'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { ADMIN_GROUPS, ADMIN_SECTIONS, sectionsInGroup } from './sections'
import { effectiveState } from './StoriesView'

/**
 * The super admin's view of the portal.
 *
 * NAVIGATION IS NOT SECURITY, and these tests do not claim it is: every
 * `/admin/*` request is refused server-side for anyone but super_admin (API
 * integration suite `super-admin-bootstrap.spec.ts`). What is asserted here is
 * that the portal tells the truth: every planned section is reachable, an
 * unbuilt one says so instead of looking finished, and every figure on screen
 * came from the API.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Routes each `/admin/*` path to a body; anything else is a 404. */
function routeFetch(routes: Record<string, unknown>) {
  // `init` is unused here, but naming it types `mock.calls[n][1]` for the assertions.
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/v1/, '')
    for (const [suffix, body] of Object.entries(routes)) {
      if (path === suffix || path.split('?')[0] === suffix) return jsonResponse(body)
    }
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404)
  })
}

const NOW = new Date().toISOString()
const superAdmin = makeStaff({ id: 'owner_o', name: 'Owner O', role: 'super_admin' })

const OVERVIEW = {
  organization: { id: 'org', slug: 'qa', displayName: 'QA Academy' },
  accounts: { staff: { active: 2, inactive: 1 }, family: { active: 1, inactive: 0 } },
  staffByRole: { admin: 1, super_admin: 1 },
  teachers: 3,
  families: 7,
  contacts: 9,
  conversationsByType: { direct: 4, student_group: 1 },
  messages: 42,
  storiesByState: { draft: 2, published: 1 },
  generatedAt: NOW,
}

function conversation(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'direct',
    state: 'open',
    title: null,
    familyId: 'f1',
    familyName: 'Family One',
    liveMembers: 2,
    lastActivityAt: NOW,
    createdAt: NOW,
    archivedAt: null,
    ...over,
  }
}

const CONVERSATIONS = {
  truncated: false,
  conversations: [
    conversation(),
    conversation({ id: '22222222-2222-4222-8222-222222222222', familyName: 'Family Two', state: 'waiting_on_jawwid' }),
    conversation({ id: '33333333-3333-4333-8333-333333333333', familyName: 'Group Three', type: 'student_group', state: 'resolved', liveMembers: 5 }),
  ],
}

function user(over: Record<string, unknown> = {}) {
  return {
    principalKind: 'staff',
    id: 'owner_o',
    displayName: 'Owner O',
    staffRole: 'super_admin',
    familyId: null,
    isActive: true,
    hasLogin: true,
    accountStatus: 'active',
    lastLoginAt: null,
    createdAt: NOW,
    ...over,
  }
}

beforeEach(() => {
  localStorage.clear()
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('Admin Portal registry and navigation', () => {
  it('registers exactly the seventeen planned sections, each in a group', () => {
    expect(ADMIN_SECTIONS.map((s) => s.key).sort()).toEqual(
      [
        'academy', 'approvals', 'audit', 'calls', 'conversations', 'dashboard', 'forms', 'integrations',
        'notifications', 'quality', 'reports', 'settings', 'stories', 'tasks', 'teams', 'users', 'whatsapp',
      ].sort(),
    )
    // Every one has both languages, a purpose and a stated backend status.
    for (const s of ADMIN_SECTIONS) {
      for (const b of [s.label, s.purpose, s.note]) {
        expect(b.en.length).toBeGreaterThan(0)
        expect(b.ar.length).toBeGreaterThan(0)
      }
    }
    expect(ADMIN_GROUPS.flatMap((g) => sectionsInGroup(g.key))).toHaveLength(17)
    // Only the four sections with a real endpoint claim to be built.
    expect(ADMIN_SECTIONS.filter((s) => s.status === 'read_only').map((s) => s.key).sort()).toEqual(
      ['conversations', 'dashboard', 'stories', 'users'],
    )
  })

  it('every section is reachable from the navigation, and the unbuilt ones are marked', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/teams' })
    const nav = await screen.findByRole('navigation')

    // Five destinations hold all seventeen sections. Below desktop width the
    // drawer lists every one of them, none behind a toggle. (The desktop
    // rail's menus are covered in app/Navigation.test.tsx.)
    expect(within(nav).getAllByRole('link')).toHaveLength(17)
    const inDevelopment = ADMIN_SECTIONS.filter((s) => s.status === 'in_development').length
    expect(within(nav).getAllByText('In development')).toHaveLength(inDevelopment)
  })

  it('keeps the Dashboard out of the primary destinations, one step away under More', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/dashboard' })
    const nav = await screen.findByRole('navigation')
    // Its URL still opens it, and the navigation still marks where you are.
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    const more = within(nav).getByRole('group', { name: 'More' })
    expect(within(more).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getAllByRole('link', { name: 'Dashboard' })).toHaveLength(1)
  })

  it('an unbuilt section is an explicit placeholder that requests no data', async () => {
    const fetchMock = routeFetch({})
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/whatsapp' })
    const placeholder = await screen.findByTestId('development-placeholder')
    expect(placeholder).toHaveTextContent('This section is in development.')
    // No table, no figure, no action that could be mistaken for a working one.
    expect(within(placeholder).queryByRole('table')).not.toBeInTheDocument()
    expect(within(placeholder).queryByRole('button')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/admin/'))).toBe(false)
  })

  it('lands the super admin on Conversations', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Conversations' })).toBeInTheDocument()
  })

  it('says the account is read-only, once, in the top bar', async () => {
    vi.stubGlobal('fetch', routeFetch({}))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/users' })
    expect(await screen.findByText('Read-only access')).toBeInTheDocument()
  })

  // Regression: Sign out used to revoke the session and clear the tokens while
  // the signed-in shell stayed on screen.
  it('Sign out ends the server session, forgets the tokens, and shows the login form', async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/teams' })
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/logout'))).toBe(true)
    expect(tokenStore.hasSession()).toBe(false)
  })
})

describe('Dashboard', () => {
  it('shows only figures the API returned, and links what needs attention', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/overview': OVERVIEW, '/admin/conversations': CONVERSATIONS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/dashboard' })

    expect(await screen.findByText('QA Academy')).toBeInTheDocument()
    expect(screen.getByText('9 family contacts')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    // 2 staff + 3 teachers + 9 contacts
    expect(screen.getByText('14')).toBeInTheDocument()

    const attention = screen.getByRole('region', { name: 'Needs attention' })
    const waiting = await within(attention).findByRole('link', { name: /waiting on a reply from us/ })
    expect(waiting).toHaveAttribute('href', '/admin/conversations?state=waiting_on_jawwid')
    expect(within(attention).getByRole('link', { name: /still in draft/ })).toHaveAttribute(
      'href',
      '/admin/stories?state=draft',
    )
  })

  it('says nothing needs attention when nothing does, rather than showing zeros', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/admin/overview': { ...OVERVIEW, storiesByState: { published: 1 } },
        '/admin/conversations': { truncated: false, conversations: [conversation()] },
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/dashboard' })
    expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument()
  })
})

describe('Conversations', () => {
  it('lists conversations with localized type and state, never raw enum values', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/conversations': CONVERSATIONS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations' })
    expect(await screen.findByText('Family Two')).toBeInTheDocument()
    expect(screen.getAllByText('Waiting on us').length).toBeGreaterThan(0)
    expect(screen.getByText('Student group · 5 members')).toBeInTheDocument()
    expect(screen.queryByText('waiting_on_jawwid')).not.toBeInTheDocument()
    expect(screen.queryByText('direct')).not.toBeInTheDocument()
  })

  it('filters by status from the URL, as the dashboard links to it', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/conversations': CONVERSATIONS }))
    renderWithProviders(<AppRoutes />, {
      staff: superAdmin,
      route: '/admin/conversations?state=waiting_on_jawwid',
    })
    expect(await screen.findByText('Family Two')).toBeInTheDocument()
    expect(screen.queryByText('Family One')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Waiting on us/, pressed: true })).toBeInTheDocument()
  })

  it('searches by name', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/conversations': CONVERSATIONS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations' })
    await screen.findByText('Family One')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search by name' }), 'group')
    expect(screen.getByText('Group Three')).toBeInTheDocument()
    expect(screen.queryByText('Family One')).not.toBeInTheDocument()
  })

  it('opens a conversation read-only: messages, and no way to reply', async () => {
    const id = CONVERSATIONS.conversations[0]!.id
    const fetchMock = routeFetch({
      '/admin/conversations': CONVERSATIONS,
      [`/admin/conversations/${id}/messages`]: {
        messages: [
          {
            id: 'm1', seq: '1', authorKind: 'contact', authorName: 'Parent P', type: 'text',
            visibility: 'customer', moderation: 'published', body: 'Hello from the family',
            deleted: false, attachments: 0, createdAt: NOW,
          },
          {
            id: 'm2', seq: '2', authorKind: 'teacher', authorName: 'Teacher T', type: 'voice',
            visibility: 'customer', moderation: 'pending', body: null,
            deleted: false, attachments: 1, createdAt: NOW,
          },
          {
            id: 'm3', seq: '3', authorKind: 'staff', authorName: 'Admin A', type: 'text',
            visibility: 'customer', moderation: 'published', body: null,
            deleted: true, attachments: 0, createdAt: NOW,
          },
        ],
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: `/admin/conversations?c=${id}` })

    expect(await screen.findByText('Hello from the family')).toBeInTheDocument()
    expect(screen.getByText('Voice message')).toBeInTheDocument()
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument()
    expect(screen.getByText('This message was deleted.')).toBeInTheDocument()
    expect(screen.getByText('Read-only. Replying is not available to this account.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([, init]) => !init || !init.method || init.method === 'GET')).toBe(true)
  })

  it('renders a system message from its { kind, ...facts } body, never the raw JSON', async () => {
    const id = CONVERSATIONS.conversations[0]!.id
    vi.stubGlobal('fetch', routeFetch({
      '/admin/conversations': CONVERSATIONS,
      [`/admin/conversations/${id}/messages`]: {
        messages: [
          {
            id: 's1', seq: '1', authorKind: 'system', authorName: null, type: 'system',
            visibility: 'customer', moderation: 'published', body: '{"kind":"group.created","learner":"Learner L"}',
            deleted: false, attachments: 0, createdAt: NOW,
          },
          {
            id: 's2', seq: '2', authorKind: 'system', authorName: null, type: 'system',
            visibility: 'customer', moderation: 'published', body: '{"kind":"some.future.kind"}',
            deleted: false, attachments: 0, createdAt: NOW,
          },
        ],
      },
    }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: `/admin/conversations?c=${id}` })

    expect(await screen.findByText('Student Group created for Learner L')).toBeInTheDocument()
    expect(screen.getByText('System update')).toBeInTheDocument()
    expect(screen.queryByText(/"kind"/)).not.toBeInTheDocument()
  })
})

describe('Users', () => {
  const USERS = {
    truncated: false,
    users: [
      user(),
      user({ principalKind: 'teacher', id: 't1', displayName: 'Teacher T', staffRole: null }),
      user({
        principalKind: 'contact', id: 'c1', displayName: 'Parent P', staffRole: null, familyId: 'f1',
        isActive: false, hasLogin: false, accountStatus: null,
      }),
    ],
  }

  it('reads the real /admin endpoint with the bearer token', async () => {
    const fetchMock = routeFetch({ '/admin/users': USERS })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/users' })
    expect(await screen.findByRole('button', { name: 'Owner O' })).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/admin/users'))!
    expect((call[1]?.headers as Record<string, string>)['Authorization']).toBe('Bearer access-1')
  })

  it('filters by kind and status, and shows each user in a read-only sheet', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/users': USERS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/users' })
    await screen.findByRole('button', { name: 'Owner O' })

    await userEvent.click(screen.getByRole('button', { name: /Teachers/ }))
    expect(screen.getByRole('button', { name: 'Teacher T' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Owner O' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^All/ }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'inactive')
    expect(screen.getByRole('button', { name: 'Parent P' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Owner O' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Parent P' }))
    const sheet = await screen.findByRole('dialog', { name: 'Parent P' })
    expect(within(sheet).getByText('No login')).toBeInTheDocument()
    expect(within(sheet).queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('Stories', () => {
  // The portal's Stories section is GET /admin/stories (super_admin, read-only).
  // The legacy /stories screen is the publisher's, and the server refuses it to
  // super_admin by design -- the page must say so rather than imply it works.
  it('reads /admin/stories, offers no publishing control, and explains why', async () => {
    const fetchMock = routeFetch({
      '/admin/stories': {
        truncated: false,
        stories: [
          {
            id: 's1', title: 'Story one', state: 'draft', creatorName: 'admin_a', recipients: 0,
            views: 0, createdAt: NOW, publishedAt: null, expiresAt: null, deletedAt: null,
          },
        ],
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories' })
    expect(await screen.findByRole('button', { name: 'Story one' })).toBeInTheDocument()
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0)
    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.some((u) => u.endsWith('/admin/stories'))).toBe(true)
    expect(urls.some((u) => /\/stories(\?|$)/.test(u.replace('/admin/stories', '')))).toBe(false)
    expect(screen.getByText(/unsupported for Super Admin by design/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /publish|create|delete/i })).not.toBeInTheDocument()
  })

  it('treats a published story past its expiry as expired, because viewers can no longer see it', () => {
    const base = {
      id: 's', title: null, creatorName: 'a', recipients: 0, views: 0, createdAt: NOW, deletedAt: null,
    }
    const past = new Date(Date.now() - 60_000).toISOString()
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(effectiveState({ ...base, state: 'published', publishedAt: NOW, expiresAt: past })).toBe('expired')
    expect(effectiveState({ ...base, state: 'published', publishedAt: NOW, expiresAt: future })).toBe('published')
    expect(effectiveState({ ...base, state: 'draft', publishedAt: null, expiresAt: null })).toBe('draft')
  })
})

describe('Arabic', () => {
  it('is the portal in Arabic, right to left, with Arabic plural forms', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/admin/conversations': CONVERSATIONS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/conversations', locale: 'ar' })
    expect(await screen.findByRole('heading', { level: 1, name: 'المحادثات' })).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
    // Two members is the Arabic dual, not "٢ عضو".
    expect((await screen.findAllByText('مباشرة · عضوان')).length).toBeGreaterThan(0)
    expect(screen.getByText('وصول للقراءة فقط')).toBeInTheDocument()
  })
})

describe('Admin Portal for anyone else', () => {
  it('a manager reaching /admin/* gets the forbidden page, not the section', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 404)))
    renderWithProviders(<AppRoutes />, {
      staff: makeStaff({ role: 'manager' }),
      route: '/admin/users',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission")
    expect(screen.queryByText('In development')).not.toBeInTheDocument()
    expect(screen.queryByText('Read-only access')).not.toBeInTheDocument()
  })

  it('a valid PARENT login is refused by Admin Web and its new session is ended', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/login')) {
        return jsonResponse({
          tokenType: 'Bearer',
          accessToken: 'parent-access',
          expiresIn: 900,
          refreshToken: 'parent-refresh',
          actor: {
            actorId: 'contact_1',
            kind: 'contact',
            displayName: 'Parent',
            locale: 'ar',
            isActive: true,
            staffRole: null,
            organizationId: 'org',
          },
        })
      }
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    tokenStore.clear()

    await expect(sessionApi.login('parent@qa.jawwid.test', 'pw')).rejects.toMatchObject({
      code: NOT_STAFF_CODE,
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/logout'))).toBe(true)
    await waitFor(() => expect(tokenStore.hasSession()).toBe(false))
  })
})
