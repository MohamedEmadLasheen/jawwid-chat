import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '@/core/api/errors'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { Menu } from '@/shared/components/Menu'
import { MastFigures, PageHeader, type MastFigure } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { T, TS } from '../copy'
import { useTeacherStats } from '../hooks'
import { downloadCsv, toCsv } from './exportCsv'
import { LATE_REPORTS, LESSONS_AFTER, MORE_TEACHERS, Pct, TEACHERS, monogramName, percentText, useCopy, useCopyNodes, useFormat } from './format'
import { MessageTeacher } from './MessageTeacher'
import { matches, rank, totals, type Filter, type Level, type Ranked } from './priority'
import { useReason } from './reason'
import { TeacherSheet } from './TeacherSheet'
import { TEACHER_ATTENTION_THRESHOLDS as TH } from './thresholds'
import './stats.css'

/** Rows on track shown before "Show N more". */
const OK_SHOWN = 4
const LEVELS: Level[] = ['urgent', 'watch', 'ok']

/** The server said no: what is refused and who may open it. No retry, as a refusal is an answer. */
export function Denied() {
  const { t } = useI18n()
  const tx = useCopy()
  return (
    <div className="state state--forbidden tsx-denied" role="alert">
      <span className="state__icon" aria-hidden="true">
        <Icon name="lock" size={20} />
      </span>
      <div className="state__title">{t('common.forbidden')}</div>
      <div className="state__body">{tx(TS.deniedHint)}</div>
      <Link className="btn btn--sm" to="/today">
        {tx(TS.goToday)}
      </Link>
    </div>
  )
}

/**
 * Teacher statistics: who needs your intervention this month, first.
 *
 * One list ordered by need, never by performance: urgent (what can be settled
 * now), watch (trends), then on track. Each row carries the reason in words and
 * three figures (late reports, student attendance, lessons held); everything
 * else is in the side sheet a row click opens. The header's figures filter the
 * list. Every number is the server's; this page only compares them with
 * TEACHER_ATTENTION_THRESHOLDS.
 */
export function StatsList({
  month,
  monthPicker,
  tabs,
  filter,
  onFilter,
  fileHref,
  fullHref,
  needsActionHref,
}: {
  month: string
  monthPicker: ReactNode
  tabs?: ReactNode
  filter: Filter | null
  onFilter: (next: Filter | null) => void
  fileHref: (teacherId: string) => string
  fullHref: (teacherId: string) => string
  needsActionHref: string
}) {
  const tx = useCopy()
  const nodes = useCopyNodes()
  const fmt = useFormat()
  const reason = useReason()
  const { locale } = useI18n()
  const q = useTeacherStats(month)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const ranked = useMemo(
    () => (q.data ? rank(q.data.teachers, TH, new Intl.Collator(LOCALE_TAG[locale])) : []),
    [q.data, locale],
  )
  const sums = useMemo(() => totals(ranked), [ranked])
  const needle = query.trim().toLocaleLowerCase()
  const visible = useMemo(
    () => ranked.filter((r) => matches(r, filter) && (!needle || r.row.teacher.name.toLocaleLowerCase().includes(needle))),
    [ranked, filter, needle],
  )
  const open = openId ? ranked.find((r) => r.row.teacher.id === openId) ?? null : null
  // Narrowed by a figure or a search, every match is shown.
  const collapsing = !filter && !needle

  const forbidden = q.error instanceof ApiError && q.error.isForbidden
  const teachers = (n: number) => fmt.count(n, TEACHERS)
  const toggle = (key: Filter) => () => onFilter(filter === key ? null : key)
  const figures: MastFigure[] = q.data
    ? [
        {
          key: 'urgent',
          label: tx(TS.figUrgent),
          value: fmt.number(sums.urgent),
          note: tx(TS.figUrgentNote, { teachers: teachers(sums.teachers) }),
          tone: sums.urgent > 0 ? 'urgent' : 'quiet',
          onClick: toggle('urgent'),
          pressed: filter === 'urgent',
        },
        {
          key: 'late',
          label: tx(TS.figLate),
          value: fmt.number(sums.lateLessons),
          note: sums.lateLessons > 0 ? tx(TS.figLateNote, { teachers: teachers(sums.lateTeachers) }) : tx(TS.figLateNone),
          tone: sums.lateLessons > 0 ? undefined : 'quiet',
          onClick: toggle('late'),
          pressed: filter === 'late',
        },
        {
          key: 'attendance',
          label: tx(TS.figAttendance),
          value: fmt.number(sums.lowAttendance),
          note: nodes(TS.figAttendanceNote, { p: <Pct value={TH.attendanceWatch} /> }),
          tone: sums.lowAttendance > 0 ? undefined : 'quiet',
          onClick: toggle('attendance'),
          pressed: filter === 'attendance',
        },
        {
          key: 'noshow',
          label: tx(TS.figNoShow),
          value: sums.noShowLessons === null ? tx(T.none) : fmt.number(sums.noShowLessons),
          note:
            sums.noShowLessons === null
              ? undefined
              : sums.noShowLessons > 0
                ? tx(TS.figNoShowNote, { teachers: teachers(sums.noShowTeachers) })
                : tx(TS.figNoShowNone),
          tone: sums.noShowLessons ? undefined : 'quiet',
          onClick: toggle('noshow'),
          pressed: filter === 'noshow',
        },
      ]
    : []

  const exportCsv = () => {
    const head = [
      tx(T.colTeacher),
      tx(TS.csvPriority),
      tx(TS.colLate),
      tx(T.colOnTime),
      tx(TS.colAttendance),
      tx(TS.colLessons),
      tx(T.colScheduled),
      tx(TS.figNoShow),
      tx(TS.trialsSubscribed),
      tx(T.colTrials),
      tx(TS.csvReason),
    ]
    const rows = visible.map((r) => [
      r.row.teacher.name,
      tx(TS[r.level]),
      r.row.unreported.lessons,
      percentText(r.row.reportsOnTimeRate),
      percentText(r.row.attendanceRate),
      r.row.held.lessons,
      r.row.scheduled.lessons,
      r.row.summary ? r.row.summary.teacherNoShow : '',
      r.row.trials?.subscribed ?? '',
      r.row.trials?.total ?? '',
      reason(r.clauses),
    ])
    downloadCsv(`teacher-statistics-${month}.csv`, toCsv(head, rows))
  }

  const actions = (
    <>
      {!forbidden && q.data && q.data.teachers.length > 0 && (
        <Menu
          label={tx(TS.exportList)}
          triggerClassName="btn btn--sm tsx-export"
          trigger={
            <>
              <Icon name="download" size={18} />
              {tx(TS.exportList)}
            </>
          }
          items={[
            { key: 'csv', label: tx(TS.exportCsv), icon: 'fileArrowDown', onSelect: exportCsv },
            { key: 'print', label: tx(TS.print), icon: 'printer', onSelect: () => window.print() },
          ]}
        />
      )}
      {!forbidden && monthPicker}
    </>
  )

  const activeFigure = filter ? figures.find((f) => f.key === filter) : undefined

  return (
    <div className="tsx-page">
      {/* The tabs belong to the area, so they sit under the title; the figures sit on the list they filter. */}
      <PageHeader title={tx(T.title)} actions={actions} tabs={forbidden ? undefined : tabs} />
      {figures.length > 0 && (
        <div className="tsx-figures">
          <MastFigures figures={figures} />
        </div>
      )}
      {forbidden ? (
        <Denied />
      ) : (
        <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          {ranked.length === 0 ? (
            <section className="sheet">
              <EmptyState title={tx(T.noTeachers)} />
            </section>
          ) : (
            <section className="sheet tsx-list" aria-label={tx(T.title)}>
              <div className="sheet-bar">
                <SearchField value={query} onChange={setQuery} label={tx(T.search)} clearLabel={tx(T.search)} />
                {activeFigure && (
                  <div className="sheet-bar__end tsx-filtered">
                    <span>{activeFigure.label}</span>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => onFilter(null)}>
                      <Icon name="close" size={16} />
                      {tx(TS.showAll)}
                    </button>
                  </div>
                )}
              </div>
              {visible.length === 0 ? (
                <EmptyState title={needle ? tx(TS.noName) : tx(TS.noMatch)} />
              ) : (
                <table className="tsx-table">
                  <thead>
                    <tr>
                      <th scope="col">{tx(TS.colTeacher)}</th>
                      <th scope="col" className="num">
                        {tx(TS.colLate)}
                      </th>
                      <th scope="col" className="num">
                        {tx(TS.colAttendance)}
                      </th>
                      <th scope="col" className="num">
                        {tx(TS.colLessons)}
                      </th>
                      <th scope="col" className="tsx-act">
                        <span className="sr-only">{tx(T.open)}</span>
                      </th>
                    </tr>
                  </thead>
                  {LEVELS.map((level) => {
                    const items = visible.filter((r) => r.level === level)
                    if (items.length === 0) return null
                    const folded = level === 'ok' && collapsing && items.length > OK_SHOWN + 1
                    const askReports = level === 'urgent' && items.some((r) => r.flags.late) ? items.reduce((n, r) => n + r.row.unreported.lessons, 0) : 0
                    return (
                      <tbody key={level} className={`tsx-group tsx-group--${level}`}>
                        <tr className="tsx-ghead">
                          <th scope="colgroup" colSpan={5}>
                            <span className="tsx-ghead__in">
                              <span className={`tsx-dot tsx-dot--${level}`} aria-hidden="true" />
                              <span className="tsx-ghead__label">{tx(TS[level])}</span>
                              <span className="count">{fmt.number(items.length)}</span>
                              {askReports > 0 && (
                                <Link className="card__link tsx-ghead__link" to={needsActionHref}>
                                  {tx(TS.askReports, { reports: fmt.count(askReports, LATE_REPORTS) })}
                                </Link>
                              )}
                            </span>
                          </th>
                        </tr>
                        {items.map((r, i) => (
                          <Row
                            key={r.row.teacher.id}
                            item={r}
                            sentence={reason(r.clauses)}
                            folded={folded && !expanded && i >= OK_SHOWN}
                            onOpen={() => setOpenId(r.row.teacher.id)}
                            fileHref={fileHref(r.row.teacher.id)}
                            fullHref={fullHref(r.row.teacher.id)}
                          />
                        ))}
                        {folded && (
                          <tr className="tsx-morerow">
                            <td colSpan={5}>
                              <button type="button" className="tsx-more" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
                                {expanded ? tx(TS.showFewer) : tx(TS.showMore, { more: fmt.count(items.length - OK_SHOWN, MORE_TEACHERS) })}
                                <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={16} />
                              </button>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    )
                  })}
                </table>
              )}
              <p className="tsx-thresholds">
                {tx(TS.thresholdsUrgent, { late: fmt.count(TH.lateReportsUrgent, LESSONS_AFTER) })}{' '}
                {nodes(TS.thresholdsWatch, { att: <Pct value={TH.attendanceWatch} />, ot: <Pct value={TH.onTimeWatch} /> })}
              </p>
            </section>
          )}
        </QueryBoundary>
      )}
      {open && (
        <TeacherSheet
          item={open}
          month={month}
          fileHref={fileHref(open.row.teacher.id)}
          fullHref={fullHref(open.row.teacher.id)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

function Row({
  item,
  sentence,
  folded,
  onOpen,
  fileHref,
  fullHref,
}: {
  item: Ranked
  sentence: string
  folded: boolean
  onOpen: () => void
  fileHref: string
  fullHref: string
}) {
  const tx = useCopy()
  const fmt = useFormat()
  const navigate = useNavigate()
  const { row, level, flags } = item
  const name = row.teacher.name
  return (
    <tr className={`tsx-row tsx-row--${level}`} hidden={folded} onClick={onOpen}>
      <th scope="row">
        <div className="tsx-who">
          <Avatar name={monogramName(name)} seed={row.teacher.id} />
          <div className="tsx-who__text">
            <span className="tsx-who__line">
              <button type="button" className="tsx-name" dir="auto" onClick={(e) => (e.stopPropagation(), onOpen())}>
                {name}
              </button>
              {!row.teacher.isActive && <Badge tone="neutral">{tx(T.inactive)}</Badge>}
            </span>
            {sentence && <span className="tsx-reason">{sentence}</span>}
          </div>
        </div>
      </th>
      <td className="num tsx-cell" data-label={tx(TS.shortLate)}>
        <span className={`tsx-n tsx-n--lead${flags.late ? ' is-breach' : ''}${row.unreported.lessons === 0 ? ' is-zero' : ''}`}>
          {fmt.number(row.unreported.lessons)}
        </span>
        {row.reportsOnTimeRate !== null && (
          <span className={flags.onTime && level === 'watch' ? 'tsx-sub is-watch' : 'tsx-sub'}>
            <Pct value={row.reportsOnTimeRate} /> {tx(TS.onTime)}
          </span>
        )}
      </td>
      <td className="num tsx-cell" data-label={tx(TS.shortAttendance)}>
        <span className={`tsx-n${flags.attendance && level === 'watch' ? ' is-watch' : ''}${row.attendanceRate === null ? ' is-zero' : ''}`}>
          <Pct value={row.attendanceRate} />
        </span>
      </td>
      <td className="num tsx-cell" data-label={tx(TS.cellLessons)}>
        <bdi dir="ltr" className={`ltr tsx-ratio${row.scheduled.lessons === 0 ? ' is-zero' : ''}`}>
          {`${fmt.number(row.held.lessons)} / ${fmt.number(row.scheduled.lessons)}`}
        </bdi>
        {/* A no-show makes the row urgent on its own: its count is the red figure. */}
        {flags.noShow > 0 && <span className="tsx-sub is-breach">{tx(TS.missedByTeacher, { n: fmt.number(flags.noShow) })}</span>}
      </td>
      <td className="tsx-act">
        <RowActions
          label={`${tx(TS.moreActions)}: ${name}`}
          primary={
            level === 'urgent' && row.teacher.isActive ? (
              <MessageTeacher teacherId={row.teacher.id} teacherName={name} />
            ) : (
              <button type="button" className="btn btn--sm tsx-open" onClick={onOpen} aria-label={`${tx(T.open)}: ${name}`}>
                {tx(T.open)}
              </button>
            )
          }
          more={[
            { key: 'file', label: tx(TS.openFile), icon: 'user', onSelect: () => navigate(fileHref) },
            { key: 'full', label: tx(TS.fullStats), icon: 'chart', onSelect: () => navigate(fullHref) },
          ]}
        />
      </td>
    </tr>
  )
}
