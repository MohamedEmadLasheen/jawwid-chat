import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/core/api/client'
import { ApiError } from '@/core/api/errors'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { useCopy, type Pair } from '@/features/organization/copy'

/** One line of GET /staff/:id/action-log (apps/api ActionLogService). */
export interface ActionLogEntry {
  id: string
  action: string
  entity: string
  entityId: string
  reason: string | null
  at: string
  duringSupport: boolean
}

const L = {
  title: { en: 'Action log', ar: 'سجل الإجراءات' },
  hint: {
    en: 'What they did, newest first, from the records the system already keeps. Choose a longer period to go further back. A case shows only that it was acted on; open it to see more.',
    ar: 'ما قاموا به، الأحدث أولًا، من السجلات التي يحفظها النظام. اختر فترة أطول للرجوع أبعد. الحالة تظهر فقط أنه جرى عليها إجراء؛ افتحها لترى المزيد.',
  },
  empty: { en: 'Nothing recorded in this period.', ar: 'لا شيء مسجّل في هذه الفترة.' },
  period: { en: 'Period', ar: 'الفترة' },
  days30: { en: 'Last 30 days', ar: 'آخر 30 يومًا' },
  days90: { en: 'Last 90 days', ar: 'آخر 90 يومًا' },
  days365: { en: 'Last 12 months', ar: 'آخر 12 شهرًا' },
  more: { en: 'Load more', ar: 'عرض المزيد' },
  support: { en: 'During a support session', ar: 'خلال جلسة دعم' },
} satisfies Record<string, Pair>

/** Readable names for the acts a supervisor does most; any other is shown as recorded. */
const ACTION: Record<string, Pair> = {
  'supervision_case.opened': { en: 'Opened a case', ar: 'فتح حالة' },
  'supervision_case.assigned': { en: 'Assigned a case', ar: 'أسند حالة' },
  'supervision_case.status': { en: 'Changed a case\'s status', ar: 'غيّر حالة تصعيد' },
  'supervision_case.due': { en: 'Set a case\'s due date', ar: 'حدّد موعد حالة' },
  'supervision_case.note': { en: 'Added a note to a case', ar: 'أضاف ملاحظة إلى حالة' },
  'teacher.lateness_recorded': { en: 'Recorded a teacher lateness', ar: 'سجّل تأخر معلم' },
  'teacher.absence_recorded': { en: 'Recorded a teacher absence', ar: 'سجّل غياب معلم' },
  'teacher.complaint_upheld': { en: 'Upheld a complaint', ar: 'أيّد شكوى' },
  'teacher_evaluation.recorded': { en: 'Recorded an evaluation', ar: 'سجّل تقييمًا' },
  'teacher_evaluation.shared': { en: 'Shared an evaluation', ar: 'شارك تقييمًا' },
  'improvement_plan.created': { en: 'Created an improvement plan', ar: 'أنشأ خطة تحسين' },
  'improvement_plan.shared': { en: 'Shared an improvement plan', ar: 'شارك خطة تحسين' },
  'report_correction.requested': { en: 'Requested a report correction', ar: 'طلب تصحيح تقرير' },
  'lesson.report_edited': { en: 'Edited a lesson report', ar: 'عدّل تقرير حصة' },
  'lesson.ruling_decided': { en: 'Decided a ruling', ar: 'أصدر قرارًا' },
  'learner.supervisor_assigned': { en: 'Assigned a child to a supervisor', ar: 'أسند طفلًا إلى مشرف' },
  'seat.joined': { en: 'Joined a group', ar: 'انضم إلى مجموعة' },
  'seat.left': { en: 'Left a group', ar: 'غادر مجموعة' },
}

/** Where a line's subject is opened -- each page decides for itself whether the viewer may see it. */
function linkFor(e: ActionLogEntry): string | null {
  const id = encodeURIComponent(e.entityId)
  switch (e.entity) {
    case 'supervision_case':
      return `/cases?case=${id}`
    case 'teacher':
      return `/teachers/files/${id}`
    case 'learner':
      return `/students/${id}`
    case 'conversation':
      return `/chat/${id}`
    case 'staff':
      return `/profile/${id}`
    default:
      return null
  }
}

/**
 * PD-35 B7: a staff member's action log, on their profile. Shown to whoever
 * the server lets read it (themselves, their department's manager, the super
 * admin); a "not found" shows nothing at all.
 */
const PERIODS = [
  { days: 30, label: L.days30 },
  { days: 90, label: L.days90 },
  { days: 365, label: L.days365 },
] as const

interface Page {
  entries: ActionLogEntry[]
  nextCursor: string | null
}

export function ActionLogSection({ staffId }: { staffId: string }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const [days, setDays] = useState(30)
  const query = useInfiniteQuery({
    queryKey: ['action-log', staffId, days],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<Page>(`/staff/${encodeURIComponent(staffId)}/action-log`, {
        // 30 days is the server's default window; a longer one is asked for.
        ...(days !== 30 ? { from: new Date(Date.now() - days * 86_400_000).toISOString() } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor,
    // A new period keeps the lines on screen until it arrives.
    placeholderData: (previous) => previous,
    retry: false,
    staleTime: 30_000,
  })
  if (query.error instanceof ApiError && query.error.isNotFound) return null
  if (!query.data && !query.error) return null
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? []
  return (
    <section className="card sp-card" aria-labelledby="sp-action-log">
      <h2 id="sp-action-log" className="sp-card__title">{tx(L.title)}</h2>
      <p className="sp-footnote">{tx(L.hint)}</p>
      <label className="field">
        <span className="field__label">{tx(L.period)}</span>
        <select className="select" aria-label={tx(L.period)} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {PERIODS.map((p) => (
            <option key={p.days} value={p.days}>{tx(p.label)}</option>
          ))}
        </select>
      </label>
      <QueryBoundary isLoading={false} error={query.error} onRetry={() => void query.refetch()}>
        {entries.length === 0 ? (
          <p className="sp-muted">{tx(L.empty)}</p>
        ) : (
          <ol className="sp-timeline">
            {entries.map((e) => {
              const label = ACTION[e.action] ? tx(ACTION[e.action]!) : e.action
              const to = linkFor(e)
              return (
                <li key={e.id} className="sp-timeline__item">
                  <div>{to ? <Link to={to}>{label}</Link> : <strong>{label}</strong>}</div>
                  <div className="sp-muted sp-small">
                    <time dateTime={e.at}>{dateTime(e.at)}</time>
                    {e.duringSupport && <> · <span>{tx(L.support)}</span></>}
                  </div>
                  {e.reason && (
                    <div className="sp-small sp-muted">
                      <span dir="auto">{e.reason}</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
        {query.hasNextPage && (
          <button type="button" className="btn btn--sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {tx(L.more)}
          </button>
        )}
      </QueryBoundary>
    </section>
  )
}
