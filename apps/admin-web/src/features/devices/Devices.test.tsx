import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { LoginPage } from '@/features/auth/LoginPage'
import { DEVICE_REFRESH_KEY, TAB_REFRESH_KEY, tokenStore } from '@/core/auth/tokens'
import { installFakeLocks, removeFakeLocks } from '@/test/locks'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { AccountSummary } from '@/features/accounts/api'
import type { SessionDto } from './api'

/**
 * PD-23 through the real routes and the real API client, `fetch` answered at
 * the network boundary: the "Keep me signed in" tick, My devices, and the
 * Accounts page's Active devices.
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

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const realUA = navigator.userAgent

function session(over: Partial<SessionDto> = {}): SessionDto {
  return {
    id: 'sess-1',
    current: false,
    platform: 'web',
    deviceName: 'Chrome on macOS',
    appVersion: null,
    signedInAt: '2026-10-20T08:00:00.000Z',
    lastSeenAt: '2026-10-22T08:00:00.000Z',
    expiresAt: '2026-10-29T08:00:00.000Z',
    remembered: false,
    ...over,
  }
}

function loginAnswer(remembered: boolean | undefined) {
  return json({
    tokenType: 'Bearer',
    accessToken: 'access-new',
    expiresIn: 900,
    refreshToken: 'refresh-new',
    actor: {
      actorId: 's-1',
      kind: 'staff',
      displayName: 'Staff One',
      locale: 'en',
      isActive: true,
      staffRole: 'admin',
      organizationId: 'o-1',
    },
    ...(remembered === undefined
      ? {}
      : {
          session: {
            id: 'sess-new',
            createdAt: '2026-10-22T08:00:00.000Z',
            remembered,
            expiresAt: '2026-10-29T08:00:00.000Z',
            absoluteExpiresAt: remembered ? '2026-11-21T08:00:00.000Z' : null,
          },
        }),
  })
}

const admin = makeStaff({ id: 's-1', name: 'Staff One', role: 'admin' })

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
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
  removeFakeLocks()
  Object.defineProperty(navigator, 'userAgent', { value: realUA, configurable: true })
  localStorage.clear()
  sessionStorage.clear()
})

describe('PD-23: "Keep me signed in on this device"', () => {
  it('is not offered where the browser cannot serialize refreshes across tabs (no Web Locks)', async () => {
    renderWithProviders(<LoginPage />)
    await screen.findByRole('button', { name: 'Sign in' })
    expect(screen.queryByRole('checkbox', { name: 'Keep me signed in on this device' })).not.toBeInTheDocument()
  })

  it('is offered unticked, in Arabic too', async () => {
    installFakeLocks()
    renderWithProviders(<LoginPage />, { locale: 'ar' })
    expect(await screen.findByRole('checkbox', { name: 'إبقائي مسجلاً على هذا الجهاز' })).not.toBeChecked()
  })

  it('sends remember and this browser as the device; a remembered answer keeps the token in localStorage', async () => {
    installFakeLocks()
    Object.defineProperty(navigator, 'userAgent', { value: CHROME_MAC, configurable: true })
    on('POST', /\/auth\/login$/, () => loginAnswer(true))
    renderWithProviders(<LoginPage />)
    await userEvent.type(await screen.findByLabelText('Email'), 'staff.one@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'synthetic-pass')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Keep me signed in on this device' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(localStorage.getItem(DEVICE_REFRESH_KEY)).toBe('refresh-new'))
    const body = bodyOf(calls('POST', /\/auth\/login$/)[0])
    expect(body.remember).toBe(true)
    expect(body.device).toEqual({ platform: 'web', name: 'Chrome on macOS' })
    expect(sessionStorage.getItem(TAB_REFRESH_KEY)).toBeNull()
  })

  it('follows the server when it does not remember (the super admin): per-tab storage', async () => {
    installFakeLocks()
    on('POST', /\/auth\/login$/, () => loginAnswer(false))
    renderWithProviders(<LoginPage />)
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'synthetic-pass')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Keep me signed in on this device' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(sessionStorage.getItem(TAB_REFRESH_KEY)).toBe('refresh-new'))
    expect(bodyOf(calls('POST', /\/auth\/login$/)[0]).remember).toBe(true)
    expect(localStorage.getItem(DEVICE_REFRESH_KEY)).toBeNull()
  })

  it('treats an older API answer without `remembered` as not remembered, and sends remember:false when unticked', async () => {
    installFakeLocks()
    on('POST', /\/auth\/login$/, () => loginAnswer(undefined))
    renderWithProviders(<LoginPage />)
    await userEvent.type(await screen.findByLabelText('Email'), 'staff.one@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'synthetic-pass')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(sessionStorage.getItem(TAB_REFRESH_KEY)).toBe('refresh-new'))
    expect(bodyOf(calls('POST', /\/auth\/login$/)[0]).remember).toBe(false)
    expect(localStorage.getItem(DEVICE_REFRESH_KEY)).toBeNull()
  })

  it('signs this tab out when another tab of the browser signs out', async () => {
    installFakeLocks()
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' }, { remembered: true })
    on('GET', /\/me\/sessions$/, () => json({ sessions: [session({ current: true })] }))
    renderWithProviders(<AppRoutes />, { staff: admin, route: '/profile/devices' })
    expect(await screen.findByRole('heading', { level: 1, name: 'My devices & sessions' })).toBeInTheDocument()

    localStorage.removeItem(DEVICE_REFRESH_KEY)
    window.dispatchEvent(new StorageEvent('storage', { key: DEVICE_REFRESH_KEY, newValue: null }))

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(tokenStore.access()).toBeNull()
    // Nothing sent: the other tab already ended the session on the server.
    expect(calls('POST', /\/auth\/(logout|refresh)$/)).toHaveLength(0)
  })
})

describe('PD-23: My devices & sessions', () => {
  beforeEach(() => {
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  })

  it('lists my sessions as the server orders them, this browser first', async () => {
    on('GET', /\/me\/sessions$/, () =>
      json({
        sessions: [
          session({ id: 'cur', current: true, remembered: true }),
          session({ id: 'ios', platform: 'ios', deviceName: 'iPhone 15', appVersion: '2.4.0', lastSeenAt: null }),
        ],
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: admin, route: '/profile/devices' })
    expect(await screen.findByText('This browser')).toBeInTheDocument()
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Chrome on macOS')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Kept signed in')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('iPhone 15')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('App 2.4.0')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('iPhone / iPad app')).toBeInTheDocument()
    expect(within(rows[1]!).queryByText('Kept signed in')).not.toBeInTheDocument()
  })

  it('signs out all other devices after a confirmation', async () => {
    on('GET', /\/me\/sessions$/, () =>
      json({ sessions: [session({ id: 'cur', current: true }), session({ id: 'other', deviceName: 'Firefox on Windows' })] }),
    )
    on('POST', /\/me\/sessions\/revoke-others$/, () => json({ revoked: 1 }))
    renderWithProviders(<AppRoutes />, { staff: admin, route: '/profile/devices' })
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out all other devices' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign out all other devices?' })
    expect(calls('POST', /revoke-others$/)).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out all other devices' }))
    expect(await screen.findByText('Signed out of 1 other session(s).')).toBeInTheDocument()
    expect(calls('POST', /\/me\/sessions\/revoke-others$/)).toHaveLength(1)
  })

  it('signing out THIS browser ends the session here without another request', async () => {
    on('GET', /\/me\/sessions$/, () => json({ sessions: [session({ id: 'cur', current: true })] }))
    on('POST', /\/me\/sessions\/cur\/revoke$/, () => json({ ok: true }))
    renderWithProviders(<AppRoutes />, { staff: admin, route: '/profile/devices' })
    const row = (await screen.findByText('This browser')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Sign out' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign out of Chrome on macOS?' })
    expect(within(dialog).getByText(/the browser you are using now/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(tokenStore.hasSession()).toBe(false)
    expect(calls('POST', /\/me\/sessions\/cur\/revoke$/)).toHaveLength(1)
    // The server already ended it: no logout call, and above all no refresh
    // with a revoked token.
    expect(calls('POST', /\/auth\/(logout|refresh)$/)).toHaveLength(0)
  })

  it('says a session that already ended plainly, and refreshes the list', async () => {
    let listed = 0
    on('GET', /\/me\/sessions$/, () => {
      listed++
      return json({ sessions: [session({ id: 'cur', current: true }), session({ id: 'gone', deviceName: 'Old laptop' })] })
    })
    on('POST', /\/me\/sessions\/gone\/revoke$/, () =>
      json({ error: { code: 'COMM.SESSION_NOT_FOUND', message: 'session not found' } }, 404),
    )
    renderWithProviders(<AppRoutes />, { staff: admin, route: '/profile/devices' })
    const row = (await screen.findByText('Old laptop')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Sign out' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign out of Old laptop?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This session has already ended.')
    await waitFor(() => expect(listed).toBeGreaterThan(1))
    expect(tokenStore.hasSession()).toBe(true)
  })
})

function account(over: Partial<AccountSummary> = {}): AccountSummary {
  return {
    accountId: 'a-1',
    kind: 'family',
    name: 'Parent Alpha',
    staffRole: null,
    familyName: 'Family Alpha',
    children: [],
    status: 'active',
    hasLogin: true,
    lockedUntil: null,
    lastLoginAt: '2026-10-20T08:00:00.000Z',
    allowed: { resetPassword: true, suspend: true, reactivate: false, impersonate: false, signOut: true },
    ...over,
  }
}

describe('PD-23: an account\'s active devices on the Accounts page', () => {
  beforeEach(() => {
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  })

  it('is offered only where the server allows signing the account out', async () => {
    on('GET', /\/admin\/accounts(\?|$)/, () =>
      json({
        accounts: [
          account(),
          account({ accountId: 'a-2', name: 'Teacher Omega', kind: 'teacher', familyName: null, allowed: { resetPassword: false, suspend: false, reactivate: false, impersonate: false, signOut: false } }),
        ],
        truncated: false,
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: admin, route: '/accounts' })
    await screen.findByText('Teacher Omega')
    expect(screen.getAllByRole('button', { name: 'Devices' })).toHaveLength(1)
    const alphaRow = screen.getByText('Parent Alpha').closest('tr')!
    expect(within(alphaRow).getByRole('button', { name: 'Devices' })).toBeInTheDocument()
  })

  it('signs one device out with a reason, then all of them', async () => {
    on('GET', /\/admin\/accounts(\?|$)/, () => json({ accounts: [account()], truncated: false }))
    on('GET', /\/admin\/accounts\/a-1\/sessions$/, () =>
      json({
        sessions: [
          session({ id: 'p-ios', platform: 'ios', deviceName: 'iPhone 14', remembered: true }),
          session({ id: 'p-and', platform: 'android', deviceName: 'Pixel 8' }),
        ],
      }),
    )
    on('POST', /\/admin\/accounts\/a-1\/sessions\/p-ios\/revoke$/, () => json({ ok: true }))
    on('POST', /\/admin\/accounts\/a-1\/sessions\/revoke-all$/, () => json({ revoked: 2 }))
    renderWithProviders(<AppRoutes />, { staff: admin, route: '/accounts' })

    await userEvent.click(await screen.findByRole('button', { name: 'Devices' }))
    let sheet = screen.getByRole('dialog', { name: 'Active devices of Parent Alpha' })
    const iosRow = (await within(sheet).findByText('iPhone 14')).closest('tr')!
    expect(within(sheet).queryByText('This browser')).not.toBeInTheDocument()
    await userEvent.click(within(iosRow).getByRole('button', { name: 'Sign out' }))

    let reason = screen.getByRole('dialog', { name: 'Sign Parent Alpha out of iPhone 14' })
    expect(within(reason).getByRole('button', { name: 'Sign out' })).toBeDisabled()
    await userEvent.type(within(reason).getByRole('textbox'), 'lost phone')
    await userEvent.click(within(reason).getByRole('button', { name: 'Sign out' }))
    sheet = await screen.findByRole('dialog', { name: 'Active devices of Parent Alpha' })
    expect(bodyOf(calls('POST', /\/sessions\/p-ios\/revoke$/)[0])).toEqual({ reason: 'lost phone' })

    await userEvent.click(within(sheet).getByRole('button', { name: 'Sign out of all devices' }))
    reason = screen.getByRole('dialog', { name: 'Sign Parent Alpha out of all devices' })
    await userEvent.type(within(reason).getByRole('textbox'), 'account shared')
    await userEvent.click(within(reason).getByRole('button', { name: 'Sign out of all devices' }))
    sheet = await screen.findByRole('dialog', { name: 'Active devices of Parent Alpha' })
    expect(within(sheet).getByRole('status')).toHaveTextContent('Signed out of 2 session(s).')
    expect(bodyOf(calls('POST', /\/sessions\/revoke-all$/)[0])).toEqual({ reason: 'account shared' })
  })

  it('says a refusal in the Accounts page\'s own words, and an ended session as ended', async () => {
    on('GET', /\/admin\/accounts(\?|$)/, () => json({ accounts: [account()], truncated: false }))
    let listed = 0
    on('GET', /\/admin\/accounts\/a-1\/sessions$/, () => {
      listed++
      return json({ sessions: [session({ id: 'gone', deviceName: 'Old phone' })] })
    })
    on('POST', /\/admin\/accounts\/a-1\/sessions\/gone\/revoke$/, () =>
      json({ error: { code: 'COMM.SESSION_NOT_FOUND', message: 'session not found' } }, 404),
    )
    on('POST', /\/admin\/accounts\/a-1\/sessions\/revoke-all$/, () =>
      json({ error: { code: 'COMM.ACCOUNT_ADMIN_DENIED', message: 'no' } }, 403),
    )
    renderWithProviders(<AppRoutes />, { staff: admin, route: '/accounts' })
    await userEvent.click(await screen.findByRole('button', { name: 'Devices' }))
    const sheet = screen.getByRole('dialog', { name: 'Active devices of Parent Alpha' })
    const row = (await within(sheet).findByText('Old phone')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Sign out' }))
    let reason = screen.getByRole('dialog', { name: 'Sign Parent Alpha out of Old phone' })
    await userEvent.type(within(reason).getByRole('textbox'), 'cleanup')
    await userEvent.click(within(reason).getByRole('button', { name: 'Sign out' }))
    expect(await within(reason).findByRole('alert')).toHaveTextContent('This session has already ended.')

    // Back on the list, it has been fetched again.
    await userEvent.click(within(reason).getByRole('button', { name: 'Cancel' }))
    const back = await screen.findByRole('dialog', { name: 'Active devices of Parent Alpha' })
    await waitFor(() => expect(listed).toBeGreaterThan(1))
    await userEvent.click(within(back).getByRole('button', { name: 'Sign out of all devices' }))
    reason = screen.getByRole('dialog', { name: 'Sign Parent Alpha out of all devices' })
    await userEvent.type(within(reason).getByRole('textbox'), 'cleanup')
    await userEvent.click(within(reason).getByRole('button', { name: 'Sign out of all devices' }))
    expect(await within(reason).findByRole('alert')).toHaveTextContent('You may not do this to this account.')
  })
})
