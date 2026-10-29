import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { TeacherFile } from './api'

/**
 * PD-43 "Change sign-in e-mail" on the Teacher File (PATCH /teachers/:id/sign-in).
 * Offered when the file's `signIn.canChange` says so: while the login waits,
 * the manager, the super admin and the current supervisor; once used, the
 * super admin. The new first sign-in code is shown only when the server
 * returns it. Who may is proven server-side
 * (apps/api test/integration/pd043-change-sign-in-http.spec.ts). Synthetic people only.
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

function file(signIn: TeacherFile['signIn']): TeacherFile {
  return {
    access: { canEditPersonal: true, canWriteSupervision: true },
    signIn,
    teacher: { id: 't-1', name: 'Teacher One', isActive: true, leftAt: null },
    personal: { fullName: 'Teacher One', phone: null, email: 'old.one@example.test', joinedOn: null, updatedAt: null, updatedBy: null },
    assignedStudents: [],
    supervision: { complaints: [], monthlyComments: [], daysOff: [] },
  }
}

const manager = makeStaff({ id: 'm-1', name: 'Teachers Manager', role: 'manager' })
const waiting = (canChange: boolean) => file({ status: 'provisioned', canSendCode: true, canGive: false, canChange })

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
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

async function openDialog() {
  const user = userEvent.setup()
  renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
  await user.click(await screen.findByRole('button', { name: 'Change sign-in e-mail' }))
  return { user, dialog: await screen.findByRole('dialog', { name: 'Change sign-in e-mail' }) }
}

describe('Change sign-in e-mail', () => {
  it('while the login waits: the new address and a reason; the new code is shown once, and survives the reload', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(waiting(true)))
    on('PATCH', /\/teachers\/t-1\/sign-in$/, () =>
      json({ teacherId: 't-1', signIn: 'new.one@example.test', firstLogin: { code: '731905', expiresAt: '2026-10-31T09:00:00Z', emailed: true } }),
    )
    const { user, dialog } = await openDialog()
    await user.type(within(dialog).getByLabelText('New sign-in e-mail'), 'new.one@example.test')
    await user.type(within(dialog).getByLabelText('Reason'), 'Typo in the address')
    await user.click(within(dialog).getByRole('button', { name: 'Change' }))
    await waitFor(() => expect(calls('PATCH', /\/teachers\/t-1\/sign-in$/)).toHaveLength(1))
    expect(bodyOf(calls('PATCH', /\/teachers\/t-1\/sign-in$/)[0]!)).toEqual({ email: 'new.one@example.test', reason: 'Typo in the address' })
    const shown = await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(within(shown).getByText('731905')).toBeInTheDocument()
    expect(within(shown).getByText('new.one@example.test')).toBeInTheDocument()
    await waitFor(() => expect(calls('GET', /\/teacher-files\/t-1$/).length).toBeGreaterThan(1))
    expect(screen.getByText('731905')).toBeInTheDocument()
  })

  it('a signed-in teacher (the super admin): no code; the teacher is told to sign in again', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(file({ status: 'active', canSendCode: false, canGive: false, canChange: true })))
    on('PATCH', /\/teachers\/t-1\/sign-in$/, () => json({ teacherId: 't-1', signIn: 'new.one@example.test', firstLogin: null }))
    const { user, dialog } = await openDialog()
    expect(within(dialog).getByText(/Every session ends/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('New sign-in e-mail'), 'new.one@example.test')
    await user.type(within(dialog).getByLabelText('Reason'), 'New mailbox')
    await user.click(within(dialog).getByRole('button', { name: 'Change' }))
    expect(await screen.findByText('Changed. The teacher signs in with new.one@example.test from now on.')).toBeInTheDocument()
  })

  it('requires both fields; an address in use is the server\'s answer', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(waiting(true)))
    on('PATCH', /\/teachers\/t-1\/sign-in$/, () => json({ error: { code: 'COMM.TEACHER_EMAIL_UNAVAILABLE', message: 'x' } }, 409))
    const { user, dialog } = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Change' }))
    expect(calls('PATCH', /\/teachers\/t-1\/sign-in$/)).toHaveLength(0)
    await user.type(within(dialog).getByLabelText('New sign-in e-mail'), 'taken@example.test')
    await user.type(within(dialog).getByLabelText('Reason'), 'Typo')
    await user.click(within(dialog).getByRole('button', { name: 'Change' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('These details can’t be used for a new teacher.')
  })

  it('not offered when the file does not say so', async () => {
    on('GET', /\/teacher-files\/t-1$/, () => json(waiting(false)))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files/t-1' })
    await screen.findByRole('heading', { level: 1, name: /^Teacher One/ })
    expect(screen.queryByRole('button', { name: 'Change sign-in e-mail' })).not.toBeInTheDocument()
  })
})
