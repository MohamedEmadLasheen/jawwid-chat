import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, LoadingState, QueryBoundary } from '@/shared/components/States'
import type { BankAccount, BillingSettings, InvoiceIssuer, Receipt, ReceiptStatus } from './api'
import { LED, PAY, describeError, type Pair, formatDay, formatMoney, reminderLabel, toMinor, useCopy } from './copy'
import { RenewalRequestsPanel } from '@/features/subscriptions/RenewalRequestsPanel'
import { S } from '@/features/subscriptions/copy'
import { useApproveReceipt, useBillingSettings, useLedgerAccess, useReceipts, useRejectReceipt, useSaveBillingSettings } from './hooks'
import { FinanceLedger } from './FinanceLedger'
import { AttemptsTab, StripeEventsTab, TransactionsTab } from './LedgerTabs'
import { Money } from './Money'
import { Field, Footer, ReasonDialog, ReceiptStatusBadge, ServerError } from './PaymentParts'
import './payments.css'

type Tab = 'receipts' | 'transactions' | 'attempts' | 'events' | 'renewals' | 'settings'
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
 * waiting for a payment recorder -- and Settings: the bank account parents pay into,
 * the invoice issuer, which reminders fire, and whether Stripe is configured.
 * Approve / Reject appear only when GET /payment-receipts says `canDecide`
 * (the payment recorders); Settings are editable only when the server says
 * `canEdit`. The server decides each request again.
 */
export function PaymentsPage({ eyebrow }: { eyebrow?: string }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const [params, setParams] = useSearchParams()
  // The Stripe events tab is the reconcilers' only (the transactions list's `canReconcile`).
  const ledger = useLedgerAccess()
  const canReconcile = ledger.data === true
  const asked = params.get('tab')
  const tab: Tab =
    asked === 'settings' || asked === 'renewals' || asked === 'transactions' || asked === 'attempts'
      ? asked
      : asked === 'events' && canReconcile
        ? 'events'
        : 'receipts'
  // A link straight to the events tab waits for the server's word before falling back.
  const waiting = asked === 'events' && ledger.isLoading
  // W63: a paused card is said on every tab, not only in Settings.
  const cardPaused = useBillingSettings().data?.cardPaused === true
  const choose = (next: Tab) => {
    const p = new URLSearchParams(params)
    if (next === 'receipts') p.delete('tab')
    else p.set('tab', next)
    setParams(p, { replace: true })
  }
  // On a narrow screen the tabs scroll: the open one is brought to the middle of the strip,
  // again when the reconcilers' tab joins it and when the fonts settle the widths.
  const tabsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    const centre = () => {
      const strip = tabsRef.current?.querySelector<HTMLElement>('.seg')
      const open = strip?.querySelector<HTMLElement>('[aria-pressed="true"]')
      if (!live || !strip || !open) return
      const s = strip.getBoundingClientRect()
      const o = open.getBoundingClientRect()
      strip.scrollLeft += o.left + o.width / 2 - (s.left + s.width / 2)
    }
    centre()
    void document.fonts?.ready.then(centre)
    return () => {
      live = false
    }
  }, [tab, canReconcile, locale])
  return (
    <div className="page pay-page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(PAY.title)} subtitle={tx(PAY.subtitle)} />
        {/* Settings says it once, in its Card payments group. */}
        {cardPaused && tab !== 'settings' && (
          <div className="pay-paused" role="status" data-testid="card-paused-banner">
            <strong>{tx(PAY.cardPausedBanner)}</strong>
          </div>
        )}
        <FinanceLedger here="payments" />
        <div className="pay-tabs" ref={tabsRef}>
          <FilterChips<Tab>
            variant="tabs"
            label={tx(PAY.tabs)}
            value={tab}
            onChange={choose}
            options={[
              { value: 'receipts', label: tx(PAY.receiptsTab) },
              { value: 'transactions', label: tx(LED.transactionsTab) },
              { value: 'attempts', label: tx(LED.attemptsTab) },
              ...(canReconcile ? [{ value: 'events' as const, label: tx(LED.eventsTab) }] : []),
              { value: 'renewals', label: tx(S.renewalsTitle) },
              { value: 'settings', label: tx(PAY.settingsTab) },
            ]}
          />
        </div>
        {waiting ? (
          <LoadingState />
        ) : tab === 'receipts' ? (
          <ReceiptsTab onSeeTransactions={() => choose('transactions')} />
        ) : tab === 'transactions' ? (
          <TransactionsTab onSeeReceipts={() => choose('receipts')} />
        ) : tab === 'attempts' ? (
          <AttemptsTab />
        ) : tab === 'events' ? (
          <StripeEventsTab />
        ) : tab === 'renewals' ? (
          <RenewalRequestsPanel />
        ) : (
          <SettingsTab />
        )}
        {!waiting && (tab === 'receipts' || tab === 'transactions') && <LedgerRules />}
      </div>
    </div>
  )
}

/** What protects the ledger, one line each. */
function LedgerRules() {
  const tx = useCopy()
  return (
    <aside className="pay-rules" aria-label={tx(PAY.rules)}>
      <span className="section-label pay-rules__label">{tx(PAY.rules)}</span>
      <ul className="pay-rules__list">
        <li>{tx(PAY.ruleEdit)}</li>
        <li>{tx(PAY.ruleRefund)}</li>
        <li>{tx(PAY.ruleInvoice)}</li>
      </ul>
    </aside>
  )
}

function ReceiptsTab({ onSeeTransactions }: { onSeeTransactions: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const [status, setStatus] = useState<ReceiptStatus>('pending')
  const list = useReceipts(status)
  const canDecide = list.data?.canDecide === true
  const [deciding, setDeciding] = useState<{ kind: 'approve' | 'reject'; receipt: Receipt } | null>(null)
  // The receipt whose image is open beside its amount. Kept by id: the list re-reads its signed links.
  const [viewingId, setViewingId] = useState<string | null>(null)
  const viewing = viewingId ? (list.data?.items.find((r) => r.id === viewingId) ?? null) : null
  const counts = list.data?.counts
  const decided = () => {
    setDeciding(null)
    setViewingId(null)
  }

  return (
    <>
      <div className="pay-bar">
        <FilterChips<ReceiptStatus>
          label={tx(PAY.status)}
          value={status}
          onChange={setStatus}
          options={STATUSES.map((s) => ({ value: s, label: tx(FILTER_LABEL[s]), count: counts?.[s] }))}
        />
        {list.data && !canDecide && (
          <p className="pay-lock">
            <Icon name="lockNote" size={16} />
            <span>{tx(PAY.decideOnly)}</span>
          </p>
        )}
      </div>
      {list.error ? (
        <EmptyState icon="alert" title={describeError(list.error, locale)} />
      ) : (
        <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
          {!list.data || list.data.items.length === 0 ? (
            <EmptyState
              title={tx(status === 'pending' ? PAY.noReceipts : PAY.noDecided)}
              hint={tx(status === 'pending' ? PAY.noPendingHint : PAY.noDecidedHint)}
              action={
                status === 'pending' ? (
                  <button type="button" className="btn btn--sm" onClick={onSeeTransactions}>
                    {tx(PAY.seeTransactions)}
                  </button>
                ) : (
                  <button type="button" className="btn btn--sm" onClick={() => setStatus('pending')}>
                    {tx(PAY.backToPending)}
                  </button>
                )
              }
            />
          ) : (
            <ul className="rc-list" aria-label={tx(PAY.receiptsTab)}>
              {list.data.items.map((r) => (
                <ReceiptRow
                  key={r.id}
                  receipt={r}
                  onView={() => setViewingId(r.id)}
                  onApprove={canDecide && r.status === 'pending' ? () => setDeciding({ kind: 'approve', receipt: r }) : undefined}
                  onReject={canDecide && r.status === 'pending' ? () => setDeciding({ kind: 'reject', receipt: r }) : undefined}
                />
              ))}
            </ul>
          )}
        </QueryBoundary>
      )}
      {viewing && (
        <ReceiptDrawer
          receipt={viewing}
          // Escape belongs to the decision dialog while one is open over the drawer.
          onClose={() => {
            if (!deciding) setViewingId(null)
          }}
          onApprove={canDecide && viewing.status === 'pending' ? () => setDeciding({ kind: 'approve', receipt: viewing }) : undefined}
          onReject={canDecide && viewing.status === 'pending' ? () => setDeciding({ kind: 'reject', receipt: viewing }) : undefined}
        />
      )}
      {deciding?.kind === 'approve' && <ApproveDialog receipt={deciding.receipt} onClose={() => setDeciding(null)} onDone={decided} />}
      {deciding?.kind === 'reject' && <RejectDialog receipt={deciding.receipt} onClose={() => setDeciding(null)} onDone={decided} />}
    </>
  )
}

/**
 * The proof beside the amount: an image opens in the side drawer, a PDF or any
 * other file opens as the file it is. The link is signed for this viewer.
 */
function ReceiptProof({ receipt: r, onView }: { receipt: Receipt; onView: () => void }) {
  const tx = useCopy()
  const [failed, setFailed] = useState<string | null>(null)
  if (!r.mimeType.startsWith('image/')) {
    const name = tx(r.mimeType === 'application/pdf' ? PAY.openPdf : PAY.openFile)
    return (
      <a className="rc-proof rc-proof--file" href={r.fileUrl} target="_blank" rel="noopener noreferrer" aria-label={name} title={name}>
        {r.mimeType === 'application/pdf' ? <span dir="ltr">PDF</span> : <Icon name="paperclip" size={18} />}
      </a>
    )
  }
  const name = tx(PAY.viewReceipt, { label: r.label })
  return (
    <span className="rc-proof">
      {failed === r.fileUrl ? (
        <Icon name="image" size={18} />
      ) : (
        <img src={r.fileUrl} alt={tx(PAY.receiptImage, { label: r.label })} loading="lazy" onError={() => setFailed(r.fileUrl)} />
      )}
      <button type="button" className="rc-proof__open" onClick={onView} aria-label={name} title={name} />
    </span>
  )
}

function ReceiptDecision({ receipt: r }: { receipt: Receipt }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  return (
    <>
      {r.status !== 'pending' && r.reviewedBy && r.reviewedAt && (
        <p className="rc-sub" dir="auto">
          {tx(PAY.reviewedBy, { status: tx(DECIDED_LABEL[r.status]), name: r.reviewedBy.name, date: dateTime(r.reviewedAt) })}
        </p>
      )}
      {r.rejectReason && (
        <p className="rc-sub" dir="auto">
          {tx(PAY.rejectedBecause, { reason: r.rejectReason })}
        </p>
      )}
    </>
  )
}

function ReceiptActions({ onApprove, onReject }: { onApprove?: () => void; onReject?: () => void }) {
  const tx = useCopy()
  if (!onApprove && !onReject) return null
  return (
    <div className="rc-actions">
      {onApprove && (
        <button type="button" className="btn btn--sm btn--primary" onClick={onApprove}>
          {tx(PAY.approve)}
        </button>
      )}
      {onReject && (
        <button type="button" className="btn btn--sm" onClick={onReject}>
          {tx(PAY.reject)}
        </button>
      )}
    </div>
  )
}

function ReceiptRow({ receipt: r, onView, onApprove, onReject }: { receipt: Receipt; onView: () => void; onApprove?: () => void; onReject?: () => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  return (
    <li className="rc" aria-label={r.family ? `${r.family.name} · ${r.label}` : r.label}>
      <div className="rc__payer entity">
        <Avatar name={r.family?.name ?? r.label} seed={r.family?.id ?? r.id} size="sm" />
        <div className="entity__text">
          {r.family && (
            <strong className="entity__name">
              <bdi>{r.family.name}</bdi>
            </strong>
          )}
          <span className={r.family ? 'entity__sub' : 'entity__name'}>
            <bdi>{r.label}</bdi>
          </span>
        </div>
      </div>
      <div className="rc__proof">
        <ReceiptProof receipt={r} onView={onView} />
        <div className="rc__amount">
          <Money amountMinor={r.amountMinor} currency={r.currency} />
          <span className="rc-sub">{tx(PAY.transferredLine, { date: formatDay(r.transferredOn, locale) })}</span>
        </div>
      </div>
      <div className="rc__from">
        <span className="rc__when">
          <time dateTime={r.uploadedAt}>{dateTime(r.uploadedAt)}</time>
          {r.uploadedBy && <bdi className="rc__by">{tx(PAY.uploadedBy, { name: r.uploadedBy.name })}</bdi>}
        </span>
        {r.note && (
          <span className="rc__note">
            <bdi>{r.note}</bdi>
          </span>
        )}
      </div>
      <div className="rc__status">
        <ReceiptStatusBadge status={r.status} />
        <ReceiptDecision receipt={r} />
      </div>
      <ReceiptActions onApprove={onApprove} onReject={onReject} />
    </li>
  )
}

/** The receipt's image at reading size, the amount the parent says they sent beside it, and the decision. */
function ReceiptDrawer({ receipt: r, onClose, onApprove, onReject }: { receipt: Receipt; onClose: () => void; onApprove?: () => void; onReject?: () => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <Dialog variant="sheet" title={tx(PAY.receiptImage, { label: r.label })} onClose={onClose}>
      <div className="rc-drawer">
        <div className="rc-drawer__image">
          {failed === r.fileUrl ? (
            <p className="rc-drawer__failed">{tx(PAY.imageFailed)}</p>
          ) : (
            <img src={r.fileUrl} alt={tx(PAY.receiptImage, { label: r.label })} onError={() => setFailed(r.fileUrl)} />
          )}
        </div>
        <div className="rc-drawer__facts">
          <div className="rc-drawer__amount">
            <span className="section-label">{tx(PAY.amountSent)}</span>
            <Money amountMinor={r.amountMinor} currency={r.currency} size="lg" />
          </div>
          <dl className="rc-kv">
            {r.family && (
              <>
                <dt>{tx(PAY.family)}</dt>
                <dd>
                  <bdi>{r.family.name}</bdi>
                </dd>
              </>
            )}
            <dt>{tx(PAY.forWhat)}</dt>
            <dd>
              <bdi>{r.label}</bdi>
            </dd>
            <dt>{tx(PAY.transferredOn)}</dt>
            <dd>{formatDay(r.transferredOn, locale)}</dd>
            <dt>{tx(PAY.uploadedAt)}</dt>
            <dd>
              {dateTime(r.uploadedAt)}
              {r.uploadedBy && (
                <>
                  {' '}
                  <bdi>{tx(PAY.uploadedBy, { name: r.uploadedBy.name })}</bdi>
                </>
              )}
            </dd>
            {r.note && (
              <>
                <dt>{tx(PAY.note)}</dt>
                <dd>
                  <bdi>{r.note}</bdi>
                </dd>
              </>
            )}
            <dt>{tx(PAY.status)}</dt>
            <dd>
              <ReceiptStatusBadge status={r.status} />
              <ReceiptDecision receipt={r} />
            </dd>
          </dl>
          <ReceiptActions onApprove={onApprove} onReject={onReject} />
          <a className="rc-drawer__file" href={r.fileUrl} target="_blank" rel="noopener noreferrer">
            {tx(PAY.openFile)}
          </a>
        </div>
      </div>
    </Dialog>
  )
}

/** Approve, optionally correcting the amount and the date; only what was changed is sent. */
function ApproveDialog({ receipt, onClose, onDone }: { receipt: Receipt; onClose: () => void; onDone: () => void }) {
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
      { onSuccess: onDone },
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

function RejectDialog({ receipt, onClose, onDone }: { receipt: Receipt; onClose: () => void; onDone: () => void }) {
  const tx = useCopy()
  const reject = useRejectReceipt()
  return (
    <ReasonDialog
      title={tx(PAY.rejectTitle, { label: receipt.label })}
      hint={tx(PAY.rejectHint)}
      confirmLabel={tx(PAY.reject)}
      pending={reject.isPending}
      error={reject.error}
      onSubmit={(reason) => reject.mutate({ id: receipt.id, reason }, { onSuccess: onDone })}
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

const BANK_FIELDS: ReadonlyArray<{ key: keyof BankAccount; label: keyof typeof PAY; dir: 'ltr' | 'auto'; wide?: boolean }> = [
  { key: 'accountName', label: 'accountName', dir: 'auto' },
  { key: 'bankName', label: 'bankName', dir: 'auto' },
  { key: 'iban', label: 'iban', dir: 'ltr', wide: true },
  { key: 'accountNumber', label: 'accountNumber', dir: 'ltr' },
  { key: 'swift', label: 'swift', dir: 'ltr' },
]

const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

const bankDraft = (b: BankAccount | null): BankDraft => ({
  bankName: b?.bankName ?? '',
  accountName: b?.accountName ?? '',
  iban: b?.iban ?? '',
  accountNumber: b?.accountNumber ?? '',
  swift: b?.swift ?? '',
  note: b?.note ?? '',
})
const issuerDraft = (i: InvoiceIssuer | null): IssuerDraft => ({ name: i?.name ?? '', address: i?.address ?? '', taxId: i?.taxId ?? '' })

/** What a draft sends: null when every field is empty. */
const bankOf = (d: BankDraft): BankAccount | null =>
  Object.values(d).some((v) => v.trim() !== '')
    ? {
        accountName: d.accountName.trim(),
        bankName: orNull(d.bankName),
        iban: orNull(d.iban),
        accountNumber: orNull(d.accountNumber),
        swift: orNull(d.swift),
        note: orNull(d.note),
      }
    : null
const issuerOf = (d: IssuerDraft): InvoiceIssuer | null =>
  Object.values(d).some((v) => v.trim() !== '') ? { name: d.name.trim(), address: orNull(d.address), taxId: orNull(d.taxId) } : null
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** One group of settings: its name and what it is for at the start, its fields beside them. */
function SettingsGroup({ id, title, hint, edited, children }: { id: string; title: string; hint?: string; edited?: boolean; children: ReactNode }) {
  const tx = useCopy()
  return (
    <section className="set-group" aria-labelledby={id}>
      <div className="set-group__head">
        <h2 id={id} className="set-group__title">
          {title}
        </h2>
        {hint && <p className="set-group__hint">{hint}</p>}
        {edited && (
          <Badge tone="gold" dot>
            {tx(PAY.edited)}
          </Badge>
        )}
      </div>
      <div className="set-group__body">{children}</div>
    </section>
  )
}

function SettingsForm({ settings }: { settings: BillingSettings }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const save = useSaveBillingSettings()
  const b = settings.bankAccount
  const [bank, setBank] = useState<BankDraft>(() => bankDraft(b))
  const [issuer, setIssuer] = useState<IssuerDraft>(() => issuerDraft(settings.issuer))
  const [reminders, setReminders] = useState(() => settings.reminders.map((r) => ({ ...r })))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [confirmPause, setConfirmPause] = useState(false)
  const editable = settings.canEdit

  // A group is edited while what it would send differs from what the server holds.
  const edited = {
    bank: !same(bankOf(bank), bankOf(bankDraft(b))),
    issuer: !same(issuerOf(issuer), issuerOf(issuerDraft(settings.issuer))),
    reminders: reminders.some((r) => settings.reminders.find((x) => x.key === r.key)?.enabled !== r.enabled),
  }
  const editedNames = [edited.bank && tx(PAY.bankAccount), edited.issuer && tx(PAY.issuer), edited.reminders && tx(PAY.reminders)].filter(
    (name): name is string => typeof name === 'string',
  )

  const submit = () => {
    const next: Record<string, string> = {}
    const anyBank = bankOf(bank) !== null
    const anyIssuer = issuerOf(issuer) !== null
    if (anyBank && bank.accountName.trim() === '') next.accountName = tx(PAY.accountNameRequired)
    if (anyIssuer && issuer.name.trim() === '') next.issuerName = tx(PAY.issuerNameRequired)
    setErrors(next)
    setSaved(false)
    if (Object.keys(next).length > 0) return
    // The same request as ever: all three groups, whichever of them was edited.
    save.mutate(
      { bankAccount: bankOf(bank), issuer: issuerOf(issuer), reminders: reminders.map((r) => ({ key: r.key, enabled: r.enabled })) },
      { onSuccess: () => setSaved(true) },
    )
  }

  const cardLive = settings.cardAvailable || (settings.cardPaused && settings.cardConfigured)
  const inOrder = [...reminders].sort((x, y) => x.offsetDays - y.offsetDays)

  return (
    <div className="pay-settings">
      {!editable && (
        <p className="pay-lock">
          <Icon name="lockNote" size={16} />
          <span>{tx(PAY.readOnlySettings)}</span>
        </p>
      )}
      <ServerError error={save.error} />

      <SettingsGroup id="pay-card" title={tx(PAY.card)}>
        <div className="set-card">
          <div className="set-card__state">
            {settings.cardPaused ? (
              <CardPausedNote />
            ) : (
              <Badge tone={settings.cardAvailable ? 'ok' : 'outline'} dot>
                {tx(settings.cardAvailable ? PAY.cardOn : PAY.cardOff)}
              </Badge>
            )}
            {cardLive && (
              <Badge tone={settings.webhookConfigured ? 'ok' : 'danger'} dot>
                {tx(settings.webhookConfigured ? PAY.webhookOn : PAY.webhookOff)}
              </Badge>
            )}
          </div>
          {/* W63: the kill switch. Shown when there is something to pause (Stripe configured) or to undo. */}
          {editable && (settings.cardConfigured || settings.cardPaused) && (
            <button type="button" className={settings.cardPaused ? 'btn btn--primary' : 'btn btn--danger'} onClick={() => setConfirmPause(true)}>
              {tx(settings.cardPaused ? PAY.resumeCard : PAY.pauseCard)}
            </button>
          )}
        </div>
      </SettingsGroup>
      {confirmPause && <CardPauseDialog paused={settings.cardPaused} onClose={() => setConfirmPause(false)} />}

      <SettingsGroup id="pay-bank" title={tx(PAY.bankAccount)} hint={tx(PAY.bankHint)} edited={edited.bank}>
        {!b && !editable && <p className="set-none">{tx(PAY.noBankAccount)}</p>}
        <fieldset className="set-grid" disabled={!editable}>
          <legend className="sr-only">{tx(PAY.bankAccount)}</legend>
          {BANK_FIELDS.map((f) => (
            <Field key={f.key} label={tx(PAY[f.label])} error={f.key === 'accountName' ? errors.accountName : null} wide={f.wide}>
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
          <Field label={tx(PAY.bankNote)} hint={tx(PAY.bankNoteHint)} wide>
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
      </SettingsGroup>

      <SettingsGroup id="pay-issuer" title={tx(PAY.issuer)} hint={tx(PAY.issuerHint)} edited={edited.issuer}>
        <fieldset className="set-grid" disabled={!editable}>
          <legend className="sr-only">{tx(PAY.issuer)}</legend>
          <Field label={tx(PAY.issuerName)} error={errors.issuerName}>
            {(id, d) => (
              <input id={id} className="input" dir="auto" value={issuer.name} maxLength={160} aria-describedby={d} onChange={(e) => setIssuer((v) => ({ ...v, name: e.target.value }))} />
            )}
          </Field>
          <Field label={tx(PAY.taxId)}>
            {(id) => <input id={id} className="input" dir="ltr" value={issuer.taxId} maxLength={64} onChange={(e) => setIssuer((v) => ({ ...v, taxId: e.target.value }))} />}
          </Field>
          <Field label={tx(PAY.address)} wide>
            {(id) => (
              <textarea id={id} className="input tf-textarea" dir="auto" rows={2} maxLength={500} value={issuer.address} onChange={(e) => setIssuer((v) => ({ ...v, address: e.target.value }))} />
            )}
          </Field>
        </fieldset>
      </SettingsGroup>

      <SettingsGroup id="pay-reminders" title={tx(PAY.reminders)} hint={tx(PAY.remindersHint)} edited={edited.reminders}>
        <fieldset disabled={!editable}>
          <legend className="sr-only">{tx(PAY.reminders)}</legend>
          {/* Before the due date, on it, after it: the reminders in the order they fire. */}
          <ul className="set-reminders">
            {inOrder.map((r) => (
              <li key={r.key} className={r.offsetDays === 0 ? 'set-reminder set-reminder--due' : 'set-reminder'}>
                <label>
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => setReminders((rs) => rs.map((x) => (x.key === r.key ? { ...x, enabled: e.target.checked } : x)))}
                  />
                  {reminderLabel(r.offsetDays, locale)}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </SettingsGroup>

      {editable && (
        <div className={editedNames.length > 0 ? 'set-save set-save--edited' : 'set-save'}>
          <button type="button" className="btn btn--primary" disabled={save.isPending || editedNames.length === 0} onClick={submit}>
            {save.isPending ? tx(PAY.saving) : tx(PAY.save)}
          </button>
          {editedNames.length > 0 ? (
            <span className="set-save__state">{tx(PAY.unsaved, { groups: editedNames.join(locale === 'ar' ? '، ' : ', ') })}</span>
          ) : saved ? (
            <span className="set-save__state set-save__state--ok" role="status">
              <Icon name="check" size={16} />
              <span>{tx(PAY.saved)}</span>
            </span>
          ) : (
            <span className="set-save__state">{tx(PAY.saveScope)}</span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * W63, on the Settings tab: that card payments are paused and what it means, said once, in the
 * group that holds the switch. The same sentence as the banner the other tabs carry.
 */
function CardPausedNote() {
  const tx = useCopy()
  const state = tx(PAY.cardPausedBadge)
  const whole = tx(PAY.cardPausedBanner)
  // The sentence opens with the state's own words: those stand as the status, the rest beneath.
  const rest = whole.startsWith(state) ? whole.slice(state.length) : ` ${whole}`
  const joint = rest.match(/^[.،:;\s]*/)?.[0] ?? ''
  return (
    <div className="set-paused" role="status" data-testid="card-paused-banner">
      <Badge tone="danger" dot>
        {state}
      </Badge>
      <span className="sr-only">{joint}</span>
      <span className="set-paused__why">{rest.slice(joint.length)}</span>
    </div>
  )
}

/**
 * W63: confirm before pausing or resuming card payments. Sends only
 * `{ cardPaused }`; the server checks the role again and writes the audit row.
 */
function CardPauseDialog({ paused, onClose }: { paused: boolean; onClose: () => void }) {
  const tx = useCopy()
  const save = useSaveBillingSettings()
  const submit = () => save.mutate({ cardPaused: !paused }, { onSuccess: onClose })
  return (
    <Dialog
      title={tx(paused ? PAY.resumeCardTitle : PAY.pauseCardTitle)}
      onClose={onClose}
      footer={<Footer onCancel={onClose} onSave={submit} pending={save.isPending} saveLabel={tx(paused ? PAY.resumeCard : PAY.pauseCard)} />}
    >
      <ServerError error={save.error} />
      <p className="field__hint">{tx(paused ? PAY.resumeCardHint : PAY.pauseCardHint)}</p>
    </Dialog>
  )
}
