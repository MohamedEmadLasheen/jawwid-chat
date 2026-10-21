import type { MonthSummary } from '@/features/teachers/api'
import { useJourneyCopy, type Pair } from './copy'
import './journey.css'

export const S: Record<string, Pair> = {
  title: { en: 'This month at a glance', ar: 'الشهر في لمحة' },
  totalScheduled: { en: 'Total scheduled', ar: 'إجمالي الحصص المجدولة' },
  conducted: { en: 'Lessons conducted', ar: 'الحصص المنفّذة' },
  conductedSplit: { en: 'regular {r} · make-up {m}', ar: 'عادية {r} · تعويضية {m}' },
  attended: { en: 'Student attended', ar: 'حضر الطالب' },
  noShow: { en: 'Student did not attend', ar: 'لم يحضر الطالب' },
  studentExcuses: { en: 'Student excuses', ar: 'أعذار الطالب' },
  excuseSplit: { en: 'before start {b} · after start {a}', ar: 'قبل البداية {b} · بعد البداية {a}' },
  teacherExcuses: { en: 'Teacher excuses', ar: 'أعذار المعلم' },
  teacherNoShow: { en: 'teacher absent {n}', ar: 'غياب المعلم {n}' },
  pending: { en: 'Pending outcomes', ar: 'حصص بلا نتيجة بعد' },
  pendingSplit: { en: 'to come {u} · awaiting report {r}', ar: 'قادمة {u} · بانتظار التقرير {r}' },
  makeups: { en: 'Make-up classes', ar: 'الحصص التعويضية' },
  makeupSplit: { en: 'completed {c} · scheduled {s}', ar: 'منفّذة {c} · مجدولة {s}' },
  cancelled: { en: 'Cancelled by the academy', ar: 'ألغتها الأكاديمية' },
}

function fill(text: string, values: Record<string, number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''))
}

/**
 * PD-15: a teacher's month in the academy's own terms. Every number is the
 * server's (StatsService.monthSummary); every lesson is in exactly one line,
 * a corrected lesson in its new one, a voided lesson in none.
 */
export function MonthSummaryPanel({ summary: s }: { summary: MonthSummary }) {
  const { tx, locale } = useJourneyCopy()
  const n = (v: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-GB').format(v)
  const tiles: Array<{ key: string; label: string; value: number; split?: string }> = [
    { key: 'total', label: tx(S.totalScheduled), value: s.totalScheduled },
    { key: 'conducted', label: tx(S.conducted), value: s.conducted, split: fill(tx(S.conductedSplit), { r: s.completed.regular, m: s.completed.makeup }) },
    { key: 'attended', label: tx(S.attended), value: s.studentAttended },
    { key: 'noshow', label: tx(S.noShow), value: s.studentNoShow },
    { key: 'sexcuse', label: tx(S.studentExcuses), value: s.studentExcuses.total, split: fill(tx(S.excuseSplit), { b: s.studentExcuses.beforeStart, a: s.studentExcuses.afterStart }) },
    { key: 'texcuse', label: tx(S.teacherExcuses), value: s.teacherExcuses, split: fill(tx(S.teacherNoShow), { n: s.teacherNoShow }) },
    { key: 'pending', label: tx(S.pending), value: s.pending.total, split: fill(tx(S.pendingSplit), { u: s.pending.upcoming, r: s.pending.awaitingReport }) },
    { key: 'makeups', label: tx(S.makeups), value: s.makeups.total, split: fill(tx(S.makeupSplit), { c: s.makeups.completed, s: s.makeups.scheduled }) },
    { key: 'cancelled', label: tx(S.cancelled), value: s.cancelled },
  ]
  return (
    <section aria-label={tx(S.title)} className="jr-summary">
      {tiles.map((t) => (
        <div key={t.key} className="jr-stat" data-stat={t.key}>
          <span className="jr-stat__label">{t.label}</span>
          <span className="jr-stat__value">{n(t.value)}</span>
          {t.split && <span className="jr-stat__split">{t.split.replace(/\d+/g, (d) => n(Number(d)))}</span>}
        </div>
      ))}
    </section>
  )
}
