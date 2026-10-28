import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { AccessRole, PermissionEntry, StaffAccount } from './api'

/**
 * PD-40 PR-5: the Staff accounts page, through the real route and the real API
 * client, with `fetch` answered at the network boundary. This proves the
 * page's side only: a manager's tier and department are fixed, the super admin
 * picks them, the role picker offers what the server says is grantable, the
 * first sign-in code is shown once, and a manager's reissue is e-mailed and
 * never shown. Who may do what is proven server-side
 * (apps/api pd040-staff-accounts specs). Synthetic people only.
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

const PERMISSIONS: PermissionEntry[] = [
  { key: 'certificates.view', page: 'certificates', action: 'view', label: { en: 'View certificates', ar: 'عرض الشهادات' }, risk: 'pii', delegable: true, inRoles: true },
  { key: 'certificates.design', page: 'certificates', action: 'design', label: { en: 'Design certificates', ar: 'تصميم الشهادات' }, risk: 'pii', delegable: true, inRoles: true },
  { key: 'billing.view', page: 'billing', action: 'view', label: { en: 'View instalments', ar: 'عرض الأقساط' }, risk: 'finance', delegable: true, inRoles: true },
  { key: 'stories.view', page: 'stories', action: 'view', label: { en: 'View stories', ar: 'عرض الحالات' }, risk: 'none', delegable: false, inRoles: true },
  { key: 'staff_accounts.view', page: 'staff_accounts', action: 'view', label: { en: 'View staff accounts', ar: 'عرض حسابات الموظفين' }, risk: 'admin', delegable: false, inRoles: false },
]

function role(over: Partial<AccessRole> = {}): AccessRole {
  return {
    id: 'r-1',
    key: 'designer',
    nameEn: 'Designer',
    nameAr: 'مصمم',
    description: null,
    maxTier: 'specialist',
    permissions: ['certificates.design', 'certificates.view'],
    archived: false,
    template: true,
    grantable: true,
    ...over,
  }
}

const ROLES: AccessRole[] = [
  role(),
  role({ id: 'r-2', key: 'billing_reader', nameEn: 'Billing reader', nameAr: 'قارئ الفواتير', permissions: ['billing.view'], template: false, grantable: false }),
  role({ id: 'r-3', key: 'old_role', nameEn: 'Old role', nameAr: 'دور قديم', permissions: ['certificates.view'], template: false, archived: true, grantable: false }),
]

function staffAccount(over: Partial<StaffAccount> = {}): StaffAccount {
  return {
    staffId: 'st-1',
    accountId: 'ac-1',
    name: 'Specialist One',
    tier: 'specialist',
    status: 'provisioned',
    departmentId: 'd-t',
    roles: [],
    lastLoginAt: null,
    setupPending: true,
    ...over,
  }
}

const person = (id: string, name: string, role = 'manager') => ({ id, name, role, isActive: true })
const DEPARTMENTS = [
  { id: 'd-o', kind: 'operations', displayName: 'Operations', manager: person('m-2', 'Manager Two'), members: [], backups: [] },
  { id: 'd-t', kind: 'teachers', displayName: 'Teachers', manager: person('m-1', 'Manager One'), members: [], backups: [] },
]

const manager = makeStaff({
  id: 'm-1',
  name: 'Manager One',
  role: 'manager',
  permissions: ['certificates.design', 'certificates.view', 'org.view', 'staff_accounts.create', 'staff_accounts.manage', 'staff_accounts.view'],
})
const superAdmin = makeStaff({ id: 'sa-1', name: 'Owner One', role: 'super_admin' })

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
  on('GET', /\/admin\/access-roles$/, () => json({ roles: ROLES }))
  on('GET', /\/admin\/permissions$/, () => json({ permissions: PERMISSIONS }))
  on('GET', /\/org\/structure$/, () => json({ departments: DEPARTMENTS }))
  on('GET', /\/admin\/staff-accounts$/, () => json({ accounts: [staffAccount()] }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const CREATE = /\/admin\/staff-accounts$/
const created = (firstLogin: { code?: string; expiresAt: string; emailed: boolean }) =>
  json({ account: staffAccount({ staffId: 'st-9', name: 'New Person' }), signIn: 'new.person@example.test', firstLogin }, 201)

async function identity(dialog: HTMLElement) {
  await userEvent.type(within(dialog).getByLabelText('Full name'), 'New Person')
  await userEvent.type(within(dialog).getByLabelText('Sign-in e-mail'), 'new.person@example.test')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
}

describe('PD-40: the Staff accounts page', () => {
  it('lists the accounts the server sends, under a tab of the Accounts page', async () => {
    on('GET', /\/admin\/staff-accounts$/, () =>
      json({ accounts: [staffAccount({ roles: [{ id: 'r-1', key: 'designer', nameEn: 'Designer', nameAr: 'مصمم' }] })] }),
    )
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/accounts/staff' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Staff accounts' })).toBeInTheDocument()
    const row = (await screen.findByRole('button', { name: 'Specialist One' })).closest('tr')!
    expect(within(row).getByText('Designer')).toBeInTheDocument()
    expect(within(row).getByText('Setup pending')).toBeInTheDocument()
    expect(within(row).getByText('Teachers')).toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'Account pages' })
    expect(within(tabs).getByRole('link', { name: 'Staff accounts' })).toHaveAttribute('href', '/accounts/staff')
    expect(within(tabs).getByRole('link', { name: 'Roles' })).toHaveAttribute('href', '/accounts/roles')
  })

  it("a manager creates a specialist in their own department: tier and department are fixed", async () => {
    on('POST', CREATE, () => created({ code: '482913', expiresAt: '2026-10-31T09:00:00Z', emailed: true }))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/accounts/staff' })
    await userEvent.click(await screen.findByRole('button', { name: 'New account' }))
    const dialog = screen.getByRole('dialog', { name: 'New staff account' })
    await identity(dialog)

    expect(within(dialog).getByText('Specialist')).toBeInTheDocument()
    expect(await within(dialog).findByText('Teachers')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Tier')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Department')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }))

    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Designer/ }))
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'a new designer')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }))

    await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(bodyOf(calls('POST', CREATE)[0])).toEqual({
      name: 'New Person',
      email: 'new.person@example.test',
      tier: 'specialist',
      departmentId: 'd-t',
      roleIds: ['r-1'],
      reason: 'a new designer',
    })
  })

  it('the super admin picks the tier, and a department only for a specialist', async () => {
    on('POST', CREATE, () => created({ code: '482913', expiresAt: '2026-10-31T09:00:00Z', emailed: true }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/accounts/staff' })
    await userEvent.click(await screen.findByRole('button', { name: 'New account' }))
    const dialog = screen.getByRole('dialog', { name: 'New staff account' })
    await identity(dialog)

    const tier = within(dialog).getByLabelText('Tier')
    expect(within(tier).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['specialist', 'admin', 'coverage', 'manager'])
    await userEvent.selectOptions(await within(dialog).findByLabelText('Department'), 'd-o')
    await userEvent.selectOptions(tier, 'manager')
    expect(within(dialog).queryByLabelText('Department')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'runs a department')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }))

    await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(bodyOf(calls('POST', CREATE)[0])).toEqual({
      name: 'New Person',
      email: 'new.person@example.test',
      tier: 'manager',
      roleIds: [],
      reason: 'runs a department',
    })
  })

  it('the super admin places a specialist in the department they choose', async () => {
    on('POST', CREATE, () => created({ code: '482913', expiresAt: '2026-10-31T09:00:00Z', emailed: true }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/accounts/staff' })
    await userEvent.click(await screen.findByRole('button', { name: 'New account' }))
    const dialog = screen.getByRole('dialog', { name: 'New staff account' })
    await identity(dialog)
    await userEvent.selectOptions(await within(dialog).findByLabelText('Department'), 'd-o')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'operations help')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }))
    await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(bodyOf(calls('POST', CREATE)[0])).toMatchObject({ tier: 'specialist', departmentId: 'd-o' })
  })

  it('the role picker offers only grantable roles, and previews what the account will open', async () => {
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/accounts/staff' })
    await userEvent.click(await screen.findByRole('button', { name: 'New account' }))
    const dialog = screen.getByRole('dialog', { name: 'New staff account' })
    await identity(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }))

    const designer = await within(dialog).findByRole('checkbox', { name: /Designer/ })
    expect(within(dialog).queryByRole('checkbox', { name: /Billing reader/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: /Old role/ })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/opens nothing yet/)).toBeInTheDocument()

    await userEvent.click(designer)
    const preview = within(dialog).getByRole('region', { name: 'This account will open' })
    expect(within(preview).getByText('Certificates')).toBeInTheDocument()
    expect(within(preview).getByText('View certificates')).toBeInTheDocument()
    expect(within(preview).getByText('Design certificates')).toBeInTheDocument()
    expect(within(preview).getAllByText('Personal data')).toHaveLength(2)
  })

  it('shows the first sign-in code once, with whether it was e-mailed, and forgets it on close', async () => {
    on('POST', CREATE, () => created({ code: '482913', expiresAt: '2026-10-31T09:00:00Z', emailed: false }))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/accounts/staff' })
    await userEvent.click(await screen.findByRole('button', { name: 'New account' }))
    const dialog = screen.getByRole('dialog', { name: 'New staff account' })
    await identity(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    await userEvent.type(await within(dialog).findByLabelText('Reason'), 'a new colleague')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }))

    const sheet = await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(within(sheet).getByText('482913')).toBeInTheDocument()
    expect(within(sheet).getByText('new.person@example.test')).toBeInTheDocument()
    expect(within(sheet).getByText(/was not e-mailed/)).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('482913')).not.toBeInTheDocument()
    expect(calls('POST', CREATE)).toHaveLength(1)
  })

  it('says the code was e-mailed to the sign-in address when it was', async () => {
    on('POST', CREATE, () => created({ code: '482913', expiresAt: '2026-10-31T09:00:00Z', emailed: true }))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/accounts/staff' })
    await userEvent.click(await screen.findByRole('button', { name: 'New account' }))
    const dialog = screen.getByRole('dialog', { name: 'New staff account' })
    await identity(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    await userEvent.type(await within(dialog).findByLabelText('Reason'), 'a new colleague')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }))
    const sheet = await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(within(sheet).getByText(/also e-mailed to new\.person@example\.test/)).toBeInTheDocument()
  })

  it("a manager's reissue is e-mailed and never shown", async () => {
    on('GET', /\/admin\/staff-accounts\/st-1$/, () => json(staffAccount()))
    on('POST', /\/admin\/staff-accounts\/st-1\/setup-code$/, () => json({ firstLogin: { expiresAt: '2026-10-31T09:00:00Z', emailed: true } }, 201))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/accounts/staff' })
    await userEvent.click(await screen.findByRole('button', { name: 'Specialist One' }))
    const detail = await screen.findByRole('dialog', { name: 'Specialist One' })
    await userEvent.click(await within(detail).findByRole('button', { name: 'Send a new first sign-in code' }))
    const reason = screen.getByRole('dialog', { name: 'New first sign-in code for Specialist One' })
    await userEvent.type(within(reason).getByRole('textbox'), 'lost the e-mail')
    await userEvent.click(within(reason).getByRole('button', { name: 'Send code' }))

    const sheet = await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(within(sheet).getByText("A new code was sent by e-mail to the account's sign-in address.")).toBeInTheDocument()
    expect(within(sheet).queryByText(/^[0-9]{6}$/)).not.toBeInTheDocument()
    expect(within(sheet).queryByText('Code')).not.toBeInTheDocument()
    expect(bodyOf(calls('POST', /setup-code$/)[0])).toEqual({ reason: 'lost the e-mail' })
  })

  it('a reissue that could not be e-mailed says so, and a refusal is said plainly', async () => {
    on('GET', /\/admin\/staff-accounts\/st-1$/, () => json(staffAccount()))
    on('POST', /\/admin\/staff-accounts\/st-1\/setup-code$/, () => json({ firstLogin: { expiresAt: '2026-10-31T09:00:00Z', emailed: false } }, 201))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/accounts/staff' })
    await userEvent.click(await screen.findByRole('button', { name: 'Specialist One' }))
    const detail = await screen.findByRole('dialog', { name: 'Specialist One' })
    await userEvent.click(await within(detail).findByRole('button', { name: 'Send a new first sign-in code' }))
    let reason = screen.getByRole('dialog', { name: 'New first sign-in code for Specialist One' })
    await userEvent.type(within(reason).getByRole('textbox'), 'lost the e-mail')
    await userEvent.click(within(reason).getByRole('button', { name: 'Send code' }))
    const sheet = await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(within(sheet).getByText(/could not be e-mailed/)).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }))

    on('POST', /\/admin\/staff-accounts\/st-1\/setup-code$/, () =>
      json({ error: { code: 'COMM.ACCOUNT_ADMIN_STATE', message: 'the e-mail channel is off, so only the super admin can issue a new code' } }, 409),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Specialist One' }))
    await userEvent.click(await within(await screen.findByRole('dialog', { name: 'Specialist One' })).findByRole('button', { name: 'Send a new first sign-in code' }))
    reason = screen.getByRole('dialog', { name: 'New first sign-in code for Specialist One' })
    await userEvent.type(within(reason).getByRole('textbox'), 'again')
    await userEvent.click(within(reason).getByRole('button', { name: 'Send code' }))
    expect(await within(reason).findByRole('alert')).toHaveTextContent(/only the super admin can issue/)
  })

  it('grants only a grantable role the account does not hold, with a reason', async () => {
    on('GET', /\/admin\/staff-accounts\/st-1$/, () => json(staffAccount({ status: 'active', setupPending: false })))
    on('POST', /\/admin\/staff-accounts\/st-1\/roles$/, () =>
      json(staffAccount({ status: 'active', setupPending: false, roles: [{ id: 'r-1', key: 'designer', nameEn: 'Designer', nameAr: 'مصمم' }] })),
    )
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/accounts/staff' })
    await userEvent.click(await screen.findByRole('button', { name: 'Specialist One' }))
    const detail = await screen.findByRole('dialog', { name: 'Specialist One' })
    const picker = await within(detail).findByLabelText('Add a role')
    await waitFor(() => expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a role', 'Designer']))
    await userEvent.selectOptions(picker, 'r-1')
    await userEvent.click(within(detail).getByRole('button', { name: 'Grant' }))
    const reason = screen.getByRole('dialog', { name: 'Grant Designer to Specialist One' })
    await userEvent.type(within(reason).getByRole('textbox'), 'designs the certificates')
    await userEvent.click(within(reason).getByRole('button', { name: 'Grant' }))
    await waitFor(() => expect(calls('POST', /\/roles$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/roles$/)[0])).toEqual({ roleId: 'r-1', reason: 'designs the certificates' })
  })

  it('revokes a role with a reason', async () => {
    const held = staffAccount({ status: 'active', setupPending: false, roles: [{ id: 'r-1', key: 'designer', nameEn: 'Designer', nameAr: 'مصمم' }] })
    on('GET', /\/admin\/staff-accounts\/st-1$/, () => json(held))
    on('POST', /\/admin\/staff-accounts\/st-1\/roles\/r-1\/revoke$/, () => json({ ...held, roles: [] }))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/accounts/staff' })
    await userEvent.click(await screen.findByRole('button', { name: 'Specialist One' }))
    const detail = await screen.findByRole('dialog', { name: 'Specialist One' })
    await userEvent.click(await within(detail).findByRole('button', { name: 'Remove Designer' }))
    const reason = screen.getByRole('dialog', { name: 'Remove Designer from Specialist One' })
    await userEvent.type(within(reason).getByRole('textbox'), 'moved on')
    await userEvent.click(within(reason).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(calls('POST', /revoke$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /revoke$/)[0])).toEqual({ reason: 'moved on' })
  })

  it("offers the account's status actions as the server allows them (PD-21 routes)", async () => {
    on('GET', /\/admin\/staff-accounts\/st-1$/, () => json(staffAccount({ status: 'active', setupPending: false })))
    on('GET', /\/admin\/accounts\/ac-1$/, () =>
      json({
        accountId: 'ac-1',
        kind: 'staff',
        name: 'Specialist One',
        staffRole: 'specialist',
        familyName: null,
        children: [],
        status: 'active',
        hasLogin: true,
        lockedUntil: null,
        lastLoginAt: null,
        allowed: { resetPassword: true, suspend: true, reactivate: false, impersonate: false, signOut: true },
      }),
    )
    on('POST', /\/admin\/accounts\/ac-1\/password-reset$/, () =>
      json({ emailed: true, expiresAt: '2026-10-28T10:10:00.000Z', expiresInMinutes: 10, signedOutSessions: 0 }, 201),
    )
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/accounts/staff' })
    await userEvent.click(await screen.findByRole('button', { name: 'Specialist One' }))
    const detail = await screen.findByRole('dialog', { name: 'Specialist One' })
    expect(await within(detail).findByRole('button', { name: 'Set inactive' })).toBeInTheDocument()
    expect(within(detail).getByRole('button', { name: 'Devices' })).toBeInTheDocument()
    expect(within(detail).queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument()
    expect(within(detail).queryByRole('button', { name: /Open as/ })).not.toBeInTheDocument()

    await userEvent.click(within(detail).getByRole('button', { name: 'Reset password' }))
    const reset = screen.getByRole('dialog', { name: 'Reset the password of Specialist One' })
    await userEvent.type(within(reset).getByRole('textbox'), 'forgot it')
    await userEvent.click(within(reset).getByRole('button', { name: 'Get the code' }))
    const sent = await screen.findByRole('dialog', { name: 'One-time code for Specialist One' })
    expect(within(sent).getByText(/sent by e-mail to the account's sign-in address/)).toBeInTheDocument()
  })
})

describe('PD-40: who is offered the Staff accounts page', () => {
  it('is hidden, and refused, without staff_accounts.view', async () => {
    const plainManager = makeStaff({ id: 'm-3', name: 'Manager Three', role: 'manager', permissions: ['org.view'] })
    on('GET', /\/admin\/accounts(\?|$)/, () => json({ accounts: [], truncated: false }))
    const { unmount } = renderWithProviders(<AppRoutes />, { staff: plainManager, route: '/accounts' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Account pages' })).not.toBeInTheDocument()
    unmount()

    renderWithProviders(<AppRoutes />, { staff: plainManager, route: '/accounts/staff' })
    expect(await screen.findByText("You don't have permission to access this.")).toBeInTheDocument()
    expect(calls('GET', /\/admin\/staff-accounts/)).toHaveLength(0)
  })

  it('a department role without the keys sees no tabs and cannot open Roles', async () => {
    const finance = makeStaff({ id: 's-9', name: 'Finance One', role: 'finance', permissions: [] })
    renderWithProviders(<AppRoutes />, { staff: finance, route: '/accounts/roles' })
    expect(await screen.findByText("You don't have permission to access this.")).toBeInTheDocument()
    expect(calls('GET', /\/admin\/access-roles/)).toHaveLength(0)
  })

  it('no New account button without staff_accounts.create', async () => {
    const viewer = makeStaff({ id: 'm-4', name: 'Manager Four', role: 'manager', permissions: ['staff_accounts.view'] })
    renderWithProviders(<AppRoutes />, { staff: viewer, route: '/accounts/staff' })
    expect(await screen.findByRole('button', { name: 'Specialist One' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New account' })).not.toBeInTheDocument()
  })
})
