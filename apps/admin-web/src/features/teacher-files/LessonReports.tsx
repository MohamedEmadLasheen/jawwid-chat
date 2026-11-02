import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/core/api/client'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { QueryBoundary } from '@/shared/components/States'
import { studentPath } from '@/features/profiles/api'
import { useCopy, type Pair } from './copy'

/**
 * RQA-F1: the month's lessons with their report -- read-only. The counts are
 * the stats tile's own (reports, on time) plus the two the tile never holds
 * (pending, missing); the server computes all of them for the whole month, so
 * they never change with the page or the filter.
 */
export type ReportStatus = 'on_time' | 'late' | 'pending' | 'missing'

export interface LessonReportRow {
  id: string
  kind: string
  startsAt: string
  endsAt: string
  day: string
  status: ReportStatus
  /** Outside the viewer's per-child scope: counted, never named -- no child, family, content or links. */
  anotherFamily: boolean
  learner: { id: string; name: string | null; familyId: string | null } | null
  prospectName: string | null
  report: AnotherFamilyReport | FullReport | null
}

/** What a row outside the viewer's scope keeps: when it was written, so its status reads the same. */
export interface AnotherFamilyReport {
  submittedAt: string
  delayMinutes: number | null
  graceHours: number
}

export interface FullReport extends AnotherFamilyReport {
  lessonNumber: number | null
  lessonTotal: number | null
  covered: string | null
  coveredTopics: string[]
  nextTasks: string[]
  homework: string | null
  rating: number | null
  note: string | null
  updatedAt: string
  version: number | null
    enteredBy: { kind: string | null; id: string; name: string | null } | null
}

export interface LessonReportsPage {
  teacherId: string
  month: string
  zone: string
  counts: { reports: number; onTime: number; late: number; pending: number; missing: number }
  lessons: LessonReportRow[]
  nextCursor: string | null
}

export const lessonReportsApi = {
  page: (teacherId: string, month: string, status: ReportStatus | null, cursor: string | null) =>
    api.get<LessonReportsPage>(`/teacher-files/${encodeURIComponent(teacherId)}/lesson-reports`, {
      month,
      ...(status ? { status } : {}),
      ...(cursor ? { cursor } : {}),
    }),
}

export function useLessonReports(teacherId: string, month: string, status: ReportStatus | null) {
  return useInfiniteQuery({
    queryKey: ['teacher-files', 'lesson-reports', teacherId, month, status ?? 'all'] as const,
    queryFn: ({ pageParam }) => lessonReportsApi.page(teacherId, month, status, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
}

/** The Schedule's day view, filtered to the lesson's teacher and child: the lesson itself. */
export function lessonLink(teacherId: string, row: Pick<LessonReportRow, 'day' | 'learner' | 'anotherFamily'>): string | null {
  if (!row.learner || row.anotherFamily) return null
  const q = new URLSearchParams({ view: 'day', date: row.day, teacherIds: teacherId, learnerIds: row.learner.id })
  return `/schedule?${q.toString()}`
}

const R = {
  title: { en: 'Lesson reports', ar: 'تقارير الحصص' },
  hint: {
    en: 'The month’s ended lessons and their reports. On time means written within {hours} hours of the lesson’s end, as the monthly figure counts it.',
    ar: 'حصص الشهر المنتهية وتقاريرها. «في الوقت» تعني كتابة التقرير خلال {hours} ساعة من نهاية الحصة، كما يحسبها مؤشر الشهر.',
  },
  all: { en: 'All', ar: 'الكل' },
  filter: { en: 'Show', ar: 'عرض' },
  reports: { en: 'Reports', ar: 'التقارير' },
  lesson: { en: 'Lesson', ar: 'الحصة' },
  child: { en: 'Child', ar: 'الطالب' },
  status: { en: 'Report', ar: 'التقرير' },
  covered: { en: 'Covered', ar: 'ما تم' },
  topics: { en: 'Topics', ar: 'الموضوعات' },
  next: { en: 'Next', ar: 'التالي' },
  homework: { en: 'Homework', ar: 'الواجب' },
  rating: { en: 'Rating', ar: 'التقييم' },
  note: { en: 'Staff note', ar: 'ملاحظة للإدارة' },
  lessonNo: { en: 'Lesson {n} of {total}', ar: 'الحصة {n} من {total}' },
  lessonNoOnly: { en: 'Lesson {n}', ar: 'الحصة {n}' },
  entered: { en: 'Written by {who}, {when}', ar: 'كتبه {who}، {when}' },
  edited: { en: 'edited {when} (version {v})', ar: 'عُدّل {when} (النسخة {v})' },
  late: { en: '{h} h {m} min after the end', ar: 'بعد نهاية الحصة بـ{h} س و{m} د' },
  openLesson: { en: 'Open the lesson', ar: 'افتح الحصة' },
  trial: { en: 'Trial: {name}', ar: 'تجربة: {name}' },
  anotherFamily: { en: 'Another family', ar: 'عائلة أخرى' },
  none: { en: 'No lessons to show for this month.', ar: 'لا توجد حصص لعرضها في هذا الشهر.' },
  more: { en: 'Show more', ar: 'عرض المزيد' },
  loadingMore: { en: 'Loading…', ar: 'جارٍ التحميل…' },
  someone: { en: 'someone', ar: 'شخص' },
} satisfies Record<string, Pair>

export const STATUS: Record<ReportStatus, { label: Pair; tone: 'ok' | 'warn' | 'danger' | 'info' }> = {
  on_time: { label: { en: 'On time', ar: 'في الوقت' }, tone: 'ok' },
  late: { label: { en: 'Late', ar: 'متأخر' }, tone: 'warn' },
  pending: { label: { en: 'Awaiting report', ar: 'بانتظار التقرير' }, tone: 'info' },
  missing: { label: { en: 'Missing', ar: 'مفقود' }, tone: 'danger' },
}
const ORDER: ReportStatus[] = ['on_time', 'late', 'pending', 'missing']

export function LessonReports({ teacherId, month }: { teacherId: string; month: string }) {
  const tx = useCopy()
  const [status, setStatus] = useState<ReportStatus | null>(null)
  const q = useLessonReports(teacherId, month, status)
  const first = q.data?.pages[0]
  const rows = q.data?.pages.flatMap((p) => p.lessons) ?? []
  const grace = rows.find((r) => r.report)?.report?.graceHours ?? 24
  return (
    <section className="card panel tf-section" aria-labelledby="tf-lesson-reports">
      <div className="tf-section__head">
        <h2 id="tf-lesson-reports" className="tf-section__title">
          {tx(R.title)}
        </h2>
      </div>
      <p className="field__hint">{tx(R.hint, { hours: grace })}</p>
      <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {first && (
          <>
            <div className="tf-report-counts" role="group" aria-label={tx(R.filter)}>
              <button
                type="button"
                className="chip"
                aria-pressed={status === null}
                onClick={() => setStatus(null)}
              >
                {tx(R.all)} · {tx(R.reports)} <span className="chip__count">{first.counts.reports}</span>
              </button>
              {ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="chip"
                  aria-pressed={status === k}
                  onClick={() => setStatus(status === k ? null : k)}
                >
                  {tx(STATUS[k].label)} <span className="chip__count">{countOf(first.counts, k)}</span>
                </button>
              ))}
            </div>
            {rows.length === 0 ? (
              <p className="tf-muted">{tx(R.none)}</p>
            ) : (
              <ul className="tf-report-list">
                {rows.map((r) => (
                  <ReportItem key={r.id} teacherId={teacherId} row={r} />
                ))}
              </ul>
            )}
            {q.hasNextPage && (
              <button type="button" className="btn btn--sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                {q.isFetchingNextPage ? tx(R.loadingMore) : tx(R.more)}
              </button>
            )}
          </>
        )}
      </QueryBoundary>
    </section>
  )
}

function countOf(c: LessonReportsPage['counts'], k: ReportStatus): number {
  return k === 'on_time' ? c.onTime : c[k]
}

function ReportItem({ teacherId, row }: { teacherId: string; row: LessonReportRow }) {
  const tx = useCopy()
  const { dateTime, locale } = useI18n()
  const list = (items: string[]) => items.join(locale === 'ar' ? '، ' : ', ') || null
  const s = STATUS[row.status]
  const link = lessonLink(teacherId, row)
  const rep = row.report && 'updatedAt' in row.report ? row.report : null
  const delay = row.report && row.status === 'late' && row.report.delayMinutes !== null ? row.report.delayMinutes : null
  return (
    <li className="tf-report">
      <div className="tf-report__head">
        <Badge tone={s.tone} dot>
          {tx(s.label)}
        </Badge>
        <span className="tf-report__when">{dateTime(row.startsAt)}</span>
        {row.anotherFamily ? (
          <span className="tf-muted">{tx(R.anotherFamily)}</span>
        ) : row.learner ? (
          <Link to={studentPath(row.learner.id)} dir="auto">
            {row.learner.name}
          </Link>
        ) : (
          row.prospectName && <span dir="auto">{tx(R.trial, { name: row.prospectName })}</span>
        )}
        {link && (
          <Link to={link} className="tf-report__open">
            {tx(R.openLesson)}
          </Link>
        )}
      </div>
      {delay !== null && (
        <p className="tf-muted">{tx(R.late, { h: Math.floor(delay / 60), m: delay % 60 })}</p>
      )}
      {rep && (
        <dl className="tf-report__body">
          {rep.lessonNumber !== null && (
            <div>
              <dt className="sr-only">{tx(R.lesson)}</dt>
              <dd>
                {rep.lessonTotal !== null
                  ? tx(R.lessonNo, { n: rep.lessonNumber, total: rep.lessonTotal })
                  : tx(R.lessonNoOnly, { n: rep.lessonNumber })}
              </dd>
            </div>
          )}
          <Field label={tx(R.covered)} value={rep.covered} />
          <Field label={tx(R.topics)} value={list(rep.coveredTopics)} />
          <Field label={tx(R.next)} value={list(rep.nextTasks)} />
          <Field label={tx(R.homework)} value={rep.homework} />
          <Field label={tx(R.rating)} value={rep.rating !== null ? `${rep.rating} / 5` : null} />
          <Field label={tx(R.note)} value={rep.note} />
          <div className="tf-muted">
            {tx(R.entered, { who: rep.enteredBy?.name ?? tx(R.someone), when: dateTime(rep.submittedAt) })}
            {rep.version !== null && rep.version > 1 && <> · {tx(R.edited, { when: dateTime(rep.updatedAt), v: rep.version })}</>}
          </div>
        </dl>
      )}
    </li>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="tf-report__field">
      <dt>{label}</dt>
      <dd dir="auto">{value}</dd>
    </div>
  )
}
