import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { CalendarOptions, CalendarStats, CalendarSummary, CalendarTeacher, CalendarWindow, Totals, WorkPatterns } from './api'
import { ShiftSection } from './ShiftSection'
import { SupervisorColors } from './SupervisorColors'

/**
 * PD-38 Admin Web: the page's side of the contract, through the real routes and
 * API client, with `fetch` answered at the network boundary -- the right
 * request for each view and filter, the layers drawn from the server's
 * intervals, and nothing computed in the browser. What the server counts and
 * who may read it is proven server-side (pd038-schedule-calendar.spec.ts).
 * Synthetic people only (G-16).
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response
let routes: Array<[string, RegExp, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([method, pattern, handler])
const urls = (pattern: RegExp) => fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => pattern.test(u))
const lastQuery = (pattern: RegExp) => new URL(urls(pattern).at(-1)!, 'http://x').searchParams

const totals = (over: Partial<Totals> = {}): Totals => ({
  shiftMinutes: 420, workMinutes: 0, leaveMinutes: 0, bookedMinutes: 90, pausedMinutes: 0,
  inShiftBookedMinutes: 90, inShiftPausedMinutes: 0, inShiftLeaveMinutes: 0, emptyMinutes: 330,
  freeMinutes: 0, outsideMinutes: 0, ...over,
})

const teacher = (id: string, name: string, over: Partial<CalendarTeacher> = {}): CalendarTeacher => ({
  id, name, isActive: true, category: 'full_shift', zone: 'Africa/Cairo', lessons: 2, matching: 2,
  totals: totals(), utilization: 0.214, ...over,
})

const OPTIONS: CalendarOptions = {
  zone: 'Africa/Cairo',
  viewer: { staffId: 'staff_a', scope: 'academy', canEditShifts: true, canEditColors: true },
  palette: [],
  teachers: [{ id: 't-1', name: 'Teacher One', isActive: true, category: 'full_shift', timezone: 'Africa/Cairo' }],
  supervisors: [
    { id: 'sup-1', name: 'Supervisor One', role: 'supervisor', colorKey: 'sky' },
    { id: 'sup-2', name: 'Supervisor Two', role: 'supervisor', colorKey: null },
  ],
  learners: [{ id: 'k-1', name: 'Child Alpha', teacherId: 't-1' }],
}

// Monday 26 Oct 2026: Cairo is UTC+3, so the 12:00-19:00 shift is 09:00-16:00Z.
const WINDOW: CalendarWindow = {
  zone: 'Africa/Cairo',
  from: '2026-10-26',
  to: '2026-10-27',
  lessonFilter: false,
  teachers: [teacher('t-1', 'Teacher One'), teacher('t-2', 'Teacher Two', { category: 'hourly', utilization: null, totals: totals({ shiftMinutes: 0, workMinutes: 240 }) })],
  days: [
    {
      teacherId: 't-1', day: '2026-10-26',
      shift: [['2026-10-26T09:00:00+00:00', '2026-10-26T16:00:00+00:00']],
      work: [], leave: [],
      empty: [['2026-10-26T09:00:00+00:00', '2026-10-26T10:00:00+00:00'], ['2026-10-26T11:30:00+00:00', '2026-10-26T16:00:00+00:00']],
      free: [],
    },
    { teacherId: 't-2', day: '2026-10-26', shift: [], work: [['2026-10-26T13:00:00+00:00', '2026-10-26T17:00:00+00:00']], leave: [], empty: [], free: [] },
  ],
  lessons: [
    {
      id: 'l-1', teacherId: 't-1', startsAt: '2026-10-26T10:00:00Z', endsAt: '2026-10-26T11:00:00Z', kind: 'regular',
      status: 'active', colorKey: 'sky', matches: true, outsideShift: false,
      learner: { id: 'k-1', name: 'Child Alpha' }, prospect: null, outcome: null, suspendedFor: null, movedFrom: null,
    },
    {
      id: 'l-2', teacherId: 't-1', startsAt: '2026-10-26T11:00:00Z', endsAt: '2026-10-26T11:30:00Z', kind: 'trial',
      status: 'trial', colorKey: null, matches: true, outsideShift: false,
      learner: null, prospect: { name: 'Prospect P' }, outcome: null, suspendedFor: null, movedFrom: null,
    },
    { id: 'l-3', teacherId: 't-2', startsAt: '2026-10-26T14:00:00Z', endsAt: '2026-10-26T15:00:00Z', kind: 'regular', status: 'paused', colorKey: 'red', matches: true, outsideShift: false, anonymous: true },
  ],
}

const STATS: CalendarStats = {
  zone: 'Africa/Cairo', from: '2026-10-26', to: '2026-10-27', lessonFilter: false,
  teaching: { lessons: 2, bookedMinutes: 90, heldMinutes: 60 },
  students: { distinct: 1, trial: 1, paused: 1 },
  capacity: {
    shiftMinutes: 420, inShiftBookedMinutes: 90, inShiftPausedMinutes: 0, inShiftLeaveMinutes: 0,
    emptyMinutes: 330, outsideMinutes: 0, workMinutes: 240, freeMinutes: 180, utilization: 0.214,
  },
  teachers: WINDOW.teachers,
}

const SUMMARY: CalendarSummary = {
  zone: 'Africa/Cairo', from: '2026-10-01', to: '2026-11-01', lessonFilter: false,
  teachers: [teacher('t-1', 'Teacher One')],
  cells: [{ teacherId: 't-1', day: '2026-10-26', lessons: 2, matching: 2, ...totals(), utilization: 0.214 }],
}

const manager = makeStaff({ role: 'manager' })

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
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: true, calendar: true }))
  on('GET', /\/calendar\/options$/, () => json(OPTIONS))
  on('GET', /\/calendar\?/, () => json(WINDOW))
  on('GET', /\/calendar\/stats\?/, () => json(STATS))
  on('GET', /\/calendar\/summary\?/, () => json(SUMMARY))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the academy schedule', () => {
  it('a day: each teacher\'s row, the shift and red empty time from the server\'s intervals, lessons by status and color', async () => {
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/schedule?view=day&date=2026-10-26' })
    const row = await screen.findByRole('row', { name: 'Teacher One' })
    expect(lastQuery(/\/calendar\?/).get('from')).toBe('2026-10-26')
    expect(lastQuery(/\/calendar\?/).get('to')).toBe('2026-10-27')

    const active = within(row).getByRole('button', { name: /Child Alpha · 13:00–14:00 · Active/ })
    expect(active).toHaveClass('sc-c-sky', 'sc-lesson--active')
    expect(within(row).getByRole('button', { name: /Prospect P .* Trial/ })).toHaveClass('sc-lesson--trial')
    // Two empty stretches, drawn as red outlines; the shift band behind them.
    expect(row.querySelectorAll('.sc-empty')).toHaveLength(2)
    expect(row.querySelectorAll('.sc-band--shift')).toHaveLength(1)
    // Another supervisor's child: "Booked", time and color only.
    const other = within(screen.getByRole('row', { name: 'Teacher Two' })).getByRole('button', { name: /^Booked · 17:00–18:00 · Temporarily paused/ })
    expect(other).toHaveClass('sc-c-red', 'sc-lesson--paused')
  })

  it('the stats bar reads the same filters, and the legend names each supervisor\'s color', async () => {
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/schedule?view=day&date=2026-10-26' })
    const stats = await screen.findByRole('region', { name: 'Figures for this view' })
    expect(within(stats).getByText('Teaching hours').parentElement).toHaveTextContent('1.5 h')
    expect(within(stats).getByText('Shift used').parentElement).toHaveTextContent('21%')
    expect(within(stats).getByText('Empty in shift').parentElement).toHaveTextContent('5.5 h')
    expect(lastQuery(/\/calendar\/stats\?/).toString()).toBe(lastQuery(/\/calendar\?/).toString())
    const legend = screen.getByRole('region', { name: 'Legend' })
    expect(within(legend).getByRole('button', { name: 'Supervisor One' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(legend).getByText('Available time without a student')).toBeInTheDocument()
    expect(within(legend).getByText('Outside the shift')).toBeInTheDocument()
  })

  it('every filter combines into the one query the calendar and the stats share', async () => {
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/schedule?view=day&date=2026-10-26' })
    await screen.findByRole('row', { name: 'Teacher One' })
    const filters = screen.getByRole('group', { name: 'Filters' })
    await userEvent.click(within(filters).getByLabelText('Category', { selector: 'summary' }))
    await userEvent.click(within(filters).getByRole('checkbox', { name: 'Full shift' }))
    await userEvent.click(within(screen.getByRole('region', { name: 'Legend' })).getByRole('button', { name: 'Supervisor One' }))
    await waitFor(() => expect(lastQuery(/\/calendar\?/).get('supervisorIds')).toBe('sup-1'))
    expect(lastQuery(/\/calendar\?/).get('categories')).toBe('full_shift')
    expect(lastQuery(/\/calendar\/stats\?/).get('categories')).toBe('full_shift')
    expect(lastQuery(/\/calendar\/stats\?/).get('supervisorIds')).toBe('sup-1')
    await userEvent.click(screen.getByRole('button', { name: /Clear all/ }))
    await waitFor(() => expect(lastQuery(/\/calendar\?/).get('categories')).toBeNull())
  })

  it('the month view asks for the summary; a day cell opens that day', async () => {
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/schedule?view=week&date=2026-10-26' })
    await screen.findByRole('row', { name: 'Teacher One' })
    expect(lastQuery(/\/calendar\?/).get('from')).toBe('2026-10-24') // Saturday
    await userEvent.click(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Month' }))
    const cell = await screen.findByRole('button', { name: /Open Teacher One, Monday 26 October/ })
    expect(lastQuery(/\/calendar\/summary\?/).get('from')).toBe('2026-10-01')
    expect(cell).toHaveTextContent('21%')
    expect(cell).toHaveClass('sc-heat--has-empty')
    await userEvent.click(cell)
    await waitFor(() => expect(lastQuery(/\/calendar\?/).get('from')).toBe('2026-10-26'))
    expect(lastQuery(/\/calendar\?/).get('to')).toBe('2026-10-27')
  })

  it('a lesson opens its details, with the student\'s profile one click away', async () => {
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/schedule?view=day&date=2026-10-26' })
    await userEvent.click(await screen.findByRole('button', { name: /Child Alpha · 13:00–14:00/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Child Alpha' })
    expect(within(dialog).getByRole('link', { name: 'Open student profile' })).toHaveAttribute('href', '/students/k-1')
    expect(dialog).toHaveTextContent('Supervisor One')
  })

  it('an Operations supervisor opens on their own students', async () => {
    on('GET', /\/calendar\/options$/, () => json({ ...OPTIONS, viewer: { staffId: 'staff_a', scope: 'supervisor', canEditShifts: false, canEditColors: false } }))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'admin' }), route: '/schedule?view=day&date=2026-10-26' })
    await waitFor(() => expect(lastQuery(/\/calendar\?/).get('supervisorIds')).toBe('staff_a'))
    expect(await screen.findByText(/Showing your students/)).toBeInTheDocument()
  })

  it('in Arabic the page is right to left and the time axis follows it', async () => {
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/schedule?view=day&date=2026-10-26', locale: 'ar' })
    const row = await screen.findByRole('row', { name: 'Teacher One' })
    expect(document.documentElement.dir).toBe('rtl')
    const band = row.querySelector<HTMLElement>('.sc-band--shift')!
    // Logical, never left/right: under rtl it starts from the right.
    expect(band.style.insetInlineStart).not.toBe('')
    expect(band.style.left).toBe('')
    expect(screen.getByRole('heading', { level: 1, name: 'الجدول' })).toBeInTheDocument()
  })
})

describe('the shift, in the Teacher File', () => {
  const PATTERNS: WorkPatterns = {
    teacherId: 't-1',
    patterns: [{
      id: 'p-1', category: 'full_shift', timezone: 'Africa/Cairo', validFrom: '2026-09-01', validTo: null, reason: null,
      createdAt: '2026-09-01T00:00:00Z', windows: [6, 7, 1, 2, 3, 4].map((weekday) => ({ weekday, start: '12:00', end: '19:00' })),
    }],
    defaults: {
      full_shift: { start: '12:00', end: '19:00', weekdays: [6, 7, 1, 2, 3, 4] },
      part_shift: { start: '14:00', end: '18:00', weekdays: [6, 7, 1, 2, 3, 4] },
    },
  }

  it('shows the shift by day; the Teachers Manager changes it to a part shift from a day, with the defaults', async () => {
    on('GET', /\/teachers\/t-1\/work-pattern$/, () => json(PATTERNS))
    on('POST', /\/teachers\/t-1\/work-pattern$/, () => json(PATTERNS, 201))
    renderWithProviders(<ShiftSection teacherId="t-1" />, { staff: manager })
    expect(await screen.findByText('Full shift')).toBeInTheDocument()
    expect(screen.getByText('Friday').nextElementSibling).toHaveTextContent('Off')
    await userEvent.click(screen.getByRole('button', { name: 'Change shift' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Part shift' }))
    const from = within(dialog).getByLabelText(/^From/) as HTMLInputElement
    await userEvent.clear(from)
    await userEvent.type(from, '2026-11-01')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit)?.method === 'POST')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'POST')!
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({ category: 'part_shift', timezone: 'Africa/Cairo', validFrom: '2026-11-01', applyToAvailability: true })
    expect(body.windows).toHaveLength(6)
    expect(body.windows[0]).toEqual({ weekday: 6, start: '14:00', end: '18:00' })
  })

  it('a refusal is shown in words, and nothing else changes', async () => {
    on('GET', /\/teachers\/t-1\/work-pattern$/, () => json(PATTERNS))
    on('POST', /\/teachers\/t-1\/work-pattern$/, () =>
      json({ error: { code: 'COMM.LESSON_STATE', message: 'a pattern begins on 2026-12-01; a change can begin on or after that day' } }, 409))
    renderWithProviders(<ShiftSection teacherId="t-1" />, { staff: manager })
    await userEvent.click(await screen.findByRole('button', { name: 'Change shift' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A later change already exists')
  })

  it('a reader without the right to change it sees no button', async () => {
    on('GET', /\/calendar\/options$/, () => json({ ...OPTIONS, viewer: { ...OPTIONS.viewer, canEditShifts: false } }))
    on('GET', /\/teachers\/t-1\/work-pattern$/, () => json(PATTERNS))
    renderWithProviders(<ShiftSection teacherId="t-1" />, { staff: manager })
    expect(await screen.findByText('Full shift')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change shift' })).toBeNull()
  })
})

describe('supervisor colors, on the Organization page', () => {
  it('the Operations Manager picks a palette color; null clears it', async () => {
    on('POST', /\/org\/staff\/sup-2\/calendar-color$/, () => json({ ...OPTIONS.supervisors[1], colorKey: 'green' }, 201))
    renderWithProviders(<SupervisorColors />, { staff: manager })
    const group = await screen.findByRole('group', { name: 'Color for Supervisor Two' })
    await userEvent.click(within(group).getByRole('button', { name: 'Green' }))
    await waitFor(() => expect(urls(/calendar-color/)).toHaveLength(1))
    const [, init] = fetchMock.mock.calls.find(([u]) => /calendar-color/.test(String(u)))!
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ colorKey: 'green' })
    expect(within(screen.getByRole('group', { name: 'Color for Supervisor One' })).getByRole('button', { name: 'Light blue' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('anyone else reads the colors and cannot change them', async () => {
    on('GET', /\/calendar\/options$/, () => json({ ...OPTIONS, viewer: { ...OPTIONS.viewer, canEditColors: false } }))
    renderWithProviders(<SupervisorColors />, { staff: manager })
    expect(await screen.findByText('Light blue')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Color for/ })).toBeNull()
  })

  it('is not shown to someone without the schedule', async () => {
    on('GET', /\/calendar\/options$/, () => json({ error: { code: 'COMM.LESSON_DENIED', message: 'no' } }, 403))
    const { container } = renderWithProviders(<SupervisorColors />, { staff: manager })
    await waitFor(() => expect(urls(/calendar\/options/).length).toBeGreaterThan(0))
    expect(container.querySelector('.sc-colors')).toBeNull()
  })
})
