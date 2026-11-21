import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { destinationsFor, entriesOf } from '@/app/navigation'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { Roster } from './opsApi'

/** Student scheduling: the student-first way into the shared scheduling desk. Synthetic people only. */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const ROSTER: Roster = {
  teachers: [
    { id: 't-1', name: 'Teacher One', isActive: true, timezone: 'Africa/Cairo' },
    { id: 't-2', name: 'Teacher Two', isActive: true, timezone: 'Africa/Cairo' },
  ],
  learners: [
    { id: 'k-1', name: 'Child Alpha', family: { id: 'f-1', displayName: 'Family One' }, teacherId: 't-1', slots: [{ weekday: 1, start: '17:00', durationMinutes: 30 }], suspension: null },
    { id: 'k-2', name: 'Child Beta', family: { id: 'f-2', displayName: 'Family Two' }, teacherId: 't-2', slots: [], suspension: null },
    { id: 'k-3', name: 'Child Gamma', family: { id: 'f-3', displayName: 'Family Three' }, teacherId: null, slots: [], suspension: null },
  ],
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (/\/lessons\/access$/.test(url)) return json({ lessonManager: true })
      if (/\/lessons\/roster$/.test(url)) return json(ROSTER)
      return json({ error: { code: 'unrouted', message: url } }, 404)
    }),
  )
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const supervisor = makeStaff({ role: 'admin' })

describe('Student schedules page', () => {
  it('lists every student with their teacher and regular times, across teachers', async () => {
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/schedule/students' })
    const students = await screen.findByRole('region', { name: 'Students' })
    const alpha = within(students).getByText('Child Alpha').closest('tr')!
    expect(within(alpha).getByText('Teacher One')).toBeInTheDocument()
    expect(within(alpha).getByText('Monday 17:00 (30 min)')).toBeInTheDocument()
    expect(within(students).getByText('Child Beta')).toBeInTheDocument()
    // A student with no teacher is shown, not dropped.
    expect(within(students).getByText('Child Gamma')).toBeInTheDocument()
    // The same actions as the Teachers' schedules desk.
    expect(within(alpha).getByRole('button', { name: 'Change teacher' })).toBeInTheDocument()
  })

  it('narrows to one student, to one teacher, or to students with no teacher, by link', async () => {
    const { unmount } = renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/schedule/students?student=k-2' })
    let students = await screen.findByRole('region', { name: 'Students' })
    expect(within(students).getAllByRole('row')).toHaveLength(2) // header + Beta
    expect(within(students).getByText('Child Beta')).toBeInTheDocument()
    unmount()

    const second = renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/schedule/students?teacher=t-1' })
    students = await screen.findByRole('region', { name: 'Students' })
    expect(within(students).getByText('Child Alpha')).toBeInTheDocument()
    expect(within(students).queryByText('Child Beta')).not.toBeInTheDocument()
    second.unmount()

    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/schedule/students?teacher=__none' })
    students = await screen.findByRole('region', { name: 'Students' })
    expect(within(students).getByText('Child Gamma')).toBeInTheDocument()
    expect(within(students).queryByText('Child Alpha')).not.toBeInTheDocument()
  })
})

describe('Scheduling navigation', () => {
  it('holds the academy calendar, the Teachers\' and the Student schedules, and only for the Teachers department', () => {
    const paths = (role: 'super_admin' | 'admin' | 'manager', access = {}) =>
      entriesOf(destinationsFor(role, access).find((d) => d.key === 'scheduling') ?? { key: 'scheduling', icon: 'calendar', label: { en: '', ar: '' }, groups: [] }).map((e) => e.path)
    expect(paths('super_admin')).toEqual(['/schedule', '/teachers/schedules', '/schedule/students'])
    expect(paths('admin', { calendar: true, lessonManager: true })).toEqual(['/schedule', '/teachers/schedules', '/schedule/students'])
    // Operations has the calendar only; the desks wait for the Teachers department.
    expect(paths('admin', { calendar: true, operations: true })).toEqual(['/schedule'])
    expect(paths('manager', {})).toEqual([])
  })

  it('Sales holds trial lessons and new students, on the server\'s word', () => {
    const sales = (access: object) => {
      const d = destinationsFor('admin', access).find((x) => x.key === 'sales')
      return d ? entriesOf(d).map((e) => e.path) : []
    }
    // PD-59: the Sales pipeline leads the Sales pages, on `sales` alone.
    expect(sales({ sales: true })).toEqual(['/sales/pipeline', '/trials', '/trials/new-students'])
    expect(sales({ operations: true })).toEqual(['/trials', '/trials/new-students'])
    // The Teachers department sees the teachers' trials, not the new-student set-up.
    // ...nor a Sales icon: its Trial lessons page is listed under Operations (PD-59 owner decision).
    expect(sales({ lessonManager: true })).toEqual([])
    const ops = destinationsFor('admin', { lessonManager: true }).find((x) => x.key === 'operations')
    expect(ops ? entriesOf(ops).map((e) => e.path) : []).toContain('/trials')
    expect(sales({})).toEqual([])
  })
})
