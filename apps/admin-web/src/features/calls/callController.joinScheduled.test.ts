import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '@/core/api/errors'
import { CallController, type CallApi } from './callController'
import { IDLE_MEDIA, type CallMedia, type CallMediaSnapshot } from './callMedia'
import type { ScheduledJoin } from './callApi'

/**
 * PD-13: `joinScheduled` is an ADDITIVE entry point. It must land in exactly
 * the states the frozen paths already produce -- `start()`'s outgoing ringing,
 * or the incoming-accept path -- and nothing else.
 */

function fakeMedia() {
  let listener: ((s: CallMediaSnapshot) => void) | null = null
  let snapshot: CallMediaSnapshot = { ...IDLE_MEDIA }
  const media = {
    connects: [] as Array<{ url: string; token: string }>,
    async connect(url: string, token: string) {
      media.connects.push({ url, token })
      media.play({ phase: 'connecting' })
    },
    async setMicrophoneMuted() {},
    async startAudio() {},
    async disconnect() {},
    subscribe(l: (s: CallMediaSnapshot) => void) {
      listener = l
      l(snapshot)
      return () => {
        listener = null
      }
    },
    play(p: Partial<CallMediaSnapshot>) {
      snapshot = { ...snapshot, ...p }
      listener?.(snapshot)
    },
  }
  return media as typeof media & CallMedia
}

function fakeApi(join: ScheduledJoin | ApiError) {
  const api = {
    start: vi.fn(async () => ({ callId: 'call-plain', roomName: 'r' })),
    token: vi.fn(async () => ({ token: 'tok', url: 'wss://media.test', roomName: 'r', expiresAt: '' })),
    accept: vi.fn(async () => ({ ok: true })),
    decline: vi.fn(async () => ({ ok: true })),
    end: vi.fn(async () => ({ ok: true })),
    joinScheduled: vi.fn(async () => {
      if (join instanceof ApiError) throw join
      return join
    }),
  }
  return api as typeof api & CallApi
}

const refused = (status: number, code: string) =>
  new ApiError({ status, code, messageEn: `refused ${code}`, messageAr: `مرفوض ${code}` })

let medias: Array<ReturnType<typeof fakeMedia>>
const makeController = (api: CallApi) =>
  new CallController(api, () => {
    const m = fakeMedia()
    medias.push(m)
    return m
  }, () => 1_000)

beforeEach(() => {
  medias = []
})

const ARGS = { scheduledCallId: 'sc-1', conversationId: 'conv-1', peerLabel: 'Group A', isGroup: true }

describe('joinScheduled: started', () => {
  it('lands in the same state as a successful start(): outgoing ringing, no media until call.accepted', async () => {
    const api = fakeApi({ callId: 'call-7', conversationId: 'conv-1', mode: 'started' })
    const c = makeController(api)
    await c.joinScheduled(ARGS)

    expect(api.joinScheduled).toHaveBeenCalledWith('sc-1')
    expect(api.start).not.toHaveBeenCalled()
    expect(api.accept).not.toHaveBeenCalled()
    const s = c.getSnapshot()
    expect(s).toMatchObject({
      phase: 'outgoingRinging',
      callId: 'call-7',
      conversationId: 'conv-1',
      direction: 'outgoing',
      peerLabel: 'Group A',
      isGroup: true,
    })
    expect(medias).toHaveLength(0)

    // The ordinary cue to join media.
    c.onServerEvent({ event: 'call.accepted', payload: { callId: 'call-7' } })
    await Promise.resolve()
    await Promise.resolve()
    expect(c.getSnapshot().phase).toBe('connecting')
    expect(api.token).toHaveBeenCalledWith('call-7')
  })

  it('is identical, field for field, to the state start() leaves', async () => {
    const viaJoin = makeController(fakeApi({ callId: 'call-plain', conversationId: 'conv-1', mode: 'started' }))
    const viaStart = makeController(fakeApi({ callId: 'x', conversationId: 'x', mode: 'started' }))
    await viaJoin.joinScheduled({ scheduledCallId: 'sc-1', conversationId: 'conv-1', peerLabel: 'P', isGroup: false })
    await viaStart.start({ conversationId: 'conv-1', peerLabel: 'P', isGroup: false })
    expect(viaJoin.getSnapshot()).toEqual(viaStart.getSnapshot())
  })
})

describe('joinScheduled: joined', () => {
  it('runs the accept path: connecting, POST accept, then a fresh media token', async () => {
    const api = fakeApi({ callId: 'call-live', conversationId: 'conv-2', mode: 'joined' })
    const c = makeController(api)
    await c.joinScheduled(ARGS)

    expect(api.accept).toHaveBeenCalledWith('call-live')
    expect(api.token).toHaveBeenCalledWith('call-live')
    expect(medias).toHaveLength(1)
    expect(medias[0]!.connects).toEqual([{ url: 'wss://media.test', token: 'tok' }])
    expect(c.getSnapshot()).toMatchObject({ phase: 'connecting', callId: 'call-live', conversationId: 'conv-2' })

    medias[0]!.play({ phase: 'live', remoteAudio: true })
    expect(c.getSnapshot().phase).toBe('live')
  })

  it('when this device is already ringing for that call, it simply accepts', async () => {
    const api = fakeApi({ callId: 'call-9', conversationId: 'conv-1', mode: 'joined' })
    const c = makeController(api)
    c.onServerEvent({
      event: 'call.incoming',
      payload: { callId: 'call-9', conversationId: 'conv-1', type: 'group', initiatorName: 'Teacher T' },
    })
    await c.joinScheduled(ARGS)

    expect(api.accept).toHaveBeenCalledTimes(1)
    expect(api.accept).toHaveBeenCalledWith('call-9')
    // The ring's own facts are kept: it is the same call, answered.
    expect(c.getSnapshot()).toMatchObject({ phase: 'connecting', callId: 'call-9', peerLabel: 'Teacher T', direction: 'incoming' })
  })

  it('a failed accept is shown as the accept path shows it (classify)', async () => {
    const api = fakeApi({ callId: 'call-live', conversationId: 'conv-2', mode: 'joined' })
    api.accept.mockRejectedValueOnce(refused(409, 'COMM.CALL_NOT_A_PARTICIPANT'))
    const c = makeController(api)
    await c.joinScheduled(ARGS)
    expect(c.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'alreadyOver', callId: 'call-live' })
    expect(api.token).not.toHaveBeenCalled()
  })
})

describe('joinScheduled: refusals and guards', () => {
  it('a refused Join is failed via classify, with no conversation (so no plain-call Retry)', async () => {
    const c = makeController(fakeApi(refused(403, 'COMM.PARENT_CANNOT_START_GROUP_CALL')))
    await c.joinScheduled(ARGS)
    const s = c.getSnapshot()
    expect(s.phase).toBe('failed')
    expect(s.failure).toBe('notAllowed')
    expect(s.error?.code).toBe('COMM.PARENT_CANNOT_START_GROUP_CALL')
    expect(s.conversationId).toBeNull()
    expect(s.callId).toBeNull()
  })

  it('a cancelled or closed window is alreadyOver (409)', async () => {
    const c = makeController(fakeApi(refused(409, 'COMM.SCHEDULED_CALL_NOT_JOINABLE')))
    await c.joinScheduled(ARGS)
    expect(c.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'alreadyOver' })
  })

  it('does nothing while another call is in progress: one call at a time', async () => {
    const api = fakeApi({ callId: 'call-7', conversationId: 'conv-1', mode: 'started' })
    const c = makeController(api)
    await c.start({ conversationId: 'conv-x', peerLabel: 'X', isGroup: false })
    await c.joinScheduled(ARGS)
    expect(api.joinScheduled).not.toHaveBeenCalled()
    expect(c.getSnapshot().callId).toBe('call-plain')
  })

  it('a Join that does not match the ringing call leaves the ring alone', async () => {
    const api = fakeApi({ callId: 'call-other', conversationId: 'conv-3', mode: 'joined' })
    const c = makeController(api)
    c.onServerEvent({
      event: 'call.incoming',
      payload: { callId: 'call-9', conversationId: 'conv-1', type: 'direct', initiatorName: 'P' },
    })
    await c.joinScheduled(ARGS)
    expect(api.accept).not.toHaveBeenCalled()
    expect(c.getSnapshot()).toMatchObject({ phase: 'incomingRinging', callId: 'call-9' })
  })

  it('while ANOTHER conversation\'s call rings, it does not even ask the server (no phantom second call)', async () => {
    const api = fakeApi({ callId: 'call-new', conversationId: 'conv-other', mode: 'started' })
    const c = makeController(api)
    c.onServerEvent({
      event: 'call.incoming',
      payload: { callId: 'call-9', conversationId: 'conv-1', type: 'direct', initiatorName: 'P' },
    })
    await c.joinScheduled({ ...ARGS, conversationId: 'conv-other' })
    expect(api.joinScheduled).not.toHaveBeenCalled()
    expect(c.getSnapshot()).toMatchObject({ phase: 'incomingRinging', callId: 'call-9' })
  })

  it('an api without joinScheduled changes nothing', async () => {
    const api = fakeApi({ callId: 'c', conversationId: 'c', mode: 'started' })
    const { joinScheduled: _omit, ...rest } = api
    const c = makeController(rest as CallApi)
    await c.joinScheduled(ARGS)
    expect(c.getSnapshot().phase).toBe('idle')
  })
})
