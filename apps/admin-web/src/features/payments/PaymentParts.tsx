import { useId, useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { planLabel } from '@/features/profiles/copy'
import type { InvoiceStatus, Payment, PaymentRequest, ReceiptStatus, RequestStatus } from './api'
import {
  INVOICE_STATUS,
  METHOD,
  PAY,
  PURPOSE_LABEL,
  RECEIPT_STATUS,
  REQUEST_STATUS,
  describeError,
  formatDay,
  formatMoney,
  owed,
  useCopy,
  whatsappUrl,
} from './copy'
import { useDownloadInvoice } from './hooks'
import './payments.css'

/**
 * PD-27 pieces shared by the Parent Profile, New Students and the Payments
 * area: the link panel (Copy, Send on WhatsApp), the request and payment
 * lists, status chips, and the small form helpers their dialogs use.
 */

const REQUEST_TONE: Record<RequestStatus, Tone> = { open: 'info', paid: 'ok', cancelled: 'outline', expired: 'outline' }
const RECEIPT_TONE: Record<ReceiptStatus, Tone> = { pending: 'warn', approved: 'ok', rejected: 'danger' }
const INVOICE_TONE: Record<InvoiceStatus, Tone> = { paid: 'ok', partially_refunded: 'warn', refunded: 'outline', void: 'outline' }

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const tx = useCopy()
  return (
    <Badge tone={REQUEST_TONE[status]} dot>
      {tx(REQUEST_STATUS[status])}
    </Badge>
  )
}

export function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  const tx = useCopy()
  return (
    <Badge tone={RECEIPT_TONE[status]} dot>
      {tx(RECEIPT_STATUS[status])}
    </Badge>
  )
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const tx = useCopy()
  return (
    <Badge tone={INVOICE_TONE[status]} dot>
      {tx(INVOICE_STATUS[status])}
    </Badge>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  children: (id: string, describedBy?: string) => ReactNode
}) {
  const id = useId()
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children(id, describedBy)}
      {hint && (
        <span id={`${id}-hint`} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-err`} className="field__error">
          {error}
        </span>
      )}
    </div>
  )
}

export function ServerError({ error }: { error: unknown }) {
  const { locale } = useI18n()
  if (!error) return null
  return (
    <div className="banner banner--danger" role="alert">
      {describeError(error, locale)}
    </div>
  )
}

export function Footer({ onCancel, onSave, pending, saveLabel }: { onCancel: () => void; onSave: () => void; pending: boolean; saveLabel: string }) {
  const tx = useCopy()
  return (
    <>
      <DialogCancelButton onClick={onCancel} />
      <button type="button" className="btn btn--primary" disabled={pending} onClick={onSave}>
        {pending ? tx(PAY.saving) : saveLabel}
      </button>
    </>
  )
}

/** A final act that needs a reason: cancel a request, void a payment, reject a receipt. */
export function ReasonDialog({
  title,
  hint,
  confirmLabel,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  title: string
  hint: string
  confirmLabel: string
  pending: boolean
  error: unknown
  onSubmit: (reason: string) => void
  onClose: () => void
}) {
  const tx = useCopy()
  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)
  const submit = () => {
    if (reason.trim() === '') return setMissing(true)
    onSubmit(reason.trim())
  }
  return (
    <Dialog title={title} onClose={onClose} footer={<Footer onCancel={onClose} onSave={submit} pending={pending} saveLabel={confirmLabel} />}>
      <ServerError error={error} />
      <p className="field__hint">{hint}</p>
      <Field label={tx(PAY.reason)} error={missing ? tx(PAY.reasonRequired) : null}>
        {(id, d) => (
          <textarea id={id} className="input tf-textarea" dir="auto" rows={3} maxLength={500} value={reason} aria-describedby={d} onChange={(e) => setReason(e.target.value)} />
        )}
      </Field>
    </Dialog>
  )
}

/** Copy the link; say plainly when the browser would not let us. */
export function CopyLinkButton({ link, small = true }: { link: string; small?: boolean }) {
  const tx = useCopy()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <>
      <button type="button" className={small ? 'btn btn--sm' : 'btn'} onClick={() => void copy()}>
        {tx(PAY.copyLink)}
      </button>
      {state !== 'idle' && (
        <span className={state === 'copied' ? 'sp-ok' : 'field__error'} role="status">
          {tx(state === 'copied' ? PAY.copied : PAY.copyFailed)}
        </span>
      )}
    </>
  )
}

/** Opens the staff member's own WhatsApp in a new tab, with the message typed in. The server sends nothing. */
export function WhatsAppLink({ request, small = true }: { request: PaymentRequest; small?: boolean }) {
  const tx = useCopy()
  return (
    <a className={small ? 'btn btn--sm' : 'btn'} href={whatsappUrl(request)} target="_blank" rel="noopener noreferrer">
      {tx(PAY.whatsapp)}
    </a>
  )
}

/** The link just created (or an instalment's existing one): shown whole, with Copy and WhatsApp. */
export function LinkPanel({ request }: { request: PaymentRequest }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const id = useId()
  if (!request.link) return null
  return (
    <div className="pay-link" role="group" aria-label={tx(PAY.link)}>
      <p className="sp-ok" role="status">
        {tx(PAY.linkReady)}
      </p>
      <p className="pay-link__what">
        <strong dir="auto">{request.label}</strong> · {formatMoney(owed(request), request.currency, locale)}
      </p>
      <label className="field__label" htmlFor={id}>
        {tx(PAY.link)}
      </label>
      <input id={id} className="input pay-link__url" dir="ltr" readOnly value={request.link} onFocus={(e) => e.currentTarget.select()} />
      <div className="tf-actions">
        <CopyLinkButton link={request.link} small={false} />
        <WhatsAppLink request={request} small={false} />
      </div>
      <p className="field__hint">{tx(PAY.whatsappHint)}</p>
    </div>
  )
}

/** Payment requests, newest as the server orders them. Copy / WhatsApp / Cancel for open ones. */
export function RequestList({ requests, canCancel, onCancel }: { requests: PaymentRequest[]; canCancel: boolean; onCancel: (r: PaymentRequest) => void }) {
  const tx = useCopy()
  if (requests.length === 0) return <p className="tf-muted">{tx(PAY.noRequests)}</p>
  return (
    <ol className="pf-timeline" aria-label={tx(PAY.requests)}>
      {requests.map((r) => (
        <RequestItem key={r.id} request={r} canCancel={canCancel} onCancel={() => onCancel(r)} />
      ))}
    </ol>
  )
}

function RequestItem({ request: r, canCancel, onCancel }: { request: PaymentRequest; canCancel: boolean; onCancel: () => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const money = (n: number) => formatMoney(n, r.currency, locale)
  const open = r.status === 'open'
  return (
    <li className={open ? 'pf-entry' : 'pf-entry pf-entry--closed'}>
      <div className="pf-entry__head">
        <RequestStatusBadge status={r.status} />
        <strong dir="auto">{r.label}</strong>
        <span className="tf-muted">{tx(PURPOSE_LABEL[r.purpose])}</span>
      </div>
      <p className="pf-entry__meta pf-amount">{tx(PAY.amountLine, { amount: money(r.amountMinor), paid: money(r.paidMinor), remaining: money(r.remainingMinor) })}</p>
      <div className="pf-entry__meta">
        {r.child && <span dir="auto">{r.child.name}</span>}
        {r.planMonths && <span>{planLabel(r.planMonths, locale)}</span>}
        {r.periodStart && r.periodEnd && <span>{tx(PAY.period, { from: formatDay(r.periodStart, locale), to: formatDay(r.periodEnd, locale) })}</span>}
        {open && <span>{tx(PAY.expires, { date: dateTime(r.expiresAt) })}</span>}
        {r.createdBy && <span dir="auto">{tx(PAY.createdBy, { name: r.createdBy.name })}</span>}
      </div>
      {r.cancelled && (
        <p className="pf-entry__meta" dir="auto">
          {tx(PAY.cancelledBy, { name: r.cancelled.by.name, reason: r.cancelled.reason })}
        </p>
      )}
      {open && (r.link || canCancel) && (
        <div className="tf-actions">
          {r.link && <CopyLinkButton link={r.link} />}
          {r.link && <WhatsAppLink request={r} />}
          {canCancel && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel} aria-label={tx(PAY.cancelRequestNamed, { label: r.label })}>
              {tx(PAY.cancelRequest)}
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * Payments received. Void for a payment recorder (`canRecord`), never on a card
 * payment (it is refunded instead); Refund for a verifier only (`canVerify`);
 * a voided one takes neither; `voidable` lets the caller withhold Void where
 * the server would refuse it.
 */
export function PaymentList({
  payments,
  canVoid,
  canRefund,
  voidable = () => true,
  onVoid,
  onRefund,
}: {
  payments: Payment[]
  canVoid: boolean
  canRefund: boolean
  voidable?: (p: Payment) => boolean
  onVoid?: (p: Payment) => void
  onRefund?: (p: Payment) => void
}) {
  const tx = useCopy()
  if (payments.length === 0) return <p className="tf-muted">{tx(PAY.noPayments)}</p>
  return (
    <ol className="pf-timeline" aria-label={tx(PAY.received)}>
      {payments.map((p) => {
        const live = !p.voided
        const mayVoid = canVoid && live && p.method !== 'card' && !!onVoid && voidable(p)
        const mayRefund = canRefund && live && p.amountMinor - p.refundedMinor > 0 && !!onRefund
        return <PaymentItem key={p.id} payment={p} onVoid={mayVoid ? () => onVoid!(p) : undefined} onRefund={mayRefund ? () => onRefund!(p) : undefined} />
      })}
    </ol>
  )
}

function PaymentItem({ payment: p, onVoid, onRefund }: { payment: Payment; onVoid?: () => void; onRefund?: () => void }) {
  const tx = useCopy()
  const { locale, date } = useI18n()
  const money = (n: number) => formatMoney(n, p.currency, locale)
  return (
    <li className={p.voided ? 'pf-entry pf-entry--voided' : 'pf-entry'}>
      <div className="pf-entry__head">
        <Badge tone={p.voided ? 'outline' : 'ok'} dot>
          {tx(METHOD[p.method])}
        </Badge>
        <span className="pf-amount">{money(p.amountMinor)}</span>
        {p.refundedMinor > 0 && <span className="tf-muted">{tx(PAY.refunded, { amount: money(p.refundedMinor) })}</span>}
      </div>
      <div className="pf-entry__meta">
        <span>{tx(PAY.paidOnLine, { date: formatDay(p.paidOn, locale) })}</span>
        {p.recordedBy !== undefined && (
          <span dir="auto">{p.recordedBy === null ? tx(PAY.byStripe) : tx(PAY.recordedByLine, { name: p.recordedBy.name })}</span>
        )}
        {p.child && <span dir="auto">{p.child.name}</span>}
        {p.invoice && <span>{tx(PAY.invoiceNo, { number: p.invoice.number })}</span>}
        {p.reference && (
          <span>
            {tx(PAY.reference)}: <bdi dir="ltr">{p.reference}</bdi>
          </span>
        )}
      </div>
      {p.refunds?.map((r) => (
        <p key={r.id} className="pf-entry__meta" dir="auto">
          {tx(PAY.refundLine, {
            amount: money(r.amountMinor),
            date: date(r.at),
            source: tx(r.source === 'stripe' ? PAY.refundStripe : PAY.refundStaff),
            reason: r.reason,
          })}
        </p>
      ))}
      {p.voided && (
        <p className="pf-entry__meta" dir="auto">
          {tx(PAY.voidedLine, { name: p.voided.by.name, reason: p.voided.reason })}
        </p>
      )}
      {(onVoid || onRefund) && (
        <div className="tf-actions">
          {onRefund && (
            <button type="button" className="btn btn--sm" onClick={onRefund}>
              {tx(PAY.refund)}
            </button>
          )}
          {onVoid && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={onVoid}>
              {tx(PAY.voidPayment)}
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/** Asks for this viewer's signed PDF link at the click, then opens it. */
export function InvoiceDownloadButton({ invoiceId, number }: { invoiceId: string; number: string }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const download = useDownloadInvoice()
  return (
    <>
      <button
        type="button"
        className="btn btn--sm"
        disabled={download.isPending}
        onClick={() => download.mutate(invoiceId)}
        aria-label={tx(PAY.downloadNamed, { number })}
      >
        {tx(PAY.download)}
      </button>
      {download.error ? (
        <span className="field__error" role="alert">
          {describeError(download.error, locale)}
        </span>
      ) : null}
    </>
  )
}

/** A receipt's file: an image inline, a PDF as a link. The URL is signed for this viewer. */
export function ReceiptFile({ fileUrl, mimeType, label }: { fileUrl: string; mimeType: string; label: string }) {
  const tx = useCopy()
  if (mimeType.startsWith('image/')) {
    return (
      <a className="pay-receipt__thumb" href={fileUrl} target="_blank" rel="noopener noreferrer">
        <img src={fileUrl} alt={tx(PAY.receiptImage, { label })} loading="lazy" />
      </a>
    )
  }
  return (
    <a className="btn btn--sm" href={fileUrl} target="_blank" rel="noopener noreferrer">
      {tx(mimeType === 'application/pdf' ? PAY.openPdf : PAY.openFile)}
    </a>
  )
}
