import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { TeacherDeletionRequest, TeacherFile } from './api'
import { T } from './copy'

/**
 * PD-56 O-3 on the Teacher File: a teacher asked, in the app, to delete their
 * account while lessons or payroll were open. The banner names the deadline;
 * "Close and delete account" sits behind an explicit confirmation and only for
 * whom the server says (canComplete). Who may is proven in apps/api
 * test/integration/pd056-teacher-deletion-request.spec.ts. Fixed instants;
 * synthetic people.
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

function file(over: Partial<TeacherFile> = {}): TeacherFile {
  return {
    access: { canEditPersonal: true, canWriteSupervision: true },
    signIn: { status: 'active', canSendCode: false, canGive: false },
    onboarding: { canOffboard: true, canReactivate: false },
    teacher: { id: 't-1', name: 'Teacher One', isActive: true, leftAt: null },
    personal: { fullName: 'Teacher One', phone: null, email: null, joinedOn: null, updatedAt: null, updatedBy: null },
    assignedStudents: [],
    supervision: { complaints: [], monthlyComments: [], daysOff: [] },
    ...over,
  } as TeacherFile
}
const pending = (over: Partial<TeacherDeletionRequest> = {}): TeacherDeletionRequest => ({
  request: {
    id: 'r-1',
    state: 'pending',
    requestedAt: '2026-11-07T10:00:00.000Z',
    deadlineAt: '2026-12-07T10:00:00.000Z',
    openItems: ['future_lessons'],
    completedAt: null,
    completedVia: null,
    cancelledAt: null,
  },
  leftOpen: { futureLessons: 2, assignedLearners: 0, openPayroll: true },
  canComplete: true,
  ...over,
})

const manager = makeStaff({ id: 'm-1', name: 'Teachers Manager', role: 'manager' })

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
  on('GET', /\/teacher-files\/t-1$/, () => json(file()))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('Deletion requested', () => {
  it('names the deadline and what is still open; "Close and delete account" waits for the confirmation, then deletes', async () => {
    on('GET', /\/teacher-files\/t-1\/deletion-request$/, () => json(pending()))
    on('POST', /\/teacher-files\/t-1\/deletion-request\/complete$/, () => json({ requestId: 'r-1' }))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })

    const banner = await screen.findByRole('region', { name: 'Deletion requested' })
    expect(banner).toHaveTextContent(/asked on .*2026 to delete their account/)
    expect(banner).toHaveTextContent(/deleted automatically on .*7.*2026/)
    expect(banner).toHaveTextContent('Still open: 2 lessons ahead, payroll of this or last month.')

    await user.click(within(banner).getByRole('button', { name: 'Close and delete account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close and delete Teacher One’s account' })
    expect(within(dialog).getByText(/lessons ahead stay on “Deleted user”/)).toBeInTheDocument()
    const submit = within(dialog).getByRole('button', { name: 'Close and delete account' })
    expect(submit).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: /cannot be undone/ }))
    expect(submit).toBeEnabled()
    await user.click(submit)
    await waitFor(() => expect(calls('POST', /\/deletion-request\/complete$/)).toHaveLength(1))
    expect(JSON.parse(String((calls('POST', /\/deletion-request\/complete$/)[0]![1] as RequestInit).body))).toEqual({ confirm: true })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('an offboarded teacher with a pending request still shows the banner and the action (review of 00ccd748, item 6)', async () => {
    routes = routes.filter(([pattern]) => !pattern.test('/teacher-files/t-1'))
    on('GET', /\/teacher-files\/t-1$/, () => json(file({ teacher: { id: 't-1', name: 'Teacher One', isActive: false, leftAt: '2026-11-08T10:00:00.000Z' } } as Partial<TeacherFile>)))
    on('GET', /\/teacher-files\/t-1\/deletion-request$/, () => json(pending()))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    const banner = await screen.findByRole('region', { name: 'Deletion requested' })
    expect(within(banner).getByRole('button', { name: 'Close and delete account' })).toBeInTheDocument()
  })

  it('a reader who may not complete it sees the banner without the action', async () => {
    on('GET', /\/teacher-files\/t-1\/deletion-request$/, () => json(pending({ canComplete: false, leftOpen: { futureLessons: 0, assignedLearners: 0, openPayroll: false } })))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    const banner = await screen.findByRole('region', { name: 'Deletion requested' })
    expect(banner).toHaveTextContent('Nothing is open any more.')
    expect(within(banner).queryByRole('button')).not.toBeInTheDocument()
  })

  it('no pending request (none, cancelled, or the route refused): no banner', async () => {
    on('GET', /\/teacher-files\/t-1\/deletion-request$/, () =>
      json(pending({ request: { ...pending().request!, state: 'cancelled', cancelledAt: '2026-11-08T10:00:00.000Z' }, leftOpen: null, canComplete: false })),
    )
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    expect((await screen.findAllByText('Teacher One')).length).toBeGreaterThan(0)
    await waitFor(() => expect(calls('GET', /\/deletion-request$/).length).toBeGreaterThan(0))
    expect(screen.queryByRole('region', { name: 'Deletion requested' })).not.toBeInTheDocument()
  })

  it('reads in Arabic, and every new string has both languages', async () => {
    on('GET', /\/teacher-files\/t-1\/deletion-request$/, () => json(pending()))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1', locale: 'ar' })
    const banner = await screen.findByRole('region', { name: 'طُلب حذف الحساب' })
    expect(within(banner).getByRole('button', { name: 'إغلاق الحساب وحذفه' })).toBeInTheDocument()
    expect(banner).toHaveTextContent('ما زال مفتوحًا: حصص قادمة: 2، رواتب هذا الشهر أو الشهر الماضي.')
    for (const key of ['deletionRequested', 'deletionRequestedBody', 'closeAndDelete', 'closeAndDeleteHint', 'closeAndDeleteConfirm'] as const) {
      expect(T[key].ar && T[key].en).toBeTruthy()
      expect(T[key].ar.match(/\{\w+\}/g)?.sort()).toEqual(T[key].en.match(/\{\w+\}/g)?.sort())
    }
  })
})
