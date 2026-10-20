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
    expect(await within(nav).findByRole('link', { name: /^Teachers/ })).toHaveAttribute('href', '/teachers')
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
    expect(within(one).getByText('99 lessons · 65.8 h')).toBeInTheDocument()
    expect(within(one).getByText('90%')).toBeInTheDocument()
    const two = within(table).getByRole('button', { name: 'Teacher Two' }).closest('tr')!
    expect(within(two).getByText(/Inactive/)).toBeInTheDocument()
    expect(within(two).getAllByText('—')).toHaveLength(2)
    // Trials this month, and how many subscribed.
    const cells = within(one).getAllByRole('cell').map((c) => c.textContent)
    expect(cells.slice(-2)).toEqual(['7', '3'])
    expect(calls(/\/stats\/teachers\?month=2026-10$/)).toBeGreaterThan(0)
  })

  it('opens one teacher: category cards broken down by length, like the Core dashboard, and what only Chat knows', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'manager' }), route: '/teachers?month=2026-10' })
    await userEvent.click(await screen.findByRole('button', { name: 'Teacher One' }))
    const held = await screen.findByRole('article', { name: 'Completed lessons' })
    expect(within(held).getByText('99')).toBeInTheDocument()
    expect(within(held).getByText('63 lessons')).toBeInTheDocument()
    expect(within(held).getByText('40 min')).toBeInTheDocument()
    expect(within(held).getByText('99 lessons · 65.8 h')).toBeInTheDocument()
    // Paused lessons are shown, marked as counted for nobody.
    const paused = screen.getByRole('article', { name: 'Paused' })
    expect(within(paused).getByText(/not counted for or against anyone/)).toBeInTheDocument()
    // What Core never saw.
    expect(within(screen.getByRole('article', { name: 'Lesson reports' })).getByText('91% · 90/99')).toBeInTheDocument()
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
    expect(screen.getByText('60 h held in 2026-09')).toBeInTheDocument()
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
      'Statistics', 'Needs action', 'Schedules', 'Students', 'Teacher files', 'Certificates', 'Leave requests', 'Discipline',
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

function calls(pattern: RegExp): number {
  return fetchMock.mock.calls.filter(([u]) => pattern.test(String(u))).length
}
