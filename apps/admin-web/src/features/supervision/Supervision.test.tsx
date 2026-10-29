import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { LeaveRequest, TeacherLeave } from './api'

/**
 * PD-12 S1 pages, through the real routes and the real API client, with
 * `fetch` answered at the network boundary. These prove the pages' side of the
 * contract: what is offered, what is sent, and that nothing is issued or
 * approved without the confirmation the server requires. Who may do what is
 * proven server-side (apps/api test/integration/pd012-s1.spec.ts).
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

function leave(over: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 'r-1',
    teacher: { id: 't-1', name: 'Teacher One' },
    firstDay: '2027-03-10',
    lastDay: '2027-03-12',
    days: 3,
    reason: 'Family wedding',
    state: 'requested',
    requestedAt: '2026-10-18T09:00:00Z',
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
    endedAt: null,
    balance: 21,
    collidingLessons: [],
    ...over,
  }
}

const teachersSupervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })

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
  on('GET', /\/teacher-files$/, () => json({ access: { canEditPersonal: false, canWriteSupervision: true }, teachers: [] }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the Teachers area has three pages', () => {
  it('links Statistics, Teacher files and Supervision (one registry, PD-11 T5; PD-26); certificates have their own page (PD-41)', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files' })
    const tabs = await screen.findByRole('navigation', { name: 'Teachers' })
    expect(within(tabs).getByRole('link', { name: 'Statistics' })).toHaveAttribute('href', '/teachers')
    expect(within(tabs).getByRole('link', { name: 'Teacher files' })).toHaveAttribute('aria-current', 'page')
    expect(within(tabs).getByRole('link', { name: 'Supervision' })).toHaveAttribute('href', '/teachers/supervision')
    expect(within(tabs).queryByRole('link', { name: 'Certificates' })).not.toBeInTheDocument()
  })

  it('the super admin has the same pages under Admin > Teachers, without Statistics (that is Admin > Reports)', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'super_admin' }), route: '/admin/teachers/supervision' })
    const tabs = await screen.findByRole('navigation', { name: 'Teachers department' })
    expect(within(tabs).getByRole('link', { name: 'Teachers' })).toHaveAttribute('href', '/admin/teachers')
    expect(within(tabs).getByRole('link', { name: 'Supervision' })).toHaveAttribute('href', '/admin/teachers/supervision')
    expect(within(tabs).queryByRole('link', { name: 'Statistics' })).not.toBeInTheDocument()
  })
})

describe('leave requests', () => {
  it('approving unticked days sends only the ticked ones', async () => {
    on('GET', /\/teacher-leave-requests\?state=requested$/, () => json({ requests: [leave()] }))
    on('POST', /\/teacher-leave-requests\/r-1\/approve$/, () => json({ request: leave({ state: 'approved' }), cancelledLessons: 0, notCancelled: [] }))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/leave' })
    const row = (await screen.findByText('Family wedding')).closest('tr')!
    expect(within(row).getByText('Balance now: 21')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/3 day\(s\) will be deducted; balance after: 18/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: '11 Mar 2027' }))
    expect(within(dialog).getByText(/2 day\(s\) will be deducted; balance after: 19/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls('POST', /\/approve$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/approve$/)[0])).toEqual({ days: ['2027-03-10', '2027-03-12'] })
  })

  it('lessons inside the leave must be confirmed before anything is sent', async () => {
    on('GET', /\/teacher-leave-requests\?state=requested$/, () =>
      json({ requests: [leave({ collidingLessons: [{ id: 'les-1', startsAt: '2027-03-11T08:00:00Z', learnerName: 'Child Alpha' }] })] }),
    )
    on('POST', /\/teacher-leave-requests\/r-1\/approve$/, () => json({ request: leave({ state: 'approved' }), cancelledLessons: 1, notCancelled: [] }))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/leave' })
    const row = (await screen.findByText('Family wedding')).closest('tr')!
    expect(within(row).getByText('1 lesson(s) inside')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Child Alpha')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(within(dialog).getByText('Confirm the lessons first.')).toBeInTheDocument()
    expect(calls('POST', /\/approve$/)).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Cancel these lessons' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls('POST', /\/approve$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/approve$/)[0])).toEqual({ cancelCollidingLessons: true })
  })

  it('as Operations sends it: no balance anywhere, and another family\'s lesson is not named', async () => {
    on('GET', /\/teacher-leave-requests\?state=requested$/, () =>
      json({
        requests: [
          leave({
            balance: undefined,
            collidingLessons: [
              { id: 'les-1', startsAt: '2027-03-11T08:00:00Z', learnerName: 'Child Alpha' },
              { id: 'les-2', startsAt: '2027-03-12T08:00:00Z', learnerName: null },
            ],
          }),
        ],
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/leave' })
    const row = (await screen.findByText('Family wedding')).closest('tr')!
    expect(within(row).queryByText(/Balance now/)).not.toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/3 day\(s\) will be deducted from the teacher’s leave/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/balance after|No allowance set/)).not.toBeInTheDocument()
    expect(within(dialog).getByText('Child Alpha')).toBeInTheDocument()
    expect(within(dialog).getByText(/Another family’s lesson/)).toBeInTheDocument()
  })

  it('an approved leave can be cancelled, with a reason', async () => {
    on('GET', /\/teacher-leave-requests\?state=requested$/, () => json({ requests: [] }))
    on('GET', /\/teacher-leave-requests\?state=approved$/, () => json({ requests: [leave({ state: 'approved', balance: undefined, collidingLessons: undefined })] }))
    on('POST', /\/teacher-leave-requests\/r-1\/cancel$/, () => json({ request: leave({ state: 'cancelled' }), daysReturned: 3 }))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/leave' })
    await screen.findByText('No leave requests here.')
    await userEvent.click(screen.getByRole('button', { name: 'Approved' }))
    const row = (await screen.findByText('Family wedding')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Cancel leave' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Reason (the teacher sees it)'), 'Plans changed')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel leave' }))
    await waitFor(() => expect(calls('POST', /\/cancel$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/cancel$/)[0])).toEqual({ note: 'Plans changed' })
  })
})

describe('the Teacher File leave section', () => {
  const fileOf = (canEditPersonal: boolean) => ({
    access: { canEditPersonal, canWriteSupervision: true },
    teacher: { id: 't-1', name: 'Teacher One', isActive: true, leftAt: null },
    personal: { fullName: 'Teacher One', phone: null, email: null, joinedOn: null, updatedAt: null, updatedBy: null },
    assignedStudents: [],
    supervision: { complaints: [], monthlyComments: [], daysOff: [] },
  })
  const leaveOf: TeacherLeave = {
    year: 2026,
    allowance: 21,
    used: 4,
    balance: 17,
    requests: [leave({ state: 'approved', firstDay: '2026-11-02', lastDay: '2026-11-05', days: 4 })],
    allowanceHistory: [],
  }

  it('shows the computed balance; only the manager may set the allowance', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(fileOf(false)))
    on('GET', /\/teacher-files\/t-1\/leave$/, () => json(leaveOf))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1' })
    const section = await screen.findByRole('region', { name: 'Leave' })
    expect(within(section).getByText('21')).toBeInTheDocument()
    expect(within(section).getByText('17')).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Set allowance' })).not.toBeInTheDocument()
  })

  it('the manager sets it for the year shown', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(fileOf(true)))
    on('GET', /\/teacher-files\/t-1\/leave$/, () => json(leaveOf))
    on('POST', /\/teacher-files\/t-1\/leave-allowance$/, () => json({ ...leaveOf, allowance: 25, balance: 21 }))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'm-1', role: 'manager' }), route: '/teachers/files/t-1' })
    const section = await screen.findByRole('region', { name: 'Leave' })
    await userEvent.click(within(section).getByRole('button', { name: 'Set allowance' }))
    const dialog = await screen.findByRole('dialog')
    const days = within(dialog).getByLabelText('Days')
    await userEvent.clear(days)
    await userEvent.type(days, '400')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('A whole number from 0 to 366.')).toBeInTheDocument()
    await userEvent.clear(days)
    await userEvent.type(days, '25')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/leave-allowance$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/leave-allowance$/)[0])).toEqual({ year: 2026, days: 25 })
  })

  it('opens the supervision chat in the operator chat', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(fileOf(false)))
    on('POST', /\/teachers\/t-1\/supervision-conversation$/, () => json({ conversationId: 'conv-9' }))
    on('GET', /\/conversations/, () => json([]))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Supervision chat' }))
    await waitFor(() => expect(calls('POST', /\/supervision-conversation$/)).toHaveLength(1))
  })
})
