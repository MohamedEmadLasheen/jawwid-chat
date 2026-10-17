import { ApiError } from '@/core/api/errors'
import type { callApi as CallApiImpl } from './callApi'
import type { CallMedia, CallMediaFactory, CallMediaSnapshot } from './callMedia'

/**
 * THE CALL EXPERIENCE in Admin Web: one owner, one state machine, no second
 * lifecycle. A port of the mobile app's CallController
 * (lib/features/calls/application/call_controller.dart), because both clients
 * consume the SAME server lifecycle (W6, locked):
 *
 *   accept   -> active            end while active  -> ended / answered
 *   decline  -> ended / declined  end while ringing -> ended / missed
 *   ring timeout -> ended / missed          ENDED is terminal
 *
 * It consumes those facts and never reconstructs them. Specifically it NEVER
 * treats any of these as the end of a call: our media connection dropping (that
 * is `reconnecting`), a participant leaving the media room (presence, W5), or a
 * timer -- there is no timer here, and an ACTIVE call has no deadline in the
 * current contract.
 *
 * Terminality arrives from exactly two places: the server's `call.ended` /
 * `call.declined` events, and a successful terminal request we made ourselves.
 * Both may arrive in either order; each settles once (one teardown).
 *
 * The OUTCOME is never decided here: after our own hang-up it stays null until
 * `call.ended` says `answered` or `missed` -- the client does not write history.
 */

export type CallPhase =
  | 'idle'
  | 'starting'
  | 'outgoingRinging'
  | 'incomingRinging'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'ended'
  | 'failed'

/** What went wrong, in terms the UI can act on. */
export type CallFailure = 'notAllowed' | 'alreadyOver' | 'network' | 'microphone' | 'unknown'

export interface CallState {
  phase: CallPhase
  callId: string | null
  conversationId: string | null
  /** Who is on the other end, as the server named them (never a phone number). */
  peerLabel: string
  isGroup: boolean
  /**
   * Who placed the call, as THIS client saw it happen: `start` is outgoing, a
   * `call.incoming` is incoming. Presentation only -- it picks the words for an
   * outcome the server already named ("No answer" vs "Missed call").
   */
  direction: 'outgoing' | 'incoming' | null
  /** From `call.ended` only. Null until the server says. */
  outcome: string | null
  durationSeconds: number | null
  failure: CallFailure | null
  /** The server's refusal, for its localized message. */
  error: ApiError | null
  microphoneMuted: boolean
  remoteAudio: boolean
  audioBlocked: boolean
  /** When audio first went live, for the on-screen clock only. */
  liveSince: number | null
}

export const IDLE_CALL: CallState = {
  phase: 'idle',
  callId: null,
  conversationId: null,
  peerLabel: '',
  isGroup: false,
  direction: null,
  outcome: null,
  durationSeconds: null,
  failure: null,
  error: null,
  microphoneMuted: false,
  remoteAudio: false,
  audioBlocked: false,
  liveSince: null,
}

const TERMINAL: ReadonlySet<CallPhase> = new Set(['ended'])
const IN_MEDIA: ReadonlySet<CallPhase> = new Set(['connecting', 'live', 'reconnecting'])

/** Server codes that mean "this call is already over", not "you may not". */
const ALREADY_OVER = new Set(['COMM.CALL_ALREADY_ENDED', 'COMM.CALL_PARTICIPANT_LEFT'])

export type CallApi = Pick<typeof CallApiImpl, 'start' | 'token' | 'accept' | 'decline' | 'end'>

/** The server's call events this controller consumes (actor-room routed). */
export type CallServerEvent =
  | { event: 'call.incoming'; payload: { callId: string; conversationId: string; type: string; initiatorName: string } }
  | { event: 'call.accepted'; payload: { callId: string } }
  | { event: 'call.declined'; payload: { callId: string } }
  | { event: 'call.ended'; payload: { callId: string; outcome: string; durationSeconds: number | null } }

export function classify(error: unknown): { failure: CallFailure; error: ApiError | null } {
  if (error instanceof ApiError) {
    if (ALREADY_OVER.has(error.code) || error.status === 409) return { failure: 'alreadyOver', error }
    if (error.status === 403 || error.status === 404) return { failure: 'notAllowed', error }
    if (error.status === 0) return { failure: 'network', error }
    return { failure: 'unknown', error }
  }
  return { failure: 'network', error: null }
}

export class CallController {
  private state: CallState = IDLE_CALL
  private readonly listeners = new Set<() => void>()
  private media: CallMedia | null = null
  private unsubscribeMedia: (() => void) | null = null
  /** True while WE take the media down, so its `disconnected` is not a drop. */
  private leavingMedia = false
  /** One media retry per call, then stop: no reconnect storm, no false hope. */
  private mediaRetryUsed = false
  private rejoining = false
  private alive = true

  constructor(
    private readonly api: CallApi,
    private readonly createMedia: CallMediaFactory,
    private readonly now: () => number = () => Date.now(),
  ) {}

  // ------------------------------------------------------------ store

  getSnapshot = (): CallState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(next: CallState) {
    this.state = next
    for (const l of this.listeners) l()
  }

  private patch(p: Partial<CallState>) {
    this.set({ ...this.state, ...p })
  }

  /** The phase NOW -- read through a call so a check after an await sees the live value. */
  private phaseNow(): CallPhase {
    return this.state.phase
  }

  get isPresent(): boolean {
    return this.state.phase !== 'idle'
  }

  /** Only a record of a call remains: ended, or a start the server never took. */
  private isOver(): boolean {
    return this.state.phase === 'ended' || (this.state.phase === 'failed' && !this.state.callId)
  }

  // ------------------------------------------------------------ outgoing

  /**
   * Ring the other members of a conversation. The capability that drew the
   * button is advisory and may be stale, so a refusal here is normal and shown
   * as notAllowed -- never retried automatically.
   */
  async start(args: { conversationId: string; peerLabel: string; isGroup: boolean }): Promise<void> {
    if (this.isPresent) return
    this.mediaRetryUsed = false
    this.rejoining = false
    this.set({
      ...IDLE_CALL,
      phase: 'starting',
      direction: 'outgoing',
      conversationId: args.conversationId,
      peerLabel: args.peerLabel,
      isGroup: args.isGroup,
    })
    try {
      const started = await this.api.start(args.conversationId)
      if (!this.alive || this.phaseNow() !== 'starting') return
      // `roomName` is deliberately dropped: the room is signed into the token.
      this.patch({ phase: 'outgoingRinging', callId: started.callId })
    } catch (e) {
      if (!this.alive) return
      this.patch({ phase: 'failed', ...classify(e) })
    }
  }

  // ------------------------------------------------------------ incoming

  async accept(): Promise<void> {
    const callId = this.state.callId
    if (!callId || this.state.phase !== 'incomingRinging') return
    this.patch({ phase: 'connecting', failure: null, error: null })
    try {
      await this.api.accept(callId)
    } catch (e) {
      if (!this.alive) return
      this.patch({ phase: 'failed', ...classify(e) })
      return
    }
    if (!this.alive || this.phaseNow() !== 'connecting') return
    await this.joinMedia(callId)
  }

  /** A 200 is the server telling us the call is over (W6: decline is terminal). */
  async decline(): Promise<void> {
    const callId = this.state.callId
    if (!callId || this.state.phase !== 'incomingRinging') return
    try {
      await this.api.decline(callId)
      if (!this.alive) return
      this.goTerminal({ outcome: 'declined' })
    } catch (e) {
      if (!this.alive) return
      const c = classify(e)
      if (c.failure === 'alreadyOver') return this.goTerminal({ outcome: null })
      this.patch({ phase: 'failed', ...c })
    }
  }

  // ------------------------------------------------------------ in call

  /**
   * Hang up. Ending is cleanup: a failure to reach the server must not strand
   * the admin in a screen they cannot leave. The outcome stays null until
   * `call.ended` says which.
   */
  async hangUp(): Promise<void> {
    const callId = this.state.callId
    if (!callId || TERMINAL.has(this.state.phase)) return
    try {
      await this.api.end(callId)
    } catch (e) {
      if (!this.alive) return
      const c = classify(e)
      if (c.failure !== 'alreadyOver') {
        this.patch({ phase: 'failed', ...c })
        return
      }
    }
    if (!this.alive) return
    this.goTerminal({ outcome: null })
  }

  async toggleMute(): Promise<void> {
    if (!this.media || !IN_MEDIA.has(this.state.phase)) return
    await this.media.setMicrophoneMuted(!this.state.microphoneMuted)
  }

  /** After the browser blocked autoplay: must be called from a click. */
  async startAudio(): Promise<void> {
    await this.media?.startAudio()
  }

  /** Leave a terminal or failed screen. Never sends anything to the server. */
  dismiss(): void {
    if (this.state.phase !== 'ended' && this.state.phase !== 'failed') return
    void this.teardownMedia()
    this.set(IDLE_CALL)
  }

  /**
   * Try again after a failed START: a NEW call in the same conversation. A
   * failed call is never resumed -- the call it belonged to may be long gone.
   */
  async retry(): Promise<void> {
    const { phase, callId, conversationId, peerLabel, isGroup } = this.state
    if (phase !== 'failed' || callId || !conversationId) return
    await this.teardownMedia()
    this.set(IDLE_CALL)
    await this.start({ conversationId, peerLabel, isGroup })
  }

  /**
   * "Call again" after a call that is over: a NEW call in the same conversation,
   * authorized by the server like any other. Only from `ended` -- a failed call
   * may still exist on the server, and that one is hung up, not replaced.
   */
  async callAgain(): Promise<void> {
    const { phase, conversationId, peerLabel, isGroup } = this.state
    if (phase !== 'ended' || !conversationId) return
    await this.teardownMedia()
    this.set(IDLE_CALL)
    await this.start({ conversationId, peerLabel, isGroup })
  }

  // ------------------------------------------------------------ server events

  onServerEvent(e: CallServerEvent): void {
    if (!this.alive) return
    switch (e.event) {
      case 'call.incoming': {
        // One call at a time. A second call arriving during a call is not
        // presented; the server records it as missed when it times out
        // (call.md §7). But a FINISHED call is not a call: a screen that only
        // says how the last one ended gives way to the new ring, instead of
        // silently swallowing it. Anything that may still exist on the server
        // (a failure with a callId included) is never interrupted.
        if (this.isPresent && !this.isOver()) return
        if (this.isPresent) void this.teardownMedia()
        this.mediaRetryUsed = false
        this.rejoining = false
        this.set({
          ...IDLE_CALL,
          phase: 'incomingRinging',
          direction: 'incoming',
          callId: e.payload.callId,
          conversationId: e.payload.conversationId,
          peerLabel: e.payload.initiatorName,
          isGroup: e.payload.type === 'group',
        })
        return
      }
      case 'call.accepted': {
        if (e.payload.callId !== this.state.callId) return
        // The caller's cue to join media: identified by phase, not by comparing
        // ids. The answering tab already joined in accept().
        if (this.state.phase === 'outgoingRinging') {
          this.patch({ phase: 'connecting' })
          void this.joinMedia(e.payload.callId)
          return
        }
        // Still ringing here means ANOTHER of this account's tabs or devices
        // answered. The call is ACTIVE, so no `call.ended` is coming: stop ringing.
        if (this.state.phase === 'incomingRinging') {
          this.goTerminal({ outcome: 'answered', authoritative: true })
        }
        return
      }
      case 'call.declined': {
        if (e.payload.callId !== this.state.callId) return
        this.goTerminal({ outcome: 'declined' })
        return
      }
      case 'call.ended': {
        if (e.payload.callId !== this.state.callId) return
        // The authority on the outcome, even for a state it did not create.
        this.goTerminal({ outcome: e.payload.outcome, durationSeconds: e.payload.durationSeconds, authoritative: true })
        return
      }
    }
  }

  // ------------------------------------------------------------ terminal

  private goTerminal(args: { outcome: string | null; durationSeconds?: number | null; authoritative?: boolean }) {
    if (this.state.phase === 'ended') {
      // Already terminal: no second teardown. An authoritative event may still
      // fill in what the server knows and we did not.
      if (args.authoritative) this.patch({ outcome: args.outcome, durationSeconds: args.durationSeconds ?? null })
      return
    }
    this.patch({
      phase: 'ended',
      outcome: args.outcome,
      durationSeconds: args.durationSeconds ?? null,
      failure: null,
      error: null,
    })
    void this.teardownMedia()
  }

  // ------------------------------------------------------------ media

  private async joinMedia(callId: string): Promise<void> {
    if (this.media) return
    const media = this.createMedia()
    this.media = media
    this.leavingMedia = false
    this.unsubscribeMedia = media.subscribe((s) => this.onMedia(s))
    await this.connectMedia(callId)
  }

  /** A fresh, server-issued token for every (re)join: a call is not a standing grant. */
  private async connectMedia(callId: string): Promise<void> {
    const media = this.media
    if (!media) return
    let token
    try {
      token = await this.api.token(callId)
    } catch (e) {
      if (!this.alive || this.media !== media) return
      const c = classify(e)
      if (c.failure === 'alreadyOver') return this.goTerminal({ outcome: null })
      this.patch({ phase: 'failed', ...c })
      return
    }
    if (!this.alive || this.media !== media || TERMINAL.has(this.phaseNow())) return
    await media.connect(token.url, token.token)
  }

  private onMedia(s: CallMediaSnapshot): void {
    if (!this.alive || TERMINAL.has(this.state.phase) || s.phase === 'idle') return
    const next: Partial<CallState> = {
      microphoneMuted: s.microphoneMuted,
      remoteAudio: s.remoteAudio,
      audioBlocked: s.audioBlocked,
    }
    switch (s.phase) {
      case 'connecting':
        next.phase = this.rejoining ? 'reconnecting' : 'connecting'
        break
      case 'live':
        this.rejoining = false
        next.phase = 'live'
        next.failure = null
        next.liveSince = this.state.liveSince ?? this.now()
        break
      case 'failed':
        next.phase = 'failed'
        next.failure = s.failure ?? 'unknown'
        break
      case 'disconnected': {
        if (this.leavingMedia) return
        // A DROP IS NOT AN ENDING. Retry once, with a fresh token.
        const callId = this.state.callId
        if (!this.mediaRetryUsed && callId) {
          this.mediaRetryUsed = true
          this.rejoining = true
          this.patch({ ...next, phase: 'reconnecting' })
          void this.connectMedia(callId)
          return
        }
        next.phase = 'reconnecting'
        next.failure = 'network'
        break
      }
    }
    this.patch(next)
  }

  private async teardownMedia(): Promise<void> {
    const media = this.media
    if (!media) return
    this.leavingMedia = true
    this.media = null
    this.unsubscribeMedia?.()
    this.unsubscribeMedia = null
    await media.disconnect()
  }

  /** The session ended (sign-out, user switch): no call outlives its principal. */
  dispose(): void {
    this.alive = false
    void this.teardownMedia()
    this.listeners.clear()
    this.state = IDLE_CALL
  }
}
