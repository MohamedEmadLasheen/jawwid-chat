import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { adminSectionPath } from '@/features/admin/sections'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import { PLAN_MONTHS, planLabel } from '@/features/profiles/copy'
import type { PaymentRequest, PlanMonths, TrialPayments } from './api'
import { PAY, fromMinor, formatMoney, toMinor, useCopy } from './copy'
import { useCancelTrialRequest, useCreateTrialRequest, useTrialPayments } from './hooks'
import { Field, LinkPanel, PaymentList, ReasonDialog, RequestList, RequestStatusBadge, ServerError } from './PaymentParts'

/**
 * PD-27 on the New Students page: the trial's subscription payment requests
 * (and what was paid). Before Assign they are asked for here, the amount
 * starting from the subscription form's package prices. Assign attaches every
 * request, payment and invoice to the new family; they still show here, read
 * only, and anything new happens on the family's Parent Profile (the server
 * refuses a trial request once the student is enrolled).
 */
export function TrialPaymentsDialog({ trialId, name, onClose }: { trialId: string; name: string; onClose: () => void }) {
  const tx = useCopy()
  const q = useTrialPayments(trialId)
  const cancel = useCancelTrialRequest(trialId)
  const [created, setCreated] = useState<PaymentRequest | null>(null)
  const [cancelling, setCancelling] = useState<PaymentRequest | null>(null)
  const { staff } = useSession()
  const parentsList = staff && isSuperAdmin(staff.role) ? adminSectionPath('parents') : '/parents'

  if (cancelling) {
    return (
      <ReasonDialog
        title={tx(PAY.cancelRequestNamed, { label: cancelling.label })}
        hint={tx(PAY.cancelHint)}
        confirmLabel={tx(PAY.cancelConfirm)}
        pending={cancel.isPending}
        error={cancel.error}
        onSubmit={(reason) => cancel.mutate({ id: cancelling.id, reason }, { onSuccess: () => setCancelling(null) })}
        onClose={() => setCancelling(null)}
      />
    )
  }

  return (
    <Dialog
      title={tx(PAY.trialTitle, { name })}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {tx(PAY.done)}
        </button>
      }
    >
      <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} compact>
        {q.data && (
          <>
            {q.data.enrolledFamilyId ? (
              // Assigned: the money moved to the family. Its requests stay visible here; nothing is asked for or cancelled.
              <div className="banner" role="status">
                <p>{tx(PAY.trialAssigned)}</p>
                <Link className="btn btn--sm" to={`${parentsList}?q=${encodeURIComponent(name)}`} onClick={onClose}>
                  {tx(PAY.openParentProfile, { name })}
                </Link>
              </div>
            ) : (
              <>
                <p className="field__hint">{tx(PAY.trialHint)}</p>
                {created ? (
                  <LinkPanel request={created} />
                ) : (
                  <NewTrialRequestForm trialId={trialId} data={q.data} onCreated={setCreated} />
                )}
              </>
            )}
            <h3 className="tf-subtitle">{tx(PAY.requests)}</h3>
            <RequestList requests={q.data.items} canCancel={!q.data.enrolledFamilyId} onCancel={setCancelling} />
            <h3 className="tf-subtitle">{tx(PAY.trialPayments)}</h3>
            <PaymentList payments={q.data.payments} canVoid={false} canRefund={false} />
          </>
        )}
      </QueryBoundary>
    </Dialog>
  )
}

/**
 * The trial's requests at a glance on its New Students card, before and after
 * Assign: each one's status, label and amount. Rendered only for whoever may
 * open the dialog (it shares the dialog's query); quiet when the read fails.
 */
export function TrialRequestsSummary({ trialId }: { trialId: string }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const q = useTrialPayments(trialId)
  if (!q.data) return null
  if (q.data.items.length === 0) return <p className="tf-muted ns-requests__empty">{tx(PAY.noRequests)}</p>
  return (
    <ul className="ns-requests" aria-label={tx(PAY.requests)}>
      {q.data.items.map((r) => (
        <li key={r.id} className="ns-requests__item">
          <RequestStatusBadge status={r.status} />
          <span dir="auto" className="ns-requests__label">{r.label}</span>
          <span className="ns-requests__amount">{formatMoney(r.amountMinor, r.currency, locale)}</span>
        </li>
      ))}
    </ul>
  )
}

function NewTrialRequestForm({ trialId, data, onCreated }: { trialId: string; data: TrialPayments; onCreated: (r: PaymentRequest) => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const create = useCreateTrialRequest(trialId)
  const [label, setLabel] = useState(tx(PAY.subscriptionLabel))
  const [amount, setAmount] = useState(data.suggestedAmountMinor !== null ? fromMinor(data.suggestedAmountMinor, data.currency) : '')
  const [plan, setPlan] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [days, setDays] = useState('14')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const amountMinor = toMinor(amount, data.currency)
    const n = Number(days)
    const expiresInDays = Number.isInteger(n) && n >= 1 && n <= 90 ? n : null
    const next: Record<string, string> = {}
    if (label.trim() === '') next.label = tx(PAY.required)
    if (amountMinor === null) next.amount = tx(PAY.invalidAmount)
    if (expiresInDays === null) next.days = tx(PAY.invalidDays)
    if (periodStart && periodEnd && periodEnd < periodStart) next.period = tx(PAY.periodOrder)
    setErrors(next)
    if (Object.keys(next).length > 0 || amountMinor === null || expiresInDays === null) return
    create.mutate(
      {
        purpose: 'subscription',
        label: label.trim(),
        amountMinor,
        currency: data.currency,
        expiresInDays,
        ...(plan ? { planMonths: Number(plan) as PlanMonths } : {}),
        ...(periodStart ? { periodStart } : {}),
        ...(periodEnd ? { periodEnd } : {}),
      },
      { onSuccess: ({ request }) => onCreated(request) },
    )
  }

  return (
    <div className="pay-link" role="group" aria-label={tx(PAY.newRequest)}>
      <h3 className="tf-subtitle">{tx(PAY.newRequest)}</h3>
      <ServerError error={create.error} />
      <Field label={tx(PAY.label)} hint={tx(PAY.labelHint)} error={errors.label}>
        {(id, d) => <input id={id} className="input" dir="auto" value={label} maxLength={100} aria-describedby={d} onChange={(e) => setLabel(e.target.value)} />}
      </Field>
      <Field
        label={`${tx(PAY.amount)} (${data.currency})`}
        hint={data.suggestedAmountMinor !== null ? tx(PAY.suggested, { amount: formatMoney(data.suggestedAmountMinor, data.currency, locale) }) : undefined}
        error={errors.amount}
      >
        {(id, d) => <input id={id} className="input" inputMode="decimal" dir="ltr" value={amount} aria-describedby={d} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label={tx(PAY.plan)}>
        {(id) => (
          <select id={id} className="select" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">{tx(PAY.noPlan)}</option>
            {PLAN_MONTHS.map((n) => (
              <option key={n} value={n}>
                {planLabel(n, locale)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="pf-row">
        <Field label={tx(PAY.periodStart)} error={errors.period}>
          {(id) => <input id={id} className="input" type="date" dir="ltr" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />}
        </Field>
        <Field label={tx(PAY.periodEnd)}>
          {(id) => <input id={id} className="input" type="date" dir="ltr" min={periodStart || undefined} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />}
        </Field>
      </div>
      <Field label={tx(PAY.expiresIn)} hint={tx(PAY.expiresInHint)} error={errors.days}>
        {(id, d) => (
          <input id={id} className="input" type="number" inputMode="numeric" dir="ltr" min={1} max={90} value={days} aria-describedby={d} onChange={(e) => setDays(e.target.value)} />
        )}
      </Field>
      <div className="tf-actions">
        <button type="button" className="btn btn--primary" disabled={create.isPending} onClick={submit}>
          {create.isPending ? tx(PAY.creating) : tx(PAY.createLink)}
        </button>
      </div>
    </div>
  )
}
