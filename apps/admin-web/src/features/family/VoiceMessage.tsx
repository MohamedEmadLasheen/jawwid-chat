import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { Attachment } from '@/shared/types/domain'

/** Which attachments this player handles. Anything else stays a file chip. */
export function isVoiceAttachment(attachment: Attachment): boolean {
  return attachment.content_type.startsWith('audio/')
}

/**
 * `m:ss`, or `h:mm:ss` past an hour.
 *
 * Durations are an LTR run in both locales, so this returns a bare string and
 * the element that renders it sets `dir="ltr"` — never concatenated into a
 * sentence, because Arabic word order differs.
 */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const whole = Math.floor(seconds)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const ss = String(s).padStart(2, '0')
  return h === 0 ? `${m}:${ss}` : `${h}:${String(m).padStart(2, '0')}:${ss}`
}

/**
 * A voice note in the family thread.
 *
 * Built on a plain `<audio>` element rather than a decoding library: the
 * browser already streams with range requests, which is what lets playback start
 * on the first chunk instead of downloading the whole note. `preload="metadata"`
 * is the point — a thread with fifty voice notes fetches fifty short headers,
 * not fifty files.
 *
 * The signed URL is short-lived and per-read. It is used as given and never
 * stored, so an expired one is reported rather than retried against a cache.
 */
export function VoiceMessage({ attachment }: { attachment: Attachment }) {
  const { t } = useI18n()
  const audioRef = useRef<HTMLAudioElement>(null)

  const [isPlaying, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => setPosition(audio.currentTime)
    const onLoaded = () => {
      // A stream of unknown length reports Infinity; showing that would be worse
      // than showing nothing.
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => setPlaying(false)
    const onError = () => {
      setFailed(true)
      setPlaying(false)
    }

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('durationchange', onLoaded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('durationchange', onLoaded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    if (!audio.paused) {
      // Pause keeps currentTime, so pressing play again resumes rather than
      // restarting.
      audio.pause()
      return
    }
    // Starting one note stops any other on the page: two voice notes talking
    // over each other is never what the listener wanted.
    for (const other of document.querySelectorAll('audio')) {
      if (other !== audio) other.pause()
    }
    void audio.play().catch(() => setFailed(true))
  }, [])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration)) return
    audio.currentTime = seconds
    setPosition(seconds)
  }, [])

  const total = duration || 0
  const label = isPlaying ? t('voice.pause') : t('voice.play')

  if (failed) {
    return (
      <div className="voice voice--failed" role="alert">
        <span aria-hidden="true">⚠</span>
        <span>{t('voice.failed')}</span>
      </div>
    )
  }

  return (
    <div className="voice" aria-label={t('voice.messageWithDuration', { duration: clock(total) })}>
      {/*
        No `controls`: the browser's default player is not themeable and reads
        very differently between Chrome, Safari and Firefox. The element stays in
        the tree as the media engine; the controls below are ours.
      */}
      <audio ref={audioRef} src={attachment.url} preload="metadata" />

      <button type="button" className="voice__toggle" onClick={toggle} aria-label={label}>
        {/* The glyph is decorative: the state is in the accessible name. */}
        <span aria-hidden="true">{isPlaying ? '❚❚' : '▶'}</span>
      </button>

      <div className="voice__body">
        {/*
          A timeline of physical sound does not mirror in RTL, so the range input
          is forced LTR while the surrounding layout mirrors normally.
        */}
        <input
          type="range"
          className="voice__track"
          dir="ltr"
          min={0}
          max={total || 1}
          step={0.1}
          value={Math.min(position, total || 1)}
          disabled={total === 0}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label={t('voice.seek')}
          aria-valuetext={clock(position)}
        />
        <div className="voice__meta">
          <span aria-hidden="true">🎙</span>
          <span>{t('voice.message')}</span>
          <span className="voice__time" dir="ltr">
            {position > 0 ? `${clock(position)} / ${clock(total)}` : clock(total)}
          </span>
        </div>
      </div>
    </div>
  )
}
