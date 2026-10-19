import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { ActionDialog, type FieldSpec, type FieldValue } from '../teachers/ActionDialog'
import type { Pair } from '../teachers/copy'
import { describeOpsError, formatMinutes } from '../teachers/opsCopy'
import { trialsApi, type NotSubscribedReason, type TrialDto } from './api'
import { TrialsAreaTabs, useTrialsAccess } from './area'
import { ATTENDANCE, CONVERSION, NOT_SUBSCRIBED_REASON, TR, formatWhen, localDay } from './copy'
import { useProspects, useTrialOp, useTrialSlots, useTrialTeachers, useTrials } from './hooks'
import '../teachers/teachers.css'

type Pending = { title: string; intro?: string; fields: FieldSpec[]; submit: (v: FieldValue) => Promise<unknown> } | null
type Filter = 'all' | 'decision' | 'upcoming'

/**
 * Sales' trial page (PD-11 T4), also the Teachers department's view of trials.
 * A trial has two facts kept apart: attendance is the teacher's (reported from
 * the app), the subscription decision is Sales'. "Subscribed" waits for Core's
 * confirmation before it credits the teacher, and reads so.
 */
export function TrialsPage() {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const access = useTrialsAccess()
  const q = useTrials()
  const [filter, setFilter] = useState<Filter>('all')
  const [booking, setBooking] = useState(false)
  const [dialog, setDialog] = useState<Pending>(null)
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
    filter === 'decision' ? t.conversion === 'pending' : filter === 'upcoming' ? t.attendance === 'upcoming' : true,
  )

  const reasonOptions = Object.entries(NOT_SUBSCRIBED_REASON).map(([value, label]) => ({ value, label }))
  const decide = (t: TrialDto) =>
    run(
      `${tx(TR.recordDecision)} — ${t.prospect.displayName}`,
      [
        { key: 'result', label: TR.result, type: 'select', required: true, options: [
          { value: 'subscribed', label: TR.subscribed },
          { value: 'not_subscribed', label: TR.notSubscribed },
        ] },
        { key: 'reason', label: TR.reason, type: 'select', options: reasonOptions },
        { key: 'note', label: TR.noteOptional, type: 'textarea' },
      ],
      (v) =>
        trialsApi.outcome(t.id, v('result') === 'subscribed'
          ? { result: 'subscribed', note: v('note') || undefined }
          : { result: 'not_subscribed', reason: v('reason') as NotSubscribedReason, note: v('note') || undefined }),
    )

  return (
    <div className="page">
      <div className="page__inner">
        <TrialsAreaTabs />
        <PageHeader
          title={tx(TR.trialsTitle)}
          subtitle={tx(TR.trialsSubtitle)}
          actions={
            <>
              {access.sales && (
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    run(tx(TR.newProspect), [
                      { key: 'displayName', label: TR.displayName, type: 'text', required: true },
                      { key: 'level', label: TR.level, type: 'text' },
                      { key: 'note', label: TR.noteOptional, type: 'textarea' },
                    ], (v) => trialsApi.createProspect({ displayName: v('displayName'), level: v('level') || undefined, note: v('note') || undefined }))
                  }
                >
                  {tx(TR.newProspect)}
                </button>
              )}
              {(access.sales || access.lessonManager) && (
                <button type="button" className="btn btn--primary" onClick={() => setBooking(true)}>{tx(TR.bookTrial)}</button>
              )}
            </>
          }
        />
        <div className="org-tabs" role="tablist" aria-label={tx(TR.trialsTitle)}>
          {(['all', 'decision', 'upcoming'] as const).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className="org-tab" onClick={() => setFilter(f)}>
              {tx(f === 'all' ? TR.filterAll : f === 'decision' ? TR.filterDecision : TR.filterUpcoming)}
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
                      <th scope="col">{tx(TR.decision)}</th>
                      <th scope="col">{tx(TR.actions)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => {
                      const open = t.attendance === 'upcoming' || t.attendance === 'awaiting'
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
                            {t.conversion ? tx(CONVERSION[t.conversion] ?? { en: t.conversion, ar: t.conversion }) : '—'}
                            {t.conversionDetail?.reason && (
                              <div className="ts-muted">{tx(NOT_SUBSCRIBED_REASON[t.conversionDetail.reason] ?? { en: t.conversionDetail.reason, ar: t.conversionDetail.reason })}</div>
                            )}
                          </td>
                          <td className="ts-actions-cell">
                            <button type="button" className="btn btn--sm" onClick={() => void openGroup(t.teacher.id)}>{tx(TR.openGroup)}</button>
                            {access.sales && t.conversion === 'pending' && (
                              <button type="button" className="btn btn--sm btn--primary" onClick={() => decide(t)}>{tx(TR.recordDecision)}</button>
                            )}
                            {access.lessonManager && !access.sales && t.attendance === 'awaiting' && (
                              <button type="button" className="btn btn--sm" onClick={() => run(tx(TR.absence), [{ key: 'note', label: TR.noteOptional, type: 'textarea' }], (v) => trialsApi.absence(t.id, v('note') || undefined))}>
                                {tx(TR.absence)}
                              </button>
                            )}
                            {open && (access.sales || access.lessonManager) && (
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
      </div>
    </div>
  )
}

/**
 * Booking offers only the times the server says are free for that teacher and
 * length (GET /trials/slots); the server checks again, and the database's
 * no-double-booking rule has the last word.
 */
function BookTrialDialog({ onClose }: { onClose: () => void }) {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const prospects = useProspects()
  const teachers = useTrialTeachers(true)
  const [prospectId, setProspectId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [duration, setDuration] = useState(30)
  const [day, setDay] = useState('')
  const [slot, setSlot] = useState('')
  const [error, setError] = useState<unknown>(null)
  const slots = useTrialSlots(teacherId, duration)
  const book = useTrialOp((body: Parameters<typeof trialsApi.book>[0]) => trialsApi.book(body))

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of slots.data?.slots ?? []) {
      const k = localDay(s)
      m.set(k, [...(m.get(k) ?? []), s])
    }
    return m
  }, [slots.data])
  const days = [...byDay.keys()]
  const chosenDay = day && byDay.has(day) ? day : days[0] ?? ''
  const times = byDay.get(chosenDay) ?? []
  const chosenSlot = slot && times.includes(slot) ? slot : ''
  const openProspects = (prospects.data?.prospects ?? []).filter((p) => !p.learnerId)
  const ready = prospectId !== '' && teacherId !== '' && chosenSlot !== ''

  const submit = async () => {
    if (!ready || book.isPending) return
    setError(null)
    try {
      await book.mutateAsync({ prospectId, teacherId, startsAt: chosenSlot, durationMinutes: duration })
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  const dayLabel = (k: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${k}T12:00:00`))
  const timeLabel = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

  return (
    <Dialog
      title={tx(TR.bookTrial)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={!ready || book.isPending} onClick={() => void submit()}>
            {tx(TR.book)}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="bt-prospect">{tx(TR.prospect)}</label>
        <select id="bt-prospect" className="select" value={prospectId} onChange={(e) => setProspectId(e.target.value)}>
          <option value="">—</option>
          {openProspects.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}{p.level ? ` · ${p.level}` : ''}</option>
          ))}
        </select>
        {prospects.data && openProspects.length === 0 && <span className="ts-muted">{tx(TR.noProspects)}</span>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor="bt-teacher">{tx(TR.teacher)}</label>
        <select id="bt-teacher" className="select" value={teacherId} onChange={(e) => { setTeacherId(e.target.value); setDay(''); setSlot('') }}>
          <option value="">—</option>
          {(teachers.data?.teachers ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="bt-duration">{tx(TR.duration)}</label>
        <select id="bt-duration" className="select" value={duration} onChange={(e) => { setDuration(Number(e.target.value)); setSlot('') }}>
          {[30, 45, 60].map((n) => (
            <option key={n} value={n}>{formatMinutes(n, locale)}</option>
          ))}
        </select>
      </div>
      {teacherId !== '' && (
        slots.isLoading ? (
          <p className="ts-muted">{tx(TR.loadingSlots)}</p>
        ) : days.length === 0 ? (
          <p className="ts-muted">{tx(TR.noSlots)}</p>
        ) : (
          <>
            <div className="field">
              <label className="field__label" htmlFor="bt-day">{tx(TR.day)}</label>
              <select id="bt-day" className="select" value={chosenDay} onChange={(e) => { setDay(e.target.value); setSlot('') }}>
                {days.map((k) => (
                  <option key={k} value={k}>{dayLabel(k)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="bt-time">{tx(TR.time)}</label>
              <select id="bt-time" className="select" value={chosenSlot} onChange={(e) => setSlot(e.target.value)}>
                <option value="">—</option>
                {times.map((s) => (
                  <option key={s} value={s}>{timeLabel(s)}</option>
                ))}
              </select>
            </div>
          </>
        )
      )}
      {error !== null && (
        <div className="banner banner--danger" role="alert">{describeOpsError(error, locale)}</div>
      )}
    </Dialog>
  )
}
