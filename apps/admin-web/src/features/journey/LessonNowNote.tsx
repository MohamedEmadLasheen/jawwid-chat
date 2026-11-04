import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, whenIn, type TimeLocale } from '@/core/time/academyTime'
import { journeyApi, journeyKeys, type LessonNow } from './api'
import './journey.css'

/**
 * CHATSCHED-002 (PD-46 §3.4, owner Q2): a lesson card is history and is never
 * rewritten -- but a card that announced a time says, under it, where its
 * lesson stands now, once that is no longer what the card says. Nothing while
 * the card is still right, and nothing on a failed read.
 */
export const TIMED_CARD_KINDS: ReadonlySet<string> = new Set(['lesson_scheduled', 'lesson_moved', 'lesson_makeup_booked'])

const COPY = {
  now: { en: 'Now: {when}', ar: 'الآن: {when}' },
  held: { en: 'Held: {when}', ar: 'عُقدت: {when}' },
  cancelled: { en: 'This lesson was cancelled', ar: 'أُلغيت هذه الحصة' },
  missed: { en: 'This lesson did not take place', ar: 'لم تُعقد هذه الحصة' },
}

/** One read per conversation, shared by every card of it (the same query key). */
export function useLessonNow(conversationId: string, enabled: boolean) {
  return useQuery({
    queryKey: journeyKeys.lessonNow(conversationId),
    queryFn: () => journeyApi.lessonNow(conversationId),
    enabled,
    staleTime: 15_000,
  })
}

/** What an old time card says about its lesson now, or null while it is still right. */
export function lessonNowText(now: LessonNow | undefined, shownStartsAt: string | null, locale: TimeLocale): string | null {
  if (!now) return null
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  if (now.status === 'cancelled') return tx(COPY.cancelled)
  if (now.status === 'missed') return tx(COPY.missed)
  if (shownStartsAt && new Date(shownStartsAt).getTime() === new Date(now.startsAt).getTime()) return null
  return tx(now.status === 'held' ? COPY.held : COPY.now).replace('{when}', whenIn(now.startsAt, ACADEMY_ZONE, locale))
}

export function LessonNowNote({ conversationId, lessonId, shownStartsAt }: { conversationId: string; lessonId: string; shownStartsAt: string | null }) {
  const { locale } = useI18n()
  const now = useLessonNow(conversationId, true)
  const text = lessonNowText(now.data?.lessons.find((l) => l.lessonId === lessonId), shownStartsAt, locale)
  if (!text) return null
  return (
    <div className="jr-now" data-testid="lesson-now" dir="auto">
      {text}
    </div>
  )
}
