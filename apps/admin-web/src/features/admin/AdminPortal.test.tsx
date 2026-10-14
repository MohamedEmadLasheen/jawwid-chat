import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { sessionApi, NOT_STAFF_CODE } from '@/core/api/endpoints'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { ADMIN_SECTIONS } from './sections'

/**
 * The super admin's first view of the portal.
 *
 * NAVIGATION IS NOT SECURITY, and these tests do not claim it is: every
 * `/admin/*` request is refused server-side for anyone but super_admin (API
 * integration suite `super-admin-bootstrap.spec.ts`). What is asserted here is
 * that the portal tells the truth: every planned section is visible, and an
 * unbuilt one says so instead of looking finished.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const superAdmin = makeStaff({ id: 'owner_o', name: 'Owner O', role: 'super_admin' })

describe('Admin Portal for the super admin', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse({ users: [], truncated: false }))
    vi.stubGlobal('fetch', fetchMock)
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    tokenStore.clear()
  })

  it('registers exactly the seventeen planned sections', () => {
    expect(ADMIN_SECTIONS.map((s) => s.label.en)).toEqual([
      'Dashboard',
      'Inbox / Conversations',
      'Users',
      'Team Management',
      'Stories',
      'Quality & Supervision',
      'Reports & Analytics',
      'Notifications & Announcements',
      'Calls & Media',
      'Academy Operations',
      'Integrations',
      'Audit Log',
      'Forms & Surveys',
      'WhatsApp Business Center',
      'Tasks & Follow-ups',
      'Approvals',
      'System Settings',
    ])
    // Every one has both languages and a stated backend status.
    for (const s of ADMIN_SECTIONS) {
      expect(s.label.ar.length).toBeGreaterThan(0)
      expect(s.note.en.length).toBeGreaterThan(0)
      expect(s.note.ar.length).toBeGreaterThan(0)
    }
  })

  it('shows every section in the navigation, marking the unbuilt ones', async () => {
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/teams' })
    const nav = await screen.findByRole('navigation')
    const links = within(nav).getAllByRole('link')
    expect(links).toHaveLength(17)
    const inDevelopment = ADMIN_SECTIONS.filter((s) => s.status === 'in_development').length
    expect(within(nav).getAllByText('In development')).toHaveLength(inDevelopment)
  })

  it('an unbuilt section is an explicit placeholder that requests no data', async () => {
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/whatsapp' })
    expect(await screen.findByTestId('development-placeholder')).toHaveTextContent(
      'This section is in development.',
    )
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/admin/'))).toBe(false)
  })

  it('a built section reads the real /admin endpoint with the bearer token', async () => {
    // A Response body can be read once: build one per call.
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        truncated: false,
        users: [
          {
            principalKind: 'staff',
            id: 'owner_o',
            displayName: 'Owner O',
            staffRole: 'super_admin',
            familyId: null,
            isActive: true,
            hasLogin: true,
            accountStatus: 'active',
            lastLoginAt: null,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/users' })
    expect(await screen.findByRole('cell', { name: 'Owner O' })).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/admin/users'))!
    expect(call[1].headers['Authorization']).toBe('Bearer access-1')
  })

  // Regression: Sign out used to revoke the session and clear the tokens while
  // the signed-in shell stayed on screen.
  it('Sign out ends the server session, forgets the tokens, and shows the login form', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/teams' })
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/logout'))).toBe(true)
    expect(tokenStore.hasSession()).toBe(false)
  })

  // The portal's Stories section is GET /admin/stories (super_admin, read-only).
  // The legacy /stories screen is the publisher's, and the server refuses it to
  // super_admin by design -- the link must say so rather than imply it works.
  it('Stories reads /admin/stories and marks the publisher screen unsupported', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        truncated: false,
        stories: [
          {
            id: 's1', title: 'Story one', state: 'draft', creatorName: 'admin_a', recipients: 0,
            views: 0, createdAt: new Date().toISOString(), publishedAt: null, expiresAt: null, deletedAt: null,
          },
        ],
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories' })
    expect(await screen.findByRole('cell', { name: 'Story one' })).toBeInTheDocument()
    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.some((u) => u.endsWith('/admin/stories'))).toBe(true)
    expect(urls.some((u) => /\/stories(\?|$)/.test(u.replace('/admin/stories', '')))).toBe(false)
    expect(screen.getByText(/Unsupported for super_admin by design/)).toBeInTheDocument()
  })

  it('lands the super admin on the dashboard', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}, 404))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/' })
    expect(await screen.findByRole('heading', { name: /Dashboard/ })).toBeInTheDocument()
  })
})

describe('Admin Portal for anyone else', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    tokenStore.clear()
  })

  it('a manager reaching /admin/* gets the forbidden page, not the section', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 404)))
    renderWithProviders(<AppRoutes />, {
      staff: makeStaff({ role: 'manager' }),
      route: '/admin/users',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission")
    expect(screen.queryByText('In development')).not.toBeInTheDocument()
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

    await expect(sessionApi.login('parent@qa.jawwid.test', 'pw')).rejects.toMatchObject({
      code: NOT_STAFF_CODE,
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/logout'))).toBe(true)
    await waitFor(() => expect(tokenStore.hasSession()).toBe(false))
  })
})
