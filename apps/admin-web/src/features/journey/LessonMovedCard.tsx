import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, whenIn } from '@/core/time/academyTime'
import './journey.css'

/** PD-31: the `lesson_moved` card's payload, reduced to what is drawn; null when it cannot be (then the body is shown). */
export interface LessonMovedPayload {
  lessonId: string
  learnerName: string
  teacherName: string | null
  startsAt: string
  previousStartsAt: string
  durationMinutes: number | null
  movedBy: 'family' | 'teacher' | 'staff' | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

export function readLessonMovedCard(payload: Record<string, unknown> | null | undefined): LessonMovedPayload | null {
  const p = payload ?? {}
  const lessonId = str(p.lessonId)
  const startsAt = str(p.startsAt)
  const previousStartsAt = str(p.previousStartsAt)
  if (!lessonId || !startsAt || !previousStartsAt) return null
  const by = str(p.movedBy)
  return {
    lessonId,
    learnerName: str(p.learnerName) ?? '',
    teacherName: str(p.teacherName),
    startsAt,
    previousStartsAt,
    durationMinutes: typeof p.durationMinutes === 'number' ? p.durationMinutes : null,
    movedBy: by === 'family' || by === 'teacher' || by === 'staff' ? by : null,
  }
}

const COPY = {
  title: { en: "📅 {learner}'s lesson was moved", ar: '📅 تغيّر موعد حصة {learner}' },
  by: {
    family: { en: 'Moved by the family', ar: 'نقلتها الأسرة' },
    teacher: { en: 'Moved by the teacher', ar: 'نقلها المعلم' },
    staff: { en: 'Moved by the administration', ar: 'نقلتها الإدارة' },
  },
  minutes: { en: '{n} min', ar: '{n} دقيقة' },
}

/**
 * A moved lesson, drawn inside a chat thread: "previous → new" on the
 * academy's clock (Admin Web reads Cairo, PD-22), the teacher and the length.
 * Moving is not an apology: the card says who moved it, nothing more.
 */
export function LessonMovedCard({ card }: { card: LessonMovedPayload }) {
  const { locale, number } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const title = tx(COPY.title).replace('{learner}', card.learnerName)
  return (
    <div className="jr-moved" data-card-kind="lesson_moved" role="group" aria-label={title}>
      <strong className="jr-moved__title" dir="auto">{title}</strong>
      <div className="jr-moved__line">
        <s className="jr-moved__old">{whenIn(card.previousStartsAt, ACADEMY_ZONE, locale)}</s>
        <span aria-hidden="true">{locale === 'ar' ? ' ← ' : ' → '}</span>
        <strong>{whenIn(card.startsAt, ACADEMY_ZONE, locale)}</strong>
      </div>
      {(card.teacherName || card.durationMinutes) && (
        <div className="jr-moved__sub" dir="auto">
          {[card.teacherName, card.durationMinutes ? tx(COPY.minutes).replace('{n}', number(card.durationMinutes)) : null].filter(Boolean).join(' · ')}
        </div>
      )}
      {card.movedBy && <div className="jr-moved__sub">{tx(COPY.by[card.movedBy])}</div>}
    </div>
  )
}
