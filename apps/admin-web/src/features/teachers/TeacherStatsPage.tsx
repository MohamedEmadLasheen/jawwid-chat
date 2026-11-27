import { useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '@/core/api/errors'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { MastFigures, PageHeader, type MastFigure } from '@/shared/components/PageHeader'
import { QueryBoundary } from '@/shared/components/States'
import { adminSectionPath } from '@/features/admin/sections'
import type { CategoryStats, StatCategory, TeacherDetail } from './api'
import { CATEGORY_LABEL, T, TS } from './copy'
import { useTeacherDetail, useTeacherStats } from './hooks'
import { TeachersAreaTabs } from './area'
import { MonthPicker } from './MonthPicker'
import { Denied, StatsList } from './stats/StatsList'
import { MessageTeacher } from './stats/MessageTeacher'
import { OutcomeBars } from './stats/OutcomeBars'
import { clausesOf, flagsOf, isFilter, levelOf } from './stats/priority'
import { useReason } from './stats/reason'
import { LEVEL_TONE } from './stats/TeacherSheet'
import { Pct, monogramName, useCopy, useCopyNodes, useFormat } from './stats/format'
import { TEACHER_ATTENTION_THRESHOLDS as TH } from './stats/thresholds'
import './teachers.css'
import './stats/stats.css'

/**
 * PD-11 T5: teacher statistics, for the Teachers department and the super
 * admin. The list (`stats/StatsList`) answers "who needs my intervention this
 * month?", ordered by need; a row opens the teacher's month in a side sheet.
 * `?teacher=<id>` is one teacher's month at page width: the same figures, the
 * month by outcome, every outcome broken down by lesson length, and what only
 * Chat can know beside them. Every number comes from the server.
 */
export function TeacherStatsPage({ inTeachersArea = false }: { inTeachersArea?: boolean } = {}) {
  const tx = useCopy()
  const [params, setParams] = useSearchParams()
  const month = params.get('month') ?? currentMonth()
  const teacherId = params.get('teacher')
  const show = params.get('show')

  const set = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params)
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k)
        else next.set(k, v)
      }
      setParams(next, { replace: false })
    },
    [params, setParams],
  )

  const monthPicker = <MonthPicker value={month} onChange={(next) => set({ month: next })} label={tx(T.month)} showLabel={false} />
  // The operators' Teachers area keeps the file under its own tab; the super admin's is in the Admin portal.
  const fileHref = (id: string) => (inTeachersArea ? `/teachers/files/${encodeURIComponent(id)}` : `${adminSectionPath('teachers')}/${encodeURIComponent(id)}`)
  const fullHref = (id: string) => {
    const next = new URLSearchParams(params)
    next.delete('show')
    next.set('month', month)
    next.set('teacher', id)
    return `?${next.toString()}`
  }

  return (
    <div className="page">
      <div className="page__inner">
        {teacherId ? (
          <TeacherDetailView id={teacherId} month={month} monthPicker={monthPicker} fileHref={fileHref(teacherId)} />
        ) : (
          <StatsList
            month={month}
            monthPicker={monthPicker}
            tabs={inTeachersArea ? <TeachersAreaTabs /> : undefined}
            filter={isFilter(show) ? show : null}
            onFilter={(next) => set({ show: next })}
            fileHref={fileHref}
            fullHref={fullHref}
            needsActionHref="/teachers/needs-action"
          />
        )}
      </div>
    </div>
  )
}

const isForbidden = (error: unknown) => error instanceof ApiError && error.isForbidden

// ---------------------------------------------------------------------------
// One teacher, at page width
// ---------------------------------------------------------------------------

function TeacherDetailView({
  id,
  month,
  monthPicker,
  fileHref,
}: {
  id: string
  month: string
  monthPicker: React.ReactNode
  fileHref: string
}) {
  const tx = useCopy()
  const nodes = useCopyNodes()
  const fmt = useFormat()
  const [params] = useSearchParams()
  const q = useTeacherDetail(id, month)
  const d = q.data
  const reason = useReason()
  // Why this teacher is where the list put them: the same level and reason as the row.
  const listRow = useTeacherStats(month).data?.teachers.find((r) => r.teacher.id === id)
  const flags = listRow ? flagsOf(listRow, TH) : null
  const level = flags ? levelOf(flags) : null
  const why = listRow && flags && level ? reason(clausesOf(listRow, flags, level)) : ''
  // The way back keeps the month: the list this record belongs to.
  const back = new URLSearchParams(params)
  back.delete('teacher')
  const lessonsOf = (key: StatCategory) => d?.categories.find((c) => c.key === key)?.lessons ?? 0
  const late = lessonsOf('unreported')
  const figures: MastFigure[] = d
    ? [
        {
          key: 'late',
          label: tx(TS.colLate),
          value: fmt.number(late),
          note: d.reports.onTimeRate !== null ? nodes(TS.onTimeOf, { p: <Pct value={d.reports.onTimeRate} /> }) : undefined,
          tone: late >= TH.lateReportsUrgent ? 'urgent' : late === 0 ? 'quiet' : undefined,
        },
        {
          key: 'attendance',
          label: tx(TS.colAttendance),
          value: <Pct value={d.rates.attendance} />,
          tone: d.rates.attendance === null ? 'quiet' : undefined,
        },
        {
          key: 'held',
          label: tx(TS.colLessons),
          value: <bdi dir="ltr" className="ltr">{`${fmt.number(lessonsOf('held'))} / ${fmt.number(d.totals.counted.lessons)}`}</bdi>,
          note: tx(TS.colLessonsKey),
        },
        { key: 'reliability', label: tx(T.reliability), value: <Pct value={d.rates.teacherReliability} />, note: tx(T.reliabilityHint) },
      ]
    : []

  return (
    <div className="tsx-full">
      <PageHeader
        back={{ to: `?${back.toString()}`, label: tx(T.back) }}
        lead={d ? <Avatar name={monogramName(d.teacher.name)} seed={d.teacher.id} size="lg" /> : undefined}
        title={d?.teacher.name ?? tx(T.title)}
        subtitle={tx(T.detailSubtitle, { month: fmt.month(month) })}
        actions={
          <>
            {d && (
              <>
                <Link className="btn btn--sm" to={fileHref}>
                  {tx(TS.openFile)}
                </Link>
                <MessageTeacher teacherId={d.teacher.id} teacherName={d.teacher.name} className="btn btn--sm btn--primary" />
              </>
            )}
            {monthPicker}
          </>
        }
      />
      {level && (
        <p className="tsx-full__why">
          <Badge tone={LEVEL_TONE[level]}>{tx(TS[level])}</Badge>
          {why && <span>{why}</span>}
        </p>
      )}
      {figures.length > 0 && <MastFigures figures={figures} />}
      {isForbidden(q.error) ? (
        <Denied />
      ) : (
        <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          {d && <DetailBody detail={d} />}
        </QueryBoundary>
      )}
    </div>
  )
}

function DetailBody({ detail: d }: { detail: TeacherDetail }) {
  const tx = useCopy()
  const fmt = useFormat()
  // Every counted category is always shown (a zero is information); the
  // information-only ones appear when they have something to show.
  const cards = d.categories.filter((c) => c.counted || c.key === 'upcoming' || c.lessons > 0)

  return (
    <div className="split split--wide-aside">
      <div className="ts-detail">
        <section className="sheet tsx-full__outcomes" aria-labelledby="tsx-full-outcomes">
          <h2 id="tsx-full-outcomes" className="tsx-sheet__title">
            {tx(TS.outcomes)}
          </h2>
          <OutcomeBars categories={d.categories} />
        </section>
        <h2 className="tsx-full__head">{tx(T.byOutcome)}</h2>
        <section className="ts-cats" aria-label={tx(T.title)}>
          {cards.map((c) => (
            <CategoryCard key={c.key} category={c} />
          ))}
        </section>
        <p className="ts-muted ts-previous">
          {tx(T.previous, { hours: fmt.hours(d.previous.held.minutes), month: fmt.month(d.previous.month) })}
        </p>
      </div>

      <aside className="ts-facts sheet tsx-full__facts">
        <Fact title={tx(T.reports)}>
          <Metric label={tx(T.onTime)} value={<Pct value={d.reports.onTimeRate} />} hint={tx(TS.ofN, { a: fmt.number(d.reports.onTime), b: fmt.number(d.reports.reports) })} />
          <Metric label={tx(T.medianDelay)} value={fmt.duration(d.reports.medianDelayMinutes)} />
        </Fact>
        <Fact title={tx(T.replies)}>
          <Metric label={tx(T.answered)} value={<Pct value={d.replies.rate} />} hint={tx(T.familyMessages, { n: fmt.number(d.replies.familyMessages) })} />
          <Metric label={tx(T.medianReply)} value={fmt.duration(d.replies.medianReplyMinutes)} />
        </Fact>
        <Fact title={tx(T.workload)}>
          {d.workload.availableMinutes === null ? (
            <p className="ts-muted ts-fact__none">{tx(T.noAvailability)}</p>
          ) : (
            <>
              <Metric label={tx(T.available)} value={fmt.hours(d.workload.availableMinutes)} />
              <Metric label={tx(T.free)} value={fmt.hours(d.workload.freeMinutes)} />
            </>
          )}
          <Metric label={tx(T.scheduled)} value={fmt.hours(d.workload.scheduledMinutes)} />
        </Fact>
        {d.summary && (
          <Fact title={tx(TS.more)}>
            <Metric
              label={tx(TS.studentExcuses)}
              value={fmt.number(d.summary.studentExcuses.total)}
              hint={tx(TS.studentExcusesSplit, { b: fmt.number(d.summary.studentExcuses.beforeStart), a: fmt.number(d.summary.studentExcuses.afterStart) })}
            />
            <Metric label={tx(TS.teacherExcuses)} value={fmt.number(d.summary.teacherExcuses)} />
            <Metric label={tx(TS.makeupsDone)} value={tx(TS.ofN, { a: fmt.number(d.summary.makeups.completed), b: fmt.number(d.summary.makeups.total) })} />
          </Fact>
        )}
        {d.movements && (
          <Fact title={tx(T.movements)}>
            <Metric label={tx(T.transfersIn)} value={fmt.number(d.movements.transfersIn)} />
            <Metric label={tx(T.transfersOut)} value={fmt.number(d.movements.transfersOut)} />
            <Metric label={tx(T.paused)} value={fmt.number(d.movements.paused)} />
            <Metric label={tx(T.stopped)} value={fmt.number(d.movements.stopped)} />
          </Fact>
        )}
        {d.movesByTeacher !== undefined && (
          <Fact title={tx(T.moves)}>
            <Metric label={tx(T.moves)} value={fmt.number(d.movesByTeacher)} hint={tx(T.movesHint)} />
          </Fact>
        )}
        {/* RQA-F8: the month summary already counts make-ups (completed, scheduled, total);
            a second, closed-only count beside it read as a contradiction ("2" vs "0 of 0"). */}
        {!d.summary && (
          <Fact title={tx(T.makeups)}>
            <Metric label={tx(T.makeupsClosed)} value={tx(T.makeupsHeld, { held: fmt.number(d.makeups.held), n: fmt.number(d.makeups.lessons) })} />
          </Fact>
        )}
        <Fact title={tx(T.trials)}>
          <Metric label={tx(T.trialsTotal)} value={fmt.number(d.trials.total)} />
          <Metric label={tx(T.trialsConducted)} value={fmt.number(d.trials.conducted)} />
          <Metric label={tx(T.trialsSubscribed)} value={fmt.number(d.trials.subscribed)} />
          <Metric label={tx(T.trialsNotSubscribed)} value={fmt.number(d.trials.notSubscribed)} />
          <Metric label={tx(T.trialsNoShow)} value={fmt.number(d.trials.noShow)} />
          <Metric label={tx(T.trialsAwaiting)} value={fmt.number(d.trials.awaiting)} />
          <Metric label={tx(T.trialsConversion)} value={<Pct value={d.trials.conversionRate} />} hint={tx(T.trialsConversionHint)} />
          {(d.trials.upcoming > 0 || d.trials.cancelled > 0) && (
            <p className="ts-muted ts-card__note">{tx(T.trialsOutside, { u: fmt.number(d.trials.upcoming), c: fmt.number(d.trials.cancelled) })}</p>
          )}
        </Fact>
      </aside>
    </div>
  )
}

/** Red only where a lesson was lost through the teacher or still has no report; the rest is neutral ink. */
const ALARM: ReadonlySet<StatCategory> = new Set(['teacher_no_show', 'unreported'])

function CategoryCard({ category: c }: { category: CategoryStats }) {
  const tx = useCopy()
  const fmt = useFormat()
  const label = tx(CATEGORY_LABEL[c.key])
  const tone = ALARM.has(c.key) && c.lessons > 0 ? 'danger' : 'neutral'
  return (
    <article className={`sheet ts-cat ts-cat--${tone}${c.lessons === 0 ? ' ts-cat--none' : ''}`} aria-label={label}>
      <header className="ts-cat__head">
        <h3 className="ts-cat__title">{label}</h3>
        <span className="ts-cat__count">{fmt.number(c.lessons)}</span>
      </header>
      {c.byDuration.length === 0 ? (
        <p className="ts-muted ts-cat__empty">{tx(T.noData)}</p>
      ) : (
        <>
          <ul className="ts-cat__rows">
            {c.byDuration.map((b) => (
              <li key={b.durationMinutes} className="ts-cat__row">
                <span>{tx(T.minutesLong, { m: fmt.number(b.durationMinutes) })}</span>
                <strong>{fmt.lessons(b.lessons)}</strong>
                <span className="ts-muted">{fmt.hours(b.minutes)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <footer className="ts-cat__foot">
        <span>{tx(T.total)}</span>
        <strong>{fmt.lessonsHours(c)}</strong>
      </footer>
      {!c.counted && c.key !== 'upcoming' && <p className="ts-muted ts-card__note">{tx(T.notCounted)}</p>}
    </article>
  )
}

function Fact({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="aside-group ts-fact" aria-label={title}>
      <h2 className="aside-group__title">{title}</h2>
      <dl className="ts-fact__list">{children}</dl>
    </article>
  )
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="ts-metric">
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
        {hint && <span className="ts-muted ts-metric__hint">{hint}</span>}
      </dd>
    </div>
  )
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
