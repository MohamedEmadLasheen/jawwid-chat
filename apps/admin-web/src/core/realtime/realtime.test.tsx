import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RealtimeProvider } from './RealtimeProvider'
import { SessionProvider } from '@/core/auth/SessionProvider'
import { qk } from '@/core/api/queryKeys'
import { createTestQueryClient, makeInboxRow, makeStaff } from '@/test/utils'

/** Minimal Socket.IO stand-in that lets a test emit a server event. */
const handlers = new Map<string, (payload: unknown) => void>()
const socket = {
  on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
  removeAllListeners: () => handlers.clear(),
  disconnect: vi.fn(),
}

const ioCalls: Array<{ url: unknown; options: Record<string, unknown> }> = []
vi.mock('socket.io-client', () => ({
  io: (url: unknown, options: Record<string, unknown>) => {
    ioCalls.push({ url, options })
    return socket
  },
}))

function emit(event: string, payload: unknown) {
  handlers.get(event)?.(payload)
}

describe('realtime', () => {
  beforeEach(() => {
    handlers.clear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('null', { status: 200 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  function mount() {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(qk.me, makeStaff())
    render(
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <RealtimeProvider>
            <div />
          </RealtimeProvider>
        </SessionProvider>
      </QueryClientProvider>,
    )
    return queryClient
  }

  it('connects on the API contract: default namespace, bearer token in the handshake, no cookie', async () => {
    const { tokenStore } = await import('@/core/auth/tokens')
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    ioCalls.length = 0
    mount()
    await waitFor(() => expect(ioCalls.length).toBeGreaterThan(0))

    const { url, options } = ioCalls[0]!
    // A URL path would be read by socket.io as a NAMESPACE; the server has only '/'.
    expect(String(url ?? '')).not.toContain('/staff')
    expect(options.withCredentials).toBeUndefined()
    const auth = options.auth as (cb: (d: { token: string | null }) => void) => void
    let presented: string | null = null
    auth((d) => (presented = d.token))
    expect(presented).toBe('access-1')

    // Re-evaluated per connection: a rotated token is what the NEXT handshake carries.
    tokenStore.set({ accessToken: 'access-2', refreshToken: 'refresh-2' })
    auth((d) => (presented = d.token))
    expect(presented).toBe('access-2')
    tokenStore.clear()
  })

  it('subscribes to the events the operator’s workspace depends on', async () => {
    mount()
    await waitFor(() => expect(handlers.size).toBeGreaterThan(0))
    for (const event of [
      'family.updated',
      'message.created',
      'case.updated',
      'task.updated',
      'coverage.changed',
      'ownership.changed',
    ]) {
      expect(handlers.has(event), `missing handler for ${event}`).toBe(true)
    }
  })

  it('invalidates the inbox on family.updated instead of writing the new bucket into the cache', async () => {
    const queryClient = mount()
    await waitFor(() => expect(handlers.has('family.updated')).toBe(true))

    const stale = [makeInboxRow({ bucket: 'now', top_reason: 'stale reason' })]
    queryClient.setQueryData(qk.inbox('now'), { pages: [{ items: stale, next_cursor: null }] })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    emit('family.updated', {
      family_id: 'fam_1',
      bucket: 'quiet',
      top_reason: 'server says quiet now',
      needs_reply: false,
      on_duty_id: 'staff_b',
      handling_mode: 'coverage',
    })

    // The refetch is what makes the server the single source of computed truth.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.inboxAll })

    // Critically: the payload must NOT have been patched into the cached row.
    const cached = queryClient.getQueryData(qk.inbox('now')) as {
      pages: { items: typeof stale }[]
    }
    expect(cached.pages[0]!.items[0]!.bucket).toBe('now')
    expect(cached.pages[0]!.items[0]!.top_reason).toBe('stale reason')
  })

  it('refreshes duty and the inbox when coverage changes, not just the schedule', async () => {
    const queryClient = mount()
    await waitFor(() => expect(handlers.has('coverage.changed')).toBe(true))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    emit('coverage.changed', { effective_at: new Date().toISOString() })

    // Changing a rule changes who on_duty() returns, so the inbox is stale too.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.coverageAll })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.duty })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.inboxAll })
  })

  it('refreshes the inbox when a task is completed, because the case may reopen', async () => {
    const queryClient = mount()
    await waitFor(() => expect(handlers.has('task.updated')).toBe(true))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    emit('task.updated', { task: { id: 't1', family_id: 'fam_1' } })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.tasksAll })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.inboxAll })
  })

  it('refreshes the family and the dashboard when ownership changes', async () => {
    const queryClient = mount()
    await waitFor(() => expect(handlers.has('ownership.changed')).toBe(true))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    emit('ownership.changed', { family_id: 'fam_1', from: 'staff_a', to: 'staff_b' })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.family('fam_1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.dashboardAll })
  })
})
