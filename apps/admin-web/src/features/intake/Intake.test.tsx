import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { IntakeOptions } from './api'

/**
 * PD-42 "Add family" / "Add child", through the real routes and the real API
 * client, with `fetch` answered at the network boundary. These prove the
 * page's side: the button is offered on the server's word, only the three
 * required fields are required, the package's remaining lessons are computed
 * as they are typed and confirmed on a review step, and the server's
 * PARENT_EXISTS offers to add the children to that family. Who may enter what
 * is proven server-side (apps/api pd042-intake-api.spec.ts).
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
const bodyOf = (call: unknown[] | undefined) => {
  if (!call) throw new Error('the request was not sent')
  return JSON.parse(String((call[1] as RequestInit).body))
}

const OPTIONS: IntakeOptions = {
  standing: 'operations_supervisor',
  manager: false,
  onBehalfOf: [],
  teachers: [{ id: 't-1', name: 'Teacher Omega' }],
}

const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })

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
  on('GET', /\/instalments\/access$/, () => json({ billingReader: true, canAssignBillingSupervisor: false }))
  on('GET', /\/parent-profiles(\?|$)/, () => json({ items: [], truncated: false }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

async function openForm() {
  renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents' })
  await userEvent.click(await screen.findByRole('button', { name: 'Add family' }))
  return screen.getByRole('dialog')
}

describe('Add family (PD-42)', () => {
  it('is offered only when the server says this viewer enters families', async () => {
    on('GET', /\/family-intake\/options$/, () => json({ error: { code: 'COMM.INTAKE_DENIED', message: 'no' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Parents' })).toBeInTheDocument()
    await waitFor(() => expect(calls('GET', /\/family-intake\/options$/).length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: 'Add family' })).not.toBeInTheDocument()
  })

  it('requires only the parent\'s name, a phone or an e-mail, and the child\'s name; sends nothing before the review', async () => {
    on('GET', /\/family-intake\/options$/, () => json(OPTIONS))
    const dialog = await openForm()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Review' }))
    expect(within(dialog).getByText('Enter a phone number or an e-mail.')).toBeInTheDocument()
    expect(within(dialog).getAllByText('Required').length).toBeGreaterThan(0)
    expect(calls('POST', /\/family-intake$/)).toHaveLength(0)
  })

  it('a minimal family: reviewed, then saved once with a stable intake id', async () => {
    on('GET', /\/family-intake\/options$/, () => json(OPTIONS))
    on('POST', /\/family-intake$/, () =>
      json({ enrolmentId: 'e-1', familyId: 'f-1', contactId: 'p-1', learnerIds: ['k-1'], supervision: 'placed', schedules: [], replay: false }),
    )
    const dialog = await openForm()
    await userEvent.type(within(dialog).getByLabelText(/Parent's full name/), 'Parent Alpha')
    await userEvent.type(within(dialog).getByLabelText(/Phone number/), '010 0123 4567')
    await userEvent.type(within(dialog).getByLabelText(/Child's name/), 'Child One')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Review' }))
    expect(within(dialog).getByText('Check before saving')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('The family was entered.')).toBeInTheDocument()
    const body = bodyOf(calls('POST', /\/family-intake$/)[0])
    expect(body).toMatchObject({
      parent: { name: 'Parent Alpha', phone: '010 0123 4567', email: null },
      children: [{ name: 'Child One', teacherId: null, carriedOver: null }],
      onBehalfOf: null,
      confirmOver: false,
    })
    expect(body.intakeId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('the current package: remaining is computed as it is typed, and confirmed on the review', async () => {
    on('GET', /\/family-intake\/options$/, () => json(OPTIONS))
    on('POST', /\/family-intake$/, () =>
      json({ enrolmentId: 'e-1', familyId: 'f-1', contactId: 'p-1', learnerIds: ['k-1'], supervision: 'placed', schedules: [], replay: false }),
    )
    const dialog = await openForm()
    await userEvent.type(within(dialog).getByLabelText(/Parent's full name/), 'Parent Alpha')
    await userEvent.type(within(dialog).getByLabelText(/Phone number/), '010 0123 4567')
    await userEvent.type(within(dialog).getByLabelText(/Child's name/), 'Child One')
    await userEvent.type(within(dialog).getByLabelText('Total lessons'), '20')
    await userEvent.type(within(dialog).getByLabelText('Completed lessons'), '12')
    await userEvent.type(within(dialog).getByLabelText('Plan length (months)'), '3')
    expect(within(dialog).getByTestId('remaining-0')).toHaveTextContent('Remaining: 8')
    expect(within(dialog).getByTestId('remaining-0')).toHaveTextContent('Active')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Review' }))
    expect(within(dialog).getByTestId('review-package-0')).toHaveTextContent('Total lessons 20 · Completed lessons 12 · Remaining 8 · 3 months')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await screen.findByText('The family was entered.')
    expect(bodyOf(calls('POST', /\/family-intake$/)[0]).children[0].carriedOver).toEqual({ total: 20, completed: 12, planMonths: 3 })
  })

  it('completed above the total cannot be sent by a supervisor', async () => {
    on('GET', /\/family-intake\/options$/, () => json(OPTIONS))
    const dialog = await openForm()
    await userEvent.type(within(dialog).getByLabelText(/Parent's full name/), 'Parent Alpha')
    await userEvent.type(within(dialog).getByLabelText(/Phone number/), '010 0123 4567')
    await userEvent.type(within(dialog).getByLabelText(/Child's name/), 'Child One')
    await userEvent.type(within(dialog).getByLabelText('Total lessons'), '20')
    await userEvent.type(within(dialog).getByLabelText('Completed lessons'), '21')
    expect(within(dialog).getByTestId('remaining-0')).toHaveTextContent('Over by 1')
    expect(within(dialog).getByText(/only the Operations Manager, the Sales Manager or the super admin/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Review' }))
    expect(within(dialog).queryByText('Check before saving')).not.toBeInTheDocument()
  })

  it('PARENT_EXISTS: the children go to that family instead, as Add child', async () => {
    on('GET', /\/family-intake\/options$/, () => json(OPTIONS))
    on('POST', /\/family-intake$/, () =>
      json({ error: { code: 'COMM.PARENT_EXISTS', message: 'this parent is already in Chat', detail: { familyId: 'f-9', contactId: 'p-9', parentName: 'Parent Nine' } } }, 409),
    )
    on('POST', /\/family-intake\/families\/f-9\/children$/, () =>
      json({ enrolmentId: 'e-2', familyId: 'f-9', learnerIds: ['k-9'], supervision: 'placed', schedules: [], replay: false }),
    )
    const dialog = await openForm()
    await userEvent.type(within(dialog).getByLabelText(/Parent's full name/), 'Parent Nine')
    await userEvent.type(within(dialog).getByLabelText(/Phone number/), '010 0123 4567')
    await userEvent.type(within(dialog).getByLabelText(/Child's name/), 'Child Two')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Review' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('This parent is already in Chat.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /Add the children to this family/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('The child was added.')).toBeInTheDocument()
    expect(bodyOf(calls('POST', /\/family-intake\/families\/f-9\/children$/)[0]).children).toEqual([
      expect.objectContaining({ name: 'Child Two' }),
    ])
  })
})
