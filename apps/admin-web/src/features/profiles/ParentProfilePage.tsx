import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { adminSectionPath } from '@/features/admin/sections'
import { Avatar } from '@/shared/components/Avatar'
import { Badge, type Tone } from '@/shared/components/Badge'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { preparePhoto, type PreparedPhoto } from '@/features/profile/photo'
import { formatDay, formatMoney } from '@/features/instalments/copy'
import type { Payment, PaymentRequest } from '@/features/payments/api'
import { METHOD, PAY } from '@/features/payments/copy'
import { InvoiceDownloadButton, InvoiceStatusBadge, PaymentList, ReceiptFile, ReceiptStatusBadge, RequestList } from '@/features/payments/PaymentParts'
import { parentPath, studentPath, type FamilyBilling, type ParentProfile, type TimelineInstalment, type TimelineStatus } from './api'
import { METHOD_LABEL, P, TIMELINE_STATUS, countryName, describeError, isProfileRefusal, planLabel, useCopy } from './copy'
import { useFamilyBilling, useParent, useParentPhoto } from './hooks'
import { FamilyFeedbackSection } from './FamilyFeedbackSection'
import { IntakeDialog } from '@/features/intake/IntakeDialog'
import { I } from '@/features/intake/copy'
import { useIntakeOptions } from '@/features/intake/hooks'
import {
  CancelRequestDialog,
  EditBillingDialog,
  EditContactDialog,
  EditNoteDialog,
  InstalmentLinkDialog,
  NewInstalmentsDialog,
  RecordFamilyPaymentDialog,
  RecordPaymentDialog,
  RefundPaymentDialog,
  RequestPaymentDialog,
  VoidInstalmentDialog,
  VoidPaymentDialog,
} from './ProfileDialogs'
import '@/features/payments/payments.css'

const STATUS_TONE: Record<TimelineStatus, Tone> = { overdue: 'danger', due: 'warn', upcoming: 'info', paid: 'ok', voided: 'outline' }

type Dialogs =
  | { kind: 'contact' }
  | { kind: 'note' }
  | { kind: 'billing' }
  | { kind: 'new' }
  | { kind: 'pay'; instalment: TimelineInstalment }
  | { kind: 'void'; instalment: TimelineInstalment }
  | { kind: 'request' }
  | { kind: 'link'; instalment: TimelineInstalment }
  | { kind: 'cancelRequest'; request: PaymentRequest }
  | { kind: 'cash' }
  | { kind: 'voidPayment'; payment: Payment }
  | { kind: 'refund'; payment: Payment }

/**
 * PD-17: the Parent Profile, administration only. Contact information (with
 * the photo and the name every chat shows), the internal note, the children,
 * and the family's payments. The server decides who may open it -- the
 * Operations department in scope, the Operations Manager, the super admin --
 * and refuses a teacher on every route; this page only shows its answer.
 */
export function ParentProfilePage({ eyebrow }: { eyebrow?: string }) {
  const { contactId = '' } = useParams<{ contactId: string }>()
  const { staff } = useSession()
  // One URL per parent; back goes to the list this viewer has (the super admin's is a section).
  const backTo = staff && isSuperAdmin(staff.role) ? adminSectionPath('parents') : '/parents'
  const tx = useCopy()
  const { locale } = useI18n()
  const profile = useParent(contactId)
  const billing = useFamilyBilling(profile.data?.family.id)
  const [dialog, setDialog] = useState<Dialogs | null>(null)
  const data = profile.data
  const close = () => setDialog(null)

  return (
    <div className="page">
      <div className="page__inner">
        <p className="tf-back">
          <Link to={backTo}>{tx(P.back)}</Link>
        </p>
        {isProfileRefusal(profile.error) ? (
          <EmptyState icon="lock" title={describeError(profile.error, locale)} />
        ) : (
          <QueryBoundary isLoading={profile.isLoading} error={profile.error} onRetry={() => void profile.refetch()}>
            {data && (
              <>
                <PageHeader
                  eyebrow={eyebrow ?? tx(P.parent)}
                  title={data.name}
                  subtitle={data.family.name}
                  status={
                    <>
                      <Badge tone="info">{tx(P.adminOnly)}</Badge>
                      {!data.isActive && <Badge tone="outline">{tx(P.inactive)}</Badge>}
                    </>
                  }
                />
                <ContactSection profile={data} onEdit={() => setDialog({ kind: 'contact' })} />
                <NoteSection profile={data} onEdit={() => setDialog({ kind: 'note' })} />
                <ChildrenSection profile={data} />
                <FamilyFeedbackSection familyId={data.family.id} />
                {isProfileRefusal(billing.error) ? (
                  <Section id="pf-payments" title={tx(P.payments)}>
                    <p className="tf-muted">{describeError(billing.error, locale)}</p>
                  </Section>
                ) : (
                  <QueryBoundary isLoading={billing.isLoading} error={billing.error} onRetry={() => void billing.refetch()} compact>
                    {billing.data && <PaymentsSection billing={billing.data} onOpen={setDialog} />}
                  </QueryBoundary>
                )}
                {dialog?.kind === 'contact' && <EditContactDialog profile={data} onClose={close} />}
                {dialog?.kind === 'note' && <EditNoteDialog profile={data} onClose={close} />}
                {billing.data && dialog?.kind === 'billing' && <EditBillingDialog billing={billing.data} onClose={close} />}
                {billing.data && dialog?.kind === 'new' && <NewInstalmentsDialog billing={billing.data} children={data.children} onClose={close} />}
                {billing.data && dialog?.kind === 'pay' && <RecordPaymentDialog billing={billing.data} instalment={dialog.instalment} onClose={close} />}
                {billing.data && dialog?.kind === 'void' && <VoidInstalmentDialog billing={billing.data} instalment={dialog.instalment} onClose={close} />}
                {billing.data && dialog?.kind === 'request' && <RequestPaymentDialog billing={billing.data} children={data.children} onClose={close} />}
                {billing.data && dialog?.kind === 'link' && <InstalmentLinkDialog billing={billing.data} instalment={dialog.instalment} onClose={close} />}
                {billing.data && dialog?.kind === 'cancelRequest' && <CancelRequestDialog billing={billing.data} request={dialog.request} onClose={close} />}
                {billing.data && dialog?.kind === 'cash' && <RecordFamilyPaymentDialog billing={billing.data} children={data.children} onClose={close} />}
                {billing.data && dialog?.kind === 'voidPayment' && <VoidPaymentDialog billing={billing.data} payment={dialog.payment} onClose={close} />}
                {billing.data && dialog?.kind === 'refund' && <RefundPaymentDialog billing={billing.data} payment={dialog.payment} onClose={close} />}
              </>
            )}
          </QueryBoundary>
        )}
      </div>
    </div>
  )
}

function Section({ id, title, action, hint, children }: { id: string; title: string; action?: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <section className="card panel tf-section" aria-labelledby={id}>
      <div className="tf-section__head">
        <h2 id={id} className="tf-section__title">
          {title}
        </h2>
        {action}
      </div>
      {hint && <p className="field__hint">{hint}</p>}
      {children}
    </section>
  )
}

function ContactSection({ profile, onEdit }: { profile: ParentProfile; onEdit: () => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const c = profile.contact
  const missing = <span className="tf-muted">{tx(P.notRecorded)}</span>
  return (
    <Section
      id="pf-contact"
      title={tx(P.contactInfo)}
      action={
        profile.access.canEdit && (
          <button type="button" className="btn btn--sm" onClick={onEdit} aria-label={tx(P.editContact)}>
            {tx(P.edit)}
          </button>
        )
      }
    >
      <div className="pf-contact">
        <ParentPhoto profile={profile} />
        <dl className="tf-kv pf-kv">
          <dt>{tx(P.fullName)}</dt>
          <dd>
            <bdi>{profile.name}</bdi>
          </dd>
          <dt>{tx(P.phone)}</dt>
          {/* The value is LTR; the cell keeps the page direction, so it sits beside its label. */}
          <dd>{c.phone ? <bdi dir="ltr">{c.phone}</bdi> : missing}</dd>
          <dt>{tx(P.email)}</dt>
          <dd>{c.email ? <bdi dir="ltr">{c.email}</bdi> : missing}</dd>
          <dt>{tx(P.childrenCount)}</dt>
          <dd>{profile.childrenCount}</dd>
          <dt>{tx(P.country)}</dt>
          <dd>{c.countryCode ? countryName(c.countryCode, locale) : missing}</dd>
          <dt>{tx(P.region)}</dt>
          <dd>{c.region ? <bdi>{c.region}</bdi> : missing}</dd>
        </dl>
      </div>
      {profile.updatedAt && <p className="tf-byline">{tx(P.lastEdit, { date: dateTime(profile.updatedAt) })}</p>}
    </Section>
  )
}

/** Choose -> preview -> use; or remove. The current photo stays until the new one is committed. */
function ParentPhoto({ profile }: { profile: ParentProfile }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const inputId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const { upload, remove } = useParentPhoto(profile.id)
  const [prepared, setPrepared] = useState<PreparedPhoto | null>(null)
  const [problem, setProblem] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(
    () => () => {
      if (prepared) URL.revokeObjectURL?.(prepared.previewUrl)
    },
    [prepared],
  )

  const picture = prepared ? (
    <img className="pf-photo__img" src={prepared.previewUrl} alt={tx(P.photoPreview)} />
  ) : (
    <Avatar name={profile.name} seed={profile.id} src={profile.avatarUrl} size="lg" />
  )
  if (!profile.access.canEdit) return <div className="pf-photo">{picture}</div>

  const choose = async (file: File | undefined) => {
    setProblem(null)
    setNotice(null)
    if (!file) return
    try {
      setPrepared(await preparePhoto(file))
    } catch (error) {
      setProblem(error)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  const busy = upload.isPending || remove.isPending
  const error = problem ?? upload.error ?? remove.error

  return (
    <div className="pf-photo">
      {picture}
      <div className="pf-photo__controls">
        {prepared ? (
          <>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy}
              onClick={() =>
                upload.mutate(prepared.blob, {
                  onSuccess: () => {
                    setPrepared(null)
                    setNotice(tx(P.photoSaved))
                  },
                })
              }
            >
              {upload.isPending ? tx(P.photoUploading) : tx(P.photoUse)}
            </button>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => setPrepared(null)}>
              {tx(P.cancel)}
            </button>
          </>
        ) : (
          <>
            <label htmlFor={inputId} className="btn btn--sm sp-file-label">
              {profile.avatarUrl ? tx(P.photoReplace) : tx(P.photoChoose)}
            </label>
            <input
              ref={fileRef}
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sp-file-input"
              aria-describedby={`${inputId}-hint`}
              disabled={busy}
              onChange={(e) => void choose(e.target.files?.[0])}
            />
            {profile.avatarUrl && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                disabled={busy}
                onClick={() => remove.mutate(undefined, { onSuccess: () => setNotice(tx(P.photoRemoved)) })}
              >
                {tx(P.photoRemove)}
              </button>
            )}
          </>
        )}
        <span id={`${inputId}-hint`} className="field__hint">
          {tx(P.photoHint)}
        </span>
        {error ? (
          <span className="field__error" role="alert">
            {describeError(error, locale)}
          </span>
        ) : notice ? (
          <span className="sp-ok" role="status">
            {notice}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function NoteSection({ profile, onEdit }: { profile: ParentProfile; onEdit: () => void }) {
  const tx = useCopy()
  return (
    <Section
      id="pf-note"
      title={tx(P.about)}
      hint={tx(P.aboutHint)}
      action={
        profile.access.canEdit && (
          <button type="button" className="btn btn--sm" onClick={onEdit} aria-label={tx(P.editNote)}>
            {tx(P.edit)}
          </button>
        )
      }
    >
      {profile.adminNote ? (
        <p className="pf-note" dir="auto">
          {profile.adminNote}
        </p>
      ) : (
        <p className="tf-muted">{tx(P.noNote)}</p>
      )}
    </Section>
  )
}

function ChildrenSection({ profile }: { profile: ParentProfile }) {
  const tx = useCopy()
  // PD-42: "Add child", when the server says this viewer enters families (it decides the family).
  const intake = useIntakeOptions()
  const [adding, setAdding] = useState(false)
  const action = intake.data ? (
    <button type="button" className="btn btn--sm" onClick={() => setAdding(true)}>
      {tx(I.addChild)}
    </button>
  ) : undefined
  return (
    <Section id="pf-children" title={`${tx(P.children)} (${profile.childrenCount})`} action={action}>
      {adding && intake.data && (
        <IntakeDialog options={intake.data} initial={{ kind: 'add', familyId: profile.family.id, familyName: profile.name }} onClose={() => setAdding(false)} />
      )}
      {profile.children.length === 0 ? (
        <p className="tf-muted">{tx(P.noChildren)}</p>
      ) : (
        <ul className="pf-people">
          {profile.children.map((c) => (
            <li key={c.id} className="pf-person">
              <Avatar name={c.name} seed={c.id} src={c.avatarUrl} size="sm" />
              <span dir="auto">{c.name}</span>
              <Link className="btn btn--sm btn--ghost" to={studentPath(c.id)} aria-label={`${tx(P.viewProfile)}: ${c.name}`}>
                {tx(P.viewProfile)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function PaymentsSection({ billing, onOpen }: { billing: FamilyBilling; onOpen: (d: Dialogs) => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const missing = <span className="tf-muted">{tx(P.notRecorded)}</span>
  return (
    <>
      <Section
        id="pf-payments"
        title={tx(P.payments)}
        hint={tx(P.paymentsHint)}
        action={
          billing.canRecord && (
            <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'billing' })} aria-label={tx(P.editPayments)}>
              {tx(P.edit)}
            </button>
          )
        }
      >
        <dl className="tf-kv">
          <dt>{tx(P.subscription)}</dt>
          <dd>{billing.planMonths ? planLabel(billing.planMonths, locale) : <span className="tf-muted">{tx(P.noPlan)}</span>}</dd>
          <dt>{tx(P.method)}</dt>
          <dd>{billing.paymentMethod ? tx(METHOD_LABEL[billing.paymentMethod]) : missing}</dd>
          <dt>{tx(P.currency)}</dt>
          <dd>{billing.currency ?? missing}</dd>
          {billing.totals.map((t) => (
            <TotalsRows key={t.currency} totals={t} locale={locale} />
          ))}
        </dl>
      </Section>
      <Section
        id="pf-timeline"
        title={tx(P.timeline)}
        hint={tx(P.timelineHint)}
        action={
          billing.canRecord && (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => onOpen({ kind: 'new' })}>
              {tx(P.addInstalments)}
            </button>
          )
        }
      >
        {billing.instalments.length === 0 ? (
          <p className="tf-muted">{tx(P.noInstalments)}</p>
        ) : (
          <ol className="pf-timeline">
            {billing.instalments.map((i) => (
              <TimelineRow key={i.id} item={i} canRecord={billing.canRecord} onOpen={onOpen} />
            ))}
          </ol>
        )}
      </Section>
      <MoneySections billing={billing} onOpen={onOpen} />
    </>
  )
}

/**
 * PD-27: payment requests (each with its own link), the payments that
 * arrived, their invoices, and the receipts the parents uploaded. Every
 * control is the server's answer: `canRecord` creates requests and records
 * cash or bank transfers, voids and decides receipts; `canVerify` refunds.
 */
function MoneySections({ billing, onOpen }: { billing: FamilyBilling; onOpen: (d: Dialogs) => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const { staff } = useSession()
  const paymentsPath = staff && isSuperAdmin(staff.role) ? adminSectionPath('payments') : '/payments'
  const fullyPaid = new Set(billing.instalments.filter((i) => i.status === 'paid').map((i) => i.id))
  const pending = billing.receipts.filter((r) => r.status === 'pending').length
  return (
    <>
      <Section
        id="pf-requests"
        title={tx(PAY.requests)}
        hint={tx(PAY.requestsHint)}
        action={
          billing.canRecord && (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => onOpen({ kind: 'request' })}>
              {tx(PAY.requestPayment)}
            </button>
          )
        }
      >
        <RequestList requests={billing.requests} canCancel={billing.canRecord} onCancel={(request) => onOpen({ kind: 'cancelRequest', request })} />
      </Section>
      <Section
        id="pf-received"
        title={tx(PAY.received)}
        hint={tx(PAY.receivedHint)}
        action={
          billing.canRecord && (
            <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'cash' })}>
              {tx(PAY.recordReceived)}
            </button>
          )
        }
      >
        <PaymentList
          payments={billing.payments}
          canVoid={billing.canRecord}
          canRefund={billing.canVerify}
          // A payment whose instalment is fully paid is corrected by voiding the instalment.
          voidable={(p) => !(p.instalmentId && fullyPaid.has(p.instalmentId))}
          onVoid={(payment) => onOpen({ kind: 'voidPayment', payment })}
          onRefund={(payment) => onOpen({ kind: 'refund', payment })}
        />
      </Section>
      <Section id="pf-invoices" title={tx(PAY.invoices)} hint={tx(PAY.invoicesHint)}>
        {billing.invoices.length === 0 ? (
          <p className="tf-muted">{tx(PAY.noInvoices)}</p>
        ) : (
          <ol className="pf-timeline">
            {billing.invoices.map((inv) => (
              <li key={inv.id} className={inv.status === 'void' ? 'pf-entry pf-entry--voided' : 'pf-entry'}>
                <div className="pf-entry__head">
                  <InvoiceStatusBadge status={inv.status} />
                  <strong>
                    <bdi dir="ltr">{inv.number}</bdi>
                  </strong>
                  <span dir="auto">{inv.label}</span>
                  <span className="pf-amount">{formatMoney(inv.amountMinor, inv.currency, locale)}</span>
                </div>
                <div className="pf-entry__meta">
                  <span>{tx(PAY.issued, { date: dateTime(inv.issuedAt) })}</span>
                  <span>{tx(METHOD[inv.method])}</span>
                  {inv.child && <span dir="auto">{inv.child.name}</span>}
                  {inv.refundedMinor > 0 && <span>{tx(PAY.refunded, { amount: formatMoney(inv.refundedMinor, inv.currency, locale) })}</span>}
                </div>
                <div className="tf-actions">
                  <InvoiceDownloadButton invoiceId={inv.id} number={inv.number} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section
        id="pf-receipts"
        title={tx(PAY.familyReceipts)}
        hint={tx(PAY.familyReceiptsHint)}
        action={
          billing.canRecord &&
          pending > 0 && (
            <Link className="btn btn--sm" to={paymentsPath}>
              {tx(PAY.reviewInPayments)}
            </Link>
          )
        }
      >
        {billing.receipts.length === 0 ? (
          <p className="tf-muted">{tx(PAY.noFamilyReceipts)}</p>
        ) : (
          <ol className="pf-timeline">
            {billing.receipts.map((r) => (
              <li key={r.id} className="pf-entry">
                <div className="pf-entry__head">
                  <ReceiptStatusBadge status={r.status} />
                  <strong dir="auto">{r.label}</strong>
                  <span className="pf-amount">{formatMoney(r.amountMinor, r.currency, locale)}</span>
                </div>
                <div className="pf-entry__meta">
                  <span>
                    {tx(PAY.transferredOn)}: {formatDay(r.transferredOn, locale)}
                  </span>
                  <span>
                    {tx(PAY.uploadedAt)}: {dateTime(r.uploadedAt)}
                  </span>
                  {r.uploadedBy && <span dir="auto">{tx(PAY.uploadedBy, { name: r.uploadedBy.name })}</span>}
                </div>
                {r.note && (
                  <p className="pf-entry__meta" dir="auto">
                    {r.note}
                  </p>
                )}
                {r.rejectReason && (
                  <p className="pf-entry__meta" dir="auto">
                    {tx(PAY.rejectedBecause, { reason: r.rejectReason })}
                  </p>
                )}
                <ReceiptFile fileUrl={r.fileUrl} mimeType={r.mimeType} label={r.label} />
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  )
}

function TotalsRows({ totals, locale }: { totals: FamilyBilling['totals'][number]; locale: 'ar' | 'en' }) {
  const tx = useCopy()
  return (
    <>
      <dt>
        {tx(P.paid)} · {totals.currency}
      </dt>
      <dd>{formatMoney(totals.paidMinor, totals.currency, locale)}</dd>
      <dt>
        {tx(P.outstanding)} · {totals.currency}
      </dt>
      <dd>
        {formatMoney(totals.outstandingMinor, totals.currency, locale)}
        {totals.overdueMinor > 0 && (
          <span className="pf-overdue">
            {' '}
            ({tx(P.overdue)} {formatMoney(totals.overdueMinor, totals.currency, locale)})
          </span>
        )}
      </dd>
    </>
  )
}

function TimelineRow({ item, canRecord, onOpen }: { item: TimelineInstalment; canRecord: boolean; onOpen: (d: Dialogs) => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const open = item.status !== 'paid' && item.status !== 'voided'
  return (
    <li className={item.status === 'voided' ? 'pf-entry pf-entry--voided' : 'pf-entry'}>
      <div className="pf-entry__head">
        <Badge tone={STATUS_TONE[item.status]} dot>
          {tx(TIMELINE_STATUS[item.status])}
        </Badge>
        <strong dir="auto">{item.label}</strong>
        <span className="pf-amount">{formatMoney(item.amountMinor, item.currency, locale)}</span>
        {open && item.partial && <Badge tone="warn">{tx(PAY.partiallyPaid)}</Badge>}
      </div>
      {open && item.partial && (
        <p className="pf-entry__meta pf-amount">
          {tx(PAY.paidRemaining, {
            paid: formatMoney(item.paidMinor, item.currency, locale),
            remaining: formatMoney(item.remainingMinor, item.currency, locale),
          })}
        </p>
      )}
      <div className="pf-entry__meta">
        <span>{tx(P.dueOn, { date: formatDay(item.dueDate, locale) })}</span>
        <span dir="auto">{item.child ? tx(P.forChild, { name: item.child.name }) : tx(P.forFamily)}</span>
      </div>
      {item.payment && (
        <p className="pf-entry__meta">
          {item.payment.recordedBy
            ? tx(P.paidOnBy, {
                date: formatDay(item.payment.paidOn, locale),
                method: tx(METHOD[item.payment.method]),
                name: item.payment.recordedBy.name,
              })
            : tx(P.paidOnByStripe, { date: formatDay(item.payment.paidOn, locale), method: tx(METHOD[item.payment.method]) })}
          {item.payment.reference && (
            <>
              {' · '}
              {tx(P.reference)}: <bdi dir="ltr">{item.payment.reference}</bdi>
            </>
          )}
        </p>
      )}
      {item.void && (
        <p className="pf-entry__meta" dir="auto">
          {tx(P.voidedBy, { name: item.void.by.name, reason: item.void.reason })}
        </p>
      )}
      {canRecord && item.status !== 'voided' && (
        <div className="tf-actions">
          {open && (
            <button type="button" className="btn btn--sm btn--primary" onClick={() => onOpen({ kind: 'pay', instalment: item })}>
              {tx(P.recordPayment)}
            </button>
          )}
          {open && (
            <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'link', instalment: item })}>
              {tx(PAY.paymentLink)}
            </button>
          )}
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => onOpen({ kind: 'void', instalment: item })}>
            {tx(P.void)}
          </button>
        </div>
      )}
    </li>
  )
}

/** A parent's name as a link to their profile. */
export function ParentLink({ id, name }: { id: string; name: string }) {
  return (
    <Link to={parentPath(id)} dir="auto">
      {name}
    </Link>
  )
}
