import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { AccessRole, PermissionEntry, StaffAccount } from './api'

/**
 * PD-40 PR-5: the Roles page. The super admin defines, edits and archives
 * roles from a checklist grouped by page; keys that never go in a role are not
 * offered; a template is badged only while the server says so; a refused edit
 * names the grants that block it. Only the server decides (plan §15, H7/S4).
 * Synthetic people only.
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
  { key: 'chat.use', page: 'chat', action: 'use', label: { en: 'Use chats', ar: 'استخدام المحادثات' }, risk: 'family_contact', delegable: false, inRoles: true },
  { key: 'stories.view', page: 'stories', action: 'view', label: { en: 'View stories', ar: 'عرض الحالات' }, risk: 'none', delegable: false, inRoles: true },
  { key: 'staff_accounts.view', page: 'staff_accounts', action: 'view', label: { en: 'View staff accounts', ar: 'عرض حسابات الموظفين' }, risk: 'admin', delegable: false, inRoles: false },
  { key: 'admin.inspect', page: 'admin', action: 'inspect', label: { en: 'Inspect the organization', ar: 'فحص المؤسسة' }, risk: 'admin', delegable: false, inRoles: false },
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
  role({ id: 'r-2', key: 'billing_reader', nameEn: 'Billing reader', nameAr: 'قارئ الفواتير', permissions: ['billing.view'], template: false }),
]

const staffAccount = (over: Partial<StaffAccount>): StaffAccount => ({
  staffId: 'st-1',
  accountId: 'ac-1',
  name: 'Specialist One',
  tier: 'specialist',
  status: 'active',
  departmentId: 'd-t',
  roles: [],
  lastLoginAt: null,
  setupPending: false,
  ...over,
})

const superAdmin = makeStaff({ id: 'sa-1', name: 'Owner One', role: 'super_admin' })
const manager = makeStaff({
  id: 'm-1',
  name: 'Manager One',
  role: 'manager',
  permissions: ['certificates.design', 'certificates.view', 'staff_accounts.create', 'staff_accounts.manage', 'staff_accounts.view'],
})

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
  on('GET', /\/admin\/staff-accounts$/, () =>
    json({
      accounts: [
        staffAccount({ roles: [{ id: 'r-1', key: 'designer', nameEn: 'Designer', nameAr: 'مصمم' }] }),
        staffAccount({ staffId: 'st-2', accountId: 'ac-2', name: 'Specialist Two', roles: [{ id: 'r-1', key: 'designer', nameEn: 'Designer', nameAr: 'مصمم' }] }),
        staffAccount({ staffId: 'm-1', accountId: 'ac-3', name: 'Manager One', tier: 'manager', departmentId: null }),
      ],
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const rowOf = async (name: string) => (await screen.findByText(name, { selector: 'strong' })).closest('tr')!

describe('PD-40: the Roles page', () => {
  it('lists the roles with member counts, and badges a template only while the server says it is one', async () => {
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/accounts/roles' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Roles' })).toBeInTheDocument()
    const designer = await rowOf('Designer')
    expect(within(designer).getByText('Template')).toBeInTheDocument()
    await waitFor(() => expect(within(designer).getByText('2')).toBeInTheDocument())
    const billing = await rowOf('Billing reader')
    expect(within(billing).queryByText('Template')).not.toBeInTheDocument()
  })

  it('an edited template that the server no longer marks is not called a template', async () => {
    on('GET', /\/admin\/access-roles$/, () => json({ roles: [role({ template: false, nameEn: 'Designer (edited)' })] }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/accounts/roles' })
    const row = await rowOf('Designer (edited)')
    expect(within(row).queryByText('Template')).not.toBeInTheDocument()
  })

  it('the editor groups the checklist by page and leaves out keys that never go in a role', async () => {
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/accounts/roles' })
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }))
    const dialog = screen.getByRole('dialog', { name: 'New role' })
    const certificates = await within(dialog).findByRole('group', { name: 'Certificates' })
    expect(within(certificates).getByRole('checkbox', { name: /View certificates/ })).toBeInTheDocument()
    expect(within(certificates).getByRole('checkbox', { name: /Design certificates/ })).toBeInTheDocument()
    expect(within(certificates).queryByRole('checkbox', { name: /View instalments/ })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Instalments and payments' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: /View staff accounts/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: /Inspect the organization/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('group', { name: /Staff accounts/ })).not.toBeInTheDocument()
  })

  it('marks personal-data, money and family-contact keys with a risk badge', async () => {
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/accounts/roles' })
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }))
    const dialog = screen.getByRole('dialog', { name: 'New role' })
    const label = (name: RegExp) => within(dialog).getByRole('checkbox', { name }).closest('label')!
    await within(dialog).findByRole('group', { name: 'Certificates' })
    expect(within(label(/View certificates/)).getByText('Personal data')).toBeInTheDocument()
    expect(within(label(/View instalments/)).getByText('Money')).toBeInTheDocument()
    expect(within(label(/Use chats/)).getByText('Family contact')).toBeInTheDocument()
    expect(within(label(/View stories/)).queryByText(/Personal data|Money|Family contact/)).not.toBeInTheDocument()
  })

  it('the super admin defines a role in one step', async () => {
    on('POST', /\/admin\/access-roles$/, () => json({ role: role({ id: 'r-9', key: 'reader', nameEn: 'Reader', nameAr: 'قارئ', template: false }) }, 201))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/accounts/roles' })
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }))
    const dialog = screen.getByRole('dialog', { name: 'New role' })
    await userEvent.type(within(dialog).getByLabelText('Key'), 'reader')
    await userEvent.type(within(dialog).getByLabelText('Name (Arabic)'), 'قارئ')
    await userEvent.type(within(dialog).getByLabelText('Name (English)'), 'Reader')
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /View certificates/ }))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /View stories/ }))
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'a read-only role')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save role' }))
    await waitFor(() => expect(calls('POST', /\/admin\/access-roles$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/admin\/access-roles$/)[0])).toEqual({
      key: 'reader',
      nameEn: 'Reader',
      nameAr: 'قارئ',
      maxTier: 'specialist',
      permissions: ['certificates.view', 'stories.view'],
      reason: 'a read-only role',
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New role' })).not.toBeInTheDocument())
  })

  it('an edit sends the new checklist; a conflict names the grants that block it, readably', async () => {
    on('POST', /\/admin\/access-roles\/r-1$/, () =>
      json(
        {
          error: {
            code: 'COMM.ACCESS_ROLE_CONFLICT',
            message: 'this edit gives keys their granting manager may not grant to: st-1 (granted by m-1), st-2 (granted by m-1); revoke those grants first (PD-40 H5)',
          },
        },
        409,
      ),
    )
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/accounts/roles' })
    const row = await rowOf('Designer')
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Designer' })
    expect(within(dialog).queryByLabelText('Key')).not.toBeInTheDocument()
    const view = await within(dialog).findByRole('checkbox', { name: /View certificates/ })
    expect(view).toBeChecked()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /View instalments/ }))
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'designers see instalments')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save role' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Revoke these grants first, then save again')
    expect(within(alert).getByText('Specialist One, granted by Manager One')).toBeInTheDocument()
    expect(within(alert).getByText('Specialist Two, granted by Manager One')).toBeInTheDocument()
    expect(bodyOf(calls('POST', /\/admin\/access-roles\/r-1$/)[0])).toEqual({
      nameEn: 'Designer',
      nameAr: 'مصمم',
      permissions: ['billing.view', 'certificates.design', 'certificates.view'],
      reason: 'designers see instalments',
    })
  })

  it('archives a role with a reason', async () => {
    on('POST', /\/admin\/access-roles\/r-2\/archive$/, () => json({ role: role({ id: 'r-2', archived: true }) }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/accounts/roles' })
    const row = await rowOf('Billing reader')
    await userEvent.click(within(row).getByRole('button', { name: 'Archive' }))
    const dialog = screen.getByRole('dialog', { name: 'Archive Billing reader' })
    await userEvent.type(within(dialog).getByRole('textbox'), 'no longer used')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(calls('POST', /archive$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /archive$/)[0])).toEqual({ reason: 'no longer used' })
  })

  it('a manager reads the list but cannot create, edit or archive', async () => {
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/accounts/roles' })
    const row = await rowOf('Designer')
    expect(within(row).getByText('You can grant this')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New role' })).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
  })
})
