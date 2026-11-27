import { useEffect, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Dialog } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon } from '@/shared/components/Icon'
import { DetailActions, RequestQueue, useWidePane } from '@/shared/components/RequestQueue'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { relativeTime } from '@/features/admin/copy'
import type { Receipt, ReceiptStatus } from './api'
import { PAY, describeError, type Pair, formatDay, formatMoney, toMinor, useCopy } from './copy'
import { useApproveReceipt, useReceipts, useRejectReceipt } from './hooks'
import { Money } from './Money'
import { Field, Footer, ReasonDialog, ReceiptStatusBadge, ServerError } from './PaymentParts'


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
 * Receipts as a review desk: the queue of bank transfers parents reported
 * (what waits for a decision first), and beside it the receipt being read --
 * its image large, the amount the parent says they sent, the facts, and the
 * decision. From 1100px the inspector stays on screen and a decision moves it
 * to the next receipt; below that it is the side sheet a row opens.
 *
 * Approve and Reject appear only when GET /payment-receipts says `canDecide`
 * (the payment recorders); the server decides each request again. A reject
 * needs a reason. Keys, when not typing: J and K move, A approves, R rejects.
 */
export function ReceiptsDesk({ onSeeTransactions }: { onSeeTransactions: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const wide = useWidePane()
  const [status, setStatus] = useState<ReceiptStatus>('pending')
  const list = useReceipts(status)
  const items = list.data?.items ?? []
  const canDecide = list.data?.canDecide === true
  const counts = list.data?.counts
  // The receipt being read. Kept by id: the list re-reads its signed links. Beside the
  // queue there is always one (the first, until another is chosen).
  const [openId, setOpenId] = useState<string | null>(null)
  const open = items.find((r) => r.id === openId) ?? (wide ? (items[0] ?? null) : null)
  const [deciding, setDeciding] = useState<{ kind: 'approve' | 'reject'; receipt: Receipt } | null>(null)
  const mayDecide = (r: Receipt | null): r is Receipt => r !== null && canDecide && r.status === 'pending'

  const move = (by: number) => {
    if (items.length === 0) return
    const at = open ? items.findIndex((r) => r.id === open.id) : -1
    const next = items[Math.min(items.length - 1, Math.max(0, at + by))]
    if (next) setOpenId(next.id)
  }
  // A decision takes the receipt out of this list: the desk moves on to the one after it.
  const decided = () => {
    const at = deciding ? items.findIndex((r) => r.id === deciding.receipt.id) : -1
    const next = at < 0 ? null : (items[at + 1] ?? items[at - 1] ?? null)
    setDeciding(null)
    setOpenId(wide ? (next?.id ?? null) : null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || deciding) return
      const t = e.target instanceof HTMLElement ? e.target : null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      // Another dialog or an open menu owns the keyboard; the receipt's own sheet does not.
      const dialog = document.querySelector('[role="dialog"]')
      if ((dialog && !dialog.querySelector('.rv')) || document.querySelector('[role="menu"]')) return
      // By position on the keyboard, so the Arabic layout works the same.
      if (e.code === 'KeyJ') move(1)
      else if (e.code === 'KeyK') move(-1)
      else if (e.code === 'KeyA' && mayDecide(open)) setDeciding({ kind: 'approve', receipt: open })
      else if (e.code === 'KeyR' && mayDecide(open)) setDeciding({ kind: 'reject', receipt: open })
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const detail = open
    ? {
        id: open.id,
        title: open.family?.name ?? open.label,
        kind: { icon: 'file' as const, label: tx(PAY.file) },
        status: <ReceiptStatusBadge status={open.status} />,
        pinned: wide,
        // Escape belongs to the decision dialog while one is open over the sheet.
        onClose: () => {
          if (!deciding) setOpenId(null)
        },
        body: (
          <ReceiptInspector
            receipt={open}
            onApprove={mayDecide(open) ? () => setDeciding({ kind: 'approve', receipt: open }) : undefined}
            onReject={mayDecide(open) ? () => setDeciding({ kind: 'reject', receipt: open }) : undefined}
          />
        ),
      }
    : null

  return (
    <div className="rv-desk">
      <RequestQueue label={tx(PAY.file)} detail={detail}>
        <div className="sheet rv-queue">
          <div className="sheet-bar">
            <FilterChips<ReceiptStatus>
              label={tx(PAY.status)}
              value={status}
              onChange={(next) => {
                setStatus(next)
                setOpenId(null)
              }}
              options={STATUSES.map((s) => ({ value: s, label: tx(FILTER_LABEL[s]), count: counts?.[s] }))}
            />
            {wide && canDecide && (
              <span className="sheet-bar__end rv-keys" aria-hidden="true">
                <kbd className="kbd">J</kbd>
                <kbd className="kbd">K</kbd>
                <span>{tx(PAY.keysMove)}</span>
                <kbd className="kbd">A</kbd>
                <span>{tx(PAY.approve)}</span>
                <kbd className="kbd">R</kbd>
                <span>{tx(PAY.reject)}</span>
              </span>
            )}
          </div>
          {list.data && !canDecide && (
            <p className="pay-lock rv-queue__note">
              <Icon name="lock" size={16} />
              <span>{tx(PAY.decideOnly)}</span>
            </p>
          )}
          {list.error ? (
            <EmptyState icon="alert" title={describeError(list.error, locale)} />
          ) : (
            <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
              {items.length === 0 ? (
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
                <ul className="rv-rows" aria-label={tx(PAY.receiptsTab)}>
                  {items.map((r) => (
                    <QueueRow key={r.id} receipt={r} current={open?.id === r.id} onOpen={() => setOpenId(r.id)} />
                  ))}
                </ul>
              )}
            </QueryBoundary>
          )}
        </div>
      </RequestQueue>
      {deciding?.kind === 'approve' && <ApproveDialog receipt={deciding.receipt} onClose={() => setDeciding(null)} onDone={decided} />}
      {deciding?.kind === 'reject' && <RejectDialog receipt={deciding.receipt} onClose={() => setDeciding(null)} onDone={decided} />}
    </div>
  )
}

/**
 * A receipt in the queue: whose it is and what it pays for, whether the parent
 * wrote a note; at the row's end the amount, the heaviest thing on it, and how
 * long ago it came. The list is already one status, so the row does not repeat it.
 */
function QueueRow({ receipt: r, current, onOpen }: { receipt: Receipt; current: boolean; onOpen: () => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  return (
    <li className="rv-rows__item" aria-label={r.family ? `${r.family.name}${locale === 'ar' ? '، ' : ', '}${r.label}` : r.label}>
      <button type="button" className="rv-row" aria-current={current ? 'true' : undefined} onClick={onOpen}>
        <Avatar name={r.family?.name ?? r.label} seed={r.family?.id ?? r.id} size="sm" />
        <span className="rv-row__who">
          {r.family && (
            <span className="rv-row__name">
              <bdi>{r.family.name}</bdi>
            </span>
          )}
          <span className={r.family ? 'rv-row__for' : 'rv-row__name'}>
            <bdi>{r.label}</bdi>
            {r.note && (
              <span className="rv-row__note">
                <Icon name="chatText" size={14} />
                {tx(PAY.hasNote)}
              </span>
            )}
          </span>
        </span>
        <span className="rv-row__end">
          <Money amountMinor={r.amountMinor} currency={r.currency} />
          <time className="rv-row__when" dateTime={r.uploadedAt} title={dateTime(r.uploadedAt)}>
            {relativeTime(r.uploadedAt, locale)}
          </time>
        </span>
      </button>
    </li>
  )
}

/** The receipt's file: an image at reading size, a PDF or any other file as the file it is. The link is signed for this viewer. */
function ReceiptImage({ receipt: r }: { receipt: Receipt }) {
  const tx = useCopy()
  const [failed, setFailed] = useState<string | null>(null)
  if (!r.mimeType.startsWith('image/')) {
    const pdf = r.mimeType === 'application/pdf'
    return (
      <div className="rv__image rv__image--file">
        <Icon name={pdf ? 'file' : 'paperclip'} size={28} />
        <a className="btn" href={r.fileUrl} target="_blank" rel="noopener noreferrer">
          {tx(pdf ? PAY.openPdf : PAY.openFile)}
        </a>
      </div>
    )
  }
  return (
    <div className="rv__image">
      {failed === r.fileUrl ? (
        <p className="rv__failed">{tx(PAY.imageFailed)}</p>
      ) : (
        <img src={r.fileUrl} alt={tx(PAY.receiptImage, { label: r.label })} onError={() => setFailed(r.fileUrl)} />
      )}
    </div>
  )
}

/**
 * The receipt being read: its image, the amount the parent says they sent, the
 * facts, then the decision -- one solid Approve and a plain Reject.
 */
function ReceiptInspector({ receipt: r, onApprove, onReject }: { receipt: Receipt; onApprove?: () => void; onReject?: () => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  return (
    <div className="rv">
      {/* What the parent says they sent, then the proof to read it against. */}
      <div className="rv__amount">
        <span className="section-label">{tx(PAY.amountSent)}</span>
        <Money amountMinor={r.amountMinor} currency={r.currency} size="lg" />
        <span className="rv__sub">{tx(PAY.transferredLine, { date: formatDay(r.transferredOn, locale) })}</span>
      </div>
      {/* The facts in one short band, so the receipt keeps the height of the sheet. */}
      <dl className="rq-fields rv__facts">
        <div className="rq-field">
          <dt>{tx(PAY.forWhat)}</dt>
          <dd>
            <bdi>{r.label}</bdi>
          </dd>
        </div>
        <div className="rq-field">
          <dt>{tx(PAY.uploadedAt)}</dt>
          <dd>
            <time dateTime={r.uploadedAt}>{dateTime(r.uploadedAt)}</time>
            {r.uploadedBy && (
              <>
                {' '}
                <bdi>{tx(PAY.uploadedBy, { name: r.uploadedBy.name })}</bdi>
              </>
            )}
          </dd>
        </div>
        {r.status !== 'pending' && r.reviewedBy && r.reviewedAt && (
          <div className="rq-field">
            <dt>{tx(PAY.status)}</dt>
            <dd>
              <span dir="auto">{tx(PAY.reviewedBy, { status: tx(DECIDED_LABEL[r.status]), name: r.reviewedBy.name, date: dateTime(r.reviewedAt) })}</span>
            </dd>
          </div>
        )}
        {r.rejectReason && (
          <div className="rq-field">
            <dt>{tx(PAY.reason)}</dt>
            <dd>
              <bdi>{r.rejectReason}</bdi>
            </dd>
          </div>
        )}
      </dl>
      {/* What the parent wrote is read before the proof: it often explains a difference (another name, another account). */}
      {r.note && (
        <figure className="rv__said">
          <figcaption className="rv__said-who">{r.uploadedBy ? tx(PAY.noteBy, { name: r.uploadedBy.name }) : tx(PAY.note)}</figcaption>
          <blockquote className="rv__note" dir="auto">
            {r.note}
          </blockquote>
        </figure>
      )}
      <ReceiptImage receipt={r} />
      {r.mimeType.startsWith('image/') && (
        <a className="rv__file" href={r.fileUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="external" size={15} />
          {tx(PAY.openFile)}
        </a>
      )}
      {(onApprove || onReject) && (
        <DetailActions>
          {onApprove && (
            <button type="button" className="btn btn--primary" onClick={onApprove}>
              {tx(PAY.approve)}
            </button>
          )}
          {onReject && (
            <button type="button" className="btn" onClick={onReject}>
              {tx(PAY.reject)}
            </button>
          )}
        </DetailActions>
      )}
    </div>
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
