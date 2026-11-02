import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { destinationsFor, entriesOf } from '@/app/navigation'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { Violation } from '@/features/discipline/api'
import type { TeacherRecordsAccess } from './api'

/**
 * PD-52 PR-3, the Attendance & Complaints page (page A): the nav entry exists
 * only on the server's answer, the old Teacher Supervision links land on
 * their section, and the page offers what GET /teacher-records/access says --
 * no more. The sections themselves are PD-26's, proven in
 * features/teacher-supervision/TeacherSupervision.test.tsx through these same
 * routes. Synthetic people only.
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
const asked = (pattern: RegExp) => fetchMock.mock.calls.some(([u]) => pattern.test(String(u)))

const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })
const ALL: TeacherRecordsAccess = {
  basis: 'teachers',
  attendance: { view: true, record: true, decide: true },
  grants: { view: true, record: true },
  leaveBalance: true,
  amounts: false,
  opensFile: true,
}

function excuse(over: Partial<Violation> = {}): Violation {
  return {
    id: 'v-1',
    kind: 'teacher_apology',
    teacher: { id: 't-1', name: 'Teacher One' },
    lesson: { id: 'l-1', kind: 'regular', startsAt: '2026-10-15T16:00:00Z', learnerName: 'Child Alpha', note: null, excuseCategory: 'illness' },
    occurredAt: '2026-10-15T16:00:00Z',
    month: '2026-10',
    lateMinutes: null,
    note: null,
    recordedBy: null,
    step: 1,
    suggestedDecision: 'warning',
    decision: null,
    decisionNote: null,
    decidedBy: null,
    decidedAt: null,
    suspension: null,
    ...over,
  } as Violation
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
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: true, sales: false, operations: false, calendar: true, supervisionPage: true }))
  on('GET', /\/teacher-records\/access$/, () => json(ALL))
  on('GET', /\/teacher-leave-overview$/, () => json({ year: 2026, teachers: [] }))
  on('GET', /\/teacher-leave-requests\?state=requested$/, () => json({ requests: [] }))
  on('GET', /\/discipline\/violations\?state=open&kind=absences$/, () => json({ violations: [excuse()] }))
  on('GET', /\/discipline\/violations\?state=open&kind=late$/, () => json({ violations: [] }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('PD-52: the nav entry', () => {
  const entry = (role: 'admin' | 'manager' | 'super_admin', teacherAttendance: boolean) =>
    destinationsFor(role, { teacherAttendance })
      .flatMap((d) => d.groups.map((g) => ({ dest: d.key, group: g })))
      .flatMap(({ dest, group }) => group.entries.map((e) => ({ dest, heading: group.label?.en ?? null, key: e.key, path: e.path })))
      .find((e) => e.key === 'teacher-attendance')

  it('is offered under People, in its own Teacher records group, only when the server says so', () => {
    expect(entry('admin', true)).toEqual({ dest: 'people', heading: 'Teacher records', key: 'teacher-attendance', path: '/teacher-attendance' })
    expect(entry('manager', true)?.path).toBe('/teacher-attendance')
    expect(entry('admin', false)).toBeUndefined()
    expect(entry('manager', false)).toBeUndefined()
  })

  it('the super admin has it in the Admin Portal', () => {
    expect(entry('super_admin', false)).toEqual({ dest: 'people', heading: 'Teacher records', key: 'teacher-attendance', path: '/admin/teacher-attendance' })
    expect(destinationsFor('super_admin').flatMap(entriesOf).filter((e) => e.key === 'teacher-attendance')).toHaveLength(1)
  })
})

describe('PD-52: the old links land on their section', () => {
  it.each([
    ['/teachers/supervision', 'Leave'],
    ['/teachers/supervision?section=absences', 'Excuses & absences'],
    ['/teachers/supervision?section=lateness', 'Lateness'],
    ['/teachers/supervision?section=complaints', 'Complaints'],
    ['/teachers/leave', 'Leave'],
    ['/teachers/discipline', 'Excuses & absences'],
  ])('%s -> Attendance & complaints, %s', async (route, section) => {
    on('GET', /\/teacher-files\/complaints/, () => json({ access: { canEditPersonal: false, canWriteSupervision: true, canViewFinance: false }, complaints: [] }))
    on('GET', /\/discipline\/violations\?state=open&kind=complaints$/, () => json({ violations: [] }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route })
    expect(await screen.findByRole('heading', { name: 'Attendance & complaints' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: section, pressed: true })).toBeInTheDocument()
  })

  it('the super admin\'s old links land on the Admin Portal\'s page', async () => {
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'super_admin' }), route: '/admin/teachers/discipline' })
    expect(await screen.findByRole('heading', { name: 'Attendance & complaints' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Excuses & absences', pressed: true })).toBeInTheDocument()
  })

  it('grants and the parents\' feedback stay on the Supervision page until page B', async () => {
    on('GET', /\/teacher-files\/rewards/, () => json({ canViewAmounts: false, rewards: [] }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/supervision?section=rewards' })
    expect(await screen.findByRole('heading', { name: 'Teacher supervision' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Attendance & complaints' })).not.toBeInTheDocument()
  })
})

describe('PD-52: the page offers what the server answers', () => {
  it('excuses show PD-50\'s reason, the Decide button and Record an absence', async () => {
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-attendance?section=excuses' })
    const row = (await screen.findByText('Teacher One')).closest('tr')!
    expect(within(row).getByText('Illness')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Decide' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record an absence' })).toBeInTheDocument()
  })

  it('without decide: no Decide button; without record: no Record buttons', async () => {
    on('GET', /\/teacher-records\/access$/, () => json({ ...ALL, attendance: { view: true, record: false, decide: false } }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-attendance?section=excuses' })
    const row = (await screen.findByText('Teacher One')).closest('tr')!
    expect(within(row).getByText('Suggested: Warning')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Decide' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record an absence' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Lateness' }))
    expect(await screen.findByRole('button', { name: 'Lateness', pressed: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record lateness' })).not.toBeInTheDocument()
  })

  it('without the view key the page says so and reads nothing', async () => {
    on('GET', /\/teacher-records\/access$/, () => json({ ...ALL, attendance: { view: false, record: false, decide: false } }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-attendance' })
    expect(await screen.findByText('This page is not part of your work.')).toBeInTheDocument()
    expect(asked(/\/teacher-leave-overview/)).toBe(false)
  })

  it('suggestions sit behind a filter on Complaints, as the parents\' feedback of that category', async () => {
    on('GET', /\/teacher-files\/complaints/, () => json({ access: { canEditPersonal: false, canWriteSupervision: true, canViewFinance: false }, complaints: [] }))
    on('GET', /\/discipline\/violations\?state=open&kind=complaints$/, () => json({ violations: [] }))
    on('GET', /\/parent-feedback\?category=suggestion$/, () =>
      json({
        canWrite: true,
        feedback: [
          {
            id: 'pf-1',
            familyId: 'f-1',
            parent: { id: 'p-1', name: 'Parent Alpha' },
            child: { id: 'k-1', name: 'Child One' },
            teacher: { id: 't-1', name: 'Teacher One' },
            category: 'suggestion',
            body: 'More homework, please.',
            status: 'received',
            response: null,
            respondedBy: null,
            respondedAt: null,
            createdAt: '2026-10-25T09:00:00Z',
            complaint: null,
          },
        ],
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-attendance?section=complaints' })
    await userEvent.click(await screen.findByRole('button', { name: 'Suggestions' }))
    expect(await screen.findByText('More homework, please.')).toBeInTheDocument()
    // One category, so no category filter.
    expect(screen.queryByRole('button', { name: 'Praise' })).not.toBeInTheDocument()
  })

  it('reads in Arabic', async () => {
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teacher-attendance?section=excuses', locale: 'ar' })
    expect(await screen.findByRole('heading', { name: 'الحضور والتأخير والأعذار والشكاوى' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'الأعذار والغياب', pressed: true })).toBeInTheDocument()
    expect(await screen.findByText('مرض')).toBeInTheDocument()
  })
})
