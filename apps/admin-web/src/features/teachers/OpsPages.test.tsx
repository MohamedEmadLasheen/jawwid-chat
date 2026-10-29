import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { LessonDto, NeedsAction, Roster, SuspensionDto } from './opsApi'
import { chooseOption } from '@/test/select'

/**
 * The supervisors' operations pages, through the real routes and API client,
 * with `fetch` answered at the network boundary. They prove the page's side of
 * the contract: the right request with the right body, required reasons refused
 * before anything is sent, and the server's refusal shown as it is. What the
 * server allows is proven server-side (lessons-*.spec.ts). Synthetic people only.
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

const lesson = (id: string, over: Partial<LessonDto> = {}): LessonDto => ({
  id,
  learner: { id: 'k-1', name: 'Child Alpha' },
  teacher: { id: 't-1', name: 'Teacher One' },
  kind: 'regular',
  makeupFor: null,
  startsAt: '2026-10-17T15:00:00Z',
  endsAt: '2026-10-17T15:30:00Z',
  durationMinutes: 30,
  phase: 'overdue',
  outcome: null,
  outcomeNote: null,
  ...over,
})

const QUEUE: NeedsAction = {
  overdue: [lesson('l-over')],
  awaitingClose: [],
  rulings: [{ id: 'r-1', kind: 'late_apology', reason: 'hospital', openedAt: '2026-10-18T10:00:00Z', decision: null, lesson: lesson('l-late', { outcome: 'student_no_show' }) }],
  makeupsOverdue: [lesson('l-owed', { outcome: 'teacher_apology' })],
  returningSoon: [],
  scheduleRequests: [{ id: 'q-1', learner: { id: 'k-1', name: 'Child Alpha' }, slots: [{ weekday: 3, start: '19:00' }], note: 'school ends later', createdAt: '2026-10-18T09:00:00Z' }],
}

const ROSTER: Roster = {
  teachers: [
    { id: 't-1', name: 'Teacher One', isActive: true, timezone: 'Africa/Cairo' },
    { id: 't-2', name: 'Teacher Two', isActive: true, timezone: 'Africa/Cairo' },
  ],
  learners: [
    { id: 'k-1', name: 'Child Alpha', family: { id: 'f-1', displayName: 'Family One' }, teacherId: 't-1', slots: [{ weekday: 1, start: '17:00', durationMinutes: 30 }], suspension: null },
    { id: 'k-2', name: 'Child Beta', family: { id: 'f-2', displayName: 'Family Two' }, teacherId: 't-2', slots: [], suspension: null },
  ],
}

const supervisor = makeStaff({ role: 'admin' })

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
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: true }))
  on('GET', /\/lessons\/needs-action$/, () => json(QUEUE))
  on('GET', /\/lessons\/roster$/, () => json(ROSTER))
  on('GET', /\/teachers\/t-1\/availability$/, () =>
    json({ teacherId: 't-1', timezone: 'Africa/Cairo', windows: [{ weekday: 1, start: '16:00', end: '20:00' }], daysOff: [{ date: '2026-10-25', reason: 'leave' }] }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('Needs action', () => {
  it('shows each queue with its own decisions, and the area tabs', async () => {
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/needs-action' })
    const overdue = await screen.findByRole('region', { name: 'Reports overdue' })
    expect(within(overdue).getByText('Child Alpha')).toBeInTheDocument()
    expect(within(overdue).getByRole('button', { name: 'Teacher absent' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Late apologies' })).toHaveTextContent('hospital')
    expect(screen.getByRole('region', { name: 'Regular-time requests' })).toHaveTextContent('Wednesday 19:00')
    const tabs = screen.getByRole('navigation', { name: 'Teachers' })
    expect(within(tabs).getByRole('link', { name: 'Needs action' })).toHaveAttribute('aria-current', 'page')
  })

  it('a teacher absence needs a note; then it is sent, and the queue refreshes', async () => {
    on('POST', /\/lessons\/l-over\/teacher-no-show$/, () => json(lesson('l-over', { outcome: 'teacher_no_show' }), 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/needs-action' })
    const overdue = await screen.findByRole('region', { name: 'Reports overdue' })
    await userEvent.click(within(overdue).getByRole('button', { name: 'Teacher absent' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Required')).toBeInTheDocument()
    expect(sent('POST', /teacher-no-show/)).toHaveLength(0)

    await userEvent.type(within(dialog).getByLabelText('Note'), 'did not join')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sent('POST', /teacher-no-show/)).toEqual([{ note: 'did not join' }])
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => /needs-action$/.test(String(u))).length).toBeGreaterThan(1))
  })

  it('excuses a late apology, and records what was done about an unreplaced lesson', async () => {
    on('POST', /\/lesson-rulings\/r-1\/decide$/, () => json(lesson('l-late', { outcome: 'student_apology' }), 201))
    on('POST', /\/lessons\/l-owed\/makeup-resolution$/, () => json(lesson('l-owed'), 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/needs-action' })
    await userEvent.click(await screen.findByRole('button', { name: 'Excuse' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /lesson-rulings\/r-1\/decide/)).toEqual([{ decision: 'excused' }]))

    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }))
    const dialog = await screen.findByRole('dialog')
    await chooseOption(userEvent, within(dialog).getByLabelText('Action'), 'family_credit')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /makeup-resolution/)).toEqual([{ action: 'family_credit' }]))
  })

  it('the server\'s refusal stays in the dialog, in its own words', async () => {
    on('POST', /\/schedule-change-requests\/q-1\/decide$/, () =>
      json({ error: { code: 'COMM.LESSON_STATE', message: 'Wednesday 19:00 is not a free time for this teacher' } }, 409),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/needs-action' })
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Wednesday 19:00 is not a free time for this teacher')
  })
})

describe('Schedules', () => {
  it('saves a teacher\'s working hours exactly as edited', async () => {
    on('POST', /\/teachers\/t-1\/availability$/, (_u, init) => json({ teacherId: 't-1', ...JSON.parse(String(init.body)), daysOff: [] }, 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/schedules?teacher=t-1' })
    const hours = await screen.findByRole('region', { name: 'Working hours' })
    await userEvent.click(within(hours).getByRole('button', { name: 'Add hours' }))
    await userEvent.click(within(hours).getByRole('button', { name: 'Save working hours' }))
    await waitFor(() =>
      expect(sent('POST', /\/teachers\/t-1\/availability$/)).toEqual([
        { timezone: 'Africa/Cairo', windows: [{ weekday: 1, start: '16:00', end: '20:00' }, { weekday: 1, start: '16:00', end: '20:00' }] },
      ]),
    )
  })

  it('lists the teacher\'s students; a change of teacher keeps free times and sends the handover', async () => {
    on('GET', /\/teachers\/candidates$/, () =>
      json({ teachers: [{ id: 't-1', name: 'Teacher One', isActive: true, away: null }, { id: 't-2', name: 'Teacher Two', isActive: true, away: null }] }),
    )
    on('GET', /\/learners\/k-1\/transfer-preview\?toTeacherId=t-2$/, () =>
      json({
        toTeacher: { id: 't-2', name: 'Teacher Two', away: null },
        locked: null,
        learners: [{
          id: 'k-1', name: 'Child Alpha', fromTeacher: { id: 't-1', name: 'Teacher One' },
          slots: [{ weekday: 1, start: '17:00', durationMinutes: 30, nextStartsAt: '2026-11-02T15:00:00Z', free: true }],
          allFree: true, futureLessons: 4, unmovable: [],
        }],
      }),
    )
    on('POST', /\/learners\/k-1\/transfer$/, () => json({ transferId: 'x', lessonsMoved: 4, lessonsRescheduled: 1, scheduleKept: true }, 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/schedules?teacher=t-1' })
    const students = await screen.findByRole('region', { name: 'Students' })
    const row = within(students).getByText('Child Alpha').closest('tr')!
    expect(within(row).getByText('Monday 17:00 (30 min)')).toBeInTheDocument()
    expect(within(students).queryByText('Child Beta')).not.toBeInTheDocument()

    await userEvent.click(within(row).getByRole('button', { name: 'Change teacher' }))
    const dialog = await screen.findByRole('dialog')
    // The current teacher cannot be picked.
    expect(await within(dialog).findByRole('radio', { name: /Teacher One/ })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Teacher Two' }))
    await userEvent.type(within(dialog).getByLabelText(/Handover note/), 'continue from Al-Mulk 16')
    const confirm = within(dialog).getByRole('button', { name: 'Change teacher' })
    await waitFor(() => expect(confirm).toBeEnabled())
    await userEvent.click(confirm)
    await waitFor(() =>
      expect(sent('POST', /\/learners\/k-1\/transfer$/)).toEqual([
        { toTeacherId: 't-2', reason: 'family_request', handoverNote: 'continue from Al-Mulk 16' },
      ]),
    )
    expect(await screen.findByText(/4 lessons moved, 1 could not follow/)).toBeInTheDocument()
  })

  it('a pause sends its return date; a stop never does', async () => {
    on('POST', /\/learners\/k-1\/suspensions$/, () => json({}, 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/schedules?teacher=t-1' })
    const row = (await screen.findByText('Child Alpha')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Pause or stop' }))
    let dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Returns on'), '2026-11-01')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /suspensions$/)).toHaveLength(1))
    expect(sent('POST', /suspensions$/)[0]).toEqual({ kind: 'temporary', reason: 'travel', returnOn: '2026-11-01' })

    await userEvent.click(within(row).getByRole('button', { name: 'Pause or stop' }))
    dialog = await screen.findByRole('dialog')
    await chooseOption(userEvent, within(dialog).getByLabelText('Kind'), 'permanent')
    await userEvent.type(within(dialog).getByLabelText('Returns on'), '2026-11-01')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /suspensions$/)).toHaveLength(2))
    expect(sent('POST', /suspensions$/)[1]).toEqual({ kind: 'permanent', reason: 'travel' })
  })
})

describe('Students', () => {
  it('lists paused students with their return date and ends a pause', async () => {
    const paused: SuspensionDto = {
      id: 's-1', learner: { id: 'k-1', name: 'Child Alpha' }, kind: 'temporary', reason: 'travel', note: null,
      startsOn: '2026-10-19', returnOn: '2026-11-01', status: 'active',
      family: { id: 'f-1', displayName: 'Family One' }, teacher: { id: 't-1', name: 'Teacher One' }, packageBalance: null,
    }
    on('GET', /\/suspensions\?kind=temporary&status=active$/, () => json({ suspensions: [paused] }))
    on('GET', /\/suspensions\?kind=permanent&status=active$/, () => json({ suspensions: [] }))
    on('POST', /\/suspensions\/s-1\/end$/, () => json({ ...paused, status: 'ended' }, 201))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/students' })
    const row = (await screen.findByText('Child Alpha')).closest('tr')!
    // A calendar day, formatted -- never shifted by the reader's zone.
    expect(within(row).getByText('Nov 1, 2026')).toBeInTheDocument()
    expect(within(row).getByText('Travel')).toBeInTheDocument()
    expect(within(row).getByText('Kept in Core')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'End pause now' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => /\/suspensions\/s-1\/end$/.test(String(u)) && (i as RequestInit).method === 'POST')).toBe(true))

    await userEvent.click(screen.getByRole('tab', { name: 'Stopped' }))
    expect(await screen.findByText('Nobody here.')).toBeInTheDocument()
  })
})
