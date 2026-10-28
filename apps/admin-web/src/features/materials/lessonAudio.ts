import { useEffect, type RefObject } from 'react'
import { api } from '@/core/api/client'

/**
 * PD-29: hand a framed Quran lesson its recitation (apps/lessons/src/audio/
 * audio-manifest.ts). The lesson never calls the API; this page, signed in,
 * asks GET /quran/ayahs, where the server's release gate decides whether THIS
 * account gets audio at all, and posts the answer to the lesson's own origin as
 * DATA: `{ type, surah, ayahs: [{ ayah, audio }] }`, only the ayat that have
 * audio, never their text, never a credential. When the gate gives no audio,
 * nothing is posted. The lesson checks every key and file hash itself.
 */
export const AUDIO_MESSAGE = 'jawwid:quran-audio'
export const READY_MESSAGE = 'jawwid:lesson-ready'
const PER_REQUEST = 50

interface AyahAudio {
  reciter: string
  key: string
  url: string
  sha256: string
}
interface AyahsAnswer {
  surah: { ayahCount: number }
  ayahs: Array<{ ayah: number; audio: AyahAudio | null }>
}
export interface LessonAudioMessage {
  type: typeof AUDIO_MESSAGE
  surah: number
  ayahs: Array<{ ayah: number; audio: AyahAudio }>
}

/** The surah of a lessons-site Quran page (`…/lessons/quran/surah-N`), with its origin; null for anything else. */
export function lessonSurah(url: string): { origin: string; surah: number } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const m = /^\/lessons\/quran\/surah-(\d{1,3})\/?$/.exec(u.pathname)
  const surah = m ? Number(m[1]) : 0
  if (!m || surah < 1 || surah > 114 || String(surah) !== m[1] || (u.protocol !== 'https:' && u.protocol !== 'http:')) return null
  return { origin: u.origin, surah }
}

export async function lessonAudioMessage(surah: number): Promise<LessonAudioMessage | null> {
  const ayahs: LessonAudioMessage['ayahs'] = []
  let from = 1
  let count = Infinity
  while (from <= count) {
    const to = Number.isFinite(count) ? Math.min(count, from + PER_REQUEST - 1) : undefined
    const answer = await api.get<AyahsAnswer>('/quran/ayahs', { surah, from, to })
    count = answer.surah.ayahCount
    for (const a of answer.ayahs) if (a.audio) ayahs.push({ ayah: a.ayah, audio: { reciter: a.audio.reciter, key: a.audio.key, url: a.audio.url, sha256: a.audio.sha256 } })
    const last = answer.ayahs[answer.ayahs.length - 1]?.ayah
    if (!last) break
    from = last + 1
  }
  return ayahs.length ? { type: AUDIO_MESSAGE, surah, ayahs } : null
}

/**
 * For a framed lesson: fetch its audio list once, then post it when the frame
 * loads and whenever the lesson says it is ready -- only to the frame's own
 * window and the lesson's exact origin.
 */
export function useLessonAudio(frame: RefObject<HTMLIFrameElement | null>, url: string, enabled: boolean): void {
  useEffect(() => {
    const lesson = enabled ? lessonSurah(url) : null
    const el = frame.current
    if (!lesson || !el) return
    let message: LessonAudioMessage | null = null
    let live = true
    const post = () => {
      if (message) el.contentWindow?.postMessage(message, lesson.origin)
    }
    const onReady = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; surah?: unknown } | null
      if (e.origin === lesson.origin && e.source === el.contentWindow && d?.type === READY_MESSAGE && d.surah === lesson.surah) post()
    }
    el.addEventListener('load', post)
    window.addEventListener('message', onReady)
    lessonAudioMessage(lesson.surah).then(
      (m) => {
        if (!live) return
        message = m
        post()
      },
      () => undefined, // no audio for this account, or the Quran routes are refusing: the lesson plays without it
    )
    return () => {
      live = false
      el.removeEventListener('load', post)
      window.removeEventListener('message', onReady)
    }
  }, [frame, url, enabled])
}
