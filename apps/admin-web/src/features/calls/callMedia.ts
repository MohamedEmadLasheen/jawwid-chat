/**
 * THE MEDIA CLIENT -- audio only, and nothing about the call's lifecycle.
 *
 * It joins one LiveKit room with a server-issued token, publishes the
 * microphone, and plays every remote audio track. It reports what it SEES as
 * snapshots. It never decides that a call has ended: a dropped connection is
 * `disconnected`, not "the call is over" -- the server's `call.ended` is the only
 * authority on that (the W6 contract, mirrored from the mobile app).
 *
 * Behind an interface so the call state machine and its tests never touch
 * LiveKit; the real implementation loads `livekit-client` lazily, on the first
 * connect, so it stays out of the main bundle.
 */

export type MediaPhase = 'idle' | 'connecting' | 'live' | 'disconnected' | 'failed'

/** Why media failed, in words a UI can act on. Never a raw SDK error. */
export type MediaFailure = 'microphone' | 'network'

export interface CallMediaSnapshot {
  phase: MediaPhase
  microphoneMuted: boolean
  /** At least one remote participant's audio is being played. */
  remoteAudio: boolean
  /** The browser blocked autoplay; a user gesture must call startAudio(). */
  audioBlocked: boolean
  failure: MediaFailure | null
}

export interface CallMedia {
  connect(url: string, token: string): Promise<void>
  setMicrophoneMuted(muted: boolean): Promise<void>
  /** Resume playback after the browser blocked autoplay. Must run in a gesture. */
  startAudio(): Promise<void>
  /** Leave the room and release the microphone. Safe to call more than once. */
  disconnect(): Promise<void>
  subscribe(listener: (snapshot: CallMediaSnapshot) => void): () => void
}

export type CallMediaFactory = () => CallMedia

export const IDLE_MEDIA: CallMediaSnapshot = {
  phase: 'idle',
  microphoneMuted: false,
  remoteAudio: false,
  audioBlocked: false,
  failure: null,
}

/** The production client: LiveKit, audio only. */
export const createLiveKitMedia: CallMediaFactory = () => {
  let snapshot: CallMediaSnapshot = { ...IDLE_MEDIA }
  const listeners = new Set<(s: CallMediaSnapshot) => void>()
  const players = new Map<string, HTMLMediaElement[]>()
  let room: import('livekit-client').Room | null = null
  let leaving = false

  const emit = (patch: Partial<CallMediaSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    for (const l of listeners) l(snapshot)
  }

  const releasePlayers = () => {
    for (const elements of players.values()) for (const el of elements) el.remove()
    players.clear()
  }

  return {
    async connect(url, token) {
      if (room) return
      leaving = false
      emit({ phase: 'connecting', failure: null })
      const lk = await import('livekit-client')
      const r = new lk.Room({ adaptiveStream: false, dynacast: false })
      room = r

      r.on(lk.RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind !== lk.Track.Kind.Audio) return
        const el = track.attach()
        el.setAttribute('data-call-audio', participant.identity)
        el.style.display = 'none'
        document.body.appendChild(el)
        const key = track.sid ?? participant.identity
        players.set(key, [...(players.get(key) ?? []), el])
        emit({ remoteAudio: true })
      })
      r.on(lk.RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        for (const el of track.detach()) el.remove()
        players.delete(track.sid ?? participant.identity)
        emit({ remoteAudio: players.size > 0 })
      })
      r.on(lk.RoomEvent.AudioPlaybackStatusChanged, () => emit({ audioBlocked: !r.canPlaybackAudio }))
      r.on(lk.RoomEvent.Reconnecting, () => emit({ phase: 'connecting' }))
      r.on(lk.RoomEvent.Reconnected, () => emit({ phase: 'live' }))
      r.on(lk.RoomEvent.Disconnected, () => {
        releasePlayers()
        room = null
        // Our own leave is not a drop; anything else is, and a drop is NOT an
        // ending -- the controller decides what to do about it.
        if (!leaving) emit({ phase: 'disconnected', remoteAudio: false })
      })

      try {
        await r.connect(url, token)
      } catch {
        room = null
        emit({ phase: 'failed', failure: 'network' })
        return
      }
      try {
        await r.localParticipant.setMicrophoneEnabled(true)
      } catch {
        // Permission refused or no device: in the room, but unable to speak.
        emit({ phase: 'failed', failure: 'microphone' })
        return
      }
      emit({ phase: 'live', microphoneMuted: false, audioBlocked: !r.canPlaybackAudio })
    },

    async setMicrophoneMuted(muted) {
      if (!room) return
      await room.localParticipant.setMicrophoneEnabled(!muted)
      emit({ microphoneMuted: muted })
    },

    async startAudio() {
      if (!room) return
      await room.startAudio()
      emit({ audioBlocked: !room.canPlaybackAudio })
    },

    async disconnect() {
      leaving = true
      const r = room
      room = null
      releasePlayers()
      if (r) await r.disconnect()
      emit({ ...IDLE_MEDIA })
    },

    subscribe(listener) {
      listeners.add(listener)
      listener(snapshot)
      return () => listeners.delete(listener)
    },
  }
}
