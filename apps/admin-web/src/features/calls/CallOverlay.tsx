import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { useCall } from './CallProvider'
import { callCopyFor, type CallCopy } from './copy'
import type { CallState } from './callController'
import './calls.css'

/**
 * THE CALL WINDOW: a dark, movable window over the portal, like a desktop
 * messenger's call window, so the chat stays usable during a call. Mounted once
 * inside the router, so an incoming call rings on every page.
 *
 * It renders the controller's state and nothing else. It decides no outcome,
 * runs no timer that ends anything, and authorizes nothing: "Call again" asks
 * the server for a NEW call exactly as the header button does.
 *
 * `docs/design/screens/call.md` §6 holds here as on the phone: Hang up is the
 * largest control and never sits next to Mute; the clock is an LTR run.
 */

/** On-screen clock while live. Presentation only: it ends nothing. */
function Clock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  return <span dir="ltr" className="call-window__clock">{clock(seconds)}</span>
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** The words for an outcome the SERVER named, from this side of the call. */
export function endedText(state: CallState, copy: CallCopy): string {
  if (state.outcome === 'missed') return state.direction === 'incoming' ? copy.missedIncoming : copy.noAnswer
  if (state.outcome === 'declined') return copy.outcome.declined ?? copy.endedNoOutcome
  if (state.outcome) return copy.outcome[state.outcome] ?? copy.endedNoOutcome
  return copy.endedNoOutcome
}

function statusText(state: CallState, copy: CallCopy): string {
  switch (state.phase) {
    case 'starting':
      return copy.starting
    case 'outgoingRinging':
      return copy.calling
    case 'incomingRinging':
      return state.isGroup ? copy.incomingGroupStatus : copy.incomingStatus
    case 'connecting':
      return copy.connecting
    case 'reconnecting':
      return copy.reconnecting
    case 'live':
      return state.remoteAudio ? copy.live : copy.waitingForAudio
    case 'ended':
      return endedText(state, copy)
    default:
      return ''
  }
}

/** Drag by the title bar; the window stays fully on screen. */
function useDrag() {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const ref = useRef<HTMLElement | null>(null)
  const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  const clampTo = useCallback((x: number, y: number) => {
    const el = ref.current
    if (!el) return { x, y }
    const r = el.getBoundingClientRect()
    // Where the window would sit with no offset, then keep it inside the viewport.
    const left0 = r.left - offset.x
    const top0 = r.top - offset.y
    const minX = -left0
    const maxX = window.innerWidth - r.width - left0
    const minY = -top0
    const maxY = window.innerHeight - r.height - top0
    return { x: Math.min(Math.max(x, minX), Math.max(minX, maxX)), y: Math.min(Math.max(y, minY), Math.max(minY, maxY)) }
  }, [offset])

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    setOffset(clampTo(d.baseX + e.clientX - d.startX, d.baseY + e.clientY - d.startY))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  useEffect(() => {
    const onResize = () => setOffset((o) => clampTo(o.x, o.y))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampTo])

  return {
    ref,
    style: { transform: `translate(${offset.x}px, ${offset.y}px)` },
    handle: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  }
}

function RoundButton({
  label,
  tone = 'neutral',
  size = 'md',
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string
  tone?: 'neutral' | 'danger' | 'accept'
  size?: 'md' | 'lg'
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div className="call-window__action">
      <button
        type="button"
        className={`call-window__round call-window__round--${tone} call-window__round--${size}`}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
      <span className="call-window__action-label" aria-hidden="true">
        {label}
      </span>
    </div>
  )
}

export function CallOverlay() {
  const { state, controller } = useCall()
  const { locale } = useI18n()
  const copy = callCopyFor(locale)
  const navigate = useNavigate()
  const { ref, style, handle } = useDrag()

  if (!controller || state.phase === 'idle') return null

  const conversationPath = state.conversationId ? `/chat/${encodeURIComponent(state.conversationId)}` : null
  const inCall = state.phase === 'connecting' || state.phase === 'live' || state.phase === 'reconnecting'
  const incoming = state.phase === 'incomingRinging'
  const status = statusText(state, copy)

  const openChat = () => {
    if (conversationPath) navigate(conversationPath)
  }
  const recordVoice = () => {
    if (!conversationPath) return
    controller.dismiss()
    navigate(`${conversationPath}?voice=1`)
  }

  const failure =
    state.phase === 'failed'
      ? state.failure === 'microphone'
        ? copy.failure.microphone
        : state.error
          ? state.error.localized(locale as 'ar' | 'en')
          : copy.failure[state.failure ?? 'unknown']
      : null

  const title = incoming
    ? state.isGroup
      ? copy.incomingGroup(state.peerLabel)
      : copy.incoming(state.peerLabel)
    : copy.regionLabel

  return (
    <section
      ref={ref}
      className={`call-window${incoming ? ' call-window--incoming' : ''}`}
      style={style}
      role={incoming ? 'alertdialog' : 'region'}
      aria-label={title}
      aria-live={incoming ? 'assertive' : undefined}
    >
      <header className="call-window__bar" {...handle} title={copy.moveWindow}>
        <span className="call-window__bar-title">
          <LockIcon /> {copy.windowTitle}
        </span>
      </header>

      <div className="call-window__identity">
        <span className="call-window__avatar">
          <Avatar name={state.peerLabel || '?'} seed={state.conversationId ?? undefined} size="lg" />
        </span>
        <p className="call-window__name">{state.peerLabel}</p>
        {state.isGroup && !incoming && <p className="call-window__sub">{copy.groupCall}</p>}
        <p className="call-window__status">
          {/* Announced on change; the ticking clock is NOT inside the live region. */}
          <span aria-live="polite" className={state.phase === 'live' && state.remoteAudio ? 'sr-only' : undefined}>
            {status}
          </span>
          {state.phase === 'live' && state.liveSince !== null && <Clock since={state.liveSince} />}
          {state.phase === 'ended' && state.durationSeconds !== null && state.durationSeconds > 0 && (
            <>
              {status ? ' · ' : ''}
              <span dir="ltr">{copy.duration(state.durationSeconds)}</span>
            </>
          )}
        </p>
        {failure && (
          <p className="call-window__alert" role="alert">
            {failure}
          </p>
        )}
        {state.phase === 'reconnecting' && state.failure === 'network' && (
          <p className="call-window__alert" role="alert">
            {copy.failure.network}
          </p>
        )}
      </div>

      {state.audioBlocked && inCall && (
        <button type="button" className="btn btn--primary call-window__unblock" onClick={() => void controller.startAudio()}>
          {copy.enableAudio}
        </button>
      )}

      <div className="call-window__controls">
        {incoming && (
          <>
            <RoundButton label={copy.decline} tone="danger" size="lg" onClick={() => void controller.decline()}>
              <HangUpIcon />
            </RoundButton>
            <RoundButton label={copy.answer} tone="accept" size="lg" onClick={() => void controller.accept()}>
              <PhoneIcon />
            </RoundButton>
          </>
        )}

        {(state.phase === 'starting' || state.phase === 'outgoingRinging' || inCall) && (
          <>
            <div className="call-window__secondary">
              <RoundButton
                label={state.microphoneMuted ? copy.unmute : copy.mute}
                pressed={state.microphoneMuted}
                disabled={!inCall}
                onClick={() => void controller.toggleMute()}
              >
                {state.microphoneMuted ? <MicOffIcon /> : <MicIcon />}
              </RoundButton>
              {conversationPath && (
                <RoundButton label={copy.message} onClick={openChat}>
                  <ChatIcon />
                </RoundButton>
              )}
            </div>
            {/* On its own, and the biggest: never beside Mute (call.md §6). */}
            <RoundButton
              label={state.phase === 'outgoingRinging' || state.phase === 'starting' ? copy.cancel : copy.hangUp}
              tone="danger"
              size="lg"
              disabled={state.phase === 'starting'}
              onClick={() => void controller.hangUp()}
            >
              <HangUpIcon />
            </RoundButton>
          </>
        )}

        {state.phase === 'ended' && (
          <>
            <RoundButton label={copy.close} onClick={() => controller.dismiss()}>
              <CloseIcon />
            </RoundButton>
            {conversationPath && (
              <RoundButton label={copy.recordVoice} onClick={recordVoice}>
                <MicIcon />
              </RoundButton>
            )}
            {conversationPath && (
              <RoundButton label={copy.callAgain} tone="accept" onClick={() => void controller.callAgain()}>
                <PhoneIcon />
              </RoundButton>
            )}
          </>
        )}

        {state.phase === 'failed' && (
          <>
            <RoundButton label={copy.close} onClick={() => controller.dismiss()}>
              <CloseIcon />
            </RoundButton>
            {conversationPath && (
              <RoundButton label={copy.message} onClick={openChat}>
                <ChatIcon />
              </RoundButton>
            )}
            {/* A call that exists on the server is hung up, never replaced. */}
            {state.callId ? (
              <RoundButton label={copy.hangUp} tone="danger" size="lg" onClick={() => void controller.hangUp()}>
                <HangUpIcon />
              </RoundButton>
            ) : (
              state.conversationId && (
                <RoundButton label={copy.retry} tone="accept" onClick={() => void controller.retry()}>
                  <PhoneIcon />
                </RoundButton>
              )
            )}
          </>
        )}
      </div>
    </section>
  )
}

// Glyphs: inline, currentColor, never mirrored (a phone and a microphone are
// physical objects -- cross-platform.md §4).
const svg = (d: ReactNode) => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
    {d}
  </svg>
)
const PhoneIcon = () =>
  svg(<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1l-2.22 2.23Z" />)
const HangUpIcon = () =>
  svg(<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1a1 1 0 0 1-.56.9 11.5 11.5 0 0 0-2.66 1.85 1 1 0 0 1-1.41 0L.29 13.1a1 1 0 0 1 0-1.41A16.9 16.9 0 0 1 12 7c4.5 0 8.6 1.75 11.71 4.69a1 1 0 0 1 0 1.41l-2.48 2.48a1 1 0 0 1-1.41 0 11.3 11.3 0 0 0-2.66-1.85 1 1 0 0 1-.56-.9v-3.1A15 15 0 0 0 12 9Z" />)
const MicIcon = () =>
  svg(<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />)
const MicOffIcon = () =>
  svg(<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23A6.9 6.9 0 0 0 19 11Zm-4 .16V5a3 3 0 0 0-5.9-.78L15 10.1v1.06ZM4.27 3 3 4.27l6 6V11a3 3 0 0 0 4.38 2.66l1.66 1.66A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.92V21h2v-3.08a6.9 6.9 0 0 0 3.32-1.33L19.73 20 21 18.73 4.27 3Z" />)
const ChatIcon = () => svg(<path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />)
const CloseIcon = () =>
  svg(<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z" />)
const LockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
    <path d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2ZM9 6a3 3 0 0 1 6 0v2H9V6Z" />
  </svg>
)
