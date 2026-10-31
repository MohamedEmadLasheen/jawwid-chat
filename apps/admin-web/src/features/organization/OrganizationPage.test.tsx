import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { Department, LearnerAssignment } from './api'
import { chooseOption, optionsOf } from '@/test/select'

/**
 * PD-8 organization page, through the real routes and the real API client,
 * with `fetch` answered at the network boundary. What these prove is the page's
 * side of the contract -- the right request, with a reason, and the server's
 * refusal shown as it is. The refusals themselves are proven server-side
 * (apps/api test/integration/org-scope-pd8.spec.ts); hiding a control is not
 * security. Synthetic people only.
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
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body))

const person = (id: string, name: string, role = 'admin') => ({ id, name, role, isActive: true })

const OPERATIONS: Department = {
  id: 'dept-ops',
  kind: 'operations',
  displayName: 'Operations',
  manager: person('mgr-ops', 'Ops Manager', 'manager'),
  members: [
    { ...person('sup-1', 'Supervisor One'), position: 'supervisor', learnerCount: 2 },
    { ...person('sup-2', 'Supervisor Two'), position: 'supervisor', learnerCount: 0 },
    { ...person('bak-1', 'Backup One', 'coverage'), position: 'backup_supervisor', learnerCount: 0 },
  ],
  backups: [
    { id: 'link-1', primary: person('sup-1', 'Supervisor One'), backup: person('bak-1', 'Backup One', 'coverage'), status: 'dormant', activatedAt: null, activeUntil: null },
    { id: 'link-2', primary: person('sup-2', 'Supervisor Two'), backup: person('bak-1', 'Backup One', 'coverage'), status: 'active', activatedAt: '2026-10-15T08:00:00Z', activeUntil: '2026-10-22T08:00:00Z' },
  ],
}

const LEARNERS: LearnerAssignment[] = [
  { learnerId: 'l-1', name: 'Child Alpha', family: { id: 'f-1', displayName: 'Family One' }, teacher: { id: 't-1', name: 'Teacher T' }, supervisor: { id: 'sup-1', name: 'Supervisor One' } },
  { learnerId: 'l-2', name: 'Child Beta', family: { id: 'f-2', displayName: 'Family Two' }, teacher: null, supervisor: null },
]

const opsManager = makeStaff({ id: 'mgr-ops', name: 'Ops Manager', role: 'manager' })

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
  on('GET', /\/org\/structure$/, () => json({ departments: [OPERATIONS] }))
  on('GET', /\/org\/learners$/, () => json({ learners: LEARNERS }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('children and their supervisors', () => {
  it('lists every child the server returns, with the unassigned ones marked', async () => {
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/organization' })
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Child Alpha')).toBeInTheDocument()
    const beta = within(table).getByText('Child Beta').closest('tr')!
    expect(within(beta).getByText('Unassigned')).toBeInTheDocument()
    expect(within(beta).getByRole('button', { name: 'Assign — Child Beta' })).toBeInTheDocument()
  })

  it('filters to the children without a supervisor', async () => {
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/organization' })
    await screen.findByText('Child Alpha')
    await chooseOption(userEvent, screen.getByRole('combobox', { name: 'Show' }), 'unassigned')
    expect(screen.queryByText('Child Alpha')).not.toBeInTheDocument()
    expect(screen.getByText('Child Beta')).toBeInTheDocument()
  })

  it('opens on the filter the URL names, so a Dashboard tile opens the list it counted (PD-44)', async () => {
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/organization?tab=children&filter=unassigned' })
    expect(await screen.findByText('Child Beta')).toBeInTheDocument()
    expect(screen.queryByText('Child Alpha')).not.toBeInTheDocument()
    // Choosing "All" again shows every child.
    await chooseOption(userEvent, screen.getByRole('combobox', { name: 'Show' }), 'all')
    expect(await screen.findByText('Child Alpha')).toBeInTheDocument()
  })

  it('assigns a supervisor with a reason; without one nothing is sent', async () => {
    on('POST', /\/org\/learners\/l-2\/supervisor$/, () => json({ learnerId: 'l-2', supervisorId: 'sup-2', changed: true }, 201))
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/organization' })
    await userEvent.click(await screen.findByRole('button', { name: 'Assign — Child Beta' }))
    const dialog = await screen.findByRole('dialog')

    // Only Operations PRIMARY supervisors are offered -- never the backup.
    const select = within(dialog).getByRole('combobox', { name: 'New supervisor' })
    expect((await optionsOf(userEvent, select)).map((o) => o.label).join()).not.toMatch(/Backup One/)
    await chooseOption(userEvent, select, 'sup-2')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Required.')).toBeInTheDocument()
    expect(calls('POST', /\/org\/learners\//)).toHaveLength(0)

    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason (required)' }), 'balancing the caseload')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/org\/learners\/l-2\/supervisor$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/org\/learners\/l-2\/supervisor$/)[0]!)).toEqual({
      supervisorId: 'sup-2',
      reason: 'balancing the caseload',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it("shows the server's refusal as it is, and keeps the dialog open", async () => {
    on('POST', /\/org\/learners\/l-2\/supervisor$/, () =>
      json({ error: { code: 'COMM.ORG_STRUCTURE_DENIED', message: 'manager may not assign learners to supervisors' } }, 403),
    )
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/organization' })
    await userEvent.click(await screen.findByRole('button', { name: 'Assign — Child Beta' }))
    const dialog = await screen.findByRole('dialog')
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'New supervisor' }), 'sup-2')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason (required)' }), 'x')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You are not allowed to make this change.')
  })
})

describe('departments and backup supervisors', () => {
  it('shows each link with its status, and only the actions that status allows', async () => {
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/organization' })
    await userEvent.click(await screen.findByRole('tab', { name: 'Departments & backups' }))
    const links = await screen.findAllByRole('listitem')
    const dormant = links.find((li) => li.textContent?.includes('covers Supervisor One'))!
    const active = links.find((li) => li.textContent?.includes('covers Supervisor Two'))!
    expect(within(dormant).getByText('Dormant')).toBeInTheDocument()
    expect(within(dormant).getByRole('button', { name: 'Activate — Backup One covers Supervisor One' })).toBeInTheDocument()
    expect(within(active).getByText('Active')).toBeInTheDocument()
    expect(within(active).getByRole('button', { name: 'Deactivate — Backup One covers Supervisor Two' })).toBeInTheDocument()
    expect(within(active).queryByRole('button', { name: /^Activate/ })).not.toBeInTheDocument()
  })

  it('activates a dormant link with a reason and an end date', async () => {
    on('POST', /\/org\/backups\/link-1\/activate$/, () => json({ id: 'link-1', status: 'active' }, 201))
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/organization' })
    await userEvent.click(await screen.findByRole('tab', { name: 'Departments & backups' }))
    const dormant = (await screen.findAllByRole('listitem')).find((li) => li.textContent?.includes('covers Supervisor One'))!
    await userEvent.click(within(dormant).getByRole('button', { name: 'Activate — Backup One covers Supervisor One' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Active until (optional)'), '2026-11-01')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason (required)' }), 'annual leave')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/org\/backups\/link-1\/activate$/)).toHaveLength(1))
    const body = bodyOf(calls('POST', /\/org\/backups\/link-1\/activate$/)[0]!)
    expect(body.reason).toBe('annual leave')
    expect(new Date(body.until).getFullYear()).toBe(2026)
  })

  it('creates a new link as dormant: a primary supervisor and another member of the department', async () => {
    on('POST', /\/org\/backups$/, () => json({ id: 'link-3', status: 'dormant' }, 201))
    renderWithProviders(<AppRoutes />, { staff: opsManager, route: '/organization' })
    await userEvent.click(await screen.findByRole('tab', { name: 'Departments & backups' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add backup link' }))
    const dialog = await screen.findByRole('dialog')
    const primary = within(dialog).getByRole('combobox', { name: 'Supervisor' })
    // A backup supervisor is never offered as the PRIMARY.
    expect((await optionsOf(userEvent, primary)).map((o) => o.label)).not.toContain('Backup One')
    await chooseOption(userEvent, primary, 'sup-1')
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Backup' }), 'bak-1')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason (required)' }), 'coverage plan')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/org\/backups$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/org\/backups$/)[0]!)).toEqual({ primaryId: 'sup-1', backupId: 'bak-1', reason: 'coverage plan' })
  })
})

describe('who reaches the page', () => {
  it('a manager whose department is not Operations sees the structure, and no children tab', async () => {
    const teachersDept: Department = { ...OPERATIONS, id: 'dept-t', kind: 'teachers', backups: [] }
    on('GET', /\/org\/structure$/, () => json({ departments: [teachersDept] }))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'mgr-t', role: 'manager' }), route: '/organization' })
    expect(await screen.findByRole('heading', { level: 2, name: 'Teachers' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Children & supervisors' })).not.toBeInTheDocument()
    expect(calls('GET', /\/org\/learners/)).toHaveLength(0)
  })

  it('a supervisor is not offered the page (and the server would refuse it anyway)', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'sup-1', role: 'admin' }), route: '/organization' })
    expect(await screen.findByText(/not available|permission|forbidden/i)).toBeInTheDocument()
    expect(calls('GET', /\/org\//)).toHaveLength(0)
  })

  it('the super admin reaches it as the Organization section of the Admin Portal', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'owner', role: 'super_admin' }), route: '/admin/teams' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Organization' })).toBeInTheDocument()
    expect(await screen.findByText('Child Alpha')).toBeInTheDocument()
  })
})

// PD-35: the Teachers Manager assigns each teacher to a teacher supervisor.
describe('teachers and their supervisors', () => {
  const TEACHERS: Department = {
    id: 'dept-t',
    kind: 'teachers',
    displayName: 'Teachers',
    manager: person('mgr-t', 'Teachers Manager', 'manager'),
    members: [{ ...person('tsup-1', 'Tsup One'), position: 'supervisor', learnerCount: 0 }],
    backups: [],
  }
  const ASSIGNMENTS = {
    strictScope: false,
    unassigned: 2,
    teachers: [
      { id: 't-1', name: 'Teacher T', isActive: true, supervisor: { id: 'tsup-1', name: 'Tsup One', isActive: true }, assignedAt: '2026-10-26T08:00:00Z' },
      { id: 't-2', name: 'Teacher U', isActive: true, supervisor: null, assignedAt: null },
      // Their supervisor was deactivated: counted as unassigned by the server.
      { id: 't-3', name: 'Teacher V', isActive: true, supervisor: { id: 'tsup-old', name: 'Old Sup', isActive: false }, assignedAt: '2026-10-20T08:00:00Z' },
    ],
    supervisors: [{ id: 'tsup-1', name: 'Tsup One' }, { id: 'tsup-2', name: 'Tsup Two' }],
  }
  const teachersManager = makeStaff({ id: 'mgr-t', name: 'Teachers Manager', role: 'manager' })

  beforeEach(() => {
    on('GET', /\/org\/structure$/, () => json({ departments: [TEACHERS] }))
    on('GET', /\/org\/teacher-assignments$/, () => json(ASSIGNMENTS))
  })

  it('shows every teacher with their supervisor, and how many have none', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/organization' })
    expect(await screen.findByRole('tab', { name: 'Teachers & supervisors', selected: true })).toBeInTheDocument()
    expect(await screen.findByText(/2 teachers have no supervisor/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Supervisor for Teacher T' })).toHaveAttribute('data-value', 'tsup-1')
    expect(screen.getByRole('combobox', { name: 'Supervisor for Teacher U' })).toHaveAttribute('data-value', '')
  })

  it('opens on Teachers & supervisors from ?tab=teachers (the Teacher Files "Assign supervisor" shortcut)', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'owner', role: 'super_admin' }), route: '/admin/teams?tab=teachers' })
    expect(await screen.findByRole('tab', { name: 'Teachers & supervisors', selected: true })).toBeInTheDocument()
  })

  it('shows a teacher whose supervisor left as unassigned, naming the former supervisor', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/organization' })
    const select = await screen.findByRole('combobox', { name: 'Supervisor for Teacher V' })
    expect(select).toHaveAttribute('data-value', '')
    const row = select.closest('tr') as HTMLElement
    expect(within(row).getByText('Unassigned')).toBeInTheDocument()
    expect(within(row).getByText(/Former supervisor: Old Sup/)).toBeInTheDocument()
  })

  it('assigns, and takes away, a teacher\'s supervisor', async () => {
    on('POST', /\/org\/teachers\/t-2\/supervisor$/, () => json({ teacherId: 't-2', supervisorId: 'tsup-2' }))
    on('POST', /\/org\/teachers\/t-1\/supervisor$/, () => json({ teacherId: 't-1', supervisorId: null }))
    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/organization' })
    await chooseOption(userEvent, await screen.findByRole('combobox', { name: 'Supervisor for Teacher U' }), 'tsup-2')
    await waitFor(() => expect(calls('POST', /\/org\/teachers\/t-2\/supervisor$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/org\/teachers\/t-2\/supervisor$/)[0]!)).toEqual({ supervisorId: 'tsup-2' })
    await chooseOption(userEvent, screen.getByRole('combobox', { name: 'Supervisor for Teacher T' }), '')
    await waitFor(() => expect(calls('POST', /\/org\/teachers\/t-1\/supervisor$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/org\/teachers\/t-1\/supervisor$/)[0]!)).toEqual({ supervisorId: null })
  })

  it('is not offered to a manager of another department', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'other-mgr', role: 'manager' }), route: '/organization' })
    expect(await screen.findByRole('heading', { level: 2, name: 'Teachers' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Teachers & supervisors' })).not.toBeInTheDocument()
    expect(calls('GET', /\/org\/teacher-assignments/)).toHaveLength(0)
  })
})
