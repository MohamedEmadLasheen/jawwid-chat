import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('PD-42: entering families by hand, in words', () => {
  it('each intake action is named, and a parent\'s line opens their profile', async () => {
    const pd42 = [
      { id: 'audit:11', action: 'family.entered', entity: 'family', entityId: 'f-1', reason: null, at: '2026-10-28T09:00:00Z', duringSupport: false },
      { id: 'audit:12', action: 'family.children_added', entity: 'family', entityId: 'f-1', reason: null, at: '2026-10-28T08:00:00Z', duringSupport: false },
      { id: 'audit:13', action: 'family.operations_supervisor_set', entity: 'family', entityId: 'f-1', reason: null, at: '2026-10-28T07:00:00Z', duringSupport: false },
      { id: 'audit:14', action: 'family.sales_owner_changed', entity: 'family', entityId: 'f-1', reason: 'renewals', at: '2026-10-28T06:00:00Z', duringSupport: false },
      { id: 'audit:15', action: 'subscription.carried_over', entity: 'learner', entityId: 'k-1', reason: null, at: '2026-10-28T05:00:00Z', duringSupport: false },
      { id: 'audit:16', action: 'parent.sign_in_email_set', entity: 'contact', entityId: 'p-1', reason: null, at: '2026-10-28T04:00:00Z', duringSupport: false },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => json({ entries: pd42 })))
    renderWithProviders(<ActionLogSection staffId="s-1" />, { staff: makeStaff({ role: 'manager' }) })
    expect(await screen.findByText('Entered a family')).toBeInTheDocument()
    expect(screen.getByText('Added children to a family')).toBeInTheDocument()
    expect(screen.getByText('Chose a family\'s Operations supervisor')).toBeInTheDocument()
    expect(screen.getByText('Changed a family\'s Sales owner')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Carried over a package from Jawwid Core' })).toHaveAttribute('href', '/students/k-1')
    expect(screen.getByRole('link', { name: 'Set a parent\'s sign-in e-mail' })).toHaveAttribute('href', '/parents/p-1')
  })
})

describe('going further back', () => {
  it('loads the next page with the server\'s cursor, and asks for a longer period when chosen', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('cursor=c2')) return json({ entries: [ENTRIES[2]], nextCursor: null })
      return json({ entries: ENTRIES.slice(0, 2), nextCursor: 'c2' })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<ActionLogSection staffId="s-1" />, { staff: makeStaff({ role: 'manager' }) })
    await screen.findByRole('link', { name: 'Recorded a teacher lateness' })
    expect(screen.queryByRole('link', { name: 'Assigned a child to a supervisor' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('link', { name: 'Assigned a child to a supervisor' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Period' }), '365')
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => /from=/.test(String(u)))).toBe(true))
  })
})

