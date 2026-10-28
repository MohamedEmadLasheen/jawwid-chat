import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { TeacherFile, TeacherSetup, TeacherSummary } from './api'

/**
 * PD-43 PR-1b on the Admin Web: offboarding with its preview (the students
 * that block it, each lesson ahead, cancelled only on an explicit
 * confirmation), reactivation by the super admin, and the set-up checklist
 * on the file and the list. Who may is the server's (`onboarding` on the
 * file); proven in apps/api test/integration/pd043-offboarding-http.spec.ts.
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

const SETUP: TeacherSetup = {
  signedIn: false,
  supervisor: true,
  contact: true,
  payTerms: false,
  payoutAccount: false,
  leaveAllowance: false,
  shift: false,
  availability: false,
  profile: false,
  payMatchesShift: true,
  missing: 7,
}

function file(over: Partial<TeacherFile> = {}): TeacherFile {
  return {
    access: { canEditPersonal: true, canWriteSupervision: true },
    signIn: { status: 'active', canSendCode: false, canGive: false },
    onboarding: { canOffboard: true, canReactivate: false },
    setup: SETUP,
    teacher: { id: 't-1', name: 'Teacher One', isActive: true, leftAt: null },
    personal: { fullName: 'Teacher One', phone: null, email: null, joinedOn: null, updatedAt: null, updatedBy: null },
    assignedStudents: [],
    supervision: { complaints: [], monthlyComments: [], daysOff: [] },
    ...over,
  }
}

const TEACHERS: TeacherSummary[] = [
  { id: 't-1', name: 'Teacher One', isActive: true, studentCount: 0, openComplaints: 0, setupMissing: 7 },
  { id: 't-2', name: 'Teacher Two', isActive: true, studentCount: 3, openComplaints: 0, setupMissing: 0 },
  { id: 't-3', name: 'Teacher Three', isActive: false, studentCount: 0, openComplaints: 0, setupMissing: 4 },
]

const manager = makeStaff({ id: 'm-1', name: 'Teachers Manager', role: 'manager' })
const owner = makeStaff({ id: 'o-1', name: 'QA Owner', role: 'super_admin' })

const preview = (over: Record<string, unknown> = {}) => ({ teacherId: 't-1', isActive: true, students: [], openLessons: [], canOffboard: true, ...over })

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
  on('GET', /\/teacher-files$/, () => json({ access: { canEditPersonal: true, canWriteSupervision: true }, teachers: TEACHERS }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

async function openOffboard() {
  const user = userEvent.setup()
  renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
  await user.click(await screen.findByRole('button', { name: 'Offboard' }))
  return { user, dialog: await screen.findByRole('dialog', { name: 'Offboard Teacher One' }) }
}

describe('Offboard', () => {
  it('students still assigned: listed, and the teacher cannot be offboarded', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(file()))
    on('GET', /\/teachers\/t-1\/offboard-preview$/, () =>
      json(preview({ students: [{ id: 'l-1', name: 'Child Alpha' }, { id: 'l-2', name: 'Child Beta' }], canOffboard: false })),
    )
    const { dialog } = await openOffboard()
    expect(await within(dialog).findByText('Move these students to other teachers first.')).toBeInTheDocument()
    expect(within(dialog).getByText('Child Alpha')).toBeInTheDocument()
    expect(within(dialog).getByText('Child Beta')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Offboard' })).toBeDisabled()
  })

  it('lessons ahead: each one listed; offboarding waits for the explicit confirmation, then asks to cancel them', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(file()))
    on('GET', /\/teachers\/t-1\/offboard-preview$/, () =>
      json(preview({ openLessons: [{ id: 'k-1', kind: 'trial', startsAt: '2026-11-02T15:00:00Z', endsAt: '2026-11-02T15:30:00Z' }] })),
    )
    on('POST', /\/teachers\/t-1\/offboard$/, () => json({ teacherId: 't-1', cancelledLessons: ['k-1'], notCancelled: [] }, 201))
    const { user, dialog } = await openOffboard()
    const lessons = await within(dialog).findByRole('list', { name: 'Lessons ahead' })
    expect(within(lessons).getAllByRole('listitem')).toHaveLength(1)
    expect(within(lessons).getByText(/Trial/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Reason'), 'Left the academy')
    const submit = within(dialog).getByRole('button', { name: 'Offboard' })
    expect(submit).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: /Cancel this lesson/ }))
    expect(submit).toBeEnabled()
    await user.click(submit)
    await waitFor(() => expect(calls('POST', /\/teachers\/t-1\/offboard$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/teachers\/t-1\/offboard$/)[0]!)).toEqual({ reason: 'Left the academy', cancelOpenLessons: true })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Offboard Teacher One' })).not.toBeInTheDocument())
  })

  it('nothing ahead: a reason is enough, and no cancellation is asked for', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(file()))
    on('GET', /\/teachers\/t-1\/offboard-preview$/, () => json(preview()))
    on('POST', /\/teachers\/t-1\/offboard$/, () => json({ teacherId: 't-1', cancelledLessons: [], notCancelled: [] }, 201))
    const { user, dialog } = await openOffboard()
    await within(dialog).findByText('No students and no lessons ahead.')
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Reason'), 'Left the academy')
    await user.click(within(dialog).getByRole('button', { name: 'Offboard' }))
    await waitFor(() => expect(calls('POST', /\/teachers\/t-1\/offboard$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/teachers\/t-1\/offboard$/)[0]!)).toEqual({ reason: 'Left the academy' })
  })

  it('a lesson the server could not cancel: said, and the teacher stays', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(file()))
    on('GET', /\/teachers\/t-1\/offboard-preview$/, () =>
      json(preview({ openLessons: [{ id: 'k-1', kind: 'trial', startsAt: '2026-11-02T15:00:00Z', endsAt: '2026-11-02T15:30:00Z' }] })),
    )
    on('POST', /\/teachers\/t-1\/offboard$/, () =>
      json({ error: { code: 'COMM.TEACHER_HAS_OPEN_LESSONS', message: 'some lessons could not be cancelled', detail: { cancelledLessons: [], notCancelled: [{ lessonId: 'k-1', reason: 'x' }] } } }, 409),
    )
    const { user, dialog } = await openOffboard()
    await user.type(await within(dialog).findByLabelText('Reason'), 'Left the academy')
    await user.click(within(dialog).getByRole('checkbox', { name: /Cancel this lesson/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Offboard' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Some lessons could not be cancelled, so the teacher was not offboarded.')
  })

  it('not offered without the server saying so, or for a teacher who has left', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(file({ onboarding: { canOffboard: false, canReactivate: false } })))
    const { unmount } = renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    await screen.findByRole('heading', { level: 1, name: /^Teacher One/ })
    expect(screen.queryByRole('button', { name: 'Offboard' })).not.toBeInTheDocument()
    unmount()

    on('GET', /\/teacher-files\/t-1$/, () => json(file({ teacher: { id: 't-1', name: 'Teacher One', isActive: false, leftAt: '2026-10-20T09:00:00Z' } })))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    await screen.findByRole('heading', { level: 1, name: /^Teacher One/ })
    expect(screen.queryByRole('button', { name: 'Offboard' })).not.toBeInTheDocument()
  })
})

describe('Reactivate', () => {
  const left = { teacher: { id: 't-1', name: 'Teacher One', isActive: false, leftAt: '2026-10-20T09:00:00Z' } }

  it('the super admin brings a teacher back; the new first sign-in code is shown once', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(file({ ...left, onboarding: { canOffboard: true, canReactivate: true } })))
    on('POST', /\/teachers\/t-1\/reactivate$/, () =>
      json({ teacherId: 't-1', signIn: 'teacher.one@example.test', firstLogin: { code: '604117', expiresAt: '2026-10-31T09:00:00Z', emailed: false } }, 201),
    )
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: owner, route: '/admin/teachers/t-1' })
    await user.click(await screen.findByRole('button', { name: 'Reactivate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reactivate Teacher One' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Rejoined')
    await user.click(within(dialog).getByRole('button', { name: 'Reactivate' }))
    await waitFor(() => expect(calls('POST', /\/teachers\/t-1\/reactivate$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/teachers\/t-1\/reactivate$/)[0]!)).toEqual({ reason: 'Rejoined' })
    const shown = await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(within(shown).getByText('604117')).toBeInTheDocument()
    await user.click(within(shown).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('604117')).not.toBeInTheDocument())
  })

  it('the Teachers manager is not offered it', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(file({ ...left, onboarding: { canOffboard: true, canReactivate: false } })))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    await screen.findByRole('heading', { level: 1, name: /^Teacher One/ })
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument()
  })
})

describe('Set-up checklist', () => {
  it('on the file: each step done or not, and how many are left', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(file()))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    const card = await screen.findByRole('region', { name: 'Set-up checklist' })
    expect(within(card).getByText('7 steps left')).toBeInTheDocument()
    expect(within(within(card).getByText('Supervisor').closest('li')!).getByText('Done')).toBeInTheDocument()
    expect(within(within(card).getByText('Pay terms').closest('li')!).getByText('Not done')).toBeInTheDocument()
    expect(within(card).queryByText(/does not match/)).not.toBeInTheDocument()
  })

  it('says when the pay type and the shift category disagree; nothing when set up', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(file({ setup: { ...SETUP, payMatchesShift: false, missing: 8 } })))
    const { unmount } = renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    const card = await screen.findByRole('region', { name: 'Set-up checklist' })
    expect(within(card).getByText('The pay type does not match the shift category (hourly pay goes with an hourly category).')).toBeInTheDocument()
    unmount()

    const done = Object.fromEntries(Object.keys(SETUP).map((k) => [k, true])) as unknown as TeacherSetup
    on('GET', /\/teacher-files\/t-1$/, () => json(file({ setup: { ...done, missing: 0 } })))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    await screen.findByRole('heading', { level: 1, name: /^Teacher One/ })
    expect(screen.queryByRole('region', { name: 'Set-up checklist' })).not.toBeInTheDocument()
  })

  it('on the list: a badge, and a filter for the active teachers whose set-up is incomplete', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files' })
    const table = await screen.findByRole('table')
    expect(within(within(table).getByText('Teacher One').closest('tr')!).getByText('Setup incomplete')).toBeInTheDocument()
    expect(within(within(table).getByText('Teacher Two').closest('tr')!).queryByText('Setup incomplete')).not.toBeInTheDocument()
    expect(within(within(table).getByText('Teacher Three').closest('tr')!).queryByText('Setup incomplete')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Setup incomplete only' }))
    expect(within(table).getByText('Teacher One')).toBeInTheDocument()
    expect(within(table).queryByText('Teacher Two')).not.toBeInTheDocument()
    expect(within(table).queryByText('Teacher Three')).not.toBeInTheDocument()
  })
})
