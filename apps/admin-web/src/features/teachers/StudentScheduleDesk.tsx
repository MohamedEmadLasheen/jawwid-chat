import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ActionDialog, type FieldSpec, type FieldValue } from './ActionDialog'
import type { Pair } from './copy'
import { opsApi, type Roster, type SuspensionReason, type WeeklySlot } from './opsApi'
import { O, SUSPENSION_REASON, WEEKDAY, formatDay, formatMinutes } from './opsCopy'
import { useOp } from './opsHooks'
import { ChangeTeacherDialog } from './ChangeTeacherDialog'
import { AddLessonDialog, LessonsDialog } from './LessonDialogs'
import { WeeklyChangeDialog } from './WeeklyChangeDialog'
import './teachers.css'

export type ScheduleLearner = Roster['learners'][number]
type Pending = { title: string; fields: FieldSpec[]; submit: (v: FieldValue) => Promise<unknown> } | null
type Open = { kind: 'weekly' | 'add' | 'lessons' | 'teacher'; learner: ScheduleLearner } | null

/**
 * The one place a student's schedule is managed: the regular lesson times, a
 * one-off lesson, the lessons themselves, a change of teacher, a pause or a
 * stop. The Teachers' schedules desk (one teacher's students) and the Student
 * schedules page (any student) both render it, so the two cannot drift apart.
 * `teachers` adds a Teacher column, for a list that spans teachers. Every save is re-checked by the server and its refusal is shown as it is.
 */
export function StudentScheduleDesk({ students, teachers }: { students: ScheduleLearner[]; teachers?: Roster['teachers'] }) {
  const tx = useTx()
  const { locale, number } = useI18n()
  const [dialog, setDialog] = useState<Pending>(null)
  const [open, setOpen] = useState<Open>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const op = useOp((f: () => Promise<unknown>) => f())
  const run = (title: string, fields: FieldSpec[], submit: (v: FieldValue) => Promise<unknown>) =>
    setDialog({ title, fields, submit: (v) => op.mutateAsync(() => submit(v)) })

  return (
    <>
      {notice && <div className="banner banner--info" role="status">{notice}</div>}
      <section className="ts-section" aria-label={tx(O.students)}>
        <header className="ts-section__head">
          <h2 className="ts-card__title">{tx(O.students)}</h2>
          {students.length > 0 && <span className="ts-section__count">{number(students.length)}</span>}
        </header>
        {students.length === 0 ? (
          <p className="ts-muted ts-section__hint">{tx(O.noStudents)}</p>
        ) : (
          <div className="table-wrap">
            <table className="table ts-plain-rows">
              <thead>
                <tr>
                  <th scope="col">{tx(O.learner)}</th>
                  <th scope="col">{tx(O.family)}</th>
                  {teachers && <th scope="col">{tx(O.teacher)}</th>}
                  <th scope="col">{tx(O.regularTimes)}</th>
                  <th scope="col">{tx(O.actions)}</th>
                </tr>
              </thead>
              <tbody>
                {students.map((l) => (
                  <tr key={l.id}>
                    <th scope="row">
                      {l.name}
                      {l.suspension && (
                        <span className="badge ts-badge-gap">
                          {l.suspension.kind === 'temporary'
                            ? tx(O.paused).replace('{date}', l.suspension.returnOn ? formatDay(l.suspension.returnOn, locale) : '')
                            : tx(O.stopped)}
                        </span>
                      )}
                    </th>
                    <td>{l.family.displayName}</td>
                    {teachers && <td>{teachers.find((t) => t.id === l.teacherId)?.name ?? <span className="ts-muted">{tx(O.none)}</span>}</td>}
                    <td>{l.slots.length ? l.slots.map((s) => slotLabel(tx, s, locale)).join(' · ') : <span className="ts-muted">{tx(O.none)}</span>}</td>
                    <td className="ts-actions-cell row-actions">
                      <button type="button" className="btn btn--sm" onClick={() => setOpen({ kind: 'weekly', learner: l })}>{tx(O.editTimes)}</button>
                      <button type="button" className="btn btn--sm" onClick={() => setOpen({ kind: 'add', learner: l })}>{tx(O.addLesson)}</button>
                      <button type="button" className="btn btn--sm" onClick={() => setOpen({ kind: 'lessons', learner: l })}>{tx(O.lessons)}</button>
                      <button type="button" className="btn btn--sm" onClick={() => setOpen({ kind: 'teacher', learner: l })}>{tx(O.changeTeacher)}</button>
                      {!l.suspension && (
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={() =>
                            run(`${tx(O.suspend)} — ${l.name}`, [
                              { key: 'kind', label: O.kind, type: 'select', options: [{ value: 'temporary', label: O.temporary }, { value: 'permanent', label: O.permanent }] },
                              { key: 'reason', label: O.reason, type: 'select', options: Object.entries(SUSPENSION_REASON).map(([value, label]) => ({ value, label })) },
                              { key: 'returnOn', label: O.returnOn, type: 'date' },
                              { key: 'note', label: O.noteOptional, type: 'textarea' },
                            ], (v) =>
                              opsApi.suspend(l.id, {
                                kind: v('kind') as 'temporary' | 'permanent',
                                reason: v('reason') as SuspensionReason,
                                note: v('note') || undefined,
                                // The server refuses a pause without a return date, and a stop with one.
                                ...(v('kind') === 'temporary' ? { returnOn: v('returnOn') } : {}),
                              }),
                            )
                          }
                        >
                          {tx(O.suspend)}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {dialog && <ActionDialog title={dialog.title} fields={dialog.fields} onSubmit={dialog.submit} onClose={() => setDialog(null)} />}
      {open?.kind === 'weekly' && <WeeklyChangeDialog learner={open.learner} onClose={() => setOpen(null)} />}
      {open?.kind === 'add' && (
        <AddLessonDialog learner={open.learner} defaultMinutes={open.learner.slots[0]?.durationMinutes ?? 30} onClose={() => setOpen(null)} />
      )}
      {open?.kind === 'lessons' && <LessonsDialog learner={open.learner} onClose={() => setOpen(null)} />}
      {open?.kind === 'teacher' && (
        <ChangeTeacherDialog
          target={{ kind: 'learner', id: open.learner.id, name: open.learner.name, currentTeacherId: open.learner.teacherId }}
          onClose={() => setOpen(null)}
          onDone={(text) => {
            setOpen(null)
            setNotice(text)
          }}
        />
      )}
    </>
  )
}

function slotLabel(tx: (p: Pair) => string, s: WeeklySlot, locale: 'ar' | 'en'): string {
  return `${tx(WEEKDAY[s.weekday] ?? { en: '?', ar: '?' })} ${s.start} (${formatMinutes(s.durationMinutes, locale)})`
}

export function useTx() {
  const { locale } = useI18n()
  return (p: Pair) => (locale === 'ar' ? p.ar : p.en)
}
