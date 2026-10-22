import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { BankAccount, BillingSettings, InvoiceIssuer, Receipt, ReceiptStatus } from './api'
import { PAY, describeError, type Pair, formatDay, formatMoney, reminderLabel, toMinor, useCopy } from './copy'
import { useApproveReceipt, useBillingSettings, useCanVerifyPayments, useReceipts, useRejectReceipt, useSaveBillingSettings } from './hooks'
import { Field, Footer, ReasonDialog, ReceiptFile, ReceiptStatusBadge, ServerError } from './PaymentParts'
import './payments.css'

type Tab = 'receipts' | 'settings'
const STATUSES: readonly ReceiptStatus[] = ['pending', 'approved', 'rejected']
const FILTER_LABEL: Record<ReceiptStatus, Pair> = {
  pending: { en: 'Pending', ar: 'قيد الانتظار' },
  approved: { en: 'Approved', ar: 'معتمدة' },
  rejected: { en: 'Rejected', ar: 'مرفوضة' },
}
const DECIDED_LABEL: Record<'approved' | 'rejected', Pair> = {
  approved: { en: 'Approved', ar: 'اعتُمد' },
  rejected: { en: 'Rejected', ar: 'رُفض' },
}

/**
 * PD-27: the Payments area. Receipts -- the bank transfers parents reported,
 * waiting for a verifier -- and Settings: the bank account parents pay into,
 * the invoice issuer, which reminders fire, and whether Stripe is configured.
 * Approve / Reject appear only when GET /instalments/access says
 * `canVerifyPayments`; Settings are editable only when the server says
 * `canEdit`. The server decides each request again.
 */
export function PaymentsPage({ eyebrow }: { eyebrow?: string }) {
  const tx = useCopy()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'settings' ? 'settings' : 'receipts'
  const choose = (next: Tab) => {
    const p = new URLSearchParams(params)
    if (next === 'receipts') p.delete('tab')
    else p.set('tab', next)
    setParams(p, { replace: true })
  }
  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(PAY.title)} subtitle={tx(PAY.subtitle)} />
        <div className="pay-tabs">
          <FilterChips<Tab>
            variant="tabs"
            label={tx(PAY.tabs)}
            value={tab}
            onChange={choose}
            options={[
              { value: 'receipts', label: tx(PAY.receiptsTab) },
              { value: 'settings', label: tx(PAY.settingsTab) },
            ]}
          />
        </div>
        {tab === 'receipts' ? <ReceiptsTab /> : <SettingsTab />}
      </div>
    </div>
  )
}

function ReceiptsTab() {
  const tx = useCopy()
  const { locale } = useI18n()
  const [status, setStatus] = useState<ReceiptStatus>('pending')
  const list = useReceipts(status)
  const canVerify = useCanVerifyPayments()
  const [deciding, setDeciding] = useState<{ kind: 'approve' | 'reject'; receipt: Receipt } | null>(null)
  const counts = list.data?.counts

  return (
    <>
      <FilterChips<ReceiptStatus>
        label={tx(PAY.status)}
        value={status}
        onChange={setStatus}
        options={STATUSES.map((s) => ({ value: s, label: tx(FILTER_LABEL[s]), count: counts?.[s] }))}
      />
      {!canVerify && <p className="field__hint">{tx(PAY.verifyOnly)}</p>}
      {list.error ? (
        <EmptyState icon="alert" title={describeError(list.error, locale)} />
      ) : (
        <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
          {!list.data || list.data.items.length === 0 ? (
            <EmptyState title={tx(PAY.noReceipts)} />
          ) : (
            <ul className="pay-receipts" aria-label={tx(PAY.receiptsTab)}>
              {list.data.items.map((r) => (
                <ReceiptRow
                  key={r.id}
                  receipt={r}
                  onApprove={canVerify && r.status === 'pending' ? () => setDeciding({ kind: 'approve', receipt: r }) : undefined}
                  onReject={canVerify && r.status === 'pending' ? () => setDeciding({ kind: 'reject', receipt: r }) : undefined}
                />
              ))}
            </ul>
          )}
        </QueryBoundary>
      )}
      {deciding?.kind === 'approve' && <ApproveDialog receipt={deciding.receipt} onClose={() => setDeciding(null)} />}
      {deciding?.kind === 'reject' && <RejectDialog receipt={deciding.receipt} onClose={() => setDeciding(null)} />}
    </>
  )
}

function ReceiptRow({ receipt: r, onApprove, onReject }: { receipt: Receipt; onApprove?: () => void; onReject?: () => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  return (
    <li className="card panel pay-receipt" aria-label={r.family ? `${r.family.name} · ${r.label}` : r.label}>
      <div className="pay-receipt__body">
        <div className="pf-entry__head">
          <ReceiptStatusBadge status={r.status} />
          {r.family && <strong dir="auto">{r.family.name}</strong>}
          <span dir="auto">{r.label}</span>
        </div>
        <dl className="tf-kv">
          <dt>{tx(PAY.amountSent)}</dt>
          <dd className="pf-amount">{formatMoney(r.amountMinor, r.currency, locale)}</dd>
          <dt>{tx(PAY.transferredOn)}</dt>
          <dd>{formatDay(r.transferredOn, locale)}</dd>
          <dt>{tx(PAY.uploadedAt)}</dt>
          <dd>
            {dateTime(r.uploadedAt)}
            {r.uploadedBy && (
              <>
                {' '}
                <span dir="auto">{tx(PAY.uploadedBy, { name: r.uploadedBy.name })}</span>
              </>
            )}
          </dd>
          {r.note && (
            <>
              <dt>{tx(PAY.note)}</dt>
              <dd dir="auto">{r.note}</dd>
            </>
          )}
        </dl>
        {r.status !== 'pending' && r.reviewedBy && r.reviewedAt && (
          <p className="pf-entry__meta" dir="auto">
            {tx(PAY.reviewedBy, { status: tx(DECIDED_LABEL[r.status]), name: r.reviewedBy.name, date: dateTime(r.reviewedAt) })}
          </p>
        )}
        {r.rejectReason && (
          <p className="pf-entry__meta" dir="auto">
            {tx(PAY.rejectedBecause, { reason: r.rejectReason })}
          </p>
        )}
        {(onApprove || onReject) && (
          <div className="tf-actions">
            {onApprove && (
              <button type="button" className="btn btn--sm btn--primary" onClick={onApprove}>
                {tx(PAY.approve)}
              </button>
            )}
            {onReject && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={onReject}>
                {tx(PAY.reject)}
              </button>
            )}
          </div>
        )}
      </div>
      <ReceiptFile fileUrl={r.fileUrl} mimeType={r.mimeType} label={r.label} />
    </li>
  )
}

/** Approve, optionally correcting the amount and the date; only what was changed is sent. */
function ApproveDialog({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const approve = useApproveReceipt()
  const [amount, setAmount] = useState('')
  const [paidOn, setPaidOn] = useState(receipt.transferredOn)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    let amountMinor: number | undefined
    if (amount.trim() !== '') {
      const v = toMinor(amount, receipt.currency)
      if (v === null) return setError(tx(PAY.invalidAmount))
      amountMinor = v
    }
    setError(null)
    approve.mutate(
      { id: receipt.id, amountMinor, paidOn: paidOn && paidOn !== receipt.transferredOn ? paidOn : undefined },
      { onSuccess: onClose },
    )
  }
  return (
    <Dialog
      title={tx(PAY.approveTitle, { label: receipt.label })}
      onClose={onClose}
      footer={<Footer onCancel={onClose} onSave={submit} pending={approve.isPending} saveLabel={tx(PAY.approve)} />}
    >
      <ServerError error={approve.error} />
      <p className="field__hint">{tx(PAY.approveHint)}</p>
      <Field
        label={tx(PAY.correctedAmount)}
        hint={tx(PAY.correctedAmountHint, { amount: formatMoney(receipt.amountMinor, receipt.currency, locale) })}
        error={error}
      >
        {(id, d) => <input id={id} className="input" inputMode="decimal" dir="ltr" value={amount} aria-describedby={d} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label={tx(PAY.paidOn)}>
        {(id) => <input id={id} className="input" type="date" dir="ltr" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
      </Field>
    </Dialog>
  )
}

function RejectDialog({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const tx = useCopy()
  const reject = useRejectReceipt()
  return (
    <ReasonDialog
      title={tx(PAY.rejectTitle, { label: receipt.label })}
      hint={tx(PAY.rejectHint)}
      confirmLabel={tx(PAY.reject)}
      pending={reject.isPending}
      error={reject.error}
      onSubmit={(reason) => reject.mutate({ id: receipt.id, reason }, { onSuccess: onClose })}
      onClose={onClose}
    />
  )
}

function SettingsTab() {
  const { locale } = useI18n()
  const settings = useBillingSettings()
  if (settings.error) return <EmptyState icon="alert" title={describeError(settings.error, locale)} />
  return (
    <QueryBoundary isLoading={settings.isLoading} error={null} onRetry={() => void settings.refetch()}>
      {/* The form starts from what the server held when it was opened; a save keeps what was typed. */}
      {settings.data && <SettingsForm settings={settings.data} />}
    </QueryBoundary>
  )
}

type BankDraft = Record<keyof BankAccount, string>
type IssuerDraft = Record<keyof InvoiceIssuer, string>

const BANK_FIELDS: ReadonlyArray<{ key: keyof BankAccount; label: keyof typeof PAY; dir: 'ltr' | 'auto' }> = [
  { key: 'accountName', label: 'accountName', dir: 'auto' },
  { key: 'bankName', label: 'bankName', dir: 'auto' },
  { key: 'iban', label: 'iban', dir: 'ltr' },
  { key: 'accountNumber', label: 'accountNumber', dir: 'ltr' },
  { key: 'swift', label: 'swift', dir: 'ltr' },
]

const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

function SettingsForm({ settings }: { settings: BillingSettings }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const save = useSaveBillingSettings()
  const b = settings.bankAccount
  const [bank, setBank] = useState<BankDraft>({
    bankName: b?.bankName ?? '',
    accountName: b?.accountName ?? '',
    iban: b?.iban ?? '',
    accountNumber: b?.accountNumber ?? '',
    swift: b?.swift ?? '',
    note: b?.note ?? '',
  })
  const [issuer, setIssuer] = useState<IssuerDraft>({
    name: settings.issuer?.name ?? '',
    address: settings.issuer?.address ?? '',
    taxId: settings.issuer?.taxId ?? '',
  })
  const [reminders, setReminders] = useState(() => settings.reminders.map((r) => ({ ...r })))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const editable = settings.canEdit

  const submit = () => {
    const next: Record<string, string> = {}
    const anyBank = Object.values(bank).some((v) => v.trim() !== '')
    const anyIssuer = Object.values(issuer).some((v) => v.trim() !== '')
    if (anyBank && bank.accountName.trim() === '') next.accountName = tx(PAY.accountNameRequired)
    if (anyIssuer && issuer.name.trim() === '') next.issuerName = tx(PAY.issuerNameRequired)
    setErrors(next)
    setSaved(false)
    if (Object.keys(next).length > 0) return
    save.mutate(
      {
        bankAccount: anyBank
          ? {
              accountName: bank.accountName.trim(),
              bankName: orNull(bank.bankName),
              iban: orNull(bank.iban),
              accountNumber: orNull(bank.accountNumber),
              swift: orNull(bank.swift),
              note: orNull(bank.note),
            }
          : null,
        issuer: anyIssuer ? { name: issuer.name.trim(), address: orNull(issuer.address), taxId: orNull(issuer.taxId) } : null,
        reminders: reminders.map((r) => ({ key: r.key, enabled: r.enabled })),
      },
      { onSuccess: () => setSaved(true) },
    )
  }

  return (
    <div className="pay-settings">
      {!editable && <p className="field__hint">{tx(PAY.readOnlySettings)}</p>}
      <ServerError error={save.error} />

      <section className="card panel tf-section" aria-labelledby="pay-card">
        <div className="tf-section__head">
          <h2 id="pay-card" className="tf-section__title">
            {tx(PAY.card)}
          </h2>
          <Badge tone={settings.cardAvailable ? 'ok' : 'outline'} dot>
            {tx(settings.cardAvailable ? PAY.cardOn : PAY.cardOff)}
          </Badge>
        </div>
        {settings.cardAvailable && (
          <p className="pf-entry__meta">
            <Badge tone={settings.webhookConfigured ? 'ok' : 'danger'} dot>
              {tx(settings.webhookConfigured ? PAY.webhookOn : PAY.webhookOff)}
            </Badge>
          </p>
        )}
      </section>

      <section className="card panel tf-section" aria-labelledby="pay-bank">
        <div className="tf-section__head">
          <h2 id="pay-bank" className="tf-section__title">
            {tx(PAY.bankAccount)}
          </h2>
        </div>
        <p className="field__hint">{tx(PAY.bankHint)}</p>
        {!b && !editable && <p className="tf-muted">{tx(PAY.noBankAccount)}</p>}
        <fieldset disabled={!editable}>
          <legend className="sr-only">{tx(PAY.bankAccount)}</legend>
          {BANK_FIELDS.map((f) => (
            <Field key={f.key} label={tx(PAY[f.label])} error={f.key === 'accountName' ? errors.accountName : null}>
              {(id, d) => (
                <input
                  id={id}
                  className="input"
                  dir={f.dir}
                  value={bank[f.key]}
                  maxLength={f.key === 'iban' ? 34 : 120}
                  aria-describedby={d}
                  onChange={(e) => setBank((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
          <Field label={tx(PAY.bankNote)} hint={tx(PAY.bankNoteHint)}>
            {(id, d) => (
              <textarea
                id={id}
                className="input tf-textarea"
                dir="auto"
                rows={2}
                maxLength={500}
                value={bank.note}
                aria-describedby={d}
                onChange={(e) => setBank((v) => ({ ...v, note: e.target.value }))}
              />
            )}
          </Field>
        </fieldset>
      </section>

      <section className="card panel tf-section" aria-labelledby="pay-issuer">
        <div className="tf-section__head">
          <h2 id="pay-issuer" className="tf-section__title">
            {tx(PAY.issuer)}
          </h2>
        </div>
        <p className="field__hint">{tx(PAY.issuerHint)}</p>
        <fieldset disabled={!editable}>
          <legend className="sr-only">{tx(PAY.issuer)}</legend>
          <Field label={tx(PAY.issuerName)} error={errors.issuerName}>
            {(id, d) => (
              <input id={id} className="input" dir="auto" value={issuer.name} maxLength={160} aria-describedby={d} onChange={(e) => setIssuer((v) => ({ ...v, name: e.target.value }))} />
            )}
          </Field>
          <Field label={tx(PAY.address)}>
            {(id) => (
              <textarea id={id} className="input tf-textarea" dir="auto" rows={2} maxLength={500} value={issuer.address} onChange={(e) => setIssuer((v) => ({ ...v, address: e.target.value }))} />
            )}
          </Field>
          <Field label={tx(PAY.taxId)}>
            {(id) => <input id={id} className="input" dir="ltr" value={issuer.taxId} maxLength={64} onChange={(e) => setIssuer((v) => ({ ...v, taxId: e.target.value }))} />}
          </Field>
        </fieldset>
      </section>

      <section className="card panel tf-section" aria-labelledby="pay-reminders">
        <div className="tf-section__head">
          <h2 id="pay-reminders" className="tf-section__title">
            {tx(PAY.reminders)}
          </h2>
        </div>
        <p className="field__hint">{tx(PAY.remindersHint)}</p>
        <fieldset disabled={!editable}>
          <legend className="sr-only">{tx(PAY.reminders)}</legend>
          <ul className="pay-reminders">
            {reminders.map((r, i) => (
              <li key={r.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => setReminders((rs) => rs.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))}
                  />
                  {reminderLabel(r.offsetDays, locale)}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </section>

      {editable && (
        <div className="tf-actions">
          <button type="button" className="btn btn--primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? tx(PAY.saving) : tx(PAY.save)}
          </button>
          {saved && (
            <span className="sp-ok" role="status">
              {tx(PAY.saved)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
