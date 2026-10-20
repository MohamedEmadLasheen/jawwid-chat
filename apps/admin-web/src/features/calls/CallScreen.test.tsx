import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router-dom'
import { renderWithProviders, makeStaff } from '@/test/utils'
import { IDLE_MEDIA, type CallMedia, type CallMediaSnapshot } from './callMedia'

/** The session's socket: lets a test play the server's call events. */
type Handler = (payload: unknown) => void
const fakeSocket = {
  connected: true,
  handlers: new Map<string, Set<Handler>>(),
  on(event: string, h: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(h)
  },
  off(event: string, h: Handler) {
    this.handlers.get(event)?.delete(h)
  },
  emit() {},
  serverEmits(event: string, payload: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(payload)
  },
  listenerCount(event: string) {
    return this.handlers.get(event)?.size ?? 0
  },
}

vi.mock('@/core/realtime/RealtimeProvider', () => ({
  useRealtime: () => ({ state: 'connected', hasEverConnected: true, socket: fakeSocket }),
}))

const { CallProvider } = await import('./CallProvider')
const { CallOverlay } = await import('./CallOverlay')
const { ConversationCallControls } = await import('./ConversationCallControls')

const ADMIN = makeStaff({ id: 'staff_a', role: 'admin' })

/** One fake LiveKit per call. */
let media: (CallMedia & { connects: Array<{ url: string; token: string }>; play: (p: Partial<CallMediaSnapshot>) => void }) | null
function createMedia(): CallMedia {
  let listener: ((s: CallMediaSnapshot) => void) | null = null
  let snap = { ...IDLE_MEDIA }
  const m = {
    connects: [] as Array<{ url: string; token: string }>,
    async connect(url: string, token: string) {
      m.connects.push({ url, token })
    },
    async setMicrophoneMuted() {},
    async startAudio() {},
    async disconnect() {},
    subscribe(l: (s: CallMediaSnapshot) => void) {
      listener = l
      l(snap)
      return () => {
        listener = null
      }
    },
    play(p: Partial<CallMediaSnapshot>) {
      snap = { ...snap, ...p }
      listener?.(snap)
    },
  }
  media = m
  return m
}

let requests: Array<{ method: string; path: string; body: unknown }>
function stubApi(opts: { canCall: boolean; history?: unknown[] }) {
  requests = []
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const path = url.pathname.replace(/^\/api\/v1/, '')
      const method = init?.method ?? 'GET'
      requests.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (path === '/me') return json(ADMIN)
      if (path.endsWith('/call-capability')) return json({ canCall: opts.canCall, code: opts.canCall ? null : 'COMM.NOT_ON_DUTY' })
      if (path === '/calls' && method === 'POST') return json({ callId: 'call-1', roomName: 'room-x' })
      if (/^\/calls\/[^/]+\/token$/.test(path)) return json({ token: 'tok', url: 'wss://media.test', roomName: 'room-x', expiresAt: '' })
      if (/^\/calls\/[^/]+\/(accept|decline|end)$/.test(path)) return json({ ok: true })
      if (path.startsWith('/calls/history/')) return json({ calls: opts.history ?? [] })
      return json({}, 404)
    }),
  )
}

/** Where the router is, so a test can see the window open a conversation. */
function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname + l.search}</output>
}

function renderScreen(isGroup = false) {
  return renderWithProviders(
    <CallProvider createMedia={createMedia}>
      <ConversationCallControls conversationId="conv-1" peerLabel="Parent P" isGroup={isGroup} />
      <CallOverlay />
      <Where />
    </CallProvider>,
    { staff: ADMIN },
  )
}

const where = () => screen.getByTestId('where').textContent
const callWindow = () => screen.getByRole('region', { name: 'Call' })
const callStarts = () => requests.filter((r) => r.method === 'POST' && r.path === '/calls')

/** Place a call from the header and let it ring out as the server reports. */
async function placeCallThatEnds(outcome: string, durationSeconds: number | null = null) {
  stubApi({ canCall: true })
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Call' }))
  await within(await screen.findByRole('region', { name: 'Call' })).findByText('Calling…')
  act(() => fakeSocket.serverEmits('call.ended', { callId: 'call-1', conversationId: 'conv-1', outcome, durationSeconds }))
}

beforeEach(() => {
  fakeSocket.handlers.clear()
  media = null
})
afterEach(() => vi.unstubAllGlobals())

describe('the call button follows the server', () => {
  it('is ABSENT (not disabled) when the server says this admin cannot call', async () => {
    stubApi({ canCall: false })
    renderScreen()
    await waitFor(() => expect(requests.some((r) => r.path === '/conversations/conv-1/call-capability')).toBe(true))
    expect(screen.queryByRole('button', { name: 'Call' })).toBeNull()
  })

  it('names a group call as one', async () => {
    stubApi({ canCall: true })
    renderScreen(true)
    expect(await screen.findByRole('button', { name: 'Group call' })).toBeTruthy()
  })
})

describe('an outgoing call, end to end in the UI', () => {
  it('starts, joins media on call.accepted, hangs up, and shows the server\'s outcome', async () => {
    stubApi({ canCall: true })
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Call' }))

    const win = await screen.findByRole('region', { name: 'Call' })
    expect(within(win).getByText('Parent P')).toBeTruthy()
    expect(await within(win).findByText('Calling…')).toBeTruthy()
    // While it rings there is nothing to mute yet; leaving is "Cancel".
    expect(within(win).getByRole('button', { name: 'Mute' })).toHaveProperty('disabled', true)
    expect(within(win).getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(requests.find((r) => r.method === 'POST' && r.path === '/calls')?.body).toEqual({ conversationId: 'conv-1' })
    expect(requests.some((r) => r.path.endsWith('/token'))).toBe(false) // nobody joins while ringing

    act(() => fakeSocket.serverEmits('call.accepted', { callId: 'call-1', conversationId: 'conv-1', actorId: 'parent-1' }))
    await waitFor(() => expect(media?.connects).toEqual([{ url: 'wss://media.test', token: 'tok' }]))
    act(() => media!.play({ phase: 'live', remoteAudio: true }))
    expect(await screen.findByText(/In call/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Hang up' }))
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.path === '/calls/call-1/end')).toBe(true))
    act(() => fakeSocket.serverEmits('call.ended', { callId: 'call-1', conversationId: 'conv-1', outcome: 'answered', durationSeconds: 65 }))
    expect(await screen.findByText(/Call ended/)).toBeTruthy()
    expect(screen.getByText(/1:05/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Call' })).toBeNull())
  })

  it('keeps Hang up apart from Mute, and the biggest control (call.md §6)', async () => {
    stubApi({ canCall: true })
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Call' }))
    await within(await screen.findByRole('region', { name: 'Call' })).findByText('Calling…')
    act(() => fakeSocket.serverEmits('call.accepted', { callId: 'call-1', conversationId: 'conv-1', actorId: 'parent-1' }))
    await waitFor(() => expect(media?.connects).toHaveLength(1))
    act(() => media!.play({ phase: 'live', remoteAudio: true }))
    const mute = await within(callWindow()).findByRole('button', { name: 'Mute' })
    const hangUp = within(callWindow()).getByRole('button', { name: 'Hang up' })
    // Not siblings: Mute lives in the secondary group, Hang up outside it.
    expect(mute.closest('.call-window__secondary')).not.toBeNull()
    expect(hangUp.closest('.call-window__secondary')).toBeNull()
    expect(hangUp.className).toContain('call-window__round--lg')
    expect(mute.className).not.toContain('call-window__round--lg')
  })

  it('Message opens the conversation and the call carries on', async () => {
    stubApi({ canCall: true })
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Call' }))
    await within(await screen.findByRole('region', { name: 'Call' })).findByText('Calling…')
    act(() => fakeSocket.serverEmits('call.accepted', { callId: 'call-1', conversationId: 'conv-1', actorId: 'parent-1' }))
    await waitFor(() => expect(media?.connects).toHaveLength(1))
    act(() => media!.play({ phase: 'live', remoteAudio: true }))
    fireEvent.click(await within(callWindow()).findByRole('button', { name: 'Message' }))
    expect(where()).toBe('/chat/conv-1')
    expect(within(callWindow()).getByRole('button', { name: 'Hang up' })).toBeTruthy()
    expect(requests.some((r) => r.path === '/calls/call-1/end')).toBe(false)
  })
})

describe('after a call that did not connect', () => {
  it('names the server\'s `missed` as "No answer" on a call this side placed', async () => {
    await placeCallThatEnds('missed')
    expect(await within(callWindow()).findByText('No answer')).toBeTruthy()
    for (const name of ['Close', 'Record voice message', 'Call again']) {
      expect(within(callWindow()).getByRole('button', { name })).toBeTruthy()
    }
  })

  it('Call again asks the server for a NEW call in the same conversation', async () => {
    await placeCallThatEnds('missed')
    expect(callStarts()).toHaveLength(1)
    fireEvent.click(await within(callWindow()).findByRole('button', { name: 'Call again' }))
    await waitFor(() => expect(callStarts()).toHaveLength(2))
    expect(callStarts()[1]!.body).toEqual({ conversationId: 'conv-1' })
    expect(await within(callWindow()).findByText('Calling…')).toBeTruthy()
  })

  it('Call again that the server refuses is shown, not retried', async () => {
    await placeCallThatEnds('missed')
    const real = globalThis.fetch as unknown as (i: string, init?: RequestInit) => Promise<Response>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (String(input).endsWith('/calls') && init?.method === 'POST') {
          requests.push({ method: 'POST', path: '/calls', body: JSON.parse(String(init.body)) })
          return new Response(JSON.stringify({ error: { code: 'COMM.NOT_ON_DUTY', message: 'Not on duty' } }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return real(input, init)
      }),
    )
    fireEvent.click(await within(callWindow()).findByRole('button', { name: 'Call again' }))
    expect(await within(callWindow()).findByRole('alert')).toBeTruthy()
    expect(callStarts()).toHaveLength(2)
    expect(within(callWindow()).queryByRole('button', { name: 'Call again' })).toBeNull()
  })

  it('Record voice message closes the window and opens the chat recording', async () => {
    await placeCallThatEnds('missed')
    fireEvent.click(await within(callWindow()).findByRole('button', { name: 'Record voice message' }))
    expect(where()).toBe('/chat/conv-1?voice=1')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Call' })).toBeNull())
    expect(callStarts()).toHaveLength(1)
  })

  it('a ring that was missed HERE reads "Missed call"', async () => {
    stubApi({ canCall: true })
    renderScreen()
    act(() =>
      fakeSocket.serverEmits('call.incoming', { callId: 'call-9', conversationId: 'conv-1', type: 'direct', initiatorName: 'Parent P' }),
    )
    await screen.findByRole('alertdialog', { name: 'Incoming call from Parent P' })
    act(() => fakeSocket.serverEmits('call.ended', { callId: 'call-9', conversationId: 'conv-1', outcome: 'missed', durationSeconds: null }))
    expect(await within(callWindow()).findByText('Missed call')).toBeTruthy()
  })
})

describe('an incoming call rings, wherever the admin is', () => {
  it('shows Answer and Decline; answering asks the server, then joins', async () => {
    stubApi({ canCall: true })
    renderScreen()
    act(() =>
      fakeSocket.serverEmits('call.incoming', {
        callId: 'call-7',
        conversationId: 'conv-2',
        type: 'direct',
        initiatorId: 'parent-1',
        initiatorName: 'Parent P',
      }),
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Incoming call from Parent P' })
    expect(dialog).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }))
    await waitFor(() => expect(media?.connects).toHaveLength(1))
    const order = requests.filter((r) => r.path.startsWith('/calls/call-7')).map((r) => r.path)
    expect(order).toEqual(['/calls/call-7/accept', '/calls/call-7/token'])
  })

  it('declining ends it as declined', async () => {
    stubApi({ canCall: true })
    renderScreen()
    act(() =>
      fakeSocket.serverEmits('call.incoming', { callId: 'call-7', conversationId: 'conv-2', type: 'group', initiatorName: 'Teacher T' }),
    )
    await screen.findByRole('alertdialog', { name: 'Group call from Teacher T' })
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(await screen.findByText('Call declined')).toBeTruthy()
    expect(media).toBeNull()
  })

  it('a malformed event is ignored', async () => {
    stubApi({ canCall: true })
    renderScreen()
    act(() => fakeSocket.serverEmits('call.incoming', { conversationId: 'conv-2' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('history and lifecycle hygiene', () => {
  it('lists the conversation\'s calls as the server recorded them', async () => {
    stubApi({
      canCall: true,
      history: [
        { id: 'h1', conversationId: 'conv-1', type: 'direct', status: 'ended', outcome: 'missed', initiatorId: 'x', startedAt: '2026-10-15T08:00:00Z', endedAt: null, durationSeconds: null, participants: [] },
        { id: 'h2', conversationId: 'conv-1', type: 'direct', status: 'ended', outcome: 'answered', initiatorId: 'x', startedAt: '2026-10-15T07:00:00Z', endedAt: null, durationSeconds: 125, participants: [] },
      ],
    })
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Call history' }))
    expect(await screen.findByText('No answer')).toBeTruthy()
    expect(screen.getByText(/Call ended · 2:05/)).toBeTruthy()
  })

  it('removes exactly its own socket listeners on unmount', async () => {
    stubApi({ canCall: true })
    const { unmount } = renderScreen()
    await waitFor(() => expect(fakeSocket.listenerCount('call.incoming')).toBe(1))
    unmount()
    for (const e of ['call.incoming', 'call.accepted', 'call.declined', 'call.ended']) {
      expect(fakeSocket.listenerCount(e)).toBe(0)
    }
  })
})
