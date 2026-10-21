import { useId, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { MenuItem } from '@/shared/components/Menu'
import { describeError } from '@/features/organization/copy'
import { chatKeys } from '@/features/chat/chatApi'
import { journeyApi, journeyKeys, type LessonTicket } from './api'
import { J, formatLessonWhen, useJourneyCopy } from './copy'

export type CardKind = 'student_excuse' | 'teacher_excuse' | 'makeup'

/** Which tickets each card works from (the server's LessonAct names). */
const ACTS: Record<CardKind, readonly string[]> = {
  student_excuse: ['apology', 'late_excuse'],
  teacher_excuse: ['teacher_apology'],
  makeup: ['book_makeup'],
}

/**
 * PD-15: the supervisor's lesson cards in a group's "+". The server says which
 * lessons each one applies to right now (GET /conversations/:id/lesson-tickets,
 * advisory), so a card is offered only where it can be recorded; every
 * submission is decided again by the server and the database.
 */
export function useLessonCards(conversationId: string, enabled: boolean) {
  const { tx } = useJourneyCopy()
  const [open, setOpen] = useState<CardKind | null>(null)
  const tickets = useQuery({
    queryKey: journeyKeys.tickets(conversationId),
    queryFn: () => journeyApi.tickets(conversationId),
    enabled,
    staleTime: 15_000,
  })
  const list = tickets.data?.tickets ?? []
  const has = (kind: CardKind) => list.some((t) => ACTS[kind].includes(t.ticket))
  const items: MenuItem[] = enabled
    ? [
        ...(has('student_excuse') ? [{ key: 'student-excuse', label: tx(J.menuStudentExcuse), icon: 'calendar' as const, onSelect: () => setOpen('student_excuse') }] : []),
        ...(has('teacher_excuse') ? [{ key: 'teacher-excuse', label: tx(J.menuTeacherExcuse), icon: 'academy' as const, onSelect: () => setOpen('teacher_excuse') }] : []),
        ...(has('makeup') ? [{ key: 'makeup', label: tx(J.menuMakeup), icon: 'calendarPlus' as const, onSelect: () => setOpen('makeup') }] : []),
      ]
    : []
  const dialog = open ? (
    <LessonCardDialog conversationId={conversationId} kind={open} tickets={list} onClose={() => setOpen(null)} />
  ) : null
  return { items, dialog }
}

/** One lesson choice per lesson, labelled "child — day time". */
function lessonChoices(tickets: LessonTicket[], acts: readonly string[]) {
  const seen = new Map<string, LessonTicket[]>()
  for (const t of tickets) {
    if (!t.lessonId || !acts.includes(t.ticket)) continue
    seen.set(t.lessonId, [...(seen.get(t.lessonId) ?? []), t])
  }
  return [...seen.entries()].map(([lessonId, ts]) => ({ lessonId, tickets: ts, first: ts[0]! }))
}

export function LessonCardDialog({
  conversationId,
  kind,
  tickets,
  onClose,
}: {
  conversationId: string
  kind: CardKind
  tickets: LessonTicket[]
  onClose: () => void
}) {
  const { tx, locale } = useJourneyCopy()
  const qc = useQueryClient()
  const base = useId()
  const choices = useMemo(() => lessonChoices(tickets, ACTS[kind]), [tickets, kind])
  const [lessonId, setLessonId] = useState(choices.length === 1 ? choices[0]!.lessonId : '')
  const chosen = choices.find((c) => c.lessonId === lessonId) ?? null
  const acts = new Set(chosen?.tickets.map((t) => t.ticket) ?? [])
  const [timing, setTiming] = useState<'before' | 'after' | ''>('')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const slots = useQuery({
    queryKey: ['journey', 'makeup-slots', lessonId],
    queryFn: () => journeyApi.makeupSlots(lessonId),
    enabled: kind === 'makeup' && !!lessonId,
  })

  const title = tx(kind === 'student_excuse' ? J.menuStudentExcuse : kind === 'teacher_excuse' ? J.menuTeacherExcuse : J.menuMakeup)
  const needsReason = kind === 'teacher_excuse' || (kind === 'student_excuse' && timing === 'after')
  const startsAt = date && time ? new Date(`${date}T${time}`) : null
  const invalid =
    !lessonId ||
    (kind === 'student_excuse' && !timing) ||
    (needsReason && !reason.trim()) ||
    (kind === 'makeup' && (!startsAt || Number.isNaN(startsAt.getTime())))

  const submit = async () => {
    setTouched(true)
    if (invalid || pending) return
    setPending(true)
    setError(null)
    try {
      if (kind === 'student_excuse') {
        if (timing === 'before') await journeyApi.excuseBefore(lessonId)
        else await journeyApi.excuseAfter(lessonId, reason.trim())
      } else if (kind === 'teacher_excuse') {
        await journeyApi.teacherExcuse(lessonId, reason.trim())
      } else {
        await journeyApi.bookMakeup(lessonId, (startsAt as Date).toISOString())
      }
      void qc.invalidateQueries({ queryKey: chatKeys.messages(conversationId) })
      void qc.invalidateQueries({ queryKey: journeyKeys.tickets(conversationId) })
      onClose()
    } catch (e) {
      setError(e)
      setPending(false)
    }
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={pending || choices.length === 0} onClick={() => void submit()}>
            {pending ? tx(J.sending) : tx(J.send)}
          </button>
        </>
      }
    >
      {choices.length === 0 ? (
        <p className="ts-muted">{tx(J.nothingToRecord)}</p>
      ) : (
        <>
          <div className="field">
            <label className="field__label" htmlFor={`${base}-lesson`}>{tx(J.lesson)}</label>
            <select
              id={`${base}-lesson`}
              className="select"
              value={lessonId}
              aria-invalid={touched && !lessonId}
              onChange={(e) => {
                setLessonId(e.target.value)
                setTiming('')
              }}
            >
              <option value="">{tx(J.choose)}</option>
              {choices.map((c) => (
                <option key={c.lessonId} value={c.lessonId}>
                  {c.first.learner.name} — {c.first.startsAt ? formatLessonWhen(c.first.startsAt, locale) : ''}
                </option>
              ))}
            </select>
            {touched && !lessonId && <span className="field__error">{tx(J.required)}</span>}
          </div>

          {kind === 'student_excuse' && chosen && (
            <fieldset className="field jr-fieldset">
              <div className="jr-options">
                <label className={`jr-option${acts.has('apology') ? '' : ' jr-option--off'}`}>
                  <input type="radio" name={`${base}-timing`} disabled={!acts.has('apology')} checked={timing === 'before'} onChange={() => setTiming('before')} />
                  <span>
                    <strong>{tx(J.excuseBefore)}</strong>
                    <span className="ts-muted">{acts.has('apology') ? tx(J.excuseBeforeHint) : tx(J.notAvailable)}</span>
                  </span>
                </label>
                <label className={`jr-option${acts.has('late_excuse') ? '' : ' jr-option--off'}`}>
                  <input type="radio" name={`${base}-timing`} disabled={!acts.has('late_excuse')} checked={timing === 'after'} onChange={() => setTiming('after')} />
                  <span>
                    <strong>{tx(J.excuseAfter)}</strong>
                    <span className="ts-muted">{acts.has('late_excuse') ? tx(J.excuseAfterHint) : tx(J.notAvailable)}</span>
                  </span>
                </label>
              </div>
              {touched && !timing && <span className="field__error">{tx(J.required)}</span>}
            </fieldset>
          )}

          {kind === 'teacher_excuse' && <p className="ts-muted">{tx(J.teacherExcuseHint)}</p>}

          {needsReason && (
            <div className="field">
              <label className="field__label" htmlFor={`${base}-reason`}>{tx(J.reasonInternal)}</label>
              <textarea
                id={`${base}-reason`}
                className="input"
                dir="auto"
                rows={3}
                maxLength={1000}
                value={reason}
                aria-invalid={touched && !reason.trim()}
                onChange={(e) => setReason(e.target.value)}
              />
              {touched && !reason.trim() && <span className="field__error">{tx(J.required)}</span>}
            </div>
          )}

          {kind === 'makeup' && lessonId && (
            <>
              <p className="ts-muted">{tx(J.makeupHint)}</p>
              <div className="jr-row">
                <div className="field">
                  <label className="field__label" htmlFor={`${base}-date`}>{tx(J.makeupDate)}</label>
                  <input id={`${base}-date`} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={touched && !date} />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`${base}-time`}>{tx(J.makeupTime)}</label>
                  <input id={`${base}-time`} className="input" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} aria-invalid={touched && !time} />
                </div>
              </div>
              {(slots.data?.slots.length ?? 0) > 0 && (
                <div className="field">
                  <span className="field__label">{tx(J.suggested)}</span>
                  <div className="jr-chips">
                    {slots.data!.slots.slice(0, 8).map((s) => {
                      const d = new Date(s)
                      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString()
                      return (
                        <button
                          key={s}
                          type="button"
                          className="jr-chip"
                          aria-pressed={date === local.slice(0, 10) && time === local.slice(11, 16)}
                          onClick={() => {
                            setDate(local.slice(0, 10))
                            setTime(local.slice(11, 16))
                          }}
                        >
                          {formatLessonWhen(s, locale)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
      {error ? (
        <div className="banner banner--danger" role="alert">
          {describeError(error, locale)}
        </div>
      ) : null}
    </Dialog>
  )
}
