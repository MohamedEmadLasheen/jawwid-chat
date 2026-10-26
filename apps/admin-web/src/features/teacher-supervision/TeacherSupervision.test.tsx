import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { Violation } from '@/features/discipline/api'
import type { LeaveOverviewRow, StaffFeedback, SupervisedComplaint } from './api'

/**
 * PD-26 Teacher Supervision page, through the real routes and the real API
 * client, with `fetch` answered at the network boundary. These prove the
 * page's side: what each section shows and what each button sends. What the
 * server does with it -- the ladder, the automatic deduction, the away rule --
 * is proven in apps/api test/integration/pd026-teacher-supervision.spec.ts.
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

const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })
const roster = { teachers: [{ id: 't-1', name: 'Teacher One', isActive: true, timezone: null }], learners: [] }
const access = { canEditPersonal: false, canWriteSupervision: true, canViewFinance: false }

function violation(over: Partial<Violation> = {}): Violation {
  return {
    id: 'v-1',
    kind: 'absence',
    teacher: { id: 't-1', name: 'Teacher One' },
    lesson: null,
    occurredAt: '2026-10-15T00:00:00Z',
    month: '2026-10',
    lateMinutes: null,
    note: 'Missed the staff meeting',
    recordedBy: { id: 's-1', name: 'Supervisor One' },
    step: 1,
    suggestedDecision: 'warning',
    decision: null,
    decisionNote: null,
    decidedBy: null,
    decidedAt: null,
    suspension: null,
    ...over,
  }
}

function complaint(over: Partial<SupervisedComplaint> = {}): SupervisedComplaint {
  return {
    id: 'c-1',
    body: 'The lesson started twenty minutes late.',
    createdAt: '2026-10-16T09:00:00Z',
    author: { id: 's-1', name: 'Supervisor One' },
    source: null,
    resolution: null,
    from: 'parent',
    handledBy: { id: 's-1', name: 'Supervisor One' },
    followUps: [],
    action: null,
    status: 'open',
    teacher: { id: 't-1', name: 'Teacher One' },
    ...over,
  }
}

function feedback(over: Partial<StaffFeedback> = {}): StaffFeedback {
  return {
    id: 'pf-1',
    familyId: 'f-1',
    parent: { id: 'p-1', name: 'Parent Alpha' },
    child: { id: 'k-1', name: 'Child One' },
    teacher: { id: 't-1', name: 'Teacher One' },
    category: 'praise',
    body: 'The teacher is patient and kind.',
    status: 'received',
    response: null,
    respondedBy: null,
    respondedAt: null,
    createdAt: '2026-10-25T09:00:00Z',
    complaint: null,
    ...over,
  }
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
  on('GET', /\/lessons\/roster$/, () => json(roster))
  on('GET', /\/teacher-files$/, () =>
    json({ access, teachers: [{ id: 't-1', name: 'Teacher One', isActive: true, studentCount: 3, openComplaints: 1, away: null }], supervisors: [{ id: 's-2', name: 'Supervisor Two' }] }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('1. leave', () => {
  it('shows each teacher\'s balance -- or that it is not tracked -- and who is on leave until when', async () => {
    const rows: LeaveOverviewRow[] = [
      { id: 't-1', name: 'Teacher One', isActive: true, allowance: null, used: 3, balance: null, pendingRequests: 0, away: { kind: 'leave', until: '2026-10-25' } },
      { id: 't-2', name: 'Teacher Two', isActive: true, allowance: 21, used: 5, balance: 16, pendingRequests: 2, away: null },
    ]
    on('GET', /\/teacher-leave-overview$/, () => json({ year: 2026, teachers: rows }))
    on('GET', /\/teacher-leave-requests\?state=requested$/, () => json({ requests: [] }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision' })
    const one = (await screen.findByRole('link', { name: 'Teacher One' })).closest('tr')!
    expect(within(one).getByText('Not tracked (3 days taken)')).toBeInTheDocument()
    expect(within(one).getByText(/^On leave until .*2026/)).toBeInTheDocument()
    const two = screen.getByRole('link', { name: 'Teacher Two' }).closest('tr')!
    expect(within(two).getByText('16 of 21 days left')).toBeInTheDocument()
    expect(within(two).getByText('Available')).toBeInTheDocument()
    expect(within(two).getByText('2 waiting')).toBeInTheDocument()
    // The leave requests are on the same page.
    expect(screen.getByRole('heading', { name: 'Leave requests' })).toBeInTheDocument()
  })

  it('the old Leave requests link lands on this section', async () => {
    on('GET', /\/teacher-leave-overview$/, () => json({ year: 2026, teachers: [] }))
    on('GET', /\/teacher-leave-requests\?state=requested$/, () => json({ requests: [] }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/leave' })
    expect(await screen.findByRole('button', { name: 'Leave', pressed: true })).toBeInTheDocument()
  })
})

describe('2. apologies and absences', () => {
  it('lists an absence with no lesson, who recorded it, and records a new one', async () => {
    on('GET', /\/discipline\/violations\?state=open&kind=absences$/, () => json({ violations: [violation()] }))
    on('POST', /\/teachers\/t-1\/absences$/, () => json({ violation: violation({ id: 'v-2' }) }, 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=absences' })
    const row = (await screen.findByText('Missed the staff meeting')).closest('tr')!
    expect(within(row).getByText('Absent')).toBeInTheDocument()
    expect(within(row).getByText('Recorded by Supervisor One')).toBeInTheDocument()
    expect(within(row).getByText('Suggested: Warning')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Record an absence' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    expect(calls('POST', /\/absences$/)).toHaveLength(0)
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Teacher' }), 't-1')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'What happened' }), 'Did not come to the shift')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls('POST', /\/absences$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/absences$/)[0])).toEqual({ occurredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), note: 'Did not come to the shift' })
  })
})

describe('3. lateness', () => {
  it('splits trial and regular lessons, with the delay, and records lateness on a trial', async () => {
    const lesson = (id: string, kind: 'trial' | 'regular', learnerName: string) => ({ id, kind, startsAt: '2026-10-15T16:00:00Z', learnerName, note: null })
    on('GET', /\/discipline\/violations\?state=open&kind=late$/, () =>
      json({
        violations: [
          violation({ id: 'v-r', kind: 'late', lateMinutes: 12, lesson: lesson('l-1', 'regular', 'Child Alpha'), note: null, recordedBy: null }),
          violation({ id: 'v-t', kind: 'late', lateMinutes: 25, lesson: lesson('l-2', 'trial', 'Prospect Beta'), note: null, recordedBy: null }),
        ],
      }),
    )
    on('GET', /\/trials\?/, () =>
      json({
        trials: [
          { id: 'tr-1', prospect: { id: 'p-1', displayName: 'Prospect Beta', level: null }, students: [], teacher: { id: 't-1', name: 'Teacher One' }, startsAt: '2026-10-18T16:00:00Z', endsAt: '2026-10-18T16:30:00Z', durationMinutes: 30, attendance: 'attended', report: null, outcome: 'awaiting' },
          { id: 'tr-2', prospect: { id: 'p-2', displayName: 'Prospect Gamma', level: null }, students: [], teacher: { id: 't-1', name: 'Teacher One' }, startsAt: '2026-10-19T16:00:00Z', endsAt: '2026-10-19T16:30:00Z', durationMinutes: 30, attendance: 'no_show', report: null, outcome: 'no_show' },
        ],
      }),
    )
    on('POST', /\/lessons\/tr-1\/lateness$/, () => json({ violation: violation({ kind: 'late' }) }, 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=lateness' })
    const regular = (await screen.findByText('Child Alpha', { exact: false })).closest('tr')!
    expect(within(regular).getByText('12 min')).toBeInTheDocument()
    expect(screen.queryByText('Prospect Beta', { exact: false })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Trial lessons' }))
    const trial = (await screen.findByText('Prospect Beta', { exact: false })).closest('tr')!
    expect(within(trial).getByText('25 min')).toBeInTheDocument()
    expect(within(trial).getByText('Trial')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Record lateness' }))
    const dialog = await screen.findByRole('dialog', { name: /Trial/ })
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Teacher' }), 't-1')
    const select = await within(dialog).findByRole('combobox', { name: 'Lesson' })
    // Only the attended trial is offered.
    expect(within(select).getAllByRole('option')).toHaveLength(2)
    await userEvent.selectOptions(select, 'tr-1')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Minutes late' }), '25')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls('POST', /\/lateness$/)).toHaveLength(1))
  })
})

describe('4. grants and rewards', () => {
  const reward = { id: 'b-1', teacher: { id: 't-1', name: 'Teacher One' }, reason: 'Ten perfect reports', recordedAt: '2026-10-16T09:00:00Z', recordedBy: { id: 's-1', name: 'Supervisor One' } }

  it('the super admin sees amounts, records a reward with its amount, and sets the default deductions', async () => {
    on('GET', /\/teacher-files\/rewards$/, () => json({ canViewAmounts: true, rewards: [{ ...reward, amount: { amount: '300.00', currency: 'EGP', month: '2026-10' } }, { ...reward, id: 'b-2', reason: 'Covered a class', amount: null }] }))
    on('GET', /\/teacher-files\/finance\/deduction-defaults$/, () => json({ currencies: ['EGP'], defaults: [] }))
    on('POST', /\/teacher-files\/finance\/deduction-defaults$/, () =>
      json({ currencies: ['EGP'], defaults: [{ kind: 'deduction_1', currency: 'EGP', amount: '150.00', setAt: '2026-10-22T09:00:00Z', setBy: { id: 'a', name: 'Admin' } }] }),
    )
    on('POST', /\/teacher-files\/t-1\/rewards$/, () =>
      json({ id: 'b-9', kind: 'bonus', amount: { amount: '250.00', currency: 'EGP', month: '2026-10' } }, 201),
    )
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'super_admin' }), route: '/admin/teachers/supervision?section=rewards' })
    const priced = (await screen.findByText('Ten perfect reports')).closest('tr')!
    expect(within(priced).getByText(/300\.00/)).toBeInTheDocument()
    expect(within(screen.getByText('Covered a class').closest('tr')!).getByText('Amount not set yet')).toBeInTheDocument()

    const defaults = await screen.findByRole('region', { name: 'Default deduction amounts' })
    await userEvent.type(within(defaults).getByRole('textbox', { name: 'First deduction EGP' }), '150')
    await userEvent.click(within(defaults).getAllByRole('button', { name: 'Set' })[0]!)
    await waitFor(() => expect(calls('POST', /\/deduction-defaults$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/deduction-defaults$/)[0])).toEqual({ kind: 'deduction_1', currency: 'EGP', amount: '150' })

    await userEvent.click(screen.getByRole('button', { name: 'Record a reward' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Teacher' }), 't-1')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Helped a new teacher')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Amount/ }), '250')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a reward' }))
    // PD-26 amendment: ONE request records the bonus and its amount together.
    await waitFor(() => expect(calls('POST', /\/rewards$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/rewards$/)[0])).toEqual({ reason: 'Helped a new teacher', amount: '250' })
    expect(calls('POST', /\/bonus$/)).toHaveLength(0)
    expect(calls('POST', /\/adjustments$/)).toHaveLength(0)
  })

  it('a refused amount records nothing, and says so', async () => {
    on('GET', /\/teacher-files\/rewards$/, () => json({ canViewAmounts: true, rewards: [] }))
    on('GET', /\/teacher-files\/finance\/deduction-defaults$/, () => json({ currencies: [], defaults: [] }))
    on('POST', /\/teacher-files\/t-1\/rewards$/, () =>
      json({ error: { code: 'COMM.TEACHER_FILE_CONFLICT', message: "record this teacher's pay terms for 2026-10 first; the reward was not recorded" } }, 409),
    )
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'super_admin' }), route: '/admin/teachers/supervision?section=rewards' })
    await userEvent.click(await screen.findByRole('button', { name: 'Record a reward' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Teacher' }), 't-1')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Helped a new teacher')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Amount/ }), '250')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a reward' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/no pay terms for this month, so the reward was not recorded/)
    // No half-recorded reward: nothing else was sent, and the dialog does not claim the reward was saved.
    expect(calls('POST', /\/bonus$/)).toHaveLength(0)
    expect(within(dialog).queryByText(/The reward is recorded/)).not.toBeInTheDocument()
  })

  it('a supervisor records the reward without an amount and sees no amounts', async () => {
    on('GET', /\/teacher-files\/rewards$/, () => json({ canViewAmounts: false, rewards: [reward] }))
    on('POST', /\/teachers\/t-1\/bonus$/, () => json({ id: 'b-9', kind: 'bonus', conversationId: 'x' }, 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=rewards' })
    await screen.findByText('Ten perfect reports')
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Default deduction amounts' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Record a reward' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('textbox', { name: /Amount/ })).not.toBeInTheDocument()
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Teacher' }), 't-1')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Great month')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a reward' }))
    await waitFor(() => expect(calls('POST', /\/bonus$/)).toHaveLength(1))
    expect(calls('POST', /\/adjustments$/)).toHaveLength(0)
  })
})

describe('5. complaints', () => {
  it('filters by source, records one with its source and handler, and upholds an open one', async () => {
    on('GET', /\/teacher-files\/complaints$/, () => json({ access, complaints: [complaint(), complaint({ id: 'c-2', from: 'management', body: 'Missed the training.' })] }))
    on('GET', /\/teacher-files\/complaints\?from=parent$/, () => json({ access, complaints: [complaint()] }))
    on('GET', /\/discipline\/violations\?state=open&kind=complaints$/, () => json({ violations: [] }))
    on('POST', /\/discipline\/complaints\/c-1\/uphold$/, () => json({ violation: violation({ kind: 'complaint' }) }, 201))
    on('POST', /\/teacher-files\/t-1\/entries$/, () => json({ id: 'c-3', kind: 'complaint', createdAt: '2026-10-22T09:00:00Z' }, 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=complaints' })
    expect(await screen.findByText('Missed the training.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'From parents' }))
    await waitFor(() => expect(screen.queryByText('Missed the training.')).not.toBeInTheDocument())

    const item = screen.getByText('The lesson started twenty minutes late.').closest('li')!
    expect(within(item).getByText('From a parent')).toBeInTheDocument()
    expect(within(item).getByText('Handled by Supervisor One')).toBeInTheDocument()
    await userEvent.click(within(item).getByRole('button', { name: 'Uphold and act' }))
    const uphold = await screen.findByRole('dialog')
    await userEvent.click(within(uphold).getByRole('button', { name: 'Uphold and act' }))
    await waitFor(() => expect(calls('POST', /\/uphold$/)).toHaveLength(1))

    // A new complaint from the parents' tab starts as a parent's.
    await userEvent.click(screen.getByRole('button', { name: 'Record a complaint' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('combobox', { name: 'Source' })).toHaveValue('parent')
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Teacher' }), 't-1')
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Supervisor handling it' }), 's-2')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Details' }), 'Rude to the child.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/entries$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/entries$/)[0])).toEqual({ kind: 'complaint', body: 'Rude to the child.', source: 'parent', handledBy: 's-2' })
  })

  it('an upheld complaint is decided from here, and shows the action taken once decided', async () => {
    on('GET', /\/teacher-files\/complaints$/, () =>
      json({
        access,
        complaints: [
          complaint({ status: 'upheld', action: { violationId: 'v-c', decision: null, decidedAt: null } }),
          complaint({ id: 'c-2', body: 'Second one.', status: 'actioned', action: { violationId: 'v-d', decision: 'deduction_1', decidedAt: '2026-10-20T09:00:00Z' } }),
        ],
      }),
    )
    on('GET', /\/discipline\/violations\?state=open&kind=complaints$/, () =>
      json({ violations: [violation({ id: 'v-c', kind: 'complaint', step: 2, suggestedDecision: 'deduction_1', complaint: { id: 'c-1', body: 'x', from: 'parent', createdAt: '2026-10-16T09:00:00Z' } })] }),
    )
    on('POST', /\/discipline\/violations\/v-c\/decide$/, () => json({ violation: violation({ decision: 'deduction_1' }), cancelledLessons: 0, notCancelled: [] }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=complaints' })
    const actioned = (await screen.findByText('Second one.')).closest('li')!
    expect(within(actioned).getByText('Action taken: First deduction')).toBeInTheDocument()
    const upheld = screen.getByText('The lesson started twenty minutes late.').closest('li')!
    expect(within(upheld).getByText('Upheld — awaiting a decision')).toBeInTheDocument()
    await userEvent.click(within(upheld).getByRole('button', { name: 'Decide the action' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /First deduction/ })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls('POST', /\/decide$/)).toHaveLength(1))
  })
})

describe('5b. complaints from the parent app (PD-32)', () => {
  const appComplaint = (over: Partial<SupervisedComplaint> = {}) =>
    complaint({
      id: 'c-app',
      body: 'The teacher keeps ending the lesson early.',
      author: null,
      from: 'parent_app',
      handledBy: null,
      parentFeedback: {
        id: 'pf-9',
        familyId: 'f-1',
        parent: { id: 'p-1', name: 'Parent Alpha' },
        child: { id: 'k-1', name: 'Child One' },
        status: 'received',
        response: null,
        respondedAt: null,
      },
      ...over,
    })

  it('renders with no staff author, filters by the app source, is taken, and replies to the parent', async () => {
    let handled = false
    on('GET', /\/teacher-files\/complaints$/, () => json({ access, complaints: [complaint(), appComplaint()] }))
    on('GET', /\/teacher-files\/complaints\?from=parent_app$/, () =>
      json({
        access,
        complaints: [
          handled
            ? appComplaint({ handledBy: { id: 's-1', name: 'Supervisor One' }, parentFeedback: { ...appComplaint().parentFeedback!, status: 'in_review' } })
            : appComplaint(),
        ],
      }),
    )
    on('GET', /\/discipline\/violations\?state=open&kind=complaints$/, () => json({ violations: [] }))
    on('POST', /\/parent-feedback\/pf-9\/take$/, () => {
      handled = true
      return json(feedback({ id: 'pf-9', category: 'complaint', status: 'in_review' }))
    })
    on('POST', /\/parent-feedback\/pf-9\/reply$/, () => json(feedback({ id: 'pf-9', category: 'complaint', status: 'in_review', response: 'We are on it.' })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=complaints' })

    const item = (await screen.findByText('The teacher keeps ending the lesson early.')).closest('li')!
    expect(within(item).getByText('From the parent app · Parent Alpha about Child One')).toBeInTheDocument()
    expect(within(item).getByText('The parent sees:')).toBeInTheDocument()
    expect(within(item).getByText('Received')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Parent app' }))
    await waitFor(() => expect(screen.queryByText('The lesson started twenty minutes late.')).not.toBeInTheDocument())
    const app = screen.getByText('The teacher keeps ending the lesson early.').closest('li')!
    await userEvent.click(within(app).getByRole('button', { name: 'Take it' }))
    await waitFor(() => expect(calls('POST', /\/parent-feedback\/pf-9\/take$/)).toHaveLength(1))
    // Refreshed: the taker handles it now, so Take is gone.
    expect(await screen.findByText('Handled by Supervisor One')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take it' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Reply to parent' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reply to Parent Alpha' })
    expect(within(dialog).getByText(/only text the parent sees/)).toBeInTheDocument()
    // A complaint is resolved on the Teacher File, never from the reply.
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Your reply' }), 'We are on it.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(calls('POST', /\/reply$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/reply$/)[0])).toEqual({ response: 'We are on it.' })
  })

  it('offers no Take or Reply to a reader who cannot write', async () => {
    on('GET', /\/teacher-files\/complaints$/, () => json({ access: { ...access, canWriteSupervision: false }, complaints: [appComplaint()] }))
    on('GET', /\/discipline\/violations\?state=open&kind=complaints$/, () => json({ violations: [] }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=complaints' })
    await screen.findByText('The teacher keeps ending the lesson early.')
    expect(screen.queryByRole('button', { name: 'Take it' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reply to parent' })).not.toBeInTheDocument()
  })
})

describe('6. parent feedback (PD-32)', () => {
  it('lists every piece of feedback, filters by type and status, takes one and resolves praise with a reply', async () => {
    on('GET', /\/parent-feedback$/, () =>
      json({
        canWrite: true,
        feedback: [
          feedback(),
          feedback({ id: 'pf-2', category: 'suggestion', body: 'More homework, please.', status: 'resolved', response: 'Done.', respondedBy: { id: 's-1', name: 'Supervisor One' }, respondedAt: '2026-10-25T10:00:00Z' }),
          feedback({ id: 'pf-3', category: 'complaint', body: 'Ends early.', status: 'in_review', complaint: { entryId: 'c-app', handledBy: { id: 's-2', name: 'Supervisor Two' } } }),
        ],
      }),
    )
    on('GET', /\/parent-feedback\?category=praise$/, () => json({ canWrite: true, feedback: [feedback()] }))
    on('GET', /\/parent-feedback\?status=resolved&category=praise$/, () => json({ canWrite: true, feedback: [] }))
    on('POST', /\/parent-feedback\/pf-1\/take$/, () => json(feedback({ status: 'in_review' })))
    on('POST', /\/parent-feedback\/pf-1\/reply$/, () => json(feedback({ status: 'resolved', response: 'Thank you!' })))
    on('POST', /\/parent-feedback\/pf-3\/reply$/, () => json(feedback({ id: 'pf-3', category: 'complaint' })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=feedback' })

    expect(await screen.findByRole('button', { name: 'Parent feedback', pressed: true })).toBeInTheDocument()
    const praise = (await screen.findByText('The teacher is patient and kind.')).closest('li')!
    expect(within(praise).getByText('Praise')).toBeInTheDocument()
    expect(within(praise).getByText('Received')).toBeInTheDocument()
    expect(within(praise).getByText('Student: Child One')).toBeInTheDocument()
    expect(within(praise).getByText('Parent: Parent Alpha')).toBeInTheDocument()
    expect(within(praise).getByRole('link', { name: 'Teacher: Teacher One' })).toHaveAttribute('href', '/teachers/files/t-1')
    const suggestion = screen.getByText('More homework, please.').closest('li')!
    expect(within(suggestion).getByText('Done.')).toBeInTheDocument()
    expect(within(suggestion).queryByRole('button', { name: 'Take it' })).not.toBeInTheDocument()
    expect(within(suggestion).getByRole('button', { name: 'Change the reply' })).toBeInTheDocument()
    const complaintRow = screen.getByText('Ends early.').closest('li')!
    expect(within(complaintRow).getByText('Handled by Supervisor Two')).toBeInTheDocument()

    // The complaint's reply cannot resolve it: the dialog points at the Teacher File.
    await userEvent.click(within(complaintRow).getByRole('button', { name: 'Reply to parent' }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('checkbox', { name: /Mark resolved/ })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/resolved on the Teacher File/)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Open the teacher’s file' })).toHaveAttribute('href', '/teachers/files/t-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    // Filters reach the server.
    await userEvent.click(screen.getByRole('button', { name: 'Praise' }))
    await waitFor(() => expect(screen.queryByText('More homework, please.')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Resolved' }))
    expect(await screen.findByText('No feedback here.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Any status' }))

    const row = (await screen.findByText('The teacher is patient and kind.')).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Take it' }))
    await waitFor(() => expect(calls('POST', /\/pf-1\/take$/)).toHaveLength(1))

    await userEvent.click(within(row).getByRole('button', { name: 'Reply to parent' }))
    dialog = await screen.findByRole('dialog', { name: 'Reply to Parent Alpha' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send reply' }))
    expect(within(dialog).getByText('Write the reply first.')).toBeInTheDocument()
    expect(calls('POST', /\/reply$/)).toHaveLength(0)
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Your reply' }), 'Thank you!')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Mark resolved/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(calls('POST', /\/pf-1\/reply$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/pf-1\/reply$/)[0])).toEqual({ response: 'Thank you!', resolve: true })
  })

  it('a reader who cannot write sees the feedback without actions', async () => {
    on('GET', /\/parent-feedback$/, () => json({ canWrite: false, feedback: [feedback()] }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=feedback' })
    await screen.findByText('The teacher is patient and kind.')
    expect(screen.queryByRole('button', { name: 'Take it' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reply to parent' })).not.toBeInTheDocument()
  })

  it('a refusal is said plainly', async () => {
    on('GET', /\/parent-feedback$/, () => json({ error: { code: 'COMM.TEACHER_FILE_DENIED', message: 'denied' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=feedback' })
    expect(await screen.findByText('Teacher Files are for the Teachers department and the super admin.')).toBeInTheDocument()
  })

  it('reads in Arabic', async () => {
    on('GET', /\/parent-feedback$/, () => json({ canWrite: true, feedback: [feedback({ category: 'suggestion' })] }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=feedback', locale: 'ar' })
    const row = (await screen.findByText('The teacher is patient and kind.')).closest('li')!
    expect(within(row).getByText('اقتراح')).toBeInTheDocument()
    expect(within(row).getByText('مستلمة')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'الرد على ولي الأمر' })).toBeInTheDocument()
  })
})
