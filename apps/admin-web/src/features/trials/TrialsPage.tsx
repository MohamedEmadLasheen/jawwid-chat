import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { SlotPicker } from '@/shared/components/SlotPicker'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { ActionDialog, type FieldSpec, type FieldValue } from '../teachers/ActionDialog'
import type { Pair } from '../teachers/copy'
import { describeOpsError, formatMinutes } from '../teachers/opsCopy'
import { trialsApi, type TrialDto } from './api'
import { TrialsAreaTabs, useTrialsAccess } from './area'
import { ATTENDANCE, NOT_SUBSCRIBED_REASON, OUTCOME, TR, formatWhen } from './copy'
import { useTrialOp, useTrialSlots, useTrialTeachers, useTrials } from './hooks'
import { TrialCardDialog } from './TrialCardDialog'
import '../teachers/teachers.css'
import './trials.css'
import { TrialBadge } from '@/shared/components/TrialBadge'
import { ACADEMY_ZONE } from '@/core/time/academyTime'
import { SearchableSelect } from '@/shared/components/SearchableSelect'

type Pending = { title: string; intro?: string; fields: FieldSpec[]; submit: (v: FieldValue) => Promise<unknown> } | null
type Filter = 'all' | 'decision' | 'upcoming'
type StudentDraft = { name: string; level: string; note: string }

const MIN_LENGTH = 15
const MAX_LENGTH = 120

/**
 * Sales' trial page (PD-11 T4), also the Teachers department's view of trials.
 * Each trial has ONE outcome -- did not attend, subscribed, did not subscribe --
 * recorded with the same card as "+ -> Trial" in the teacher's trial group
 * (TrialCardDialog), and corrected there by Sales. Chat is the only source of
 * truth: nothing waits for Core.
 */
export function TrialsPage() {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const access = useTrialsAccess()
  const q = useTrials()
  // PD-44: the tab lives in the URL, so a Dashboard tile opens the tab it
  // counted (/trials?filter=decision|upcoming) and a later link moves it too.
  const [params, setParams] = useSearchParams()
  const asked = params.get('filter')
  const filter: Filter = asked === 'decision' || asked === 'upcoming' ? asked : 'all'
  const setFilter = (next: Filter) =>
    setParams((current) => {
      const p = new URLSearchParams(current)
      if (next === 'all') p.delete('filter')
      else p.set('filter', next)
      return p
    }, { replace: true })
  const [booking, setBooking] = useState(false)
  const [dialog, setDialog] = useState<Pending>(null)
  const [card, setCard] = useState<TrialDto | null>(null)
  const [editing, setEditing] = useState<TrialDto | null>(null)
  const op = useTrialOp((f: () => Promise<unknown>) => f())
  const navigate = useNavigate()
  const [groupError, setGroupError] = useState<unknown>(null)
  const openGroup = async (teacherId: string) => {
    setGroupError(null)
    try {
      const { conversationId } = await trialsApi.openGroup(teacherId)
      navigate(`/chat/${encodeURIComponent(conversationId)}`)
    } catch (e) {
      setGroupError(e)
    }
  }
  const run = (title: string, fields: FieldSpec[], submit: (v: FieldValue) => Promise<unknown>, intro?: string) =>
    setDialog({ title, intro, fields, submit: (v) => op.mutateAsync(() => submit(v)) })

  const all = q.data?.trials ?? []
  const rows = all.filter((t) =>
    filter === 'decision' ? t.outcome === 'awaiting' : filter === 'upcoming' ? t.outcome === 'upcoming' : true,
  )

  // The trial desk: Sales and Operations work trials alike (owner, 2026-10-21).
  const desk = access.sales || access.operations
  const powers = { noShow: desk || access.lessonManager, decide: desk, correct: desk }

  return (
    <div className="page">
      <div className="page__inner">
        <TrialsAreaTabs />
        <PageHeader
          title={tx(TR.trialsTitle)}
          subtitle={tx(TR.trialsSubtitle)}
          actions={
            <>
              {(desk || access.lessonManager) && (
                <button type="button" className="btn btn--primary" onClick={() => setBooking(true)}>{tx(TR.bookTrial)}</button>
              )}
            </>
          }
        />
        <div className="org-tabs" role="tablist" aria-label={tx(TR.trialsTitle)}>
          {(['all', 'decision', 'upcoming'] as const).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className="org-tab" onClick={() => setFilter(f)}>
              {tx(f === 'all' ? TR.filterAll : f === 'decision' ? TR.filterOutcome : TR.filterUpcoming)}
            </button>
          ))}
        </div>
        <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          {rows.length === 0 ? (
            <EmptyState title={tx(TR.none)} />
          ) : (
            <div className="card card--flush">
              <div className="table-wrap">
                <table className="table ts-plain-rows">
                  <thead>
                    <tr>
                      <th scope="col">{tx(TR.prospect)}</th>
                      <th scope="col">{tx(TR.teacher)}</th>
                      <th scope="col">{tx(TR.when)}</th>
                      <th scope="col">{tx(TR.attendance)}</th>
                      <th scope="col">{tx(TR.outcome)}</th>
                      <th scope="col">{tx(TR.actions)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => {
                      const open = t.outcome === 'upcoming' || (t.outcome === 'awaiting' && t.attendance === 'awaiting')
                      return (
                        <tr key={t.id}>
                          <th scope="row" dir="auto">
                            {t.prospect.displayName}
                            {t.prospect.level && <div className="ts-muted" dir="auto">{t.prospect.level}</div>}
                          </th>
                          <td>{t.teacher.name}</td>
                          <td>
                            {formatWhen(t.startsAt, locale)}
                            <div className="ts-muted">{formatMinutes(t.durationMinutes, locale)}</div>
                          </td>
                          <td>
                            {tx(ATTENDANCE[t.attendance] ?? { en: t.attendance, ar: t.attendance })}
                            {t.report && <div className="ts-muted" dir="auto" title={tx(TR.report)}>{t.report.covered}</div>}
                          </td>
                          <td>
                            {tx(OUTCOME[t.outcome] ?? { en: t.outcome, ar: t.outcome })}
                            {t.outcomeDetail?.reason && (
                              <div className="ts-muted">{tx(NOT_SUBSCRIBED_REASON[t.outcomeDetail.reason] ?? { en: t.outcomeDetail.reason, ar: t.outcomeDetail.reason })}</div>
                            )}
                          </td>
                          <td className="ts-actions-cell">
                            <button type="button" className="btn btn--sm" onClick={() => void openGroup(t.teacher.id)}>{tx(TR.openGroup)}</button>
                            <TrialBadge />
                            {t.outcome === 'awaiting' && powers.noShow && (
                              <button type="button" className="btn btn--sm btn--primary" onClick={() => setCard(t)}>{tx(TR.recordOutcome)}</button>
                            )}
                            {['no_show', 'subscribed', 'not_subscribed'].includes(t.outcome) && powers.correct && (
                              <button type="button" className="btn btn--sm" onClick={() => setCard(t)}>{tx(TR.correctOutcome)}</button>
                            )}
                            {t.outcome === 'upcoming' && (desk || access.lessonManager) && (
                              <button type="button" className="btn btn--sm" onClick={() => setEditing(t)}>{tx(TR.editTrial)}</button>
                            )}
                            {open && (desk || access.lessonManager) && (
                              <button type="button" className="btn btn--sm" onClick={() => run(tx(TR.cancel), [{ key: 'reason', label: TR.cancelReason, type: 'textarea', required: true }], (v) => trialsApi.cancel(t.id, v('reason')))}>
                                {tx(TR.cancel)}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {groupError !== null && (
            <div className="banner banner--danger" role="alert">{describeOpsError(groupError, locale)}</div>
          )}
        </QueryBoundary>
        {dialog && (
          <ActionDialog title={dialog.title} intro={dialog.intro} fields={dialog.fields} onSubmit={dialog.submit} onClose={() => setDialog(null)} />
        )}
        {booking && <BookTrialDialog onClose={() => setBooking(false)} />}
        {editing && <BookTrialDialog editing={editing} onClose={() => setEditing(null)} />}
        {card && <TrialCardDialog trial={card} powers={powers} onClose={() => setCard(null)} />}
      </div>
    </div>
  )
}

/**
 * Booking: the students are typed here (one or more -- siblings or a small
 * group share one trial and one outcome), then the teacher and one of the
 * times the server says are free for that teacher and length (GET
 * /trials/slots). The server checks again, and the database's
 * no-double-booking rule has the last word.
 */
function BookTrialDialog({ onClose, editing }: { onClose: () => void; editing?: TrialDto }) {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const teachers = useTrialTeachers(true)
  const [students, setStudents] = useState<StudentDraft[]>([{ name: '', level: '', note: '' }])
  // Editing moves an existing trial: same students, a new teacher / length / time.
  const [teacherId, setTeacherId] = useState(editing?.teacher.id ?? '')
  // The length is typed, in minutes (15 to 120, the server's range).
  const [lengthText, setLengthText] = useState(String(editing?.durationMinutes ?? 30))
  const typed = Number(lengthText)
  const lengthOk = lengthText.trim() !== '' && Number.isInteger(typed) && typed >= MIN_LENGTH && typed <= MAX_LENGTH
  const duration = lengthOk ? typed : 0
  const [slot, setSlot] = useState('')
  const [error, setError] = useState<unknown>(null)
  const slots = useTrialSlots(teacherId, duration)
  const book = useTrialOp((f: () => Promise<unknown>) => f())

  // PD-31: day and time are chosen as chips (SlotPicker), from the same free times.
  const offered = slots.data?.slots ?? []
  const chosenSlot = slot && offered.includes(slot) ? slot : ''
  // What still stops the booking, in the order the form asks for it. The Book
  // button stays clickable and says this, rather than greying out silently.
  const unnamed = editing ? [] : students.map((x, i) => (x.name.trim() === '' ? i : -1)).filter((i) => i >= 0)
  const missing: Pair | null = unnamed.length > 0 ? TR.missingStudentName
    : teacherId === '' ? TR.missingTeacher
    : !lengthOk ? TR.missingLength
    : chosenSlot === '' ? TR.missingTime
    : null
  const [tried, setTried] = useState(false)
  const setStudent = (i: number, patch: Partial<StudentDraft>) =>
    setStudents(students.map((x, k) => (k === i ? { ...x, ...patch } : x)))

  const submit = async () => {
    setTried(true)
    if (missing || book.isPending) return
    setError(null)
    try {
      await book.mutateAsync(() =>
        editing
          ? trialsApi.reschedule(editing.id, { teacherId, startsAt: chosenSlot, durationMinutes: duration })
          : trialsApi.book({
              students: students.map((x) => ({
                name: x.name.trim(),
                ...(x.level.trim() ? { level: x.level.trim() } : {}),
                ...(x.note.trim() ? { note: x.note.trim() } : {}),
              })),
              teacherId,
              startsAt: chosenSlot,
              durationMinutes: duration,
            }),
      )
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  const timeLabel = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en', { hour: '2-digit', minute: '2-digit', timeZone: ACADEMY_ZONE }).format(new Date(iso))

  return (
    <Dialog
      title={editing ? `${tx(TR.editTrial)} — ${editing.prospect.displayName}` : tx(TR.bookTrial)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={book.isPending} onClick={() => void submit()}>
            {tx(editing ? TR.save : TR.book)}
          </button>
        </>
      }
    >
      {editing ? (
        <p className="tj-trial-head">
          <span className="ts-muted">{tx(TR.currentTime)}:</span>
          <strong>{formatWhen(editing.startsAt, locale)}</strong>
          <span className="ts-muted">· {editing.teacher.name}</span>
        </p>
      ) : (
        <fieldset className="tj-fieldset">
          <legend className="tj-legend">{tx(TR.students)}</legend>
          <p className="ts-muted">{tx(TR.studentsHint)}</p>
          {students.map((x, i) => (
            <div className="tj-child" key={i} role="group" aria-label={`${tx(TR.student)} ${i + 1}`}>
              {students.length > 1 && (
                <div className="tj-child__head">
                  <span className="tj-child__title">{tx(TR.student)} {i + 1}</span>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setStudents(students.filter((_, k) => k !== i))}>
                    {tx(TR.removeStudent)}
                  </button>
                </div>
              )}
              <div className="tj-row">
                <div className="field">
                  <label className="field__label" htmlFor={`bt-name-${i}`}>{tx(TR.studentName)}</label>
                  <input
                    id={`bt-name-${i}`}
                    className="input"
                    dir="auto"
                    value={x.name}
                    aria-invalid={tried && unnamed.includes(i)}
                    onChange={(e) => setStudent(i, { name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`bt-level-${i}`}>{tx(TR.studentLevel)}</label>
                  <input id={`bt-level-${i}`} className="input" dir="auto" value={x.level} onChange={(e) => setStudent(i, { level: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label className="field__label" htmlFor={`bt-note-${i}`}>{tx(TR.noteOptional)}</label>
                <textarea id={`bt-note-${i}`} className="input" rows={2} dir="auto" value={x.note} onChange={(e) => setStudent(i, { note: e.target.value })} />
              </div>
            </div>
          ))}
          {students.length < 10 && (
            <button type="button" className="btn btn--sm" onClick={() => setStudents([...students, { name: '', level: students.at(-1)?.level ?? '', note: '' }])}>
              {tx(TR.addStudent)}
            </button>
          )}
        </fieldset>
      )}
      <div className="field">
        <label className="field__label" htmlFor="bt-teacher">{tx(TR.teacher)}</label>
        <SearchableSelect id="bt-teacher" className="select" value={teacherId} onValueChange={(v) => { setTeacherId(v); setSlot('') }}>
          <option value="">—</option>
          {(teachers.data?.teachers ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </SearchableSelect>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="bt-duration">{tx(TR.duration)}</label>
        <input
          id="bt-duration"
          className="input"
          type="number"
          inputMode="numeric"
          min={MIN_LENGTH}
          max={MAX_LENGTH}
          dir="ltr"
          value={lengthText}
          aria-invalid={tried && !lengthOk}
          aria-describedby="bt-duration-hint"
          onChange={(e) => { setLengthText(e.target.value); setSlot('') }}
        />
        <span id="bt-duration-hint" className="ts-muted">{tx(TR.lengthHint)}</span>
      </div>
      {/* The time block is always shown, so the form reads the same from the
          start; until times can be chosen it says what comes first. */}
      {(() => {
        const waiting: Pair | null = teacherId === '' ? TR.chooseTeacherFirst
          : !lengthOk ? TR.enterLengthFirst
          : null
        return (
          <div className="field">
            <span className="field__label">{tx(TR.time)}</span>
            {waiting ? (
              <p className="ts-muted">{tx(waiting)}</p>
            ) : (
              <SlotPicker
                slots={offered}
                value={chosenSlot || null}
                onChange={setSlot}
                label={tx(TR.time)}
                loading={slots.isLoading}
                emptyText={tx(TR.noSlots)}
                formatTime={timeLabel}
              />
            )}
          </div>
        )
      })()}
      {tried && missing && <p className="field__error" role="alert">{tx(missing)}</p>}
      {error !== null && (
        <div className="banner banner--danger" role="alert">{describeOpsError(error, locale)}</div>
      )}
    </Dialog>
  )
}
