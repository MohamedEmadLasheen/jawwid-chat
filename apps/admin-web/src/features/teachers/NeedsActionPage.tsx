import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { journeyApi, journeyKeys, type CorrectionRequest } from '@/features/journey/api'
import { LessonRecordDialog } from '@/features/journey/LessonRecordDialog'
import { J } from '@/features/journey/copy'
import { useI18n } from '@/core/i18n/I18nProvider'
import { relativeTime } from '@/features/admin/copy'
import type { MenuItem } from '@/shared/components/Menu'
import { PageHeader, type MastFigure } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { ActionDialog, type FieldSpec, type FieldValue } from './ActionDialog'
import { TeachersAreaTabs } from './area'
import type { Pair } from './copy'
import { opsApi, type BlockedOccurrence, type LessonDto, type MakeupAction, type ScheduleRequestDto } from './opsApi'
import { O, WEEKDAY, fill, formatDay, formatMinutes } from './opsCopy'
import { ACADEMY_ZONE, clockIn, whenIn } from '@/core/time/academyTime'
import { BlockedScheduleDialog } from './LessonDialogs'
import { dayLabel, weeklyLabel } from './WeeklyChangeDialog'
import { useNeedsAction, useOp } from './opsHooks'
import './teachers.css'
import './rows.css'

type QueueKey = 'overdue' | 'awaiting' | 'rulings' | 'makeups' | 'requests' | 'blocked' | 'corrections' | 'returning'
type Pending = { title: string; intro?: string; fields: FieldSpec[]; submit: (v: FieldValue) => Promise<unknown> } | null

/**
 * The Teachers department's daily queue (GET /lessons/needs-action): lessons
 * still without an outcome, late apologies to rule on, teacher-cancelled
 * lessons nobody replaced, families' and teachers' regular-time requests
 * (PD-31: before -> after, flagged "no longer free" before anyone approves),
 * weekly lessons the generator could not create, and pauses ending soon.
 *
 * The masthead counts what waits (the first four queues that hold something)
 * and filters to one; each queue is a sheet of rows; a row states the one
 * decision most often taken for it and keeps the others behind "⋯". The
 * server re-checks every decision.
 */
export function NeedsActionPage() {
  const tx = useTx()
  const { locale, number } = useI18n()
  const q = useNeedsAction()
  const [dialog, setDialog] = useState<Pending>(null)
  const op = useOp((f: () => Promise<unknown>) => f())
  const run = (title: string, fields: FieldSpec[], submit: (v: FieldValue) => Promise<unknown>, intro?: string) =>
    setDialog({ title, intro, fields, submit: (v) => op.mutateAsync(() => submit(v)) })

  const [scheduling, setScheduling] = useState<BlockedOccurrence | null>(null)
  // PD-35: report corrections asked of the teachers, and how they were answered.
  const qc = useQueryClient()
  const corrections = useQuery({ queryKey: journeyKeys.corrections('all'), queryFn: () => journeyApi.corrections('all') })
  const correctionRows = (corrections.data?.requests ?? []).slice(0, 50)
  const openCorrections = correctionRows.filter((r) => r.status === 'open').length
  const [historyOf, setHistoryOf] = useState<string | null>(null)
  const [askOf, setAskOf] = useState<string | null>(null)

  const d = q.data
  const blocked = d?.blockedOccurrences ?? []
  const empty =
    d &&
    d.overdue.length + d.awaitingClose.length + d.rulings.length + d.makeupsOverdue.length + d.scheduleRequests.length + d.returningSoon.length + blocked.length + openCorrections === 0

  // The queues that hold something; the masthead shows the first four and filters to one.
  const [only, setOnly] = useState<QueueKey | null>(null)
  const queues: Array<{ key: QueueKey; label: string; count: number; late?: boolean }> = d
    ? [
        { key: 'overdue' as const, label: tx(O.overdue), count: d.overdue.length, late: true },
        { key: 'rulings' as const, label: tx(O.rulings), count: d.rulings.length },
        { key: 'makeups' as const, label: tx(O.makeups), count: d.makeupsOverdue.length },
        { key: 'requests' as const, label: tx(O.requests), count: d.scheduleRequests.length },
        { key: 'awaiting' as const, label: tx(O.awaiting), count: d.awaitingClose.length },
        { key: 'blocked' as const, label: tx(O.blocked), count: blocked.length },
        { key: 'corrections' as const, label: tx(CORRECTIONS), count: correctionRows.length },
        { key: 'returning' as const, label: tx(O.returning), count: d.returningSoon.length },
      ].filter((f) => f.count > 0)
    : []
  const active = only && queues.some((f) => f.key === only) ? only : null
  const show = (key: QueueKey) => active === null || active === key
  const figures: MastFigure[] = queues.slice(0, 4).map((f) => ({
    key: f.key,
    label: f.label,
    value: number(f.count),
    tone: f.late ? 'urgent' : undefined,
    onClick: () => setOnly(active === f.key ? null : f.key),
    pressed: active === f.key,
  }))

  const recordStudentAbsent = (l: LessonDto) => run(tx(O.studentAbsent), [noteField(false)], (v) => opsApi.absence(l.id, v('note') || undefined))
  const noteField = (required: boolean, label: Pair = required ? O.note : O.noteOptional): FieldSpec => ({ key: 'note', label, type: 'textarea', required })
  /**
   * A lesson with no outcome. One that ended over a day ago states "Ask for the
   * report" (the teacher is reminded, with a reason); one that just ended states
   * the outcome most often recorded. The rest is behind the menu.
   */
  const lessonActions = (l: LessonDto, late = false) => ({
    primary: late ? (
      <button type="button" className="btn btn--sm btn--primary" onClick={() => setAskOf(l.id)}>
        {tx(J.requestReport)}
      </button>
    ) : (
      <button type="button" className="btn btn--sm" onClick={() => recordStudentAbsent(l)}>
        {tx(O.studentAbsent)}
      </button>
    ),
    more: [
      ...(late ? [{ key: 'student', label: tx(O.studentAbsent), icon: 'userCheck' as const, onSelect: () => recordStudentAbsent(l) }] : []),
      { key: 'teacher', label: tx(O.teacherAbsent), icon: 'userMinus', onSelect: () => run(tx(O.teacherAbsent), [noteField(true)], (v) => opsApi.teacherNoShow(l.id, v('note'))) },
      { key: 'cancel', label: tx(O.cancel), icon: 'calendarX', danger: true, onSelect: () => run(tx(O.cancel), [{ key: 'reason', label: O.reason, type: 'textarea', required: true }], (v) => opsApi.cancel(l.id, v('reason'))) },
    ] satisfies MenuItem[],
  })
  const moreFor = (name: string) => fill(tx(MORE), { name })

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader title={tx(O.needsTitle)} subtitle={tx(O.needsSubtitle)} figures={figures} tabs={<TeachersAreaTabs />} />
        <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          {empty && (
            <section className="sheet">
              <EmptyState title={tx(O.allClear)} hint={tx(O.allClearHint)} />
            </section>
          )}
          {d && (
            <>
              <Section show={show('overdue')} late title={tx(O.overdue)} hint={tx(O.overdueHint)} count={d.overdue.length}>
                {d.overdue.map((l) => (
                  <LessonRow key={l.id} lesson={l} late {...lessonActions(l, true)} label={moreFor(l.learner.name)} />
                ))}
              </Section>
              <Section show={show('rulings')} title={tx(O.rulings)} hint={tx(O.rulingsHint)} count={d.rulings.length}>
                {d.rulings.map((r) => (
                  <LessonRow
                    key={r.id}
                    lesson={r.lesson}
                    detail={
                      <span>
                        {tx(O.reason)}: <bdi>{r.reason}</bdi>
                      </span>
                    }
                    primary={
                      <button type="button" className="btn btn--sm btn--primary" onClick={() => run(tx(O.excuse), [noteField(false)], (v) => opsApi.decideRuling(r.id, { decision: 'excused', note: v('note') || undefined }))}>
                        {tx(O.excuse)}
                      </button>
                    }
                    more={[
                      { key: 'credit', label: tx(O.credit), icon: 'xCircle', onSelect: () => run(tx(O.credit), [noteField(false)], (v) => opsApi.decideRuling(r.id, { decision: 'teacher_credited', note: v('note') || undefined })) },
                    ]}
                    label={moreFor(r.lesson.learner.name)}
                  />
                ))}
              </Section>
              <Section show={show('makeups')} title={tx(O.makeups)} hint={tx(O.makeupsHint)} count={d.makeupsOverdue.length}>
                {d.makeupsOverdue.map((l) => (
                  <LessonRow
                    key={l.id}
                    lesson={l}
                    late
                    primary={
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        onClick={() =>
                          run(
                            tx(O.resolve),
                            [
                              {
                                key: 'action',
                                label: O.action,
                                type: 'select',
                                options: [
                                  { value: 'substitute_teacher', label: O.makeupSubstitute },
                                  { value: 'family_credit', label: O.makeupCredit },
                                  { value: 'package_extension', label: O.makeupExtension },
                                  { value: 'waived', label: O.makeupWaived },
                                ],
                              },
                              noteField(false),
                            ],
                            (v) => opsApi.resolveMakeup(l.id, { action: v('action') as MakeupAction, note: v('note') || undefined }),
                          )
                        }
                      >
                        {tx(O.resolve)}
                      </button>
                    }
                    label={moreFor(l.learner.name)}
                  />
                ))}
              </Section>
              <Section show={show('requests')} title={tx(O.requests)} count={d.scheduleRequests.length}>
                {d.scheduleRequests.map((r) => (
                  <ScheduleRequestRow
                    key={r.id}
                    r={r}
                    label={moreFor(r.learner.name)}
                    onApprove={() => run(tx(O.approve), [noteField(false)], (v) => opsApi.decideScheduleRequest(r.id, { decision: 'approved', note: v('note') || undefined }))}
                    onReject={() => run(tx(O.reject), [noteField(true)], (v) => opsApi.decideScheduleRequest(r.id, { decision: 'rejected', note: v('note') }))}
                  />
                ))}
              </Section>
              <Section show={show('awaiting')} title={tx(O.awaiting)} count={d.awaitingClose.length}>
                {d.awaitingClose.map((l) => (
                  <LessonRow key={l.id} lesson={l} {...lessonActions(l)} label={moreFor(l.learner.name)} />
                ))}
              </Section>
              <Section show={show('blocked')} title={tx(O.blocked)} hint={tx(O.blockedHint)} count={blocked.length}>
                {blocked.map((b) => (
                  <div className="rowx" key={b.id} data-blocked={b.id}>
                    <div className="rw-who">
                      <span className="rw-who__text">
                        <strong className="rw-name">
                          <bdi>{b.learner.name}</bdi>
                        </strong>
                        <span className="rw-sub">
                          <bdi>{b.teacher.name}</bdi> · <bdi>{whenIn(b.startsAt, ACADEMY_ZONE, locale)}</bdi> · {formatMinutes(minutesBetween(b.startsAt, b.endsAt), locale)}
                        </span>
                      </span>
                    </div>
                    <div className="rw-meta rw-meta--wide">
                      {b.reason === 'teacher_changed' && <span>{tx(O.blockedTeacherChanged)} </span>}
                      <span>
                        {fill(tx(O.blockedBy), {
                          kind: tx(BLOCKER_KIND[b.blockedBy.kind] ?? BLOCKER_KIND.regular!),
                          time: `${clockIn(b.blockedBy.startsAt, ACADEMY_ZONE, locale)}–${clockIn(b.blockedBy.endsAt, ACADEMY_ZONE, locale)}`,
                        })}
                      </span>
                    </div>
                    <div className="cell-actions">
                      <RowActions
                        primary={
                          <button type="button" className="btn btn--sm btn--primary" onClick={() => setScheduling(b)}>
                            {tx(O.scheduleElsewhere)}
                          </button>
                        }
                        more={[{ key: 'dismiss', label: tx(O.dismiss), icon: 'close', onSelect: () => run(tx(O.dismiss), [noteField(false)], (v) => opsApi.dismissBlocked(b.id, v('note') || undefined)) }]}
                        label={moreFor(b.learner.name)}
                      />
                    </div>
                  </div>
                ))}
              </Section>
              <Section show={show('corrections')} title={tx(CORRECTIONS)} hint={tx(CORRECTIONS_HINT)} count={correctionRows.length}>
                {correctionRows.map((r) => (
                  <CorrectionRow
                    key={r.id}
                    r={r}
                    onHistory={() => setHistoryOf(r.lessonId)}
                    onWithdraw={() =>
                      run(tx(WITHDRAW), [], () =>
                        journeyApi.withdrawCorrection(r.id).then(() => qc.invalidateQueries({ queryKey: ['journey', 'corrections'] })),
                      )
                    }
                  />
                ))}
              </Section>
              <Section show={show('returning')} title={tx(O.returning)} count={d.returningSoon.length}>
                {d.returningSoon.map((r) => (
                  <div className="rowx" key={r.suspensionId}>
                    <div className="rw-who">
                      <span className="rw-who__text">
                        <strong className="rw-name">
                          <bdi>{r.learner.name}</bdi>
                        </strong>
                        <span className="rw-sub">
                          {tx(O.returnOn)}: {formatDay(r.returnOn, locale)}
                        </span>
                      </span>
                    </div>
                    <div className="cell-actions">
                      <RowActions
                        primary={
                          <button type="button" className="btn btn--sm" onClick={() => run(tx(O.extend), [{ key: 'returnOn', label: O.returnOn, type: 'date', required: true, initial: r.returnOn }], (v) => opsApi.extendSuspension(r.suspensionId, v('returnOn')))}>
                            {tx(O.extend)}
                          </button>
                        }
                        label={moreFor(r.learner.name)}
                      />
                    </div>
                  </div>
                ))}
              </Section>
            </>
          )}
        </QueryBoundary>
        {dialog && (
          <ActionDialog title={dialog.title} intro={dialog.intro} fields={dialog.fields} onSubmit={dialog.submit} onClose={() => setDialog(null)} />
        )}
        {scheduling && <BlockedScheduleDialog item={scheduling} onClose={() => setScheduling(null)} />}
        {askOf && <LessonRecordDialog lessonId={askOf} conversationId="" initialMode="request" onClose={() => setAskOf(null)} />}
        {historyOf && <LessonRecordDialog lessonId={historyOf} conversationId="" initialMode="history" onClose={() => setHistoryOf(null)} />}
      </div>
    </div>
  )
}

const MORE: Pair = { en: 'More actions: {name}', ar: 'إجراءات أخرى: {name}' }

/** The kind of the lesson that blocked a weekly one, inside a sentence. */
const BLOCKER_KIND: Record<string, Pair> = {
  regular: { en: 'regular', ar: 'أساسية' },
  makeup: { en: 'make-up', ar: 'تعويضية' },
  trial: { en: 'trial', ar: 'تجريبية' },
}

function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000)
}

/**
 * PD-31: a regular-time request as before -> after, who asked, from when, and
 * each requested time's free flag. When a requested time was taken since
 * (`stillFree: false`), Approve is disabled -- it would fail -- and Reject stays.
 * An older server sends only `slots`: they are shown as before.
 */
function ScheduleRequestRow({ r, label, onApprove, onReject }: { r: ScheduleRequestDto; label: string; onApprove: () => void; onReject: () => void }) {
  const tx = useTx()
  const { locale } = useI18n()
  const stale = r.stillFree === false
  const warnId = `nlf-${r.id}`
  const legacy = (xs: Array<{ weekday: number; start: string }>) =>
    xs.map((s) => `${tx(WEEKDAY[s.weekday] ?? { en: '?', ar: '?' })} ${s.start}`).join(' · ')
  return (
    <div className={`rowx rowx--top${stale ? ' rowx--problem' : ''}`} data-request={r.id}>
      <div className="rw-who">
        <span className="rw-who__text">
          <strong className="rw-name">
            <bdi>{r.learner.name}</bdi>
          </strong>
          {r.requestedBy && (
            <span className="rw-sub" dir="auto">
              {fill(tx(r.requestedBy.kind === 'teacher' ? O.requestedByTeacher : O.requestedByFamily), { name: r.requestedBy.name })}
              {r.teacher ? ` · ${tx(O.teacher)}: ${r.teacher.name}` : ''}
            </span>
          )}
        </span>
      </div>
      <div className="rw-meta rw-meta--wide">
        {r.requested ? (
          <dl className="ts-diff">
            <dt>{tx(O.before)}</dt>
            <dd>{r.current && r.current.length ? r.current.map((c) => weeklyLabel(c.nextStartsAt, locale)).join(' · ') : tx(O.none)}</dd>
            <dt>{tx(O.after)}</dt>
            <dd>
              <ul className="ts-diff__slots">
                {r.requested.map((s) => (
                  <li key={`${s.weekday}|${s.start}`} className={s.free ? 'ts-slot--free' : 'ts-slot--busy'}>
                    {weeklyLabel(s.nextStartsAt, locale)} <span className="ts-slot__flag">({tx(s.free ? O.free : O.notFree)})</span>
                  </li>
                ))}
              </ul>
            </dd>
            {r.effectiveFrom && (
              <>
                <dt>{tx(O.fromDate)}</dt>
                <dd>{dayLabel(r.effectiveFrom, locale)}</dd>
              </>
            )}
          </dl>
        ) : (
          <span>
            {tx(O.requested)}: {legacy(r.slots)}
          </span>
        )}
        {r.note && (
          <span className="ts-note" dir="auto">
            {r.note}
          </span>
        )}
        {stale && (
          <p id={warnId} className="ts-stale" role="note">
            {tx(O.noLongerFree)}
          </p>
        )}
      </div>
      <div className="cell-actions">
        <RowActions
          primary={
            <button type="button" className="btn btn--sm btn--primary" disabled={stale} aria-describedby={stale ? warnId : undefined} onClick={onApprove}>
              {tx(O.approve)}
            </button>
          }
          more={[{ key: 'reject', label: tx(O.reject), icon: 'xCircle', danger: true, onSelect: onReject }]}
          label={label}
        />
      </div>
    </div>
  )
}

// PD-35: report corrections.
const CORRECTIONS: Pair = { en: 'Report corrections', ar: 'تصحيح التقارير' }
const CORRECTIONS_HINT: Pair = {
  en: 'Asked of the teachers from a lesson record. The teacher edits the report; open the history to see what changed.',
  ar: 'طُلبت من المعلمين من سجل الحصة. يعدّل المعلم التقرير؛ افتح السجل لترى ما تغيّر.',
}
const WITHDRAW: Pair = { en: 'Withdraw', ar: 'سحب الطلب' }
const SEE_CHANGES: Pair = { en: 'See changes', ar: 'عرض التغييرات' }
const CORRECTION_STATUS: Record<CorrectionRequest['status'], Pair> = {
  open: { en: 'Waiting for the teacher', ar: 'بانتظار المعلم' },
  corrected: { en: 'Corrected', ar: 'تم التصحيح' },
  filed: { en: 'Report filed', ar: 'تم إرسال التقرير' },
  withdrawn: { en: 'Withdrawn', ar: 'سُحب' },
}
const BY_STAFF: Pair = { en: 'by staff', ar: 'من الإدارة' }

function CorrectionRow({ r, onHistory, onWithdraw }: { r: CorrectionRequest; onHistory: () => void; onWithdraw: () => void }) {
  const tx = useTx()
  const { dateTime } = useI18n()
  return (
    <div className="rowx">
      <div className="rw-who">
        <span className="rw-who__text">
          <strong className="rw-name">
            <bdi>{r.learner.name}</bdi>
          </strong>
          <span className="rw-sub">
            <bdi>{r.teacher.name}</bdi> · <bdi>{dateTime(r.lessonStartsAt)}</bdi>
          </span>
        </span>
      </div>
      <div className="rw-meta rw-meta--wide">
        <span dir="auto">{r.reason}</span>
        <span className="rw-sub">
          {tx(CORRECTION_STATUS[r.status])}
          {r.resolvedByKind === 'staff' && r.status !== 'withdrawn' ? ` (${tx(BY_STAFF)})` : ''}
          {r.askedVersion !== null && r.resolvedVersion !== null ? ` · v${r.askedVersion} → v${r.resolvedVersion}` : ''}
        </span>
      </div>
      <div className="cell-actions">
        {r.status === 'open' ? (
          <button type="button" className="btn btn--sm" onClick={onWithdraw}>
            {tx(WITHDRAW)}
          </button>
        ) : r.status !== 'withdrawn' ? (
          <button type="button" className="btn btn--sm" onClick={onHistory}>
            {tx(SEE_CHANGES)}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** One queue: a sheet with its name, its count and its rule; left out when it holds nothing (or the masthead shows another). */
function Section({ title, hint, count, late, show = true, children }: { title: string; hint?: string; count: number; late?: boolean; show?: boolean; children: ReactNode }) {
  const { number } = useI18n()
  if (count === 0 || !show) return null
  return (
    <section className="sheet ts-queue" aria-label={title}>
      <header className="sheet__head">
        <div className="sheet__heading">
          <h2 className="sheet__title">
            {title}
            <span className={late ? 'count count--urgent' : 'count count--quiet'}>{number(count)}</span>
          </h2>
          {hint && <p className="sheet__hint">{hint}</p>}
        </div>
      </header>
      <div className="ts-rows">{children}</div>
    </section>
  )
}

/** A lesson waiting on a decision: whose, with whom and when, how long ago, and the one thing to do. */
function LessonRow({ lesson: l, detail, late, primary, more, label }: { lesson: LessonDto; detail?: ReactNode; late?: boolean; primary: ReactNode; more?: MenuItem[]; label: string }) {
  const { dateTime, locale } = useI18n()
  return (
    <div className="rowx" data-lesson={l.id}>
      <div className="rw-who">
        <span className="rw-who__text">
          <strong className="rw-name">
            <bdi>{l.learner.name}</bdi>
          </strong>
          <span className="rw-sub">
            <bdi>{l.teacher.name}</bdi> · <bdi>{dateTime(l.startsAt)}</bdi> · {formatMinutes(l.durationMinutes, locale)}
          </span>
        </span>
      </div>
      <div className="rw-meta">{detail}</div>
      <div className={late ? 'rw-age rw-age--late' : 'rw-age'}>{relativeTime(l.startsAt, locale)}</div>
      <div className="cell-actions">
        <RowActions primary={primary} more={more} label={label} />
      </div>
    </div>
  )
}

function useTx() {
  const { locale } = useI18n()
  return (p: Pair) => (locale === 'ar' ? p.ar : p.en)
}
