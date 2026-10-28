import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/shared/components/Icon'
import { clock } from './clock'
import { useText } from '@/features/admin/copy'
import { S } from './copy'

/** Five minutes is a long voice story; past it, recording stops on its own. */
const MAX_MS = 5 * 60 * 1000

/**
 * The one recording format every reader's phone plays.
 *
 * MediaRecorder's default in Chrome is WebM/Opus, which iOS cannot decode, so
 * a story recorded that way would be silent for every iPhone. MP4/AAC plays on
 * both platforms; when the browser cannot record it, recording is not offered
 * at all and the publisher uploads a file instead.
 */
export function supportedRecordingType(): string | null {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return null
  for (const type of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4']) {
    try {
      if (window.MediaRecorder.isTypeSupported(type)) return type
    } catch {
      // isTypeSupported throws on some engines for unknown strings.
    }
  }
  return null
}

export function VoiceRecorder({
  onRecorded,
  disabled,
}: {
  onRecorded: (file: Blob, durationMs: number) => void
  disabled?: boolean
}) {
  const tx = useText()
  const [state, setState] = useState<'idle' | 'recording'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const startedAt = useRef(0)
  const timer = useRef<number | null>(null)
  const type = supportedRecordingType()

  const cleanUp = () => {
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }
  useEffect(() => cleanUp, [])

  if (!type) {
    return <p className="field__hint">{tx(S.recordingUnsupported)}</p>
  }

  async function start() {
    setError(null)
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError(tx(S.micDenied))
      return
    }
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream.current, { mimeType: type! })
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
    rec.onstop = () => {
      const duration = Date.now() - startedAt.current
      cleanUp()
      setState('idle')
      setElapsed(0)
      onRecorded(new Blob(chunks, { type: 'audio/mp4' }), duration)
    }
    recorder.current = rec
    startedAt.current = Date.now()
    rec.start()
    setState('recording')
    timer.current = window.setInterval(() => {
      const ms = Date.now() - startedAt.current
      setElapsed(ms)
      if (ms >= MAX_MS) recorder.current?.stop()
    }, 250)
  }

  return (
    <div className="voice-recorder">
      {state === 'idle' ? (
        <button type="button" className="btn voice-recorder__start" onClick={() => void start()} disabled={disabled}>
          <Icon name="mic" size={18} />
          {tx(S.record)}
        </button>
      ) : (
        <div className="voice-recorder__live" role="status">
          <span className="voice-recorder__dot" aria-hidden="true" />
          <span>{tx(S.recording)}</span>
          <span className="voice-recorder__time" dir="ltr">{clock(elapsed / 1000)}</span>
          <button type="button" className="btn btn--sm" onClick={() => recorder.current?.stop()}>
            <Icon name="stop" size={14} />
            {tx(S.stopRecording)}
          </button>
        </div>
      )}
      {error && <p className="field__error" role="alert">{error}</p>}
    </div>
  )
}
