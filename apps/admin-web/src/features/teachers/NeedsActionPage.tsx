import { useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { ActionDialog, type FieldSpec, type FieldValue } from './ActionDialog'
import { TeachersAreaTabs } from './area'
import type { Pair } from './copy'
import { opsApi, type LessonDto, type MakeupAction } from './opsApi'
import { O, WEEKDAY, formatDay, formatMinutes } from './opsCopy'
import { useNeedsAction, useOp } from './opsHooks'
import './teachers.css'

type Pending = { title: string; intro?: string; fields: FieldSpec[]; submit: (v: FieldValue) => Promise<unknown> } | null

/**
 * The Teachers department's daily queue (GET /lessons/needs-action): lessons
 * still without an outcome, late apologies to rule on, teacher-cancelled
 * lessons nobody replaced, families' regular-time requests, and pauses ending
 * soon. Each row offers the one or two decisions the server accepts for it;
 * the server re-checks every one.
 */
export function NeedsActionPage() {
  const tx = useTx()
  const { locale } = useI18n()
  const q = useNeedsAction()
  const [dialog, setDialog] = useState<Pending>(null)
  const op = useOp((f: () => Promise<unknown>) => f())
  const run = (title: string, fields: FieldSpec[], submit: (v: FieldValue) => Promise<unknown>, intro?: string) =>
    setDialog({ title, intro, fields, submit: (v) => op.mutateAsync(() => submit(v)) })

  const d = q.data
  const empty =
    d &&
    d.overdue.length + d.awaitingClose.length + d.rulings.length + d.makeupsOverdue.length + d.scheduleRequests.length + d.returningSoon.length === 0

  const noteField = (required: boolean, label: Pair = required ? O.note : O.noteOptional): FieldSpec => ({ key: 'note', label, type: 'textarea', required })
  const lessonActions = (l: LessonDto) => (
    <>
      <button type="button" className="btn btn--sm" onClick={() => run(tx(O.studentAbsent), [noteField(false)], (v) => opsApi.absence(l.id, v('note') || undefined))}>
        {tx(O.studentAbsent)}
      </button>
      <button type="button" className="btn btn--sm" onClick={() => run(tx(O.teacherAbsent), [noteField(true)], (v) => opsApi.teacherNoShow(l.id, v('note')))}>
        {tx(O.teacherAbsent)}
      </button>
      <button type="button" className="btn btn--sm" onClick={() => run(tx(O.cancel), [{ key: 'reason', label: O.reason, type: 'textarea', required: true }], (v) => opsApi.cancel(l.id, v('reason')))}>
        {tx(O.cancel)}
      </button>
    </>
  )

  return (
    <div className="page">
      <div className="page__inner">
        <TeachersAreaTabs />
        <PageHeader title={tx(O.needsTitle)} subtitle={tx(O.needsSubtitle)} />
        <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          {empty && <EmptyState title={tx(O.allClear)} />}
          {d && (
            <>
              <Section title={tx(O.overdue)} hint={tx(O.overdueHint)} count={d.overdue.length}>
                {d.overdue.map((l) => <LessonRow key={l.id} lesson={l} actions={lessonActions(l)} />)}
              </Section>
              <Section title={tx(O.awaiting)} count={d.awaitingClose.length}>
                {d.awaitingClose.map((l) => <LessonRow key={l.id} lesson={l} actions={lessonActions(l)} />)}
              </Section>
              <Section title={tx(O.rulings)} hint={tx(O.rulingsHint)} count={d.rulings.length}>
                {d.rulings.map((r) => (
                  <LessonRow
                    key={r.id}
                    lesson={r.lesson}
                    detail={<span>{tx(O.reason)}: <span dir="auto">{r.reason}</span></span>}
                    actions={
                      <>
                        <button type="button" className="btn btn--sm btn--primary" onClick={() => run(tx(O.excuse), [noteField(false)], (v) => opsApi.decideRuling(r.id, { decision: 'excused', note: v('note') || undefined }))}>
                          {tx(O.excuse)}
                        </button>
                        <button type="button" className="btn btn--sm" onClick={() => run(tx(O.credit), [noteField(false)], (v) => opsApi.decideRuling(r.id, { decision: 'teacher_credited', note: v('note') || undefined }))}>
                          {tx(O.credit)}
                        </button>
                      </>
                    }
                  />
                ))}
              </Section>
              <Section title={tx(O.makeups)} hint={tx(O.makeupsHint)} count={d.makeupsOverdue.length}>
                {d.makeupsOverdue.map((l) => (
                  <LessonRow
                    key={l.id}
                    lesson={l}
                    actions={
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
                  />
                ))}
              </Section>
              <Section title={tx(O.requests)} count={d.scheduleRequests.length}>
                {d.scheduleRequests.map((r) => (
                  <div className="ts-row" key={r.id}>
                    <div className="ts-row__main">
                      <strong>{r.learner.name}</strong>
                      <span className="ts-muted">
                        {tx(O.requested)}: {r.slots.map((s) => `${tx(WEEKDAY[s.weekday] ?? { en: '?', ar: '?' })} ${s.start}`).join(' · ')}
                      </span>
                      {r.note && <span className="ts-muted" dir="auto">{r.note}</span>}
                    </div>
                    <div className="ts-row__actions">
                      <button type="button" className="btn btn--sm btn--primary" onClick={() => run(tx(O.approve), [noteField(false)], (v) => opsApi.decideScheduleRequest(r.id, { decision: 'approved', note: v('note') || undefined }))}>
                        {tx(O.approve)}
                      </button>
                      <button type="button" className="btn btn--sm" onClick={() => run(tx(O.reject), [noteField(true)], (v) => opsApi.decideScheduleRequest(r.id, { decision: 'rejected', note: v('note') }))}>
                        {tx(O.reject)}
                      </button>
                    </div>
                  </div>
                ))}
              </Section>
              <Section title={tx(O.returning)} count={d.returningSoon.length}>
                {d.returningSoon.map((r) => (
                  <div className="ts-row" key={r.suspensionId}>
                    <div className="ts-row__main">
                      <strong>{r.learner.name}</strong>
                      <span className="ts-muted">{tx(O.returnOn)}: {formatDay(r.returnOn, locale)}</span>
                    </div>
                    <div className="ts-row__actions">
                      <button type="button" className="btn btn--sm" onClick={() => run(tx(O.extend), [{ key: 'returnOn', label: O.returnOn, type: 'date', required: true, initial: r.returnOn }], (v) => opsApi.extendSuspension(r.suspensionId, v('returnOn')))}>
                        {tx(O.extend)}
                      </button>
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
      </div>
    </div>
  )
}

/** A queue section, left out when it has nothing in it. */
function Section({ title, hint, count, children }: { title: string; hint?: string; count: number; children: ReactNode }) {
  if (count === 0) return null
  return (
    <section className="card ts-section" aria-label={title}>
      <header className="ts-section__head">
        <h2 className="ts-card__title">{title}</h2>
        <span className="badge">{count}</span>
      </header>
      {hint && <p className="ts-muted ts-section__hint">{hint}</p>}
      <div className="ts-rows">{children}</div>
    </section>
  )
}

function LessonRow({ lesson: l, detail, actions }: { lesson: LessonDto; detail?: ReactNode; actions: ReactNode }) {
  const { dateTime, locale } = useI18n()
  return (
    <div className="ts-row" data-lesson={l.id}>
      <div className="ts-row__main">
        <strong>{l.learner.name}</strong>
        <span className="ts-muted">{l.teacher.name} · {dateTime(l.startsAt)} · {formatMinutes(l.durationMinutes, locale)}</span>
        {detail}
      </div>
      <div className="ts-row__actions">{actions}</div>
    </div>
  )
}

function useTx() {
  const { locale } = useI18n()
  return (p: Pair) => (locale === 'ar' ? p.ar : p.en)
}
