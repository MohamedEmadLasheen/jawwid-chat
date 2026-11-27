import { useMemo, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import type { MenuItem } from '@/shared/components/Menu'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState } from '@/shared/components/States'
import { ActionDialog, type FieldSpec, type FieldValue } from './ActionDialog'
import type { Pair } from './copy'
import { opsApi, type Roster, type SuspensionReason, type WeeklySlot } from './opsApi'
import { O, SUSPENSION_REASON, WEEKDAY, fill, formatDay, formatMinutes } from './opsCopy'
import { useOp } from './opsHooks'
import { ChangeTeacherDialog } from './ChangeTeacherDialog'
import { AddLessonDialog, LessonsDialog } from './LessonDialogs'
import { WeeklyChangeDialog } from './WeeklyChangeDialog'
import './teachers.css'
import './rows.css'

export type ScheduleLearner = Roster['learners'][number]
type Pending = { title: string; fields: FieldSpec[]; submit: (v: FieldValue) => Promise<unknown> } | null
type Open = { kind: 'weekly' | 'add' | 'lessons' | 'teacher'; learner: ScheduleLearner } | null

const MORE: Pair = { en: 'More actions: {name}', ar: 'إجراءات أخرى: {name}' }
const NO_TEACHER: Pair = { en: 'No teacher yet', ar: 'بلا معلم بعد' }

/**
 * The one place a student's schedule is managed: the regular lesson times, a
 * one-off lesson, the lessons themselves, a change of teacher, a pause or a
 * stop. The Teachers' schedules desk (one teacher's students) and the Student
 * schedules page (any student) both render it, so the two cannot drift apart.
 *
 * A row is a student: the name over the family, the weekly times as small
 * chips, and one stated action (the times) with the rest behind "⋯". With
 * `teachers`, the students are grouped under their teacher, each group a sheet
 * with its count. Every save is re-checked by the server and its refusal is
 * shown as it is.
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

  // One sheet per teacher (students with no teacher first: they are the ones waiting), or one sheet in all.
  const groups = useMemo(() => {
    if (!teachers) return [{ key: 'all', name: null as string | null, rows: students }]
    const by = new Map<string, ScheduleLearner[]>()
    for (const l of students) by.set(l.teacherId ?? '', [...(by.get(l.teacherId ?? '') ?? []), l])
    const named = teachers.filter((t) => by.has(t.id)).map((t) => ({ key: t.id, name: t.name as string | null, rows: by.get(t.id)! }))
    return by.has('') ? [{ key: '', name: tx(NO_TEACHER) as string | null, rows: by.get('')! }, ...named] : named
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, teachers, locale])

  const suspend = (l: ScheduleLearner) =>
    run(
      `${tx(O.suspend)} — ${l.name}`,
      [
        { key: 'kind', label: O.kind, type: 'select', options: [{ value: 'temporary', label: O.temporary }, { value: 'permanent', label: O.permanent }] },
        { key: 'reason', label: O.reason, type: 'select', options: Object.entries(SUSPENSION_REASON).map(([value, label]) => ({ value, label })) },
        { key: 'returnOn', label: O.returnOn, type: 'date' },
        { key: 'note', label: O.noteOptional, type: 'textarea' },
      ],
      (v) =>
        opsApi.suspend(l.id, {
          kind: v('kind') as 'temporary' | 'permanent',
          reason: v('reason') as SuspensionReason,
          note: v('note') || undefined,
          // The server refuses a pause without a return date, and a stop with one.
          ...(v('kind') === 'temporary' ? { returnOn: v('returnOn') } : {}),
        }),
    )

  const row = (l: ScheduleLearner) => {
    const more: MenuItem[] = [
      { key: 'add', label: tx(O.addLesson), icon: 'calendarPlus', onSelect: () => setOpen({ kind: 'add', learner: l }) },
      { key: 'lessons', label: tx(O.lessons), icon: 'listBullets', onSelect: () => setOpen({ kind: 'lessons', learner: l }) },
      { key: 'teacher', label: tx(O.changeTeacher), icon: 'swap', onSelect: () => setOpen({ kind: 'teacher', learner: l }) },
      ...(!l.suspension ? [{ key: 'suspend', label: tx(O.suspend), icon: 'pause' as const, onSelect: () => suspend(l) }] : []),
    ]
    return (
      <tr key={l.id}>
        <th scope="row" className="rw-who">
          <Avatar name={l.name} seed={l.id} />
          <span className="rw-who__text">
            <span className="rw-name">
              <bdi>{l.name}</bdi>
            </span>
            <span className="rw-sub">
              <bdi>{l.family.displayName}</bdi>
            </span>
          </span>
        </th>
        <td className="rw-meta rw-meta--wide">
          {l.slots.length ? (
            <ul className="time-chips" aria-label={tx(O.regularTimes)}>
              {l.slots.map((s) => (
                <li key={`${s.weekday}|${s.start}`} className="time-chip">
                  {slotLabel(tx, s, locale)}
                </li>
              ))}
            </ul>
          ) : (
            // A student with no weekly times is a gap to fill: said in the waiting colour (round 3).
            <span className="ts-gap">{tx(O.noTimesYet)}</span>
          )}
        </td>
        <td className="rw-tags">
          {l.suspension && (
            <Badge tone={l.suspension.kind === 'temporary' ? 'warn' : 'outline'}>
              {l.suspension.kind === 'temporary'
                ? tx(O.paused).replace('{date}', l.suspension.returnOn ? formatDay(l.suspension.returnOn, locale) : '')
                : tx(O.stopped)}
            </Badge>
          )}
        </td>
        <td className="cell-actions">
          <RowActions
            primary={
              <button type="button" className="btn btn--sm" onClick={() => setOpen({ kind: 'weekly', learner: l })}>
                {tx(O.editTimes)}
              </button>
            }
            more={more}
            label={fill(tx(MORE), { name: l.name })}
          />
        </td>
      </tr>
    )
  }

  return (
    <>
      {notice && (
        <div className="banner banner--info" role="status">
          {notice}
        </div>
      )}
      <section className="ts-desk" aria-label={tx(O.students)}>
        {students.length === 0 ? (
          <div className="sheet">
            <EmptyState compact title={tx(O.noStudents)} />
          </div>
        ) : (
          groups.map((g) => (
            <div className="sheet" key={g.key} role={g.name ? 'group' : undefined} aria-label={g.name ?? undefined}>
              <header className="sheet__head">
                <h2 className="sheet__title">
                  {g.name ? <bdi>{g.name}</bdi> : tx(O.students)}
                  <span className="sheet__count">{number(g.rows.length)}</span>
                </h2>
              </header>
              <table className="rowlist">
                <thead>
                  <tr>
                    <th scope="col">{tx(O.learner)}</th>
                    <th scope="col">{tx(O.regularTimes)}</th>
                    <th scope="col">{tx(O.suspend)}</th>
                    <th scope="col">{tx(O.actions)}</th>
                  </tr>
                </thead>
                <tbody>{g.rows.map(row)}</tbody>
              </table>
            </div>
          ))
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
