import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '@/core/api/errors'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { HOURS, LESSONS, countLabel, durationLabel } from '@/core/i18n/counts'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { Bucket, CategoryStats, TeacherDetail, TeacherRow } from './api'
import { CATEGORY_LABEL, CATEGORY_TONE, T, type Pair } from './copy'
import { useTeacherDetail, useTeacherStats } from './hooks'
import { TeachersAreaTabs } from './area'
import { MonthPicker } from './MonthPicker'
import { Icon } from '@/shared/components/Icon'
import { MonthSummaryPanel, S } from '@/features/journey/MonthSummary'
import { useJourneyCopy } from '@/features/journey/copy'
import './teachers.css'
import './stack-table.css'

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

  const monthPicker = <MonthPicker value={month} onChange={(next) => set({ month: next })} label={tx(T.month)} showLabel={false} />

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

const isForbidden = (error: unknown) => error instanceof ApiError && error.isForbidden

/** The server said no: one calm line and a lock. It offers no retry, as a refusal is an answer. */
function Denied() {
  const { t } = useI18n()
  return (
    <p className="ts-denied" role="alert">
      <Icon name="lock" size={18} />
      <span>{t('common.forbidden')}</span>
    </p>
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

  if (isForbidden(q.error)) return <Denied />
  return (
    <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      <div className="ts-toolbar">
        <SearchField value={query} onChange={setQuery} label={tx(T.search)} clearLabel={tx(T.search)} />
      </div>
      {(q.data?.teachers.length ?? 0) > 0 && (
        <p className="ts-key">
          {tx(T.keyMakeups)} {tx(T.keyExcuses)}
        </p>
      )}
      {(q.data?.teachers.length ?? 0) === 0 ? (
        <EmptyState title={tx(T.noTeachers)} />
      ) : (
        <div className="table-wrap ts-table-wrap">
          <table className="table ts-table stack-table">
              <thead>
                <tr>
                  <th scope="col">{tx(T.colTeacher)}</th>
                  <th scope="col" className="num">{tx(T.colHeld)}</th>
                  <th scope="col" className="num">{tx(T.colScheduled)}</th>
                  <th scope="col" className="num">{tx(T.colNotHeld)}</th>
                  <th scope="col" className="num">{tx(T.colUnreported)}</th>
                  <th scope="col" className="num">{tx(T.colAttendance)}</th>
                  <th scope="col" className="num">{tx(T.colOnTime)}</th>
                  <th scope="col" className="num" title={tx(T.keyMakeups)}>{jx(S.makeups)}</th>
                  <th scope="col" className="num" title={tx(T.keyExcuses)}>{jx(S.studentExcuses)}</th>
                  <th scope="col" className="num">{jx(S.teacherExcuses)}</th>
                  <th scope="col" className="num">{tx(T.colTrials)}</th>
                  <th scope="col" className="num">{tx(T.colTrialsSubscribed)}</th>
                  <th scope="col" className="num" title={tx(T.movesHint)}>{tx(T.colMoves)}</th>
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
                    <td className={quiet(r.held.lessons)} data-label={tx(T.colHeld)}>{fmt.lessonsHours(r.held)}</td>
                    <td className={quiet(r.scheduled.lessons)} data-label={tx(T.colScheduled)}>{fmt.lessonsHours(r.scheduled)}</td>
                    <td className={quiet(r.notHeld.lessons)} data-label={tx(T.colNotHeld)}>{fmt.number(r.notHeld.lessons)}</td>
                    <td className={r.unreported.lessons > 0 ? 'num ts-attention' : quiet(0)} data-label={tx(T.colUnreported)}>{fmt.number(r.unreported.lessons)}</td>
                    <td className={quiet(r.attendanceRate)} data-label={tx(T.colAttendance)}>{fmt.percent(r.attendanceRate)}</td>
                    <td className={quiet(r.reportsOnTimeRate)} data-label={tx(T.colOnTime)}>{fmt.percent(r.reportsOnTimeRate)}</td>
                    <td className={quiet(r.summary?.makeups.total)} data-label={jx(S.makeups)} title={tx(T.keyMakeups)}>{r.summary ? <span className="ltr">{`${fmt.number(r.summary.makeups.completed)} / ${fmt.number(r.summary.makeups.total)}`}</span> : '—'}</td>
                    <td className={quiet(r.summary ? r.summary.studentExcuses.beforeStart + r.summary.studentExcuses.afterStart : undefined)} data-label={jx(S.studentExcuses)} title={tx(T.keyExcuses)}>
                      {r.summary ? <span className="ltr">{`${fmt.number(r.summary.studentExcuses.beforeStart)} + ${fmt.number(r.summary.studentExcuses.afterStart)}`}</span> : '—'}
                    </td>
                    <td className={quiet(r.summary?.teacherExcuses)} data-label={jx(S.teacherExcuses)}>{r.summary ? fmt.number(r.summary.teacherExcuses) : '—'}</td>
                    <td className={quiet(r.trials?.total ?? 0)} data-label={tx(T.colTrials)}>{fmt.number(r.trials?.total ?? 0)}</td>
                    <td className={quiet(r.trials?.subscribed ?? 0)} data-label={tx(T.colTrialsSubscribed)}>{fmt.number(r.trials?.subscribed ?? 0)}</td>
                    <td className={quiet(r.movesByTeacher)} data-label={tx(T.colMoves)}>{r.movesByTeacher === undefined ? '—' : fmt.number(r.movesByTeacher)}</td>
                  </tr>
                ))}
              </tbody>
          </table>
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
  const fmt = useFormat()
  const q = useTeacherDetail(id, month)
  const d = q.data

  return (
    <>
      <button type="button" className="ts-back" onClick={onBack}>
        <Icon name="arrowBack" size={16} />
        {tx(T.back)}
      </button>
      <PageHeader title={d?.teacher.name ?? tx(T.title)} subtitle={tx(T.detailSubtitle, { month: fmt.month(month) })} actions={monthPicker} />
      {isForbidden(q.error) ? (
        <Denied />
      ) : (
        <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          {d && <DetailBody detail={d} />}
        </QueryBoundary>
      )}
    </>
  )
}

/** The month in one ruled line: what counted, and the three rates the server derives from it. */
function MonthLedger({ detail: d }: { detail: TeacherDetail }) {
  const tx = useCopy()
  const fmt = useFormat()
  const held = d.categories.find((c) => c.key === 'held')
  return (
    <div className="ledger ts-ledger">
      <div className="ledger__cell">
        <span className="ledger__label">{tx(T.totalCounted)}</span>
        <span className="ledger__value">{fmt.number(d.totals.counted.lessons)}</span>
        {held && <span className="ledger__note">{tx(T.heldOf, { n: fmt.number(held.lessons) })}</span>}
      </div>
      <div className="ledger__cell">
        <span className="ledger__label">{tx(T.attendance)}</span>
        <span className="ledger__value">{fmt.percent(d.rates.attendance)}</span>
        <span className="ledger__note">{tx(T.attendanceHint)}</span>
      </div>
      <div className="ledger__cell">
        <span className="ledger__label">{tx(T.completion)}</span>
        <span className="ledger__value">{fmt.percent(d.rates.completion)}</span>
        <span className="ledger__note">{tx(T.completionHint)}</span>
      </div>
      <div className="ledger__cell">
        <span className="ledger__label">{tx(T.reliability)}</span>
        <span className="ledger__value">{fmt.percent(d.rates.teacherReliability)}</span>
        <span className="ledger__note">{tx(T.reliabilityHint)}</span>
      </div>
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
      <MonthLedger detail={d} />
      {d.summary && <MonthSummaryPanel summary={d.summary} />}
      <h2 className="section-label ts-label">{tx(T.byOutcome)}</h2>
      <section className="ts-cats" aria-label={tx(T.title)}>
        {cards.map((c) => (
          <CategoryCard key={c.key} category={c} />
        ))}
      </section>

      <section className="ts-facts">
        <Fact title={tx(T.reports)}>
          <Metric label={tx(T.onTime)} value={`${fmt.percent(d.reports.onTimeRate)} · ${fmt.number(d.reports.onTime)}/${fmt.number(d.reports.reports)}`} />
          <Metric label={tx(T.medianDelay)} value={fmt.duration(d.reports.medianDelayMinutes)} />
        </Fact>
        <Fact title={tx(T.replies)}>
          <Metric label={tx(T.answered)} value={fmt.percent(d.replies.rate)} hint={tx(T.familyMessages, { n: fmt.number(d.replies.familyMessages) })} />
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
        {/* RQA-F8: the month summary above already counts make-ups (completed, scheduled, total);
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
          <Metric label={tx(T.trialsConversion)} value={fmt.percent(d.trials.conversionRate)} hint={tx(T.trialsConversionHint)} />
          {(d.trials.upcoming > 0 || d.trials.cancelled > 0) && (
            <p className="ts-muted ts-card__note">{tx(T.trialsOutside, { u: fmt.number(d.trials.upcoming), c: fmt.number(d.trials.cancelled) })}</p>
          )}
        </Fact>
      </section>

      <p className="ts-muted ts-previous">
        {tx(T.previous, { hours: fmt.hours(d.previous.held.minutes), month: fmt.month(d.previous.month) })}
      </p>
    </>
  )
}

/** One tick per lesson, grouped by lesson length. Past this many, a group is drawn at this length. */
const TICK_LIMIT = 160

function CategoryCard({ category: c }: { category: CategoryStats }) {
  const tx = useCopy()
  const fmt = useFormat()
  const label = tx(CATEGORY_LABEL[c.key])
  return (
    <article className={`ts-cat ts-cat--${CATEGORY_TONE[c.key]}${c.lessons === 0 ? ' ts-cat--none' : ''}`} aria-label={label}>
      <header className="ts-cat__head">
        <h3 className="ts-cat__title">{label}</h3>
        <span className="ts-cat__count">{fmt.number(c.lessons)}</span>
      </header>
      {c.byDuration.length === 0 ? (
        <p className="ts-muted ts-cat__empty">{tx(T.noData)}</p>
      ) : (
        <>
          <div className="ts-ticks" aria-hidden="true">
            {c.byDuration.map((b) => (
              <span key={b.durationMinutes} className="ts-ticks__run" style={{ ['--n' as string]: Math.min(b.lessons, TICK_LIMIT) }} />
            ))}
          </div>
          <ul className="ts-cat__rows">
            {c.byDuration.map((b) => (
              <li key={b.durationMinutes} className="ts-cat__row">
                <span>{tx(T.minutesLong, { m: fmt.number(b.durationMinutes) })}</span>
                <strong>{fmt.lessons(b.lessons)}</strong>
                <span className="ts-muted">{tx(T.total)}: {fmt.hours(b.minutes)}</span>
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
    <article className="ts-fact" aria-label={title}>
      <h2 className="section-label ts-fact__title">{title}</h2>
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
    // RQA-F2: the noun agrees with the number in Arabic ("٣ حصص", "ساعتان"), not a fixed singular.
    const hoursOf = (minutes: number) => {
      const h = Math.round((minutes / 60) * 10) / 10
      return countLabel(h, number(h), HOURS, locale)
    }
    const lessonsOf = (n: number) => countLabel(n, number(n), LESSONS, locale)
    const monthFmt = new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: 'long', year: 'numeric', timeZone: 'UTC' })
    return {
      number,
      hoursNumber,
      hours: (minutes: number | null) => (minutes === null ? tx(T.none) : hoursOf(minutes)),
      minutes: (m: number | null) => (m === null ? tx(T.none) : tx(T.minutesLong, { m: number(m) })),
      /** RQA-F8: "3 days 19 h", not "5,506 minutes". */
      duration: (m: number | null) => (m === null ? tx(T.none) : durationLabel(m, number, locale)),
      /** RQA-F8: "October 2026" / "أكتوبر ٢٠٢٦", never the raw "2026-10". */
      month: (ym: string) => (/^\d{4}-\d{2}$/.test(ym) ? monthFmt.format(new Date(`${ym}-01T00:00:00Z`)) : ym),
      percent: (r: number | null) =>
        r === null ? tx(T.none) : new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en', { style: 'percent', maximumFractionDigits: 0 }).format(r),
      lessons: lessonsOf,
      lessonsHours: (b: Bucket) => `${lessonsOf(b.lessons)} · ${hoursOf(b.minutes)}`,
    }
  }, [number, locale, tx])
}

/** A zero or a missing figure is set quietly, so the eye lands on what is there. */
function quiet(value: number | null | undefined): string {
  return value ? 'num' : 'num ts-zero'
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
