import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createLiveKitMedia, type CallMediaSnapshot } from './callMedia'

/**
 * The real media client, against a scripted LiveKit room. What is under test is
 * how the client reads LiveKit's events -- not LiveKit.
 */
const lk = vi.hoisted(() => {
  const RoomEvent = {
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    AudioPlaybackStatusChanged: 'audioPlaybackChanged',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
    Disconnected: 'disconnected',
  }
  type Handler = (...args: unknown[]) => void
  class FakeRoom {
    static last: FakeRoom
    /** What the next room's microphone does when the client turns it on. */
    static microphone: () => Promise<void> = async () => {}
    handlers = new Map<string, Handler[]>()
    canPlaybackAudio = true
    localParticipant = { setMicrophoneEnabled: FakeRoom.microphone }
    constructor() {
      FakeRoom.last = this
    }
    on(event: string, h: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), h])
      return this
    }
    fire(event: string, ...args: unknown[]) {
      for (const h of this.handlers.get(event) ?? []) h(...args)
    }
    async connect() {}
    async disconnect() {}
    async startAudio() {}
  }
  return { RoomEvent, FakeRoom, Track: { Kind: { Audio: 'audio' } } }
})
vi.mock('livekit-client', () => ({ Room: lk.FakeRoom, RoomEvent: lk.RoomEvent, Track: lk.Track }))

/** A remote audio track whose detach() may, like LiveKit's, already be spent. */
function audioTrack(sid: string) {
  let attached: HTMLMediaElement[] = []
  return {
    kind: 'audio',
    sid,
    attach() {
      const el = document.createElement('audio')
      attached.push(el)
      return el
    },
    detach() {
      const out = attached
      attached = []
      return out
    },
  }
}
const parent = { identity: 'parent-1' }
const players = () => document.querySelectorAll('[data-call-audio]').length

async function connected(microphone: () => Promise<void> = async () => {}) {
  lk.FakeRoom.microphone = microphone
  const media = createLiveKitMedia()
  const seen: CallMediaSnapshot[] = []
  media.subscribe((s) => seen.push(s))
  await media.connect('ws://lk', 'token')
  return { media, room: lk.FakeRoom.last, last: () => seen[seen.length - 1]! }
}

describe('createLiveKitMedia', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    lk.FakeRoom.last = undefined as never
  })

  it('a reconnect never turns a refused microphone into a live call', async () => {
    const { room, last } = await connected(() => Promise.reject(new Error('NotAllowedError')))
    expect(last()).toMatchObject({ phase: 'failed', failure: 'microphone' })

    room.fire(lk.RoomEvent.Reconnecting)
    room.fire(lk.RoomEvent.Reconnected)

    expect(last()).toMatchObject({ phase: 'failed', failure: 'microphone' })
  })

  it('a live call that reconnects is live again', async () => {
    const { room, last } = await connected()
    expect(last().phase).toBe('live')

    room.fire(lk.RoomEvent.Reconnecting)
    expect(last().phase).toBe('connecting')
    room.fire(lk.RoomEvent.Reconnected)
    expect(last().phase).toBe('live')
  })

  it('leaves no audio element behind when LiveKit detached the track first', async () => {
    const { media, room, last } = await connected()
    for (let i = 0; i < 3; i++) {
      const track = audioTrack(`TR_${i}`)
      room.fire(lk.RoomEvent.TrackSubscribed, track, {}, parent)
      expect(players()).toBe(1)
      track.detach() // a full reconnect tears the track down before reporting it
      room.fire(lk.RoomEvent.TrackUnsubscribed, track, {}, parent)
      expect(players()).toBe(0)
      expect(last().remoteAudio).toBe(false)
    }
    await media.disconnect()
    expect(players()).toBe(0)
  })

  it('a track subscribed twice plays from one element', async () => {
    const { room, last } = await connected()
    const track = audioTrack('TR_A')
    room.fire(lk.RoomEvent.TrackSubscribed, track, {}, parent)
    room.fire(lk.RoomEvent.TrackSubscribed, track, {}, parent)
    expect(players()).toBe(1)
    expect(last().remoteAudio).toBe(true)
  })

  it('hanging up removes every element it created', async () => {
    const { media, room } = await connected()
    room.fire(lk.RoomEvent.TrackSubscribed, audioTrack('TR_A'), {}, parent)
    room.fire(lk.RoomEvent.TrackSubscribed, audioTrack('TR_B'), {}, { identity: 'teacher-1' })
    expect(players()).toBe(2)
    await media.disconnect()
    expect(players()).toBe(0)
  })
})
