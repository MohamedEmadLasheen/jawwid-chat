import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { TeacherDetail, TeacherRow } from './api'
import { TEACHERS_TABS } from './area'

/**
 * PD-11 T5 teacher statistics, through the real routes and API client with
 * `fetch` answered at the network boundary. These prove the page's side: the
 * entry is offered only when the server confirms the Teachers department, the
 * page asks for the month it shows, and it lays out the server's numbers
 * without computing any. The numbers themselves are proven server-side
 * (apps/api test/integration/lessons-stats.spec.ts). Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string) => Response
let routes: Array<[RegExp, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (pattern: RegExp, handler: Handler) => routes.unshift([pattern, handler])

const ROWS: TeacherRow[] = [
  {
    teacher: { id: 't-1', name: 'Teacher One', isActive: true },
    held: { lessons: 99, minutes: 3948 },
    scheduled: { lessons: 130, minutes: 5022 },
    notHeld: { lessons: 31, minutes: 1074 },
    unreported: { lessons: 2, minutes: 60 },
    upcoming: { lessons: 99, minutes: 3852 },
    attendanceRate: 0.9,
    reportsOnTimeRate: 0.75,
    trials: { total: 7, conducted: 5, subscribed: 3, notSubscribed: 1, noShow: 2, awaiting: 1, upcoming: 2, cancelled: 1, conversionRate: 0.75 },
    movesByTeacher: 4,
    summary: {
      totalScheduled: 130, conducted: 99, studentAttended: 99, studentNoShow: 10,
      studentExcuses: { total: 12, beforeStart: 9, afterStart: 3 }, teacherExcuses: 4, teacherNoShow: 1, cancelled: 2,
      pending: { total: 2, upcoming: 0, awaitingReport: 2 }, completed: { regular: 91, makeup: 8, total: 99 },
      makeups: { completed: 8, scheduled: 1, total: 9 },
    },
  },
  {
    teacher: { id: 't-2', name: 'Teacher Two', isActive: false },
    held: { lessons: 0, minutes: 0 },
    scheduled: { lessons: 0, minutes: 0 },
    notHeld: { lessons: 0, minutes: 0 },
    unreported: { lessons: 0, minutes: 0 },
    upcoming: { lessons: 0, minutes: 0 },
    attendanceRate: null,
    reportsOnTimeRate: null,
    trials: { total: 0, conducted: 0, subscribed: 0, notSubscribed: 0, noShow: 0, awaiting: 0, upcoming: 0, cancelled: 0, conversionRate: null },
    movesByTeacher: 0,
    summary: {
      totalScheduled: 0, conducted: 0, studentAttended: 0, studentNoShow: 0,
      studentExcuses: { total: 0, beforeStart: 0, afterStart: 0 }, teacherExcuses: 0, teacherNoShow: 0, cancelled: 0,
      pending: { total: 0, upcoming: 0, awaitingReport: 0 }, completed: { regular: 0, makeup: 0, total: 0 },
      makeups: { completed: 0, scheduled: 0, total: 0 },
    },
  },
]

const empty = { lessons: 0, minutes: 0, byDuration: [] }
const DETAIL: TeacherDetail = {
  teacher: { id: 't-1', name: 'Teacher One' },
  month: '2026-10',
  zone: 'Africa/Cairo',
  categories: [
    {
      key: 'held',
      counted: true,
      lessons: 99,
      minutes: 3948,
      byDuration: [
        { durationMinutes: 30, lessons: 63, minutes: 1890 },
        { durationMinutes: 40, lessons: 5, minutes: 200 },
        { durationMinutes: 60, lessons: 31, minutes: 1860 },
      ],
    },
    { key: 'upcoming', counted: false, ...empty },
    { key: 'unreported', counted: false, ...empty },
    { key: 'student_apology', counted: true, ...empty },
    { key: 'teacher_apology', counted: true, ...empty },
    { key: 'student_no_show', counted: true, ...empty },
    { key: 'teacher_no_show', counted: true, ...empty },
    { key: 'admin_cancelled', counted: true, lessons: 1, minutes: 30, byDuration: [{ durationMinutes: 30, lessons: 1, minutes: 30 }] },
    { key: 'rescheduled', counted: false, ...empty },
    { key: 'suspended', counted: false, lessons: 2, minutes: 60, byDuration: [{ durationMinutes: 30, lessons: 2, minutes: 60 }] },
  ],
  totals: { counted: { lessons: 100, minutes: 3978 }, scheduledMinutes: 3978 },
  makeups: { lessons: 3, held: 2 },
  trials: { total: 7, conducted: 5, subscribed: 3, notSubscribed: 1, noShow: 2, awaiting: 1, upcoming: 2, cancelled: 1, conversionRate: 0.75 },
  rates: { attendance: 0.9, completion: 0.99, teacherReliability: 1 },
  reports: { reports: 99, onTime: 90, onTimeRate: 0.909, medianDelayMinutes: 35 },
  replies: { familyMessages: 40, answeredWithin: 38, rate: 0.95, medianReplyMinutes: 12 },
  workload: { availableMinutes: 9600, scheduledMinutes: 3978, freeMinutes: 5622 },
  movements: { transfersIn: 1, transfersOut: 0, paused: 2, stopped: 0 },
  previous: { month: '2026-09', held: { lessons: 90, minutes: 3600 } },
  movesByTeacher: 4,
}

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    for (const [pattern, handler] of routes) if (pattern.test(url)) return handler(url)
    return json({ error: { code: 'unrouted', message: `no mock for ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on(/\/stats\/teachers\?/, () => json({ month: '2026-10', zone: 'Africa/Cairo', teachers: ROWS }))
  on(/\/stats\/teachers\/t-1\?/, () => json(DETAIL))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('who is offered the page', () => {
  it('a Teachers-department supervisor (server says so) sees the Teachers area; an Operations supervisor does not', async () => {
    on(/\/lessons\/access$/, () => json({ lessonManager: true }))
    const { unmount } = renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'admin' }), route: '/' })
    const nav = await screen.findByRole('navigation', { name: 'Jawwid Operations' })
    expect(await within(nav).findByRole('link', { name: 'Teachers' })).toHaveAttribute('href', '/teachers')
    unmount()

    routes = routes.filter(([p]) => !p.test('/lessons/access'))
    on(/\/lessons\/access$/, () => json({ lessonManager: false }))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'admin' }), route: '/' })
    const nav2 = await screen.findByRole('navigation', { name: 'Jawwid Operations' })
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => /\/lessons\/access$/.test(String(u)))).toBe(true))
    expect(within(nav2).queryByText('Teachers')).not.toBeInTheDocument()
  })
})

describe('the statistics', () => {
  it('lists every teacher for the month, with nothing to divide shown as a dash', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers?month=2026-10' })
    const table = await screen.findByRole('table')
    const one = within(table).getByRole('button', { name: 'Teacher One' }).closest('tr')!
    // The row's three figures: late reports (with the on-time rate), student attendance, lessons held of counted.
    expect(within(one).getByText('2')).toBeInTheDocument()
    expect(within(one).getByText('75%')).toBeInTheDocument()
    expect(within(one).getByText('90%')).toBeInTheDocument()
    expect(within(one).getByText('99 / 130')).toBeInTheDocument()
    const two = within(table).getByRole('button', { name: 'Teacher Two' }).closest('tr')!
    expect(within(two).getByText(/Inactive/)).toBeInTheDocument()
    // Nothing to divide: attendance is a dash, and no on-time rate is claimed.
    expect(within(two).getAllByText('—')).toHaveLength(1)
    expect(within(two).queryByText(/on time/)).toBeNull()
    expect(calls(/\/stats\/teachers\?month=2026-10$/)).toBeGreaterThan(0)

    // PD-15 excuses and make-ups, trials, and (PD-31) lessons the teacher moved are in the side sheet.
    await userEvent.click(within(one).getByRole('button', { name: 'Teacher One' }))
    const sheet = await screen.findByRole('dialog', { name: 'Teacher One' })
    const fact = (label: string) => within(sheet).getByText(label).closest('div')!
    expect(await within(sheet).findByText('3 of 7')).toBeInTheDocument()
    expect(within(fact('Student excuses')).getByText('12')).toBeInTheDocument()
    expect(within(fact('Student excuses')).getByText('9 before the start, 3 after')).toBeInTheDocument()
    expect(within(fact('Teacher excuses')).getByText('4')).toBeInTheDocument()
    expect(within(fact('Make-ups completed')).getByText('8 of 9')).toBeInTheDocument()
    const moved = within(fact('Lessons moved by teacher')).getByText('4')
    expect(within(fact('Lessons moved by teacher')).getByText('information only')).toBeInTheDocument()
    expect(moved).not.toHaveClass('is-breach')
  })

  it('orders teachers by need for intervention, each with its reason', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers?month=2026-10' })
    const table = await screen.findByRole('table')
    const one = within(table).getByRole('button', { name: 'Teacher One' }).closest('tr')!
    // A teacher no-show makes the row urgent, whatever the other figures say; the reason says so.
    expect(within(one.closest('tbody')!).getByRole('columnheader', { name: /Urgent/ })).toBeInTheDocument()
    expect(within(one).getByText(/Missed 1 lesson without notice/)).toBeInTheDocument()
    // The no-show is the red figure that put it there.
    expect(within(one).getByText('teacher missed 1')).toHaveClass('is-breach')
    // On an urgent row only its trigger is coloured: late reports below the threshold are not red, and a low on-time rate is not amber.
    expect(within(one).getByText('2')).not.toHaveClass('is-breach')
    expect(within(one).getByText('75%').closest('.tsx-sub')).not.toHaveClass('is-watch')
    const two = within(table).getByRole('button', { name: 'Teacher Two' }).closest('tr')!
    expect(within(two.closest('tbody')!).getByRole('columnheader', { name: /On track/ })).toBeInTheDocument()
    // The thresholds in use are stated under the list.
    expect(screen.getByText(/Urgent: 3 lessons or more without a report, or any teacher no-show\./)).toBeInTheDocument()
  })

  it('the header figures filter the list', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers?month=2026-10' })
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('button', { name: 'Teacher Two' })).toBeInTheDocument()
    const urgent = screen.getByRole('button', { name: /Needs intervention/ })
    expect(within(urgent).getByText('1')).toBeInTheDocument()
    await userEvent.click(urgent)
    expect(urgent).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('table')).queryByRole('button', { name: 'Teacher Two' })).toBeNull()
    expect(within(screen.getByRole('table')).getByRole('button', { name: 'Teacher One' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show every teacher' }))
    expect(within(screen.getByRole('table')).getByRole('button', { name: 'Teacher Two' })).toBeInTheDocument()
  })

  it("the side sheet's one action opens the teacher's supervision chat", async () => {
    on(/\/teachers\/t-1\/supervision-conversation$/, () => json({ conversationId: 'c-9' }))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers?month=2026-10' })
    await userEvent.click(await screen.findByRole('button', { name: 'Teacher One' }))
    const sheet = await screen.findByRole('dialog', { name: 'Teacher One' })
    expect(within(sheet).getByRole('link', { name: 'Open teacher file' })).toHaveAttribute('href', '/teachers/files/t-1')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Message teacher: Teacher One' }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, init]) => /\/teachers\/t-1\/supervision-conversation$/.test(String(u)) && (init as RequestInit | undefined)?.method === 'POST')).toBe(true),
    )
  })

  it('opens one teacher: category cards broken down by length, like the Core dashboard, and what only Chat knows', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers?month=2026-10' })
    await openFullRecord()
    const held = await screen.findByRole('article', { name: 'Lessons held' })
    expect(within(held).getByText('99')).toBeInTheDocument()
    expect(within(held).getByText('63 lessons')).toBeInTheDocument()
    expect(within(held).getByText('40 min')).toBeInTheDocument()
    expect(within(held).getByText('99 lessons, 65.8 h')).toBeInTheDocument()
    // Paused lessons are shown, marked as counted for nobody.
    const paused = screen.getByRole('article', { name: 'Paused' })
    expect(within(paused).getByText(/not counted for or against anyone/)).toBeInTheDocument()
    // What Core never saw.
    const reports = screen.getByRole('article', { name: 'Lesson reports' })
    expect(within(reports).getByText('91%')).toBeInTheDocument()
    expect(within(reports).getByText('90 of 99')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Replies to families' })).getByText('95%')).toBeInTheDocument()
    // Each trial once, by its outcome: the month's breakdown, from Chat's records.
    const trials = screen.getByRole('article', { name: 'Trial lessons' })
    const metric = (label: string) => within(trials).getByText(label).closest('div')!
    expect(within(metric('Total trials')).getByText('7')).toBeInTheDocument()
    expect(within(metric('Conducted')).getByText('5')).toBeInTheDocument()
    expect(within(metric('Subscribed')).getByText('3')).toBeInTheDocument()
    expect(within(metric('Did not subscribe')).getByText('1')).toBeInTheDocument()
    expect(within(metric('Did not attend')).getByText('2')).toBeInTheDocument()
    expect(within(metric('Awaiting an outcome')).getByText('1')).toBeInTheDocument()
    expect(within(metric('Conversion')).getByText('75%')).toBeInTheDocument()
    expect(within(trials).getByText('2 upcoming and 1 cancelled are not counted.')).toBeInTheDocument()
    expect(screen.getByText('60 h held in September 2026')).toBeInTheDocument()
    // PD-31: moving a lesson is information, never a violation.
    const moves = screen.getByRole('article', { name: 'Lessons moved by teacher' })
    expect(within(moves).getByText('4')).toBeInTheDocument()
    expect(within(moves).getByText(/not a violation/)).toBeInTheDocument()
  })

  it('a refusal from the server is shown, not hidden', async () => {
    on(/\/stats\/teachers\?/, () => json({ error: { code: 'COMM.LESSON_DENIED', message: 'teacher statistics belong to the Teachers department' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers' })
    expect(await screen.findByText(/Teachers department|permission|not allowed|forbidden/i)).toBeInTheDocument()
  })
})

describe('the Teachers area', () => {
  it('shows its tabs in the agreed order with Statistics selected at /teachers', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers?month=2026-10' })
    const tabs = await screen.findByRole('navigation', { name: 'Teachers' })
    expect(within(tabs).getAllByRole('link').map((l) => l.textContent)).toEqual([
      // PD-41: Certificates moved to its own page (/certificates).
      'Statistics', 'Needs action', 'Schedules', 'Students', 'Teacher files', 'Supervision',
    ])
    expect(within(tabs).getByRole('link', { name: 'Statistics' })).toHaveAttribute('aria-current', 'page')
    expect(within(tabs).getByRole('link', { name: 'Teacher files' })).toHaveAttribute('href', '/teachers/files')
  })

  it('one tab needs no strip', async () => {
    const saved = TEACHERS_TABS.splice(1)
    try {
      renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers' })
      await screen.findByRole('table')
      expect(screen.queryByRole('navigation', { name: 'Teachers' })).not.toBeInTheDocument()
    } finally {
      TEACHERS_TABS.push(...saved)
    }
  })
})

/** A row opens the teacher's month in a side sheet; the full-page record is one link further. */
async function openFullRecord(link = 'Full month statistics') {
  await userEvent.click(await screen.findByRole('button', { name: 'Teacher One' }))
  const sheet = await screen.findByRole('dialog', { name: 'Teacher One' })
  await userEvent.click(await within(sheet).findByRole('link', { name: link }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

function calls(pattern: RegExp): number {
  return fetchMock.mock.calls.filter(([u]) => pattern.test(String(u))).length
}

// RQA-F2 / RQA-F8 (release-qa walk, 2026-10-31): Arabic counts agree with their number; a
// long delay reads in days and hours; the month is a month; make-ups are counted once.
describe('readable statistics', () => {
  const summary = {
    totalScheduled: 4, conducted: 0, studentAttended: 0, studentNoShow: 0,
    studentExcuses: { total: 0, beforeStart: 0, afterStart: 0 }, teacherExcuses: 0, teacherNoShow: 0, cancelled: 0,
    pending: { total: 4, upcoming: 4, awaitingReport: 0 }, completed: { regular: 0, makeup: 0, total: 0 },
    makeups: { completed: 0, scheduled: 2, total: 2 },
  }

  it('a long median delay reads in days and hours, and the month is named', async () => {
    on(/\/stats\/teachers\/t-1\?/, () => json({ ...DETAIL, reports: { ...DETAIL.reports, medianDelayMinutes: 5506 } }))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers?month=2026-10' })
    await openFullRecord()
    const reports = await screen.findByRole('article', { name: 'Lesson reports' })
    expect(within(reports).getByText('3 days 19 h')).toBeInTheDocument()
    expect(screen.getByText('Teaching statistics — October 2026')).toBeInTheDocument()
  })

  it('in Arabic, a count agrees with its number', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers?month=2026-10', locale: 'ar' })
    await openFullRecord('إحصائيات الشهر كاملة')
    expect(await screen.findByText('63 حصة')).toBeInTheDocument() // 11 and more: the singular
    expect(screen.getByText('5 حصص')).toBeInTheDocument() // 3 to 10: the plural
    expect(screen.queryByText('5 حصة')).toBeNull()
  })

  it('make-ups are counted once: with the month summary shown, no second, closed-only card beside it', async () => {
    on(/\/stats\/teachers\/t-1\?/, () => json({ ...DETAIL, summary: { ...summary } }))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers?month=2026-10' })
    await openFullRecord()
    await screen.findByRole('article', { name: 'Lesson reports' })
    expect(screen.queryByText('Closed make-ups')).toBeNull()
  })

  it('without a month summary the closed make-ups are shown, labelled as closed', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers?month=2026-10' })
    await openFullRecord()
    expect(await screen.findByText('Closed make-ups')).toBeInTheDocument()
    expect(screen.getByText('2 of 3 held')).toBeInTheDocument()
  })
})

