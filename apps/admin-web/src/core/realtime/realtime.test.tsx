import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RealtimeProvider } from './RealtimeProvider'
import { SessionProvider } from '@/core/auth/SessionProvider'
import { qk } from '@/core/api/queryKeys'
import { setAccessToken } from '@/core/api/client'
import { createTestQueryClient, makeStaff } from '@/test/utils'

/**
 * The realtime contract, from the console's side.
 *
 * The harness is unchanged from the suite this replaces — a socket stand-in
 * that lets a test emit a server event. What changed is WHICH events: the
 * brief-era set (`family.updated`, `case.updated`, `task.updated`,
 * `coverage.changed`, `ownership.changed`, `shift.ending`) shared two names
 * with the API and neither payload matched, so those assertions were testing a
 * contract nothing served.
 *
 * The rule they existed to protect is carried over verbatim and is the point of
 * this file: events are SIGNALS, so a handler invalidates and refetches. It
 * never writes a payload into the cache — the server decides what THIS operator
 * may see, and a patched-in copy is a second answer to that question.
 */
const handlers = new Map<string, (payload: unknown) => void>()
const socket = {
  connected: true,
  on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
  emit: vi.fn(),
  emitWithAck: vi.fn().mockResolvedValue({ ok: true, typing: [] }),
  timeout: () => socket,
  removeAllListeners: () => handlers.clear(),
  disconnect: vi.fn(),
}

vi.mock('socket.io-client', () => ({ io: () => socket }))

function emit(event: string, payload: unknown) {
  handlers.get(event)?.(payload)
}

const CONVERSATION = 'conv-1'

describe('realtime', () => {
  beforeEach(() => {
    handlers.clear()
    socket.emit.mockClear()
    // The socket presents the same bearer token HTTP does; without one the
    // provider does not connect at all.
    setAccessToken('test-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('null', { status: 200 })))
  })
  afterEach(() => {
    setAccessToken(null)
    vi.unstubAllGlobals()
  })

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

  it('subscribes to the canonical events the console depends on', async () => {
    mount()

    await waitFor(() => expect(handlers.size).toBeGreaterThan(0))

    // Every event that changes what is on screen. A name that is not here is a
    // screen that silently stops updating.
    for (const event of [
      'message.created',
      'message.updated',
      'message.deleted',
      'message.receipt.updated',
      'reaction.added',
      'reaction.removed',
      'conversation.updated',
      'conversation.membership_changed',
      'approval.requested',
      'approval.decided',
      'typing.started',
      'typing.stopped',
    ]) {
      expect(handlers.has(event)).toBe(true)
    }
  })

  it('does NOT listen for the brief-era events the API never emits', async () => {
    mount()
    await waitFor(() => expect(handlers.size).toBeGreaterThan(0))

    for (const gone of [
      'family.updated',
      'case.updated',
      'task.updated',
      'handoff.created',
      'coverage.changed',
      'ownership.changed',
      'unattended.changed',
      'escalation.created',
      'shift.ending',
    ]) {
      expect(handlers.has(gone)).toBe(false)
    }
  })

  it('invalidates on message.created rather than writing the message into the cache', async () => {
    const queryClient = mount()
    await waitFor(() => expect(handlers.has('message.created')).toBe(true))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    emit('message.created', {
      conversationId: CONVERSATION,
      messageId: 'm1',
      seq: '4',
      authorKind: 'contact',
      authorId: 'contact-1',
      type: 'text',
      visibility: 'customer',
      moderation: 'published',
      createdAt: '2026-09-07T10:00:00.000Z',
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: qk.conversationMessages(CONVERSATION),
    })
    // The row's unread count and preview changed too, so the queue is stale.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.conversations })

    // Nothing was written. The payload deliberately carries no body, because
    // the body is subject to per-reader rules only the read path applies.
    expect(queryClient.getQueryData(qk.conversationMessages(CONVERSATION))).toBeUndefined()
  })

  it('invalidates on an edit rather than trusting the body it carries', async () => {
    const queryClient = mount()
    await waitFor(() => expect(handlers.has('message.updated')).toBe(true))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    emit('message.updated', {
      conversationId: CONVERSATION,
      messageId: 'm1',
      seq: '4',
      body: 'edited text',
      editedAt: '2026-09-07T10:05:00.000Z',
      editCount: 1,
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: qk.conversationMessages(CONVERSATION),
    })
    expect(queryClient.getQueryData(qk.conversationMessages(CONVERSATION))).toBeUndefined()
  })

  it('refreshes the queue when a conversation changes section', async () => {
    const queryClient = mount()
    await waitFor(() => expect(handlers.has('conversation.updated')).toBe(true))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    emit('conversation.updated', {
      conversationId: CONVERSATION,
      familyId: 'fam-1',
      state: 'waiting_on_jawwid',
      needsReply: true,
      lastActivityAt: '2026-09-07T10:00:00.000Z',
      handlerId: 'staff-1',
    })

    // The conversation may have moved between sections, so the LIST is stale
    // and not only the row.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.conversations })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.conversation(CONVERSATION) })
  })

  it('refreshes a conversation when an approval is decided', async () => {
    const queryClient = mount()
    await waitFor(() => expect(handlers.has('approval.decided')).toBe(true))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    emit('approval.decided', {
      conversationId: CONVERSATION,
      messageId: 'm1',
      approvalId: 'a1',
      decision: 'approved',
      rejectionReason: null,
    })

    // An approved message becomes visible to the group, so the thread changed.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: qk.conversationMessages(CONVERSATION),
    })
  })

  it('a receipt moving does not write a receipt into the cache', async () => {
    const queryClient = mount()
    await waitFor(() => expect(handlers.has('message.receipt.updated')).toBe(true))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    emit('message.receipt.updated', {
      conversationId: CONVERSATION,
      messageId: 'm1',
      actorId: 'contact-1',
      state: 'read',
      at: '2026-09-07T10:01:00.000Z',
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: qk.conversationMessages(CONVERSATION),
    })
    expect(queryClient.getQueryData(qk.conversationMessages(CONVERSATION))).toBeUndefined()
  })
})
