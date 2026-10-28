import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import type { StaffRole } from '@/shared/types/domain'
import { makeStaff, renderWithProviders } from '@/test/utils'

/**
 * PD-44 PR-2: the manager Dashboard on GET /dashboard/chats and
 * GET /dashboard/cases (docs/product/pd044-manager-dashboard-plan.md §4).
 *
 *   tiles     a count and a label, linking to the page that resolves it
 *   absent    a tile the server leaves out is not drawn -- never as 0
 *   states    loading, all-zero, a failed section beside a working one, 403
 *   keys      a section is asked for only with its page's PD-40 key (/me)
 *   dead      the four routes of the retired on-duty Dashboard are never called
 *
 * Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const NOW = '2026-10-28T09:00:00.000Z'
const tile = (key: string, count: number, extra: { oldestAt?: string | null; capped?: boolean } = {}) => ({
  key,
  count,
  oldestAt: extra.oldestAt ?? null,
  capped: extra.capped ?? false,
})

let routes: Record<string, () => Response>
let fetchMock: ReturnType<typeof vi.fn>
const requested = () =>
  fetchMock.mock.calls.map(([input]) => String(input).replace(/^.*\/api\/v1/, '').split('?')[0]!)

const MANAGER = makeStaff({ id: 'staff_mgr', role: 'manager', permissions: ['chat.use', 'cases.view', 'org.view'] })

beforeEach(() => {
  routes = {
    '/dashboard/chats': () => json({ generatedAt: NOW, tiles: [tile('chats.waiting', 4, { oldestAt: '2026-10-28T06:00:00.000Z' })] }),
    '/dashboard/cases': () =>
      json({
        generatedAt: NOW,
        tiles: [tile('cases.mine_open', 1), tile('cases.department_open', 3), tile('cases.overdue', 2)],
      }),
  }
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input).replace(/^.*\/api\/v1/, '').split('?')[0]!
    if ((init.method ?? 'GET') === 'GET' && routes[path]) return routes[path]!()
    return json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const open = (staff = MANAGER, locale: 'en' | 'ar' = 'en') =>
  renderWithProviders(<AppRoutes />, { staff, route: '/dashboard', locale })

describe('the manager Dashboard', () => {
  it('shows each tile as a count that links to the page resolving it', async () => {
    open()
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()

    const waiting = await screen.findByRole('link', { name: /Chats waiting for our reply/ })
    expect(waiting).toHaveAttribute('href', '/chat?view=waiting')
    expect(within(waiting).getByText('4')).toBeInTheDocument()
    expect(within(waiting).getByText(/^Oldest /)).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /Cases assigned to me/ })).toHaveAttribute('href', '/cases?tab=mine')
    const department = screen.getByRole('link', { name: /Open cases in the department/ })
    expect(department).toHaveAttribute('href', '/cases?tab=department')
    expect(within(department).getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cases past their due date/ })).toHaveAttribute('href', '/cases?tab=department')
  })

  it('marks a backlog that is waiting, and never an empty one', async () => {
    routes['/dashboard/cases'] = () =>
      json({ generatedAt: NOW, tiles: [tile('cases.mine_open', 0), tile('cases.department_open', 2), tile('cases.overdue', 0)] })
    open()
    expect(await screen.findByRole('link', { name: /Chats waiting for our reply/ })).toHaveClass('dash-tile--alert')
    expect(await screen.findByRole('link', { name: /Cases past their due date/ })).not.toHaveClass('dash-tile--alert')
  })

  it('draws no tile the server left out -- absent is not zero', async () => {
    routes['/dashboard/cases'] = () => json({ generatedAt: NOW, tiles: [tile('cases.mine_open', 2), tile('cases.overdue', 1)] })
    open()
    const mine = await screen.findByRole('link', { name: /Cases assigned to me/ })
    expect(screen.queryByRole('link', { name: /Open cases in the department/ })).not.toBeInTheDocument()
    // Without the department tab, overdue cases are the caller's own.
    expect(screen.getByRole('link', { name: /Cases past their due date/ })).toHaveAttribute('href', '/cases?tab=mine')
    expect(within(mine).getByText('2')).toBeInTheDocument()
  })

  it('says a count is a lower bound when the server capped it', async () => {
    routes['/dashboard/chats'] = () => json({ generatedAt: NOW, tiles: [tile('chats.waiting', 500, { capped: true })] })
    open()
    const waiting = await screen.findByRole('link', { name: /Chats waiting for our reply/ })
    expect(within(waiting).getByText('500+')).toBeInTheDocument()
  })

  it('collapses a section where nothing is waiting into one calm line', async () => {
    routes['/dashboard/cases'] = () =>
      json({ generatedAt: NOW, tiles: [tile('cases.mine_open', 0), tile('cases.department_open', 0), tile('cases.overdue', 0)] })
    open()
    const cases = await screen.findByRole('region', { name: 'Escalation cases' })
    expect(await within(cases).findByText('Nothing waiting in this section')).toBeInTheDocument()
    expect(within(cases).queryByRole('link')).not.toBeInTheDocument()
  })

  it('fails one section without blanking the others, and retries it', async () => {
    let fail = true
    routes['/dashboard/chats'] = () =>
      fail
        ? json({ error: { code: 'INTERNAL', message: 'boom' } }, 500)
        : json({ generatedAt: NOW, tiles: [tile('chats.waiting', 1)] })
    open()
    const chats = await screen.findByRole('region', { name: 'Chats' })
    expect(await within(chats).findByText('This section could not be loaded', {}, { timeout: 4000 })).toBeInTheDocument()
    // Never a zero in place of a figure that failed.
    expect(within(chats).queryByText('0')).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Open cases in the department/ })).toBeInTheDocument()

    fail = false
    await userEvent.click(within(chats).getByRole('button', { name: 'Retry' }))
    expect(await within(chats).findByRole('link', { name: /Chats waiting for our reply/ })).toBeInTheDocument()
  })

  it('hides a section the server refuses (403)', async () => {
    routes['/dashboard/cases'] = () => json({ error: { code: 'COMM.PERMISSION_DENIED', message: 'no' } }, 403)
    open()
    expect(await screen.findByRole('link', { name: /Chats waiting for our reply/ })).toBeInTheDocument()
    await waitFor(() => expect(requested()).toContain('/dashboard/cases'))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Escalation cases' })).not.toBeInTheDocument())
  })

  it('asks only for the sections whose page key the account holds (/me permissions)', async () => {
    open(makeStaff({ id: 'staff_mgr', role: 'manager', permissions: ['chat.use'] }))
    expect(await screen.findByRole('link', { name: /Chats waiting for our reply/ })).toBeInTheDocument()
    expect(requested()).not.toContain('/dashboard/cases')
    expect(screen.queryByRole('region', { name: 'Escalation cases' })).not.toBeInTheDocument()
  })

  it('an account no section key opens still has its own Tasks (PD-47: self-service), and nothing else is asked for', async () => {
    open(makeStaff({ id: 'staff_mgr', role: 'manager', permissions: ['org.view'] }))
    await waitFor(() => expect(requested().filter((p) => p.startsWith('/dashboard/'))).toEqual(['/dashboard/tasks']))
  })

  it('shows the Tasks section: each tile opens the Tasks view it counts (PD-47 PR-4)', async () => {
    routes['/dashboard/tasks'] = () =>
      json({
        generatedAt: NOW,
        tiles: [
          tile('tasks.mine_open', 3, { oldestAt: '2026-10-27T07:00:00.000Z' }),
          tile('tasks.mine_overdue', 1),
          tile('tasks.mine_urgent', 2),
          tile('tasks.mine_financial', 1),
          tile('tasks.team_open', 9),
          tile('tasks.team_overdue', 4),
          tile('tasks.awaiting_decision', 1),
          tile('tasks.needs_reassignment', 2),
        ],
      })
    open()
    expect(await screen.findByRole('link', { name: /Open tasks \(mine\)/ })).toHaveAttribute('href', '/tasks')
    expect(screen.getByRole('link', { name: /Overdue tasks \(mine\)/ })).toHaveAttribute('href', '/tasks?overdue=true')
    expect(screen.getByRole('link', { name: /High-level tasks \(mine\)/ })).toHaveAttribute('href', '/tasks?level=high')
    expect(screen.getByRole('link', { name: /Financial tasks \(mine\)/ })).toHaveAttribute('href', '/tasks?category=financial')
    expect(screen.getByRole('link', { name: /Overdue tasks \(my team\)/ })).toHaveAttribute('href', '/tasks?tab=team&overdue=true')
    expect(screen.getByRole('link', { name: /waiting for my decision/ })).toHaveAttribute('href', '/tasks?tab=decisions')
    expect(screen.getByRole('link', { name: /assignee left/ })).toHaveAttribute('href', '/tasks?tab=team&gone=true')
  })

  it('shows the Lessons section: today by outcome, and the outcome queue where the server sends it (PR-3)', async () => {
    routes['/dashboard/lessons'] = () =>
      json({
        generatedAt: NOW,
        tiles: [
          tile('lessons.today_upcoming', 5),
          tile('lessons.today_unreported', 2, { oldestAt: '2026-10-28T07:00:00.000Z' }),
          tile('lessons.today_held', 7),
          tile('lessons.today_student_absent', 1),
          tile('lessons.today_teacher_absent', 0),
          tile('lessons.today_cancelled', 1),
          tile('lessons.needs_outcome', 3),
          tile('lessons.rulings_open', 1),
        ],
      })
    open(makeStaff({ id: 'staff_mgr', role: 'manager', permissions: ['lessons.view', 'schedule.view'] }))
    const section = await screen.findByRole('region', { name: 'Lessons' })
    const unreported = await within(section).findByRole('link', { name: /Today's lessons with no outcome yet/ })
    expect(unreported).toHaveAttribute('href', '/schedule?view=day')
    expect(unreported).toHaveClass('dash-tile--alert')
    expect(within(section).getByRole('link', { name: /Held today/ })).not.toHaveClass('dash-tile--alert')
    expect(within(section).getByRole('link', { name: /Lessons waiting for an outcome/ })).toHaveAttribute('href', '/teachers/needs-action')
    expect(within(section).getByRole('link', { name: /Late apologies to rule on/ })).toHaveAttribute('href', '/teachers/needs-action')
    expect(requested()).not.toContain('/dashboard/chats')
  })

  it('leaves the outcome queue out when the server does (outside the Teachers department)', async () => {
    routes['/dashboard/lessons'] = () =>
      json({ generatedAt: NOW, tiles: [tile('lessons.today_upcoming', 1), tile('lessons.today_held', 0)] })
    open(makeStaff({ id: 'staff_mgr', role: 'manager', permissions: ['schedule.view'] }))
    const section = await screen.findByRole('region', { name: 'Lessons' })
    expect(await within(section).findByRole('link', { name: /Lessons still to come today/ })).toBeInTheDocument()
    expect(within(section).queryByRole('link', { name: /Lessons waiting for an outcome/ })).not.toBeInTheDocument()
  })

  it('is Arabic first: Arabic labels and digits, right to left', async () => {
    open(MANAGER, 'ar')
    expect(await screen.findByRole('heading', { level: 1, name: 'لوحة المتابعة' })).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
    const waiting = await screen.findByRole('link', { name: /محادثات تنتظر ردّنا/ })
    expect(within(waiting).getByText('٤')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /حالات تجاوزت موعدها/ })).toBeInTheDocument()
  })

  for (const role of ['manager', 'super_admin'] as StaffRole[]) {
    it(`never calls the retired on-duty routes (${role})`, async () => {
      open(makeStaff({ id: `staff_${role}`, role, permissions: ['chat.use', 'cases.view'] }))
      await screen.findByRole('link', { name: /Chats waiting for our reply/ })
      const dead = requested().filter((p) => /^\/dashboard\/(header|team-now|needs-action|this-week|unattended)$/.test(p))
      expect(dead).toEqual([])
    })
  }
})

describe('the retired on-duty Dashboard client', () => {
  it('is gone from the source: no code names its routes', () => {
    const root = join(__dirname, '..', '..')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name) && !path.endsWith('DashboardPage.test.tsx')) files.push(path)
      }
    }
    walk(root)
    const offenders = files.filter((f) => /\/dashboard\/(header|team-now|needs-action|this-week|unattended)\b/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
