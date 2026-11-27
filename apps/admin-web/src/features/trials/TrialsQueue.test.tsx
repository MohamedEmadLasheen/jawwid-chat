import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { NewStudentDto, TrialDto } from './api'

/**
 * Trial lessons and New students as a request queue: the strip of counts that
 * filters, the queue, and the detail that stays beside it from 1100px (the side
 * sheet below). The flows themselves -- who is offered what, what each sends --
 * are proven in TrialsPages.test.tsx, which runs at the narrow width.
 * Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
type Handler = (url: string, init: RequestInit) => Response
let routes: Array<[string, RegExp, Handler]>
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([method, pattern, handler])

/** The width the layout asks about (jsdom has no matchMedia, which it reads as narrow). */
function viewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: wide, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

const trial = (id: string, name: string, over: Partial<TrialDto> = {}): TrialDto => ({
  id,
  prospect: { id: `p-${id}`, displayName: name, level: 'beginner' },
  students: [{ name, level: 'beginner', note: 'shy at first' }],
  teacher: { id: 't-1', name: 'Teacher One' },
  startsAt: '2026-10-17T15:00:00Z',
  endsAt: '2026-10-17T15:30:00Z',
  durationMinutes: 30,
  attendance: 'attended',
  report: { covered: 'letters 1-5', rating: 4, note: null },
  outcome: 'awaiting',
  ...over,
})

const TRIALS: TrialDto[] = [
  trial('tr-a', 'Prospect Alpha'),
  trial('tr-b', 'Prospect Beta', { attendance: 'awaiting', report: null }),
  trial('tr-c', 'Prospect Gamma', { outcome: 'subscribed', outcomeDetail: { reason: null, note: null, recordedAt: '2026-10-18T10:00:00Z', correctedAt: null } }),
  trial('tr-d', 'Prospect Delta', { outcome: 'not_subscribed', outcomeDetail: { reason: 'price', note: 'asked about a discount', recordedAt: '2026-10-18T10:00:00Z', correctedAt: null } }),
]

const family = (trialId: string, parent: string, enrolment: NewStudentDto['enrolment'] = null): NewStudentDto => ({
  trialId,
  prospectName: `Prospect of ${parent}`,
  trialTeacher: { id: 't-1', name: 'Teacher One' },
  trialAt: '2026-10-10T15:00:00Z',
  recordedAt: '2026-10-11T10:00:00Z',
  recordedBy: { id: 's-1', name: 'Sales One' },
  updatedAt: null,
  parent: { name: parent, email: null, phone: '+99 000 111' },
  children: [{ name: `Child of ${parent}`, age: 9, course: 'Course A', teacher: { id: 't-1', name: 'Teacher One' }, packagePrice: 1000, lessonPrice: 125, schedule: [{ weekday: 2, time: '16:00' }] }],
  payment: { currency: 'EGP', method: 'invoice' },
  enrolment,
})

const staff = makeStaff({ role: 'admin' })

beforeEach(() => {
  routes = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const method = (init.method ?? 'GET').toUpperCase()
      for (const [m, pattern, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
      return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
    }),
  )
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: true, operations: true }))
  on('GET', /\/trials(\?.*)?$/, () => json({ trials: TRIALS }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('Trial lessons: the strip of outcomes', () => {
  it('counts every outcome from the list the page loaded, and a click filters the queue', async () => {
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    await screen.findByText('Prospect Gamma')
    const strip = screen.getByRole('tablist', { name: 'Trials by outcome' })
    const count = (name: RegExp) => within(strip).getByRole('tab', { name }).querySelector('.ledger__value')?.textContent
    expect(count(/^All/)).toBe('4')
    expect(count(/^Upcoming/)).toBe('0')
    expect(count(/^Needs an outcome/)).toBe('2')
    expect(count(/^Subscribed/)).toBe('1')
    expect(count(/^Did not subscribe/)).toBe('1')
    expect(count(/^Did not attend/)).toBe('0')

    await userEvent.click(within(strip).getByRole('tab', { name: /^Did not subscribe/ }))
    expect(within(strip).getByRole('tab', { name: /^Did not subscribe/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Prospect Delta')).toBeInTheDocument()
    expect(screen.queryByText('Prospect Alpha')).not.toBeInTheDocument()
    // A state with nothing in it says so, in one line.
    await userEvent.click(within(strip).getByRole('tab', { name: /^Upcoming/ }))
    expect(screen.getByText('No trial is in this state.')).toBeInTheDocument()
  })

  it('shows no figure before the list has arrived, rather than a zero', () => {
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const strip = screen.getByRole('tablist', { name: 'Trials by outcome' })
    expect(within(strip).getByRole('tab', { name: 'All' })).toBeInTheDocument()
    expect(strip.querySelector('.ledger__value')).toBeNull()
  })
})

describe('Trial lessons: the detail of a trial', () => {
  it('below 1100px a row opens the side sheet: its steps, what was recorded and its actions', async () => {
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    await userEvent.click(await screen.findByRole('button', { name: 'Prospect Delta' }))
    const sheet = await screen.findByRole('dialog', { name: 'Prospect Delta' })
    const steps = within(within(sheet).getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
    expect(steps.map((li) => li.querySelector('.rq-step__label')?.textContent)).toEqual([
      'Booked (done)', 'Trial lesson (done)', "Teacher's report (done)", 'Outcome (done)',
    ])
    // The reason and the note stay with Sales: here, never in the group.
    expect(steps[3]).toHaveTextContent('Did not subscribe · Price')
    expect(steps[3]).toHaveTextContent('asked about a discount')
    expect(within(sheet).getByText('shy at first')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Correct outcome' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Trial group' })).toBeInTheDocument()
    // A recorded trial is past cancelling.
    expect(within(sheet).queryByRole('button', { name: 'Cancel trial' })).not.toBeInTheDocument()
  })

  it('from 1100px the panel stays beside the queue, on the first trial until another is picked', async () => {
    viewport(true)
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const panel = await screen.findByRole('complementary', { name: 'Trial details' })
    expect(within(panel).getByRole('heading', { name: 'Prospect Alpha' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Record outcome' })).toBeInTheDocument()
    expect(within(within(panel).getByRole('list', { name: 'Steps' })).getAllByRole('listitem').at(-1)).toHaveAttribute('aria-current', 'step')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const gamma = screen.getAllByRole('button', { name: 'Prospect Gamma' })[0]!
    await userEvent.click(gamma)
    expect(gamma).toHaveAttribute('aria-current', 'true')
    expect(within(panel).getByRole('heading', { name: 'Prospect Gamma' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Correct outcome' })).toBeInTheDocument()
    // A subscription leads on to New students.
    expect(within(panel).getByRole('link', { name: 'Open New students' })).toHaveAttribute('href', '/trials/new-students')

    // The panel's primary action is the same card the row opens.
    await userEvent.click(screen.getAllByRole('button', { name: 'Prospect Alpha' })[0]!)
    await userEvent.click(within(panel).getByRole('button', { name: 'Record outcome' }))
    expect(await screen.findByRole('dialog', { name: 'Trial' })).toBeInTheDocument()
  })

  it('cancelling asks for its reason from the end of the detail, and sends it', async () => {
    viewport(true)
    const sent: unknown[] = []
    on('POST', /\/trials\/tr-b\/cancel$/, (_u, init) => {
      sent.push(JSON.parse(String(init.body)))
      return json(trial('tr-b', 'Prospect Beta', { outcome: 'cancelled', attendance: 'admin_cancelled' }), 201)
    })
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const panel = await screen.findByRole('complementary', { name: 'Trial details' })
    // Only a trial whose lesson has no attendance yet can still be called off.
    expect(within(panel).queryByRole('button', { name: 'Cancel trial' })).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Prospect Beta' })[0]!)
    await userEvent.click(within(panel).getByRole('button', { name: 'Cancel trial' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cancel trial' })
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'the family asked to move it')
    await userEvent.click(within(dialog).getAllByRole('button').at(-1)!)
    await waitFor(() => expect(sent).toEqual([{ reason: 'the family asked to move it' }]))
  })
})

describe('New students: the queue beside the family', () => {
  const WAITING: NewStudentDto['enrolment'] = {
    familyId: 'f-2', learnerIds: ['k-2'], supervisor: { id: 'sup-1', name: 'Supervisor One' }, assignedAt: '2026-10-21T08:00:00Z',
    groupConversationId: 'c-2', canCreateGroup: false, parentSignup: { state: 'code_waiting', code: '482913', issuedAt: '2026-10-21T08:00:00Z' },
  }

  it('from 1100px the families are a queue and the open family\'s record is the panel', async () => {
    viewport(true)
    on('GET', /\/trials\/new-students$/, () => json({ students: [family('tr-1', 'Parent Delta'), family('tr-2', 'Parent Echo', WAITING)], canAssign: true }))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    const panel = await screen.findByRole('complementary', { name: 'Family details' })
    // The first family is open; the other is one row away.
    const card = within(panel).getByRole('heading', { name: 'Parent Delta' }).closest('article')!
    expect(within(card).getByRole('button', { name: 'Assign' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Parent Echo' })).not.toBeInTheDocument()
    const echo = (screen.getByRole('button', { name: 'Parent Echo' })).closest('tr')!
    expect(within(echo).getByText('Supervisor One')).toBeInTheDocument()
    expect(within(echo).getByText('Waiting for the parent')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Parent Echo' }))
    const open = within(panel).getByRole('heading', { name: 'Parent Echo' }).closest('article')!
    // Its steps carry the code to relay and the group to open.
    expect(within(open).getByText('482913')).toBeInTheDocument()
    expect(within(open).getByRole('button', { name: 'Open group' })).toBeInTheDocument()
    expect(within(open).getByRole('button', { name: 'Change' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Parent Delta' })).not.toBeInTheDocument()
  })

  it('the open family follows the filter: when it is filtered out, the first one left is shown', async () => {
    viewport(true)
    on('GET', /\/trials\/new-students$/, () => json({ students: [family('tr-1', 'Parent Delta'), family('tr-2', 'Parent Echo', WAITING)], canAssign: false }))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    const panel = await screen.findByRole('complementary', { name: 'Family details' })
    expect(within(panel).getByRole('heading', { name: 'Parent Delta' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Waiting for the parent/ }))
    expect(within(panel).getByRole('heading', { name: 'Parent Echo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Parent Delta' })).not.toBeInTheDocument()
  })

  it('with nothing recorded the page says one thing: what will be here, and where to go', async () => {
    on('GET', /\/trials\/new-students$/, () => json({ students: [], canAssign: true }))
    on('GET', /\/family-intake\/entered$/, () => json({ viewer: 'operations_manager', canAssignSupervisor: true, families: [] }))
    const { container } = renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    expect(await screen.findByText('No subscriptions recorded yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Trial lessons' })).toHaveAttribute('href', '/trials')
    // No second empty section under it, and no strip of zeros over it.
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => /\/family-intake\/entered$/.test(String(u)))).toBe(true))
    expect(screen.queryByRole('region', { name: 'Families entered by hand' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('.state')).toHaveLength(1)
    expect(container.querySelector('.rq-strip')).toBeNull()
  })

  it('below 1100px every family\'s record is listed in full, with no panel', async () => {
    on('GET', /\/trials\/new-students$/, () => json({ students: [family('tr-1', 'Parent Delta'), family('tr-2', 'Parent Echo', WAITING)], canAssign: true }))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    expect(await screen.findByRole('heading', { name: 'Parent Delta' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Parent Echo' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Family details' })).not.toBeInTheDocument()
  })
})
