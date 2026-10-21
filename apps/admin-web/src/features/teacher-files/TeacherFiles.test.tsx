import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { TeacherFile, TeacherSummary } from './api'

/**
 * PD-10 Teacher Files, through the real routes and the real API client, with
 * `fetch` answered at the network boundary. These prove the page's side of
 * the contract: the navigation follows the server's answer, the controls
 * follow `access`, and requests carry what the server expects. Who may do
 * what is proven server-side (apps/api test/integration/teacher-file.spec.ts).
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
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body))

const TEACHERS: TeacherSummary[] = [
  { id: 't-1', name: 'Teacher One', isActive: true, studentCount: 2, openComplaints: 1 },
  { id: 't-2', name: 'Teacher Two', isActive: false, studentCount: 0, openComplaints: 0 },
]

const brief = (id: string, body: string) => ({ id, body, createdAt: '2026-10-18T09:00:00Z', author: { id: 's-1', name: 'Supervisor One' } })

function file(access = { canEditPersonal: false, canWriteSupervision: true }): TeacherFile {
  return {
    access,
    teacher: { id: 't-1', name: 'Teacher One', isActive: true, leftAt: null },
    personal: {
      fullName: 'Teacher One',
      phone: '+20 100 555 0147',
      email: 'teacher.one@example.test',
      joinedOn: '2025-09-01',
      updatedAt: '2026-10-18T09:00:00Z',
      updatedBy: { id: 'm-1', name: 'Teachers Manager' },
    },
    assignedStudents: [
      { learnerId: 'l-1', name: 'Child Alpha', level: 'A2', family: { id: 'f-1', displayName: 'Family One' }, supervisor: { id: 's-9', name: 'Ops Supervisor' } },
    ],
    supervision: {
      complaints: [{ ...brief('c-1', 'Started late.'), source: null, resolution: null }],
      monthlyComments: [{ month: '2026-09', current: brief('m-2', 'Strong month.'), earlierVersions: [brief('m-1', 'Draft.')] }],
      daysOff: [{ ...brief('d-1', 'Family matter.'), date: '2026-10-21', cancellation: null }],
    },
  }
}

const teachersSupervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })
const teachersManager = makeStaff({ id: 'm-1', name: 'Teachers Manager', role: 'manager' })

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
  on('GET', /\/teacher-files$/, () => json({ access: { canEditPersonal: false, canWriteSupervision: true }, teachers: TEACHERS }))
  on('GET', /\/teacher-files\/t-1$/, () => json(file()))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the Teachers area', () => {
  // Navigation to the area is gated by T5's GET /lessons/access (TeacherStatsPage.test);
  // here: the Teacher files are one of its tabs.
  it('offers Teacher files as a tab of the Teachers area', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files' })
    const tabs = await screen.findByRole('navigation', { name: 'Teachers' })
    expect(within(tabs).getByRole('link', { name: 'Teacher files' })).toHaveAttribute('href', '/teachers/files')
    expect(within(tabs).getByRole('link', { name: 'Statistics' })).toHaveAttribute('href', '/teachers')
  })
})

describe('the list', () => {
  it('lists every teacher with counts and status, each linking to its file', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files' })
    const table = await screen.findByRole('table')
    const one = within(table).getByRole('link', { name: /^Teacher One/ })
    expect(one).toHaveAttribute('href', '/teachers/files/t-1')
    const two = within(table).getByText('Teacher Two').closest('tr')!
    expect(within(two).getByText('Left')).toBeInTheDocument()
    expect(screen.queryByText(/example\.test|0147/)).not.toBeInTheDocument()
  })

  it("shows the server's refusal as it is", async () => {
    on('GET', /\/teacher-files$/, () => json({ error: { code: 'COMM.TEACHER_FILE_DENIED', message: 'Teacher Files are administration-only' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files' })
    expect(await screen.findByText('Teacher Files are for the Teachers department and the super admin.')).toBeInTheDocument()
  })
})

describe('a teacher file', () => {
  it('shows every section; the joining date is the same calendar day in any time zone', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1' })
    expect(await screen.findByRole('heading', { level: 1, name: /^Teacher One/ })).toBeInTheDocument()
    const personal = screen.getByRole('region', { name: 'Personal information' })
    expect(within(personal).getByText('+20 100 555 0147')).toBeInTheDocument()
    expect(within(personal).getByText('1 Sept 2025')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Assigned students (1)' })).getByText('Child Alpha')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Complaints' })).getByText('Started late.')).toBeInTheDocument()
    const monthly = screen.getByRole('region', { name: 'Monthly performance' })
    expect(within(monthly).getByText('September 2026')).toBeInTheDocument()
    expect(within(monthly).getByText('1 earlier version(s)')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Days off' })).getByText('21 Oct 2026')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Not here yet' })).toHaveTextContent(/Salary/)
  })

  it('offers only the controls the server grants: a supervisor writes notes but cannot edit personal information', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1' })
    await screen.findByRole('heading', { level: 1, name: /^Teacher One/ })
    expect(screen.queryByRole('button', { name: 'Edit personal information' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record a complaint' })).toBeInTheDocument()
  })

  it('records a complaint resolution against the complaint it resolves', async () => {
    on('POST', /\/teacher-files\/t-1\/entries$/, () => json({ id: 'r-1', kind: 'complaint_resolution', createdAt: '2026-10-18T10:00:00Z' }, 201))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Required.')).toBeInTheDocument()
    expect(calls('POST', /\/entries$/)).toHaveLength(0)

    await userEvent.type(within(dialog).getByRole('textbox', { name: 'How it was resolved' }), 'Discussed with the teacher.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/entries$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/entries$/)[0]!)).toEqual({
      kind: 'complaint_resolution',
      body: 'Discussed with the teacher.',
      refersTo: 'c-1',
    })
  })

  it("keeps the dialog open with the server's conflict", async () => {
    on('POST', /\/teacher-files\/t-1\/entries$/, () =>
      json({ error: { code: 'COMM.TEACHER_FILE_CONFLICT', message: 'this day off is already recorded' } }, 409),
    )
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Record a day off' }))
    const dialog = await screen.findByRole('dialog')
    const day = dialog.querySelector('input[type="date"]') as HTMLInputElement
    await userEvent.type(day, '2026-10-21')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Details' }), 'Again.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Already recorded/)
    expect(bodyOf(calls('POST', /\/entries$/)[0]!)).toEqual({ kind: 'day_off', body: 'Again.', dayOffOn: '2026-10-21' })
  })

  it('the Teachers manager edits personal information: only changed fields are sent, an emptied one as null, with a reason', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(file({ canEditPersonal: true, canWriteSupervision: true })))
    on('POST', /\/teacher-files\/t-1\/personal$/, () => json(file({ canEditPersonal: true, canWriteSupervision: true }), 201))
    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/teachers/files/t-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit personal information' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Email address' }))
    const phone = within(dialog).getByRole('textbox', { name: 'Phone number' })
    await userEvent.clear(phone)
    await userEvent.type(phone, '+20 111 222 3333')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(calls('POST', /\/personal$/)).toHaveLength(0)
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason for the change' }), 'new SIM')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/personal$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/personal$/)[0]!)).toEqual({ phone: '+20 111 222 3333', email: null, reason: 'new SIM' })
  })

  it('reads in Arabic, right to left', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1', locale: 'ar' })
    expect(await screen.findByRole('region', { name: 'البيانات الشخصية' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'الشكاوى' })).toBeInTheDocument()
    expect(document.documentElement.dir === 'rtl' || document.querySelector('[dir="rtl"]')).toBeTruthy()
  })
})

describe('the supervision timeline', () => {
  const timeline = {
    teacher: { id: 't-1', name: 'Teacher One' },
    items: [
      { id: 'b-1', type: 'bonus', at: '2026-10-18T10:00:00Z', body: 'Every report on time.', by: 's-1', byName: 'Supervisor One' },
      { id: 'l-9', type: 'teacher_no_show', at: '2026-10-15T08:00:00Z', body: null, lesson: { id: 'l-9', startsAt: '2026-10-15T08:00:00Z', learnerName: 'Child Alpha' } },
      { id: 'c-1', type: 'complaint', at: '2026-10-10T09:00:00Z', body: 'Started late.', by: 's-1', byName: 'Supervisor One' },
      { id: 'd-1', type: 'day_off', at: '2026-10-01T09:00:00Z', day: '2026-10-21', body: 'Leave: wedding', by: 's-1', byName: 'Supervisor One' },
    ],
  }

  it('shows every record in one line, with who recorded it, and filters by kind', async () => {
    on('GET', /\/teachers\/t-1\/supervision$/, () => json(timeline))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1' })
    const section = await screen.findByRole('region', { name: 'Supervision timeline' })
    expect(within(section).getByText('Every report on time.')).toBeInTheDocument()
    expect(within(section).getAllByText(/Supervisor One/).length).toBeGreaterThan(0)
    expect(within(section).getByText('Teacher absent')).toBeInTheDocument()
    expect(within(section).getByText(/Child Alpha/)).toBeInTheDocument()

    await userEvent.click(within(section).getByRole('button', { name: /Complaints/ }))
    expect(within(section).getByText('Started late.')).toBeInTheDocument()
    expect(within(section).queryByText('Every report on time.')).not.toBeInTheDocument()
  })

  it('records a bonus with its reason only -- the amount is payroll\'s -- and a note', async () => {
    on('GET', /\/teachers\/t-1\/supervision$/, () => json(timeline))
    on('POST', /\/teachers\/t-1\/bonus$/, () => json({ id: 'b-2', kind: 'bonus', conversationId: 'sv-1' }, 201))
    on('POST', /\/teachers\/t-1\/supervision$/, () => json({ id: 'n-1', kind: 'note' }, 201))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1' })
    const section = await screen.findByRole('region', { name: 'Supervision timeline' })

    await userEvent.click(within(section).getByRole('button', { name: 'Record a bonus' }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/never here/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(calls('POST', /\/bonus$/)).toHaveLength(0)
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Why the bonus' }), 'Two trial students stayed')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/bonus$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/bonus$/)[0]!)).toEqual({ reason: 'Two trial students stayed' })

    await userEvent.click(within(section).getByRole('button', { name: 'Add a note' }))
    dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'Covering Saturdays in November')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/teachers\/t-1\/supervision$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/teachers\/t-1\/supervision$/)[0]!)).toEqual({ kind: 'note', body: 'Covering Saturdays in November' })
  })

  it('offers no actions to a reader who cannot write, and is absent when the server refuses', async () => {
    on('GET', /\/teachers\/t-1\/supervision$/, () => json(timeline))
    on('GET', /\/teacher-files\/t-1$/, () => json(file({ canEditPersonal: false, canWriteSupervision: false })))
    const { unmount } = renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1' })
    const section = await screen.findByRole('region', { name: 'Supervision timeline' })
    expect(within(section).queryByRole('button', { name: 'Record a bonus' })).not.toBeInTheDocument()
    unmount()

    on('GET', /\/teachers\/t-1\/supervision$/, () => json({ error: { code: 'COMM.LESSON_DENIED', message: 'no' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1' })
    await screen.findByRole('region', { name: 'Personal information' })
    await waitFor(() => expect(calls('GET', /\/teachers\/t-1\/supervision$/).length).toBeGreaterThan(1))
    expect(screen.queryByRole('region', { name: 'Supervision timeline' })).not.toBeInTheDocument()
  })
})

describe('schedule and monthly performance', () => {
  const availability = {
    teacherId: 't-1',
    timezone: 'Africa/Cairo',
    windows: [
      { weekday: 3, start: '18:00', end: '21:00' },
      { weekday: 1, start: '16:00', end: '20:00' },
    ],
    daysOff: [],
  }
  const lesson = {
    id: 'ls-1',
    learner: { id: 'l-1', name: 'Child Alpha' },
    teacher: { id: 't-1', name: 'Teacher One' },
    kind: 'makeup',
    makeupFor: 'ls-0',
    startsAt: '2026-10-22T16:00:00Z',
    endsAt: '2026-10-22T16:30:00Z',
    durationMinutes: 30,
    phase: 'overdue',
    outcome: null,
    outcomeNote: null,
  }
  const stats = (attendance: number | null) => ({
    teacher: { id: 't-1', name: 'Teacher One' },
    month: '2026-10',
    zone: 'Africa/Cairo',
    categories: [{ key: 'held', counted: true, lessons: 12, minutes: 360, byDuration: [] }],
    totals: { counted: { lessons: 12, minutes: 360 }, scheduledMinutes: 600 },
    makeups: { lessons: 0, held: 0 },
    trials: { total: 0, conducted: 0, subscribed: 0, notSubscribed: 0, noShow: 0, awaiting: 0, upcoming: 0, cancelled: 0, conversionRate: null },
    rates: { attendance, completion: null, teacherReliability: null },
    reports: { reports: 12, onTime: 9, onTimeRate: 0.75, medianDelayMinutes: 40 },
    replies: { familyMessages: 4, answeredWithin: 4, rate: 1, medianReplyMinutes: 12 },
    workload: { availableMinutes: 1200, scheduledMinutes: 600, freeMinutes: 600 },
    previous: { month: '2026-09', held: { lessons: 10, minutes: 300 } },
  })

  beforeEach(() => {
    on('GET', /\/teachers\/t-1\/availability$/, () => json(availability))
    on('GET', /\/lessons\?/, () => json({ lessons: [lesson] }))
    on('GET', /\/stats\/teachers\/t-1\?month=/, (url) => json(stats(url.includes('2026-09') ? 0.5 : 0.9)))
  })

  it("shows the teacher's working hours and next lessons, read from the Schedules routes", async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1' })
    const section = await screen.findByRole('region', { name: 'Schedule' })
    expect(await within(section).findByText('16:00–20:00')).toBeInTheDocument()
    const days = within(section).getAllByRole('term').map((d) => d.textContent)
    expect(days).toEqual(['Monday', 'Wednesday'])
    expect(within(section).getByText('Times in Africa/Cairo')).toBeInTheDocument()
    const row = (await within(section).findByText('Child Alpha')).closest('tr')!
    expect(within(row).getByText('Make-up')).toBeInTheDocument()
    expect(within(row).getByText('Report overdue')).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Edit in Schedules' })).toHaveAttribute('href', '/teachers/schedules?teacher=t-1')
    const query = new URL(String(calls('GET', /\/lessons\?/)[0]![0]), 'http://admin.test').searchParams
    expect(query.get('teacherId')).toBe('t-1')
    expect(new Date(query.get('to')!).getTime() - new Date(query.get('from')!).getTime()).toBe(14 * 86_400_000)
  })

  it("shows the month's KPIs, a rate the server could not compute as a dash, and follows the month picked", async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersSupervisor, route: '/teachers/files/t-1' })
    const section = await screen.findByRole('region', { name: 'Monthly performance' })
    await within(section).findByLabelText('Key indicators')
    // Re-found each time: a new month replaces the list.
    const value = (label: string) => within(within(section).getByLabelText('Key indicators')).getByText(label).closest('div')!.querySelector('strong')!.textContent
    expect(value('Lessons held')).toBe('12')
    expect(value('Student attendance')).toBe('90%')
    expect(value('Teacher reliability')).toBe('—')
    expect(value('Reports on time')).toBe('75%')
    expect(within(section).getByText('Strong month.')).toBeInTheDocument()

    const picker = within(section).getByLabelText('Month')
    fireEvent.change(picker, { target: { value: '2026-09' } })
    await waitFor(() => expect(value('Student attendance')).toBe('50%'))
    expect(within(section).getByRole('link', { name: 'Full statistics for this month' })).toHaveAttribute('href', '/teachers?teacher=t-1&month=2026-09')
  })

  it("the super admin's copy of the file shows the same sections without links into the Teachers area", async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'super_admin' }), route: '/admin/teachers/t-1' })
    const schedule = await screen.findByRole('region', { name: 'Schedule' })
    expect(await within(schedule).findByText('Child Alpha')).toBeInTheDocument()
    expect(within(schedule).queryByRole('link')).not.toBeInTheDocument()
    const monthly = screen.getByRole('region', { name: 'Monthly performance' })
    await within(monthly).findByLabelText('Key indicators')
    expect(within(monthly).queryByRole('link')).not.toBeInTheDocument()
  })
})
