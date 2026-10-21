import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { Bucket, CategoryStats, TeacherDetail, TeacherRow } from './api'
import { CATEGORY_LABEL, CATEGORY_TONE, T, type Pair } from './copy'
import { useTeacherDetail, useTeacherStats } from './hooks'
import { TeachersAreaTabs } from './area'
import { MonthSummaryPanel, S } from '@/features/journey/MonthSummary'
import { useJourneyCopy } from '@/features/journey/copy'
import './teachers.css'

/**
 * PD-11 T5: teacher statistics, for the Teachers department and the super
 * admin. A list of every teacher for the month, and -- `?teacher=<id>` -- one
 * teacher's month laid out as category cards broken down by lesson length, the
 * way the Core dashboard did, plus what only Chat can know (reports on time,
 * replies to families). Every number comes from the server; this page counts
 * nothing itself.
 */
export function TeacherStatsPage({ inTeachersArea = false }: { inTeachersArea?: boolean } = {}) {
  const tx = useCopy()
  const [params, setParams] = useSearchParams()
  const month = params.get('month') ?? currentMonth()
  const teacherId = params.get('teacher')

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

  const monthPicker = (
    <label className="ts-month">
      <span className="field__label">{tx(T.month)}</span>
      <input
        className="input"
        type="month"
        value={month}
        onChange={(e) => e.target.value && set({ month: e.target.value })}
        aria-label={tx(T.month)}
      />
    </label>
  )

  return (
    <div className="page">
      <div className="page__inner">
        {/* The operators' Teachers area shows its tabs; the super admin's Reports section is one page. */}
        {inTeachersArea && <TeachersAreaTabs />}
        {teacherId ? (
          <TeacherDetailView id={teacherId} month={month} monthPicker={monthPicker} onBack={() => set({ teacher: null })} />
        ) : (
          <>
            <PageHeader title={tx(T.title)} subtitle={tx(T.subtitle)} actions={monthPicker} />
            <TeacherList month={month} onOpen={(id) => set({ teacher: id })} />
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function TeacherList({ month, onOpen }: { month: string; onOpen: (id: string) => void }) {
  const { tx: jx } = useJourneyCopy()
  const tx = useCopy()
  const fmt = useFormat()
  const q = useTeacherStats(month)
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    const all = q.data?.teachers ?? []
    const needle = query.trim().toLowerCase()
    return needle ? all.filter((r) => r.teacher.name.toLowerCase().includes(needle)) : all
  }, [q.data, query])

  return (
    <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      <div className="ts-toolbar">
        <SearchField value={query} onChange={setQuery} label={tx(T.search)} clearLabel={tx(T.search)} />
      </div>
      {(q.data?.teachers.length ?? 0) === 0 ? (
        <EmptyState title={tx(T.noTeachers)} />
      ) : (
        <div className="card card--flush">
          <div className="table-wrap">
            <table className="table ts-table">
              <thead>
                <tr>
                  <th scope="col">{tx(T.colTeacher)}</th>
                  <th scope="col" className="num">{tx(T.colHeld)}</th>
                  <th scope="col" className="num">{tx(T.colScheduled)}</th>
                  <th scope="col" className="num">{tx(T.colNotHeld)}</th>
                  <th scope="col" className="num">{tx(T.colUnreported)}</th>
                  <th scope="col" className="num">{tx(T.colAttendance)}</th>
                  <th scope="col" className="num">{tx(T.colOnTime)}</th>
                  <th scope="col" className="num">{tx(T.colTrials)}</th>
                  <th scope="col" className="num">{tx(T.colTrialsSubscribed)}</th>
                  <th scope="col" className="num">{jx(S.makeups)}</th>
                  <th scope="col" className="num">{jx(S.studentExcuses)}</th>
                  <th scope="col" className="num">{jx(S.teacherExcuses)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: TeacherRow) => (
                  <tr key={r.teacher.id}>
                    <th scope="row">
                      <button type="button" className="ts-link" onClick={() => onOpen(r.teacher.id)}>
                        {r.teacher.name}
                      </button>
                      {!r.teacher.isActive && <span className="ts-muted"> · {tx(T.inactive)}</span>}
                    </th>
                    <td className="num">{fmt.lessonsHours(r.held)}</td>
                    <td className="num">{fmt.lessonsHours(r.scheduled)}</td>
                    <td className="num">{fmt.number(r.notHeld.lessons)}</td>
                    <td className={`num${r.unreported.lessons > 0 ? ' ts-attention' : ''}`}>{fmt.number(r.unreported.lessons)}</td>
                    <td className="num">{fmt.percent(r.attendanceRate)}</td>
                    <td className="num">{fmt.percent(r.reportsOnTimeRate)}</td>
                    <td className="num">{fmt.number(r.trials?.total ?? 0)}</td>
                    <td className="num">{fmt.number(r.trials?.subscribed ?? 0)}</td>
                    <td className="num">{r.summary ? `${fmt.number(r.summary.makeups.completed)} / ${fmt.number(r.summary.makeups.total)}` : '—'}</td>
                    <td className="num">
                      {r.summary ? `${fmt.number(r.summary.studentExcuses.beforeStart)} + ${fmt.number(r.summary.studentExcuses.afterStart)}` : '—'}
                    </td>
                    <td className="num">{r.summary ? fmt.number(r.summary.teacherExcuses) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </QueryBoundary>
  )
}

// ---------------------------------------------------------------------------
// One teacher
// ---------------------------------------------------------------------------

function TeacherDetailView({
  id,
  month,
  monthPicker,
  onBack,
}: {
  id: string
  month: string
  monthPicker: React.ReactNode
  onBack: () => void
}) {
  const tx = useCopy()
  const q = useTeacherDetail(id, month)
  const d = q.data

  return (
    <>
      <button type="button" className="btn btn--ghost ts-back" onClick={onBack}>
        {tx(T.back)}
      </button>
      <PageHeader
        title={d?.teacher.name ?? tx(T.title)}
        subtitle={tx(T.detailSubtitle, { month })}
        actions={
          <div className="ts-head-actions">
            {d && <TotalBox detail={d} />}
            {monthPicker}
          </div>
        }
      />
      <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {d && <DetailBody detail={d} />}
      </QueryBoundary>
    </>
  )
}

function TotalBox({ detail }: { detail: TeacherDetail }) {
  const tx = useCopy()
  const fmt = useFormat()
  return (
    <div className="ts-total" aria-label={tx(T.total)}>
      <span className="ts-total__label">{tx(T.total)}</span>
      <span className="ts-total__value">{fmt.number(detail.totals.counted.lessons)}</span>
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
    <>
      {d.summary && <MonthSummaryPanel summary={d.summary} />}
      <section className="ts-grid" aria-label={tx(T.title)}>
        {cards.map((c) => (
          <CategoryCard key={c.key} category={c} />
        ))}
      </section>

      <section className="ts-grid ts-grid--facts">
        <Fact title={tx(T.rates)}>
          <Metric label={tx(T.attendance)} value={fmt.percent(d.rates.attendance)} hint={tx(T.attendanceHint)} />
          <Metric label={tx(T.completion)} value={fmt.percent(d.rates.completion)} hint={tx(T.completionHint)} />
          <Metric label={tx(T.reliability)} value={fmt.percent(d.rates.teacherReliability)} hint={tx(T.reliabilityHint)} />
        </Fact>
        <Fact title={tx(T.reports)}>
          <Metric label={tx(T.onTime)} value={`${fmt.percent(d.reports.onTimeRate)} · ${fmt.number(d.reports.onTime)}/${fmt.number(d.reports.reports)}`} />
          <Metric label={tx(T.medianDelay)} value={fmt.minutes(d.reports.medianDelayMinutes)} />
        </Fact>
        <Fact title={tx(T.replies)}>
          <Metric label={tx(T.answered)} value={fmt.percent(d.replies.rate)} hint={tx(T.familyMessages, { n: fmt.number(d.replies.familyMessages) })} />
          <Metric label={tx(T.medianReply)} value={fmt.minutes(d.replies.medianReplyMinutes)} />
        </Fact>
        <Fact title={tx(T.workload)}>
          {d.workload.availableMinutes === null ? (
            <p className="ts-muted">{tx(T.noAvailability)}</p>
          ) : (
            <>
              <Metric label={tx(T.available)} value={fmt.hours(d.workload.availableMinutes)} />
              <Metric label={tx(T.free)} value={fmt.hours(d.workload.freeMinutes)} />
            </>
          )}
          <Metric label={tx(T.scheduled)} value={fmt.hours(d.workload.scheduledMinutes)} />
        </Fact>
        {d.movements && (
          <Fact title={tx(T.movements)}>
            <Metric label={tx(T.transfersIn)} value={fmt.number(d.movements.transfersIn)} />
            <Metric label={tx(T.transfersOut)} value={fmt.number(d.movements.transfersOut)} />
            <Metric label={tx(T.paused)} value={fmt.number(d.movements.paused)} />
            <Metric label={tx(T.stopped)} value={fmt.number(d.movements.stopped)} />
          </Fact>
        )}
        <Fact title={tx(T.makeups)}>
          <Metric label={tx(T.makeups)} value={tx(T.makeupsHeld, { held: fmt.number(d.makeups.held), n: fmt.number(d.makeups.lessons) })} />
        </Fact>
        <Fact title={tx(T.trials)}>
          <Metric label={tx(T.trialsTotal)} value={fmt.number(d.trials.total)} />
          <Metric label={tx(T.trialsConducted)} value={fmt.number(d.trials.conducted)} />
          <Metric label={tx(T.trialsSubscribed)} value={fmt.number(d.trials.subscribed)} />
          <Metric label={tx(T.trialsNotSubscribed)} value={fmt.number(d.trials.notSubscribed)} />
          <Metric label={tx(T.trialsNoShow)} value={fmt.number(d.trials.noShow)} />
          <Metric label={tx(T.trialsAwaiting)} value={fmt.number(d.trials.awaiting)} />
          <Metric label={tx(T.trialsConversion)} value={fmt.percent(d.trials.conversionRate)} hint={tx(T.trialsConversionHint)} />
          {(d.trials.upcoming > 0 || d.trials.cancelled > 0) && (
            <p className="ts-muted ts-card__note">{tx(T.trialsOutside, { u: fmt.number(d.trials.upcoming), c: fmt.number(d.trials.cancelled) })}</p>
          )}
        </Fact>
      </section>

      <p className="ts-muted ts-previous">
        {tx(T.previous, { h: fmt.hoursNumber(d.previous.held.minutes), month: d.previous.month })}
      </p>
    </>
  )
}

function CategoryCard({ category: c }: { category: CategoryStats }) {
  const tx = useCopy()
  const fmt = useFormat()
  const label = tx(CATEGORY_LABEL[c.key])
  return (
    <article className={`card ts-card ts-card--${CATEGORY_TONE[c.key]}`} aria-label={label}>
      <header className="ts-card__head">
        <h2 className="ts-card__title">{label}</h2>
        <span className="ts-card__count">{fmt.number(c.lessons)}</span>
      </header>
      <div className="ts-card__rule" />
      {c.byDuration.length === 0 ? (
        <p className="ts-muted ts-card__empty">{tx(T.noData)}</p>
      ) : (
        <ul className="ts-card__rows">
          {c.byDuration.map((b) => (
            <li key={b.durationMinutes} className="ts-card__row">
              <span>{tx(T.minutesLong, { m: fmt.number(b.durationMinutes) })}</span>
              <span className="ts-card__right">
                <strong>{fmt.lessons(b.lessons)}</strong>
                <span className="ts-muted">{tx(T.total)}: {fmt.hours(b.minutes)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <footer className="ts-card__foot">
        <span>{tx(T.total)}</span>
        <strong>{fmt.lessonsHours(c)}</strong>
      </footer>
      {!c.counted && c.key !== 'upcoming' && <p className="ts-muted ts-card__note">{tx(T.notCounted)}</p>}
    </article>
  )
}

function Fact({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="card ts-fact" aria-label={title}>
      <h2 className="ts-card__title">{title}</h2>
      <dl className="ts-fact__list">{children}</dl>
    </article>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
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

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function useCopy() {
  const { locale } = useI18n()
  return useCallback(
    (pair: Pair, params?: Record<string, string | number>) => {
      const template = locale === 'ar' ? pair.ar : pair.en
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
    },
    [locale],
  )
}

function useFormat() {
  const { number, locale } = useI18n()
  const tx = useCopy()
  return useMemo(() => {
    const hoursNumber = (minutes: number) => number(Math.round((minutes / 60) * 10) / 10)
    return {
      number,
      hoursNumber,
      hours: (minutes: number | null) => (minutes === null ? tx(T.none) : tx(T.hours, { h: hoursNumber(minutes) })),
      minutes: (m: number | null) => (m === null ? tx(T.none) : tx(T.minutesLong, { m: number(m) })),
      percent: (r: number | null) =>
        r === null ? tx(T.none) : new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en', { style: 'percent', maximumFractionDigits: 0 }).format(r),
      lessons: (n: number) => (n === 1 ? tx(T.lessonOne) : tx(T.lessons, { n: number(n) })),
      lessonsHours: (b: Bucket) =>
        b.lessons === 1 ? tx(T.lessonOneHours, { h: hoursNumber(b.minutes) }) : tx(T.lessonsHours, { n: number(b.lessons), h: hoursNumber(b.minutes) }),
    }
  }, [number, locale, tx])
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
