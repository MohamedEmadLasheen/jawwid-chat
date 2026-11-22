import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { TasksAreaTabs } from './TasksAreaTabs'

/** The Escalations tab of Tasks: who is offered it, and the count of open cases that are their work. */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const CASE = (id: string) => ({ id, title: id, status: 'open', target: 'teachers', subject: { kind: 'teacher', id: 't', label: 'T' }, owner: null, openedBy: { id: 'x', name: 'X' }, dueOn: null })

let lists: Record<string, Response | (() => Response)>
beforeEach(() => {
  lists = {}
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const tab = /tab=(\w+)/.exec(url)?.[1]
    const hit = tab && lists[tab]
    if (hit) return typeof hit === 'function' ? hit() : hit.clone()
    return json({ error: { code: 'unrouted', message: url } }, 404)
  }))
  tokenStore.set({ accessToken: 'a', refreshToken: 'r' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the Escalations tab of Tasks', () => {
  it('is offered with the number of open cases that are the account\'s work, each case counted once', async () => {
    lists = { mine: json({ cases: [CASE('c-1'), CASE('c-2')] }), department: json({ cases: [CASE('c-2'), CASE('c-3')] }) }
    renderWithProviders(<TasksAreaTabs />, { staff: makeStaff({ role: 'manager', permissions: ['cases.view', 'cases.manage'] }), route: '/tasks' })
    const link = await screen.findByRole('link', { name: /Escalations/ })
    expect(link).toHaveAttribute('href', '/cases')
    await waitFor(() => expect(link).toHaveTextContent('Escalations (3)'))
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/tasks')
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveClass('ts-tab--active')
  })

  it('counts a list the server refuses as none, and shows no number when nothing is open', async () => {
    lists = { mine: json({ cases: [] }), department: json({ error: { code: 'CASE_DENIED', message: 'no' } }, 403) }
    renderWithProviders(<TasksAreaTabs />, { staff: makeStaff({ role: 'admin', permissions: ['cases.manage'] }), route: '/cases' })
    const link = await screen.findByRole('link', { name: 'Escalations' })
    expect(link).toHaveClass('ts-tab--active')
    await new Promise((r) => setTimeout(r, 20))
    expect(link).toHaveTextContent(/^Escalations$/)
  })

  it('is not offered to an account that cannot work cases, and then asks the server nothing', async () => {
    renderWithProviders(<TasksAreaTabs />, { staff: makeStaff({ role: 'admin', permissions: ['cases.view'] }), route: '/tasks' })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) => /\/cases/.test(String(u)))).toHaveLength(0)
  })

  it('names the tab in Arabic', async () => {
    lists = { mine: json({ cases: [CASE('c-1')] }), department: json({ cases: [] }) }
    renderWithProviders(<TasksAreaTabs />, { staff: makeStaff({ role: 'manager', permissions: ['cases.manage'] }), route: '/tasks', locale: 'ar' })
    expect(await screen.findByRole('link', { name: /التصعيدات/ })).toBeInTheDocument()
  })
})
