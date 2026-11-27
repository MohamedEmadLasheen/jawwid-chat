import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { NewStudentDto, TrialDto } from './api'

/**
 * Trial lessons as an agenda and New students as a board: the masthead figures
 * that filter, the groups and the columns, and the inspector that stays beside
 * them from 1100px (the side sheet below). The flows themselves -- who is
 * offered what, what each sends -- are proven in TrialsPages.test.tsx, which
 * runs at the narrow width.
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

describe('Trial lessons: the agenda', () => {
  const figure = (name: RegExp) => screen.getByRole('button', { name })
  const groups = () => [...document.querySelectorAll<HTMLElement>('.rq-group')]

  it('the masthead counts each part from the list the page loaded, and a figure filters the agenda', async () => {
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    await screen.findByText('Prospect Gamma')
    expect(figure(/^All/)).toHaveTextContent(/^All4$/)
    expect(figure(/^Needs an outcome/)).toHaveTextContent(/^Needs an outcome2oldest /)
    expect(figure(/^Upcoming/)).toHaveTextContent(/^Upcoming0$/)
    expect(figure(/^Recorded/)).toHaveTextContent(/^Recorded2$/)

    await userEvent.click(figure(/^Recorded/))
    expect(figure(/^Recorded/)).toHaveAttribute('aria-pressed', 'true')
    expect(figure(/^All/)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Prospect Delta')).toBeInTheDocument()
    expect(screen.queryByText('Prospect Alpha')).not.toBeInTheDocument()
    // A part with nothing in it says so, in one line.
    await userEvent.click(figure(/^Upcoming/))
    expect(screen.getByText('No trial is in this state.')).toBeInTheDocument()
  })

  it('shows no figure before the list has arrived, rather than a zero', () => {
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    for (const name of [/^All/, /^Needs an outcome/, /^Upcoming/, /^Recorded/]) expect(figure(name).querySelector('.figure__n')).toHaveTextContent(/^–$/)
  })

  it('is grouped by day: what needs an outcome first, then the days ahead by name, then what is recorded', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const later = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000)
    const upcoming = (id: string, name: string, at: Date) =>
      trial(id, name, { outcome: 'upcoming', attendance: 'upcoming', report: null, startsAt: at.toISOString(), endsAt: new Date(at.getTime() + 30 * 60 * 1000).toISOString() })
    on('GET', /\/trials(\?.*)?$/, () => json({ trials: [upcoming('tr-l', 'Prospect Later', later), ...TRIALS, upcoming('tr-t', 'Prospect Tomorrow', tomorrow)] }))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    await screen.findByText('Prospect Gamma')
    const day = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' }).format(later)
    expect(groups().map((g) => g.getAttribute('aria-label'))).toEqual(['Needs an outcome', 'Tomorrow', day, 'Recorded'])
    const [waiting, next, , recorded] = groups()
    // The longest wait leads, counted in solid terracotta: these have waited since before today.
    expect(within(waiting!).getAllByRole('listitem').map((li) => li.querySelector('.rq-open')?.textContent)).toEqual(['Prospect Alpha', 'Prospect Beta'])
    expect(waiting!.querySelector('.count')).toHaveClass('count--urgent')
    expect(within(next!).getByText('Prospect Tomorrow')).toBeInTheDocument()
    expect(next!.querySelector('.count')).not.toHaveClass('count--urgent')
    expect(within(recorded!).getAllByRole('listitem')).toHaveLength(2)
  })

  it('a row leads with its time and states one action by where the trial stands; the rest is behind "⋯"', async () => {
    const at = new Date(Date.now() + 24 * 60 * 60 * 1000)
    on('GET', /\/trials(\?.*)?$/, () =>
      json({ trials: [...TRIALS, trial('tr-t', 'Prospect Tomorrow', { outcome: 'upcoming', attendance: 'upcoming', report: null, startsAt: at.toISOString(), endsAt: at.toISOString() })] }))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const row = (name: string) => screen.getByText(name).closest('li')!
    await screen.findByText('Prospect Gamma')
    expect(row('Prospect Alpha').querySelector('.rq-row__lead time')).toHaveAttribute('datetime', '2026-10-17T15:00:00Z')
    const stated = (name: string) => [...row(name).querySelectorAll('.row-actions2 > .btn')].map((b) => b.textContent)
    expect(stated('Prospect Alpha')).toEqual(['Record outcome'])
    expect(stated('Prospect Gamma')).toEqual(['Correct outcome'])
    expect(stated('Prospect Tomorrow')).toEqual(['Edit'])
    // What ends a trial is last behind "⋯", and only while it can still be called off.
    await userEvent.click(within(row('Prospect Tomorrow')).getByRole('button', { name: 'More actions: Prospect Tomorrow' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Trial group', 'Cancel trial'])
    await userEvent.keyboard('{Escape}')
    await userEvent.click(within(row('Prospect Gamma')).getByRole('button', { name: 'More actions: Prospect Gamma' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Trial group'])
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
    expect(steps[3]).toHaveTextContent('Did not subscribe, Price')
    // The outcome's note leads the sheet, under where the trial stands.
    expect(sheet.querySelector('.rq-callout')).toHaveTextContent('Did not subscribe. The reason given: Price.')
    expect(sheet.querySelector('.rq-callout')).toHaveTextContent('asked about a discount')
    expect(within(sheet).getByText('shy at first')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Correct outcome' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Trial group' })).toBeInTheDocument()
    // A recorded trial is past cancelling: its foot has no "⋯" at all.
    expect(within(sheet).queryByRole('button', { name: 'Cancel trial' })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument()
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

  it('cancelling is behind the inspector\'s "⋯", asks for its reason, and sends it', async () => {
    viewport(true)
    const sent: unknown[] = []
    on('POST', /\/trials\/tr-b\/cancel$/, (_u, init) => {
      sent.push(JSON.parse(String(init.body)))
      return json(trial('tr-b', 'Prospect Beta', { outcome: 'cancelled', attendance: 'admin_cancelled' }), 201)
    })
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const panel = await screen.findByRole('complementary', { name: 'Trial details' })
    // Only a trial whose lesson has no attendance yet can still be called off.
    expect(within(panel).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Prospect Beta' })[0]!)
    // The foot states one action; what ends the trial is behind "⋯".
    expect(within(panel).getByRole('button', { name: 'Record outcome' })).toHaveClass('btn--primary')
    await userEvent.click(within(panel).getByRole('button', { name: 'More actions: Prospect Beta' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel trial' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cancel trial' })
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'the family asked to move it')
    await userEvent.click(within(dialog).getAllByRole('button').at(-1)!)
    await waitFor(() => expect(sent).toEqual([{ reason: 'the family asked to move it' }]))
  })
})

describe('New students: the board and the family beside it', () => {
  const WAITING: NewStudentDto['enrolment'] = {
    familyId: 'f-2', learnerIds: ['k-2'], supervisor: { id: 'sup-1', name: 'Supervisor One' }, assignedAt: '2026-10-21T08:00:00Z',
    groupConversationId: 'c-2', canCreateGroup: false, parentSignup: { state: 'code_waiting', code: '482913', issuedAt: '2026-10-21T08:00:00Z' },
  }

  it('from 1100px the families are a board in flow order, and the open family\'s record is the inspector', async () => {
    viewport(true)
    on('GET', /\/trials\/new-students$/, () => json({ students: [family('tr-2', 'Parent Echo', WAITING), family('tr-1', 'Parent Delta')], canAssign: true }))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    const panel = await screen.findByRole('complementary', { name: 'Family details' })
    const board = screen.getByRole('group', { name: 'Setup status' })
    expect(within(board).getAllByRole('region').map((c) => c.getAttribute('aria-label'))).toEqual(['Not assigned', 'Waiting for the parent', 'Parent signed up'])
    // A card: the family, its children, who looks after it, and the one next step.
    const delta = within(within(board).getByRole('region', { name: 'Not assigned' })).getByRole('heading', { name: 'Parent Delta' }).closest('article')!
    expect(within(delta).getByText('Child of Parent Delta')).toBeInTheDocument()
    expect(delta).toHaveTextContent(/needs a supervisor/)
    expect([...delta.querySelectorAll('.row-actions2 > .btn')].map((b) => b.textContent)).toEqual(['Assign supervisor'])
    const echo = within(within(board).getByRole('region', { name: 'Waiting for the parent' })).getByRole('heading', { name: 'Parent Echo' }).closest('article')!
    expect(within(echo).getByText('Supervisor One')).toBeInTheDocument()
    expect([...echo.querySelectorAll('.row-actions2 > .btn')].map((b) => b.textContent)).toEqual(['Show code'])
    // An empty stage keeps its column.
    expect(within(within(board).getByRole('region', { name: 'Parent signed up' })).getByText('No family at this stage.')).toBeInTheDocument()

    // The first family in flow order is open, with the step it is at as the foot's one action.
    expect(within(panel).getByRole('heading', { name: 'Parent Delta' })).toBeInTheDocument()
    expect(delta).toHaveAttribute('data-selected', 'true')
    expect(within(panel).getByRole('button', { name: 'Assign' })).toHaveClass('btn--primary')

    await userEvent.click(within(echo).getByRole('button', { name: 'Show code' }))
    expect(within(panel).getByRole('heading', { name: 'Parent Echo' })).toBeInTheDocument()
    // Its steps carry the code to relay and the group to open.
    expect(within(panel).getByText('482913')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Open group' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Change' })).toBeInTheDocument()
    expect(within(panel).queryByRole('heading', { name: 'Parent Delta' })).not.toBeInTheDocument()
  })

  it('a card\'s next step is taken where it stands: "Assign supervisor" opens the family and the dialog at once', async () => {
    viewport(true)
    on('GET', /\/trials\/new-students$/, () => json({ students: [family('tr-2', 'Parent Echo', WAITING), family('tr-1', 'Parent Delta'), family('tr-3', 'Parent Foxtrot')], canAssign: true }))
    on('GET', /\/org\/structure$/, () => json({ departments: [] }))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    const panel = await screen.findByRole('complementary', { name: 'Family details' })
    const card = screen.getByRole('heading', { name: 'Parent Foxtrot', level: 3 }).closest('article')!
    await userEvent.click(within(card).getByRole('button', { name: 'Assign supervisor' }))
    expect(within(panel).getByRole('heading', { name: 'Parent Foxtrot' })).toBeInTheDocument()
    expect(await screen.findByRole('dialog', { name: /Assign a supervisor/ })).toBeInTheDocument()
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
    // One stage in view is one column.
    expect(within(screen.getByRole('group', { name: 'Setup status' })).getAllByRole('region')).toHaveLength(1)
  })

  it('with nothing recorded the page says one thing: what will be here, and where to go', async () => {
    on('GET', /\/trials\/new-students$/, () => json({ students: [], canAssign: true }))
    on('GET', /\/family-intake\/entered$/, () => json({ viewer: 'operations_manager', canAssignSupervisor: true, families: [] }))
    const { container } = renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    expect(await screen.findByText('No subscriptions recorded yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Trial lessons' })).toHaveAttribute('href', '/trials')
    // No second empty section under it, and no figures of zeros or empty board around it.
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => /\/family-intake\/entered$/.test(String(u)))).toBe(true))
    expect(screen.queryByRole('region', { name: 'Families entered by hand' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('.state')).toHaveLength(1)
    expect(container.querySelector('.figures')).toBeNull()
    expect(container.querySelector('.rq-board')).toBeNull()
  })

  it('below 1100px the stages are a list of cards under the masthead\'s figures, and a card opens the side sheet', async () => {
    on('GET', /\/trials\/new-students$/, () => json({ students: [family('tr-1', 'Parent Delta'), family('tr-2', 'Parent Echo', WAITING)], canAssign: true }))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    expect(await screen.findByRole('heading', { name: 'Parent Delta' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Parent Echo' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Family details' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The figures are the stage switch: no second row of tabs under them.
    expect(screen.queryByRole('group', { name: 'Setup status' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Waiting for the parent/ }))
    expect(screen.queryByRole('heading', { name: 'Parent Delta' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Parent Echo' }))
    const sheet = await screen.findByRole('dialog', { name: 'Parent Echo' })
    expect(within(sheet).getByText('482913')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Open group' })).toBeInTheDocument()
  })
})
