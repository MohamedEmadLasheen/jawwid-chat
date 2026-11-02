import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { destinationsFor, entriesOf } from '@/app/navigation'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { chooseOption } from '@/test/select'
import type { Violation } from '@/features/discipline/api'
import type { SupervisedComplaint } from '@/features/teacher-supervision/api'
import type { TeacherRecordsAccess, TeacherSummary } from './api'

/**
 * PD-52 PR-5, the two pages as Sales sees them (plan §5.4, owner §11 b): the
 * trials it reads and the families it owns -- trial lateness, complaints,
 * testimonials, grants without an amount -- and never a decision, a step,
 * leave, an amount or a row about the teacher alone. The server decides each
 * request (apps/api test/integration/pd052-sales.spec.ts); these prove the
 * pages offer no more than it allows. Synthetic people only.
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

const salesStaff = makeStaff({ id: 'sa-1', name: 'Sales One', role: 'admin' })
const SALES: TeacherRecordsAccess = {
  basis: 'sales',
  attendance: { view: true, record: true, decide: false },
  grants: { view: true, record: true },
  leaveBalance: false,
  amounts: false,
  opensFile: false,
}

const trialLate: Violation = {
  id: 'v-1',
  kind: 'late',
  teacher: { id: 't-1', name: 'Teacher One' },
  lesson: { id: 'l-1', kind: 'trial', startsAt: '2026-10-30T16:00:00Z', learnerName: null, note: null },
  occurredAt: '2026-10-30T16:00:00Z',
  month: '2026-10',
  lateMinutes: 20,
  note: null,
  recordedBy: { id: 'sa-1', name: 'Sales One' },
  step: null,
  suggestedDecision: null,
  decision: null,
  decisionNote: null,
  decidedBy: null,
  decidedAt: null,
  suspension: null,
}

const complaint: SupervisedComplaint = {
  id: 'c-1',
  body: 'The trial started late.',
  createdAt: '2026-10-30T17:00:00Z',
  author: { id: 'sa-1', name: 'Sales One' },
  source: null,
  resolution: null,
  from: 'parent',
  handledBy: null,
  followUps: [],
  action: null,
  status: 'open',
  teacher: { id: 't-1', name: 'Teacher One' },
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
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: true, operations: false, calendar: false, supervisionPage: false }))
  on('GET', /\/teacher-records\/access$/, () => json(SALES))
  on('GET', /\/teacher-supervision\/directory$/, () =>
    json({
      basis: 'sales',
      access: { canWriteSupervision: true, canViewFinance: false },
      teachers: [{ id: 't-1', name: 'Teacher One', isActive: true, away: null, operationsOnly: true }],
      supervisors: [],
      familyChats: [],
    }),
  )
  on('GET', /\/teacher-records\/teachers\/t-1\/students$/, () =>
    json({ students: [{ id: 'k-1', name: 'Child One', familyId: 'f-1' }], trials: [{ id: 'p-1', name: 'Prospect Huda' }] }),
  )
  on('GET', /\/discipline\/violations\?state=open&kind=late$/, () => json({ violations: [trialLate] }))
  on('GET', /\/discipline\/violations\?state=open&kind=complaints$/, () => json({ violations: [] }))
  on('GET', /\/teacher-files\/complaints/, () => json({ access: { canEditPersonal: false, canWriteSupervision: true, canViewFinance: false }, complaints: [complaint] }))
  on('GET', /\/teacher-files\/rewards/, () => json({ canViewAmounts: false, rewards: [] }))
  on('GET', /\/teacher-records\/testimonials/, () => json({ canRecord: true, testimonials: [] }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('PD-52 PR-5: Sales on Attendance & complaints', () => {
  it('is offered Lateness and Complaints only -- no leave, no excuses -- and a leave link lands on Lateness', async () => {
    renderWithProviders(<AppRoutes />, { staff: salesStaff, route: '/teacher-attendance?section=leave' })
    expect(await screen.findByRole('button', { name: 'Lateness', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complaints' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excuses & absences' })).not.toBeInTheDocument()
    expect(calls('GET', /\/teacher-leave/)).toHaveLength(0)
  })

  it('reads trial lateness without a step or a Decide button, and only trials', async () => {
    renderWithProviders(<AppRoutes />, { staff: salesStaff, route: '/teacher-attendance?section=lateness' })
    const row = (await screen.findByText('Teacher One', { selector: 'td' })).closest('tr')!
    expect(within(row).getByText('20 min')).toBeInTheDocument()
    expect(within(row).queryByText(/^Step/)).not.toBeInTheDocument()
    expect(within(row).queryByText(/Suggested/)).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Decide' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Regular lessons' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record lateness' })).toBeInTheDocument()
  })

  it('complaints: follow up, never uphold or resolve; a new one names its student or trial and no handler', async () => {
    on('POST', /\/teacher-files\/t-1\/entries$/, () => json({ id: 'c-2', kind: 'complaint', createdAt: '2026-11-02T09:00:00Z' }, 201))
    renderWithProviders(<AppRoutes />, { staff: salesStaff, route: '/teacher-attendance?section=complaints' })
    const item = (await screen.findByText('The trial started late.')).closest('li')!
    expect(within(item).getByRole('button', { name: 'Add a follow-up' })).toBeInTheDocument()
    for (const name of ['Uphold', 'Resolve', 'Take it']) expect(within(item).queryByRole('button', { name })).not.toBeInTheDocument()
    // The parents' suggestions are not Sales'.
    expect(screen.queryByRole('button', { name: 'Suggestions' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Record a complaint' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('combobox', { name: 'Handled by' })).not.toBeInTheDocument()
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Teacher' }), 't-1')
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Source' }), 'parent')
    await userEvent.type(within(dialog).getByRole('textbox'), 'Camera off.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(calls('POST', /\/entries$/)).toHaveLength(0)
    expect(within(dialog).getByText('Required.')).toBeInTheDocument()
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Student or trial' }), 'prospect:p-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/teacher-files\/t-1\/entries$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/entries$/)[0])).toEqual({ kind: 'complaint', body: 'Camera off.', source: 'parent', prospectId: 'p-1' })
  })
})

describe('PD-52 PR-5: Sales on Grants & testimonials', () => {
  it('records a grant without an amount, naming its student', async () => {
    on('POST', /\/teachers\/t-1\/bonus$/, () => json({ id: 'b-1', kind: 'bonus', conversationId: 'cv-1' }, 201))
    renderWithProviders(<AppRoutes />, { staff: salesStaff, route: '/teacher-grants' })
    await userEvent.click(await screen.findByRole('button', { name: 'Record a reward' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('textbox', { name: /Amount/ })).not.toBeInTheDocument()
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Teacher' }), 't-1')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Brought in three families')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a reward' }))
    expect(calls('POST', /\/bonus$/)).toHaveLength(0)
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Student or trial' }), 'learner:k-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a reward' }))
    await waitFor(() => expect(calls('POST', /\/teachers\/t-1\/bonus$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/bonus$/)[0])).toEqual({ reason: 'Brought in three families', learnerId: 'k-1' })
  })

  it('a testimonial must name its student or trial', async () => {
    on('POST', /\/teachers\/t-1\/testimonials$/, () => json({ id: 'ts-1', kind: 'testimonial', createdAt: '2026-11-02T09:00:00Z' }, 201))
    renderWithProviders(<AppRoutes />, { staff: salesStaff, route: '/teacher-grants?section=testimonials' })
    await userEvent.click(await screen.findByRole('button', { name: 'Record a testimonial' }))
    const dialog = await screen.findByRole('dialog')
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Teacher' }), 't-1')
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'How it reached us' }), 'parent_call')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'What was said' }), 'Thanks from the father.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a testimonial' }))
    expect(calls('POST', /\/testimonials$/)).toHaveLength(0)
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Student or trial' }), 'prospect:p-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a testimonial' }))
    await waitFor(() => expect(calls('POST', /\/teachers\/t-1\/testimonials$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/testimonials$/)[0])).toEqual({ body: 'Thanks from the father.', source: 'parent_call', prospectId: 'p-1' })
  })

  it('the strip shows no ladder and no leave status', async () => {
    const summary: TeacherSummary = {
      teacher: { id: 't-1', name: 'Teacher One', isActive: true },
      away: null,
      ladder: null,
      openComplaints: 1,
      year: '2026',
      grants: 1,
      testimonials: 2,
      opensFile: false,
    }
    on('GET', /\/teacher-records\/teachers\/t-1\/summary$/, () => json(summary))
    renderWithProviders(<AppRoutes />, { staff: salesStaff, route: '/teacher-grants?teacher=t-1' })
    const strip = await screen.findByRole('region', { name: 'Teacher One' })
    expect(within(strip).getByText('1 open complaints')).toBeInTheDocument()
    expect(within(strip).queryByText(/This month/)).not.toBeInTheDocument()
    expect(within(strip).queryByText('Available')).not.toBeInTheDocument()
  })

  it('both pages are in Sales\' navigation on the server\'s answer', () => {
    const paths = destinationsFor('admin', { sales: true, teacherAttendance: true, teacherGrants: true }).flatMap(entriesOf).map((e) => e.path)
    expect(paths).toEqual(expect.arrayContaining(['/teacher-attendance', '/teacher-grants']))
  })
})
