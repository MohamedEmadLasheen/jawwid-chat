import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { TasksPage } from './TasksPage'
import type { TaskDetail, TaskSummary } from './api'

/**
 * PD-47 PR-3: the Tasks page, with `fetch` answered at the network boundary.
 * Who sees a task, its level and what the viewer may do are the server's
 * (tasks-pd047.spec.ts and the priority, sources and financial specs); the
 * page draws what it is given. Synthetic people only.
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

const BASE: TaskSummary = {
  id: 't-1',
  kind: 'manual',
  state: 'open',
  outcome: null,
  assignee: { kind: 'staff', id: 'sup-1' },
  assigneeName: 'Sup One',
  needsReassignment: false,
  unmanaged: false,
  title: 'Call the family back',
  body: 'They asked about the schedule',
  dueAt: '2026-11-02T15:00:00Z',
  instructions: null,
  disputedCount: 0,
  createdBy: { id: 'mgr-1', name: 'Ops Manager' },
  createdAt: '2026-10-27T08:00:00Z',
  updatedAt: '2026-10-27T08:00:00Z',
  activityAt: '2026-10-27T08:00:00Z',
  closedBy: null,
  closedAt: null,
  closeReason: null,
  revision: 1,
  manualPriority: 'medium',
  effectivePriority: 'medium',
  priorityReason: 'manual',
  overdue: false,
  category: 'operational',
  source: null,
  sourceState: null,
  titleKey: null,
  titleParams: null,
}
const INSTALMENT: TaskSummary = {
  ...BASE,
  id: 't-2',
  kind: 'system',
  title: '',
  body: null,
  createdBy: null,
  manualPriority: 'low',
  effectivePriority: 'high',
  priorityReason: 'overdue',
  overdue: true,
  category: 'financial',
  source: { type: 'instalment', id: 'inst-1' },
  sourceState: 'pending',
  titleKey: 'task.instalment',
  titleParams: { label: 'October', amountMinor: 50000, currency: 'EGP', familyName: 'family_x', learnerId: 'lrn-1' },
}
const detail = (t: TaskSummary, actions: TaskDetail['actions'], history: TaskDetail['history'] = []): TaskDetail => ({
  ...t,
  actions,
  history: history.length
    ? history
    : [{ id: 'ev-1', kind: 'created', actor: t.createdBy ? { kind: 'staff', ...t.createdBy } : null, fromAssigneeId: null, toAssigneeId: t.assignee.id, body: null, before: null, after: null, at: t.createdAt }],
})
const page = (items: TaskSummary[], nextCursor: string | null = null) => ({ asOf: '2026-10-28T10:00:00Z', items, nextCursor })

const supervisor = makeStaff({ id: 'sup-1', role: 'admin', permissions: [] })
const manager = makeStaff({ id: 'mgr-1', role: 'manager', permissions: ['tasks.team', 'tasks.manage', 'tasks.create'] })
const superAdmin = makeStaff({ id: 'sa-1', role: 'super_admin' })

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
  on('GET', /\/me\/tasks/, () => json(page([INSTALMENT, BASE])))
  on('GET', /\/tasks\?view=/, () => json(page([BASE])))
  on('GET', /\/tasks\/t-1$/, () => json(detail(BASE, ['complete', 'out_of_scope', 'comment'])))
  on('GET', /\/tasks\/t-2$/, () => json(detail(INSTALMENT, ['comment'])))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the list', () => {
  it('shows my tasks in the server\'s order, each level as an icon, a word and a reason, and finance tagged', async () => {
    renderWithProviders(<TasksPage />, { staff: supervisor })
    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    // The system task's title is ours, filled from its source.
    expect(within(rows[0]!).getByRole('button', { name: /Instalment due: family_x, October/ })).toBeInTheDocument()
    expect(within(rows[0]!).getByTestId('task-level')).toHaveTextContent('High · Overdue')
    expect(within(rows[0]!).getByTestId('task-finance')).toHaveTextContent('Finance')
    expect(within(rows[0]!).getByTestId('task-level').querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // A person's level needs no reason.
    expect(within(rows[1]!).getByTestId('task-level')).toHaveTextContent(/^Medium$/)
    expect(within(rows[1]!).queryByTestId('task-finance')).toBeNull()
    expect(within(rows[1]!).getByText('Given by a person')).toBeInTheDocument()
    expect(sent('GET', /\/me\/tasks/)[0]!.url).toMatch(/state=open/)
  })

  it('reads in Arabic', async () => {
    renderWithProviders(<TasksPage />, { staff: supervisor, locale: 'ar' })
    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0]!).getByTestId('task-level')).toHaveTextContent('عالية · متأخرة')
    expect(within(rows[0]!).getByTestId('task-finance')).toHaveTextContent('مالية')
    expect(screen.getByRole('tab', { name: 'مهامي' })).toBeInTheDocument()
  })

  it('offers each person only their tabs, and New task to who may give one', async () => {
    const { unmount } = renderWithProviders(<TasksPage />, { staff: supervisor })
    await screen.findAllByRole('listitem')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Mine', 'Closed'])
    expect(screen.queryByRole('button', { name: 'New task' })).toBeNull()
    unmount()
    const m = renderWithProviders(<TasksPage />, { staff: manager })
    await screen.findAllByRole('listitem')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Mine', 'Team', 'Decisions', 'Closed'])
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument()
    m.unmount()
    renderWithProviders(<TasksPage />, { staff: superAdmin })
    await screen.findAllByRole('listitem')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Mine', 'Decisions', 'All', 'Closed'])
  })

  it('asks the server for the tab, the filters and the closed ones; never filters itself', async () => {
    renderWithProviders(<TasksPage />, { staff: manager, route: '/tasks?tab=team&overdue=true' })
    await screen.findAllByRole('listitem')
    expect(sent('GET', /\/tasks\?view=team/)[0]!.url).toMatch(/overdue=true/)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Level' }), 'high')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'financial')
    await waitFor(() => expect(sent('GET', /\/tasks\?view=team/).some((r) => /level=high/.test(r.url) && /category=financial/.test(r.url))).toBe(true))
    await userEvent.click(screen.getByRole('tab', { name: 'Closed' }))
    await waitFor(() => expect(sent('GET', /\/me\/tasks/).some((r) => /state=closed/.test(r.url))).toBe(true))
  })

  it('pages with the server\'s cursor', async () => {
    on('GET', /\/me\/tasks\?(?!.*cursor)/, () => json(page([BASE], 'cur-2')))
    on('GET', /\/me\/tasks\?.*cursor=cur-2/, () => json(page([INSTALMENT])))
    renderWithProviders(<TasksPage />, { staff: supervisor })
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
  })
})

describe('a task', () => {
  it('offers its assignee exactly the server\'s actions; "Not my responsibility" sends their reason', async () => {
    on('POST', /\/tasks\/t-1\/out-of-scope$/, () => json({ ...BASE, state: 'awaiting_decision' }))
    renderWithProviders(<TasksPage />, { staff: supervisor, route: '/tasks?task=t-1' })
    const panel = await screen.findByRole('region', { name: 'Call the family back' })
    expect(within(panel).getByRole('button', { name: 'Mark done' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Hand on' })).toBeNull()
    await userEvent.click(within(panel).getByRole('button', { name: 'Not my responsibility' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox'), 'This is the Sales team\'s')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sent('POST', /out-of-scope$/)).toEqual([expect.objectContaining({ body: { comment: 'This is the Sales team\'s' } })]))
  })

  it('a decider hands it on to a department, sets its level, and removes it with a reason', async () => {
    on('GET', /\/tasks\/t-1$/, () => json(detail(BASE, ['comment', 'reassign', 'remove', 'due', 'priority'])))
    on('GET', /\/tasks\/assignees\?task=t-1/, () =>
      json({ people: [{ kind: 'staff', id: 'sup-2', name: 'Sup Two' }], departments: [{ kind: 'sales', managerName: 'Sales Manager' }] }))
    on('POST', /\/tasks\/t-1\/reassign$/, () => json(BASE))
    on('POST', /\/tasks\/t-1\/priority$/, () => json(BASE))
    on('POST', /\/tasks\/t-1\/remove$/, () => json({ ...BASE, state: 'removed' }))
    renderWithProviders(<TasksPage />, { staff: manager, route: '/tasks?task=t-1' })
    const panel = await screen.findByRole('region', { name: 'Call the family back' })
    expect(within(panel).queryByRole('button', { name: 'Mark done' })).toBeNull()

    await userEvent.click(within(panel).getByRole('button', { name: 'Hand on' }))
    let dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(await within(dialog).findByRole('combobox'), 'department:sales')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hand on' }))
    await waitFor(() => expect(sent('POST', /reassign$/)).toEqual([expect.objectContaining({ body: { to: { department: 'sales' } } })]))

    await userEvent.selectOptions(within(panel).getByRole('combobox', { name: 'Level set by a person' }), 'high')
    await waitFor(() => expect(sent('POST', /priority$/)).toEqual([expect.objectContaining({ body: { priority: 'high' } })]))

    await userEvent.click(within(panel).getByRole('button', { name: 'Remove' }))
    dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox'), 'The family withdrew')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(sent('POST', /remove$/)).toEqual([expect.objectContaining({ body: { reason: 'The family withdrew' } })]))
  })

  it('a task whose work went away says so and is acknowledged', async () => {
    const gone = { ...INSTALMENT, sourceState: 'withdrawn' as const }
    on('GET', /\/tasks\/t-2$/, () => json(detail(gone, ['acknowledge', 'out_of_scope', 'comment'])))
    on('POST', /\/tasks\/t-2\/acknowledge$/, () => json({ ...gone, state: 'completed', outcome: 'acknowledged' }))
    renderWithProviders(<TasksPage />, { staff: supervisor, route: '/tasks?task=t-2' })
    const panel = await screen.findByRole('region', { name: /Instalment due/ })
    expect(within(panel).getByText(/no longer exists/)).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/students/lrn-1')
    await userEvent.click(within(panel).getByRole('button', { name: 'Acknowledge' }))
    await waitFor(() => expect(sent('POST', /acknowledge$/)).toHaveLength(1))
  })

  it('a teacher\'s supervisor reads it and is offered nothing; the history names the system', async () => {
    on('GET', /\/tasks\/t-2$/, () =>
      json(detail(INSTALMENT, [], [
        { id: 'ev-1', kind: 'created', actor: null, fromAssigneeId: null, toAssigneeId: 'sup-1', body: null, before: null, after: null, at: '2026-10-27T08:00:00Z' },
        { id: 'ev-2', kind: 'priority_changed', actor: { kind: 'staff', id: 'mgr-1', name: 'Ops Manager' }, fromAssigneeId: null, toAssigneeId: 'sup-1', body: null, before: { priority: 'low' }, after: { priority: 'high' }, at: '2026-10-27T09:00:00Z' },
      ])))
    renderWithProviders(<TasksPage />, { staff: supervisor, route: '/tasks?task=t-2' })
    const panel = await screen.findByRole('region', { name: /Instalment due/ })
    expect(within(panel).queryAllByRole('button').map((b) => b.textContent)).toEqual(['Close'])
    expect(within(panel).queryByRole('textbox')).toBeNull()
    const history = within(panel).getAllByRole('listitem')
    expect(history[0]).toHaveTextContent('Created · System')
    expect(history[1]).toHaveTextContent('Level changed — Low → High · Ops Manager')
  })

  it('returned with instructions, the instructions stand above it', async () => {
    const returned = { ...BASE, instructions: 'Call before noon' }
    on('GET', /\/tasks\/t-1$/, () => json(detail(returned, ['complete', 'out_of_scope', 'comment'])))
    renderWithProviders(<TasksPage />, { staff: supervisor, route: '/tasks?task=t-1' })
    const panel = await screen.findByRole('region', { name: 'Call the family back' })
    expect(within(panel).getByRole('note')).toHaveTextContent('Call before noon')
    expect(within(panel).getByText('Returned with instructions')).toBeInTheDocument()
  })
})

describe('giving a task', () => {
  it('offers the server\'s people and sends what was written, the due time on the academy\'s clock', async () => {
    on('GET', /\/tasks\/assignees$/, () => json({ people: [{ kind: 'staff', id: 'sup-1', name: 'Sup One' }], departments: [] }))
    on('POST', /\/tasks$/, () => json(BASE))
    renderWithProviders(<TasksPage />, { staff: manager })
    await userEvent.click(await screen.findByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(await within(dialog).findByRole('combobox', { name: 'Assignee' }), 'staff:sup-1')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Call the family back')
    await userEvent.type(within(dialog).getByLabelText('Due'), '2026-11-02')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Financial' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(sent('POST', /\/tasks$/)[0]!.body).toEqual({
        assignee: { kind: 'staff', id: 'sup-1' },
        title: 'Call the family back',
        // 17:00 in Cairo (UTC+2 in November).
        dueAt: '2026-11-02T15:00:00.000Z',
        priority: 'medium',
        category: 'financial',
      }),
    )
  })
})

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('the level colours', () => {
  it('every level\'s text is 4.5:1 and its icon 3:1 on its own ground, light and dark (both ways of choosing dark)', () => {
    const css = readFileSync(join(__dirname, 'tasks.css'), 'utf8')
    const blocks = [...css.matchAll(/\{([^{}]*--task-high-fg:[^{}]*)\}/g)].map((m) => m[1]!)
    expect(blocks).toHaveLength(3)
    for (const block of blocks) {
      const v = (name: string) => new RegExp(`--task-${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(block)?.[1] as string
      for (const level of ['high', 'medium', 'low']) {
        expect(contrast(v(`${level}-fg`), v(`${level}-bg`)), `${level} text`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(v(`${level}-icon`), v(`${level}-bg`)), `${level} icon`).toBeGreaterThanOrEqual(3)
      }
      expect(contrast(v('finance-fg'), v('finance-bg')), 'finance').toBeGreaterThanOrEqual(4.5)
    }
    // The gold rule: gold carries text only as accent-700 on gold-50 (light).
    expect(blocks[0]).toMatch(/--task-medium-fg:\s*#7a5716;/)
  })
})
