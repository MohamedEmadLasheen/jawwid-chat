import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { TrialPaymentsDialog, TrialRequestsSummary } from '@/features/payments/TrialPaymentsDialog'
import { PAY } from '@/features/payments/copy'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import {
  Age,
  DetailHead,
  DetailSection,
  FlowStrip,
  RequestQueue,
  RowOpen,
  ageText,
  rowOpener,
  useWidePane,
  waitedOvernight,
  type FlowCell,
  type FlowStep,
} from '@/shared/components/RequestQueue'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { Pair } from '../teachers/copy'
import { describeOpsError } from '../teachers/opsCopy'
import { trialsApi, type NewStudentDto } from './api'
import { TrialsAreaTabs, useTrialsAccess } from './area'
import { PAYMENT_METHOD, TR, WEEKDAY, formatWhen } from './copy'
import {
  NS,
  STATUS,
  currencyName,
  formatAmount,
  formatClock,
  matchesFilter,
  matchesSearch,
  newStudentStatus,
  type NewStudentStatus,
  type StatusFilter,
} from './newStudentsCopy'
import { useNewStudents, useTrialOp } from './hooks'
import { SubscriptionForm, draftFrom, formErrors, toInput, type SubscriptionDraft } from './SubscriptionForm'
import { NewStudentSetup } from './NewStudentSetup'
import { EnteredFamilies } from '@/features/intake/EnteredFamilies'
import '../teachers/teachers.css'
import './trials.css'
import './new-students.css'

/** A family nobody was assigned to since before today is late; a parent's turn is never late. */
const assignLate = (s: NewStudentDto, status: NewStudentStatus) => status === 'unassigned' && waitedOvernight(s.recordedAt)

/**
 * The New Students page (trial journey): every family that subscribed after a
 * trial, exactly as Sales recorded it in Chat -- the parent, each child with
 * their course, teacher, prices and weekly times, and the payment. These
 * details live here only; the trial group was told "The student has
 * subscribed." and nothing more. Operations, Sales and the super admin read
 * it; Sales may correct a typo.
 *
 * Laid out as a request queue: the setup states as a strip of counts, the
 * families as the queue, and the open family's record beside it. Below 1100px
 * the page has no drawer of its own, so every record is listed in full.
 */
export function NewStudentsPage() {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const q = useNewStudents()
  const access = useTrialsAccess()
  const wide = useWidePane()
  const [editing, setEditing] = useState<NewStudentDto | null>(null)
  const [paying, setPaying] = useState<NewStudentDto | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // PD-44: the filter lives in the URL, so a Dashboard tile opens the filter
  // it counted (?filter=unassigned|waiting|signed_up) and a later link moves it too.
  const [params, setParams] = useSearchParams()
  const asked = params.get('filter')
  const filter: StatusFilter = asked === 'unassigned' || asked === 'waiting' || asked === 'signed_up' ? asked : 'all'
  const setFilter = (next: StatusFilter) =>
    setParams((current) => {
      const p = new URLSearchParams(current)
      if (next === 'all') p.delete('filter')
      else p.set('filter', next)
      return p
    }, { replace: true })
  const { staff } = useSession()
  const students = q.data?.students ?? []
  // PD-27: Sales, the Operations Manager (who assigns) and the super admin ask
  // for the subscription payment before Assign, and still see the trial's
  // requests after it (read only). The server decides each request.
  const mayRequestPayment = access.sales || q.data?.canAssign === true || (staff !== null && isSuperAdmin(staff.role))

  // PD-32: one status per card drives the badge and the filter; the search is on names.
  const statuses = useMemo(() => new Map(students.map((s) => [s.trialId, newStudentStatus(s)])), [students])
  const statusOf = (s: NewStudentDto) => statuses.get(s.trialId) ?? 'unassigned'
  const searched = students.filter((s) => matchesSearch(s, search))
  const shown = searched.filter((s) => matchesFilter(statusOf(s), filter))
  const count = (f: StatusFilter) => searched.filter((s) => matchesFilter(statusOf(s), f)).length
  const unassigned = searched.filter((s) => statusOf(s) === 'unassigned')
  const oldest = unassigned.reduce<NewStudentDto | null>((a, s) => (a === null || s.recordedAt < a.recordedAt ? s : a), null)
  const locked = searched.filter((s) => statusOf(s) === 'locked').length
  const cells: Array<FlowCell<StatusFilter>> = [
    { key: 'all', label: tx(NS.all), count: count('all'), apart: true },
    {
      key: 'unassigned',
      label: tx(STATUS.unassigned.label),
      count: count('unassigned'),
      note: oldest ? tx(NS.oldest).replace('{age}', ageText(oldest.recordedAt, locale)) : undefined,
      late: unassigned.some((s) => assignLate(s, 'unassigned')),
    },
    {
      key: 'waiting',
      label: tx(STATUS.waiting.label),
      count: count('waiting'),
      note: locked > 0 ? tx(NS.lockedCount).replace('{n}', String(locked)) : undefined,
      late: locked > 0,
    },
    { key: 'signed_up', label: tx(STATUS.signed_up.label), count: count('signed_up') },
  ]

  const record = (s: NewStudentDto) => (
    <FamilyRecord
      key={s.trialId}
      s={s}
      status={statusOf(s)}
      canAssign={q.data?.canAssign === true}
      // PD-16: a form that became a family is frozen.
      onEdit={access.sales && !s.enrolment ? () => setEditing(s) : undefined}
      onPayments={mayRequestPayment ? () => setPaying(s) : undefined}
    />
  )
  // Beside the queue the panel always shows a family: the one picked, else the first in the list.
  const open = wide ? shown.find((s) => s.trialId === openId) ?? shown[0] ?? null : null

  return (
    <div className="page rq-page ns-page">
      <div className="page__inner">
        <TrialsAreaTabs />
        <PageHeader title={tx(TR.newTitle)} subtitle={tx(TR.newSubtitle)} />
        {students.length > 0 && <FlowStrip label={tx(NS.filterLabel)} cells={cells} value={filter} onChange={setFilter} />}
        <RequestQueue
          label={tx(NS.panelLabel)}
          detail={open && { id: open.trialId, title: open.parent.name, bare: true, pinned: true, onClose: () => setOpenId(null), body: record(open) }}
        >
          <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
            {students.length === 0 ? (
              <EmptyState title={tx(TR.nothingNew)} hint={tx(NS.emptyHint)} />
            ) : (
              <>
                <div className="rq-toolbar">
                  <label className="search">
                    <Icon name="search" size={16} />
                    <span className="sr-only">{tx(NS.search)}</span>
                    <input
                      className="input"
                      type="search"
                      value={search}
                      placeholder={tx(NS.search)}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                {shown.length === 0 ? (
                  <EmptyState title={tx(NS.noMatch)} />
                ) : wide ? (
                  <div className="table-wrap">
                    <table className="table rq-table">
                      <thead>
                        <tr>
                          <th scope="col">{tx(NS.family)}</th>
                          <th scope="col">{tx(NS.supervisor)}</th>
                          <th scope="col" className="rq-c--more">{tx(NS.recordedCol)}</th>
                          <th scope="col">{tx(NS.status)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((s) => {
                          const status = statusOf(s)
                          return (
                            <tr key={s.trialId} data-selected={open?.trialId === s.trialId || undefined} onClick={rowOpener(() => setOpenId(s.trialId))}>
                              <th scope="row" className="rq-c-who">
                                <RowOpen selected={open?.trialId === s.trialId} onOpen={() => setOpenId(s.trialId)}>{s.parent.name}</RowOpen>
                                <span className="rq-sub"><bdi>{s.children.map((c) => c.name).join(' · ')}</bdi></span>
                              </th>
                              <td className="rq-c-meta">
                                {s.enrolment?.supervisor ? <bdi>{s.enrolment.supervisor.name}</bdi> : <span className="rq-muted">—</span>}
                              </td>
                              <td className="rq-c-when rq-c--more">
                                <Age iso={s.recordedAt} late={assignLate(s, status)} />
                                <span className="rq-sub"><bdi>{s.recordedBy.name}</bdi></span>
                              </td>
                              <td className="rq-c-status">
                                <Badge tone={STATUS[status].tone} dot>{tx(STATUS[status].label)}</Badge>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="ns-list">{shown.map(record)}</div>
                )}
              </>
            )}
          </QueryBoundary>
          {/* PD-42 PR-3: the families supervisors entered by hand, to whoever owns them (the server's answer). */}
          <EnteredFamilies />
        </RequestQueue>
        {editing && <EditSubscriptionDialog student={editing} onClose={() => setEditing(null)} />}
        {paying && <TrialPaymentsDialog trialId={paying.trialId} name={paying.parent.name} onClose={() => setPaying(null)} />}
      </div>
    </div>
  )
}

/**
 * PD-32: one family, read top to bottom -- who (the parent, the status, who
 * recorded it), its steps from the trial to the parent's sign-up, each with
 * its own control, then the contact, the payment and the children.
 */
function FamilyRecord({
  s,
  status,
  onEdit,
  onPayments,
  canAssign,
}: {
  s: NewStudentDto
  status: NewStudentStatus
  onEdit?: () => void
  onPayments?: () => void
  canAssign: boolean
}) {
  const { locale, number } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const money = (n: number) => formatAmount(n, s.payment.currency, locale)
  const headingId = `ns-${s.trialId}`
  const before: FlowStep[] = [
    {
      key: 'trial',
      label: tx(NS.stepTrial),
      state: 'done',
      meta: (
        <>
          <bdi>{s.prospectName}</bdi>
          {s.trialTeacher && <> · <bdi>{s.trialTeacher.name}</bdi></>}
          {s.trialAt && <> · <time dateTime={s.trialAt}>{formatWhen(s.trialAt, locale)}</time></>}
        </>
      ),
    },
    { key: 'recorded', label: tx(NS.stepRecorded), state: 'done', meta: <time dateTime={s.recordedAt}>{formatWhen(s.recordedAt, locale)}</time> },
  ]
  return (
    <article className="ns-record" aria-labelledby={headingId}>
      <DetailHead
        id={headingId}
        title={s.parent.name}
        kind={{ icon: 'newStudents', label: tx(NS.kind) }}
        status={
          <>
            <Badge tone={STATUS[status].tone} dot>{tx(STATUS[status].label)}</Badge>
            <Age iso={s.recordedAt} late={assignLate(s, status)} />
          </>
        }
      >
        <p className="ns-record__byline">
          {tx(NS.recorded)} <span dir="auto">{s.recordedBy.name}</span>
          {s.updatedAt && (
            <> · {tx(NS.updated)} <time dateTime={s.updatedAt}>{formatWhen(s.updatedAt, locale)}</time></>
          )}
        </p>
      </DetailHead>
      {(onEdit || onPayments) && (
        <div className="ns-record__actions">
          {onPayments && <button type="button" className="btn btn--sm" onClick={onPayments}>{tx(PAY.trialAction)}</button>}
          {onEdit && <button type="button" className="btn btn--sm" onClick={onEdit}>{tx(TR.editForm)}</button>}
        </div>
      )}

      <div className="ns-record__body">
        <NewStudentSetup s={s} canAssign={canAssign} before={before} />

        <div className="ns-record__facts">
          <DetailSection title={tx(NS.contact)}>
            <dl className="rq-fields">
              <div className="rq-field">
                <dt>{tx(TR.parentPhone)}</dt>
                <dd><bdi dir="ltr" className="ns-ltr">{s.parent.phone}</bdi></dd>
              </div>
              <div className="rq-field">
                <dt>{tx(TR.email)}</dt>
                <dd>{s.parent.email ? <bdi dir="ltr" className="ns-ltr">{s.parent.email}</bdi> : <span className="ts-muted">—</span>}</dd>
              </div>
              <div className="rq-field">
                <dt>{tx(TR.location)}</dt>
                <dd>{formLocationText(s.parent.location, locale)}</dd>
              </div>
            </dl>
          </DetailSection>
          <DetailSection title={tx(NS.payment)}>
            <dl className="rq-fields">
              <div className="rq-field">
                <dt>{tx(TR.paymentMethod)}</dt>
                <dd>{tx(PAYMENT_METHOD[s.payment.method] ?? { en: s.payment.method, ar: s.payment.method })}</dd>
              </div>
              <div className="rq-field">
                <dt>{tx(TR.currency)}</dt>
                <dd>{currencyName(s.payment.currency, locale)}</dd>
              </div>
            </dl>
            {onPayments && <TrialRequestsSummary trialId={s.trialId} />}
          </DetailSection>
        </div>

        <DetailSection title={tx(NS.children)} aside={<span className="ns-count">{number(s.children.length)}</span>}>
          <div className="ns-children">
            <table className="table ns-table">
              <thead>
                <tr>
                  <th scope="col">{tx(TR.childName)}</th>
                  <th scope="col" className="ns-num">{tx(TR.childAge)}</th>
                  <th scope="col">{tx(TR.course)}</th>
                  <th scope="col">{tx(TR.assignedTeacher)}</th>
                  <th scope="col" className="ns-num">{tx(TR.packagePrice)}</th>
                  <th scope="col" className="ns-num">{tx(TR.lessonPrice)}</th>
                  <th scope="col">{tx(TR.schedule)}</th>
                </tr>
              </thead>
              <tbody>
                {s.children.map((c, i) => (
                  <tr key={i}>
                    <th scope="row" className="ns-c-name" dir="auto">{c.name}</th>
                    <td className="ns-num ns-c-age" data-unit={tx(NS.years)}>{number(c.age)}</td>
                    <td className="ns-c-course" dir="auto">{c.course}</td>
                    <td className="ns-c-teacher" dir="auto">{c.teacher.name}</td>
                    <td className="ns-num ns-c-price" data-label={tx(TR.packagePrice)}>{money(c.packagePrice)}</td>
                    <td className="ns-num ns-c-price" data-label={tx(TR.lessonPrice)}>{money(c.lessonPrice)}</td>
                    <td className="ns-c-slots">
                      <ul className="ns-slots">
                        {c.schedule.map((x) => (
                          <li key={`${x.weekday}@${x.time}`} className="ns-slot">
                            <span>{tx(WEEKDAY[x.weekday] ?? { en: String(x.weekday), ar: String(x.weekday) })}</span>
                            <span className="ns-slot__time">{formatClock(x.time, locale)}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DetailSection>
      </div>
    </article>
  )
}

/** PD-45: "Egypt · Giza" / "مصر · الجيزة" from the names the server sent, or a dash for a form that has none. */
function formLocationText(location: NewStudentDto['parent']['location'], locale: 'ar' | 'en') {
  if (!location) return <span className="ts-muted">—</span>
  const { country, subdivision } = location.names
  const name = (n: { ar: string; en: string }) => (locale === 'ar' ? n.ar : n.en)
  return <bdi>{subdivision ? `${name(country)} · ${name(subdivision)}` : name(country)}</bdi>
}

function EditSubscriptionDialog({ student, onClose }: { student: NewStudentDto; onClose: () => void }) {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const [draft, setDraft] = useState<SubscriptionDraft>(() => draftFrom(student))
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const op = useTrialOp((f: () => Promise<unknown>) => f())
  const save = async () => {
    setTried(true)
    if (formErrors(draft).length > 0 || op.isPending) return
    setError(null)
    try {
      await op.mutateAsync(() => trialsApi.updateSubscription(student.trialId, toInput(draft)))
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <Dialog
      title={`${tx(TR.editForm)} — ${student.parent.name}`}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={op.isPending} onClick={() => void save()}>{tx(TR.save)}</button>
        </>
      }
    >
      <SubscriptionForm value={draft} onChange={setDraft} showErrors={tried} />
      {error !== null && <div className="banner banner--danger" role="alert">{describeOpsError(error, locale)}</div>}
    </Dialog>
  )
}
