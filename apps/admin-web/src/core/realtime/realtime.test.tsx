import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RealtimeProvider } from './RealtimeProvider'
import { SessionProvider } from '@/core/auth/SessionProvider'
import { qk } from '@/core/api/queryKeys'
import { createTestQueryClient, makeStaff } from '@/test/utils'

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

  it('subscribes to the events the operator’s workspace depends on, and none of the retired Inbox’s or on-duty Dashboard’s', async () => {
    mount()
    await waitFor(() => expect(handlers.size).toBeGreaterThan(0))
    for (const event of ['task.updated', 'coverage.changed']) {
      expect(handlers.has(event), `missing handler for ${event}`).toBe(true)
    }
    for (const event of ['family.updated', 'message.created', 'case.updated', 'handoff.created', 'shift.ending']) {
      expect(handlers.has(event), `handler left for ${event}`).toBe(false)
    }
    // PD-44: the on-duty Dashboard's signals. The server never sent the first
    // three; presence.changed is real, but only the chat thread listens to it
    // (usePresence), and the new Dashboard polls its counts.
    for (const event of ['ownership.changed', 'unattended.changed', 'escalation.created', 'presence.changed']) {
      expect(handlers.has(event), `handler left for ${event}`).toBe(false)
    }
  })

  it('refreshes tasks when a task changes', async () => {
    const queryClient = mount()
    await waitFor(() => expect(handlers.has('task.updated')).toBe(true))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    emit('task.updated', { task: { id: 't1', family_id: 'fam_1' } })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.tasksAll })
  })
})
