import { useId, useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { formatDay } from '@/features/instalments/copy'
import { ReasonDialog } from '@/features/payments/PaymentParts'
import type { AccessState, ExceptionKind, LedgerRow, Standing, SubscriptionException } from './api'
import { KIND_LABEL, REASON_LABEL, S, SOURCE_LABEL, STATE_LABEL, describeError, isRefusal, lessonsLabel, monthsLabel, packageLabel, useCopy } from './copy'
import './subscriptions.css'
import { useAddSubscription, useGrantException, useRevokeException, useSubscription, useVoidSubscription } from './hooks'

const STATE_TONE: Record<AccessState, Tone> = { open: 'ok', grace: 'warn', locked: 'danger' }

/**
 * PD-30 on the Student Profile: what the child bought and used, whether the
 * group is locked and why, the ledger (recorders add and void), and the
 * exceptions (only the three roles grant and revoke). Shown only to the
 * family's billing readers: anyone the server refuses sees no section at all.
 */
export function SubscriptionPanel({ learnerId }: { learnerId: string }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const view = useSubscription(learnerId)
  const [adding, setAdding] = useState(false)
  const [granting, setGranting] = useState(false)
  const [voiding, setVoiding] = useState<LedgerRow | null>(null)
  const [revoking, setRevoking] = useState<SubscriptionException | null>(null)
  const voidSub = useVoidSubscription(learnerId)
  const revoke = useRevokeException(learnerId)

  if (view.error && isRefusal(view.error)) return null
  const data = view.data
  if (!data) return null
  const s = data.standing

  return (
    <section className="card panel tf-section" aria-labelledby="st-subscription">
      <div className="tf-section__head">
        <h2 id="st-subscription" className="tf-section__title">
          {tx(S.title)}
        </h2>
        {data.canRecord && (
          <button type="button" className="btn btn--sm" onClick={() => setAdding(true)}>
            {tx(S.add)}
          </button>
        )}
      </div>
      <p className="field__hint">{tx(S.hint)}</p>
      {!data.enforced && <div className="banner banner--info">{tx(S.notEnforced)}</div>}
      {s && <StandingSummary s={s} />}

      <h3 className="tf-subtitle">{tx(S.ledger)}</h3>
      {data.subscriptions.length === 0 ? (
        <p className="tf-muted">{tx(S.none)}</p>
      ) : (
        <ul className="sub-ledger">
          {data.subscriptions.map((r) => (
            <li key={r.id} className={r.voided ? 'sub-ledger__row sub-ledger__row--voided' : 'sub-ledger__row'}>
              <strong>{packageLabel(r.planMonths, r.lessonsIncluded, locale)}</strong>
              <span className="tf-muted">
                {' · '}
                {tx(S.startsOn)} {formatDay(r.startsOn, locale)} · {tx(SOURCE_LABEL[r.source])}
                {r.createdBy ? ` · ${tx(S.by, { name: r.createdBy.name })}` : ''}
              </span>
              {r.note && (
                <span className="field__hint" dir="auto">
                  {r.note}
                </span>
              )}
              {r.voided ? (
                <Badge tone="outline">
                  {tx(S.voided)}
                  {r.voided.reason ? ` — ${r.voided.reason}` : ''}
                </Badge>
              ) : (
                data.canRecord && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setVoiding(r)}>
                    {tx(S.void)}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="tf-subtitle">{tx(S.exceptions)}</h3>
      <p className="field__hint">{tx(S.exceptionsHint)}</p>
      {data.canGrantException && (
        <button type="button" className="btn btn--sm" onClick={() => setGranting(true)}>
          {tx(S.grant)}
        </button>
      )}
      {data.exceptions.length === 0 ? (
        <p className="tf-muted">{tx(S.noExceptions)}</p>
      ) : (
        <ul className="sub-ledger">
          {data.exceptions.map((e) => (
            <li key={e.id} className="sub-ledger__row">
              <Badge tone={e.active ? 'gold' : 'outline'}>{tx(e.revoked ? S.revoked : e.active ? S.active : S.ended)}</Badge>
              <strong>{tx(KIND_LABEL[e.kind])}</strong>
              <span className="tf-muted">
                {' · '}
                {tx(S.validUntil)} {formatDay(e.validUntil, locale)}
                {e.grantedBy ? ` · ${tx(S.by, { name: e.grantedBy.name })}` : ''}
              </span>
              <span className="field__hint" dir="auto">
                {e.reason}
                {e.revoked?.reason ? ` — ${e.revoked.reason}` : ''}
              </span>
              {e.active && data.canGrantException && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRevoking(e)}>
                  {tx(S.revoke)}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && <AddSubscriptionDialog learnerId={learnerId} onClose={() => setAdding(false)} />}
      {granting && <GrantExceptionDialog learnerId={learnerId} onClose={() => setGranting(false)} />}
      {voiding && (
        <ReasonDialog
          title={tx(S.voidTitle)}
          hint={packageLabel(voiding.planMonths, voiding.lessonsIncluded, locale) ?? ''}
          confirmLabel={tx(S.void)}
          pending={voidSub.isPending}
          error={voidSub.error}
          onSubmit={(reason) => voidSub.mutate({ id: voiding.id, reason }, { onSuccess: () => setVoiding(null) })}
          onClose={() => setVoiding(null)}
        />
      )}
      {revoking && (
        <ReasonDialog
          title={tx(S.revokeTitle)}
          hint={tx(KIND_LABEL[revoking.kind])}
          confirmLabel={tx(S.revoke)}
          pending={revoke.isPending}
          error={revoke.error}
          onSubmit={(reason) => revoke.mutate({ id: revoking.id, reason }, { onSuccess: () => setRevoking(null) })}
          onClose={() => setRevoking(null)}
        />
      )}
    </section>
  )
}

function StandingSummary({ s }: { s: Standing }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const notSet = <span className="tf-muted">{tx(S.noPlan)}</span>
  return (
    <dl className="tf-kv pf-kv sub-standing">
      <dt>{tx(S.state)}</dt>
      <dd>
        <Badge tone={STATE_TONE[s.state]} dot>
          {tx(STATE_LABEL[s.state])}
        </Badge>
        {s.state === 'grace' && s.graceLeft !== null && <span className="tf-muted"> · {tx(S.graceLeft, { n: s.graceLeft })}</span>}
        {s.lockReasons.length > 0 && (
          <span className="tf-muted">
            {' · '}
            {s.lockReasons.map((r) => tx(REASON_LABEL[r])).join(locale === 'ar' ? '، ' : ', ')}
            {s.overdue ? ` (${s.overdue.label}, ${formatDay(s.overdue.dueDate, locale)})` : ''}
          </span>
        )}
        {s.excepted.length > 0 && <span className="field__hint">{tx(S.exceptedNote)}</span>}
        {s.held && <span className="field__hint">{tx(S.heldNote)}</span>}
      </dd>
      <dt>{tx(S.current)}</dt>
      <dd>{s.current ? packageLabel(s.current.planMonths, s.current.lessonsIncluded, locale) : notSet}</dd>
      <dt>{tx(S.included)}</dt>
      <dd>{s.lessonsIncluded === null ? notSet : lessonsLabel(s.lessonsIncluded, locale)}</dd>
      <dt>{tx(S.used)}</dt>
      <dd>{s.lessonsUsed === null ? notSet : s.lessonsUsed}</dd>
      <dt>{tx(S.left)}</dt>
      <dd>
        {s.lessonsLeft === null ? notSet : s.lessonsLeft}
        {s.balance !== null && s.balance < 0 && <span className="tf-muted"> ({tx(S.balance)} {s.balance})</span>}
      </dd>
    </dl>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </div>
  )
}

function Footer({ onCancel, onSave, pending, label }: { onCancel: () => void; onSave: () => void; pending: boolean; label: string }) {
  const tx = useCopy()
  return (
    <>
      <DialogCancelButton onClick={onCancel} />
      <button type="button" className="btn btn--primary" disabled={pending} onClick={onSave}>
        {pending ? tx(S.saving) : label}
      </button>
    </>
  )
}

function ServerError({ error }: { error: unknown }) {
  const { locale } = useI18n()
  if (!error) return null
  return (
    <div className="banner banner--danger" role="alert">
      {describeError(error, locale)}
    </div>
  )
}

function lessonsOf(input: string): number | null {
  const n = Number(input)
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : null
}

function AddSubscriptionDialog({ learnerId, onClose }: { learnerId: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const add = useAddSubscription(learnerId)
  const [lessons, setLessons] = useState('')
  const [planMonths, setPlanMonths] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const n = lessonsOf(lessons)
    if (n === null) return setError(tx(S.invalidLessons))
    add.mutate(
      {
        lessonsIncluded: n,
        planMonths: planMonths ? Number(planMonths) : null,
        ...(startsOn ? { startsOn } : {}),
        note: note.trim() || null,
      },
      { onSuccess: onClose },
    )
  }
  return (
    <Dialog title={tx(S.add)} onClose={onClose} footer={<Footer onCancel={onClose} onSave={submit} pending={add.isPending} label={tx(S.save)} />}>
      <ServerError error={add.error} />
      <Field label={tx(S.lessons)} hint={tx(S.lessonsHint)} error={error}>
        {(id) => <input id={id} className="input" type="number" min={1} max={500} inputMode="numeric" value={lessons} onChange={(e) => setLessons(e.target.value)} />}
      </Field>
      <Field label={tx(S.plan)}>
        {(id) => (
          <select id={id} className="select" value={planMonths} onChange={(e) => setPlanMonths(e.target.value)}>
            <option value="">{tx(S.noPlan)}</option>
            {[1, 3, 6, 12].map((m) => (
              <option key={m} value={m}>
                {monthsLabel(m, locale)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={tx(S.startsOn)}>
        {(id) => <input id={id} className="input" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
      </Field>
      <Field label={tx(S.note)}>
        {(id) => <input id={id} className="input" dir="auto" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Dialog>
  )
}

function GrantExceptionDialog({ learnerId, onClose }: { learnerId: string; onClose: () => void }) {
  const tx = useCopy()
  const grant = useGrantException(learnerId)
  const [kind, setKind] = useState<ExceptionKind>('balance')
  const [reason, setReason] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const submit = () => {
    const next: Record<string, string> = {}
    if (reason.trim() === '') next.reason = tx(S.required)
    if (!validUntil) next.validUntil = tx(S.required)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    grant.mutate({ kind, reason: reason.trim(), validUntil }, { onSuccess: onClose })
  }
  return (
    <Dialog title={tx(S.grant)} onClose={onClose} footer={<Footer onCancel={onClose} onSave={submit} pending={grant.isPending} label={tx(S.grant)} />}>
      <ServerError error={grant.error} />
      <p className="field__hint">{tx(S.exceptionsHint)}</p>
      <Field label={tx(S.kind)}>
        {(id) => (
          <select id={id} className="select" value={kind} onChange={(e) => setKind(e.target.value as ExceptionKind)}>
            {(['balance', 'overdue', 'both'] as const).map((k) => (
              <option key={k} value={k}>
                {tx(KIND_LABEL[k])}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={tx(S.reason)} error={errors.reason}>
        {(id) => <textarea id={id} className="input tf-textarea" dir="auto" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Field label={tx(S.validUntil)} hint={tx(S.validUntilHint)} error={errors.validUntil}>
        {(id) => <input id={id} className="input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}
      </Field>
    </Dialog>
  )
}

