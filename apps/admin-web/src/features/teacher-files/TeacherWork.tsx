import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { QueryBoundary } from '@/shared/components/States'
import { useTeacherDetail } from '@/features/teachers/hooks'
import { opsApi, type Availability, type LessonDto } from '@/features/teachers/opsApi'
import { useAvailability } from '@/features/teachers/opsHooks'
import { WEEKDAY } from '@/features/teachers/opsCopy'
import { T, useCopy, type Pair } from './copy'

/**
 * The Teacher File's view of the lesson system (PD-11): the teacher's working
 * hours and next lessons, and a month's KPIs. Read-only here -- every number
 * and every lesson comes from the same routes the Schedules and Statistics
 * tabs use, so the file cannot disagree with them. Changes are made there.
 */

const SCHEDULE_DAYS = 14
const DAY_MS = 86_400_000

/** Links into the Teachers area. The super admin's copy of the file has no such area, so it gets none. */
export interface TeacherWorkLinks {
  schedule: (teacherId: string) => string
  stats: (teacherId: string, month: string) => string
}

export function teacherAreaLinks(basePath: string): TeacherWorkLinks | undefined {
  if (!basePath.startsWith('/teachers')) return undefined
  return {
    schedule: (id) => `/teachers/schedules?teacher=${encodeURIComponent(id)}`,
    stats: (id, month) => `/teachers?teacher=${encodeURIComponent(id)}&month=${encodeURIComponent(month)}`,
  }
}

export function TeacherScheduleSection({ teacherId, links }: { teacherId: string; links?: TeacherWorkLinks }) {
  const tx = useCopy()
  const hours = useAvailability(teacherId)
  // Fixed for the life of the page, so the query key stays stable.
  const [range] = useState(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return { from: start.toISOString(), to: new Date(start.getTime() + SCHEDULE_DAYS * DAY_MS).toISOString() }
  })
  const lessons = useQuery({
    queryKey: ['lessons-ops', 'teacher-lessons', teacherId, range.from],
    queryFn: () => opsApi.lessons({ teacherId, ...range }),
    staleTime: 30_000,
  })

  return (
    <section className="card panel tf-section" aria-labelledby="tf-schedule">
      <div className="tf-section__head">
        <h2 id="tf-schedule" className="tf-section__title">{tx(T.schedule)}</h2>
        {links && (
          <Link className="btn btn--sm" to={links.schedule(teacherId)}>
            {tx(T.editSchedule)}
          </Link>
        )}
      </div>

      <h3 className="tf-subtitle">{tx(T.workingHours)}</h3>
      <QueryBoundary isLoading={hours.isLoading} error={hours.error} onRetry={() => void hours.refetch()}>
        {hours.data && <WorkingHours availability={hours.data} />}
      </QueryBoundary>

      <h3 className="tf-subtitle">{tx(T.nextLessons, { n: SCHEDULE_DAYS })}</h3>
      <QueryBoundary isLoading={lessons.isLoading} error={lessons.error} onRetry={() => void lessons.refetch()}>
        {lessons.data && <LessonTable lessons={lessons.data.lessons} />}
      </QueryBoundary>
    </section>
  )
}

function WorkingHours({ availability }: { availability: Availability }) {
  const tx = useCopy()
  const days = useMemo(() => {
    const byDay = new Map<number, string[]>()
    for (const w of [...availability.windows].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))) {
      byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), `${w.start}–${w.end}`])
    }
    return [...byDay.entries()]
  }, [availability.windows])

  if (days.length === 0) return <p className="tf-muted">{tx(T.noWorkingHours)}</p>
  return (
    <>
      <dl className="tf-kv">
        {days.map(([weekday, ranges]) => (
          <Fragment key={weekday}>
            <dt>{tx(WEEKDAY[weekday] ?? { en: String(weekday), ar: String(weekday) })}</dt>
            <dd><bdi dir="ltr">{ranges.join(' · ')}</bdi></dd>
          </Fragment>
        ))}
      </dl>
      {availability.timezone && <p className="tf-byline">{tx(T.timesIn, { zone: availability.timezone })}</p>}
    </>
  )
}

const PHASE: Record<LessonDto['phase'], { label: Pair; tone: 'ok' | 'warn' | 'danger' | 'outline' | 'info' }> = {
  upcoming: { label: { en: 'Upcoming', ar: 'قادمة' }, tone: 'outline' },
  in_progress: { label: { en: 'In progress', ar: 'جارية' }, tone: 'info' },
  awaiting_close: { label: { en: 'Awaiting report', ar: 'بانتظار التقرير' }, tone: 'warn' },
  overdue: { label: { en: 'Report overdue', ar: 'التقرير متأخر' }, tone: 'danger' },
  closed: { label: { en: 'Closed', ar: 'مغلقة' }, tone: 'ok' },
}

function LessonTable({ lessons }: { lessons: LessonDto[] }) {
  const tx = useCopy()
  const { dateTime, number } = useI18n()
  if (lessons.length === 0) return <p className="tf-muted">{tx(T.noLessons, { n: SCHEDULE_DAYS })}</p>
  return (
    <div className="table-wrap tf-table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{tx(T.lessonWhen)}</th>
            <th scope="col">{tx(T.child)}</th>
            <th scope="col">{tx(T.lessonLength)}</th>
            <th scope="col">{tx(T.lessonKind)}</th>
            <th scope="col">{tx(T.status)}</th>
          </tr>
        </thead>
        <tbody>
          {lessons.map((l) => {
            const phase = PHASE[l.phase] ?? PHASE.upcoming
            return (
              <tr key={l.id}>
                <td>{dateTime(l.startsAt)}</td>
                <td dir="auto">{l.learner.name}</td>
                <td>{tx(T.minutesShort, { m: number(l.durationMinutes) })}</td>
                <td>{tx(l.kind === 'makeup' ? T.makeup : T.regular)}</td>
                <td>
                  <Badge tone={phase.tone} dot>{tx(phase.label)}</Badge>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The month's KPIs, from `/stats/teachers/:id` (PD-11 T5). A rate the server
 * cannot compute (no lessons yet) arrives as null and is shown as a dash, never
 * as 0%.
 */
export function MonthlyKpis({ teacherId, month, links }: { teacherId: string; month: string; links?: TeacherWorkLinks }) {
  const tx = useCopy()
  const { number, locale } = useI18n()
  const q = useTeacherDetail(teacherId, month)
  const d = q.data
  const percent = (r: number | null) =>
    r === null ? tx(T.none) : new Intl.NumberFormat(LOCALE_TAG[locale], { style: 'percent', maximumFractionDigits: 0 }).format(r)
  const hours = (minutes: number | null) =>
    minutes === null ? tx(T.none) : tx(T.hoursShort, { h: number(Math.round((minutes / 60) * 10) / 10) })

  return (
    <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {d && (
        <>
          <dl className="tf-kpis" aria-label={tx(T.kpis)}>
            <Kpi label={tx(T.kpiHeld)} value={number(d.categories.find((c) => c.key === 'held')?.lessons ?? 0)} hint={hours(d.categories.find((c) => c.key === 'held')?.minutes ?? 0)} />
            <Kpi label={tx(T.kpiAttendance)} value={percent(d.rates.attendance)} />
            <Kpi label={tx(T.kpiReliability)} value={percent(d.rates.teacherReliability)} />
            <Kpi label={tx(T.kpiReportsOnTime)} value={percent(d.reports.onTimeRate)} hint={`${number(d.reports.onTime)}/${number(d.reports.reports)}`} />
            <Kpi label={tx(T.kpiReplies)} value={percent(d.replies.rate)} hint={tx(T.kpiRepliesHint, { n: number(d.replies.familyMessages) })} />
            <Kpi
              label={tx(T.kpiWorkload)}
              value={hours(d.workload.scheduledMinutes)}
              hint={d.workload.availableMinutes === null ? undefined : tx(T.kpiWorkloadHint, { h: hours(d.workload.availableMinutes) })}
            />
            <Kpi label={tx(T.kpiTrials)} value={percent(d.trials.conversionRate)} hint={tx(T.kpiTrialsHint, { n: number(d.trials.total) })} />
          </dl>
          {links && (
            <p className="tf-byline">
              <Link to={links.stats(teacherId, month)}>{tx(T.fullStats)}</Link>
            </p>
          )}
        </>
      )}
    </QueryBoundary>
  )
}

function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="tf-kpi">
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
        {hint && <span className="tf-muted tf-kpi__hint">{hint}</span>}
      </dd>
    </div>
  )
}

export function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
