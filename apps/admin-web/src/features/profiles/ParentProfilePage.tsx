import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ApiError } from '@/core/api/errors'
import { canOpenArea, isSuperAdmin } from '@/core/permissions/capabilities'
import { adminSectionPath } from '@/features/admin/sections'
import { Avatar } from '@/shared/components/Avatar'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { Menu, type MenuItem } from '@/shared/components/Menu'
import { PageHeader } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { preparePhoto, type PreparedPhoto } from '@/features/profile/photo'
import { INSTALMENTS, countWords, formatMoney, inDaysWords, lateWords } from '@/features/instalments/copy'
import type { Payment, PaymentRequest } from '@/features/payments/api'
import { METHOD, PAY, RECEIPT_STATUS, owed } from '@/features/payments/copy'
import { InvoiceDownloadButton, InvoiceStatusBadge, PaymentList, ReceiptFile, ReceiptStatusBadge, RequestList } from '@/features/payments/PaymentParts'
import { chatApi, chatKeys, type ChatConversation } from '@/features/chat/chatApi'
import { useCallActions } from '@/features/calls-page/hooks'
import { STATE_LABEL, lessonsLabel } from '@/features/subscriptions/copy'
import { subscriptionKeys, subscriptionsApi, type AccessState, type Standing } from '@/features/subscriptions/api'
import { useFamilyFeedback } from '@/features/teacher-supervision/hooks'
import { parentPath, studentPath, type FamilyBilling, type ParentProfile, type TimelineInstalment, type TimelineStatus } from './api'
import { useCountries } from '@/shared/location/api'
import { zoneCity } from '@/core/time/academyTime'
import { METHOD_LABEL, P, TIMELINE_STATUS, describeError, isProfileRefusal, moneyParts, planLabel, useCopy } from './copy'
import { useFamilyBilling, useParent, useParentPhoto } from './hooks'
import { FamilyFeedbackSection } from './FamilyFeedbackSection'
import { Amount, AttentionRow, Calm, Fact, Sheet, longDay, plainLabel } from './RecordParts'
import { RecordHead, fill, useWalk, type Callout, type Highlight } from './RecordHead'
import './record.css'
import { RecordPanel, RecordTabs, useRecordTab, type RecordTab } from './RecordTabs'
import { IntakeDialog } from '@/features/intake/IntakeDialog'
import { I } from '@/features/intake/copy'
import { useFamilyHistory, useFamilyOwnership, useIntakeOptions } from '@/features/intake/hooks'
import type { FamilyOwnership } from '@/features/intake/api'
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

const STATUS_TONE: Record<TimelineStatus, Tone> = { overdue: 'danger', due: 'warn', upcoming: 'outline', paid: 'ok', voided: 'outline' }
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

type TabKey = 'overview' | 'money' | 'children' | 'history'

/** Which tab a link's hash opens: `#instalments` is on Money, `#feedback` on History. */
const SECTION_TAB: Record<string, TabKey> = {
  attention: 'overview',
  contact: 'overview',
  ownership: 'overview',
  note: 'overview',
  payments: 'money',
  instalments: 'money',
  requests: 'money',
  received: 'money',
  invoices: 'money',
  receipts: 'money',
  feedback: 'history',
}

/**
 * PD-17: the Parent Profile, administration only. Contact information (with
 * the photo and the name every chat shows), the internal note, the children,
 * and the family's payments. The server decides who may open it -- the
 * Operations department in scope, the Operations Manager, the super admin --
 * and refuses a teacher on every route; this page only shows its answer.
 *
 * Laid out as a record: a masthead (who it is, where the family's money
 * stands, the one thing staff do here most), and four tabs. Overview is what
 * waits now beside who the family is; Money is the family's ledgers; Children
 * and History are their own short pages. The open tab is in the URL.
 */
export function ParentProfilePage() {
  const { contactId = '' } = useParams<{ contactId: string }>()
  const { staff } = useSession()
  const tx = useCopy()
  const { locale } = useI18n()
  const profile = useParent(contactId)
  // One URL per parent; back goes to the list this viewer has (the super admin's is a section).
  const back = { to: staff && isSuperAdmin(staff.role) ? adminSectionPath('parents') : '/parents', label: tx(P.parentsTitle) }

  return (
    <div className="page pp rec">
      <div className="page__inner">
        {profile.data ? (
          <ParentFile profile={profile.data} back={back} />
        ) : (
          <>
            <PageHeader back={back} title={tx(P.parent)} />
            {isProfileRefusal(profile.error) ? (
              <EmptyState icon="lock" title={describeError(profile.error, locale)} />
            ) : (
              <QueryBoundary isLoading={profile.isLoading} error={profile.error} onRetry={() => void profile.refetch()}>
                {null}
              </QueryBoundary>
            )}
          </>
        )}
      </div>
    </div>
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

function ParentFile({ profile, back }: { profile: ParentProfile; back: { to: string; label: string } }) {
  const tx = useCopy()
  const { locale, number } = useI18n()
  const { staff } = useSession()
  const familyId = profile.family.id
  const billingQuery = useFamilyBilling(familyId)
  const billing = billingQuery.data
  const [dialog, setDialog] = useState<Dialogs | null>(null)
  const close = () => setDialog(null)

  // Chat and Call open the viewer's own direct chat with this parent, when there is one.
  const mayChat = !!staff && !isSuperAdmin(staff.role) && canOpenArea(staff.role, 'chat')
  const chats = useQuery({ queryKey: chatKeys.list, queryFn: chatApi.list, enabled: mayChat, staleTime: 30_000, retry: false })
  const conversation = mayChat ? directChat(chats.data, profile.id, familyId) : null

  // PD-42: "Add child", when the server says this viewer enters families AND may add
  // to THIS one (ADMIN-009: a Sales member was offered it on a family they did not
  // enter; the family's own answer, can.addChild, is refused for those).
  const intake = useIntakeOptions()
  const ownership = useFamilyOwnership(familyId)
  const mayAddChild = intake.data?.ready === true && ownership.data?.can.addChild === true
  const [adding, setAdding] = useState(false)

  // Each child's lessons and lock, read from the child's own subscription (PD-30).
  // Where the server does not answer for this viewer, nothing is drawn.
  const standings = useQueries({
    queries: profile.children.map((c) => ({ queryKey: subscriptionKeys.learner(c.id), queryFn: () => subscriptionsApi.view(c.id), retry: false })),
  }).map((q) => q.data?.standing)
  const states = standings.map((s) => s?.state)
  const access: AccessState | null = states.includes('locked') ? 'locked' : states.includes('grace') ? 'grace' : null

  // History is two reads; the tab is offered when the server answers either for this viewer.
  const history = useFamilyHistory(familyId)
  const feedback = useFamilyFeedback(familyId)
  const feedbackShown = !feedback.isLoading && !(feedback.error instanceof ApiError && (feedback.error.isForbidden || feedback.error.isNotFound))
  const hasHistory = !!history.data || feedbackShown

  const photo = usePhotoDraft(profile)
  const canEdit = profile.access.canEdit

  const late = billing?.instalments.filter((i) => i.status === 'overdue') ?? []

  const tabKeys: TabKey[] = hasHistory ? ['overview', 'money', 'children', 'history'] : ['overview', 'money', 'children']
  const { tab, open: openTab } = useRecordTab<TabKey>(tabKeys, SECTION_TAB, !!billing)
  const tabs: Array<RecordTab<TabKey>> = [
    { key: 'overview', label: tx(P.tabOverview) },
    {
      key: 'money',
      label: tx(P.tabMoney),
      count: late.length > 0 ? <span className="count count--urgent">{number(late.length)}</span> : undefined,
      countLabel: late.length > 0 ? `${tx(TIMELINE_STATUS.overdue)}: ${countWords(late.length, INSTALMENTS, locale)}` : undefined,
    },
    { key: 'children', label: tx(P.children), count: <span className="count count--quiet">{number(profile.childrenCount)}</span> },
    ...(hasHistory ? [{ key: 'history' as const, label: tx(P.tabHistory) }] : []),
  ]

  const highlights = useParentHighlights(profile, billing, chats.data, mayChat, ownership.data)
  const walk = useWalk('parents', profile.id, parentPath)
  const owner = ownership.data
  const line = (
    <>
      {fill(tx(P.lineFamily), { family: <bdi>{profile.family.name}</bdi> })}
      {owner && (owner.supervisor?.name ? fill(tx(P.lineFollowedBy), { name: <strong><bdi>{owner.supervisor.name}</bdi></strong> }) : tx(P.lineNoSupervisor))}
      <span className="rec-lock">
        <Icon name="lock" size={13} />
        {tx(P.adminOnly)}
      </span>
    </>
  )
  const callout = parentCallout({ billing, access, ownership: owner, tx, locale, onOpen: setDialog })

  // Everything else that can be done to the file, in the order it is read; removing comes last.
  const menu = (call: (() => void) | null): MenuItem[] => [
    ...(call ? [{ key: 'call', label: tx(P.call), icon: 'phone' as const, onSelect: call }] : []),
    ...(canEdit ? [{ key: 'contact', label: tx(P.editContact), icon: 'pencil' as const, onSelect: () => setDialog({ kind: 'contact' }) }] : []),
    ...(canEdit ? [{ key: 'note', label: tx(P.editNote), icon: 'lockNote' as const, onSelect: () => setDialog({ kind: 'note' }) }] : []),
    ...(mayAddChild ? [{ key: 'child', label: tx(I.addChild), icon: 'plus' as const, onSelect: () => setAdding(true) }] : []),
    ...(canEdit ? [{ key: 'photo', label: tx(profile.avatarUrl ? P.photoReplace : P.photoChoose), icon: 'imageSquare' as const, onSelect: photo.pick }] : []),
    ...(canEdit && profile.avatarUrl ? [{ key: 'photo-remove', label: tx(P.photoRemove), icon: 'trash' as const, danger: true, onSelect: photo.remove }] : []),
  ]

  return (
    <>
      <RecordHead
        back={back}
        walk={walk}
        lead={
          photo.prepared ? (
            <img className="rec-lead__img" src={photo.prepared.previewUrl} alt={tx(P.photoPreview)} />
          ) : (
            <Avatar name={profile.name} seed={profile.id} src={profile.avatarUrl} size="lg" />
          )
        }
        name={profile.name}
        status={
          <>
            {access ? (
              <Badge tone={ACCESS_TONE[access]}>{tx(access === 'locked' ? P.accessLocked : P.accessGrace)}</Badge>
            ) : (
              profile.isActive && <Badge tone="ok">{tx(P.subscriptionOpen)}</Badge>
            )}
            {!profile.isActive && <Badge tone="outline">{tx(P.inactive)}</Badge>}
          </>
        }
        line={line}
        highlights={highlights}
        callout={callout}
        actions={
          <WithCall conversation={conversation}>
            {(call) => {
              const items = menu(call)
              // With nothing owed, talking to the family is what is done here most; otherwise taking their payment.
              const owes = !!billing && billing.totals.some((t) => t.outstandingMinor > 0)
              const chatLeads = !!conversation && !owes
              return (
                <>
                  {billing?.canRecord && (
                    <button type="button" className={chatLeads ? 'btn' : 'btn btn--primary'} onClick={() => setDialog({ kind: 'cash' })}>
                      {tx(PAY.recordReceived)}
                    </button>
                  )}
                  {conversation && (
                    <Link className={chatLeads ? 'btn btn--primary' : 'btn'} to={`/chat/${encodeURIComponent(conversation.id)}`}>
                      <Icon name="conversations" size={16} />
                      {tx(P.chat)}
                    </Link>
                  )}
                  {items.length > 0 && <Menu label={tx(P.more, { name: profile.name })} items={items} triggerClassName="btn btn--icon" />}
                </>
              )
            }}
          </WithCall>
        }
        tabs={<RecordTabs name="pf" label={tx(P.fileIndex)} tabs={tabs} value={tab} onChange={openTab} />}
      />
      {canEdit && <PhotoBar photo={photo} />}

      <RecordPanel name="pf" tab="overview" value={tab}>
        <div className="split rec-split">
          <div className="rec-main">
            <AttentionSheet billing={billingQuery} onOpen={setDialog} />
            {billing && <ComingUp billing={billing} />}
          </div>
          <aside className="rec-aside">
            <ContactGroup profile={profile} onEdit={() => setDialog({ kind: 'contact' })} />
            {/* PD-42 PR-3: sign-in e-mail, Operations supervisor, Sales owner -- when the server answers for this viewer. */}
            <div className="rec-slot" data-section="ownership">
              <OwnershipSection familyId={familyId} parentName={profile.name} />
            </div>
            <NoteGroup profile={profile} onEdit={() => setDialog({ kind: 'note' })} />
          </aside>
        </div>
      </RecordPanel>

      <RecordPanel name="pf" tab="money" value={tab}>
        {isProfileRefusal(billingQuery.error) ? (
          <Sheet id="pf-payments" section="payments" title={tx(P.payments)}>
            <p className="rec-empty">{describeError(billingQuery.error, locale)}</p>
          </Sheet>
        ) : (
          <QueryBoundary isLoading={billingQuery.isLoading} error={billingQuery.error} onRetry={() => void billingQuery.refetch()} compact>
            {billing && <MoneyTab billing={billing} onOpen={setDialog} />}
          </QueryBoundary>
        )}
      </RecordPanel>

      <RecordPanel name="pf" tab="children" value={tab}>
        <ChildrenSheet profile={profile} standings={standings} onAdd={mayAddChild ? () => setAdding(true) : undefined} />
      </RecordPanel>

      {/* Always in the document, so each read is asked for once; its tab is offered only when there is something to show. */}
      <RecordPanel name="pf" tab="history" value={tab}>
        <div className="rec-history">
          {/* PD-42 S4: who entered the family, owns it, placed it; its packages. */}
          <div className="rec-slot pp-activity" data-section="history">
            <FamilyHistorySection familyId={familyId} />
          </div>
          <div className="rec-slot" data-section="feedback">
            <FamilyFeedbackSection familyId={familyId} />
          </div>
        </div>
      </RecordPanel>

      {adding && intake.data && (
        <IntakeDialog options={intake.data} initial={{ kind: 'add', familyId, familyName: profile.name }} onClose={() => setAdding(false)} />
      )}
      {dialog?.kind === 'contact' && <EditContactDialog profile={profile} onClose={close} />}
      {dialog?.kind === 'note' && <EditNoteDialog profile={profile} onClose={close} />}
      {billing && dialog?.kind === 'billing' && <EditBillingDialog billing={billing} onClose={close} />}
      {billing && dialog?.kind === 'new' && <NewInstalmentsDialog billing={billing} children={profile.children} onClose={close} />}
      {billing && dialog?.kind === 'pay' && <RecordPaymentDialog billing={billing} instalment={dialog.instalment} onClose={close} />}
      {billing && dialog?.kind === 'void' && <VoidInstalmentDialog billing={billing} instalment={dialog.instalment} onClose={close} />}
      {billing && dialog?.kind === 'request' && <RequestPaymentDialog billing={billing} children={profile.children} onClose={close} />}
      {billing && dialog?.kind === 'link' && <InstalmentLinkDialog billing={billing} instalment={dialog.instalment} onClose={close} />}
      {billing && dialog?.kind === 'cancelRequest' && <CancelRequestDialog billing={billing} request={dialog.request} onClose={close} />}
      {billing && dialog?.kind === 'cash' && <RecordFamilyPaymentDialog billing={billing} children={profile.children} onClose={close} />}
      {billing && dialog?.kind === 'voidPayment' && <VoidPaymentDialog billing={billing} payment={dialog.payment} onClose={close} />}
      {billing && dialog?.kind === 'refund' && <RefundPaymentDialog billing={billing} payment={dialog.payment} onClose={close} />}
    </>
  )
}

/** "Call" is offered from the direct chat, where calls are available on this deployment. */
function WithCall({ conversation, children }: { conversation: ChatConversation | null; children: (call: (() => void) | null) => ReactNode }) {
  return conversation ? <CallReady conversation={conversation}>{children}</CallReady> : <>{children(null)}</>
}

function CallReady({ conversation, children }: { conversation: ChatConversation; children: (call: (() => void) | null) => ReactNode }) {
  const calls = useCallActions()
  return <>{children(calls.available && !calls.busy ? () => void calls.startCall(conversation) : null)}</>
}

/* ----------------------------------------------------------- the head */

/**
 * A parent's six highlights: what the family owes, the next instalment, when
 * someone last spoke with them, the children, the payment requests still
 * open, and whether the parent can sign in. Each is drawn only when the
 * server answers it for this viewer; nothing is shown as a nought it did not send.
 */
function useParentHighlights(
  profile: ParentProfile,
  billing: FamilyBilling | undefined,
  chats: ChatConversation[] | undefined,
  mayChat: boolean,
  ownership: FamilyOwnership | undefined,
): Highlight[] {
  const tx = useCopy()
  const { locale, number, duration } = useI18n()
  const out: Highlight[] = []
  const none = (text: string) => <span className="rec-hl__none">{text}</span>
  if (billing) {
    const main = billing.totals.find((t) => t.currency === billing.currency) ?? billing.totals[0]
    if (main) {
      const others = billing.totals.filter((t) => t !== main)
      const anyLate = billing.totals.some((t) => t.overdueMinor > 0)
      const m = moneyParts(main.outstandingMinor, main.currency, locale)
      const notes = [
        main.overdueMinor > 0 ? tx(P.overdueOf, { amount: amountText(main.overdueMinor, main.currency, locale) }) : '',
        ...others.map((t) => amountText(t.outstandingMinor, t.currency, locale)),
      ].filter(Boolean)
      out.push({
        key: 'outstanding',
        icon: 'banknote',
        label: tx(P.outstanding),
        value:
          main.outstandingMinor > 0 || anyLate ? (
            <>
              <bdi dir="ltr">{m.amount}</bdi>
              <span className="rec-hl__unit">{m.unit}</span>
            </>
          ) : (
            none(tx(P.hlNothingDue))
          ),
        // The balance is not the breach; only the overdue part under it is said in red.
        note: notes.length > 0 ? <span className={anyLate ? 'rec-hl__late' : undefined}>{notes.join(locale === 'ar' ? '، ' : ', ')}</span> : undefined,
        to: '#instalments',
      })
    } else {
      out.push({ key: 'outstanding', icon: 'banknote', label: tx(P.outstanding), value: none(tx(P.hlNothingDue)), to: '#instalments' })
    }
    const next = billing.instalments
      .filter((i) => i.status === 'due' || i.status === 'upcoming')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
    const nm = next ? moneyParts(next.remainingMinor, next.currency, locale) : null
    out.push({
      key: 'next',
      icon: 'calendar',
      label: tx(P.hlNextInstalment),
      value: next ? longDay(next.dueDate, locale) : none(tx(P.hlNoneScheduled)),
      note:
        next && nm ? (
          <>
            <bdi dir="ltr">{nm.amount}</bdi> {nm.unit}
            {next.status === 'due' ? `${locale === 'ar' ? '، ' : ', '}${tx(TIMELINE_STATUS.due)}` : next.days > 0 ? `${locale === 'ar' ? '، ' : ', '}${inDaysWords(next.days, locale)}` : ''}
          </>
        ) : undefined,
      tone: next?.status === 'due' ? 'waiting' : undefined,
      to: '#instalments',
    })
  }
  if (mayChat && chats) {
    const mine = chats.filter(
      (c) => !c.archivedAt && (c.familyId === profile.family.id || c.members?.some((x) => x.actorKind === 'contact' && x.actorId === profile.id)),
    )
    const last = mine.map((c) => c.lastActivityAt).filter(Boolean).sort().at(-1)
    out.push({ key: 'contact', icon: 'conversations', label: tx(P.hlLastContact), value: last ? duration(last) : none(tx(P.hlNoChat)), text: true })
  }
  out.push({ key: 'children', icon: 'students', label: tx(P.children), value: number(profile.childrenCount), to: '#children' })
  if (billing) {
    const open = billing.requests.filter((r) => r.status === 'open').length
    out.push({ key: 'requests', icon: 'link', label: tx(P.openRequests), value: number(open), tone: open > 0 ? undefined : 'quiet', to: '#requests' })
  }
  if (ownership) {
    out.push({ key: 'signin', icon: 'userCheck', label: tx(P.hlSignIn), value: ownership.signIn ? tx(P.hlSignedIn) : none(tx(P.hlNoSignIn)), text: true })
  }
  return out
}

/**
 * The one thing on this family that needs a person now, with the one action
 * that answers it: money that is late first, then a locked or closing
 * subscription, then receipts waiting to be checked, then a family nobody in
 * Operations follows. Nothing pressing, no callout.
 */
function parentCallout({
  billing,
  access,
  ownership,
  tx,
  locale,
  onOpen,
}: {
  billing: FamilyBilling | undefined
  access: AccessState | null
  ownership: FamilyOwnership | undefined
  tx: ReturnType<typeof useCopy>
  locale: 'ar' | 'en'
  onOpen: (d: Dialogs) => void
}): Callout | null {
  const late = (billing?.instalments ?? []).filter((i) => i.status === 'overdue').sort((a, b) => b.days - a.days)
  if (billing && late.length > 0) {
    const oldest = late[0]!
    const owed = billing.totals.find((t) => t.overdueMinor > 0 && t.currency === oldest.currency) ?? billing.totals.find((t) => t.overdueMinor > 0)
    const amount = <bdi>{amountText(owed?.overdueMinor ?? oldest.remainingMinor, owed?.currency ?? oldest.currency, locale)}</bdi>
    const what = countWords(late.length, INSTALMENTS, locale)
    return {
      tone: 'urgent',
      title: late.length === 1 ? fill(tx(P.calloutLateOne), { amount }) : fill(tx(P.calloutLate), { amount, what }),
      body: fill(tx(late.length === 1 ? P.calloutOnly : P.calloutOldest), { label: <bdi>{plainLabel(oldest.label, locale)}</bdi>, late: lateWords(oldest.days, locale) }),
      // Recording a payment is the head's action and each row's; what the callout adds is asking the family to pay.
      action: billing.canRecord ? (
        <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'link', instalment: oldest })}>
          <Icon name="link" size={16} />
          {tx(P.sendLink)}
        </button>
      ) : undefined,
    }
  }
  if (access === 'locked' || access === 'grace') {
    return {
      tone: access === 'locked' ? 'urgent' : 'waiting',
      title: tx(access === 'locked' ? P.calloutLocked : P.calloutGrace),
      body: access === 'grace' ? tx(P.calloutGraceBody) : undefined,
      action: billing?.canRecord ? (
        <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'request' })}>
          {tx(P.requestPayment)}
        </button>
      ) : undefined,
    }
  }
  const receipts = (billing?.receipts ?? []).filter((r) => r.status === 'pending').length
  if (receipts > 0) {
    return {
      tone: 'waiting',
      title: receipts === 1 ? tx(P.calloutReceipts) : tx(P.calloutReceiptsMany, { n: receipts }),
      action: (
        <Link className="btn btn--sm" to="#receipts">
          {tx(P.view)}
        </Link>
      ),
    }
  }
  if (ownership?.needsOperationsSupervisor && !ownership.supervisor) {
    return {
      tone: 'waiting',
      title: tx(P.calloutNoSupervisor),
      action: ownership.can.assignOperationsSupervisor ? (
        <Link className="btn btn--sm" to="#ownership">
          {tx(P.assignSupervisor)}
        </Link>
      ) : undefined,
    }
  }
  return null
}

/** An amount as every line of a record writes it: the figure, then its currency. */
function amountText(minor: number, currency: string, locale: 'ar' | 'en'): string {
  const m = moneyParts(minor, currency, locale)
  return `${m.amount} ${m.unit}`
}

/** "Due 19 Dec 2026 for Hamza": when, and for whom, as one phrase. */
function dueLine(i: TimelineInstalment, tx: ReturnType<typeof useCopy>, locale: 'ar' | 'en'): ReactNode {
  const date = longDay(i.dueDate, locale)
  return i.child ? fill(tx(P.dueForChild, { date }), { name: <bdi>{i.child.name}</bdi> }) : tx(P.dueForFamily, { date })
}

/* ------------------------------------------------------------------ photo */

/**
 * Choosing a photo is choose -> preview -> use, or cancel; the current photo
 * stays until the new one is committed. The actions live in the file's menu;
 * the preview takes the monogram's place and its two buttons sit under the masthead.
 */
function usePhotoDraft(profile: ParentProfile) {
  const tx = useCopy()
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
  return {
    inputId,
    fileRef,
    prepared,
    notice,
    busy: upload.isPending || remove.isPending,
    uploading: upload.isPending,
    error: problem ?? upload.error ?? remove.error,
    choose,
    pick: () => fileRef.current?.click(),
    cancel: () => setPrepared(null),
    use: () => {
      if (!prepared) return
      upload.mutate(prepared.blob, {
        onSuccess: () => {
          setPrepared(null)
          setNotice(tx(P.photoSaved))
        },
      })
    },
    remove: () => {
      setProblem(null)
      remove.mutate(undefined, { onSuccess: () => setNotice(tx(P.photoRemoved)) })
    },
  }
}

function PhotoBar({ photo }: { photo: ReturnType<typeof usePhotoDraft> }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const hintId = `${photo.inputId}-hint`
  return (
    <>
      <input
        ref={photo.fileRef}
        id={photo.inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sp-file-input"
        aria-label={tx(P.photo)}
        aria-describedby={photo.prepared ? hintId : undefined}
        tabIndex={-1}
        disabled={photo.busy}
        onChange={(e) => void photo.choose(e.target.files?.[0])}
      />
      {(photo.prepared || photo.error || photo.notice) && (
        <div className="rec-photo" role="group" aria-label={tx(P.photo)}>
          {photo.prepared && (
            <>
              <span id={hintId} className="rec-photo__hint">
                {tx(P.photoHint)}
              </span>
              <span className="rec-photo__buttons">
                <button type="button" className="btn btn--sm" disabled={photo.busy} onClick={photo.use}>
                  {photo.uploading ? tx(P.photoUploading) : tx(P.photoUse)}
                </button>
                <button type="button" className="btn btn--sm btn--ghost" disabled={photo.busy} onClick={photo.cancel}>
                  {tx(P.cancel)}
                </button>
              </span>
            </>
          )}
          {photo.error ? (
            <span className="field__error" role="alert">
              {describeError(photo.error, locale)}
            </span>
          ) : photo.notice ? (
            <span className="sp-ok" role="status">
              {photo.notice}
            </span>
          ) : null}
        </div>
      )}
    </>
  )
}

/* --------------------------------------------------------------- overview */

/**
 * What waits on this family now, most pressing first: instalments that are
 * late (with how late), those due today, payment requests still open, and
 * receipts nobody has checked. One calm line when nothing does.
 */
function AttentionSheet({ billing: query, onOpen }: { billing: ReturnType<typeof useFamilyBilling>; onOpen: (d: Dialogs) => void }) {
  const tx = useCopy()
  const { locale, dateTime, number } = useI18n()
  const billing = query.data
  const pressing = billing?.instalments.filter((i) => i.status === 'overdue' || i.status === 'due') ?? []
  const requests = billing?.requests.filter((r) => r.status === 'open') ?? []
  const receipts = billing?.receipts.filter((r) => r.status === 'pending') ?? []
  const count = pressing.length + requests.length + receipts.length
  return (
    <Sheet id="pf-attention" section="attention" title={tx(P.attention)} count={billing && count > 0 ? number(count) : undefined}>
      {isProfileRefusal(query.error) ? (
        <p className="rec-empty">{describeError(query.error, locale)}</p>
      ) : (
        <QueryBoundary isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} compact>
          {billing &&
            (count === 0 ? (
              <Calm>{tx(P.calmFamily)}</Calm>
            ) : (
              <ul className="rec-list">
                {pressing.map((i) => (
                  <AttentionRow
                    key={i.id}
                    tone={i.status === 'overdue' ? 'late' : 'waiting'}
                    title={<bdi>{plainLabel(i.label, locale)}</bdi>}
                    tag={
                      <Badge tone={i.status === 'overdue' ? 'danger' : 'warn'}>
                        {i.status === 'overdue' && i.days > 0 ? lateWords(i.days, locale) : tx(TIMELINE_STATUS[i.status])}
                      </Badge>
                    }
                    sub={
                      <>
                        <span>{dueLine(i, tx, locale)}</span>
                      </>
                    }
                    amount={<Amount minor={i.remainingMinor} currency={i.currency} locale={locale} late={i.status === 'overdue'} />}
                    action={
                      billing.canRecord && (
                        <RowActions
                          label={tx(P.more, { name: i.label })}
                          primary={
                            <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'pay', instalment: i })}>
                              {tx(P.recordPayment)}
                            </button>
                          }
                          more={[{ key: 'link', label: tx(PAY.paymentLink), icon: 'link', onSelect: () => onOpen({ kind: 'link', instalment: i }) }]}
                        />
                      )
                    }
                  />
                ))}
                {requests.map((r) => (
                  <AttentionRow
                    key={r.id}
                    tone="waiting"
                    title={<bdi>{plainLabel(r.label, locale)}</bdi>}
                    tag={<Badge tone="warn">{tx(P.openRequest)}</Badge>}
                    sub={
                      <>
                        {r.child && (
                          <span>
                            <bdi>{r.child.name}</bdi>
                          </span>
                        )}
                        <span>{tx(PAY.expires, { date: dateTime(r.expiresAt) })}</span>
                      </>
                    }
                    amount={<Amount minor={owed(r)} currency={r.currency} locale={locale} />}
                    action={
                      <RowActions
                        label={tx(P.more, { name: r.label })}
                        primary={
                          <Link className="btn btn--sm" to="#requests">
                            {tx(P.view)}
                          </Link>
                        }
                      />
                    }
                  />
                ))}
                {receipts.map((r) => (
                  <AttentionRow
                    key={r.id}
                    tone="waiting"
                    title={<bdi>{plainLabel(r.label, locale)}</bdi>}
                    tag={<Badge tone="warn">{tx(RECEIPT_STATUS.pending)}</Badge>}
                    sub={
                      <span>
                        {tx(PAY.transferredOn)}: {longDay(r.transferredOn, locale)}
                      </span>
                    }
                    amount={<Amount minor={r.amountMinor} currency={r.currency} locale={locale} />}
                    action={
                      <RowActions
                        label={tx(P.more, { name: r.label })}
                        primary={
                          <Link className="btn btn--sm" to="#receipts">
                            {tx(P.view)}
                          </Link>
                        }
                      />
                    }
                  />
                ))}
              </ul>
            ))}
        </QueryBoundary>
      )}
    </Sheet>
  )
}

/** The next instalments that fall due, so the page says what is coming as well as what is late. */
function ComingUp({ billing }: { billing: FamilyBilling }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const next = billing.instalments
    .filter((i) => i.status === 'upcoming')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3)
  if (next.length === 0) return null
  return (
    <Sheet
      id="pf-coming"
      title={tx(P.comingUp)}
      action={
        <Link className="btn btn--sm btn--ghost" to="#instalments">
          {tx(P.allInstalments)}
        </Link>
      }
    >
      <ul className="rec-list">
        {next.map((i) => (
          <AttentionRow
            key={i.id}
            tone="plain"
            title={<bdi>{plainLabel(i.label, locale)}</bdi>}
            sub={
              <>
                <span>{dueLine(i, tx, locale)}</span>
                {i.days > 0 && <span>{inDaysWords(i.days, locale)}</span>}
              </>
            }
            amount={<Amount minor={i.remainingMinor} currency={i.currency} locale={locale} />}
          />
        ))}
      </ul>
    </Sheet>
  )
}

/** Phone, e-mail and where the family is: quiet facts on the canvas, beside the work. */
function ContactGroup({ profile, onEdit }: { profile: ParentProfile; onEdit: () => void }) {
  const tx = useCopy()
  const { locale, dateTime, date } = useI18n()
  const c = profile.contact
  const missing = <span className="rec-missing">{tx(P.notRecorded)}</span>
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
    <section className="aside-group rec-group" aria-labelledby="pf-contact" data-section="contact">
      <div className="rec-group__head">
        <h2 id="pf-contact" className="aside-group__title">
          {tx(P.contactInfo)}
        </h2>
        {profile.access.canEdit && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onEdit} aria-label={tx(P.editContact)}>
            {tx(P.edit)}
          </button>
        )}
      </div>
      {!c.phone && !c.email && !c.location && !c.region ? (
        <p className="rec-fact__quiet rec-contact-none">{tx(P.noContact)}</p>
      ) : (
      <dl className="rec-facts">
        <Fact icon="phone" label={tx(P.phone)}>
          {c.phone ? <bdi dir="ltr">{c.phone}</bdi> : missing}
        </Fact>
        <Fact icon="mail" label={tx(P.email)}>
          {c.email ? <bdi dir="ltr">{c.email}</bdi> : missing}
        </Fact>
        <Fact icon="mapPin" label={tx(P.country)}>
          {c.location ? <bdi>{pick(c.location.country)}</bdi> : missing}
        </Fact>
        {c.location && showSubdivision && (
          <Fact label={pick(c.location.label)}>{c.location.subdivision ? <bdi>{pick(c.location.subdivision)}</bdi> : missing}</Fact>
        )}
        {/* PD-45 §3.4: the old free text, until a subdivision is set. */}
        {c.region && !c.subdivisionCode && (
          <Fact label={tx(P.oldNote)}>
            <bdi>{c.region}</bdi>
          </Fact>
        )}
        {clock && (
          <Fact icon="clock" label={tx(P.timeZone)}>
            <span className="rec-fact__quiet">{clock}</span>
          </Fact>
        )}
      </dl>
      )}
      {(setByParent || profile.updatedAt) && (
        <p className="rec-by">
          {setByParent && <span>{tx(P.setByParent, { date: date(setByParent) })}</span>}
          {profile.updatedAt && <span>{tx(P.lastEdit, { date: dateTime(profile.updatedAt) })}</span>}
        </p>
      )}
    </section>
  )
}

/** The administration's note, on gold paper under a lock: never the parent's to read, nor a teacher's. */
function NoteGroup({ profile, onEdit }: { profile: ParentProfile; onEdit: () => void }) {
  const tx = useCopy()
  return (
    <section className="rec-note" aria-labelledby="pf-note" data-section="note">
      <div className="rec-group__head">
        <h2 id="pf-note" className="rec-note__title">
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
        <p className="rec-note__empty">{tx(P.noNote)}</p>
      )}
      <p className="rec-note__rule">{tx(P.aboutHint)}</p>
    </section>
  )
}

/* ------------------------------------------------------------------ money */

/**
 * The family's money: on what terms it pays (beside the ledgers, where it
 * stays in view), then the ledgers in their usual order -- instalments,
 * payment requests (each with its own link), the payments that arrived, their
 * invoices, and the receipts the parents uploaded. Every control is the
 * server's answer: `canRecord` creates requests and records cash or bank
 * transfers, voids and decides receipts; `canVerify` refunds. "Record a
 * payment" is in the masthead, where it stays in reach from every tab.
 */
function MoneyTab({ billing, onOpen }: { billing: FamilyBilling; onOpen: (d: Dialogs) => void }) {
  const tx = useCopy()
  const { locale, dateTime, number } = useI18n()
  const { staff } = useSession()
  const paymentsPath = staff && isSuperAdmin(staff.role) ? adminSectionPath('payments') : '/payments'
  const fullyPaid = new Set(billing.instalments.filter((i) => i.status === 'paid').map((i) => i.id))
  const openInstalments = billing.instalments.filter((i) => i.status !== 'paid' && i.status !== 'voided').length
  const openRequests = billing.requests.filter((r) => r.status === 'open').length
  const pending = billing.receipts.filter((r) => r.status === 'pending').length
  const missing = <span className="rec-missing">{tx(P.notRecorded)}</span>
  const index: Array<{ to: string; label: string; count?: number; urgent?: boolean }> = [
    { to: '#instalments', label: tx(P.ixInstalments), count: openInstalments, urgent: billing.instalments.some((i) => i.status === 'overdue') },
    { to: '#requests', label: tx(P.ixRequests), count: openRequests },
    { to: '#received', label: tx(P.ixReceived) },
    { to: '#invoices', label: tx(P.ixInvoices) },
    { to: '#receipts', label: tx(P.ixReceipts), count: pending },
  ]
  return (
    <div className="split rec-split rec-split--lead">
      <aside className="rec-aside">
        <section className="aside-group rec-group" aria-labelledby="pf-payments" data-section="payments">
          <div className="rec-group__head">
            <h2 id="pf-payments" className="aside-group__title">
              {tx(P.payments)}
            </h2>
            {billing.canRecord && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => onOpen({ kind: 'billing' })} aria-label={tx(P.editPayments)}>
                {tx(P.edit)}
              </button>
            )}
          </div>
          <dl className="rec-facts">
            <Fact icon="calendar" label={tx(P.subscription)}>
              {billing.planMonths ? planLabel(billing.planMonths, locale) : <span className="rec-missing">{tx(P.noPlan)}</span>}
            </Fact>
            <Fact icon="bankTransfer" label={tx(P.method)}>
              {billing.paymentMethod ? tx(METHOD_LABEL[billing.paymentMethod]) : missing}
            </Fact>
            <Fact icon="banknote" label={tx(P.currency)}>
              {billing.currency ?? missing}
            </Fact>
          </dl>
          {/* Paid, outstanding and late, per currency: what is owed now is also the head's first highlight. */}
          {billing.totals.length > 0 && (
            <table className="rec-totals" aria-label={tx(P.totals)}>
              <tbody>
                {billing.totals.map((t) => (
                  <TotalsRows key={t.currency} totals={t} locale={locale} />
                ))}
              </tbody>
            </table>
          )}
          <p className="rec-rule">{tx(P.paymentsHint)}</p>
        </section>
        <nav className="aside-group rec-index" aria-label={tx(P.fileIndex)}>
          {index.map((x) => (
            <Link key={x.to} to={x.to} className="rec-index__link">
              <span>{x.label}</span>
              {x.count ? <span className="count count--quiet">{number(x.count)}</span> : null}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="rec-main">
        <Sheet
          id="pf-timeline"
          section="instalments"
          title={tx(P.timeline)}
          count={billing.instalments.length > 0 ? number(billing.instalments.length) : undefined}
          rule={tx(P.timelineHint)}
          action={
            billing.canRecord && (
              <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'new' })}>
                {tx(P.addInstalments)}
              </button>
            )
          }
        >
          {billing.instalments.length === 0 ? (
            <p className="rec-empty">{tx(P.noInstalments)}</p>
          ) : (
            <ol className="rec-list">
              {billing.instalments.map((i) => (
                <TimelineRow key={i.id} item={i} canRecord={billing.canRecord} onOpen={onOpen} />
              ))}
            </ol>
          )}
        </Sheet>
        <Sheet
          id="pf-requests"
          section="requests"
          title={tx(PAY.requests)}
          count={billing.requests.length > 0 ? number(billing.requests.length) : undefined}
          rule={tx(PAY.requestsHint)}
          action={
            billing.canRecord && (
              <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'request' })}>
                {tx(PAY.requestPayment)}
              </button>
            )
          }
        >
          <RequestList requests={billing.requests} canCancel={billing.canRecord} onCancel={(request) => onOpen({ kind: 'cancelRequest', request })} />
        </Sheet>
        <Sheet
          id="pf-received"
          section="received"
          title={tx(PAY.received)}
          count={billing.payments.length > 0 ? number(billing.payments.length) : undefined}
          rule={tx(PAY.receivedHint)}
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
        </Sheet>
        <Sheet
          id="pf-invoices"
          section="invoices"
          title={tx(PAY.invoices)}
          count={billing.invoices.length > 0 ? number(billing.invoices.length) : undefined}
          rule={tx(PAY.invoicesHint)}
        >
          {billing.invoices.length === 0 ? (
            <p className="rec-empty">{tx(PAY.noInvoices)}</p>
          ) : (
            <ol className="rec-list">
              {billing.invoices.map((inv) => (
                <AttentionRow
                  key={inv.id}
                  tone={inv.status === 'void' ? 'struck' : 'plain'}
                  title={
                    <>
                      <bdi dir="ltr">{inv.number}</bdi>{' '}
                      <span className="rec-attn__label" dir="auto">
                        {inv.label}
                      </span>
                    </>
                  }
                  tag={<InvoiceStatusBadge status={inv.status} />}
                  sub={
                    <>
                      <span>{tx(PAY.issued, { date: dateTime(inv.issuedAt) })}</span>
                      <span>{tx(METHOD[inv.method])}</span>
                      {inv.child && <span dir="auto">{inv.child.name}</span>}
                      {inv.refundedMinor > 0 && <span>{tx(PAY.refunded, { amount: amountText(inv.refundedMinor, inv.currency, locale) })}</span>}
                    </>
                  }
                  amount={<Amount minor={inv.amountMinor} currency={inv.currency} locale={locale} />}
                  action={<RowActions label={tx(P.more, { name: inv.number })} primary={<InvoiceDownloadButton invoiceId={inv.id} number={inv.number} />} />}
                />
              ))}
            </ol>
          )}
        </Sheet>
        <Sheet
          id="pf-receipts"
          section="receipts"
          title={tx(PAY.familyReceipts)}
          count={billing.receipts.length > 0 ? number(billing.receipts.length) : undefined}
          rule={tx(PAY.familyReceiptsHint)}
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
            <p className="rec-empty">{tx(PAY.noFamilyReceipts)}</p>
          ) : (
            <ol className="rec-list">
              {billing.receipts.map((r) => (
                <AttentionRow
                  key={r.id}
                  tone={r.status === 'pending' ? 'waiting' : 'plain'}
                  title={<bdi>{plainLabel(r.label, locale)}</bdi>}
                  tag={<ReceiptStatusBadge status={r.status} />}
                  sub={
                    <>
                      <span>
                        {tx(PAY.transferredOn)}: {longDay(r.transferredOn, locale)}
                      </span>
                      <span>
                        {tx(PAY.uploadedAt)}: {dateTime(r.uploadedAt)}
                      </span>
                      {r.uploadedBy && <span dir="auto">{tx(PAY.uploadedBy, { name: r.uploadedBy.name })}</span>}
                    </>
                  }
                  amount={<Amount minor={r.amountMinor} currency={r.currency} locale={locale} />}
                  action={<ReceiptFile fileUrl={r.fileUrl} mimeType={r.mimeType} label={r.label} />}
                >
                  {r.note && (
                    <span className="rec-attn__more" dir="auto">
                      {r.note}
                    </span>
                  )}
                  {r.rejectReason && (
                    <span className="rec-attn__more" dir="auto">
                      {tx(PAY.rejectedBecause, { reason: r.rejectReason })}
                    </span>
                  )}
                </AttentionRow>
              ))}
            </ol>
          )}
        </Sheet>
      </div>
    </div>
  )
}

/** One currency's money as plain lines: paid, still to pay, and what of that is late. */
function TotalsRows({ totals, locale }: { totals: FamilyBilling['totals'][number]; locale: 'ar' | 'en' }) {
  const tx = useCopy()
  const rows: Array<{ key: string; label: string; minor: number; late?: boolean }> = [
    { key: 'paid', label: tx(P.paid), minor: totals.paidMinor },
    { key: 'outstanding', label: tx(P.outstanding), minor: totals.outstandingMinor },
  ]
  if (totals.overdueMinor > 0) rows.push({ key: 'overdue', label: tx(P.overdueShort), minor: totals.overdueMinor, late: true })
  return (
    <>
      {rows.map((r) => (
        <tr key={r.key} className={r.late ? 'rec-totals__late' : undefined}>
          <th scope="row">
            {r.label}
          </th>
          <td>
            <Amount minor={r.minor} currency={totals.currency} locale={locale} />
          </td>
        </tr>
      ))}
    </>
  )
}

/**
 * One instalment: its state, what it is for, what is owed, and one action.
 * Recording its payment is the thing done most; its link and voiding it are
 * behind the row's menu, voiding last.
 */
function TimelineRow({ item, canRecord, onOpen }: { item: TimelineInstalment; canRecord: boolean; onOpen: (d: Dialogs) => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const open = item.status !== 'paid' && item.status !== 'voided'
  const more: MenuItem[] = [
    ...(open ? [{ key: 'link', label: tx(PAY.paymentLink), icon: 'link' as const, onSelect: () => onOpen({ kind: 'link', instalment: item }) }] : []),
    { key: 'void', label: tx(P.void), icon: 'prohibit' as const, danger: true, onSelect: () => onOpen({ kind: 'void', instalment: item }) },
  ]
  return (
    <AttentionRow
      tone={item.status === 'voided' ? 'struck' : item.status === 'overdue' ? 'late' : item.status === 'paid' ? 'muted' : 'plain'}
      title={<bdi>{plainLabel(item.label, locale)}</bdi>}
      tag={
        <>
          <Badge tone={STATUS_TONE[item.status]} dot>
            {tx(TIMELINE_STATUS[item.status])}
          </Badge>
          {open && item.partial && <Badge tone="warn">{tx(PAY.partiallyPaid)}</Badge>}
          {open && item.payableInApp === false && <Badge tone="neutral">{tx(PAY.notPayableInApp)}</Badge>}
        </>
      }
      sub={
        <>
          <span>{dueLine(item, tx, locale)}</span>
          {item.status === 'overdue' && item.days > 0 && <span className="rec-late">{lateWords(item.days, locale)}</span>}
        </>
      }
      amount={<Amount minor={item.amountMinor} currency={item.currency} locale={locale} late={item.status === 'overdue'} />}
      action={
        canRecord &&
        item.status !== 'voided' && (
          <RowActions
            label={tx(P.more, { name: item.label })}
            primary={
              open ? (
                <button type="button" className="btn btn--sm" onClick={() => onOpen({ kind: 'pay', instalment: item })}>
                  {tx(P.recordPayment)}
                </button>
              ) : undefined
            }
            more={more}
          />
        )
      }
    >
      {open && item.partial && (
        <span className="rec-attn__more">
          {tx(PAY.paidRemaining, {
            paid: formatMoney(item.paidMinor, item.currency, locale),
            remaining: formatMoney(item.remainingMinor, item.currency, locale),
          })}
        </span>
      )}
      {item.payment && (
        <span className="rec-attn__more">
          {item.payment.recordedBy
            ? tx(P.paidOnBy, {
                date: longDay(item.payment.paidOn, locale),
                method: tx(METHOD[item.payment.method]),
                name: item.payment.recordedBy.name,
              })
            : tx(P.paidOnByStripe, { date: longDay(item.payment.paidOn, locale), method: tx(METHOD[item.payment.method]) })}
          {item.payment.reference && (
            <>
              {locale === 'ar' ? '، ' : ', '}
              {tx(P.reference)}: <bdi dir="ltr">{item.payment.reference}</bdi>
            </>
          )}
        </span>
      )}
      {item.void && (
        <span className="rec-attn__more" dir="auto">
          {tx(P.voidedBy, { name: item.void.by.name, reason: item.void.reason })}
        </span>
      )}
    </AttentionRow>
  )
}

/* --------------------------------------------------------------- children */

function ChildrenSheet({ profile, standings, onAdd }: { profile: ParentProfile; standings: Array<Standing | undefined>; onAdd?: () => void }) {
  const tx = useCopy()
  const { number } = useI18n()
  const navigate = useNavigate()
  return (
    <Sheet
      id="pf-children"
      section="children"
      title={tx(P.children)}
      count={number(profile.childrenCount)}
      action={
        onAdd && (
          <button type="button" className="btn btn--sm" onClick={onAdd}>
            {tx(I.addChild)}
          </button>
        )
      }
    >
      {profile.children.length === 0 ? (
        <p className="rec-empty">{tx(P.noChildren)}</p>
      ) : (
        <ul className="rec-list">
          {profile.children.map((c, i) => (
            <li
              key={c.id}
              className="rec-kid"
              onClick={(e) => {
                // The whole row opens the file; the name is the link the keyboard uses.
                if (!(e.target as HTMLElement).closest('a, button')) navigate(studentPath(c.id))
              }}
            >
              <Avatar name={c.name} seed={c.id} src={c.avatarUrl} />
              <Link className="rec-kid__name" to={studentPath(c.id)} aria-label={`${tx(P.viewProfile)}: ${c.name}`}>
                <bdi>{c.name}</bdi>
              </Link>
              <ChildStanding standing={standings[i]} />
              <RowActions
                label={tx(P.more, { name: c.name })}
                primary={
                  // The name is the link; this is only a larger target for the pointer.
                  <Link className="btn btn--sm" to={studentPath(c.id)} tabIndex={-1} aria-hidden="true">
                    {tx(P.openFile)}
                  </Link>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

/**
 * A child's lessons as one thin line: used out of bought, and whether the
 * subscription is open, in grace or locked. Read from the child's own
 * subscription (PD-30); where the server does not answer for this viewer,
 * nothing is drawn.
 */
function ChildStanding({ standing: s }: { standing: Standing | undefined }) {
  const tx = useCopy()
  const { number, locale } = useI18n()
  if (!s) return null
  const total = s.lessonsIncluded
  const used = s.lessonsUsed
  const share = total && used !== null ? Math.min(100, Math.round((used / total) * 100)) : null
  return (
    <span className="rec-kid__standing">
      {total !== null && used !== null && (
        <span className="rec-kid__lessons">
          <span className="rec-kid__count">
            <span>{tx(P.lessonsUsed, { used: number(used), lessons: lessonsLabel(total, locale) })}</span>
            {s.lessonsLeft !== null && <span className="rec-kid__left">{tx(P.lessonsLeft, { n: number(s.lessonsLeft) })}</span>}
          </span>
          {share !== null && (
            <span className={s.state === 'locked' ? 'pp-meter pp-meter--late' : s.state === 'grace' ? 'pp-meter pp-meter--warn' : 'pp-meter'} aria-hidden="true">
              <span style={{ inlineSize: `${share}%` }} />
            </span>
          )}
        </span>
      )}
      <Badge tone={ACCESS_TONE[s.state]} dot>
        {s.state === 'open' ? tx(P.subscriptionOpen) : tx(STATE_LABEL[s.state])}
      </Badge>
    </span>
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
