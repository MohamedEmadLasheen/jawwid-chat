import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { LeadDetail, LeadPage, LeadRow } from './api'

/**
 * The Sales pipeline as a request queue, from 1100px: the detail panel stays on
 * screen, and it must never read a lead by itself -- reading the contact is an
 * audited event, so it happens once, when a lead is opened. The actions and
 * what they send are proven in SalesPipeline.test.tsx (the narrow width).
 * Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
type Handler = (url: string, init: RequestInit) => Response
let routes: Array<[string, RegExp, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([method, pattern, handler])
const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)

const SECRET_PHONE = '+201001234567'

const row = (over: Partial<LeadRow> = {}): LeadRow => ({
  id: 'lead-1',
  owner: { id: 's-1', name: 'Rep One' },
  displayName: 'Lead Alpha',
  level: null,
  stage: 'contacted',
  lostReason: null,
  manualStage: true,
  lastContactedAt: '2026-11-18T10:00:00Z',
  nextFollowUpOn: '2026-11-20',
  followUpDue: true,
  followUpNote: null,
  createdAt: '2026-11-10T09:00:00Z',
  handedOver: false,
  contact: { phone: true, whatsapp: false, email: false },
  ...over,
})

const PAGE: LeadPage = {
  leads: [row(), row({ id: 'lead-2', displayName: 'Lead Beta', stage: 'lost', lostReason: 'price', nextFollowUpOn: null, followUpDue: false })],
  total: 2,
  counts: { new_lead: 0, contacted: 1, trial_booked: 0, trial_completed: 0, converted: 0, lost: 1 },
  dueCount: 1,
  limit: 25,
  offset: 0,
  truncated: false,
}

const detail = (over: Partial<LeadDetail> = {}): LeadDetail => ({
  id: 'lead-1',
  owner: { id: 's-1', name: 'Rep One' },
  displayName: 'Lead Alpha',
  level: null,
  note: null,
  stage: 'contacted',
  lostReason: null,
  manualStage: true,
  lastContactedAt: '2026-11-18T10:00:00Z',
  nextFollowUpOn: '2026-11-20',
  followUpDue: true,
  followUpNote: null,
  createdAt: '2026-11-10T09:00:00Z',
  convertedAt: null,
  familyId: null,
  canConvert: true,
  trial: null,
  contact: { parentName: 'Parent One', phone: SECRET_PHONE, whatsapp: null, email: null, country: 'EG' },
  ...over,
})

const sales = makeStaff({ id: 's-1', name: 'Sales One', role: 'admin' })

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [m, pattern, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  // From 1100px: the stages are columns and the inspector is on screen beside them.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: true, operations: false }))
  on('GET', /\/sales-pipeline\/leads(\?.*)?$/, () => json(PAGE))
  on('GET', /\/sales-pipeline\/leads\/lead-1$/, () => json(detail()))
  on('GET', /\/sales-pipeline\/leads\/lead-2$/, () => json(detail({ id: 'lead-2', displayName: 'Lead Beta', stage: 'lost', lostReason: 'price', canConvert: false, followUpDue: false, contact: null })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the pipeline board and the lead beside it', () => {
  it('opens no lead by itself: there is no panel and no contact is read until a lead is opened', async () => {
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    await screen.findByText('Lead Alpha')
    expect(screen.queryByRole('complementary', { name: 'Lead details' })).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(calls('GET', /\/sales-pipeline\/leads\/lead-[0-9]$/)).toHaveLength(0)
    expect(document.body.textContent).not.toContain(SECRET_PHONE)
  })

  it('opening a lead reads it once; the panel shows its steps, its contact and its actions', async () => {
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    const open = await screen.findByRole('button', { name: 'Open Lead Alpha' })
    await userEvent.click(open)
    const panel = screen.getByRole('complementary', { name: 'Lead details' })
    expect(await within(panel).findByText(SECRET_PHONE)).toBeInTheDocument()
    expect(open).toHaveAttribute('aria-current', 'true')
    expect(within(panel).getByRole('heading', { name: 'Lead Alpha' })).toBeInTheDocument()
    // The read is said to be recorded where the contact is shown.
    expect(within(panel).getByText('Opening these details is recorded in the audit log.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(within(panel).getByRole('list', { name: 'Steps' })).getAllByRole('listitem').map((li) => li.querySelector('.rq-step__label')?.textContent)).toEqual([
      'New lead (done)', 'Contacted (now)', 'Trial booked (next)', 'Trial completed (next)', 'Converted (next)',
    ])
    // The server's overdue follow-up is the panel's one problem mark.
    expect(within(panel).getByText('Follow-up due')).toBeInTheDocument()
    // The foot states the one next act; the rest is behind "⋯", what ends the lead last.
    const foot = panel.querySelector<HTMLElement>('.rq-foot')!
    expect(within(foot).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Convert', 'More actions: Lead Alpha'])
    expect(within(foot).getByRole('button', { name: 'Convert' })).toHaveClass('btn--primary')
    await userEvent.click(within(foot).getByRole('button', { name: 'More actions: Lead Alpha' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Mark contacted', 'Mark lost'])
    await userEvent.keyboard('{Escape}')
    // Selecting the same row again, or a re-render of the page, is not another read.
    await userEvent.click(open)
    await new Promise((r) => setTimeout(r, 50))
    expect(calls('GET', /\/sales-pipeline\/leads\/lead-1$/)).toHaveLength(1)
  })

  it('closing the panel puts the contact away; another lead is its own single read', async () => {
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    await userEvent.click(await screen.findByRole('button', { name: 'Open Lead Alpha' }))
    const panel = screen.getByRole('complementary', { name: 'Lead details' })
    await within(panel).findByText(SECRET_PHONE)
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(document.body.textContent).not.toContain(SECRET_PHONE)
    expect(screen.queryByRole('complementary', { name: 'Lead details' })).not.toBeInTheDocument()

    // A lost lead is a quiet card: it opens from its name.
    await userEvent.click(screen.getByRole('button', { name: 'Lead Beta' }))
    const again = screen.getByRole('complementary', { name: 'Lead details' })
    await within(again).findByText('No contact details are on file.')
    // A lost lead got as far as its record shows, and ends in Lost with its reason.
    const steps = within(within(again).getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
    expect(steps.map((li) => li.querySelector('.rq-step__label')?.textContent)).toEqual([
      'New lead (done)', 'Contacted (done)', 'Trial booked (skipped)', 'Trial completed (skipped)', 'Converted (skipped)', 'Lost (problem)',
    ])
    expect(steps.at(-1)).toHaveTextContent('Price')
    expect(within(again).getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
    expect(calls('GET', /\/sales-pipeline\/leads\/lead-2$/)).toHaveLength(1)
    expect(calls('GET', /\/sales-pipeline\/leads\/lead-1$/)).toHaveLength(1)
  })

  it('one page of leads shows no pager; a second page brings it back', async () => {
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    await screen.findByText('Lead Alpha')
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument()
  })

  it('a stage with more leads than the board\'s read brought says so, and opens as the server\'s own paged list', async () => {
    on('GET', /\/sales-pipeline\/leads(\?.*)?$/, (url) =>
      /stage=contacted/.test(url)
        ? json({ ...PAGE, leads: [row()], total: 30, counts: { ...PAGE.counts, contacted: 30 } })
        : json({ ...PAGE, total: 31, counts: { ...PAGE.counts, contacted: 30 } }))
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    await screen.findByText('Lead Alpha')
    const contacted = screen.getByRole('region', { name: 'Contacted' })
    // The column is headed by the server's count, not by how many cards the read brought.
    expect(contacted.querySelector('.count')).toHaveTextContent(/^30$/)
    expect(within(contacted).getAllByRole('article')).toHaveLength(1)
    await userEvent.click(within(contacted).getByRole('button', { name: 'Show all 30' }))
    await waitFor(() => expect(calls('GET', /stage=contacted/).length).toBeGreaterThan(0))
    // The stage alone, with its pager.
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Stage' })).getAllByRole('region')).toHaveLength(1))
    expect(await screen.findByRole('button', { name: 'Next' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    // "Leads" in the masthead is the way back to every stage.
    await userEvent.click(screen.getByRole('button', { name: /^Leads/ }))
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Stage' })).getAllByRole('region')).toHaveLength(6))
  })

  it('one column per stage, each headed by the server\'s count, and a lead stands in the column of its stage', async () => {
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    await screen.findByText('Lead Alpha')
    const board = screen.getByRole('group', { name: 'Stage' })
    const columns = within(board).getAllByRole('region')
    expect(columns.map((c) => c.getAttribute('aria-label'))).toEqual(['New lead', 'Contacted', 'Trial booked', 'Trial completed', 'Converted', 'Lost'])
    expect(columns.map((c) => c.querySelector('.count')?.textContent)).toEqual(['0', '1', '0', '0', '0', '1'])
    const alpha = within(within(board).getByRole('region', { name: 'Contacted' })).getByText('Lead Alpha').closest('article')!
    // The card: whose it is, what is on file (never the contact itself), and the follow-up that is due.
    expect(within(alpha).getByText('Rep One')).toBeInTheDocument()
    expect(within(alpha).getByText('Phone')).toBeInTheDocument()
    expect(within(alpha).getByText('Follow-up due')).toBeInTheDocument()
    expect(alpha.textContent).not.toContain(SECRET_PHONE)
    // Its one action is to open it.
    expect(within(alpha).getAllByRole('button').map((b) => b.textContent)).toEqual(['Open'])
    const beta = within(within(board).getByRole('region', { name: 'Lost' })).getByText('Lead Beta').closest('article')!
    expect(within(beta).getByText('Price')).toBeInTheDocument()
    expect(within(within(board).getByRole('region', { name: 'New lead' })).getByText('No lead at this stage.')).toBeInTheDocument()
  })

  it('the masthead carries the totals and the follow-ups that are due, which filter across every stage', async () => {
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    await screen.findByText('Lead Alpha')
    const all = screen.getByRole('button', { name: /^Leads/ })
    expect(all).toHaveTextContent(/^Leads2$/)
    expect(all).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Being worked').closest('.figure')).toHaveTextContent(/^Being worked1$/)
    const due = screen.getByRole('button', { name: /^Follow-up due/ })
    expect(due).toHaveTextContent(/^Follow-up due1$/)
    expect(due).toHaveClass('figure--urgent')
    expect(due).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(due)
    expect(due).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(calls('GET', /followUp=due/).length).toBeGreaterThan(0))
    // It filters alongside the stage, not instead of it.
    expect(all).toHaveAttribute('aria-pressed', 'true')
  })
})
