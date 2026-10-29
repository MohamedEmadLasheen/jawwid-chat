import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from '@/test/utils'
import { NotificationBell } from './NotificationBell'
import { NotificationsPage } from './NotificationsPage'
import { routeFor, type InboxEntryDto } from './api'

/**
 * PD-34: the staff member's own Notification Center in Admin Web, through the
 * real API client with `fetch` answered at the network boundary.
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

function entry(over: Partial<InboxEntryDto> = {}): InboxEntryDto {
  return {
    id: 'n1',
    category: 'conversation',
    severity: 'normal',
    title: 'New messages',
    body: 'New messages: 3',
    at: '2026-10-26T15:00:00.000Z',
    read: false,
    acted: false,
    requiresAction: false,
    dueAt: null,
    taskStatus: null,
    count: 3,
    action: { kind: 'open_conversation', conversationId: 'c-1' },
    ...over,
  }
}

const settings = {
  quietHours: { enabled: true, startMinute: 1320, endMinute: 480, isDefault: true },
  showPreviews: false,
  categories: [
    { category: 'conversation', push: true, locked: false },
    { category: 'task', push: true, locked: true },
  ],
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
  on('GET', /\/me\/notifications\/counts$/, () => json({ unread: 1, perTab: { all: 1, unread: 1, conversations: 1 }, tabs: ['all', 'unread', 'action', 'conversations', 'announcements'] }))
  on('GET', /\/me\/notifications\?/, () => json({ tab: 'all', entries: [entry(), entry({ id: 'n2', title: 'Missed call', body: 'You missed a call.', read: true, category: 'call', action: { kind: 'open_calls' } })], next: null }))
  on('GET', /\/me\/notification-settings$/, () => json(settings))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PD-34: the Notification Center', () => {
  it('the bell shows the unread count from the server', async () => {
    renderWithProviders(<NotificationBell />)
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toHaveAttribute('href', '/notifications')
  })

  it('lists the entries; Open records the click and goes to the conversation', async () => {
    on('POST', /\/me\/notifications\/n1\/acted$/, () => json({ ok: true }))
    renderWithProviders(
      <Routes>
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/chat/:id" element={<p>conversation page</p>} />
      </Routes>,
      { route: '/notifications' },
    )
    expect(await screen.findByText('New messages: 3')).toBeInTheDocument()
    expect(screen.getByText('You missed a call.')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]!)
    expect(await screen.findByText('conversation page')).toBeInTheDocument()
    expect(calls('POST', /\/me\/notifications\/n1\/acted$/)).toHaveLength(1)
  })

  it('mark all as read sends the tab', async () => {
    on('POST', /\/me\/notifications\/read$/, () => json({ read: 1, unread: 0, perTab: {}, tabs: ['all'] }))
    renderWithProviders(<NotificationsPage />, { route: '/notifications' })
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }))
    await waitFor(() => expect(calls('POST', /\/me\/notifications\/read$/)).toHaveLength(1))
    const body = JSON.parse(String((calls('POST', /\/me\/notifications\/read$/)[0]![1] as RequestInit).body))
    expect(body).toEqual({ all: true, tab: 'all' })
  })

  it('settings: a locked kind cannot be switched off; switching messages off is saved', async () => {
    on('PUT', /\/me\/notification-settings$/, () => json({ ...settings, categories: [{ category: 'conversation', push: false, locked: false }, settings.categories[1]] }))
    renderWithProviders(<NotificationsPage />, { route: '/notifications' })
    const tasks = await screen.findByRole('checkbox', { name: /Tasks/ })
    expect(tasks).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /Messages/ }))
    await waitFor(() => expect(calls('PUT', /\/me\/notification-settings$/)).toHaveLength(1))
    const body = JSON.parse(String((calls('PUT', /\/me\/notification-settings$/)[0]![1] as RequestInit).body))
    expect(body).toEqual({ categories: [{ category: 'conversation', push: false }] })
  })

  it('in Arabic', async () => {
    renderWithProviders(<NotificationsPage />, { route: '/notifications', locale: 'ar' })
    expect(await screen.findByRole('heading', { name: 'الإشعارات' })).toBeInTheDocument()
  })

  it('routes only to pages Admin Web has', () => {
    expect(routeFor({ kind: 'open_conversation', conversationId: 'c 1' })).toBe('/chat/c%201')
    expect(routeFor({ kind: 'view_lesson', lessonId: 'l' })).toBeNull()
    expect(routeFor(null)).toBeNull()
    // PD-35 B5: a case notification opens the case in Escalations.
    expect(routeFor({ kind: 'open_case', caseId: 'k 1' })).toBe('/cases?case=k%201')
    expect(routeFor({ kind: 'open_task', taskId: 't 1' })).toBe('/tasks?task=t%201')
    expect(routeFor({ kind: 'open_task' })).toBeNull()
  })
})
