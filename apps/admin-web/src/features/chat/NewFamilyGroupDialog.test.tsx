import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { CandidateFamily } from '@/features/organization/api'

/**
 * PD-8 family-group creation from the chat workspace. The picker shows what
 * `GET /org/group-candidates` returns and steers away from what the server
 * refuses (two supervisors' children in one group); the creation request is
 * re-checked server-side (org-scope-pd8.spec.ts). Synthetic people only.
 */

const fakeSocket = {
  connected: true,
  on() {},
  off() {},
  emit() {},
  timeout() {
    return { emitWithAck: async () => ({ ok: true }) }
  },
}
vi.mock('@/core/realtime/RealtimeProvider', () => ({
  useRealtime: () => ({ state: 'connected', hasEverConnected: true, socket: fakeSocket }),
}))
const { ChatPage } = await import('./ChatPage')

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const FAMILY: CandidateFamily = {
  familyId: 'f-1',
  displayName: 'Family One',
  parents: [
    { id: 'p-1', name: 'Parent One' },
    { id: 'p-2', name: 'Parent Two' },
  ],
  children: [
    { id: 'c-1', name: 'Child A', supervisor: { id: 'sup-1', name: 'Supervisor One' }, teacher: { id: 't-1', name: 'Teacher X' } },
    { id: 'c-2', name: 'Child B', supervisor: { id: 'sup-1', name: 'Supervisor One' }, teacher: { id: 't-2', name: 'Teacher Y' } },
    { id: 'c-3', name: 'Child C', supervisor: { id: 'sup-2', name: 'Supervisor Two' }, teacher: { id: 't-1', name: 'Teacher X' } },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>
const posts = () => fetchMock.mock.calls.filter(([u, i]) => /family-group$/.test(String(u)) && (i as RequestInit)?.method === 'POST')

function render(role: 'admin' | 'coverage' | 'manager' | 'finance' = 'admin') {
  return renderWithProviders(
    <Routes>
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/chat/:conversationId" element={<ChatPage />} />
    </Routes>,
    { staff: makeStaff({ id: 'sup-1', role }), route: '/chat' },
  )
}

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    if (method === 'GET' && /\/conversations$/.test(url)) return json({ conversations: [] })
    if (method === 'GET' && /\/org\/group-candidates$/.test(url)) return json({ families: [FAMILY] })
    if (method === 'POST' && /\/conversations\/family-group$/.test(url)) {
      return json({ id: 'conv-new', type: 'family_group', title: 'x', members: [], lastActivityAt: '2026-10-15T10:00:00Z' }, 201)
    }
    return json({ error: { code: 'unrouted', message: `${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'New chat or group' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'New family group' }))
  const dialog = await screen.findByRole('dialog')
  await userEvent.selectOptions(await within(dialog).findByRole('combobox', { name: 'Family' }), 'f-1')
  return dialog
}

describe('creating a family group', () => {
  it('one supervisor per group: choosing a child disables the other supervisor\'s children', async () => {
    render()
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Child A/ }))
    expect(within(dialog).getByRole('checkbox', { name: /Child C/ })).toBeDisabled()
    expect(within(dialog).getByText(/Different supervisor/)).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: /Child B/ })).toBeEnabled()
  })

  it("offers the family's parents and exactly the chosen children's teachers, and sends the choice", async () => {
    render()
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Child A/ }))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Child B/ }))
    // Teacher Y teaches only Child B; deselect one parent.
    expect(within(dialog).getByRole('checkbox', { name: 'Teacher X' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Teacher Y' })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Parent Two' }))
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Group name (optional)' }), 'Homework')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create group' }))

    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(String((posts()[0]![1] as RequestInit).body))).toEqual({
      learnerIds: ['c-1', 'c-2'],
      contactIds: ['p-1'],
      teacherIds: ['t-1', 't-2'],
      title: 'Homework',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('without a child nothing is sent', async () => {
    render()
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create group' }))
    expect(within(dialog).getByText('Choose at least one child.')).toBeInTheDocument()
    expect(posts()).toHaveLength(0)
  })

  it('a teacher of an unchosen child is never offered', async () => {
    render()
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Child A/ }))
    expect(within(dialog).queryByRole('checkbox', { name: 'Teacher Y' })).not.toBeInTheDocument()
  })

  it('department staff are not offered the action', async () => {
    render('finance')
    await screen.findByText(/No conversations/)
    expect(screen.queryByRole('button', { name: 'New chat or group' })).not.toBeInTheDocument()
  })
})
