import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '@/core/api/errors'
import { Badge } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { Skeleton } from '@/shared/components/Skeleton'
import { ErrorState } from '@/shared/components/States'
import { useI18n } from '@/core/i18n/I18nProvider'
import { T, TS } from '../copy'
import { useTeacherDetail } from '../hooks'
import { MessageTeacher } from './MessageTeacher'
import { OutcomeBars } from './OutcomeBars'
import type { Level, Ranked } from './priority'
import { useReason } from './reason'
import { Pct, useCopy, useFormat } from './format'

export const LEVEL_TONE: Record<Level, 'danger' | 'waiting' | 'ok'> = { urgent: 'danger', watch: 'waiting', ok: 'ok' }

/**
 * One teacher's month beside the list (a row click): the three figures of the
 * row, then what the list leaves out (reliability, report delay, replies, the
 * month by outcome, trials, excuses, moves), one primary action (message the
 * teacher), the teacher's file, and the full-page record.
 */
export function TeacherSheet({
  item,
  month,
  fileHref,
  fullHref,
  onClose,
}: {
  item: Ranked
  month: string
  fileHref: string
  fullHref: string
  onClose: () => void
}) {
  const tx = useCopy()
  const fmt = useFormat()
  const reason = useReason()
  const { t } = useI18n()
  const { row, level, flags } = item
  const q = useTeacherDetail(row.teacher.id, month)
  const d = q.data
  const sentence = reason(item.clauses)
  // The month summary is the same server count on the list and on the record.
  const summary = d?.summary ?? row.summary

  return (
    <Dialog
      variant="sheet"
      title={row.teacher.name}
      onClose={onClose}
      actions={
        <Link className="btn btn--ghost btn--icon btn--sm" to={fullHref} aria-label={tx(TS.sheetExpand)} title={tx(TS.sheetExpand)}>
          <Icon name="expand" size={18} />
        </Link>
      }
      footer={
        <>
          {row.teacher.isActive && <MessageTeacher teacherId={row.teacher.id} teacherName={row.teacher.name} className="btn btn--primary" withIcon />}
          <Link className="btn" to={fileHref}>
            {tx(TS.openFile)}
          </Link>
        </>
      }
    >
      <div className="tsx-sheet">
        <p className="tsx-sheet__meta">
          <Badge tone={LEVEL_TONE[level]}>{tx(TS[level])}</Badge>
          <span>{fmt.month(month)}</span>
          {!row.teacher.isActive && <Badge tone="neutral">{tx(T.inactive)}</Badge>}
        </p>
        {sentence && <p className="tsx-sheet__reason">{sentence}</p>}

        <dl className="tsx-figs">
          <div className="tsx-fig">
            <dt>{tx(TS.shortLate)}</dt>
            <dd className={`tsx-fig__n${flags.late ? ' is-breach' : ''}${row.unreported.lessons === 0 ? ' is-zero' : ''}`}>{fmt.number(row.unreported.lessons)}</dd>
            {row.reportsOnTimeRate !== null && (
              <dd className={flags.onTime && level === 'watch' ? 'tsx-fig__sub is-watch' : 'tsx-fig__sub'}>
                <Pct value={row.reportsOnTimeRate} /> {tx(TS.onTime)}
              </dd>
            )}
          </div>
          <div className="tsx-fig">
            <dt>{tx(TS.shortAttendance)}</dt>
            <dd className={flags.attendance && level === 'watch' ? 'tsx-fig__n is-watch' : 'tsx-fig__n'}>
              <Pct value={row.attendanceRate} />
            </dd>
          </div>
          <div className="tsx-fig">
            <dt>{tx(TS.shortLessons)}</dt>
            <dd className="tsx-fig__n tsx-fig__n--ratio">
              <bdi dir="ltr" className="ltr">{`${fmt.number(row.held.lessons)} / ${fmt.number(row.scheduled.lessons)}`}</bdi>
            </dd>
            <dd className="tsx-fig__sub">{tx(TS.colLessonsKey)}</dd>
            {flags.noShow > 0 && <dd className="tsx-fig__sub is-breach">{tx(TS.missedByTeacher, { n: fmt.number(flags.noShow) })}</dd>}
          </div>
        </dl>

        {q.error instanceof ApiError && q.error.isForbidden ? (
          <p className="ts-denied" role="alert">
            <Icon name="lock" size={18} />
            <span>{t('common.forbidden')}</span>
          </p>
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
        ) : !d ? (
          <div className="tsx-sheet__loading" role="status" aria-label={t('common.loading')}>
            {[70, 90, 60, 80, 50].map((w, i) => (
              <Skeleton key={i} width={`${w}%`} height={16} />
            ))}
          </div>
        ) : (
          <>
            <section className="tsx-sheet__part" aria-label={tx(TS.rateRows)}>
              <dl className="tsx-facts">
                <Fact label={tx(T.reliability)} hint={tx(T.reliabilityHint)}>
                  <Pct value={d.rates.teacherReliability} />
                </Fact>
                <Fact label={tx(TS.medianDelay)}>{fmt.duration(d.reports.medianDelayMinutes)}</Fact>
                <Fact
                  label={tx(TS.replies)}
                  hint={d.replies.medianReplyMinutes !== null ? tx(TS.medianReply, { d: fmt.duration(d.replies.medianReplyMinutes) }) : undefined}
                >
                  <Pct value={d.replies.rate} />
                </Fact>
              </dl>
            </section>

            <section className="tsx-sheet__part" aria-labelledby="tsx-outcomes">
              <h3 id="tsx-outcomes" className="tsx-sheet__title">
                {tx(TS.outcomes)}
              </h3>
              <OutcomeBars categories={d.categories} />
            </section>

            <section className="tsx-sheet__part" aria-labelledby="tsx-more">
              <h3 id="tsx-more" className="tsx-sheet__title">
                {tx(TS.more)}
              </h3>
              <dl className="tsx-facts">
                <Fact label={tx(TS.trialsSubscribed)}>
                  {d.trials.total === 0 ? (
                    <span className="tsx-quiet">{tx(TS.noTrials)}</span>
                  ) : (
                    <bdi>{tx(TS.ofN, { a: fmt.number(d.trials.subscribed), b: fmt.number(d.trials.total) })}</bdi>
                  )}
                </Fact>
                {summary && (
                  <>
                    <Fact
                      label={tx(TS.studentExcuses)}
                      hint={tx(TS.studentExcusesSplit, { b: fmt.number(summary.studentExcuses.beforeStart), a: fmt.number(summary.studentExcuses.afterStart) })}
                    >
                      {fmt.number(summary.studentExcuses.total)}
                    </Fact>
                    <Fact label={tx(TS.teacherExcuses)}>{fmt.number(summary.teacherExcuses)}</Fact>
                    <Fact label={tx(TS.makeupsDone)}>
                      <bdi>{tx(TS.ofN, { a: fmt.number(summary.makeups.completed), b: fmt.number(summary.makeups.total) })}</bdi>
                    </Fact>
                  </>
                )}
                {d.movesByTeacher !== undefined && (
                  <Fact label={tx(T.moves)} hint={tx(TS.movesInfo)}>
                    {fmt.number(d.movesByTeacher)}
                  </Fact>
                )}
              </dl>
            </section>

            <Link className="card__link tsx-sheet__full" to={fullHref}>
              {tx(TS.fullStats)}
              <Icon name="chevronForward" size={16} />
            </Link>
          </>
        )}
      </div>
    </Dialog>
  )
}

function Fact({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="tsx-fact">
      <dt>
        {label}
        {hint && <span className="tsx-fact__hint">{hint}</span>}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}
