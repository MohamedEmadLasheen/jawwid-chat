import { useEffect, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useCall } from './CallProvider'
import { callCopyFor } from './copy'
import type { CallState } from './callController'
import './calls.css'

/** On-screen clock while live. Presentation only: it ends nothing. */
function Clock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  return (
    <span className="call-panel__clock">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  )
}

function statusLine(state: CallState, copy: ReturnType<typeof callCopyFor>): string {
  switch (state.phase) {
    case 'starting':
      return copy.starting
    case 'outgoingRinging':
      return copy.outgoing(state.peerLabel)
    case 'connecting':
      return copy.connecting
    case 'reconnecting':
      return copy.reconnecting
    case 'live':
      return state.remoteAudio ? copy.live : copy.waitingForAudio
    case 'ended':
      return state.outcome ? copy.outcome[state.outcome] ?? copy.endedNoOutcome : copy.endedNoOutcome
    default:
      return ''
  }
}

/**
 * The call, wherever the admin is in the portal. Mounted once at the app root,
 * so an incoming call rings on every page, not only in the chat workspace.
 */
export function CallOverlay() {
  const { state, controller } = useCall()
  const { locale } = useI18n()
  const copy = callCopyFor(locale)

  if (!controller || state.phase === 'idle') return null

  if (state.phase === 'incomingRinging') {
    const title = state.isGroup ? copy.incomingGroup(state.peerLabel) : copy.incoming(state.peerLabel)
    return (
      <section className="call-panel call-panel--incoming" role="alertdialog" aria-label={title} aria-live="assertive">
        <p className="call-panel__title">{title}</p>
        <div className="call-panel__actions">
          <button type="button" className="btn btn--primary" onClick={() => void controller.accept()}>
            {copy.answer}
          </button>
          <button type="button" className="btn btn--danger" onClick={() => void controller.decline()}>
            {copy.decline}
          </button>
        </div>
      </section>
    )
  }

  if (state.phase === 'failed') {
    const message = state.error ? state.error.localized(locale as 'ar' | 'en') : copy.failure[state.failure ?? 'unknown']
    return (
      <section className="call-panel" role="region" aria-label={copy.regionLabel}>
        {state.peerLabel && <p className="call-panel__title">{state.peerLabel}</p>}
        <p className="call-panel__alert" role="alert">
          {state.failure === 'microphone' ? copy.failure.microphone : message}
        </p>
        <div className="call-panel__actions">
          {/* A call that exists on the server can still be hung up from here. */}
          {state.callId && (
            <button type="button" className="btn btn--danger" onClick={() => void controller.hangUp()}>
              {copy.hangUp}
            </button>
          )}
          {!state.callId && state.conversationId && (
            <button type="button" className="btn btn--primary" onClick={() => void controller.retry()}>
              {copy.retry}
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => controller.dismiss()}>
            {copy.close}
          </button>
        </div>
      </section>
    )
  }

  const inCall = state.phase === 'connecting' || state.phase === 'live' || state.phase === 'reconnecting'

  return (
    <section className="call-panel" role="region" aria-label={copy.regionLabel}>
      <p className="call-panel__title">{state.peerLabel}</p>
      <p className="call-panel__status" aria-live="polite">
        {statusLine(state, copy)}
        {state.phase === 'live' && state.liveSince !== null && (
          <>
            {' · '}
            <Clock since={state.liveSince} />
          </>
        )}
        {state.phase === 'ended' && state.durationSeconds !== null && state.durationSeconds > 0 && (
          <> · {copy.duration(state.durationSeconds)}</>
        )}
      </p>
      {state.phase === 'reconnecting' && state.failure === 'network' && (
        <p className="call-panel__alert" role="alert">
          {copy.failure.network}
        </p>
      )}
      <div className="call-panel__actions">
        {state.audioBlocked && inCall && (
          <button type="button" className="btn btn--primary" onClick={() => void controller.startAudio()}>
            {copy.enableAudio}
          </button>
        )}
        {inCall && (
          <button
            type="button"
            className="btn"
            aria-pressed={state.microphoneMuted}
            onClick={() => void controller.toggleMute()}
          >
            {state.microphoneMuted ? copy.unmute : copy.mute}
          </button>
        )}
        {(inCall || state.phase === 'outgoingRinging') && (
          <button type="button" className="btn btn--danger" onClick={() => void controller.hangUp()}>
            {state.phase === 'outgoingRinging' ? copy.cancel : copy.hangUp}
          </button>
        )}
        {state.phase === 'ended' && (
          <button type="button" className="btn btn--ghost" onClick={() => controller.dismiss()}>
            {copy.close}
          </button>
        )}
      </div>
    </section>
  )
}
