import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { TeacherFile, TeacherSummary } from './api'

/**
 * PD-43 "Give sign-in" on the Teacher File: a teacher with no login gets one
 * (POST /teachers/:id/sign-in); a login never used gets a new first sign-in
 * code (POST /teachers/:id/first-login-code). The page follows the file's
 * `signIn.status` and `access.canManageSignIn`; the code is shown once. Who may
 * is proven server-side (apps/api test/integration/pd043-give-sign-in-http.spec.ts).
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

const withSignIn = (status: string, canManageSignIn = true) => ({
  ...file({ canEditPersonal: true, canWriteSupervision: true, canManageSignIn } as TeacherFile['access']),
  signIn: { status },
})

const CODE = { code: '482913', expiresAt: '2026-10-31T09:00:00Z', emailed: false }

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

describe('Give sign-in', () => {
  it('a teacher with no login: Give sign-in asks for the e-mail and shows the code once', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(withSignIn('none')))
    on('POST', /\/teachers\/t-1\/sign-in$/, () => json({ teacherId: 't-1', signIn: 'teacher.one@example.test', firstLogin: CODE }, 201))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    await user.click(await screen.findByRole('button', { name: 'Give sign-in' }))
    const dialog = await screen.findByRole('dialog', { name: 'Give sign-in' })
    await user.type(within(dialog).getByLabelText('Sign-in e-mail'), 'teacher.one@example.test')
    await user.click(within(dialog).getByRole('button', { name: 'Give sign-in' }))
    await waitFor(() => expect(calls('POST', /\/teachers\/t-1\/sign-in$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/teachers\/t-1\/sign-in$/)[0]!)).toEqual({ email: 'teacher.one@example.test' })
    const shown = await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(within(shown).getByText('482913')).toBeInTheDocument()
    await user.click(within(shown).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('482913')).not.toBeInTheDocument())
  })

  it('a login never used: Send a new first sign-in code', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(withSignIn('provisioned')))
    on('POST', /\/teachers\/t-1\/first-login-code$/, () => json({ teacherId: 't-1', signIn: 'teacher.one@example.test', firstLogin: CODE }, 201))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    expect(await screen.findByText('Not signed in yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Give sign-in' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send a new first sign-in code' }))
    const shown = await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(within(shown).getByText('482913')).toBeInTheDocument()
    expect(calls('POST', /\/teachers\/t-1\/first-login-code$/)).toHaveLength(1)
  })

  it('an active login, or no right to manage it: neither button', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(withSignIn('active')))
    const { unmount } = renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    await screen.findByRole('heading', { level: 1, name: /^Teacher One/ })
    expect(screen.queryByRole('button', { name: /Give sign-in|Send a new first sign-in code/ })).not.toBeInTheDocument()
    unmount()

    on('GET', /\/teacher-files\/t-1$/, () => json(withSignIn('none', false)))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    await screen.findByRole('heading', { level: 1, name: /^Teacher One/ })
    expect(screen.queryByRole('button', { name: 'Give sign-in' })).not.toBeInTheDocument()
  })

  it('the list marks teachers with no sign-in: the intake\'s work list', async () => {
    on('GET', /\/teacher-files$/, () =>
      json({ access: { canEditPersonal: true, canWriteSupervision: true }, teachers: [{ ...TEACHERS[0], signIn: 'none' }, { ...TEACHERS[1], signIn: 'active' }] }),
    )
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files' })
    const table = await screen.findByRole('table')
    expect(within(within(table).getByText('Teacher One').closest('tr')!).getByText('No sign-in')).toBeInTheDocument()
    expect(within(within(table).getByText('Teacher Two').closest('tr')!).queryByText('No sign-in')).not.toBeInTheDocument()
  })
})
