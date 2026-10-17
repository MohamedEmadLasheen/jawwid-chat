import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/core/api/errors'
import { newIdempotencyKey } from '@/core/api/client'
import { MAX_VOICE_MS, pickRecordingType, sendVoiceNote } from './voiceNote'
import type { ChatCopy } from './copy'
import './voice.css'

/**
 * Record -> review -> send for one conversation, the flow the mobile composer
 * has (voice_composer_controller.dart). Nothing is uploaded until the admin
 * presses Send on a recording they have heard back, so a slip costs nothing.
 *
 * The microphone is held only while recording and released the moment the
 * recording stops, is cancelled, or the conversation is left.
 */

type Stage = 'idle' | 'starting' | 'recording' | 'review' | 'sending'

/** What the browser gives us; injectable so tests never touch real devices. */
export interface RecordingDevice {
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>
  createRecorder: (stream: MediaStream, mimeType: string) => MediaRecorder
  isTypeSupported: (type: string) => boolean
}

function browserDevice(): RecordingDevice | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null
  if (typeof MediaRecorder === 'undefined') return null
  return {
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    createRecorder: (stream, mimeType) => new MediaRecorder(stream, { mimeType }),
    isTypeSupported: (t) => MediaRecorder.isTypeSupported(t),
  }
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function VoiceRecorder({
  conversationId,
  visibility,
  copy,
  locale,
  autoStart = false,
  onAutoStarted,
  onSent,
  device = browserDevice(),
  now = () => performance.now(),
}: {
  conversationId: string
  visibility: 'customer' | 'internal'
  copy: ChatCopy
  locale: string
  /** Start recording on mount -- "Record voice message" from the call window. */
  autoStart?: boolean
  onAutoStarted?: () => void
  onSent?: () => void
  device?: RecordingDevice | null
  now?: () => number
}) {
  const [stage, setStage] = useState<Stage>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ blob: Blob; url: string; durationMs: number } | null>(null)

  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const startedAt = useRef(0)
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null)
  const discardOnStop = useRef(false)
  // One send per draft: the key is fixed when the draft is made, so a retry
  // after a lost response returns the original message, never a second one.
  const clientMessageId = useRef<string>('')

  const release = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current)
    ticker.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }, [])

  const clearDraft = useCallback(() => {
    setDraft((d) => {
      if (d) URL.revokeObjectURL(d.url)
      return null
    })
  }, [])

  const stop = useCallback(() => {
    const r = recorder.current
    if (r && r.state !== 'inactive') r.stop()
  }, [])

  const start = useCallback(async () => {
    if (stage !== 'idle') return
    setError(null)
    const type = device ? pickRecordingType(device.isTypeSupported) : null
    if (!device || !type) {
      setError(copy.voiceUnsupported)
      return
    }
    setStage('starting')
    let s: MediaStream
    try {
      s = await device.getUserMedia({ audio: true })
    } catch {
      setStage('idle')
      setError(copy.voiceMicDenied)
      return
    }
    stream.current = s
    const chunks: Blob[] = []
    const r = device.createRecorder(s, type)
    recorder.current = r
    discardOnStop.current = false
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    r.onstop = () => {
      const durationMs = now() - startedAt.current
      release()
      recorder.current = null
      if (discardOnStop.current || chunks.length === 0) {
        setStage('idle')
        return
      }
      const blob = new Blob(chunks, { type: r.mimeType || type })
      clientMessageId.current = newIdempotencyKey()
      setDraft({ blob, url: URL.createObjectURL(blob), durationMs })
      setStage('review')
    }
    startedAt.current = now()
    setElapsed(0)
    r.start(250)
    setStage('recording')
    ticker.current = setInterval(() => {
      const ms = now() - startedAt.current
      setElapsed(ms)
      // The server refuses longer notes; stopping here keeps what was said.
      if (ms >= MAX_VOICE_MS) stop()
    }, 250)
  }, [stage, device, copy, now, release, stop])

  const cancel = useCallback(() => {
    discardOnStop.current = true
    stop()
  }, [stop])

  const send = useCallback(async () => {
    if (!draft || stage !== 'review') return
    setStage('sending')
    setError(null)
    try {
      await sendVoiceNote({
        conversationId,
        blob: draft.blob,
        durationMs: draft.durationMs,
        visibility,
        clientMessageId: clientMessageId.current,
      })
      clearDraft()
      setStage('idle')
      onSent?.()
    } catch (e) {
      setStage('review')
      setError(e instanceof ApiError ? e.localized(locale as 'ar' | 'en') : copy.voiceFailed)
    }
  }, [draft, stage, conversationId, visibility, clearDraft, onSent, locale, copy])

  // "Record voice message" from the call window lands here with autoStart.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!autoStart || autoStarted.current) return
    autoStarted.current = true
    onAutoStarted?.()
    void start()
  }, [autoStart, start, onAutoStarted])

  // Leaving the conversation abandons the recording and frees the microphone.
  useEffect(
    () => () => {
      discardOnStop.current = true
      const r = recorder.current
      if (r && r.state !== 'inactive') r.stop()
      release()
    },
    [release],
  )
  useEffect(
    () => () => {
      if (draft) URL.revokeObjectURL(draft.url)
    },
    [draft],
  )

  return (
    <div className="voice-recorder" data-stage={stage}>
      {(stage === 'idle' || stage === 'starting') && (
        <button
          type="button"
          className="btn voice-recorder__mic"
          aria-label={copy.recordVoice}
          title={copy.recordVoice}
          disabled={stage === 'starting'}
          onClick={() => void start()}
        >
          <MicIcon />
        </button>
      )}

      {stage === 'recording' && (
        <>
          <span className="voice-recorder__live" role="status">
            <span className="voice-recorder__dot" aria-hidden="true" />
            {copy.recording}{' '}
            <span dir="ltr" className="voice-recorder__clock">
              {clock(elapsed)}
            </span>
          </span>
          <button type="button" className="btn btn--ghost" onClick={cancel}>
            {copy.cancelRecording}
          </button>
          <button type="button" className="btn btn--primary" onClick={stop}>
            {copy.stopRecording}
          </button>
        </>
      )}

      {(stage === 'review' || stage === 'sending') && draft && (
        <>
          <audio className="voice-recorder__preview" controls src={draft.url} aria-label={copy.voiceNote} />
          <button
            type="button"
            className="btn btn--ghost"
            disabled={stage === 'sending'}
            onClick={() => {
              clearDraft()
              setStage('idle')
            }}
          >
            {copy.discardVoice}
          </button>
          <button type="button" className="btn btn--primary" disabled={stage === 'sending'} onClick={() => void send()}>
            {stage === 'sending' ? copy.sending : copy.sendVoice}
          </button>
        </>
      )}

      {error && (
        <p className="voice-recorder__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
      />
    </svg>
  )
}

/** A voice note in the thread: the browser's own player, metadata only until played. */
export function VoiceNotePlayer({ url, durationMs, copy }: { url: string | null; durationMs?: number | null; copy: ChatCopy }) {
  if (!url) return <div className="voice-note voice-note--unavailable">{copy.voiceUnavailable}</div>
  return (
    <div className="voice-note">
      <audio controls preload="metadata" src={url} aria-label={copy.voiceNote} />
      {typeof durationMs === 'number' && durationMs > 0 && (
        <span dir="ltr" className="voice-note__length">
          {clock(durationMs)}
        </span>
      )}
    </div>
  )
}
