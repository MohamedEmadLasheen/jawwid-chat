import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { TeacherFile, TeacherSummary } from './api'

/**
 * PD-43 (owner 2026-10-28, "E-mail only; managers can see"): a new first
 * sign-in code from the Teacher File, while the teacher has not signed in. It
 * is always e-mailed to the teacher; the Teachers manager and the super admin
 * also see it, a supervisor never does -- they are told whether it was e-mailed,
 * and to ask the Manager when it was not. The page follows the file's
 * `signIn`. Who may is proven server-side (pd043-add-teacher-http.spec.ts).
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

function file(access: TeacherFile["access"] = { canEditPersonal: false, canWriteSupervision: true }): TeacherFile {
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
    employment: { teachingMarket: 'Gulf', studentCount: 1 },
    history: {
      bonuses: [
        { id: 'b-1', reason: 'Two trial students stayed', createdAt: '2026-10-05T09:00:00Z', author: { id: 'm-1', name: 'Teachers Manager' } },
        { id: 'b-2', reason: 'Covered Saturdays', createdAt: '2026-10-12T09:00:00Z', author: { id: 'm-1', name: 'Teachers Manager' } },
      ],
      deductions: [
        { id: 'v-1', step: 'deduction_1', violation: 'late', month: '2026-10', note: 'Late twice', decidedAt: '2026-10-15T09:00:00Z', author: { id: 's-1', name: 'Supervisor One' } },
      ],
    },
  }
}

const manager = makeStaff({ id: 'm-1', name: 'Teachers Manager', role: 'manager' })
const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })

const withSignIn = (signIn: { status: string; canSendCode: boolean }) => ({
  ...file({ canEditPersonal: true, canWriteSupervision: true } as TeacherFile['access']),
  signIn,
})

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

const REISSUE = /\/teachers\/t-1\/first-login-code$/

describe('a new first sign-in code', () => {
  it('the Teachers manager sends one and sees it once', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(withSignIn({ status: 'provisioned', canSendCode: true })))
    on('POST', REISSUE, () => json({ teacherId: 't-1', signIn: 'teacher.one@example.test', firstLogin: { code: '482913', expiresAt: '2026-10-31T09:00:00Z', emailed: true } }, 201))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    expect(await screen.findByText('Not signed in yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send a new first sign-in code' }))
    const shown = await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(within(shown).getByText('482913')).toBeInTheDocument()
    expect(within(shown).getByText(/also e-mailed/)).toBeInTheDocument()
    await waitFor(() => expect(calls('POST', REISSUE)).toHaveLength(1))
  })

  it('a supervisor sends one but never sees it: e-mailed, or ask the Manager', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(withSignIn({ status: 'provisioned', canSendCode: true })))
    on('POST', REISSUE, () => json({ teacherId: 't-1', signIn: 'teacher.one@example.test', firstLogin: { expiresAt: '2026-10-31T09:00:00Z', emailed: true } }, 201))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/files/t-1' })
    await user.click(await screen.findByRole('button', { name: 'Send a new first sign-in code' }))
    const sent = await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(within(sent).getByText('A new code was e-mailed to the teacher.')).toBeInTheDocument()
    expect(within(sent).queryByText(/^[0-9]{6}$/)).not.toBeInTheDocument()
    await user.click(within(sent).getByRole('button', { name: 'Done' }))

    on('POST', REISSUE, () => json({ teacherId: 't-1', signIn: 'teacher.one@example.test', firstLogin: { expiresAt: '2026-10-31T09:00:00Z', emailed: false } }, 201))
    await user.click(screen.getByRole('button', { name: 'Send a new first sign-in code' }))
    const unsent = await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(within(unsent).getByText('The code could not be e-mailed. Ask the Teachers Manager to send it.')).toBeInTheDocument()
  })

  it('no button once the teacher has signed in, or for someone the server does not allow', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(withSignIn({ status: 'active', canSendCode: false })))
    const { unmount } = renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    await screen.findByRole('heading', { level: 1, name: /^Teacher One/ })
    expect(screen.queryByRole('button', { name: 'Send a new first sign-in code' })).not.toBeInTheDocument()
    unmount()
    on('GET', /\/teacher-files\/t-1$/, () => json(withSignIn({ status: 'provisioned', canSendCode: false })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/files/t-1' })
    expect(await screen.findByText('Not signed in yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send a new first sign-in code' })).not.toBeInTheDocument()
  })
})
