import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { TeacherFile, TeacherSummary } from './api'

/**
 * PD-10 Teacher Files, through the real routes and the real API client, with
 * `fetch` answered at the network boundary. These prove the page's side of
 * the contract: the navigation follows the server's answer, the controls
 * follow `access`, and requests carry what the server expects. Who may do
 * what is proven server-side (apps/api test/integration/teacher-file.spec.ts).
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
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body))

const TEACHERS: TeacherSummary[] = [
  { id: 't-1', name: 'Teacher One', isActive: true, studentCount: 2, openComplaints: 1 },
  { id: 't-2', name: 'Teacher Two', isActive: false, studentCount: 0, openComplaints: 0 },
]

const brief = (id: string, body: string) => ({ id, body, createdAt: '2026-10-18T09:00:00Z', author: { id: 's-1', name: 'Supervisor One' } })

function file(access = { canEditPersonal: false, canWriteSupervision: true }): TeacherFile {
  return {
    access,
    teacher: { id: 't-1', name: 'Teacher One', isActive: true, leftAt: null },
    personal: {
      fullName: 'Teacher One',
      phone: '+20 100 555 0147',
      email: 'teacher.one@example.test',
      joinedOn: '2025-09-01',
      updatedAt: '2026-10-18T09:00:00Z',
      updatedBy: { id: 'm-1', name: 'Teachers Manager' },
    },
    assignedStudents: [
      { learnerId: 'l-1', name: 'Child Alpha', level: 'A2', family: { id: 'f-1', displayName: 'Family One' }, supervisor: { id: 's-9', name: 'Ops Supervisor' } },
    ],
    supervision: {
      complaints: [{ ...brief('c-1', 'Started late.'), source: null, resolution: null }],
      monthlyComments: [{ month: '2026-09', current: brief('m-2', 'Strong month.'), earlierVersions: [brief('m-1', 'Draft.')] }],
      daysOff: [{ ...brief('d-1', 'Family matter.'), date: '2026-10-21', cancellation: null }],
    },
  }
}

const teachersSupervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })
const teachersManager = makeStaff({ id: 'm-1', name: 'Teachers Manager', role: 'manager' })

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
  on('GET', /\/teacher-files$/, () => json({ access: { canEditPersonal: false, canWriteSupervision: true }, teachers: TEACHERS }))
  on('GET', /\/teacher-files\/t-1$/, () => json(file()))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('navigation follows the server, not the role', () => {
  it('offers Teachers to a staff member the server answers for', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/chat' })
    const nav = await screen.findByRole('navigation', { name: 'Jawwid Operations' })
    expect(await within(nav).findByRole('link', { name: 'Teachers' })).toHaveAttribute('href', '/teachers')
  })

  it('does not offer it to the same role when the server refuses (an Operations supervisor)', async () => {
    on('GET', /\/teacher-files$/, () => json({ error: { code: 'COMM.TEACHER_FILE_DENIED', message: 'Teacher Files are administration-only' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/chat' })
    const nav = await screen.findByRole('navigation', { name: 'Jawwid Operations' })
    await waitFor(() => expect(calls('GET', /\/teacher-files$/)).toHaveLength(1))
    expect(within(nav).queryByRole('link', { name: 'Teachers' })).not.toBeInTheDocument()
    // A refusal is an answer: it is not retried.
    expect(calls('GET', /\/teacher-files$/)).toHaveLength(1)
  })

  it('never asks for a role that cannot hold a Teachers-department place', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'finance' }), route: '/tasks' })
    await screen.findByRole('navigation', { name: 'Jawwid Operations' })
    expect(calls('GET', /\/teacher-files/)).toHaveLength(0)
  })
})

describe('the list', () => {
  it('lists every teacher with counts and status, each linking to its file', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers' })
    const table = await screen.findByRole('table')
    const one = within(table).getByRole('link', { name: /^Teacher One/ })
    expect(one).toHaveAttribute('href', '/teachers/t-1')
    const two = within(table).getByText('Teacher Two').closest('tr')!
    expect(within(two).getByText('Left')).toBeInTheDocument()
    expect(screen.queryByText(/example\.test|0147/)).not.toBeInTheDocument()
  })

  it("shows the server's refusal as it is", async () => {
    on('GET', /\/teacher-files$/, () => json({ error: { code: 'COMM.TEACHER_FILE_DENIED', message: 'Teacher Files are administration-only' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers' })
    expect(await screen.findByText('Teacher Files are for the Teachers department and the super admin.')).toBeInTheDocument()
  })
})

describe('a teacher file', () => {
  it('shows every section; the joining date is the same calendar day in any time zone', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/t-1' })
    expect(await screen.findByRole('heading', { level: 1, name: /^Teacher One/ })).toBeInTheDocument()
    const personal = screen.getByRole('region', { name: 'Personal information' })
    expect(within(personal).getByText('+20 100 555 0147')).toBeInTheDocument()
    expect(within(personal).getByText('1 Sept 2025')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Assigned students (1)' })).getByText('Child Alpha')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Complaints' })).getByText('Started late.')).toBeInTheDocument()
    const monthly = screen.getByRole('region', { name: 'Monthly performance' })
    expect(within(monthly).getByText('September 2026')).toBeInTheDocument()
    expect(within(monthly).getByText('1 earlier version(s)')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Days off' })).getByText('21 Oct 2026')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Not here yet' })).toHaveTextContent(/Salary/)
  })

  it('offers only the controls the server grants: a supervisor writes notes but cannot edit personal information', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/t-1' })
    await screen.findByRole('heading', { level: 1, name: /^Teacher One/ })
    expect(screen.queryByRole('button', { name: 'Edit personal information' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record a complaint' })).toBeInTheDocument()
  })

  it('records a complaint resolution against the complaint it resolves', async () => {
    on('POST', /\/teacher-files\/t-1\/entries$/, () => json({ id: 'r-1', kind: 'complaint_resolution', createdAt: '2026-10-18T10:00:00Z' }, 201))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/t-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Required.')).toBeInTheDocument()
    expect(calls('POST', /\/entries$/)).toHaveLength(0)

    await userEvent.type(within(dialog).getByRole('textbox', { name: 'How it was resolved' }), 'Discussed with the teacher.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/entries$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/entries$/)[0]!)).toEqual({
      kind: 'complaint_resolution',
      body: 'Discussed with the teacher.',
      refersTo: 'c-1',
    })
  })

  it("keeps the dialog open with the server's conflict", async () => {
    on('POST', /\/teacher-files\/t-1\/entries$/, () =>
      json({ error: { code: 'COMM.TEACHER_FILE_CONFLICT', message: 'this day off is already recorded' } }, 409),
    )
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/t-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Record a day off' }))
    const dialog = await screen.findByRole('dialog')
    const day = dialog.querySelector('input[type="date"]') as HTMLInputElement
    await userEvent.type(day, '2026-10-21')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Details' }), 'Again.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Already recorded/)
    expect(bodyOf(calls('POST', /\/entries$/)[0]!)).toEqual({ kind: 'day_off', body: 'Again.', dayOffOn: '2026-10-21' })
  })

  it('the Teachers manager edits personal information: only changed fields are sent, an emptied one as null, with a reason', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(file({ canEditPersonal: true, canWriteSupervision: true })))
    on('POST', /\/teacher-files\/t-1\/personal$/, () => json(file({ canEditPersonal: true, canWriteSupervision: true }), 201))
    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/teachers/t-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit personal information' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Email address' }))
    const phone = within(dialog).getByRole('textbox', { name: 'Phone number' })
    await userEvent.clear(phone)
    await userEvent.type(phone, '+20 111 222 3333')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(calls('POST', /\/personal$/)).toHaveLength(0)
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason for the change' }), 'new SIM')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/personal$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/personal$/)[0]!)).toEqual({ phone: '+20 111 222 3333', email: null, reason: 'new SIM' })
  })

  it('reads in Arabic, right to left', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/t-1', locale: 'ar' })
    expect(await screen.findByRole('region', { name: 'البيانات الشخصية' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'الشكاوى' })).toBeInTheDocument()
    expect(document.documentElement.dir === 'rtl' || document.querySelector('[dir="rtl"]')).toBeTruthy()
  })
})
