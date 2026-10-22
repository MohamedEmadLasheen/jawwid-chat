import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { Violation } from '@/features/discipline/api'
import type { LeaveOverviewRow, SupervisedComplaint } from './api'

/**
 * PD-24 Teacher Supervision page, through the real routes and the real API
 * client, with `fetch` answered at the network boundary. These prove the
 * page's side: what each section shows and what each button sends. What the
 * server does with it -- the ladder, the automatic deduction, the away rule --
 * is proven in apps/api test/integration/pd024-teacher-supervision.spec.ts.
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
    on('POST', /\/teachers\/t-1\/bonus$/, () => json({ id: 'b-9', kind: 'bonus', conversationId: 'x' }, 201))
    on('POST', /\/teacher-files\/t-1\/finance\/adjustments$/, () => json({ id: 'a-1', kind: 'bonus', month: '2026-10', amount: '250.00', currency: 'EGP' }, 201))
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
    await waitFor(() => expect(calls('POST', /\/finance\/adjustments$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/bonus$/)[0])).toEqual({ reason: 'Helped a new teacher' })
    expect(bodyOf(calls('POST', /\/finance\/adjustments$/)[0])).toEqual({ kind: 'bonus', bonusEntryId: 'b-9', amount: '250', reason: 'Helped a new teacher' })
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
