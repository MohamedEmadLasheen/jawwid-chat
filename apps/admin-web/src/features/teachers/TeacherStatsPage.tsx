import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '@/core/api/errors'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { HOURS, LESSONS, countLabel, durationLabel } from '@/core/i18n/counts'
import { Avatar } from '@/shared/components/Avatar'
import { PageHeader, type MastFigure } from '@/shared/components/PageHeader'
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
 * admin. The list is a ledger to compare teachers down the page: six columns,
 * each a figure with what qualifies it under it. `?teacher=<id>` is one
 * teacher's month as a record: the key figures in the masthead, every outcome
 * as a sheet with one tick a lesson, and what only Chat can know beside them.
 * Every number comes from the server; this page counts nothing itself.
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
        {teacherId ? (
          <TeacherDetailView id={teacherId} month={month} monthPicker={monthPicker} />
        ) : (
          <>
            {/* The operators' Teachers area shows its tabs; the super admin's Reports section is one page. */}
            <PageHeader title={tx(T.title)} subtitle={tx(T.subtitle)} actions={monthPicker} tabs={inTeachersArea ? <TeachersAreaTabs /> : undefined} />
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
      <section className="sheet" aria-label={tx(T.title)}>
        <div className="sheet-bar">
          <SearchField value={query} onChange={setQuery} label={tx(T.search)} clearLabel={tx(T.search)} />
        </div>
        {(q.data?.teachers.length ?? 0) === 0 ? (
          <EmptyState title={tx(T.noTeachers)} />
        ) : (
          <div className="table-wrap ts-table-wrap">
            <table className="table ts-table stack-table">
              <thead>
                <tr>
                  <th scope="col">{tx(T.colTeacher)}</th>
                  <th scope="col">
                    {tx(T.colHeld)}
                    <span className="ts-th-key">{tx(T.keyHeld)}</span>
                  </th>
                  <th scope="col">{tx(T.colAttendance)}</th>
                  <th scope="col">
                    {tx(T.colOnTime)}
                    <span className="ts-th-key">{tx(T.colUnreported)}</span>
                  </th>
                  <th scope="col">
                    {tx(T.colExcuses)}
                    <span className="ts-th-key">{tx(T.keyExcuses)}</span>
                  </th>
                  <th scope="col">
                    {tx(T.colTrials)}
                    <span className="ts-th-key">{tx(T.keyTrials)}</span>
                  </th>
                  <th scope="col" className="cell-actions">
                    <span className="sr-only">{tx(T.open)}</span>
                  </th>
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
                    <td className={quiet(r.held.lessons)} data-label={tx(T.colHeld)}>
                      <span className="ts-fig">{fmt.lessonsHours(r.held)}</span>
                      <span className="ts-sub">
                        {tx(T.colScheduled)}: {fmt.number(r.scheduled.lessons)} · {tx(T.colNotHeld)}: {fmt.number(r.notHeld.lessons)}
                      </span>
                    </td>
                    <td className={quiet(r.attendanceRate)} data-label={tx(T.colAttendance)}>
                      <span className="ts-fig">{fmt.percent(r.attendanceRate)}</span>
                    </td>
                    <td className={quiet(r.reportsOnTimeRate)} data-label={tx(T.colOnTime)}>
                      <span className="ts-fig">{fmt.percent(r.reportsOnTimeRate)}</span>
                      <span className={r.unreported.lessons > 0 ? 'ts-sub ts-attention' : 'ts-sub'}>
                        {tx(T.colUnreported)}: {fmt.number(r.unreported.lessons)}
                      </span>
                    </td>
                    <td className={quiet(r.summary ? r.summary.studentExcuses.total + r.summary.teacherExcuses : undefined)} data-label={tx(T.colExcuses)}>
                      {r.summary ? (
                        <>
                          <span className="ts-fig">
                            <span className="ltr">{`${fmt.number(r.summary.studentExcuses.beforeStart)} + ${fmt.number(r.summary.studentExcuses.afterStart)}`}</span>
                            <span className="ts-fig__and"> · {jx(S.teacherExcuses)}: {fmt.number(r.summary.teacherExcuses)}</span>
                          </span>
                          <span className="ts-sub">
                            {jx(S.makeups)}: <span className="ltr">{`${fmt.number(r.summary.makeups.completed)} / ${fmt.number(r.summary.makeups.total)}`}</span>
                          </span>
                        </>
                      ) : (
                        <span className="ts-fig">—</span>
                      )}
                    </td>
                    <td className={quiet(r.trials?.total ?? 0)} data-label={tx(T.colTrials)}>
                      <span className="ts-fig">
                        <span className="ltr">{`${fmt.number(r.trials?.subscribed ?? 0)} / ${fmt.number(r.trials?.total ?? 0)}`}</span>
                      </span>
                      {r.movesByTeacher !== undefined && (
                        <span className="ts-sub" title={tx(T.movesHint)}>
                          {tx(T.colMoves)}: {fmt.number(r.movesByTeacher)}
                        </span>
                      )}
                    </td>
                    <td className="cell-actions stack-actions">
                      <button type="button" className="btn btn--sm" onClick={() => onOpen(r.teacher.id)} aria-label={`${tx(T.open)}: ${r.teacher.name}`}>
                        {tx(T.open)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
}: {
  id: string
  month: string
  monthPicker: React.ReactNode
}) {
  const tx = useCopy()
  const fmt = useFormat()
  const [params] = useSearchParams()
  const q = useTeacherDetail(id, month)
  const d = q.data
  // The way back keeps the month: the list this record belongs to.
  const back = new URLSearchParams(params)
  back.delete('teacher')
  const held = d?.categories.find((c) => c.key === 'held')
  const figures: MastFigure[] = d
    ? [
        { key: 'counted', label: tx(T.totalCounted), value: fmt.number(d.totals.counted.lessons), note: held ? tx(T.heldOf, { n: fmt.number(held.lessons) }) : undefined },
        { key: 'attendance', label: tx(T.attendance), value: fmt.percent(d.rates.attendance), note: tx(T.attendanceHint), tone: 'key' },
        { key: 'completion', label: tx(T.completion), value: fmt.percent(d.rates.completion), note: tx(T.completionHint) },
        { key: 'reliability', label: tx(T.reliability), value: fmt.percent(d.rates.teacherReliability), note: tx(T.reliabilityHint) },
      ]
    : []

  return (
    <>
      <PageHeader
        back={{ to: `?${back.toString()}`, label: tx(T.back) }}
        lead={d ? <Avatar name={d.teacher.name} seed={d.teacher.id} size="lg" /> : undefined}
        title={d?.teacher.name ?? tx(T.title)}
        subtitle={tx(T.detailSubtitle, { month: fmt.month(month) })}
        figures={figures}
        actions={monthPicker}
      />
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

function DetailBody({ detail: d }: { detail: TeacherDetail }) {
  const tx = useCopy()
  const fmt = useFormat()
  // Every counted category is always shown (a zero is information); the
  // information-only ones appear when they have something to show.
  const cards = d.categories.filter((c) => c.counted || c.key === 'upcoming' || c.lessons > 0)

  return (
    <div className="split split--wide-aside">
      <div className="ts-detail">
        {d.summary && (
          <section className="sheet ts-glance">
            <MonthSummaryPanel summary={d.summary} />
          </section>
        )}
        <section className="ts-cats" aria-label={tx(T.title)}>
          {cards.map((c) => (
            <CategoryCard key={c.key} category={c} />
          ))}
        </section>
        <p className="ts-muted ts-previous">
          {tx(T.previous, { hours: fmt.hours(d.previous.held.minutes), month: fmt.month(d.previous.month) })}
        </p>
      </div>

      <aside className="ts-facts">
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
          <Metric label={tx(T.trialsConversion)} value={fmt.percent(d.trials.conversionRate)} hint={tx(T.trialsConversionHint)} />
          {(d.trials.upcoming > 0 || d.trials.cancelled > 0) && (
            <p className="ts-muted ts-card__note">{tx(T.trialsOutside, { u: fmt.number(d.trials.upcoming), c: fmt.number(d.trials.cancelled) })}</p>
          )}
        </Fact>
      </aside>
    </div>
  )
}

/** One tick per lesson, grouped by lesson length. Past this many, a group is drawn at this length. */
const TICK_LIMIT = 160

function CategoryCard({ category: c }: { category: CategoryStats }) {
  const tx = useCopy()
  const fmt = useFormat()
  const label = tx(CATEGORY_LABEL[c.key])
  return (
    <article className={`sheet ts-cat ts-cat--${CATEGORY_TONE[c.key]}${c.lessons === 0 ? ' ts-cat--none' : ''}`} aria-label={label}>
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
    <article className="aside-group ts-fact" aria-label={title}>
      <h2 className="aside-group__title">{title}</h2>
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
