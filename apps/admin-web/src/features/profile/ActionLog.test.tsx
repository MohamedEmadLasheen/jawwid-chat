import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { ActionLogSection } from './ActionLogSection'

/**
 * PD-35 B7: a staff member's action log on their profile, with `fetch`
 * answered at the network boundary. Who may read it is the server's
 * (action-log-pd035.spec.ts): a 404 shows nothing. Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const ENTRIES = [
  { id: 'case:1', action: 'supervision_case.note', entity: 'supervision_case', entityId: 'c-1', reason: null, at: '2026-10-27T09:00:00Z', duringSupport: false },
  { id: 'audit:2', action: 'teacher.lateness_recorded', entity: 'teacher', entityId: 't-1', reason: 'ten minutes late', at: '2026-10-26T09:00:00Z', duringSupport: false },
  { id: 'audit:3', action: 'learner.supervisor_assigned', entity: 'learner', entityId: 'l-1', reason: 'new family', at: '2026-10-25T09:00:00Z', duringSupport: true },
]

describe('the action log on a profile', () => {
  it('lists what they did, newest first, each linked to what it was about', async () => {
    fetchMock = vi.fn(async () => json({ entries: ENTRIES }))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<ActionLogSection staffId="s-1" />, { staff: makeStaff({ role: 'manager' }) })
    expect(await screen.findByRole('heading', { name: 'Action log' })).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/staff\/s-1\/action-log/)
    expect(screen.getByRole('link', { name: 'Added a note to a case' })).toHaveAttribute('href', '/cases?case=c-1')
    expect(screen.getByRole('link', { name: 'Recorded a teacher lateness' })).toHaveAttribute('href', '/teachers/files/t-1')
    expect(screen.getByRole('link', { name: 'Assigned a child to a supervisor' })).toHaveAttribute('href', '/students/l-1')
    expect(screen.getByText('ten minutes late')).toBeInTheDocument()
    expect(screen.getByText('During a support session')).toBeInTheDocument()
  })

  it('shows nothing when the server says it is not theirs to read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'COMM.ACTION_LOG_NOT_FOUND', message: 'not found' } }, 404)))
    const { container } = renderWithProviders(<ActionLogSection staffId="s-2" />, { staff: makeStaff({ role: 'admin' }) })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('heading', { name: 'Action log' })).not.toBeInTheDocument()
    expect(container.textContent).toBe('')
  })
})
