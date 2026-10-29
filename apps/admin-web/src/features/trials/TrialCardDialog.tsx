import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { Pair } from '../teachers/copy'
import { describeOpsError, formatMinutes } from '../teachers/opsCopy'
import { trialsApi, type NotSubscribedReason, type OutcomeInput, type RecordedResult, type TrialDto } from './api'
import { NOT_SUBSCRIBED_REASON, OUTCOME, TR, formatWhen } from './copy'
import { useTrialGroup, useTrialOp } from './hooks'
import { SubscriptionForm, emptyChild, emptyDraft, formErrors, toInput, type SubscriptionDraft } from './SubscriptionForm'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import './trials.css'

export interface TrialPowers {
  noShow: boolean
  decide: boolean
  correct: boolean
}

type Step =
  | { at: 'pick' }
  | { at: 'options'; trial: TrialDto }
  | { at: RecordedResult; trial: TrialDto }

/** A fresh form for this trial: one child per booked student, with the trial's teacher. */
export function draftForTrial(trial: TrialDto): SubscriptionDraft {
  const draft = emptyDraft(trial.teacher.id)
  const students = trial.students ?? []
  if (students.length === 0) return draft
  return { ...draft, children: students.map((x) => ({ ...emptyChild(trial.teacher.id), name: x.name })) }
}

const SENTENCE: Record<RecordedResult, Pair> = {
  no_show: TR.sentenceNoShow,
  subscribed: TR.sentenceSubscribed,
  not_subscribed: TR.sentenceNotSubscribed,
}

/**
 * The "+ -> Trial" card (trial journey). In a teacher's trial group it first
 * asks WHICH trial -- the group holds all of that teacher's trials -- then
 * offers the three options:
 *
 *   1. the student did not attend          (either supervisor)
 *   2. the student subscribed  -> the form (Sales)
 *   3. why didn't the student subscribe?   (Sales)
 *
 * A trial that already has an outcome offers a correction instead (Sales, with
 * why). Whatever is typed, the group reads one short sentence; the dialog says
 * so before anything is sent. The server decides again.
 *
 * Opened from the chat with `conversationId`, or from the Trials page with one
 * `trial` and the caller's `powers`.
 */
export function TrialCardDialog(
  props: {
    onClose: () => void
    /** After an outcome is recorded: the chat re-reads its thread (realtime may be late or down). */
    onRecorded?: () => void
  } & ({ conversationId: string; trial?: undefined; powers?: undefined } | { conversationId?: undefined; trial: TrialDto; powers: TrialPowers }),
) {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const group = useTrialGroup(props.conversationId ?? '', props.conversationId !== undefined)
  const powers: TrialPowers = props.powers ?? group.data?.can ?? { noShow: false, decide: false, correct: false }
  const [step, setStep] = useState<Step>(props.trial ? { at: 'options', trial: props.trial } : { at: 'pick' })
  const [draft, setDraft] = useState<SubscriptionDraft>(() => (props.trial ? draftForTrial(props.trial) : emptyDraft()))
  const [reason, setReason] = useState<NotSubscribedReason | ''>('')
  const [note, setNote] = useState('')
  const [why, setWhy] = useState('')
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const op = useTrialOp((f: () => Promise<unknown>) => f())

  const correcting = step.at !== 'pick' && step.trial.outcome !== 'awaiting'

  const go = (next: Step) => {
    setError(null)
    setTried(false)
    // The form starts with the trial's own students as the children, taught
    // by the trial's teacher -- unless the supervisor has typed something.
    if (next.at === 'subscribed' && draft.children.every((c) => c.name.trim() === '')) {
      setDraft(draftForTrial(next.trial))
    }
    setStep(next)
  }

  const missing = (): boolean => {
    if (step.at === 'pick' || step.at === 'options') return true
    if (correcting && why.trim() === '') return true
    if (step.at === 'subscribed') return formErrors(draft).length > 0
    if (step.at === 'not_subscribed') return reason === '' || (reason === 'other' && note.trim() === '')
    return false
  }

  const submit = async () => {
    if (step.at === 'pick' || step.at === 'options' || op.isPending) return
    setTried(true)
    if (missing()) return
    const body: OutcomeInput =
      step.at === 'subscribed'
        ? { result: 'subscribed', subscription: toInput(draft) }
        : step.at === 'not_subscribed'
          ? { result: 'not_subscribed', reason: reason as NotSubscribedReason, ...(note.trim() ? { note: note.trim() } : {}) }
          : { result: 'no_show' }
    setError(null)
    try {
      await op.mutateAsync(() =>
        correcting ? trialsApi.correct(step.trial.id, { ...body, why: why.trim() }) : trialsApi.outcome(step.trial.id, body),
      )
      props.onRecorded?.()
      props.onClose()
    } catch (e) {
      setError(e)
    }
  }

  const options = (t: TrialDto) => {
    const current = t.outcome
    const all: Array<{ result: RecordedResult; label: Pair; allowed: boolean }> = [
      { result: 'no_show', label: TR.optionNoShow, allowed: correcting ? powers.correct : powers.noShow },
      { result: 'subscribed', label: TR.optionSubscribed, allowed: correcting ? powers.correct : powers.decide },
      { result: 'not_subscribed', label: TR.optionNotSubscribed, allowed: correcting ? powers.correct : powers.decide },
    ]
    return (
      <div className="tj-options">
        <p className="tj-trial-head">
          <strong dir="auto">{t.prospect.displayName}</strong>
          <span className="ts-muted">{formatWhen(t.startsAt, locale)} · {formatMinutes(t.durationMinutes, locale)}</span>
        </p>
        {correcting && (
          <p className="tj-current">
            {tx(TR.current)}: <strong>{tx(OUTCOME[current] ?? { en: current, ar: current })}</strong>
          </p>
        )}
        {all
          .filter((o) => !(correcting && o.result === current && o.result !== 'not_subscribed'))
          .map((o) => (
            <button key={o.result} type="button" className="tj-option" disabled={!o.allowed} onClick={() => go({ at: o.result, trial: t })}>
              <span>{tx(o.label)}</span>
              {!o.allowed && <span className="ts-muted tj-option__why">{tx(TR.salesOnly)}</span>}
            </button>
          ))}
      </div>
    )
  }

  const body = () => {
    switch (step.at) {
      case 'pick': {
        const trials = group.data?.trials ?? []
        return (
          <QueryBoundary isLoading={group.isLoading} error={group.error} onRetry={() => void group.refetch()}>
            {trials.length === 0 ? (
              <EmptyState title={tx(TR.noTrials)} />
            ) : (
              <>
                <p className="ts-muted">{tx(TR.pickTrialHint)}</p>
                <ul className="tj-picklist" aria-label={tx(TR.pickTrial)}>
                  {trials.map((t) => (
                    <li key={t.id}>
                      {/* A trial that has not started is shown, but its outcome is
                          accepted only once it starts (the server's rule). */}
                      <button
                        type="button"
                        className="tj-pick"
                        disabled={t.outcome === 'upcoming'}
                        aria-describedby={t.outcome === 'upcoming' ? `tj-up-${t.id}` : undefined}
                        onClick={() => go({ at: 'options', trial: t })}
                      >
                        <span dir="auto" className="tj-pick__name">{t.prospect.displayName}</span>
                        <span className="ts-muted">{formatWhen(t.startsAt, locale)}</span>
                        <span className={`badge${t.outcome === 'awaiting' ? ' badge--warn' : ''}`}>
                          {tx(t.outcome === 'awaiting' ? TR.needsOutcome : OUTCOME[t.outcome] ?? TR.recorded)}
                        </span>
                      </button>
                      {t.outcome === 'upcoming' && (
                        <p id={`tj-up-${t.id}`} className="ts-muted tj-pick__hint">{tx(TR.upcomingHint)}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </QueryBoundary>
        )
      }
      case 'options':
        return options(step.trial)
      default:
        return (
          <>
            <p className="tj-trial-head">
              <strong dir="auto">{step.trial.prospect.displayName}</strong>
              <span className="ts-muted">{formatWhen(step.trial.startsAt, locale)}</span>
            </p>
            {step.at === 'subscribed' && <SubscriptionForm value={draft} onChange={setDraft} showErrors={tried} />}
            {step.at === 'not_subscribed' && (
              <>
                <div className="field">
                  <label className="field__label" htmlFor="tj-reason">{tx(TR.reasonRequired)}</label>
                  <SearchableSelect id="tj-reason" className="select" value={reason} aria-invalid={tried && reason === ''} onValueChange={(v) => setReason(v as NotSubscribedReason)}>
                    <option value="">—</option>
                    {Object.entries(NOT_SUBSCRIBED_REASON).map(([value, l]) => (
                      <option key={value} value={value}>{tx(l)}</option>
                    ))}
                  </SearchableSelect>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="tj-note">{tx(TR.detailsOptional)}</label>
                  <textarea id="tj-note" className="input" rows={3} dir="auto" value={note} aria-invalid={tried && reason === 'other' && note.trim() === ''} onChange={(e) => setNote(e.target.value)} />
                </div>
              </>
            )}
            {correcting && (
              <div className="field">
                <label className="field__label" htmlFor="tj-why">{tx(TR.why)}</label>
                <textarea id="tj-why" className="input" rows={2} dir="auto" value={why} aria-invalid={tried && why.trim() === ''} onChange={(e) => setWhy(e.target.value)} />
              </div>
            )}
            <div className="tj-preview" role="note">
              <span className="ts-muted">{tx(TR.groupWillRead)}</span>
              <q dir="auto">{correcting ? `${tx(TR.correctOutcome)}: ` : ''}{tx(SENTENCE[step.at])}</q>
              {step.at === 'subscribed' && <span className="ts-muted">{tx(TR.privateNote)}</span>}
              {step.at === 'not_subscribed' && <span className="ts-muted">{tx(TR.reasonPrivate)}</span>}
            </div>
          </>
        )
    }
  }

  const back = step.at === 'options' ? (props.trial ? null : { at: 'pick' } as Step) : step.at === 'pick' ? null : { at: 'options', trial: step.trial } as Step
  const title = step.at === 'subscribed' ? tx(TR.formTitle) : correcting ? tx(TR.correctOutcome) : tx(TR.cardTitle)

  return (
    <Dialog
      title={title}
      onClose={props.onClose}
      footer={
        <>
          {back ? (
            <button type="button" className="btn" onClick={() => go(back)}>{tx(TR.back)}</button>
          ) : (
            <DialogCancelButton onClick={props.onClose} />
          )}
          {step.at !== 'pick' && step.at !== 'options' && (
            <button type="button" className="btn btn--primary" disabled={op.isPending} onClick={() => void submit()}>
              {tx(step.at === 'no_show' && !correcting ? TR.confirm : TR.submit)}
            </button>
          )}
        </>
      }
    >
      {body()}
      {error !== null && (
        <div className="banner banner--danger" role="alert">{describeOpsError(error, locale)}</div>
      )}
    </Dialog>
  )
}

/**
 * The join / leave bar above a trial group's composer. The teacher and the
 * Teacher Supervisors are permanent; a Sales supervisor joins to handle a
 * trial and leaves when done. Leaving never touches a trial's record.
 */
export function TrialGroupBar({ conversationId, onChanged }: { conversationId: string; onChanged?: () => void }) {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const group = useTrialGroup(conversationId)
  const op = useTrialOp((f: () => Promise<unknown>) => f())
  const [error, setError] = useState<unknown>(null)
  const m = group.data?.membership
  if (!m) return null
  const act = async (f: () => Promise<unknown>) => {
    setError(null)
    try {
      await op.mutateAsync(f)
      onChanged?.()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <div className="tj-bar" role="status">
      <span>{tx(m.permanent ? TR.memberBarPermanent : m.isMember ? TR.memberBarIn : TR.memberBarOut)}</span>
      {m.canJoin && (
        <button type="button" className="btn btn--sm btn--primary" disabled={op.isPending} onClick={() => void act(() => trialsApi.joinGroup(conversationId))}>
          {tx(TR.join)}
        </button>
      )}
      {m.canLeave && (
        <button type="button" className="btn btn--sm" disabled={op.isPending} onClick={() => void act(() => trialsApi.leaveGroup(conversationId))}>
          {tx(TR.leave)}
        </button>
      )}
      {error !== null && <span className="field__error" role="alert">{describeOpsError(error, locale)}</span>}
    </div>
  )
}
