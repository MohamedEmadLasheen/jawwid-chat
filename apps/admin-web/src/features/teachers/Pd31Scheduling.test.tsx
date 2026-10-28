import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { ConversationInfo } from '@/features/chat/ConversationInfo'
import { ChangeTeacherDialog } from './ChangeTeacherDialog'
import type { LessonDto, NeedsAction, Roster, ScheduleOptions, TransferPreview } from './opsApi'

/**
 * PD-31 in Admin Web, through the real routes and API client with `fetch`
 * answered at the network boundary: weekly times edited as chips with a
 * before -> after summary, one lesson moved, a one-off added at a free time,
 * the Needs-action card that will not approve a time taken since, a weekly
 * lesson the generator could not create, and a change of teacher that cannot
 * be confirmed until every busy time has a free replacement. What the server
 * allows is proven server-side. Synthetic people only. Cairo is UTC+2 in
 * November 2026; the clock is pinned to 26 Oct 2026 so "future" stays future.
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
const gets = (pattern: RegExp) => fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === 'GET').map(([u]) => String(u))

const MON = '2026-11-02T15:00:00Z' // Mon 2 Nov 17:00 Cairo
const TUE18 = '2026-11-03T16:00:00Z' // Tue 3 Nov 18:00
const TUE09 = '2026-11-03T07:00:00Z' // Tue 3 Nov 09:00
const THU = '2026-11-05T15:00:00Z' // Thu 5 Nov 17:00
const FRI18 = '2026-11-06T16:00:00Z' // Fri 6 Nov 18:00

const lesson = (id: string, over: Partial<LessonDto> = {}): LessonDto => ({
  id,
  learner: { id: 'k-1', name: 'Child Alpha' },
  teacher: { id: 't-1', name: 'Teacher One' },
  kind: 'regular',
  makeupFor: null,
  startsAt: MON,
  endsAt: '2026-11-02T15:30:00Z',
  durationMinutes: 30,
  phase: 'upcoming',
  outcome: null,
  outcomeNote: null,
  movedFrom: null,
  movedTo: null,
  movedBy: null,
  ...over,
})

const ROSTER: Roster = {
  teachers: [
    { id: 't-1', name: 'Teacher One', isActive: true, timezone: 'Africa/Cairo' },
    { id: 't-2', name: 'Teacher Two', isActive: true, timezone: 'Africa/Cairo' },
  ],
  learners: [
    {
      id: 'k-1', name: 'Child Alpha', family: { id: 'f-1', displayName: 'Family One' }, teacherId: 't-1',
      slots: [{ weekday: 1, start: '17:00', durationMinutes: 30 }, { weekday: 4, start: '17:00', durationMinutes: 30 }], suspension: null,
    },
  ],
}

const OPTIONS: ScheduleOptions = {
  timezone: 'Africa/Cairo',
  durationMinutes: 30,
  locked: null,
  current: [
    { weekday: 1, start: '17:00', durationMinutes: 30, nextStartsAt: MON },
    { weekday: 4, start: '17:00', durationMinutes: 30, nextStartsAt: THU },
  ],
  options: [
    { weekday: 1, start: '17:00', nextStartsAt: MON, except: [] },
    { weekday: 4, start: '17:00', nextStartsAt: THU, except: [] },
    { weekday: 2, start: '18:00', nextStartsAt: TUE18, except: ['2026-11-10T16:00:00Z'] },
    { weekday: 2, start: '09:00', nextStartsAt: TUE09, except: [] },
  ],
}

const EMPTY_QUEUE: NeedsAction = { overdue: [], awaitingClose: [], rulings: [], makeupsOverdue: [], returningSoon: [], scheduleRequests: [] }
const supervisor = makeStaff({ role: 'admin' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-26T10:00:00Z'))
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [m, pattern, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: true }))
  on('GET', /\/lessons\/needs-action$/, () => json(EMPTY_QUEUE))
  on('GET', /\/lessons\/roster$/, () => json(ROSTER))
  on('GET', /\/teachers\/t-1\/availability$/, () => json({ teacherId: 't-1', timezone: 'Africa/Cairo', windows: [], daysOff: [] }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  tokenStore.clear()
})

async function openRow(button: string) {
  renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/schedules?teacher=t-1' })
  const row = (await screen.findByText('Child Alpha')).closest('tr')!
  await userEvent.click(within(row).getByRole('button', { name: button }))
  return screen.findByRole('dialog')
}

describe('Schedules › Edit times (weekly)', () => {
  it('replaces one time from the free chips, reads before → after with the skipped week, and saves the full set', async () => {
    on('GET', /\/learners\/k-1\/schedule-options$/, () => json(OPTIONS))
    on('POST', /\/learners\/k-1\/schedule$/, () => json({}, 201))
    const dialog = await openRow('Edit times')
    expect(await within(dialog).findByText('Nothing changed yet.')).toBeInTheDocument()
    const save = within(dialog).getByRole('button', { name: 'Save times' })
    expect(save).toBeDisabled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Change Mon 17:00' }))
    const picker = within(dialog).getByRole('group', { name: 'Pick its new time' })
    // The other weekly time (Thu 17:00) is not offered again.
    expect(within(within(picker).getByRole('radiogroup', { name: 'Day' })).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Mon · 1 time',
      'Tue · 2 times',
    ])
    await userEvent.click(within(picker).getByRole('radio', { name: 'Tue · 2 times' }))
    await userEvent.click(within(picker).getByRole('radio', { name: '18:00 · except 10 Nov' }))
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-11-03' } })

    const summary = within(dialog).getByRole('region', { name: 'Summary' })
    expect(within(summary).getByTestId('weekly-summary')).toHaveTextContent('Mon 17:00 → Tue 18:00 from 3 Nov; Thu 17:00 unchanged')
    expect(summary).toHaveTextContent('No lesson at Tue 18:00 on 10 Nov')

    await userEvent.click(save)
    await waitFor(() =>
      expect(sent('POST', /\/learners\/k-1\/schedule$/)).toEqual([
        { slots: [{ weekday: 2, start: '18:00', durationMinutes: 30 }, { weekday: 4, start: '17:00', durationMinutes: 30 }], effectiveFrom: '2026-11-03' },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('adds and removes times; Save waits until an added row has its time', async () => {
    on('GET', /\/learners\/k-1\/schedule-options$/, () => json(OPTIONS))
    on('POST', /\/learners\/k-1\/schedule$/, () => json({}, 201))
    const dialog = await openRow('Edit times')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Remove Thu 17:00' }))
    await userEvent.click(within(dialog).getByRole('button', { name: '+ Add a time' }))
    expect(within(dialog).getByText('Pick a time for every changed or added row, or remove it.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save times' })).toBeDisabled()
    const picker = within(dialog).getByRole('group', { name: 'Pick the new time' })
    await userEvent.click(within(picker).getByRole('radio', { name: 'Tue · 2 times' }))
    await userEvent.click(within(picker).getByRole('radio', { name: '09:00' }))
    expect(within(dialog).getByTestId('weekly-summary')).toHaveTextContent(
      /^Mon 17:00 unchanged; Thu 17:00 removed from \d+ \w+; Tue 09:00 added from \d+ \w+$/,
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save times' }))
    await waitFor(() => expect(sent('POST', /\/schedule$/)).toHaveLength(1))
    expect(sent('POST', /\/schedule$/)[0]!.slots).toEqual([
      { weekday: 1, start: '17:00', durationMinutes: 30 },
      { weekday: 2, start: '09:00', durationMinutes: 30 },
    ])
  })

  it('a locked child (PD-30) shows the payment pause instead of chips', async () => {
    on('GET', /\/learners\/k-1\/schedule-options$/, () => json({ ...OPTIONS, locked: 'overdue' }))
    const dialog = await openRow('Edit times')
    expect(await within(dialog).findByText('Lessons paused — payment')).toBeInTheDocument()
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
  })
})

describe('Schedules › Lessons (move one lesson)', () => {
  it('lists the next four weeks; Move picks a free chip, reads previous → new, and moves only that lesson', async () => {
    const lessons = [
      lesson('l-1'),
      lesson('l-0', { startsAt: '2026-10-29T15:00:00Z', outcome: 'rescheduled', movedTo: '2026-10-30T15:00:00Z' }),
      lesson('l-held', { startsAt: '2026-10-27T15:00:00Z', phase: 'closed', outcome: 'held' }),
    ]
    on('GET', /\/lessons\?/, () => json({ lessons }))
    let slotsCalls = 0
    on('GET', /\/lessons\/l-1\/move-slots$/, () => {
      slotsCalls += 1
      return json({
        lessonId: 'l-1', startsAt: MON, durationMinutes: 30, timezone: 'Africa/Cairo',
        slots: slotsCalls === 1 ? ['2026-11-04T16:30:00Z', '2026-11-04T17:00:00Z'] : ['2026-11-04T17:00:00Z'],
        locked: null, refusal: null, familyMovesLeft: null,
      })
    })
    let attempts = 0
    on('POST', /\/lessons\/l-1\/move$/, () => {
      attempts += 1
      return attempts === 1
        ? json({ error: { code: 'COMM.LESSON_TEACHER_BUSY', message: 'busy' } }, 409)
        : json(lesson('l-2', { startsAt: '2026-11-04T17:00:00Z', movedFrom: 'l-1', movedBy: 'staff' }), 201)
    })
    const dialog = await openRow('Lessons')
    const list = await within(dialog).findByRole('list', { name: 'Lessons' })
    expect(gets(/\/lessons\?/)[0]).toMatch(/learnerId=k-1&from=2026-10-26T10%3A00%3A00\.000Z&to=2026-11-23T10%3A00%3A00\.000Z/)
    // A lesson moved away says where to; a closed one cannot be moved.
    expect(within(list).getByText('Moved to Fri 30 Oct 17:00')).toBeInTheDocument()
    expect(within(list).getAllByRole('button', { name: /^Move/ })).toHaveLength(1)

    await userEvent.click(within(list).getByRole('button', { name: 'Move Mon 2 Nov 17:00' }))
    const move = await screen.findByRole('dialog', { name: 'Move the lesson — Child Alpha' })
    await userEvent.click(await within(move).findByRole('radio', { name: '18:30' }))
    expect(within(move).getByTestId('pick-summary')).toHaveTextContent('Mon 2 Nov 17:00 → Wed 4 Nov 18:30')

    // Taken in between: said, and the free times reload without it.
    await userEvent.click(within(move).getByRole('button', { name: 'Move the lesson' }))
    expect(await within(move).findByText(/That time was just taken/)).toBeInTheDocument()
    await waitFor(() => expect(within(move).queryByRole('radio', { name: '18:30' })).not.toBeInTheDocument())

    await userEvent.click(within(move).getByRole('radio', { name: '19:00' }))
    await userEvent.click(within(move).getByRole('button', { name: 'Move the lesson' }))
    await waitFor(() => expect(sent('POST', /\/lessons\/l-1\/move$/)).toEqual([{ startsAt: '2026-11-04T16:30:00Z' }, { startsAt: '2026-11-04T17:00:00Z' }]))
    expect(await screen.findByText('Moved to Wed 4 Nov 19:00')).toBeInTheDocument()
  })

  it('a refusal (the lesson started) is said instead of chips', async () => {
    on('GET', /\/lessons\?/, () => json({ lessons: [lesson('l-1')] }))
    on('GET', /\/lessons\/l-1\/move-slots$/, () =>
      json({ lessonId: 'l-1', startsAt: MON, durationMinutes: 30, timezone: 'Africa/Cairo', slots: [], locked: null, refusal: 'started', familyMovesLeft: null }),
    )
    const dialog = await openRow('Lessons')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Move Mon 2 Nov 17:00' }))
    expect(await screen.findByText('This lesson has started; it can no longer be moved.')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})

describe('Schedules › Add a lesson', () => {
  it('books one extra lesson at a free chip, with the length kept from the weekly times', async () => {
    on('GET', /\/learners\/k-1\/free-slots\?durationMinutes=30$/, () =>
      json({ durationMinutes: 30, timezone: 'Africa/Cairo', slots: ['2026-11-04T16:30:00Z'], locked: null }),
    )
    on('POST', /\/lessons$/, () => json(lesson('l-new'), 201))
    const dialog = await openRow('Add a lesson')
    await userEvent.click(await within(dialog).findByRole('radio', { name: '18:30' }))
    expect(within(dialog).getByTestId('pick-summary')).toHaveTextContent('Wed 4 Nov 18:30 · 30 min')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add the lesson' }))
    await waitFor(() =>
      expect(sent('POST', /\/lessons$/)).toEqual([{ learnerId: 'k-1', startsAt: '2026-11-04T16:30:00Z', endsAt: '2026-11-04T17:00:00.000Z' }]),
    )
  })
})

const PREVIEW: TransferPreview = {
  toTeacher: { id: 't-2', name: 'Teacher Two', away: null },
  locked: null,
  learners: [
    {
      id: 'k-1', name: 'Child Alpha', fromTeacher: { id: 't-1', name: 'Teacher One' },
      slots: [
        { weekday: 1, start: '17:00', durationMinutes: 30, nextStartsAt: MON, free: true },
        { weekday: 4, start: '17:00', durationMinutes: 30, nextStartsAt: THU, free: false },
      ],
      allFree: false,
      futureLessons: 7,
      unmovable: [{ lessonId: 'm-1', kind: 'makeup', startsAt: '2026-11-07T15:00:00Z' }],
    },
  ],
}

const CANDIDATES = {
  teachers: [
    { id: 't-1', name: 'Teacher One', isActive: true, away: null },
    { id: 't-2', name: 'Teacher Two', isActive: true, away: null },
    { id: 't-3', name: 'Teacher Three', isActive: true, away: { kind: 'leave', until: '2026-11-20' } },
    { id: 't-4', name: 'Teacher Four', isActive: false, away: null },
  ],
}

describe('Change teacher', () => {
  it('PD-43: a teacher still being set up is a warning beside the name, never greyed out', async () => {
    on('GET', /\/teachers\/candidates$/, () =>
      json({
        teachers: [
          { id: 't-2', name: 'Teacher Two', isActive: true, away: null, readiness: { setupIncomplete: true, notSignedIn: true, noSupervisor: true, loginSuspended: false } },
          { id: 't-5', name: 'Teacher Five', isActive: true, away: null, readiness: { setupIncomplete: false, notSignedIn: false, noSupervisor: false, loginSuspended: true } },
          { id: 't-6', name: 'Teacher Six', isActive: true, away: null, readiness: { setupIncomplete: false, notSignedIn: false, noSupervisor: false, loginSuspended: false } },
        ],
      }),
    )
    renderWithProviders(<ChangeTeacherDialog target={{ kind: 'learner', id: 'k-1', name: 'Child Alpha' }} onClose={() => undefined} onDone={() => undefined} />)
    const two = await screen.findByRole('radio', { name: /^Teacher Two/ })
    expect(two).toBeEnabled()
    expect(two.closest('label')!).toHaveTextContent('Setup incomplete · Not signed in yet · No supervisor')
    const five = screen.getByRole('radio', { name: /^Teacher Five/ })
    expect(five).toBeEnabled()
    expect(five.closest('label')!).toHaveTextContent('Login suspended')
    expect(screen.getByRole('radio', { name: 'Teacher Six' })).toBeEnabled()
  })

  it('greys out away and inactive teachers, and will not confirm until the busy weekly time has a free replacement', async () => {
    on('GET', /\/teachers\/candidates$/, () => json(CANDIDATES))
    on('GET', /\/learners\/k-1\/transfer-preview\?toTeacherId=t-2$/, () => json(PREVIEW))
    on('GET', /\/learners\/k-1\/schedule-options\?teacherId=t-2$/, () =>
      json({ ...OPTIONS, options: [{ weekday: 1, start: '17:00', nextStartsAt: MON, except: [] }, { weekday: 5, start: '18:00', nextStartsAt: FRI18, except: [] }] }),
    )
    on('POST', /\/learners\/k-1\/transfer$/, () => json({ transferId: 'x', toTeacherId: 't-2', lessonsMoved: 6, lessonsRescheduled: 1, scheduleKept: true }, 201))
    const dialog = await openRow('Change teacher')
    expect(dialog).toHaveAccessibleName('Change teacher — Child Alpha')
    expect(await within(dialog).findByRole('radio', { name: /Teacher Three · on leave until Nov 20, 2026/ })).toBeDisabled()
    expect(within(dialog).getByRole('radio', { name: /Teacher Four · inactive/ })).toBeDisabled()
    expect(within(dialog).getByRole('radio', { name: /Teacher One · current teacher/ })).toBeDisabled()
    const confirm = within(dialog).getByRole('button', { name: 'Change teacher' })
    expect(confirm).toBeDisabled()

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Teacher Two' }))
    const child = await within(dialog).findByRole('group', { name: 'Child Alpha' })
    expect(within(child).getByText(/Mon 17:00 — free/)).toBeInTheDocument()
    expect(within(child).getByText(/Thu 17:00 — busy — pick another time/)).toBeInTheDocument()
    expect(within(child).getByRole('note')).toHaveTextContent('Sat 7 Nov 17:00 · Make-up')
    expect(confirm).toBeDisabled()

    // The busy time's picker offers the new teacher's free times, minus the kept Monday.
    const picker = await within(child).findByRole('group', { name: 'Pick its new time: Thu 17:00' })
    expect(within(within(picker).getByRole('radiogroup', { name: 'Day' })).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Fri · 1 time'])
    await userEvent.click(within(picker).getByRole('radio', { name: '18:00' }))
    await waitFor(() => expect(confirm).toBeEnabled())
    // Names are bidi-isolated (FSI ... PDI) so a Latin name cannot flip the arrow in Arabic.
    expect(within(dialog).getByTestId('teacher-summary').textContent!.replace(/[\u2068\u2069]/g, '')).toBe(
      'Child Alpha: Teacher One → Teacher Two — Mon 17:00 kept; Thu 17:00 → Fri 18:00 · 7 future lessons follow',
    )
    await userEvent.type(within(dialog).getByLabelText(/Handover note/), 'continue from Al-Mulk 16')
    await userEvent.click(confirm)
    await waitFor(() =>
      expect(sent('POST', /\/learners\/k-1\/transfer$/)).toEqual([
        {
          toTeacherId: 't-2',
          reason: 'family_request',
          handoverNote: 'continue from Al-Mulk 16',
          slots: [{ weekday: 1, start: '17:00' }, { weekday: 5, start: '18:00' }],
        },
      ]),
    )
    expect(await screen.findByText('Transferred. 6 lessons moved, 1 could not follow.')).toBeInTheDocument()
  })

  it('a group with two teachers asks which one is replaced; all free sends no times', async () => {
    on('GET', /\/teachers\/candidates$/, () => json(CANDIDATES))
    on('GET', /\/conversations\/c-1\/teacher-preview\?toTeacherId=t-2$/, () =>
      json({ ...PREVIEW, groupTeachers: [{ id: 't-1', name: 'Teacher One' }, { id: 't-4', name: 'Teacher Four' }], learners: [] }),
    )
    on('GET', /\/conversations\/c-1\/teacher-preview\?toTeacherId=t-2&fromTeacherId=t-1$/, () =>
      json({
        ...PREVIEW,
        groupTeachers: [{ id: 't-1', name: 'Teacher One' }, { id: 't-4', name: 'Teacher Four' }],
        learners: [{ ...PREVIEW.learners[0]!, slots: PREVIEW.learners[0]!.slots.map((s) => ({ ...s, free: true })), allFree: true, unmovable: [] }],
      }),
    )
    on('POST', /\/conversations\/c-1\/teacher$/, () => json({ learners: [{ learnerId: 'k-1', transferId: 'x', lessonsMoved: 7, lessonsRescheduled: 0 }] }, 201))
    const onDone = vi.fn()
    renderWithProviders(<ChangeTeacherDialog target={{ kind: 'group', id: 'c-1', name: 'Family One group' }} onClose={() => undefined} onDone={onDone} />)
    await userEvent.click(await screen.findByRole('radio', { name: 'Teacher Two' }))
    const which = await screen.findByRole('group', { name: 'Which teacher is being replaced?' })
    const confirm = screen.getByRole('button', { name: 'Change teacher' })
    expect(confirm).toBeDisabled()
    await userEvent.click(within(which).getByRole('radio', { name: 'Teacher One' }))
    expect(await screen.findByText(/Mon 17:00 — free/)).toBeInTheDocument()
    await waitFor(() => expect(confirm).toBeEnabled())
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'teacher_leaving')
    await userEvent.click(confirm)
    await waitFor(() =>
      expect(sent('POST', /\/conversations\/c-1\/teacher$/)).toEqual([{ toTeacherId: 't-2', reason: 'teacher_leaving', fromTeacherId: 't-1' }]),
    )
    expect(onDone).toHaveBeenCalledWith('Teacher changed for 1 children. Transferred. 7 lessons moved, 0 could not follow.')
  })

  it('the server\'s "times_not_free" refreshes the preview and is said in words', async () => {
    on('GET', /\/teachers\/candidates$/, () => json(CANDIDATES))
    on('GET', /\/learners\/k-1\/transfer-preview\?toTeacherId=t-2$/, () =>
      json({ ...PREVIEW, learners: [{ ...PREVIEW.learners[0]!, slots: PREVIEW.learners[0]!.slots.map((s) => ({ ...s, free: true })), allFree: true, unmovable: [] }] }),
    )
    on('POST', /\/learners\/k-1\/transfer$/, () => json({ error: { code: 'COMM.LESSON_STATE', message: 'times_not_free' } }, 409))
    const dialog = await openRow('Change teacher')
    await userEvent.click(await within(dialog).findByRole('radio', { name: 'Teacher Two' }))
    const confirm = within(dialog).getByRole('button', { name: 'Change teacher' })
    await waitFor(() => expect(confirm).toBeEnabled())
    await userEvent.click(confirm)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The new teacher is no longer free at one of these times.')
    expect(sent('POST', /\/transfer$/)[0]).toEqual({ toTeacherId: 't-2', reason: 'family_request' })
    await waitFor(() => expect(gets(/transfer-preview/).length).toBeGreaterThan(1))
  })
})

describe('Needs action (PD-31)', () => {
  const QUEUE: NeedsAction = {
    ...EMPTY_QUEUE,
    scheduleRequests: [
      {
        id: 'q-1', learner: { id: 'k-1', name: 'Child Alpha' }, slots: [{ weekday: 2, start: '18:00' }, { weekday: 4, start: '17:00' }],
        note: 'school ends later', createdAt: '2026-10-25T09:00:00Z',
        teacher: { id: 't-1', name: 'Teacher One' },
        requestedBy: { kind: 'family', name: 'Parent Alpha' },
        effectiveFrom: '2026-11-03',
        current: [{ weekday: 1, start: '17:00', durationMinutes: 30, nextStartsAt: MON }, { weekday: 4, start: '17:00', durationMinutes: 30, nextStartsAt: THU }],
        requested: [{ weekday: 2, start: '18:00', nextStartsAt: TUE18, free: false }, { weekday: 4, start: '17:00', nextStartsAt: THU, free: true }],
        stillFree: false,
      },
      {
        id: 'q-2', learner: { id: 'k-2', name: 'Child Beta' }, slots: [{ weekday: 2, start: '09:00' }],
        note: null, createdAt: '2026-10-25T09:00:00Z', teacher: { id: 't-2', name: 'Teacher Two' },
        requestedBy: { kind: 'teacher', name: 'Teacher Two' }, effectiveFrom: null,
        current: [], requested: [{ weekday: 2, start: '09:00', nextStartsAt: TUE09, free: true }], stillFree: true,
      },
    ],
    blockedOccurrences: [
      {
        id: 'b-1', learner: { id: 'k-1', name: 'Child Alpha' }, teacher: { id: 't-1', name: 'Teacher One' },
        startsAt: '2026-11-09T15:00:00Z', endsAt: '2026-11-09T15:30:00Z',
        blockedBy: { lessonId: 'm-9', kind: 'makeup', startsAt: '2026-11-09T15:00:00Z', endsAt: '2026-11-09T15:30:00Z' },
      },
    ],
  }

  it('a request whose time was taken since: before → after, who asked, from when, and Approve disabled (Reject allowed)', async () => {
    on('GET', /\/lessons\/needs-action$/, () => json(QUEUE))
    on('POST', /\/schedule-change-requests\/q-1\/decide$/, () => json({ id: 'q-1', status: 'rejected' }, 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/needs-action' })
    const section = await screen.findByRole('region', { name: 'Regular-time requests' })
    const stale = within(section).getByText('Child Alpha').closest('[data-request]') as HTMLElement
    expect(within(stale).getByText('Asked by the family (Parent Alpha) · Teacher: Teacher One')).toBeInTheDocument()
    expect(within(stale).getByText('Mon 17:00 · Thu 17:00')).toBeInTheDocument()
    expect(within(stale).getByText('Tue 18:00').closest('li')).toHaveTextContent('Tue 18:00 (no longer free)')
    expect(within(stale).getByText('Thu 17:00', { selector: 'li' })).toHaveTextContent('(free)')
    expect(within(stale).getByText('3 Nov')).toBeInTheDocument()
    expect(within(stale).getByRole('note')).toHaveTextContent('No longer free')
    expect(within(stale).getByRole('button', { name: 'Approve' })).toBeDisabled()
    await userEvent.click(within(stale).getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Note'), 'that time is gone')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /q-1\/decide$/)).toEqual([{ decision: 'rejected', note: 'that time is gone' }]))

    const fresh = within(section).getByText('Child Beta').closest('[data-request]') as HTMLElement
    expect(within(fresh).getByText('Asked by the teacher (Teacher Two) · Teacher: Teacher Two')).toBeInTheDocument()
    expect(within(fresh).getByRole('button', { name: 'Approve' })).toBeEnabled()
  })

  it('a weekly lesson that could not be created: what blocked it, scheduled at another free time or dismissed', async () => {
    on('GET', /\/lessons\/needs-action$/, () => json(QUEUE))
    on('GET', /\/lessons\/blocked\/b-1\/slots$/, () => json({ durationMinutes: 30, timezone: 'Africa/Cairo', slots: ['2026-11-10T07:00:00Z'] }))
    on('POST', /\/lessons\/blocked\/b-1\/schedule$/, () => json(lesson('l-b'), 201))
    on('POST', /\/lessons\/blocked\/b-1\/dismiss$/, () => json({ ok: true }, 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/needs-action' })
    const section = await screen.findByRole('region', { name: 'Weekly lessons not scheduled' })
    expect(section).toHaveTextContent('Teacher One · Mon 9 Nov 17:00 · 30 min')
    expect(section).toHaveTextContent('Blocked by a make-up lesson at 17:00–17:30')

    await userEvent.click(within(section).getByRole('button', { name: 'Schedule at another time' }))
    const dialog = await screen.findByRole('dialog', { name: 'Schedule — Child Alpha' })
    await userEvent.click(await within(dialog).findByRole('radio', { name: '09:00' }))
    expect(within(dialog).getByTestId('pick-summary')).toHaveTextContent('Mon 9 Nov 17:00 → Tue 10 Nov 09:00')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule the lesson' }))
    await waitFor(() => expect(sent('POST', /blocked\/b-1\/schedule$/)).toEqual([{ startsAt: '2026-11-10T07:00:00Z' }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await userEvent.click(within(section).getByRole('button', { name: 'Dismiss' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /blocked\/b-1\/dismiss$/)).toEqual([{}]))
  })
})

describe('Change teacher: where it is offered', () => {
  const access = (a: { lessonManager?: boolean; operations?: boolean }) => {
    routes = routes.filter(([, p]) => !p.test('/api/v1/lessons/access'))
    on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: false, operations: false, ...a }))
  }

  it('the group info panel of a family group, for Operations; the dialog changes the group\'s teacher', async () => {
    access({ operations: true })
    on('GET', /\/teachers\/candidates$/, () => json(CANDIDATES))
    const group = {
      id: 'c-1', type: 'family_group', familyId: 'f-1', learnerId: null, title: 'Family One group', state: 'open',
      needsReply: false, lastSeq: '1', lastActivityAt: '2026-10-25T09:00:00Z', archivedAt: null, members: [],
    }
    renderWithProviders(<ConversationInfo c={group} />, { staff: supervisor })
    await userEvent.click(await screen.findByRole('button', { name: 'Change teacher' }))
    expect(await screen.findByRole('dialog', { name: 'Change teacher — Family One group' })).toBeInTheDocument()
  })

  it('is not offered to staff the server does not count (no Teachers department, no Operations)', async () => {
    access({})
    const group = {
      id: 'c-1', type: 'student_group', familyId: 'f-1', learnerId: 'k-1', title: 'Child Alpha', state: 'open',
      needsReply: false, lastSeq: '1', lastActivityAt: '2026-10-25T09:00:00Z', archivedAt: null, members: [],
    }
    renderWithProviders(<ConversationInfo c={group} />, { staff: supervisor })
    await waitFor(() => expect(gets(/\/lessons\/access$/).length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 50)) // let the answer render
    expect(screen.queryByRole('button', { name: 'Change teacher' })).not.toBeInTheDocument()
  })

  it('the Student Profile, beside the teacher, for the Teachers department', async () => {
    access({ lessonManager: true })
    on('GET', /\/learners\/k-1\/profile$/, () =>
      json({
        id: 'k-1', name: 'Child Alpha', avatarUrl: null, age: 9, course: null, teacher: { id: 't-1', name: 'Teacher One' },
        schedule: [], viewer: 'staff',
      }),
    )
    on('GET', /\/teachers\/candidates$/, () => json(CANDIDATES))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/students/k-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Change teacher' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change teacher — Child Alpha' })
    expect(await within(dialog).findByRole('radio', { name: /Teacher One · current teacher/ })).toBeDisabled()
  })
})
