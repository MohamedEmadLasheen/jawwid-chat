import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { LoginPage } from '@/features/auth/LoginPage'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { AccountSummary } from './api'

/**
 * PD-21 account administration, through the real route and the real API
 * client, with `fetch` answered at the network boundary. This proves the
 * page's side: the server's list is shown with its own `allowed` answer, every
 * action sends a reason, the one-time code is shown once and is gone when the
 * dialog closes, and a refusal is said plainly. Who may do what to whom is
 * proven server-side (apps/api pd021-account-admin-http.spec.ts).
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

function account(over: Partial<AccountSummary> = {}): AccountSummary {
  return {
    accountId: 'a-1',
    kind: 'family',
    name: 'Parent Alpha',
    staffRole: null,
    familyName: 'Family Alpha',
    children: ['Child One', 'Child Two'],
    status: 'active',
    hasLogin: true,
    lockedUntil: null,
    lastLoginAt: '2026-10-20T08:00:00.000Z',
    allowed: { resetPassword: true, suspend: true, reactivate: false, impersonate: true },
    ...over,
  }
}

const finance = makeStaff({ id: 's-9', name: 'Finance One', role: 'finance' })

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
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('PD-21: the Accounts page', () => {
  it('is offered to a department role too, and lists what the server sends, children included', async () => {
    on('GET', /\/admin\/accounts(\?|$)/, () =>
      json({ accounts: [account(), account({ accountId: 'a-2', kind: 'teacher', name: 'Teacher Omega', familyName: null, children: [] })], truncated: false }),
    )
    renderWithProviders(<AppRoutes />, { staff: finance, route: '/accounts' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument()
    expect(await screen.findByText('Parent Alpha')).toBeInTheDocument()
    expect(screen.getByText(/Child One، Child Two/)).toBeInTheDocument()
    expect(screen.getByText('Teacher Omega')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Jawwid Operations' })
    expect(within(nav).getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/accounts')
  })

  it('searches by name on the server', async () => {
    on('GET', /\/admin\/accounts(\?|$)/, () => json({ accounts: [account()], truncated: false }))
    renderWithProviders(<AppRoutes />, { staff: finance, route: '/accounts' })
    await screen.findByText('Parent Alpha')
    await userEvent.type(screen.getByRole('searchbox'), 'Child One')
    await waitFor(() => expect(calls('GET', /q=Child(\+|%20)One/).length).toBeGreaterThan(0))
  })

  it('shows only the actions the server allows', async () => {
    on('GET', /\/admin\/accounts(\?|$)/, () =>
      json({ accounts: [account({ status: 'suspended', allowed: { resetPassword: true, suspend: false, reactivate: true, impersonate: false } })], truncated: false }),
    )
    renderWithProviders(<AppRoutes />, { staff: finance, route: '/accounts' })
    await screen.findByText('Parent Alpha')
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set inactive' })).not.toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('a reset sends the reason, shows the code once, and forgets it on close', async () => {
    on('GET', /\/admin\/accounts(\?|$)/, () => json({ accounts: [account()], truncated: false }))
    on('POST', /\/admin\/accounts\/a-1\/password-reset$/, () =>
      json({ code: '482913', expiresAt: '2026-10-22T10:10:00.000Z', expiresInMinutes: 10, signedOutSessions: 2 }, 201),
    )
    renderWithProviders(<AppRoutes />, { staff: finance, route: '/accounts' })
    await userEvent.click(await screen.findByRole('button', { name: 'Reset password' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset the password of Parent Alpha' })
    expect(within(dialog).getByRole('button', { name: 'Get the code' })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('checkbox'))
    await userEvent.type(within(dialog).getByRole('textbox'), 'parent forgot it')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Get the code' }))

    const code = await screen.findByRole('dialog', { name: 'One-time code for Parent Alpha' })
    expect(within(code).getByText('482913')).toBeInTheDocument()
    expect(within(code).getByText(/Signed out of 2 session/)).toBeInTheDocument()
    expect(bodyOf(calls('POST', /password-reset$/)[0])).toEqual({ reason: 'parent forgot it', signOutEverywhere: true })

    await userEvent.click(within(code).getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('482913')).not.toBeInTheDocument()
  })

  it('PD-40: a reset answered with no code says it was e-mailed, and shows no code box', async () => {
    const specialist = account({ accountId: 'a-7', kind: 'staff', name: 'Specialist One', staffRole: 'specialist', familyName: null, children: [] })
    on('GET', /\/admin\/accounts(\?|$)/, () => json({ accounts: [specialist], truncated: false }))
    on('POST', /\/admin\/accounts\/a-7\/password-reset$/, () =>
      json({ emailed: true, expiresAt: '2026-10-22T10:10:00.000Z', expiresInMinutes: 10, signedOutSessions: 0 }, 201),
    )
    const { container } = renderWithProviders(<AppRoutes />, { staff: finance, route: '/accounts' })
    await userEvent.click(await screen.findByRole('button', { name: 'Reset password' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset the password of Specialist One' })
    await userEvent.type(within(dialog).getByRole('textbox'), 'forgot it')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Get the code' }))

    const sent = await screen.findByRole('dialog', { name: 'One-time code for Specialist One' })
    expect(within(sent).getByText(/sent by e-mail to the account's sign-in address/)).toBeInTheDocument()
    expect(within(sent).queryByRole('button', { name: 'Copy code' })).not.toBeInTheDocument()
    expect(container.ownerDocument.querySelector('.acct-code')).toBeNull()
  })

  it('PD-40: a reset that could not be e-mailed says so', async () => {
    const specialist = account({ accountId: 'a-7', kind: 'staff', name: 'Specialist One', staffRole: 'specialist', familyName: null, children: [] })
    on('GET', /\/admin\/accounts(\?|$)/, () => json({ accounts: [specialist], truncated: false }))
    on('POST', /\/admin\/accounts\/a-7\/password-reset$/, () =>
      json({ emailed: false, expiresAt: '2026-10-22T10:10:00.000Z', expiresInMinutes: 10, signedOutSessions: 0 }, 201),
    )
    renderWithProviders(<AppRoutes />, { staff: finance, route: '/accounts', locale: 'ar' })
    await userEvent.click(await screen.findByRole('button', { name: 'إعادة تعيين كلمة المرور' }))
    const dialog = screen.getByRole('dialog', { name: 'إعادة تعيين كلمة مرور Specialist One' })
    await userEvent.type(within(dialog).getByRole('textbox'), 'forgot it')
    await userEvent.click(within(dialog).getByRole('button', { name: 'احصل على الرمز' }))
    const sent = await screen.findByRole('dialog', { name: 'رمز لمرة واحدة لـ Specialist One' })
    expect(within(sent).getByText(/تعذّر إرسال الرمز بالبريد/)).toBeInTheDocument()
    expect(within(sent).queryByRole('button', { name: 'نسخ الرمز' })).not.toBeInTheDocument()
  })

  it('suspending needs a reason and says a refusal plainly', async () => {
    on('GET', /\/admin\/accounts(\?|$)/, () => json({ accounts: [account()], truncated: false }))
    on('POST', /\/admin\/accounts\/a-1\/suspend$/, () =>
      json({ error: { code: 'COMM.ACCOUNT_ADMIN_DENIED', message: 'only the super admin administers a staff member\'s account' } }, 403),
    )
    renderWithProviders(<AppRoutes />, { staff: finance, route: '/accounts' })
    await userEvent.click(await screen.findByRole('button', { name: 'Set inactive' }))
    const dialog = screen.getByRole('dialog', { name: 'Set Parent Alpha inactive' })
    await userEvent.type(within(dialog).getByRole('textbox'), 'left the academy')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set inactive' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You may not do this to this account.')
    expect(bodyOf(calls('POST', /suspend$/)[0])).toEqual({ reason: 'left the academy' })
  })
})

describe('PD-40: the kinds each department administers', () => {
  const teachersSupervisor = makeStaff({ id: 's-3', name: 'Teachers Supervisor', role: 'admin' })

  it('offers only the kinds the server says this caller administers', async () => {
    on('GET', /\/admin\/accounts(\?|$)/, () =>
      json({ accounts: [account({ accountId: 'a-2', kind: 'teacher', name: 'Teacher Omega', familyName: null, children: [] })], truncated: false, administers: ['teacher'] }),
    )
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/accounts' })
    expect(await screen.findByText('Teacher Omega')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Teacher' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Parent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Staff' })).not.toBeInTheDocument()
  })

  it('says plainly when the caller\'s department administers no accounts', async () => {
    on('GET', /\/admin\/accounts(\?|$)/, () => json({ accounts: [], truncated: false, administers: [] }))
    renderWithProviders(<AppRoutes />, { staff: finance, route: '/accounts' })
    expect(await screen.findByText(/Your department does not administer accounts/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Teacher' })).not.toBeInTheDocument()
  })
})

describe('PD-21: finishing a reset on the sign-in page', () => {
  it('sends the login, the code and the new password -- and opens no session', async () => {
    tokenStore.clear()
    on('POST', /\/auth\/password-reset$/, () => json({ ok: true }))
    renderWithProviders(<LoginPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Forgot your password? I have a reset code' }))
    await userEvent.type(screen.getByLabelText('Email'), 'staff.one@example.test')
    await userEvent.type(screen.getByLabelText('One-time code'), '48a2913')
    await userEvent.type(screen.getByLabelText(/^New password/), 'my-own-password')
    await userEvent.type(screen.getByLabelText('Repeat the new password'), 'my-own-password')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Your password is set')
    expect(bodyOf(calls('POST', /\/auth\/password-reset$/)[0])).toEqual({
      username: 'staff.one@example.test',
      code: '482913',
      password: 'my-own-password',
    })
    expect(calls('POST', /\/auth\/login$/)).toHaveLength(0)
    expect(tokenStore.hasSession()).toBe(false)
  })

  it('refuses two different passwords before sending anything, and says a spent code plainly', async () => {
    tokenStore.clear()
    on('POST', /\/auth\/password-reset$/, () =>
      json({ error: { code: 'AUTH.RESET_CODE_INVALID', message: 'the code is not valid' } }, 401),
    )
    renderWithProviders(<LoginPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Forgot your password? I have a reset code' }))
    await userEvent.type(screen.getByLabelText('Email'), 'staff.one@example.test')
    await userEvent.type(screen.getByLabelText('One-time code'), '482913')
    await userEvent.type(screen.getByLabelText(/^New password/), 'my-own-password')
    await userEvent.type(screen.getByLabelText('Repeat the new password'), 'my-own-passwore')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The two passwords differ.')
    expect(calls('POST', /\/auth\/password-reset$/)).toHaveLength(0)

    await userEvent.clear(screen.getByLabelText('Repeat the new password'))
    await userEvent.type(screen.getByLabelText('Repeat the new password'), 'my-own-password')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(await screen.findByText(/already used\. Ask your administrator/)).toBeInTheDocument()
  })
})
