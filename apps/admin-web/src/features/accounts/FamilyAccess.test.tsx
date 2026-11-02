import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { chooseOption } from '@/test/select'
import type { AccountSummary } from './api'
import type { FamilyAccessGrant, FamilyAccessList } from './familyAccessApi'

/**
 * ADMIN-002 on the Accounts page, through the real route and API client with
 * `fetch` answered at the network boundary. The page offers a grant only when
 * the server says this caller may grant (`canGrant`), sends exactly the family,
 * the staff member, the purpose and the window, and revokes with a reason. Who
 * may grant, to whom, for how long -- and that expiry closes access -- is proven
 * server-side (apps/api admin-002-family-access.spec.ts).
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
let routes: Array<[RegExp, string, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
function on(method: string, pattern: RegExp, handler: Handler) {
  routes.unshift([pattern, method, handler])
}
const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
const bodyOf = (call: unknown[] | undefined) => {
  if (!call) throw new Error('the request was not sent')
  return JSON.parse(String((call[1] as RequestInit).body))
}

const parent: AccountSummary = {
  accountId: 'a-1',
  kind: 'family',
  name: 'Parent Alpha',
  staffRole: null,
  familyName: 'Family Alpha',
  familyId: 'f-1',
  children: ['Child One'],
  status: 'active',
  hasLogin: true,
  lockedUntil: null,
  lastLoginAt: null,
  allowed: { resetPassword: true, suspend: true, reactivate: false, impersonate: true, signOut: true },
}

function grant(over: Partial<FamilyAccessGrant> = {}): FamilyAccessGrant {
  return {
    id: 'g-1',
    family: { id: 'f-1', name: 'Family Alpha' },
    grantee: { id: 's-2', name: 'Supervisor Beta' },
    grantedBy: { id: 's-1', name: 'Operations Lead' },
    purpose: 'parent locked out while their supervisor is away',
    startsAt: '2026-10-31T10:00:00.000Z',
    endsAt: '2026-11-01T10:00:00.000Z',
    revokedAt: null,
    status: 'active',
    ...over,
  }
}

const staff = makeStaff({ id: 's-1', name: 'Operations Lead', role: 'manager' })

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [pattern, m, handler] of routes) {
      if (m === method && pattern.test(url)) return handler(url, init)
    }
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/admin\/accounts(\?|$)/, () => json({ accounts: [parent], truncated: false, administers: ['family'] }))
  on('GET', /\/admin\/impersonations(\?|$)/, () => json({ sessions: [] }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

function access(list: FamilyAccessList) {
  on('GET', /\/admin\/family-access-grants$/, () => json(list))
}

describe('ADMIN-002: exceptional access on the Accounts page', () => {
  it('a grantor opens one family to one Operations staff member, for a purpose and a window', async () => {
    access({ grants: [], canGrant: true, grantees: [{ id: 's-2', name: 'Supervisor Beta' }, { id: 's-3', name: 'Backup Gamma' }] })
    on('POST', /\/admin\/family-access-grants$/, () => json(grant(), 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/accounts' })

    await userEvent.click(await screen.findByRole('button', { name: 'Temporary access' }))
    const dialog = await screen.findByRole('dialog', { name: 'Temporary access to Family Alpha' })
    const confirm = within(dialog).getByRole('button', { name: 'Grant access' })
    expect(confirm).toBeDisabled()

    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Staff member' }), 's-2')
    expect(confirm).toBeDisabled() // a purpose is required too
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Purpose/ }), 'parent locked out')
    await userEvent.click(within(dialog).getByRole('button', { name: '3 days' }))
    await userEvent.click(confirm)

    await waitFor(() => expect(calls('POST', /\/admin\/family-access-grants$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/admin\/family-access-grants$/)[0])).toEqual({
      familyId: 'f-1',
      granteeId: 's-2',
      purpose: 'parent locked out',
      hours: 72,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('the record lists the grants; a live one is revoked with a reason, an ended one is not offered', async () => {
    access({
      grants: [grant(), grant({ id: 'g-2', status: 'ended', grantee: { id: 's-3', name: 'Backup Gamma' } })],
      canGrant: true,
      grantees: [],
    })
    on('POST', /\/admin\/family-access-grants\/g-1\/revoke$/, () => json(grant({ status: 'revoked', revokedAt: '2026-10-31T12:00:00.000Z' })))
    renderWithProviders(<AppRoutes />, { staff, route: '/accounts' })

    const record = (await screen.findByRole('heading', { name: 'Exceptional access' })).closest('section')!
    const rows = within(record).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Supervisor Beta')).toBeInTheDocument()
    expect(within(rows[1]!).queryByRole('button', { name: 'Revoke' })).toBeNull()

    await userEvent.click(within(rows[0]!).getByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByRole('dialog', { name: "End Supervisor Beta's access to Family Alpha" })
    await userEvent.type(within(dialog).getByRole('textbox'), 'resolved')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(calls('POST', /\/revoke$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/revoke$/)[0])).toEqual({ reason: 'resolved' })
  })

  it('anyone else is offered no grant; a grantee sees their own temporary access, and with none, nothing', async () => {
    access({ grants: [grant()], canGrant: false })
    const view = renderWithProviders(<AppRoutes />, { staff, route: '/accounts' })
    expect(await screen.findByRole('heading', { name: 'Your temporary access' })).toBeInTheDocument()
    expect(screen.getByText('parent locked out while their supervisor is away')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Temporary access' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
    view.unmount()

    access({ grants: [], canGrant: false })
    renderWithProviders(<AppRoutes />, { staff, route: '/accounts' })
    expect(await screen.findByText('Parent Alpha')).toBeInTheDocument()
    await waitFor(() => expect(calls('GET', /\/admin\/family-access-grants$/).length).toBeGreaterThanOrEqual(2))
    expect(screen.queryByRole('heading', { name: 'Your temporary access' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Exceptional access' })).toBeNull()
  })
})
