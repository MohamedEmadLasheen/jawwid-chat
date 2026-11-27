import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { canOpenArea, isSuperAdmin } from '@/core/permissions/capabilities'
import { adminSectionPath } from '@/features/admin/sections'
import { Avatar } from '@/shared/components/Avatar'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { preparePhoto, type PreparedPhoto } from '@/features/profile/photo'
import { formatDay, formatMoney } from '@/features/instalments/copy'
import type { Payment, PaymentRequest } from '@/features/payments/api'
import { METHOD, PAY } from '@/features/payments/copy'
import { InvoiceDownloadButton, InvoiceStatusBadge, PaymentList, ReceiptFile, ReceiptStatusBadge, RequestList } from '@/features/payments/PaymentParts'
import { chatApi, chatKeys, type ChatConversation } from '@/features/chat/chatApi'
import { useCallActions } from '@/features/calls-page/hooks'
import { useSubscription } from '@/features/subscriptions/hooks'
import { STATE_LABEL } from '@/features/subscriptions/copy'
import type { AccessState } from '@/features/subscriptions/api'
import { parentPath, studentPath, type FamilyBilling, type ParentProfile, type TimelineInstalment, type TimelineStatus } from './api'
import { useCountries } from '@/shared/location/api'
import { zoneCity } from '@/core/time/academyTime'
import { METHOD_LABEL, P, TIMELINE_STATUS, describeError, isProfileRefusal, moneyParts, planLabel, useCopy, type Pair } from './copy'
import { useFamilyBilling, useParent, useParentPhoto } from './hooks'
import { FamilyFeedbackSection } from './FamilyFeedbackSection'
import { IntakeDialog } from '@/features/intake/IntakeDialog'
import { I } from '@/features/intake/copy'
import { useFamilyOwnership, useIntakeOptions } from '@/features/intake/hooks'
import { OwnershipSection } from '@/features/intake/OwnershipSection'
import { FamilyHistorySection } from '@/features/intake/FamilyHistorySection'
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
import './profiles.css'

const STATUS_TONE: Record<TimelineStatus, Tone> = { overdue: 'danger', due: 'warn', upcoming: 'info', paid: 'ok', voided: 'outline' }
const ACCESS_TONE: Record<AccessState, Tone> = { open: 'ok', grace: 'warn', locked: 'danger' }

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
 *
 * Laid out as one open file: who it is, a ruled strip of contact facts, a bar
 * that stays in view (the file's index and its actions), then the file itself
 * with the family's money in its usual order, and a margin for what is about
 * the family rather than its money.
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
    <div className="page pp">
      <div className="page__inner">
        <p className="pp-back">
          <Link to={backTo}>{tx(P.back)}</Link>
        </p>
        {isProfileRefusal(profile.error) ? (
          <EmptyState icon="lock" title={describeError(profile.error, locale)} />
        ) : (
          <QueryBoundary isLoading={profile.isLoading} error={profile.error} onRetry={() => void profile.refetch()}>
            {data && (
              <>
                <ParentHead profile={data} eyebrow={eyebrow ?? tx(P.parent)} onEdit={() => setDialog({ kind: 'contact' })} />
                <ContactStrip profile={data} />
                <FileBar profile={data} billing={billing.data} onRecord={() => setDialog({ kind: 'cash' })} />
                <div className="pp-cols">
                  <div className="pp-main">
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
                  </div>
                  <aside className="pp-side">
                    <NoteSection profile={data} onEdit={() => setDialog({ kind: 'note' })} />
                    {/* PD-42 PR-3: sign-in e-mail, Operations supervisor, Sales owner -- when the server answers for this viewer. */}
                    <OwnershipSection familyId={data.family.id} parentName={data.name} />
                    {/* PD-42 S4: who entered the family, owns it, placed it; its packages. */}
                    <div className="pp-activity">
                      <FamilyHistorySection familyId={data.family.id} />
                    </div>
                  </aside>
                </div>
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

function Section({
  id,
  title,
  count,
  action,
  hint,
  children,
}: {
  id: string
  title: string
  count?: ReactNode
  action?: ReactNode
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="pp-sec" aria-labelledby={id} data-file-section={id}>
      <div className="pp-sec__head">
        <h2 id={id} className="pp-sec__title">
          {title}
          {count !== undefined && <span className="pp-count">{count}</span>}
        </h2>
        {action}
      </div>
      {hint && <p className="pp-rule">{hint}</p>}
      {children}
    </section>
  )
}

/**
 * Who this is: the photo or monogram, the name every chat shows, the family,
 * and that the file is the administration's. Choosing a photo is choose ->
 * preview -> use, or remove; the current photo stays until the new one is committed.
 */
function ParentHead({ profile, eyebrow, onEdit }: { profile: ParentProfile; eyebrow: string; onEdit: () => void }) {
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
  const canEdit = profile.access.canEdit

  return (
    <header className="pp-head">
      <div className="pp-head__mark">
        {prepared ? (
          <img className="pf-photo__img" src={prepared.previewUrl} alt={tx(P.photoPreview)} />
        ) : (
          <Avatar name={profile.name} seed={profile.id} src={profile.avatarUrl} size="lg" />
        )}
      </div>
      <div className="pp-head__text">
        <p className="pp-head__eyebrow">{eyebrow}</p>
        <h1 className="pp-head__name">
          <bdi>{profile.name}</bdi>
        </h1>
        <p className="pp-head__meta">
          <span dir="auto">{profile.family.name}</span>
          <Badge tone="info">{tx(P.adminOnly)}</Badge>
          {!profile.isActive && <Badge tone="outline">{tx(P.inactive)}</Badge>}
        </p>
      </div>
      {canEdit && (
        <div className="pp-head__actions pp-head__actions--stack">
          <div className="pp-head__buttons">
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
                <label htmlFor={inputId} className="btn btn--sm btn--ghost sp-file-label">
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
                <button type="button" className="btn btn--sm" onClick={onEdit} aria-label={tx(P.editContact)}>
                  {tx(P.edit)}
                </button>
              </>
            )}
          </div>
          <span id={`${inputId}-hint`} className="pp-head__hint">
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
      )}
    </header>
  )
}

/** Phone, email, where they are and how many children: one ruled strip under the name. */
function ContactStrip({ profile }: { profile: ParentProfile }) {
  const tx = useCopy()
  const { locale, dateTime, date } = useI18n()
  const c = profile.contact
  const missing = <span className="tf-muted">{tx(P.notRecorded)}</span>
  const pick = (n: { en: string; ar: string }) => (locale === 'ar' ? n.ar : n.en)
  // A country with no subdivisions has no such row; while the list loads, assume it has them.
  const countries = useCountries()
  const showSubdivision = !!c.location?.subdivision || countries.data?.countries.find((x) => x.code === c.countryCode)?.hasSubdivisions !== false
  // PD-45 §7, read-only: the clock the country implies where the app gave none, or a hint when they differ.
  const zone = profile.timeZone
  const clock =
    zone.app === null && zone.estimate
      ? tx(P.zoneEstimate, { city: zoneCity(zone.estimate, locale) })
      : zone.mismatch && zone.app && c.location
        ? tx(P.zoneHint, { country: pick(c.location.country), city: zoneCity(zone.app, locale) })
        : null
  const setByParent = c.locationSource === 'parent' && c.locationUpdatedAt ? c.locationUpdatedAt : null
  return (
    <section className="pp-contact" aria-labelledby="pf-contact">
      <h2 id="pf-contact" className="sr-only">
        {tx(P.contactInfo)}
      </h2>
      <div className="pp-strip-wrap">
        <dl className="pp-strip">
          <div>
            <dt>{tx(P.phone)}</dt>
            {/* The value is LTR; the cell keeps the page direction, so it sits under its label. */}
            <dd>{c.phone ? <bdi dir="ltr">{c.phone}</bdi> : missing}</dd>
          </div>
          <div>
            <dt>{tx(P.email)}</dt>
            <dd>{c.email ? <bdi dir="ltr">{c.email}</bdi> : missing}</dd>
          </div>
          <div>
            <dt>{tx(P.country)}</dt>
            <dd>{c.location ? <bdi>{pick(c.location.country)}</bdi> : missing}</dd>
          </div>
          {c.location && showSubdivision && (
            <div>
              <dt>{pick(c.location.label)}</dt>
              <dd>{c.location.subdivision ? <bdi>{pick(c.location.subdivision)}</bdi> : missing}</dd>
            </div>
          )}
          {/* PD-45 §3.4: the old free text, until a subdivision is set. */}
          {c.region && !c.subdivisionCode && (
            <div>
              <dt>{tx(P.oldNote)}</dt>
              <dd>
                <bdi>{c.region}</bdi>
              </dd>
            </div>
          )}
          {clock && (
            <div>
              <dt>{tx(P.timeZone)}</dt>
              <dd className="tf-muted">{clock}</dd>
            </div>
          )}
          <div>
            <dt>{tx(P.childrenCount)}</dt>
            <dd>{profile.childrenCount}</dd>
          </div>
        </dl>
      </div>
      {(setByParent || profile.updatedAt) && (
        <p className="pp-contact__by">
          {setByParent && <span>{tx(P.setByParent, { date: date(setByParent) })}</span>}
          {profile.updatedAt && <span>{tx(P.lastEdit, { date: dateTime(profile.updatedAt) })}</span>}
        </p>
      )}
    </section>
  )
}

/** The direct chat with this parent, among the conversations the viewer already has. */
function directChat(list: ChatConversation[] | undefined, contactId: string, familyId: string): ChatConversation | null {
  const direct = (list ?? []).filter((c) => c.type === 'direct' && !c.archivedAt)
  return (
    direct.find((c) => c.members?.some((m) => m.actorKind === 'contact' && m.actorId === contactId)) ??
    direct.find((c) => c.familyId === familyId && !c.members) ??
    null
  )
}

function jumpTo(id: string) {
  const el = document.querySelector(`[data-file-section="${id}"]`)
  const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el?.scrollIntoView?.({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
}

/**
 * The bar that stays in view: where each part of the file is, and the three
 * things staff do from here. Chat and Call open the viewer's own direct chat
 * with this parent, when there is one; Record payment is the family's
 * "Record a payment" and appears on the server's `canRecord`.
 */
function FileBar({ profile, billing, onRecord }: { profile: ParentProfile; billing: FamilyBilling | undefined; onRecord: () => void }) {
  const tx = useCopy()
  const { number } = useI18n()
  const { staff } = useSession()
  const mayChat = !!staff && !isSuperAdmin(staff.role) && canOpenArea(staff.role, 'chat')
  const chats = useQuery({ queryKey: chatKeys.list, queryFn: chatApi.list, enabled: mayChat, staleTime: 30_000, retry: false })
  const conversation = mayChat ? directChat(chats.data, profile.id, profile.family.id) : null

  const open = billing?.instalments.filter((i) => i.status !== 'paid' && i.status !== 'voided') ?? []
  const late = open.some((i) => i.status === 'overdue')
  const openRequests = billing?.requests.filter((r) => r.status === 'open').length ?? 0
  const pendingReceipts = billing?.receipts.filter((r) => r.status === 'pending').length ?? 0
  const index: Array<{ id: string; label: Pair; count?: number; late?: boolean }> = [{ id: 'pf-children', label: P.ixChildren }]
  if (billing) {
    index.push(
      { id: 'pf-payments', label: P.ixPackage },
      { id: 'pf-timeline', label: P.ixInstalments, count: open.length, late },
      { id: 'pf-requests', label: P.ixRequests, count: openRequests },
      { id: 'pf-received', label: P.ixReceived },
      { id: 'pf-invoices', label: P.ixInvoices },
      { id: 'pf-receipts', label: P.ixReceipts, count: pendingReceipts },
    )
  }

  return (
    <div className="pp-bar">
      <nav className="pp-bar__index" aria-label={tx(P.fileIndex)}>
        {index.map((x) => (
          <button key={x.id} type="button" className={x.late ? 'pp-bar__jump pp-bar__jump--late' : 'pp-bar__jump'} onClick={() => jumpTo(x.id)}>
            {tx(x.label)}
            {x.count ? <span className="pp-count">{number(x.count)}</span> : null}
          </button>
        ))}
      </nav>
      {(conversation || billing?.canRecord) && (
        <div className="pp-bar__actions">
          {conversation && <ChatAndCall conversation={conversation} />}
          {billing?.canRecord && (
            <button type="button" className="btn btn--primary btn--sm" onClick={onRecord}>
              {tx(PAY.recordReceived)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ChatAndCall({ conversation }: { conversation: ChatConversation }) {
  const tx = useCopy()
  const calls = useCallActions()
  return (
    <>
      <Link className="btn btn--sm" to={`/chat/${encodeURIComponent(conversation.id)}`}>
        <Icon name="conversations" size={16} />
        {tx(P.chat)}
      </Link>
      {calls.available && (
        <button type="button" className="btn btn--sm" disabled={calls.busy} onClick={() => void calls.startCall(conversation)}>
          <Icon name="phone" size={16} />
          {tx(P.call)}
        </button>
      )}
    </>
  )
}

function NoteSection({ profile, onEdit }: { profile: ParentProfile; onEdit: () => void }) {
  const tx = useCopy()
  return (
    <section className="pp-sec pp-note" aria-labelledby="pf-note">
      <div className="pp-sec__head">
        <h2 id="pf-note" className="pp-sec__title">
          <Icon name="lockNote" size={15} />
          {tx(P.about)}
        </h2>
        {profile.access.canEdit && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onEdit} aria-label={tx(P.editNote)}>
            {tx(P.edit)}
          </button>
        )}
      </div>
      {profile.adminNote ? (
        <p className="pf-note" dir="auto">
          {profile.adminNote}
        </p>
      ) : (
        <p className="pp-empty">{tx(P.noNote)}</p>
      )}
      <p className="pp-rule">{tx(P.aboutHint)}</p>
    </section>
  )
}

function ChildrenSection({ profile }: { profile: ParentProfile }) {
  const tx = useCopy()
  // PD-42: "Add child", when the server says this viewer enters families AND may add
  // to THIS one (ADMIN-009: a Sales member was offered it on a family they did not
  // enter; the family's own answer, can.addChild, is refused for those).
  const intake = useIntakeOptions()
  const ownership = useFamilyOwnership(profile.family.id)
  const [adding, setAdding] = useState(false)
  const action = intake.data?.ready && ownership.data?.can.addChild === true ? (
    <button type="button" className="btn btn--sm" onClick={() => setAdding(true)}>
      {tx(I.addChild)}
    </button>
  ) : undefined
  return (
    <Section id="pf-children" title={tx(P.children)} count={profile.childrenCount} action={action}>
      {adding && intake.data && (
        <IntakeDialog options={intake.data} initial={{ kind: 'add', familyId: profile.family.id, familyName: profile.name }} onClose={() => setAdding(false)} />
      )}
      {profile.children.length === 0 ? (
        <p className="pp-empty">{tx(P.noChildren)}</p>
      ) : (
        <ul className="pp-rows">
          {profile.children.map((c) => (
            <li key={c.id} className="pp-row pp-child">
              <Avatar name={c.name} seed={c.id} src={c.avatarUrl} size="sm" />
              <Link className="pp-row__name" to={studentPath(c.id)} aria-label={`${tx(P.viewProfile)}: ${c.name}`} dir="auto">
                {c.name}
              </Link>
              <ChildStanding learnerId={c.id} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/**
 * A child's lessons as one thin line: used out of bought, and whether the
 * subscription is open, in grace or locked. Read from the child's own
 * subscription (PD-30); where the server does not answer for this viewer,
 * nothing is drawn.
 */
function ChildStanding({ learnerId }: { learnerId: string }) {
  const tx = useCopy()
  const { number } = useI18n()
  const view = useSubscription(learnerId)
  const s = view.data?.standing
  if (!s) return null
  const total = s.lessonsIncluded
  const used = s.lessonsUsed
  const share = total && used !== null ? Math.min(100, Math.round((used / total) * 100)) : null
  return (
    <span className="pp-row__end pp-child__standing">
      {total !== null && used !== null && (
        <span className="pp-child__lessons">
          <span className="pp-child__count">
            <span>{tx(P.lessonsUsed, { used: number(used), total: number(total) })}</span>
            {s.lessonsLeft !== null && <span className="pp-row__sub">{tx(P.lessonsLeft, { n: number(s.lessonsLeft) })}</span>}
          </span>
          {share !== null && (
            <span className={s.state === 'locked' ? 'pp-meter pp-meter--late' : s.state === 'grace' ? 'pp-meter pp-meter--warn' : 'pp-meter'} aria-hidden="true">
              <span style={{ inlineSize: `${share}%` }} />
            </span>
          )}
        </span>
      )}
      <Badge tone={ACCESS_TONE[s.state]} dot>
        {tx(STATE_LABEL[s.state])}
      </Badge>
    </span>
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
        action={
          billing.canRecord && (
            <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'billing' })} aria-label={tx(P.editPayments)}>
              {tx(P.edit)}
            </button>
          )
        }
      >
        {billing.totals.map((t) => (
          <TotalsLedger key={t.currency} totals={t} locale={locale} />
        ))}
        <dl className="pp-terms">
          <div>
            <dt>{tx(P.subscription)}</dt>
            <dd>{billing.planMonths ? planLabel(billing.planMonths, locale) : <span className="tf-muted">{tx(P.noPlan)}</span>}</dd>
          </div>
          <div>
            <dt>{tx(P.method)}</dt>
            <dd>{billing.paymentMethod ? tx(METHOD_LABEL[billing.paymentMethod]) : missing}</dd>
          </div>
          <div>
            <dt>{tx(P.currency)}</dt>
            <dd>{billing.currency ?? missing}</dd>
          </div>
        </dl>
        <p className="pp-rule">{tx(P.paymentsHint)}</p>
      </Section>
      <Section
        id="pf-timeline"
        title={tx(P.timeline)}
        hint={tx(P.timelineHint)}
        action={
          billing.canRecord && (
            <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'new' })}>
              {tx(P.addInstalments)}
            </button>
          )
        }
      >
        {billing.instalments.length === 0 ? (
          <p className="pp-empty">{tx(P.noInstalments)}</p>
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
 * "Record a payment" is on the bar above, where it stays in view.
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
            <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'request' })}>
              {tx(PAY.requestPayment)}
            </button>
          )
        }
      >
        <RequestList requests={billing.requests} canCancel={billing.canRecord} onCancel={(request) => onOpen({ kind: 'cancelRequest', request })} />
      </Section>
      <Section id="pf-received" title={tx(PAY.received)} hint={tx(PAY.receivedHint)}>
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
          <p className="pp-empty">{tx(PAY.noInvoices)}</p>
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
          <p className="pp-empty">{tx(PAY.noFamilyReceipts)}</p>
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

/** One currency's money as a ruled ledger: paid, still to pay, and what of that is late. */
function TotalsLedger({ totals, locale }: { totals: FamilyBilling['totals'][number]; locale: 'ar' | 'en' }) {
  const tx = useCopy()
  const cells: Array<{ key: string; label: string; minor: number; late?: boolean }> = [
    { key: 'paid', label: tx(P.paid), minor: totals.paidMinor },
    { key: 'outstanding', label: tx(P.outstanding), minor: totals.outstandingMinor },
  ]
  if (totals.overdueMinor > 0) cells.push({ key: 'overdue', label: tx(P.overdueShort), minor: totals.overdueMinor, late: true })
  return (
    <div className="ledger pp-money">
      {cells.map((c) => {
        const m = moneyParts(c.minor, totals.currency, locale)
        return (
          <div key={c.key} className={c.late ? 'ledger__cell ledger__cell--late' : 'ledger__cell'}>
            <span className="ledger__label">{c.label}</span>
            <span className="ledger__value">
              {m.amount}
              <span className="ledger__unit">{m.unit}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function TimelineRow({ item, canRecord, onOpen }: { item: TimelineInstalment; canRecord: boolean; onOpen: (d: Dialogs) => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const open = item.status !== 'paid' && item.status !== 'voided'
  return (
    <li className={item.status === 'voided' ? 'pf-entry pf-entry--voided' : item.status === 'overdue' ? 'pf-entry pf-entry--late' : 'pf-entry'}>
      <div className="pf-entry__head">
        <Badge tone={STATUS_TONE[item.status]} dot>
          {tx(TIMELINE_STATUS[item.status])}
        </Badge>
        <strong dir="auto">{item.label}</strong>
        <span className="pf-amount">{formatMoney(item.amountMinor, item.currency, locale)}</span>
        {open && item.partial && <Badge tone="warn">{tx(PAY.partiallyPaid)}</Badge>}
        {open && item.payableInApp === false && <Badge tone="neutral">{tx(PAY.notPayableInApp)}</Badge>}
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
            <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'pay', instalment: item })}>
              {tx(P.recordPayment)}
            </button>
          )}
          {open && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => onOpen({ kind: 'link', instalment: item })}>
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
