import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { TeacherSummary } from './api'

/**
 * PD-43: "Add teacher" on Teacher Files, through the real routes and API
 * client, `fetch` answered at the network boundary. The page offers the form
 * only when GET /teacher-files says so, offers the supervisor choice the server
 * allows (a picker for the Teachers manager, Me / no supervisor for a teacher
 * supervisor), and shows the first sign-in code ONCE. Who may do what is proven
 * server-side (apps/api test/integration/pd043-add-teacher-http.spec.ts).
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

const TEACHERS: TeacherSummary[] = [{ id: 't-1', name: 'Teacher One', isActive: true, studentCount: 2, openComplaints: 0 }]
const SUPERVISORS = [
  { id: 's-1', name: 'Supervisor One' },
  { id: 's-2', name: 'Supervisor Two' },
]

const manager = makeStaff({ id: 'm-1', name: 'Teachers Manager', role: 'manager' })
const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })

function listWith(onboarding: unknown) {
  on('GET', /\/teacher-files$/, () => json({ access: { canEditPersonal: true, canWriteSupervision: true }, teachers: TEACHERS, onboarding }))
}

const ADDED = {
  teacher: { id: 't-9', name: 'New Teacher', supervisorId: 's-2' },
  signIn: 'new.teacher@example.test',
  firstLogin: { code: '482913', expiresAt: '2026-10-31T09:00:00Z', emailed: false },
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
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('Add teacher', () => {
  it('is not offered when the server does not offer it', async () => {
    listWith({ canAdd: false, supervisorChoice: null, supervisors: [], selfId: 'x' })
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/files' })
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'Add teacher' })).not.toBeInTheDocument()
  })

  it('the Teachers manager adds a teacher with a supervisor; the code is shown once', async () => {
    listWith({ canAdd: true, supervisorChoice: 'any', supervisors: SUPERVISORS, selfId: 'm-1' })
    on('POST', /\/teachers$/, () => json(ADDED, 201))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files' })
    await user.click(await screen.findByRole('button', { name: 'Add teacher' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add teacher' })
    await user.type(within(dialog).getByLabelText('Full name'), 'New Teacher')
    await user.type(within(dialog).getByLabelText('Sign-in e-mail'), 'new.teacher@example.test')
    await user.selectOptions(within(dialog).getByLabelText('Supervisor'), 's-2')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(calls('POST', /\/teachers$/)).toHaveLength(1))
    const body = bodyOf(calls('POST', /\/teachers$/)[0]!)
    expect(body).toMatchObject({ name: 'New Teacher', email: 'new.teacher@example.test', supervisorId: 's-2' })
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)

    const shown = await screen.findByRole('dialog', { name: 'First sign-in code' })
    expect(within(shown).getByText('482913')).toBeInTheDocument()
    expect(within(shown).getByText('new.teacher@example.test')).toBeInTheDocument()
    expect(within(shown).getByText(/was not e-mailed/)).toBeInTheDocument()
    await user.click(within(shown).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('482913')).not.toBeInTheDocument())
  })

  it('the manager may leave the supervisor empty; the form says who covers the teacher', async () => {
    listWith({ canAdd: true, supervisorChoice: 'any', supervisors: SUPERVISORS, selfId: 'm-1' })
    on('POST', /\/teachers$/, () => json({ ...ADDED, teacher: { ...ADDED.teacher, supervisorId: null } }, 201))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files' })
    await user.click(await screen.findByRole('button', { name: 'Add teacher' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add teacher' })
    expect(within(dialog).getByText(/the Teachers Manager is responsible for this teacher/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Full name'), 'New Teacher')
    await user.type(within(dialog).getByLabelText('Sign-in e-mail'), 'new.teacher@example.test')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(calls('POST', /\/teachers$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/teachers$/)[0]!).supervisorId).toBeNull()
  })

  it('a teacher supervisor chooses Me or no supervisor, never a colleague', async () => {
    listWith({ canAdd: true, supervisorChoice: 'self_or_none', supervisors: [], selfId: 's-1' })
    on('POST', /\/teachers$/, () => json({ ...ADDED, teacher: { ...ADDED.teacher, supervisorId: 's-1' } }, 201))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/files' })
    await user.click(await screen.findByRole('button', { name: 'Add teacher' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add teacher' })
    expect(within(dialog).queryByRole('combobox', { name: 'Supervisor' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'Me' })).toBeChecked()
    await user.click(within(dialog).getByRole('radio', { name: 'No supervisor yet' }))
    expect(within(dialog).getByText(/you will no longer see this teacher/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'Me' }))
    await user.type(within(dialog).getByLabelText('Full name'), 'New Teacher')
    await user.type(within(dialog).getByLabelText('Sign-in e-mail'), 'new.teacher@example.test')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(calls('POST', /\/teachers$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/teachers$/)[0]!).supervisorId).toBe('self')
  })

  it('a sign-in in use: the server\'s answer, and a link when it names a teacher', async () => {
    listWith({ canAdd: true, supervisorChoice: 'any', supervisors: SUPERVISORS, selfId: 'm-1' })
    on('POST', /\/teachers$/, () =>
      json({ error: { code: 'COMM.TEACHER_ALREADY_ADDED', message: 'already a teacher', detail: { teacher: { id: 't-1', name: 'Teacher One' } } } }, 409),
    )
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files' })
    await user.click(await screen.findByRole('button', { name: 'Add teacher' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add teacher' })
    await user.type(within(dialog).getByLabelText('Full name'), 'New Teacher')
    await user.type(within(dialog).getByLabelText('Sign-in e-mail'), 'teacher.one@example.test')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('This person is already a teacher here.')
    expect(within(alert).getByRole('link', { name: 'Teacher One' })).toHaveAttribute('href', '/teachers/files/t-1')

    on('POST', /\/teachers$/, () => json({ error: { code: 'COMM.TEACHER_EMAIL_UNAVAILABLE', message: 'x' } }, 409))
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('This e-mail can’t be used for a new teacher.'))
  })

  it('cannot be closed while the server is answering; reopened, it starts clean', async () => {
    listWith({ canAdd: true, supervisorChoice: 'any', supervisors: SUPERVISORS, selfId: 'm-1' })
    let answer!: (r: Response) => void
    on('POST', /\/teachers$/, () => new Promise<Response>((resolve) => (answer = resolve)))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files' })
    await user.click(await screen.findByRole('button', { name: 'Add teacher' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add teacher' })
    await user.type(within(dialog).getByLabelText('Full name'), 'New Teacher')
    await user.type(within(dialog).getByLabelText('Sign-in e-mail'), 'new.teacher@example.test')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled())
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Add teacher' })).toBeInTheDocument()

    answer(json(ADDED, 201))
    const shown = await screen.findByRole('dialog', { name: 'First sign-in code' })
    await user.click(within(shown).getByRole('button', { name: 'Done' }))
    await user.click(screen.getByRole('button', { name: 'Add teacher' }))
    const again = await screen.findByRole('dialog', { name: 'Add teacher' })
    expect(within(again).getByLabelText('Full name')).toHaveValue('')
    expect(screen.queryByText('482913')).not.toBeInTheDocument()
  })

  it('requires a name and a sign-in e-mail before asking the server', async () => {
    listWith({ canAdd: true, supervisorChoice: 'any', supervisors: SUPERVISORS, selfId: 'm-1' })
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/teachers/files' })
    await user.click(await screen.findByRole('button', { name: 'Add teacher' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add teacher' })
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(within(dialog).getAllByText('Required.')).toHaveLength(2)
    expect(calls('POST', /\/teachers$/)).toHaveLength(0)
  })
})
