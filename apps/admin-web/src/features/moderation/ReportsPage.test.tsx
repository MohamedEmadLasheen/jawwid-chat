import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tokenStore } from '@/core/auth/tokens'
import { destinationsFor, entriesOf } from '@/app/navigation'
import { holdsAny, navAreas, visibleAreas } from '@/core/permissions/capabilities'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { chooseOption } from '@/test/select'
import { ReportsPage } from './ReportsPage'
import { MOD, REASON, RESOLUTION } from './copy'
import type { QueueReport, ReportDetail as Detail } from './api'

/**
 * WP-1C (PD-57): the moderation queue against the frozen §5.4 contract. The
 * API is mocked; the clock is fixed (Date only), so nothing here depends on
 * today. Synthetic ids and text only.
 */
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0)
const H = 3_600_000
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const iso = (ms: number) => new Date(ms).toISOString()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
let fetchMock: ReturnType<typeof vi.fn>
let queue: QueueReport[]
let detail: Detail
const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
const headerOf = (init: RequestInit, name: string) => new Headers(init.headers).get(name)

const report = (over: Partial<QueueReport>): QueueReport => ({
  id: 'r1', targetKind: 'message', reason: 'spam', priority: 'normal', status: 'open',
  createdAt: iso(NOW - 2 * H), dueAt: iso(NOW + 46 * H), ...over,
})
const MANAGER = makeStaff({ id: 'm1', role: 'manager', permissions: ['moderation.view', 'moderation.act'] })
const VIEWER = makeStaff({ id: 'm2', role: 'manager', permissions: ['moderation.view'] })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  queue = [
    report({ id: 'cs', reason: 'child_safety', priority: 'urgent', dueAt: iso(NOW + 40 * H) }),
    report({ id: 'late', reason: 'harassment', dueAt: iso(NOW - (2 * H + 30 * 60_000)), overdueAt: iso(NOW - H) }),
    report({ id: 'soon', reason: 'spam', status: 'in_review', takenBy: 'Reviewer B', dueAt: iso(NOW + 5 * H + 15 * 60_000) }),
    report({ id: 'done', reason: 'other', status: 'actioned', reporterAnsweredAt: iso(NOW - H) }),
  ]
  detail = { ...queue[0]!, note: 'a note', evidence: { body: 'deleted words', author: { name: 'Author X' }, deletedAt: iso(NOW - H), attachments: ['k1', 'k2'] } }
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    if (method === 'GET' && /\/moderation\/reports\/[^/?]+$/.test(url)) return json(detail)
    if (method === 'GET' && /\/moderation\/reports(\?|$)/.test(url)) return json(queue)
    if (method === 'POST' && /\/take$/.test(url)) return json({})
    if (method === 'POST' && /\/resolve$/.test(url)) return json({})
    return json({ error: { code: 'unrouted', message: url } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const ids = new WeakMap<HTMLElement, string>()
async function rows() {
  await screen.findAllByTestId('report-row')
  const els = screen.getAllByTestId('report-row')
  els.forEach((el, i) => ids.set(el, queue[i]!.id))
  return els
}

describe.each([['en'], ['ar']] as const)('The moderation queue (%s)', (locale) => {
  const L = (p: { ar: string; en: string }) => p[locale]
  const L2 = (p: { ar: string; en: string }, v: Record<string, number>) => L(p).replace(/\{(\w+)\}/g, (_, k: string) => String(v[k]))

  it('lists the reports in the order the server gave, with labels in this language', async () => {
    renderWithProviders(<ReportsPage />, { locale, staff: MANAGER })
    const els = await rows()
    expect(els).toHaveLength(4)
    expect(within(els[0]!).getByText(L(REASON.child_safety))).toBeInTheDocument()
    expect(within(els[1]!).getByText(L(REASON.harassment))).toBeInTheDocument()
    expect(screen.getByText(L(MOD.title))).toBeInTheDocument()
    expect(screen.getByText(L(MOD.draftNote))).toBeInTheDocument()
  })

  it('shows the due clock from a fixed now: time left, the warning, and overdue', async () => {
    renderWithProviders(<ReportsPage />, { locale, staff: MANAGER })
    const els = await rows()
    const clock = (i: number) => within(els[i]!).getByTestId('due-clock')
    expect(clock(0)).toHaveTextContent(L2(MOD.left, { h: 40, m: 0 }))
    expect(clock(0)).toHaveAttribute('data-state', 'ok')
    expect(clock(1)).toHaveTextContent(L2(MOD.past, { h: 2, m: 30 }))
    expect(clock(1)).toHaveAttribute('data-state', 'overdue')
    expect(clock(2)).toHaveTextContent(L2(MOD.left, { h: 5, m: 15 }))
    expect(clock(2)).toHaveAttribute('data-state', 'warn')
    expect(within(els[3]!).queryByTestId('due-clock')).toBeNull()
    expect(within(els[3]!).getByText(L(MOD.closed))).toBeInTheDocument()
  })

  it('badges only the child-safety report', async () => {
    renderWithProviders(<ReportsPage />, { locale, staff: MANAGER })
    const els = await rows()
    expect(within(els[0]!).getByText(L(MOD.childSafetyBadge))).toBeInTheDocument()
    for (const i of [1, 2, 3]) expect(within(els[i]!).queryByText(L(MOD.childSafetyBadge))).toBeNull()
  })

  it('sends the status, child-safety (priority=urgent) and overdue filters to the contract', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<ReportsPage />, { locale, staff: MANAGER })
    await rows()
    await chooseOption(user, screen.getByRole('combobox', { name: L(MOD.filterStatus) }), 'in_review')
    await waitFor(() => expect(calls('GET', /status=in_review/).length).toBeGreaterThan(0))
    await user.click(screen.getByLabelText(L(MOD.childSafetyOnly)))
    await waitFor(() => expect(calls('GET', /status=in_review.*priority=urgent|priority=urgent.*status=in_review/).length).toBeGreaterThan(0))
    await user.click(screen.getByLabelText(L(MOD.overdueOnly)))
    await waitFor(() => expect(calls('GET', /overdue=true/).length).toBeGreaterThan(0))
  })

  it('narrows by reason on the rows returned (the contract has no reason parameter)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<ReportsPage />, { locale, staff: MANAGER })
    await rows()
    await chooseOption(user, screen.getByRole('combobox', { name: L(MOD.filterReason) }), 'spam')
    await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(1))
    expect(calls('GET', /reason=/)).toHaveLength(0)
  })

  it('takes a report: POST /moderation/reports/:id/take with an Idempotency-Key', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<ReportsPage />, { locale, staff: MANAGER })
    const els = await rows()
    await user.click(within(els[0]!).getByRole('button', { name: L(MOD.take) }))
    await waitFor(() => expect(calls('POST', /\/moderation\/reports\/cs\/take$/)).toHaveLength(1))
    const init = calls('POST', /\/take$/)[0]![1] as RequestInit
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
    // Already taken (in_review) offers no Take.
    expect(within(els[2]!).queryByRole('button', { name: L(MOD.take) })).toBeNull()
  })

  it('calmly reports a report somebody else took first (409)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<ReportsPage />, { locale, staff: MANAGER })
    const els = await rows()
    const inner = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (i: RequestInfo | URL, init?: RequestInit) =>
      String(i).endsWith('/take') ? json({ error: { code: 'COMM.REPORT_ALREADY_TAKEN', message: 'x', messageAr: 'x' } }, 409) : inner(i, init),
    )
    await user.click(within(els[0]!).getByRole('button', { name: L(MOD.take) }))
    expect(await screen.findByText(L(MOD.alreadyTaken))).toBeInTheDocument()
  })

  it('opens the detail (GET /moderation/reports/:id) with the evidence of a deleted message and no reporter', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    detail = { ...detail, reporterId: 'rep-1', reporterAccountId: 'acc-1', reporter: { name: 'Reporter Name' } } as Detail
    renderWithProviders(<ReportsPage />, { locale, staff: MANAGER })
    const els = await rows()
    expect(calls('GET', /\/moderation\/reports\/cs$/)).toHaveLength(0)
    await user.click(within(els[0]!).getByRole('button', { name: L(MOD.view) }))
    const ev = await screen.findByTestId('evidence')
    expect(ev).toHaveTextContent('deleted words')
    expect(ev).toHaveTextContent(L(MOD.evidenceDeleted))
    expect(ev).toHaveTextContent(L2(MOD.evidenceAttachments, { n: 2 }))
    expect(calls('GET', /\/moderation\/reports\/cs$/)).toHaveLength(1)
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('Reporter Name')
    expect(text).not.toContain('rep-1')
    expect(text).not.toContain('acc-1')
    expect(text).not.toContain('k1')
  })

  it('resolve needs an answer, then POSTs {resolution, note, answer} to /resolve', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<ReportsPage />, { locale, staff: MANAGER })
    const els = await rows()
    await user.click(within(els[0]!).getByRole('button', { name: L(MOD.resolve) }))
    const form = await screen.findByRole('form', { name: L(MOD.resolve) })
    await user.click(within(form).getByRole('button', { name: L(MOD.submitResolve) }))
    expect(await within(form).findByText(L(MOD.answerRequired))).toBeInTheDocument()
    expect(calls('POST', /\/resolve$/)).toHaveLength(0)

    await chooseOption(user, within(form).getByRole('combobox'), 'message_removed')
    await user.type(within(form).getByRole('textbox', { name: new RegExp(esc(L(MOD.answerLabel))) }), 'We removed it.')
    await user.type(within(form).getByRole('textbox', { name: new RegExp(esc(L(MOD.resolutionNote))) }), 'internal')
    await user.click(within(form).getByRole('button', { name: L(MOD.submitResolve) }))
    await waitFor(() => expect(calls('POST', /\/moderation\/reports\/cs\/resolve$/)).toHaveLength(1))
    const init = calls('POST', /\/resolve$/)[0]![1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ resolution: 'message_removed', note: 'internal', answer: 'We removed it.' })
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
    expect(L(RESOLUTION.message_removed)).toBeTruthy()
  })

  it('offers no write actions without moderation.act', async () => {
    renderWithProviders(<ReportsPage />, { locale, staff: VIEWER })
    const els = await rows()
    expect(screen.queryByRole('button', { name: L(MOD.take) })).toBeNull()
    expect(screen.queryByRole('button', { name: L(MOD.resolve) })).toBeNull()
    expect(within(els[0]!).getByRole('button', { name: L(MOD.view) })).toBeInTheDocument()
  })
})

describe('Who sees the moderation queue', () => {
  it('lists it for a manager or the super admin holding moderation.view, and for nobody else', () => {
    const paths = (role: Parameters<typeof destinationsFor>[0], moderation: boolean) =>
      destinationsFor(role, { moderation }).flatMap((d) => entriesOf(d).map((e) => e.path))
    expect(paths('manager', true)).toContain('/moderation')
    expect(paths('manager', false)).not.toContain('/moderation')
    expect(paths('super_admin', true)).toContain('/moderation')
    for (const role of ['admin', 'coverage', 'finance', 'technical', 'academic', 'specialist'] as const) {
      expect(paths(role, true), role).not.toContain('/moderation')
      expect(visibleAreas(role), role).not.toContain('moderation')
      expect(navAreas(role, { moderation: true }), role).not.toContain('moderation')
    }
  })

  it('keys the page on the permission, failing closed', () => {
    expect(holdsAny(makeStaff({ role: 'manager', permissions: ['moderation.view'] }), ['moderation.view'])).toBe(true)
    expect(holdsAny(makeStaff({ role: 'manager', permissions: [] }), ['moderation.view'])).toBe(false)
    expect(holdsAny(makeStaff({ role: 'manager' }), ['moderation.view'])).toBe(false)
  })
})
