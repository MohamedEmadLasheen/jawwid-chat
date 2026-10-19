import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { destinationsFor, entriesOf } from '@/app/navigation'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { Instalment, InstalmentList } from './api'

/**
 * PD-12 S3 Instalment Payments page, through the real routes and the real API
 * client, with `fetch` answered at the network boundary. These prove the
 * page's side: the server's order and status are shown as sent, "Core not
 * connected" and "Core down" never read as "nothing due", and setting a
 * billing supervisor asks for a reason first. Who sees which family, and what
 * the database allows, is proven server-side (apps/api pd012-s3.spec.ts).
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

function row(over: Partial<Instalment> = {}): Instalment {
  return {
    id: 'inv-1',
    family: { id: 'f-1', name: 'Family Alpha' },
    account: { name: 'Parent Alpha' },
    child: null,
    amountMinor: 150000,
    currency: 'EGP',
    dueDate: '2026-10-10',
    status: 'overdue',
    days: 9,
    paidAt: null,
    label: null,
    responsibleSupervisor: null,
    responsibleBasis: 'family',
    conversationId: 'c-1',
    ...over,
  }
}

function list(items: Instalment[], over: Partial<InstalmentList> = {}): InstalmentList {
  return {
    source: 'core',
    today: '2026-10-19',
    canAssignBillingSupervisor: false,
    items,
    counts: { overdue: 1, due: 1, upcoming: 0, paid: 0, unassigned: 1 },
    ...over,
  }
}

const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })
const manager = makeStaff({ id: 'm-1', name: 'Operations Manager', role: 'manager' })

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

describe('the instalments page', () => {
  it('shows the server\'s rows in its order: payer, child or family, amount, status, responsible supervisor, conversation', async () => {
    on('GET', /\/instalments\?responsible=all$/, () =>
      json(
        list([
          row(),
          row({
            id: 'inv-2',
            child: { id: 'k-1', name: 'Child Beta', known: true },
            status: 'due',
            dueDate: '2026-10-19',
            days: 0,
            responsibleSupervisor: { id: 's-1', name: 'Supervisor One' },
            responsibleBasis: 'child',
            conversationId: null,
          }),
        ]),
      ),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/instalments' })
    const rows = (await screen.findAllByRole('row')).slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Parent Alpha')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('The family')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Overdue')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('9 days late')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(/1,500/)).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Not set')).toBeInTheDocument()
    expect(within(rows[0]!).getByRole('link', { name: 'Open conversation' })).toHaveAttribute('href', '/chat/c-1')
    // A supervisor cannot set a billing supervisor: no button is offered.
    expect(within(rows[0]!).queryByRole('button', { name: 'Set' })).not.toBeInTheDocument()
    expect(within(rows[1]!).getByText('Child Beta')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Due today')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Supervisor One')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('No conversation you can open')).toBeInTheDocument()
    expect(screen.getByText(/^1 overdue/)).toHaveTextContent('1 overdue · 1 due today · 0 upcoming · 1 without a responsible supervisor')
  })

  it('filters by responsibility and asks for paid invoices only when shown', async () => {
    on('GET', /\/instalments\?/, () => json(list([])))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/instalments' })
    await screen.findByText('Nothing due.')
    await userEvent.click(screen.getByRole('button', { name: 'No billing supervisor' }))
    await screen.findByText('Nothing matches this filter.')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show paid' }))
    await waitFor(() => expect(calls('GET', /\/instalments\?responsible=none&paid=true$/)).toHaveLength(1))
  })

  it('Core not connected is said plainly -- never "Nothing due"', async () => {
    on('GET', /\/instalments\?/, () => json(list([], { source: 'not_connected' })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/instalments' })
    expect(await screen.findByText('Jawwid Core is not connected yet')).toBeInTheDocument()
    expect(screen.queryByText('Nothing due.')).not.toBeInTheDocument()
  })

  it('Core down is an error, not an empty list', async () => {
    on('GET', /\/instalments\?/, () => json({ error: { code: 'COMM.BILLING_CORE_UNAVAILABLE', message: 'down' } }, 502))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/instalments' })
    expect(await screen.findByText(/Jawwid Core did not answer/, {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByText('Nothing due.')).not.toBeInTheDocument()
  })

  it('the Operations Manager sets a family\'s billing supervisor among its children\'s supervisors, with a reason', async () => {
    on('GET', /\/instalments\?/, () => json(list([row()], { canAssignBillingSupervisor: true })))
    on('GET', /\/families\/f-1\/billing-supervisor$/, () =>
      json({
        familyId: 'f-1',
        current: null,
        candidates: [
          { id: 's-1', name: 'Supervisor One', children: ['Child Alpha'] },
          { id: 's-2', name: 'Supervisor Two', children: ['Child Beta', 'Child Gamma'] },
        ],
        canAssign: true,
      }),
    )
    on('POST', /\/families\/f-1\/billing-supervisor$/, () => json({ familyId: 'f-1', supervisorId: 's-2', changed: true }))
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/instalments' })
    await userEvent.click(await screen.findByRole('button', { name: 'Set' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('supervises Child Beta, Child Gamma')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('radio', { name: /Supervisor Two/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Say why.')).toBeInTheDocument()
    expect(calls('POST', /billing-supervisor$/)).toHaveLength(0)
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'handles the family account')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /billing-supervisor$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /billing-supervisor$/)[0])).toEqual({ supervisorId: 's-2', reason: 'handles the family account' })
  })
})

describe('the Instalments navigation entry', () => {
  const has = (role: 'admin' | 'manager' | 'coverage', billingReader: boolean) =>
    destinationsFor(role, { billingReader }).some((d) => entriesOf(d).some((e) => e.key === 'instalments'))

  it('is offered only when the server confirms Operations', () => {
    expect(has('admin', true)).toBe(true)
    expect(has('manager', true)).toBe(true)
    expect(has('admin', false)).toBe(false)
    expect(has('manager', false)).toBe(false)
  })

  it('is a section of the Admin Portal for the super admin', () => {
    expect(destinationsFor('super_admin').some((d) => entriesOf(d).some((e) => e.key === 'instalments'))).toBe(true)
  })
})
