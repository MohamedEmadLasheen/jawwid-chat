import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, whenIn, zoneLabel } from '@/core/time/academyTime'
import { journeyApi, journeyKeys } from './api'
import { J, excuseCategoryLabel } from './copy'
import './journey.css'

/**
 * The cards about an excused lesson and its make-up, reduced to what is drawn;
 * null when one cannot be (then the plain-text body is shown).
 *
 * - An "owed" card -- the student's excuse, the teacher's, the teacher's absence,
 *   an accepted late apology -- carries the missed lesson's `startsAt`, the
 *   family's own `reason` (only when the family apologised), and, once its
 *   make-up is booked, `makeupStartsAt` (the server rewrites the card in place).
 * - `lesson_makeup_booked` carries the make-up's `startsAt` and the lesson it
 *   replaces, `missedStartsAt`.
 */
export type ExcuseCardKind = 'student_before' | 'student_after' | 'teacher' | 'teacher_absent' | 'accepted' | 'makeup'

export interface LessonExcusePayload {
  kind: ExcuseCardKind
  lessonId: string
  learnerName: string
  teacherName: string | null
  startsAt: string
  durationMinutes: number | null
  /** The family's own reason; a staff reason is never on the card (PD-15). */
  reason: string | null
  /** PD-50: the reason category (EXCUSE_CATEGORIES), which the family reads. */
  category: string | null
  /** An accepted late apology's decision note, which the family reads. */
  note: string | null
  makeupStartsAt: string | null
  missedStartsAt: string | null
  makeupOwed: boolean
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null)

function excuseKindOf(cardKind: string, p: Record<string, unknown>): ExcuseCardKind | null {
  switch (cardKind) {
    case 'lesson_apology': return p.timing === 'after_start' ? 'student_after' : 'student_before'
    case 'lesson_teacher_apology': return 'teacher'
    case 'lesson_cancelled': return p.outcome === 'teacher_no_show' ? 'teacher_absent' : null
    case 'lesson_ruling': return p.decision === 'excused' ? 'accepted' : null
    case 'lesson_makeup_booked': return 'makeup'
    default: return null
  }
}

export function readLessonExcuseCard(cardKind: string, payload: Record<string, unknown> | null | undefined): LessonExcusePayload | null {
  const p = payload ?? {}
  const kind = excuseKindOf(cardKind, p)
  const lessonId = str(p.lessonId)
  const startsAt = str(p.startsAt)
  if (!kind || !lessonId || !startsAt) return null
  return {
    kind,
    lessonId,
    learnerName: str(p.learnerName) ?? '',
    teacherName: str(p.teacherName),
    startsAt,
    durationMinutes: typeof p.durationMinutes === 'number' ? p.durationMinutes : null,
    reason: str(p.reason),
    category: excuseCategoryLabel(p.reasonCategory) ? (p.reasonCategory as string) : null,
    note: str(p.note),
    makeupStartsAt: str(p.makeupStartsAt),
    missedStartsAt: str(p.missedStartsAt),
    makeupOwed: p.makeupOwed === true || kind === 'accepted',
  }
}

const COPY = {
  title: {
    student_before: { en: '🙏 {learner} has an excuse and will not attend the lesson', ar: '🙏 لدى {learner} عذر ولن يتمكن من حضور الحصة' },
    student_after: { en: "🙏 {learner}'s absence from the lesson is excused", ar: '🙏 سُجّل اعتذار {learner} عن الحصة بعد بدايتها' },
    teacher: { en: "🙏 The teacher cannot teach {learner}'s lesson", ar: '🙏 اعتذر المعلم عن حصة {learner}' },
    teacher_absent: { en: "⚠️ {learner}'s lesson did not take place: the teacher was absent", ar: '⚠️ لم تُعقد حصة {learner} لغياب المعلم' },
    accepted: { en: "✅ The apology for {learner}'s lesson was accepted", ar: '✅ قُبل الاعتذار عن حصة {learner}' },
    makeup: { en: '📅 A make-up lesson is scheduled for {learner}', ar: '📅 تم تحديد موعد حصة تعويضية لـ {learner}' },
  },
  lesson: { en: 'Lesson', ar: 'الحصة' },
  makeup: { en: 'Make-up lesson', ar: 'الحصة التعويضية' },
  insteadOf: { en: 'Instead of the lesson on', ar: 'بدلًا من حصة' },
  note: { en: 'Note', ar: 'ملاحظة' },
  minutes: { en: '{n} min', ar: '{n} دقيقة' },
  owedStudent: { en: 'A make-up lesson can be arranged with the teacher.', ar: 'يمكن ترتيب حصة تعويضية بالاتفاق مع المعلم.' },
  owedTeacher: { en: 'A make-up lesson will be arranged.', ar: 'سيتم ترتيب حصة تعويضية.' },
}

/** Whose reason the card cannot carry: a staff member's or the teacher's (PD-15). */
function mayHaveStaffReason(card: LessonExcusePayload): boolean {
  return !card.reason && (card.kind === 'student_before' || card.kind === 'student_after' || card.kind === 'teacher' || card.kind === 'teacher_absent')
}

/**
 * An excused lesson or its make-up, drawn inside a chat thread (owner report
 * 2026-10-29): the reason, the lesson and the make-up's day, date and time on
 * the academy's clock (Admin Web reads Cairo, PD-22).
 *
 * The family's reason is on the card. A staff member's or the teacher's reason
 * is not (PD-15): Admin Web -- staff only -- reads it from the lesson record,
 * which the server gives to staff and the lesson's teacher, and labels it so.
 */
export function LessonExcuseCard({ card }: { card: LessonExcusePayload }) {
  const { locale, number } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const when = (iso: string) => `${whenIn(iso, ACADEMY_ZONE, locale)} · ${zoneLabel(ACADEMY_ZONE, locale)}`
  const staffReason = useQuery({
    queryKey: journeyKeys.lesson(card.lessonId),
    queryFn: () => journeyApi.lesson(card.lessonId),
    enabled: mayHaveStaffReason(card),
    retry: false,
    staleTime: 60_000,
    select: (r) => str(r.outcomeNote),
  }).data
  const title = tx(COPY.title[card.kind]).replace('{learner}', card.learnerName)
  const isMakeup = card.kind === 'makeup'
  const footnote =
    !isMakeup && card.makeupOwed && !card.makeupStartsAt
      ? tx(card.kind === 'teacher' || card.kind === 'teacher_absent' ? COPY.owedTeacher : COPY.owedStudent)
      : null
  const rows: Array<[string, string, string]> = isMakeup
    ? [
        ['makeup', tx(COPY.makeup), when(card.startsAt)],
        ...(card.missedStartsAt ? [['missed', tx(COPY.insteadOf), when(card.missedStartsAt)] as [string, string, string]] : []),
      ]
    : [
        ['lesson', tx(COPY.lesson), when(card.startsAt)],
        ...(card.category ? [['category', tx(J.reason), tx(excuseCategoryLabel(card.category)!)] as [string, string, string]] : []),
        ...(card.reason ? [['reason', tx(J.reason), card.reason] as [string, string, string]] : []),
        // With a category the free text is a note beside it; without one it is the reason itself.
        ...(staffReason
          ? [['staff-reason', tx(card.category ? J.noteStaffTeacher : J.reasonStaffTeacher), staffReason] as [string, string, string]]
          : []),
        ...(card.note ? [['note', tx(COPY.note), card.note] as [string, string, string]] : []),
        ...(card.makeupStartsAt ? [['makeup', tx(COPY.makeup), when(card.makeupStartsAt)] as [string, string, string]] : []),
      ]
  return (
    <div className="jr-excuse" data-card-kind={isMakeup ? 'lesson_makeup_booked' : 'lesson_excuse'} role="group" aria-label={title}>
      <strong className="jr-moved__title" dir="auto">{title}</strong>
      <dl className="jr-excuse__rows">
        {rows.map(([key, label, value]) => (
          <div key={key} className={`jr-excuse__row jr-excuse__row--${key}`} data-row={key}>
            <dt>{label}</dt>
            <dd dir="auto">{value}</dd>
          </div>
        ))}
      </dl>
      {isMakeup && (card.teacherName || card.durationMinutes) && (
        <div className="jr-moved__sub" dir="auto">
          {[card.teacherName, card.durationMinutes ? tx(COPY.minutes).replace('{n}', number(card.durationMinutes)) : null].filter(Boolean).join(' · ')}
        </div>
      )}
      {footnote && <div className="jr-moved__sub">{footnote}</div>}
    </div>
  )
}
