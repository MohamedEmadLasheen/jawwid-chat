import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '@/shared/components/Icon'
import { clock } from '@/features/family/VoiceMessage'
import { useText } from '@/features/admin/copy'
import { CTA_DEFAULT_TEXT, S } from './copy'
import type { CtaKind, StoryKind } from './api'

export interface PreviewModel {
  kind: StoryKind
  body: string | null
  background: string | null
  /** A blob: URL while composing, the signed URL afterwards. */
  mediaUrl: string | null
  mediaDurationMs: number | null
  cta: { kind: CtaKind; label: string | null } | null
}

const CTA_ICON: Record<CtaKind, IconName> = {
  whatsapp: 'whatsapp',
  message_publisher: 'messages',
  link: 'link',
}

/**
 * What a reader's phone shows, drawn the way the app draws it: full-bleed
 * content, one progress segment, and the button at the bottom. Never a caption
 * -- the app shows none, so neither does the preview.
 *
 * `size="thumb"` is the list's miniature: no controls, no motion.
 */
export function StoryPreview({ story, size = 'full' }: { story: PreviewModel; size?: 'full' | 'thumb' }) {
  const tx = useText()
  const thumb = size === 'thumb'
  const bg = story.background ?? 'teal'
  const hasContent =
    (story.kind === 'text' && Boolean(story.body?.trim())) || (story.kind !== 'text' && Boolean(story.mediaUrl))
  const tPlay = tx(S.play)
  const tPause = tx(S.pause)

  return (
    <div
      className={`story-phone story-phone--${size} story-bg--${story.kind === 'text' || story.kind === 'voice' ? bg : 'media'}`}
      aria-label={thumb ? undefined : tx(S.preview)}
      role={thumb ? undefined : 'img'}
    >
      {!thumb && (
        <div className="story-phone__progress" aria-hidden="true">
          <span />
        </div>
      )}

      <div className="story-phone__content">
        {!hasContent && !thumb && <span className="story-phone__empty">{tx(S.previewEmpty)}</span>}

        {story.kind === 'text' && story.body?.trim() && (
          <p className={`story-phone__text ${textSizeClass(story.body)}`} dir="auto">
            {story.body}
          </p>
        )}

        {story.kind === 'image' && story.mediaUrl && (
          <img className="story-phone__media" src={story.mediaUrl} alt="" />
        )}

        {story.kind === 'video' && thumb && (
          <span className="story-phone__glyph"><Icon name="video" size={20} /></span>
        )}
        {story.kind === 'video' && !thumb && story.mediaUrl && (
          <video className="story-phone__media" src={story.mediaUrl} muted loop playsInline autoPlay controls={false} />
        )}

        {story.kind === 'voice' && (
          thumb ? (
            <span className="story-phone__glyph"><Icon name="mic" size={20} /></span>
          ) : (
            <VoiceFace url={story.mediaUrl} durationMs={story.mediaDurationMs} labels={[tPlay, tPause]} />
          )
        )}
      </div>

      {story.cta && !thumb && (
        <div className="story-phone__cta">
          <span className={`story-cta story-cta--${story.cta.kind}`}>
            <Icon name={CTA_ICON[story.cta.kind]} size={16} />
            <span dir="auto">{story.cta.label?.trim() || tx(CTA_DEFAULT_TEXT[story.cta.kind])}</span>
          </span>
        </div>
      )}
    </div>
  )
}

/** Long words get a smaller face, the way the app sizes them. */
function textSizeClass(body: string): string {
  const n = body.trim().length
  if (n <= 40) return 'story-phone__text--xl'
  if (n <= 120) return 'story-phone__text--lg'
  if (n <= 300) return 'story-phone__text--md'
  return 'story-phone__text--sm'
}

/** A voice story: a big play button over moving bars, and its length. */
function VoiceFace({
  url,
  durationMs,
  labels,
}: {
  url: string | null
  durationMs: number | null
  labels: [play: string, pause: string]
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)

  useEffect(() => {
    setPlaying(false)
    setPosition(0)
  }, [url])

  const total = durationMs ? durationMs / 1000 : 0
  return (
    <div className="story-voice">
      <button
        type="button"
        className="story-voice__play"
        disabled={!url}
        aria-label={playing ? labels[1] : labels[0]}
        onClick={() => {
          const a = audioRef.current
          if (!a) return
          if (a.paused) void a.play().catch(() => setPlaying(false))
          else a.pause()
        }}
      >
        <Icon name={playing ? 'pause' : 'play'} size={30} />
      </button>
      <div className={`story-voice__bars${playing ? ' is-playing' : ''}`} aria-hidden="true">
        {BARS.map((h, i) => (
          <span key={i} style={{ blockSize: `${h}%`, animationDelay: `${(i % 7) * 90}ms` }} />
        ))}
      </div>
      <span className="story-voice__time" dir="ltr">
        {clock(playing || position > 0 ? position : total)}
      </span>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setPosition(0)
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        />
      )}
    </div>
  )
}

const BARS = [28, 46, 64, 38, 80, 56, 92, 44, 70, 34, 60, 86, 50, 30, 66, 42, 76, 54, 36, 62]
