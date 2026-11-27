import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { destinationsFor, entriesOf } from '@/app/navigation'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { chooseOption } from '@/test/select'
import type { StudentList } from './api'

/**
 * PD-60: People -> Students, through the real route and API client, `fetch`
 * answered at the network boundary. The server decides who is listed (apps/api
 * test/unit/lessons/pd060-student-directory.spec.ts); these prove this page asks
 * for the right page and filters, shows what comes back, and links to the profile.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const list = (over: Partial<StudentList> = {}): StudentList => ({
  page: 1,
  limit: 25,
  total: 60,
  students: [
    {
      id: 'k-1',
      name: 'Child One',
      family: { id: 'f-1', displayName: 'Family Alpha' },
      teacher: { id: 't-1', name: 'Teacher Omega' },
      supervisor: { id: 's-9', name: 'Supervisor Nine' },
      status: 'active',
      returnOn: null,
      weeklySlots: 2,
    },
    {
      id: 'k-2',
      name: 'Child Two',
      family: { id: 'f-2', displayName: 'Family Beta' },
      teacher: null,
      supervisor: null,
      status: 'paused',
      returnOn: '2026-12-01',
      weeklySlots: 0,
    },
  ],
  filters: { teachers: [{ id: 't-1', name: 'Teacher Omega' }], supervisors: [{ id: 's-9', name: 'Supervisor Nine' }] },
  ...over,
})

const superAdmin = makeStaff({ id: 'sa-1', name: 'Owner', role: 'super_admin' })
let fetchMock: ReturnType<typeof vi.fn>
let answer: () => Response

const asked = () => fetchMock.mock.calls.map(([u]) => new URL(String(u), 'http://x')).filter((u) => u.pathname.endsWith('/learners'))

beforeEach(() => {
  answer = () => json(list())
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (/\/learners(\?|$)/.test(url)) return answer()
    return json({ error: { code: 'unrouted', message: url } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the Students page', () => {
  it('lists the students with family, teacher, status and weekly times, each linking to the profile', async () => {
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/students' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Students' })).toBeInTheDocument()
    const link = await screen.findByRole('link', { name: 'Child One' })
    expect(link).toHaveAttribute('href', '/students/k-1')
    const row = link.closest('tr')!
    expect(within(row).getByText('Family Alpha')).toBeInTheDocument()
    // The page is set out under each teacher: the teacher is the heading of the row's group.
    const group = row.closest('tbody')!
    expect(within(within(group).getByRole('rowheader')).getByText('Teacher Omega')).toBeInTheDocument()
    expect(within(row).getByText('Supervisor Nine')).toBeInTheDocument()
    expect(within(row).getByText('2 weekly times')).toBeInTheDocument()
    expect(within(row).getByText('Active')).toBeInTheDocument()
    const paused = screen.getByRole('link', { name: 'Child Two' }).closest('tr')!
    expect(within(paused).getByText('Paused')).toBeInTheDocument()
    expect(within(paused).getByText('back 2026-12-01')).toBeInTheDocument()
    const unplaced = paused.closest('tbody')!
    expect(within(within(unplaced).getByRole('rowheader')).getByText('No teacher')).toBeInTheDocument()
    // Those still without a teacher come first.
    expect(screen.getAllByRole('rowgroup').indexOf(unplaced)).toBeLessThan(screen.getAllByRole('rowgroup').indexOf(group))
    expect(screen.getByText('60 students')).toBeInTheDocument()
    expect(asked()[0]!.searchParams.get('limit')).toBe('25')
    expect(asked()[0]!.searchParams.get('page')).toBe('1')
  })

  it('pages through the server: Next asks for page 2, Previous is off on page 1', async () => {
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/students' })
    await screen.findByRole('link', { name: 'Child One' })
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    answer = () => json(list({ page: 2 }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(asked().some((u) => u.searchParams.get('page') === '2')).toBe(true))
  })

  it('sends the search and the filters to the server', async () => {
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/students' })
    await screen.findByRole('link', { name: 'Child One' })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search by student or family name' }), 'alpha')
    await waitFor(() => expect(asked().some((u) => u.searchParams.get('q') === 'alpha')).toBe(true))
    // The status filter is a row of chips on the sheet's bar: the same filter, one click.
    await userEvent.click(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Paused' }))
    await waitFor(() => expect(asked().some((u) => u.searchParams.get('status') === 'paused')).toBe(true))
    await chooseOption(userEvent, screen.getByRole('combobox', { name: 'Teacher' }), 'none')
    await waitFor(() => expect(asked().some((u) => u.searchParams.get('teacher') === 'none')).toBe(true))
    await chooseOption(userEvent, screen.getByRole('combobox', { name: 'Supervisor' }), 's-9')
    await waitFor(() => expect(asked().some((u) => u.searchParams.get('supervisor') === 's-9')).toBe(true))
  })

  it('says plainly when the server refuses', async () => {
    answer = () => json({ error: { code: 'lesson_denied', message: 'no' } }, 403)
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/students' })
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Child One' })).not.toBeInTheDocument())
    expect(await screen.findByRole('heading', { level: 1, name: 'Students' })).toBeInTheDocument()
  })
})

describe('the Students navigation entry', () => {
  it('sits under People beside Parents, on the server\'s Teachers-department word', () => {
    const keys = (access: { lessonManager?: boolean }) =>
      entriesOf(destinationsFor('manager', { ...access, billingReader: true }).find((d) => d.key === 'people')!).map((e) => e.key)
    expect(keys({})).not.toContain('students')
    expect(keys({ lessonManager: true })).toContain('students')
    const people = destinationsFor('super_admin').find((d) => d.key === 'people')!
    expect(people.groups.find((g) => g.key === 'families')!.entries.map((e) => e.path)).toEqual(['/admin/parents', '/students'])
  })
})
