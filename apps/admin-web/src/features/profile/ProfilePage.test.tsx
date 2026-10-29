import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { OrganizationOverview, StaffProfile, StaffSummary, StaffWorkload, Team } from './api'
import { chooseOption } from '@/test/select'

/**
 * The staff profile page, through the real routes and the real API client,
 * with `fetch` answered at the network boundary.
 *
 * THE PAGE SHOWS WHAT THE SERVER SAYS IT MAY. These tests seed `access` and
 * `viewer` and assert the controls follow them -- including a super admin
 * session whose server answer says "no", which must win over the role. The
 * refusals themselves are proven server-side (apps/api
 * test/integration/staff-profiles.spec.ts); hiding a control is not security.
 */

vi.mock('./photo', async (importOriginal) => {
  const real = await importOriginal<typeof import('./photo')>()
  return {
    ...real,
    preparePhoto: vi.fn(async () => ({
      blob: new Blob(['webp-bytes'], { type: 'image/webp' }),
      previewUrl: 'blob:preview',
    })),
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function apiError(status: number, code: string, message = 'refused') {
  return json({ error: { code, message } }, status)
}

const ZERO: StaffWorkload = {
  assignedFamilies: 0,
  studentsInAssignedFamilies: 0,
  parentContacts: 0,
  teachersOfAssignedStudents: 0,
  openConversations: 0,
  awaitingReply: 0,
  pendingApprovals: 0,
  directReports: 0,
}

function profile(over: Partial<StaffProfile> = {}): StaffProfile {
  return {
    staffId: 'admin_a',
    displayName: 'Admin A',
    role: 'admin',
    isActive: true,
    leftAt: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: null,
    account: { hasLogin: true, status: 'active', lastLoginAt: null },
    signInIdentity: 'admin_a@example.test',
    jobTitle: null,
    about: null,
    avatarUrl: null,
    version: null,
    profileUpdatedAt: null,
    profileUpdatedBy: null,
    reportingManager: { staffId: 'manager_c', displayName: 'Manager C', role: 'manager', jobTitle: null, avatarUrl: null },
    responsibilities: [],
    derivedResponsibilities: [{ kind: 'family_supervision', count: 3 }],
    workload: { ...ZERO, assignedFamilies: 3, studentsInAssignedFamilies: 5, awaitingReply: 2 },
    completeness: { complete: 1, total: 5, missing: ['photo', 'job_title', 'about', 'responsibility'] },
    access: {
      relation: 'self',
      canView: true,
      canEditProfessional: true,
      canEditPhoto: true,
      canEditDisplayName: false,
      canManageResponsibilities: false,
      canManageReportingLine: false,
      canReadAudit: false,
    },
    viewer: { team: false, organizationOverview: false },
    generatedAt: '2026-10-13T10:00:00.000Z',
    ...over,
  }
}

function summary(over: Partial<StaffSummary> = {}): StaffSummary {
  return {
    staffId: 'admin_a',
    displayName: 'Admin A',
    role: 'admin',
    jobTitle: 'Supervisor',
    avatarUrl: null,
    isActive: true,
    account: { hasLogin: true, status: 'active' },
    lastActivityAt: null,
    profileUpdatedAt: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    reportingManager: { staffId: 'manager_c', displayName: 'Manager C', role: 'manager' },
    responsibilities: ['family_follow_up'],
    workload: { ...ZERO, assignedFamilies: 2, studentsInAssignedFamilies: 3, teachersOfAssignedStudents: 2 },
    completeness: { complete: 5, total: 5, missing: [] },
    access: { relation: 'team', canEditProfessional: true, canManageResponsibilities: true, canManageReportingLine: false },
    ...over,
  }
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
let routes: Array<[RegExp, string, Handler]>
let fetchMock: ReturnType<typeof vi.fn>

function on(method: string, pattern: RegExp, handler: Handler) {
  routes.unshift([pattern, method, handler])
}

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

const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body))

const adminSession = makeStaff({ id: 'admin_a', name: 'Admin A', role: 'admin' })

describe('an admin\'s own profile', () => {
  it('shows personal, account, responsibilities and verified workload -- and no management controls', async () => {
    on('GET', /\/staff-profiles\/me$/, () => json(profile()))
    renderWithProviders(<AppRoutes />, { staff: adminSession, route: '/profile' })

    expect(await screen.findByRole('heading', { name: 'My profile' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Personal profile' })).toBeInTheDocument()
    expect(screen.getByText('Supervises 3 assigned families')).toBeInTheDocument()
    expect(screen.getByText('admin_a@example.test')).toBeInTheDocument()

    const workload = screen.getByRole('region', { name: 'My responsibilities at a glance' })
    expect(within(workload).getByText('Assigned families').previousSibling).toHaveTextContent('3')
    expect(within(workload).getByText('Awaiting our reply').previousSibling).toHaveTextContent('2')
    // Untracked metrics are named, not shown as zeros.
    expect(within(workload).getByText('Not tracked in Jawwid Chat')).toBeInTheDocument()
    expect(within(workload).queryByText('Direct reports')).not.toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Assign responsibility' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change reporting manager' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'My team' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Organization overview' })).not.toBeInTheDocument()
    expect(calls('GET', /\/staff-profiles\/(team|organization)/)).toHaveLength(0)
  })

  it('missing optional fields render as empty states, not crashes', async () => {
    on('GET', /\/staff-profiles\/me$/, () => json(profile({ reportingManager: null, lastActivityAt: null, signInIdentity: null })))
    renderWithProviders(<AppRoutes />, { staff: adminSession, route: '/profile' })
    expect(await screen.findByText('No introduction yet.')).toBeInTheDocument()
    expect(screen.getByText('No reporting manager assigned')).toBeInTheDocument()
    expect(screen.getByText('No responsibilities assigned yet.')).toBeInTheDocument()
    expect(screen.getByText(/1 of 5 complete/)).toBeInTheDocument()
  })

  it('saves only the professional fields and the loaded version -- never a role or permission', async () => {
    on('GET', /\/staff-profiles\/me$/, () => json(profile({ version: 'v1' })))
    on('PATCH', /\/staff-profiles\/me$/, (_u, init) => {
      const b = JSON.parse(String(init.body))
      return json(profile({ jobTitle: b.jobTitle, about: b.about, version: 'v2' }))
    })
    renderWithProviders(<AppRoutes />, { staff: adminSession, route: '/profile' })

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Job title'), 'مشرفة متابعة')
    await userEvent.type(screen.getByLabelText('About me'), 'Line one')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('مشرفة متابعة')).toBeInTheDocument()
    const [call] = calls('PATCH', /\/staff-profiles\/me$/)
    expect(Object.keys(bodyOf(call!)).sort()).toEqual(['about', 'expectedVersion', 'jobTitle'])
    expect(bodyOf(call!)).toMatchObject({ expectedVersion: 'v1', jobTitle: 'مشرفة متابعة', about: 'Line one' })
  })

  it('an over-long title is flagged beside the field and nothing is sent', async () => {
    on('GET', /\/staff-profiles\/me$/, () => json(profile()))
    renderWithProviders(<AppRoutes />, { staff: adminSession, route: '/profile' })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Job title'), { target: { value: 'x'.repeat(81) } })
    expect(screen.getByLabelText('Job title')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Too long — at most 80 characters.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(calls('PATCH', /\/staff-profiles/)).toHaveLength(0)
  })

  it('a conflict keeps what the user typed, and loading the latest version does not clear it', async () => {
    let version = 'v1'
    on('GET', /\/staff-profiles\/me$/, () => json(profile({ version, about: version === 'v2' ? 'their edit' : null })))
    on('PATCH', /\/staff-profiles\/me$/, () => apiError(409, 'COMM.STAFF_PROFILE_CONFLICT'))
    renderWithProviders(<AppRoutes />, { staff: adminSession, route: '/profile' })

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByLabelText('About me'), 'my careful text')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else saved this profile')
    expect(screen.getByLabelText('About me')).toHaveValue('my careful text')

    version = 'v2'
    await userEvent.click(screen.getByRole('button', { name: 'Load the latest version' }))
    expect(await screen.findByText('their edit')).toBeInTheDocument()
    expect(screen.getByLabelText('About me')).toHaveValue('my careful text')
  })

  it('the page follows the server\'s flags, not the session role', async () => {
    const sa = makeStaff({ id: 'owner_s', name: 'Owner S', role: 'super_admin' })
    on('GET', /\/staff-profiles\/me$/, () =>
      json(profile({ access: { ...profile().access, canEditProfessional: false, canEditPhoto: false } })),
    )
    renderWithProviders(<AppRoutes />, { staff: sa, route: '/profile' })
    await screen.findByRole('heading', { name: 'Personal profile' })
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Choose a photo')).not.toBeInTheDocument()
    expect(calls('GET', /\/staff-profiles\/organization/)).toHaveLength(0)
  })
})

describe('the profile photo', () => {
  it('previews, uploads straight to storage, then commits the key', async () => {
    on('GET', /\/staff-profiles\/me$/, () => json(profile()))
    on('POST', /\/staff-profiles\/me\/avatar\/upload$/, () =>
      json({ objectKey: 'avatars/staff/admin_a/k1', uploadUrl: 'https://storage.test/put?sig=1', method: 'PUT', headers: { 'content-type': 'image/webp', 'content-length': '10' }, expiresAt: '' }),
    )
    on('PUT', /storage\.test/, () => new Response(null, { status: 200 }))
    on('POST', /\/staff-profiles\/me\/avatar$/, () => json(profile({ avatarUrl: 'https://storage.test/get?sig=2' })))
    renderWithProviders(<AppRoutes />, { staff: adminSession, route: '/profile' })

    const input = await screen.findByLabelText('Choose a photo')
    await userEvent.upload(input, new File(['png'], 'me.png', { type: 'image/png' }))
    expect(await screen.findByAltText('Preview of the new photo')).toHaveAttribute('src', 'blob:preview')
    await userEvent.click(screen.getByRole('button', { name: 'Use this photo' }))

    expect(await screen.findByText('Photo updated.')).toBeInTheDocument()
    const [grant] = calls('POST', /avatar\/upload$/)
    expect(bodyOf(grant!)).toEqual({ mimeType: 'image/webp', byteSize: 10 })
    const [put] = calls('PUT', /storage\.test/)
    // The bearer token never travels to storage, and content-length is left to the browser.
    expect((put![1] as RequestInit).headers).toEqual({ 'content-type': 'image/webp' })
    expect(bodyOf(calls('POST', /\/avatar$/)[0]!)).toEqual({ objectKey: 'avatars/staff/admin_a/k1' })
    expect(screen.getByAltText('Photo of Admin A')).toHaveAttribute('src', 'https://storage.test/get?sig=2')
  })

  it('a failed upload says so and leaves the current photo alone', async () => {
    on('GET', /\/staff-profiles\/me$/, () => json(profile({ avatarUrl: 'https://storage.test/old' })))
    on('POST', /avatar\/upload$/, () =>
      json({ objectKey: 'k', uploadUrl: 'https://storage.test/put', method: 'PUT', headers: { 'content-type': 'image/webp' }, expiresAt: '' }),
    )
    on('PUT', /storage\.test/, () => new Response(null, { status: 403 }))
    renderWithProviders(<AppRoutes />, { staff: adminSession, route: '/profile' })

    await userEvent.upload(await screen.findByLabelText('Replace photo'), new File(['x'], 'x.png', { type: 'image/png' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Use this photo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The upload did not complete')
    expect(calls('POST', /\/avatar$/)).toHaveLength(0)
  })

  it('a photo that fails to load falls back to initials, never a broken image', async () => {
    on('GET', /\/staff-profiles\/me$/, () =>
      json(profile({ avatarUrl: 'https://storage.test/expired', access: { ...profile().access, canEditPhoto: false } })),
    )
    renderWithProviders(<AppRoutes />, { staff: adminSession, route: '/profile' })
    const img = await screen.findByAltText('Photo of Admin A')
    fireEvent.error(img)
    expect(await screen.findByRole('img', { name: 'Photo of Admin A' })).toHaveTextContent('AA')
  })
})

describe('a manager', () => {
  const managerSession = makeStaff({ id: 'manager_c', name: 'Manager C', role: 'manager' })
  const team: Team = {
    manager: { staffId: 'manager_c', displayName: 'Manager C', role: 'manager', jobTitle: null, avatarUrl: null },
    members: [
      summary(),
      summary({ staffId: 'admin_x', displayName: 'Admin X', isActive: false, responsibilities: [], completeness: { complete: 2, total: 5, missing: ['photo', 'about', 'responsibility'] } }),
    ],
    totals: { ...ZERO, assignedFamilies: 4, studentsInAssignedFamilies: 6 },
    distinctTeachers: 2,
    generatedAt: '2026-10-13T10:00:00.000Z',
  }

  it('sees My team with exact totals and the server\'s distinct teacher count', async () => {
    on('GET', /\/staff-profiles\/me$/, () =>
      json(profile({ staffId: 'manager_c', displayName: 'Manager C', role: 'manager', viewer: { team: true, organizationOverview: false } })),
    )
    on('GET', /\/staff-profiles\/team$/, () => json(team))
    renderWithProviders(<AppRoutes />, { staff: managerSession, route: '/profile' })

    const section = await screen.findByRole('region', { name: 'My team' })
    expect(await within(section).findByRole('link', { name: 'Admin A' })).toHaveAttribute('href', '/profile/admin_a')
    const totals = within(section).getByLabelText('Team totals')
    expect(within(totals).getByText('Teachers').previousSibling).toHaveTextContent('2')
    expect(within(totals).getByText('Families').previousSibling).toHaveTextContent('4')
    expect(within(section).getAllByText('You can edit').length).toBe(2)
  })

  it('filters the team by search and by status', async () => {
    on('GET', /\/staff-profiles\/me$/, () =>
      json(profile({ staffId: 'manager_c', role: 'manager', viewer: { team: true, organizationOverview: false } })),
    )
    on('GET', /\/staff-profiles\/team$/, () => json(team))
    renderWithProviders(<AppRoutes />, { staff: managerSession, route: '/profile' })
    const section = await screen.findByRole('region', { name: 'My team' })
    await within(section).findByRole('link', { name: 'Admin A' })

    await userEvent.type(within(section).getByPlaceholderText('Search by name or title'), 'Admin X')
    expect(within(section).queryByRole('link', { name: 'Admin A' })).not.toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Admin X' })).toBeInTheDocument()

    await userEvent.clear(within(section).getByPlaceholderText('Search by name or title'))
    await chooseOption(userEvent, within(section).getByLabelText('Account status'), 'incomplete')
    expect(within(section).queryByRole('link', { name: 'Admin A' })).not.toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Admin X' })).toBeInTheDocument()
  })

  it('opens a report\'s profile with edit and assign controls the server allowed, and no name or photo control', async () => {
    on('GET', /\/staff-profiles\/admin_a$/, () =>
      json(profile({
        access: { relation: 'team', canView: true, canEditProfessional: true, canEditPhoto: false, canEditDisplayName: false, canManageResponsibilities: true, canManageReportingLine: false, canReadAudit: true },
        signInIdentity: null,
      })),
    )
    on('GET', /\/staff-profiles\/admin_a\/activity$/, () =>
      json({ entries: [{ id: '1', action: 'staff_profile.updated', at: '2026-10-13T09:00:00.000Z', target: { staffId: 'admin_a', displayName: 'Admin A' }, actor: { staffId: 'manager_c', displayName: 'Manager C' }, changedFields: ['jobTitle'], before: null, after: null, reason: 'annual review' }] }),
    )
    on('POST', /\/staff-profiles\/admin_a\/responsibilities$/, (_u, init) =>
      json(profile({
        responsibilities: [{ id: 'r1', category: JSON.parse(String(init.body)).category, scopeNote: null, assignedAt: '2026-10-13T10:00:00.000Z', assignedBy: { staffId: 'manager_c', displayName: 'Manager C' }, endedAt: null, endReason: null }],
        access: { relation: 'team', canView: true, canEditProfessional: true, canEditPhoto: false, canEditDisplayName: false, canManageResponsibilities: true, canManageReportingLine: false, canReadAudit: true },
      })),
    )
    renderWithProviders(<AppRoutes />, { staff: managerSession, route: '/profile/admin_a' })

    expect(await screen.findByRole('heading', { name: 'Staff profile' })).toBeInTheDocument()
    expect(screen.getByText('You are editing Admin A’s profile. This change is recorded with your name.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Choose a photo')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change reporting manager' })).not.toBeInTheDocument()
    expect(await screen.findByText('annual review')).toBeInTheDocument()
    expect(screen.queryByText('admin_a@example.test')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Assign responsibility' }))
    const dialog = screen.getByRole('dialog', { name: 'Assign responsibility' })
    await chooseOption(userEvent, within(dialog).getByLabelText('Area'), 'customer_support')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Customer support')).toBeInTheDocument()
    expect(bodyOf(calls('POST', /responsibilities$/)[0]!)).toEqual({ category: 'customer_support', scopeNote: null })
  })

  it('a profile the server will not show reads "not found"', async () => {
    on('GET', /\/staff-profiles\/admin_b$/, () => apiError(404, 'COMM.STAFF_PROFILE_NOT_FOUND'))
    renderWithProviders(<AppRoutes />, { staff: managerSession, route: '/profile/admin_b' })
    expect(await screen.findByText('This profile does not exist or is not one you can view.')).toBeInTheDocument()
  })
})

describe('the super admin master profile', () => {
  const sa = makeStaff({ id: 'owner_s', name: 'Owner S', role: 'super_admin' })
  const org: OrganizationOverview = {
    generatedAt: '2026-10-13T10:00:00.000Z',
    accounts: { byRole: { admin: { active: 2, inactive: 1 }, manager: { active: 1, inactive: 0 } }, managers: 1, adminsAndSupervisors: 2, active: 4, inactive: 1, withoutLogin: 1 },
    teams: [{ manager: { staffId: 'manager_c', displayName: 'Manager C', role: 'manager', jobTitle: null, avatarUrl: null, isActive: true }, memberCount: 1, totals: { ...ZERO, assignedFamilies: 2 }, distinctTeachers: 2 }],
    responsibilityCoverage: [{ category: 'family_follow_up', holders: [{ staffId: 'admin_a', displayName: 'Admin A' }] }],
    workload: {
      unique: { families: 3, studentsInFamilies: 5, activeParentContacts: 4, activeTeachers: 6, teachersWithStudents: 2, openConversations: 1, awaitingReply: 1, pendingApprovals: 1, familiesOwnedByInactiveStaff: 0 },
      sumOfTeams: { assignedFamilies: 2, studentsInAssignedFamilies: 3, openConversations: 1, pendingApprovals: 1 },
      familiesOutsideTeams: 1,
    },
    health: {
      withoutReportingLine: [{ staffId: 'admin_b', displayName: 'Admin B', role: 'admin', jobTitle: null, avatarUrl: null }],
      incompleteProfiles: [],
      withoutLogin: [],
      staleReportingLines: [],
      familiesOwnedByInactiveStaff: 0,
    },
    directory: [summary({ access: { relation: 'organization', canEditProfessional: true, canManageResponsibilities: true, canManageReportingLine: true } }), summary({ staffId: 'admin_b', displayName: 'Admin B', reportingManager: null })],
    directoryTruncated: false,
    recentActivity: [],
  }

  beforeEach(() => {
    on('GET', /\/staff-profiles\/me$/, () =>
      json(profile({
        staffId: 'owner_s', displayName: 'Owner S', role: 'super_admin', reportingManager: null,
        access: { relation: 'self', canView: true, canEditProfessional: true, canEditPhoto: true, canEditDisplayName: true, canManageResponsibilities: true, canManageReportingLine: false, canReadAudit: true },
        viewer: { team: true, organizationOverview: true },
      })),
    )
    on('GET', /\/staff-profiles\/me\/activity$/, () => json({ entries: [] }))
    on('GET', /\/staff-profiles\/organization$/, () => json(org))
  })

  it('shows the organization overview with unique totals kept apart from summed team figures', async () => {
    renderWithProviders(<AppRoutes />, { staff: sa, route: '/profile' })
    const panel = await screen.findByRole('region', { name: 'Organization overview' })
    expect(await within(panel).findByText('Managers')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Manager C' })).toHaveAttribute('href', '/profile/manager_c')

    await userEvent.click(within(panel).getByRole('tab', { name: 'Academy workload' }))
    expect(within(panel).getByRole('heading', { name: 'Unique academy totals' })).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'Summed across teams' })).toBeInTheDocument()
    expect(within(panel).getByText('Families supervised by staff outside any team').previousSibling).toHaveTextContent('1')
  })

  it('navigates from a summary to the directory and to health, and quick actions link to real screens', async () => {
    renderWithProviders(<AppRoutes />, { staff: sa, route: '/profile' })
    const panel = await screen.findByRole('region', { name: 'Organization overview' })
    await userEvent.click(await within(panel).findByText('Admins & supervisors'))
    expect(within(panel).getByRole('tab', { name: 'Team directory' })).toHaveAttribute('aria-selected', 'true')
    expect(within(panel).getByRole('link', { name: 'Admin B' })).toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('tab', { name: 'Profile & assignment health' }))
    expect(within(panel).getByText(/Active staff without a reporting manager/)).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Admin B' })).toHaveAttribute('href', '/profile/admin_b')
    expect(within(panel).getByRole('link', { name: 'All accounts (read-only)' })).toHaveAttribute('href', '/admin/users')
    // PD-40 PR-5b: roles and permissions have a screen now -- the Accounts page's tabs.
    expect(within(panel).queryByText(/no management screen exists yet/)).not.toBeInTheDocument()
    expect(within(panel).getByText(/managed on the Accounts page, under the Staff accounts and Roles tabs/)).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Staff accounts' })).toHaveAttribute('href', '/accounts/staff')
    expect(within(panel).getByRole('link', { name: 'Roles' })).toHaveAttribute('href', '/accounts/roles')
  })

  it('tabs are keyboard operable', async () => {
    renderWithProviders(<AppRoutes />, { staff: sa, route: '/profile' })
    const panel = await screen.findByRole('region', { name: 'Organization overview' })
    const first = within(panel).getByRole('tab', { name: 'Organization' })
    first.focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(within(panel).getByRole('tab', { name: 'Team directory' })).toHaveFocus())
  })

  it('may rename someone; the name field exists only because the server allowed it', async () => {
    renderWithProviders(<AppRoutes />, { staff: sa, route: '/profile' })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Full name')).toHaveValue('Owner S')
  })
})

describe('Arabic', () => {
  it('renders the page right-to-left with Arabic labels', async () => {
    on('GET', /\/staff-profiles\/me$/, () => json(profile()))
    renderWithProviders(<AppRoutes />, { staff: adminSession, route: '/profile', locale: 'ar' })
    expect(await screen.findByRole('heading', { name: 'ملفي الشخصي' })).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
    expect(screen.getByText('يشرف على 3 من الأسر المسندة')).toBeInTheDocument()
    expect(screen.getByText('غير متتبَّع في جوّد شات')).toBeInTheDocument()
  })
})
