import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { NewStudentDto, TrialDto, TrialGroupContextDto } from './api'
import { TrialCardDialog, TrialGroupBar } from './TrialCardDialog'

/**
 * PD-11 T4 and the trial journey's Admin Web through the real routes and API
 * client, with `fetch` answered at the network boundary: who is offered which
 * control, the exact request each sends, and what the group will read. What the
 * server allows is proven in lessons-trials.spec.ts and trial-journey.spec.ts.
 * Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response
let routes: Array<[string, RegExp, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([method, pattern, handler])
const sent = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls
    .filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
    .map(([, i]) => JSON.parse(String((i as RequestInit).body ?? '{}')) as Record<string, unknown>)

const trial = (id: string, over: Partial<TrialDto> = {}): TrialDto => ({
  id,
  prospect: { id: 'p-1', displayName: 'Prospect Alpha', level: 'beginner' },
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
  trial('tr-pending'),
  trial('tr-awaiting', { prospect: { id: 'p-2', displayName: 'Prospect Beta', level: null }, attendance: 'awaiting', report: null }),
  trial('tr-sub', {
    prospect: { id: 'p-3', displayName: 'Prospect Gamma', level: null },
    outcome: 'subscribed',
    outcomeDetail: { reason: null, note: null, recordedAt: '2026-10-18T10:00:00Z', correctedAt: null },
  }),
]

const SLOTS = ['2026-11-02T15:00:00Z', '2026-11-02T15:30:00Z']

function access(a: { lessonManager?: boolean; sales?: boolean; operations?: boolean }) {
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: false, operations: false, ...a }))
}

const staff = makeStaff({ role: 'admin' })

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [m, pattern, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/trials(\?.*)?$/, () => json({ trials: TRIALS }))
  on('GET', /\/trials\/prospects$/, () =>
    json({ prospects: [{ id: 'p-9', displayName: 'Prospect Delta', level: null, note: null, learnerId: null, createdAt: '2026-10-19T09:00:00Z' }] }),
  )
  on('GET', /\/trials\/teachers$/, () => json({ teachers: [{ id: 't-1', name: 'Teacher One' }, { id: 't-2', name: 'Teacher Two' }] }))
  on('GET', /\/trials\/slots\?/, () => json({ teacherId: 't-2', durationMinutes: 30, slots: SLOTS }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('Trial lessons, as Sales', () => {
  it('lists each trial with its one outcome; recorded ones offer a correction', async () => {
    access({ sales: true })
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const row = (await screen.findByText('Prospect Gamma')).closest('tr')!
    expect(within(row).getByText('Attended')).toBeInTheDocument()
    expect(within(row).getByText('Subscribed')).toBeInTheDocument()
    expect(screen.queryByText(/Core/)).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Correct outcome' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Record outcome' })).not.toBeInTheDocument()
    const pending = screen.getByText('Prospect Alpha').closest('tr')!
    expect(within(pending).getByRole('button', { name: 'Record outcome' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record a prospect' })).toBeInTheDocument()
    // Sales sees both of the area's tabs.
    const tabs = screen.getByRole('navigation', { name: 'Trials' })
    expect(within(tabs).getAllByRole('link').map((l) => l.textContent)).toEqual(['Trial lessons', 'New students'])
  })

  it('option 3: "did not subscribe" with its reason; the group reads one sentence', async () => {
    access({ sales: true })
    on('POST', /\/trials\/tr-pending\/outcome$/, () => json(trial('tr-pending', { outcome: 'not_subscribed' }), 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const row = (await screen.findByText('Prospect Alpha')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Record outcome' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /Why didn't the student subscribe\?/ }))
    expect(within(dialog).getByRole('note')).toHaveTextContent('The student did not subscribe.')
    expect(within(dialog).getByRole('note')).toHaveTextContent('never posted in the group')
    // Nothing is sent without a reason.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit' }))
    expect(sent('POST', /\/outcome$/)).toEqual([])
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'schedule')
    await userEvent.type(within(dialog).getByLabelText('Details (required for "Other")'), 'evenings only')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(sent('POST', /\/trials\/tr-pending\/outcome$/)).toEqual([{ result: 'not_subscribed', reason: 'schedule', note: 'evenings only' }]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('option 2: "subscribed" sends the whole form, and only the sentence is previewed for the group', async () => {
    access({ sales: true })
    on('POST', /\/trials\/tr-pending\/outcome$/, () => json(trial('tr-pending', { outcome: 'subscribed' }), 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const row = (await screen.findByText('Prospect Alpha')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Record outcome' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'The student subscribed' }))
    expect(within(dialog).getByRole('note')).toHaveTextContent('The student has subscribed.')
    // Required fields are refused before anything is sent.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit' }))
    expect(within(dialog).getByText('Fill in every required field.')).toBeInTheDocument()
    expect(sent('POST', /\/outcome$/)).toEqual([])

    await userEvent.type(within(dialog).getByLabelText("Parent's name"), 'Parent Alpha')
    await userEvent.type(within(dialog).getByLabelText('Phone number'), '+99 000 111')
    await userEvent.type(within(dialog).getByLabelText('E-mail (optional)'), 'parent@example.test')
    const child = within(dialog).getByRole('group', { name: 'Child 1' })
    await userEvent.type(within(child).getByLabelText('Name'), 'Child Alpha')
    await userEvent.type(within(child).getByLabelText('Age'), '9')
    await userEvent.type(within(child).getByLabelText('Course'), 'Course A')
    await waitFor(() => expect(within(within(child).getByLabelText('Assigned teacher')).getAllByRole('option')).toHaveLength(3))
    expect(within(child).getByLabelText('Assigned teacher')).toHaveValue('t-1') // the trial's teacher, by default
    await userEvent.type(within(child).getByLabelText('Package price'), '1200')
    await userEvent.type(within(child).getByLabelText('Price per lesson'), '150')
    await userEvent.selectOptions(within(child).getByLabelText('Day'), '1')
    await userEvent.type(within(child).getByLabelText('Time'), '17:30')
    await userEvent.selectOptions(within(dialog).getByLabelText('Currency'), 'SAR')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Invoice' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(sent('POST', /\/trials\/tr-pending\/outcome$/)).toEqual([{
        result: 'subscribed',
        subscription: {
          parent: { name: 'Parent Alpha', email: 'parent@example.test', phone: '+99 000 111' },
          children: [{ name: 'Child Alpha', age: 9, course: 'Course A', teacherId: 't-1', packagePrice: 1200, lessonPrice: 150, schedule: [{ weekday: 1, time: '17:30' }] }],
          payment: { currency: 'SAR', method: 'invoice' },
        },
      }]),
    )
  })

  it('corrects an outcome, saying why', async () => {
    access({ sales: true })
    on('POST', /\/trials\/tr-sub\/correction$/, () => json(trial('tr-sub', { outcome: 'no_show' }), 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const row = (await screen.findByText('Prospect Gamma')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Correct outcome' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Current outcome/)).toHaveTextContent('Subscribed')
    expect(within(dialog).queryByRole('button', { name: 'The student subscribed' })).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'The student did not attend the trial' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit' }))
    expect(sent('POST', /\/correction$/)).toEqual([])
    await userEvent.type(within(dialog).getByLabelText('Why are you correcting it?'), 'wrong trial')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(sent('POST', /\/trials\/tr-sub\/correction$/)).toEqual([{ result: 'no_show', why: 'wrong trial' }]))
  })

  it('books only a time the server offered', async () => {
    access({ sales: true })
    on('POST', /\/trials$/, () => json(trial('tr-new', { attendance: 'upcoming', outcome: 'upcoming' }), 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    await userEvent.click(await screen.findByRole('button', { name: 'Book a trial' }))
    const dialog = await screen.findByRole('dialog')
    const book = within(dialog).getByRole('button', { name: 'Book' })
    expect(book).toBeDisabled()
    await waitFor(() => expect(within(within(dialog).getByLabelText('Prospect')).getAllByRole('option')).toHaveLength(2))
    await userEvent.selectOptions(within(dialog).getByLabelText('Prospect'), 'p-9')
    await waitFor(() => expect(within(within(dialog).getByLabelText('Teacher')).getAllByRole('option')).toHaveLength(3))
    await userEvent.selectOptions(within(dialog).getByLabelText('Teacher'), 't-2')
    const time = await within(dialog).findByLabelText('Free time')
    expect(within(time).getAllByRole('option')).toHaveLength(SLOTS.length + 1)
    await userEvent.selectOptions(time, SLOTS[1]!)
    await userEvent.click(book)
    await waitFor(() =>
      expect(sent('POST', /\/trials$/)).toEqual([{ prospectId: 'p-9', teacherId: 't-2', startsAt: SLOTS[1], durationMinutes: 30 }]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('The trial group', () => {
  it('opens the teacher\'s trial group in Chat', async () => {
    access({ sales: true })
    on('POST', /\/trials\/teachers\/t-1\/group$/, () => json({ conversationId: 'conv-trial-1' }, 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const row = (await screen.findByText('Prospect Alpha')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Trial group' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => /\/conversations\/conv-trial-1/.test(String(u)))).toBe(true))
  })
})

describe('Trial lessons, as the Teachers department', () => {
  it('records a no-show; never the subscription decision or a prospect', async () => {
    access({ lessonManager: true })
    on('POST', /\/trials\/tr-awaiting\/outcome$/, () => json(trial('tr-awaiting', { attendance: 'no_show', outcome: 'no_show' }), 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials' })
    const row = (await screen.findByText('Prospect Beta')).closest('tr')!
    expect(screen.queryByRole('button', { name: 'Record a prospect' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Correct outcome' })).not.toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Record outcome' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /The student subscribed/ })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: /Why didn't the student subscribe/ })).toBeDisabled()
    expect(within(dialog).getAllByText('Recorded by Sales')).toHaveLength(2)
    await userEvent.click(within(dialog).getByRole('button', { name: 'The student did not attend the trial' }))
    expect(within(dialog).getByRole('note')).toHaveTextContent('The student did not attend the trial lesson.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(sent('POST', /\/trials\/tr-awaiting\/outcome$/)).toEqual([{ result: 'no_show' }]))
  })
})

describe('The "+ -> Trial" card in a trial group', () => {
  const CONTEXT: TrialGroupContextDto = {
    conversationId: 'conv-trial-1',
    teacher: { id: 't-1', name: 'Teacher One' },
    membership: { isMember: false, permanent: false, canJoin: true, canLeave: false },
    can: { noShow: true, decide: true, correct: true },
    trials: [
      trial('tr-awaiting', { prospect: { id: 'p-2', displayName: 'Prospect Beta', level: null }, attendance: 'awaiting', report: null }),
      trial('tr-sub', { prospect: { id: 'p-3', displayName: 'Prospect Gamma', level: null }, outcome: 'subscribed' }),
    ],
  }

  it('asks which trial first, by student and time, then offers the three options', async () => {
    on('GET', /\/trials\/groups\/conv-trial-1$/, () => json(CONTEXT))
    on('POST', /\/trials\/tr-awaiting\/outcome$/, () => json(trial('tr-awaiting', { outcome: 'no_show' }), 201))
    const onClose = vi.fn()
    renderWithProviders(<TrialCardDialog conversationId="conv-trial-1" onClose={onClose} />, { staff })
    const dialog = await screen.findByRole('dialog', { name: 'Trial' })
    const list = await within(dialog).findByRole('list', { name: 'Which trial?' })
    const picks = within(list).getAllByRole('button')
    expect(picks.map((b) => b.textContent)).toEqual([
      expect.stringMatching(/Prospect Beta.*Needs an outcome/),
      expect.stringMatching(/Prospect Gamma.*Subscribed/),
    ])
    await userEvent.click(picks[0]!)
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining([
      'The student did not attend the trial', 'The student subscribed', "Why didn't the student subscribe?",
    ]))
    await userEvent.click(within(dialog).getByRole('button', { name: 'The student did not attend the trial' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(sent('POST', /\/trials\/tr-awaiting\/outcome$/)).toEqual([{ result: 'no_show' }]))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('a Sales supervisor joins and leaves the group from the bar', async () => {
    let member = false
    const ctx = () => ({ ...CONTEXT, membership: { isMember: member, permanent: false, canJoin: !member, canLeave: member } })
    on('GET', /\/trials\/groups\/conv-trial-1$/, () => json(ctx()))
    on('POST', /\/trials\/groups\/conv-trial-1\/join$/, () => { member = true; return json(ctx(), 201) })
    on('POST', /\/trials\/groups\/conv-trial-1\/leave$/, () => { member = false; return json(ctx(), 201) })
    renderWithProviders(<TrialGroupBar conversationId="conv-trial-1" />, { staff })
    expect(await screen.findByText(/You are not in this trial group/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Join group' }))
    expect(await screen.findByText('You are in this trial group.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Leave group' }))
    expect(await screen.findByRole('button', { name: 'Join group' })).toBeInTheDocument()
    expect(sent('POST', /\/join$/)).toHaveLength(1)
    expect(sent('POST', /\/leave$/)).toHaveLength(1)
  })

  it('a permanent member is told so and offered neither', async () => {
    on('GET', /\/trials\/groups\/conv-trial-1$/, () => json({ ...CONTEXT, membership: { isMember: true, permanent: true, canJoin: false, canLeave: false } }))
    renderWithProviders(<TrialGroupBar conversationId="conv-trial-1" />, { staff })
    expect(await screen.findByText('You are a permanent member of this trial group.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('New students', () => {
  const STUDENT: NewStudentDto = {
    trialId: 'tr-sub',
    prospectName: 'Prospect Gamma',
    trialTeacher: { id: 't-1', name: 'Teacher One' },
    trialAt: '2026-10-10T15:00:00Z',
    recordedAt: '2026-10-11T10:00:00Z',
    recordedBy: { id: 's-1', name: 'Sales One' },
    updatedAt: null,
    parent: { name: 'Parent Gamma', email: 'gamma@example.test', phone: '+99 000 222' },
    children: [
      { name: 'Child G1', age: 8, course: 'Course A', teacher: { id: 't-1', name: 'Teacher One' }, packagePrice: 1200, lessonPrice: 150,
        schedule: [{ weekday: 1, time: '17:00' }, { weekday: 4, time: '18:30' }] },
      { name: 'Child G2', age: 11, course: 'Course B', teacher: { id: 't-2', name: 'Teacher Two' }, packagePrice: 900, lessonPrice: 112.5,
        schedule: [{ weekday: 6, time: '10:00' }] },
    ],
    payment: { currency: 'USD', method: 'bank_transfer' },
  }

  it('shows each subscription in full, as recorded in Chat; Operations cannot edit it', async () => {
    access({ operations: true })
    on('GET', /\/trials\/new-students$/, () => json({ students: [STUDENT] }))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    const card = (await screen.findByRole('heading', { name: 'Parent Gamma' })).closest('article')!
    expect(within(card).getByText('+99 000 222')).toBeInTheDocument()
    expect(within(card).getByText('gamma@example.test')).toBeInTheDocument()
    expect(within(card).getByText('Bank account transfer')).toBeInTheDocument()
    expect(within(card).getByText('USD')).toBeInTheDocument()
    const rows = within(card).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Child G1')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('$1,200.00')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('$150.00')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(/Monday/)).toBeInTheDocument()
    expect(within(rows[0]!).getByText(/Thursday/)).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Teacher Two')).toBeInTheDocument()
    expect(within(card).getByText(/Sales One/)).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Edit subscription' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Core/)).not.toBeInTheDocument()
  })

  it('Sales edits a form in place', async () => {
    access({ sales: true })
    on('GET', /\/trials\/new-students$/, () => json({ students: [STUDENT] }))
    on('POST', /\/trials\/tr-sub\/subscription$/, () => json(STUDENT, 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit subscription' }))
    const dialog = await screen.findByRole('dialog')
    const phone = within(dialog).getByLabelText('Phone number')
    await userEvent.clear(phone)
    await userEvent.type(phone, '+99 000 333')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /\/trials\/tr-sub\/subscription$/)).toEqual([{
      subscription: {
        parent: { name: 'Parent Gamma', email: 'gamma@example.test', phone: '+99 000 333' },
        children: STUDENT.children.map((c) => ({
          name: c.name, age: c.age, course: c.course, teacherId: c.teacher.id, packagePrice: c.packagePrice, lessonPrice: c.lessonPrice, schedule: c.schedule,
        })),
        payment: { currency: 'USD', method: 'bank_transfer' },
      },
    }]))
  })
})

describe('New students: assign, group and the parent\'s sign-up (PD-16)', () => {
  const BASE: NewStudentDto = {
    trialId: 'tr-new',
    prospectName: 'Prospect Delta',
    trialTeacher: { id: 't-1', name: 'Teacher One' },
    trialAt: '2026-10-10T15:00:00Z',
    recordedAt: '2026-10-11T10:00:00Z',
    recordedBy: { id: 's-1', name: 'Sales One' },
    updatedAt: null,
    parent: { name: 'Parent Delta', email: 'delta@example.test', phone: '+99 000 444' },
    children: [{ name: 'Child D1', age: 9, course: 'Course A', teacher: { id: 't-1', name: 'Teacher One' }, packagePrice: 1000, lessonPrice: 125, schedule: [{ weekday: 2, time: '16:00' }] }],
    payment: { currency: 'EGP', method: 'invoice' },
    enrolment: null,
  }

  it('the Operations manager assigns a supervisor with the parent\'s sign-in e-mail', async () => {
    access({ operations: true })
    on('GET', /\/trials\/new-students$/, () => json({ students: [BASE], canAssign: true }))
    on('GET', /\/org\/structure$/, () => json({ departments: [{ id: 'd-ops', kind: 'operations', displayName: 'Operations', manager: null, backups: [],
      members: [{ id: 'sup-1', name: 'Supervisor One', role: 'admin', isActive: true, position: 'supervisor', learnerCount: 4 }] }] }))
    on('POST', /\/trials\/new-students\/tr-new\/assign$/, () => json({ familyId: 'f-1', learnerIds: ['k-1'], schedules: [{ learnerId: 'k-1', set: true, reason: null }] }))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    const card = (await screen.findByRole('heading', { name: 'Parent Delta' })).closest('article')!
    await userEvent.click(within(card).getByRole('button', { name: 'Assign' }))
    const dialog = await screen.findByRole('dialog', { name: /Assign a supervisor/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }))
    expect(sent('POST', /assign$/)).toEqual([])
    await userEvent.selectOptions(await within(dialog).findByLabelText('Supervisor'), 'sup-1')
    expect(within(dialog).getByLabelText(/sign-in e-mail/)).toHaveValue('delta@example.test')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(sent('POST', /\/trials\/new-students\/tr-new\/assign$/)).toEqual([{ supervisorId: 'sup-1', email: 'delta@example.test' }]))
  })

  it('the supervisor sees the parent\'s code to relay, and creates the group; Sales can no longer edit the form', async () => {
    access({ operations: true, sales: true })
    const assigned: NewStudentDto = {
      ...BASE,
      enrolment: {
        familyId: 'f-1', learnerIds: ['k-1'], supervisor: { id: 'sup-1', name: 'Supervisor One' }, assignedAt: '2026-10-21T08:00:00Z',
        groupConversationId: null, canCreateGroup: true, parentSignup: { state: 'code_waiting', code: '482913', expiresAt: '2026-10-21T08:10:00Z' },
      },
    }
    on('GET', /\/trials\/new-students$/, () => json({ students: [assigned], canAssign: false }))
    on('POST', /\/trials\/new-students\/tr-new\/group$/, () => json({ conversationId: 'c-new' }))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    const card = (await screen.findByRole('heading', { name: 'Parent Delta' })).closest('article')!
    expect(within(card).getByText('Supervisor One')).toBeInTheDocument()
    expect(within(card).getByText('482913')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Edit subscription' })).not.toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Create group' }))
    await waitFor(() => expect(sent('POST', /\/trials\/new-students\/tr-new\/group$/)).toHaveLength(1))
  })
})

