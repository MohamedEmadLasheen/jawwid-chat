import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ApiError } from '@/core/api/errors'
import { CallController, type CallApi } from './callController'
import { IDLE_MEDIA, type CallMedia, type CallMediaSnapshot } from './callMedia'

/** A media client that records what it was asked and lets a test play LiveKit. */
function fakeMedia() {
  let listener: ((s: CallMediaSnapshot) => void) | null = null
  let snapshot: CallMediaSnapshot = { ...IDLE_MEDIA }
  const media = {
    connects: [] as Array<{ url: string; token: string }>,
    disconnects: 0,
    muted: [] as boolean[],
    async connect(url: string, token: string) {
      media.connects.push({ url, token })
      media.play({ phase: 'connecting' })
    },
    async setMicrophoneMuted(m: boolean) {
      media.muted.push(m)
      media.play({ microphoneMuted: m })
    },
    async startAudio() {},
    async disconnect() {
      media.disconnects++
    },
    subscribe(l: (s: CallMediaSnapshot) => void) {
      listener = l
      l(snapshot)
      return () => {
        listener = null
      }
    },
    /** LiveKit reports something. */
    play(p: Partial<CallMediaSnapshot>) {
      snapshot = { ...snapshot, ...p }
      listener?.(snapshot)
    },
  }
  return media as typeof media & CallMedia
}

function fakeApi() {
  let tokens = 0
  const api = {
    start: vi.fn(async () => ({ callId: 'call-1', roomName: 'room-x' })),
    token: vi.fn(async () => ({ token: `tok-${++tokens}`, url: 'wss://media.test', roomName: 'room-x', expiresAt: '' })),
    accept: vi.fn(async () => ({ ok: true })),
    decline: vi.fn(async () => ({ ok: true })),
    end: vi.fn(async () => ({ ok: true })),
  }
  return api as typeof api & CallApi
}

const refused = (status: number, code: string) =>
  new ApiError({ status, code, messageEn: `refused ${code}`, messageAr: `مرفوض ${code}` })

const flush = () => new Promise((r) => setTimeout(r, 0))

let api: ReturnType<typeof fakeApi>
let medias: Array<ReturnType<typeof fakeMedia>>
let c: CallController

beforeEach(() => {
  api = fakeApi()
  medias = []
  c = new CallController(api, () => {
    const m = fakeMedia()
    medias.push(m)
    return m
  }, () => 1_000)
})
afterEach(() => vi.useRealTimers())

const incoming = (callId = 'call-9', type = 'direct') =>
  c.onServerEvent({ event: 'call.incoming', payload: { callId, conversationId: 'conv-1', type, initiatorName: 'Parent P' } })

describe('outgoing call', () => {
  it('rings, joins media only when the server says call.accepted, and goes live', async () => {
    await c.start({ conversationId: 'conv-1', peerLabel: 'Parent P', isGroup: false })
    expect(api.start).toHaveBeenCalledWith('conv-1')
    expect(c.getSnapshot()).toMatchObject({ phase: 'outgoingRinging', callId: 'call-1' })
    expect(medias).toHaveLength(0) // nothing joins while ringing

    c.onServerEvent({ event: 'call.accepted', payload: { callId: 'call-1' } })
    await flush()
    expect(api.token).toHaveBeenCalledWith('call-1')
    expect(medias[0]!.connects).toEqual([{ url: 'wss://media.test', token: 'tok-1' }])
    expect(c.getSnapshot().phase).toBe('connecting')

    medias[0]!.play({ phase: 'live', remoteAudio: true })
    expect(c.getSnapshot()).toMatchObject({ phase: 'live', remoteAudio: true, liveSince: 1_000 })
  })

  it('hanging up asks the server, leaves the outcome to call.ended, and tears down once', async () => {
    await c.start({ conversationId: 'conv-1', peerLabel: 'P', isGroup: false })
    c.onServerEvent({ event: 'call.accepted', payload: { callId: 'call-1' } })
    await flush()
    medias[0]!.play({ phase: 'live' })

    await c.hangUp()
    expect(api.end).toHaveBeenCalledWith('call-1')
    expect(c.getSnapshot()).toMatchObject({ phase: 'ended', outcome: null }) // the client names no outcome
    c.onServerEvent({ event: 'call.ended', payload: { callId: 'call-1', outcome: 'answered', durationSeconds: 42 } })
    expect(c.getSnapshot()).toMatchObject({ phase: 'ended', outcome: 'answered', durationSeconds: 42 })
    await flush()
    expect(medias[0]!.disconnects).toBe(1)
  })

  it('cancelling while ringing is a hang-up; the server reports it as missed', async () => {
    await c.start({ conversationId: 'conv-1', peerLabel: 'P', isGroup: false })
    await c.hangUp()
    c.onServerEvent({ event: 'call.ended', payload: { callId: 'call-1', outcome: 'missed', durationSeconds: null } })
    expect(c.getSnapshot()).toMatchObject({ phase: 'ended', outcome: 'missed' })
    expect(medias).toHaveLength(0)
  })

  it('a refused start is shown with the server\'s reason, and Try again starts a NEW call', async () => {
    api.start.mockRejectedValueOnce(refused(403, 'COMM.NOT_ON_DUTY'))
    await c.start({ conversationId: 'conv-1', peerLabel: 'P', isGroup: false })
    expect(c.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'notAllowed', callId: null })
    expect(c.getSnapshot().error?.code).toBe('COMM.NOT_ON_DUTY')
    await c.retry()
    expect(api.start).toHaveBeenCalledTimes(2)
    expect(c.getSnapshot().phase).toBe('outgoingRinging')
  })

  it('the other side declining ends the call as declined', async () => {
    await c.start({ conversationId: 'conv-1', peerLabel: 'P', isGroup: false })
    c.onServerEvent({ event: 'call.declined', payload: { callId: 'call-1' } })
    expect(c.getSnapshot()).toMatchObject({ phase: 'ended', outcome: 'declined' })
  })
})

describe('incoming call', () => {
  it('rings, and answering asks the server BEFORE joining media', async () => {
    incoming()
    expect(c.getSnapshot()).toMatchObject({ phase: 'incomingRinging', callId: 'call-9', peerLabel: 'Parent P', isGroup: false })
    await c.accept()
    expect(api.accept).toHaveBeenCalledWith('call-9')
    expect(api.token).toHaveBeenCalledWith('call-9')
    expect(medias[0]!.connects).toHaveLength(1)
  })

  it('a refused answer joins nothing and shows why', async () => {
    api.accept.mockRejectedValueOnce(refused(403, 'COMM.NOT_CONVERSATION_MEMBER'))
    incoming()
    await c.accept()
    expect(medias).toHaveLength(0)
    expect(api.token).not.toHaveBeenCalled()
    expect(c.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'notAllowed' })
  })

  it('declining is terminal at once; no media is ever created', async () => {
    incoming()
    await c.decline()
    expect(api.decline).toHaveBeenCalledWith('call-9')
    expect(c.getSnapshot()).toMatchObject({ phase: 'ended', outcome: 'declined' })
    expect(medias).toHaveLength(0)
  })

  it('a decline that arrives after the call ended settles quietly', async () => {
    api.decline.mockRejectedValueOnce(refused(409, 'COMM.CALL_ALREADY_ENDED'))
    incoming()
    await c.decline()
    expect(c.getSnapshot()).toMatchObject({ phase: 'ended', failure: null })
  })

  it('answered on another tab or device: this one stops ringing and joins nothing', () => {
    incoming()
    c.onServerEvent({ event: 'call.accepted', payload: { callId: 'call-9' } })
    expect(c.getSnapshot()).toMatchObject({ phase: 'ended', outcome: 'answered' })
    expect(medias).toHaveLength(0)
  })

  it('a group call is presented as one', () => {
    incoming('call-9', 'group')
    expect(c.getSnapshot().isGroup).toBe(true)
  })
})

describe('one call at a time, and only its own events', () => {
  it('a second incoming call during a call is not presented', async () => {
    await c.start({ conversationId: 'conv-1', peerLabel: 'P', isGroup: false })
    incoming('call-other')
    expect(c.getSnapshot().callId).toBe('call-1')
  })

  it('events for another call change nothing', async () => {
    await c.start({ conversationId: 'conv-1', peerLabel: 'P', isGroup: false })
    c.onServerEvent({ event: 'call.ended', payload: { callId: 'call-other', outcome: 'answered', durationSeconds: 1 } })
    c.onServerEvent({ event: 'call.declined', payload: { callId: 'call-other' } })
    c.onServerEvent({ event: 'call.accepted', payload: { callId: 'call-other' } })
    expect(c.getSnapshot().phase).toBe('outgoingRinging')
    expect(medias).toHaveLength(0)
  })

  it('call.declined and call.ended in either order settle once', async () => {
    incoming()
    c.onServerEvent({ event: 'call.ended', payload: { callId: 'call-9', outcome: 'declined', durationSeconds: null } })
    c.onServerEvent({ event: 'call.declined', payload: { callId: 'call-9' } })
    expect(c.getSnapshot()).toMatchObject({ phase: 'ended', outcome: 'declined' })
  })
})

describe('media is not the lifecycle', () => {
  async function live() {
    incoming()
    await c.accept()
    medias[0]!.play({ phase: 'live' })
  }

  it('a dropped connection is retried ONCE with a fresh token, and never ends the call', async () => {
    await live()
    medias[0]!.play({ phase: 'disconnected' })
    expect(c.getSnapshot().phase).toBe('reconnecting')
    await flush()
    expect(api.token).toHaveBeenCalledTimes(2)
    expect(medias[0]!.connects.map((x) => x.token)).toEqual(['tok-1', 'tok-2'])

    medias[0]!.play({ phase: 'disconnected' })
    await flush()
    expect(api.token).toHaveBeenCalledTimes(2) // no second retry
    expect(c.getSnapshot()).toMatchObject({ phase: 'reconnecting', failure: 'network' })
    expect(api.end).not.toHaveBeenCalled()
  })

  it('no timer ends a call: ten minutes live is still live', async () => {
    vi.useFakeTimers()
    incoming()
    const accepting = c.accept()
    await vi.runAllTimersAsync()
    await accepting
    medias[0]!.play({ phase: 'live' })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(c.getSnapshot().phase).toBe('live')
    expect(api.end).not.toHaveBeenCalled()
  })

  it('a refused microphone is a failure the admin can still hang up from', async () => {
    incoming()
    await c.accept()
    medias[0]!.play({ phase: 'failed', failure: 'microphone' })
    expect(c.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'microphone', callId: 'call-9' })
    await c.hangUp()
    expect(api.end).toHaveBeenCalledWith('call-9')
  })

  it('mute goes to the media client and its answer is shown', async () => {
    await live()
    await c.toggleMute()
    expect(medias[0]!.muted).toEqual([true])
    expect(c.getSnapshot().microphoneMuted).toBe(true)
  })

  it('a token refused because the call ended settles as ended', async () => {
    api.token.mockRejectedValueOnce(refused(409, 'COMM.CALL_ALREADY_ENDED'))
    incoming()
    await c.accept()
    expect(c.getSnapshot().phase).toBe('ended')
  })
})

describe('the session owns the call', () => {
  it('dispose (sign-out) leaves the media room and ignores later events', async () => {
    incoming()
    await c.accept()
    c.dispose()
    await flush()
    expect(medias[0]!.disconnects).toBe(1)
    c.onServerEvent({ event: 'call.incoming', payload: { callId: 'x', conversationId: 'c', type: 'direct', initiatorName: 'Q' } })
    expect(c.getSnapshot().phase).toBe('idle')
  })
})
