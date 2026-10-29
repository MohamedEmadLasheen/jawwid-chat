import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { CasesPage } from './CasesPage'
import { OpenCaseButton } from './OpenCaseDialog'
import { CaseEscalatedCard } from './CaseEscalatedCard'
import type { CaseDetail, CaseSummary } from './api'

/**
 * PD-35 B5: escalation cases in Admin Web, with `fetch` answered at the network
 * boundary. Who may open, see and act is the server's
 * (supervision-cases-pd035.spec.ts); the page shows what it is given. Synthetic
 * people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response
let routes: Array<[string, RegExp, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([method, pattern, handler])
const sent = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls
    .filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
    .map(([u, i]) => ({ url: String(u), body: JSON.parse(String((i as RequestInit)?.body ?? '{}')) as Record<string, unknown> }))

const CASE: CaseSummary = {
  id: 'c-1',
  title: 'Late reports again',
  body: 'Three this week',
  status: 'open',
  target: 'teachers',
  subject: { kind: 'teacher', id: 't-1', label: 'Teacher T' },
  teacher: { id: 't-1', name: 'Teacher T' },
  learner: null,
  owner: { id: 'mgr-t', name: 'Teachers Manager' },
  openedBy: { id: 'tsup-1', name: 'Tsup One' },
  dueOn: '2026-11-02',
  createdAt: '2026-10-27T08:00:00Z',
  updatedAt: '2026-10-27T08:00:00Z',
  closedAt: null,
}
const DETAIL: CaseDetail = {
  ...CASE,
  canAct: true,
  events: [{ id: 'ev-1', kind: 'opened', actor: { id: 'tsup-1', name: 'Tsup One' }, at: '2026-10-27T08:00:00Z', note: null }],
}

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [m, pattern, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/cases\?tab=mine/, () => json({ cases: [CASE] }))
  on('GET', /\/cases\?tab=opened/, () => json({ cases: [] }))
  on('GET', /\/cases\?tab=department/, () => json({ cases: [CASE] }))
  on('GET', /\/cases\/c-1$/, () => json(DETAIL))
  on('GET', /\/cases\/c-1\/owners$/, () => json({ owners: [{ id: 'mgr-t', name: 'Teachers Manager' }, { id: 'tsup-2', name: 'Tsup Two' }] }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the cases queue', () => {
  it('lists my cases, and the other tabs on request', async () => {
    renderWithProviders(<CasesPage />, { staff: makeStaff({ id: 'mgr-t', role: 'manager' }) })
    expect(await screen.findByText('Late reports again')).toBeInTheDocument()
    expect(screen.getByText('Teacher T')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Opened by me' }))
    expect(await screen.findByText('No cases here.')).toBeInTheDocument()
    expect(sent('GET', /\/cases\?tab=opened/).length).toBeGreaterThan(0)
  })

  it('opens the tab the URL names, so a Dashboard tile lands on the list it counted (PD-44)', async () => {
    on('GET', /\/cases\?tab=department/, () => json({ cases: [{ ...CASE, id: 'c-2', title: 'Department only' }] }))
    renderWithProviders(<CasesPage />, { staff: makeStaff({ id: 'mgr-t', role: 'manager' }), route: '/cases?tab=department' })
    expect(await screen.findByText('Department only')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'My department' })).toHaveAttribute('aria-selected', 'true')
    expect(sent('GET', /\/cases\?tab=mine/)).toHaveLength(0)
  })

  it('marks exactly one tab selected, in the shared tab style, and moves it on click', async () => {
    renderWithProviders(<CasesPage />, { staff: makeStaff({ id: 'mgr-t', role: 'manager' }) })
    expect(await screen.findByText('Late reports again')).toBeInTheDocument()
    const strip = screen.getByRole('tablist', { name: 'Escalations' })
    expect(strip).toHaveClass('ts-tabs')
    const selected = () => within(strip).getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true')
    expect(selected().map((t) => t.textContent)).toEqual(['Mine'])
    expect(screen.getByRole('tab', { name: 'Mine' })).toHaveClass('ts-tab', 'ts-tab--active')
    expect(screen.getByRole('tab', { name: 'Opened by me' })).not.toHaveClass('ts-tab--active')
    await userEvent.click(screen.getByRole('tab', { name: 'Opened by me' }))
    expect(selected().map((t) => t.textContent)).toEqual(['Opened by me'])
    expect(screen.getByRole('tab', { name: 'Opened by me' })).toHaveClass('ts-tab--active')
    expect(screen.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Mine' })).not.toHaveClass('ts-tab--active')
  })

  it('in Arabic the page is right-to-left and the selected tab is marked the same way', async () => {
    renderWithProviders(<CasesPage />, { staff: makeStaff({ id: 'mgr-t', role: 'manager' }), locale: 'ar' })
    expect(await screen.findByText('Late reports again')).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    expect(screen.getByRole('tab', { name: 'المسندة إليّ' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'قسمي' }))
    expect(screen.getByRole('tab', { name: 'قسمي' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'قسمي' })).toHaveClass('ts-tab--active')
    expect(screen.getByRole('tab', { name: 'المسندة إليّ' })).toHaveAttribute('aria-selected', 'false')
  })

  it('falls back to Mine for a tab the URL names wrongly', async () => {
    renderWithProviders(<CasesPage />, { staff: makeStaff({ id: 'mgr-t', role: 'manager' }), route: '/cases?tab=everything' })
    expect(await screen.findByText('Late reports again')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'true')
  })

  it('resolves a case with a note, and assigns it within the department', async () => {
    on('POST', /\/cases\/c-1\/status$/, () => json({ ...DETAIL, status: 'resolved', closedAt: '2026-10-27T09:00:00Z', canAct: true }))
    on('POST', /\/cases\/c-1\/assign$/, () => json({ ...DETAIL, owner: { id: 'tsup-2', name: 'Tsup Two' } }))
    renderWithProviders(<CasesPage />, { staff: makeStaff({ id: 'mgr-t', role: 'manager' }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Late reports again' }))
    const panel = await screen.findByRole('region', { name: 'Late reports again' })
    expect(within(panel).getByText('Opened')).toBeInTheDocument()

    await userEvent.selectOptions(within(panel).getByRole('combobox', { name: 'Owner' }), 'tsup-2')
    await waitFor(() => expect(sent('POST', /\/cases\/c-1\/assign$/)).toHaveLength(1))
    expect(sent('POST', /\/cases\/c-1\/assign$/)[0]!.body).toEqual({ ownerId: 'tsup-2' })

    await userEvent.click(within(panel).getByRole('button', { name: 'Resolve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Resolve' })
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'On time for two weeks')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /\/cases\/c-1\/status$/)).toHaveLength(1))
    expect(sent('POST', /\/cases\/c-1\/status$/)[0]!.body).toEqual({ status: 'resolved', note: 'On time for two weeks' })
  })

  it('offers no actions to someone who may only read the case', async () => {
    on('GET', /\/cases\/c-1$/, () => json({ ...DETAIL, canAct: false }))
    renderWithProviders(<CasesPage />, { staff: makeStaff({ id: 'tsup-1', role: 'admin' }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Late reports again' }))
    const panel = await screen.findByRole('region', { name: 'Late reports again' })
    expect(within(panel).queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('combobox', { name: 'Owner' })).not.toBeInTheDocument()
  })
})

describe('opening a case', () => {
  it('escalates about a teacher to the Teachers Manager', async () => {
    on('POST', /\/cases$/, () => json(CASE))
    renderWithProviders(<OpenCaseButton subject={{ kind: 'teacher', id: 't-1' }} target="teachers" />, { staff: makeStaff({ role: 'admin' }) })
    await userEvent.click(screen.getByRole('button', { name: 'Escalate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Escalate' })
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Late reports again')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Details' }), 'Three this week')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sent('POST', /\/cases$/)).toHaveLength(1))
    expect(sent('POST', /\/cases$/)[0]!.body).toEqual({
      subject: { kind: 'teacher', id: 't-1' },
      target: 'teachers',
      title: 'Late reports again',
      body: 'Three this week',
    })
  })
})

describe('B6: a case in the department room', () => {
  it('the case_escalated card names who opened it and who owns it, and links to the case', () => {
    renderWithProviders(
      <CaseEscalatedCard payload={{ caseId: 'c-1', ownerId: 'mgr-t', ownerName: 'Teachers Manager', openedBy: 'tsup-1', openedByName: 'Tsup One' }} />,
      { staff: makeStaff({ role: 'admin' }) },
    )
    expect(screen.getByText(/Tsup One escalated a case/)).toBeInTheDocument()
    expect(screen.getByText(/Teachers Manager/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in Escalations' })).toHaveAttribute('href', '/cases?case=c-1')
  })

  it('Escalations opens the case named in the link', async () => {
    renderWithProviders(<CasesPage />, { staff: makeStaff({ id: 'mgr-t', role: 'manager' }), route: '/cases?case=c-1' })
    expect(await screen.findByRole('region', { name: 'Late reports again' })).toBeInTheDocument()
  })
})

