import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { ConversationInfo } from '@/features/chat/ConversationInfo'
import type { ChatConversation } from '@/features/chat/chatApi'
import type { Department } from './api'
import { chooseOption, optionsOf } from '@/test/select'

/**
 * PD-24 in the group's info panel, with `fetch` answered at the network
 * boundary: the super admin and the Operations manager may hand a group to
 * another supervisor (a supervisor and a reason, both required); nobody else is
 * offered it. What the server moves and refuses is proven in
 * supervisor-transfer-pd024.spec.ts. Synthetic people only.
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
    .map(([, i]) => JSON.parse(String((i as RequestInit).body ?? '{}')) as Record<string, unknown>)

const group = {
  id: 'c-1',
  type: 'family_group',
  familyId: 'f-1',
  learnerId: null,
  title: 'Teacher One — Child Alpha · Child Beta',
  state: 'open',
  needsReply: false,
  lastSeq: '4',
  lastActivityAt: '2026-10-21T15:00:00Z',
  archivedAt: null,
  members: [
    { actorId: 'sup-1', actorKind: 'staff', memberRole: 'admin', displayName: 'Supervisor One' },
    { actorId: 'p-1', actorKind: 'contact', memberRole: 'parent', displayName: 'Parent Alpha' },
    { actorId: 't-1', actorKind: 'teacher', memberRole: 'teacher', displayName: 'Teacher One' },
  ],
  viewerState: { pinned: false, archived: false, mutedUntil: null },
} as unknown as ChatConversation

const operations = (managerId: string | null): Department => ({
  id: 'd-ops',
  kind: 'operations',
  displayName: 'Operations',
  manager: managerId ? { id: managerId, name: 'Ops Manager', role: 'manager', isActive: true } : null,
  backups: [],
  members: [
    { id: 'sup-1', name: 'Supervisor One', role: 'admin', isActive: true, position: 'supervisor', learnerCount: 4 },
    { id: 'sup-2', name: 'Supervisor Two', role: 'admin', isActive: true, position: 'supervisor', learnerCount: 2 },
  ],
})

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
  on('GET', /\/conversations\/c-1\/learners$/, () => json({ learners: [] }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('changing a group\'s supervisor (PD-24)', () => {
  it('the Operations manager hands the group to another supervisor, with a reason', async () => {
    const staff = makeStaff({ id: 'mgr-1', role: 'manager' })
    on('GET', /\/org\/structure$/, () => json({ departments: [operations('mgr-1')] }))
    on('POST', /\/org\/conversations\/c-1\/supervisor$/, () =>
      json({ supervisorId: 'sup-2', changed: true, learners: [{ id: 'k-1', name: 'Child Alpha' }, { id: 'k-2', name: 'Child Beta' }], groups: 1, directChats: 1 }, 201))
    renderWithProviders(<ConversationInfo c={group} />, { staff })

    await userEvent.click(await screen.findByRole('button', { name: 'Change supervisor' }))
    const dialog = await screen.findByRole('dialog', { name: /Change supervisor/ })
    expect(within(dialog).getByText('Supervisor One')).toBeInTheDocument()
    const select = within(dialog).getByLabelText('New supervisor')
    expect((await optionsOf(userEvent, select)).map((o) => o.label)).toEqual(['Choose…', 'Supervisor Two (2)'])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change supervisor' }))
    expect(sent('POST', /supervisor$/)).toEqual([])

    await chooseOption(userEvent, select, 'sup-2')
    await userEvent.type(within(dialog).getByLabelText('Reason (required)'), 'supervisor on leave')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change supervisor' }))
    await waitFor(() => expect(sent('POST', /\/org\/conversations\/c-1\/supervisor$/)).toEqual([{ supervisorId: 'sup-2', reason: 'supervisor on leave' }]))
    expect(await screen.findByText('Child Alpha · Child Beta moved to Supervisor Two. The chat history is unchanged.')).toBeInTheDocument()
  })

  it('is not offered to a supervisor, nor to a manager of another department', async () => {
    const supervisor = makeStaff({ id: 'sup-1', role: 'admin' })
    const { unmount } = renderWithProviders(<ConversationInfo c={group} />, { staff: supervisor })
    await screen.findByText('Parent Alpha')
    expect(screen.queryByRole('button', { name: 'Change supervisor' })).not.toBeInTheDocument()
    // A supervisor is not even asked for the structure.
    expect(fetchMock.mock.calls.some(([u]) => /\/org\/structure$/.test(String(u)))).toBe(false)
    unmount()

    // The Teachers manager reads a structure without the Operations department in it.
    on('GET', /\/org\/structure$/, () => json({ departments: [{ ...operations('tm-1'), id: 'd-t', kind: 'teachers' }] }))
    renderWithProviders(<ConversationInfo c={group} />, { staff: makeStaff({ id: 'tm-1', role: 'manager' }) })
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => /\/org\/structure$/.test(String(u)))).toBe(true))
    expect(screen.queryByRole('button', { name: 'Change supervisor' })).not.toBeInTheDocument()
  })
})
