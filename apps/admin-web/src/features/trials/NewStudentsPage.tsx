import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { TrialPaymentsDialog, TrialRequestsSummary } from '@/features/payments/TrialPaymentsDialog'
import { PAY } from '@/features/payments/copy'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Badge } from '@/shared/components/Badge'
import { FilterChips, type FilterOption } from '@/shared/components/FilterChips'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
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

/**
 * The New Students page (trial journey): every family that subscribed after a
 * trial, exactly as Sales recorded it in Chat -- the parent, each child with
 * their course, teacher, prices and weekly times, and the payment. These
 * details live here only; the trial group was told "The student has
 * subscribed." and nothing more. Operations, Sales and the super admin read
 * it; Sales may correct a typo.
 */
export function NewStudentsPage() {
  const { locale, number } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const q = useNewStudents()
  const access = useTrialsAccess()
  const [editing, setEditing] = useState<NewStudentDto | null>(null)
  const [paying, setPaying] = useState<NewStudentDto | null>(null)
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
  const searched = students.filter((s) => matchesSearch(s, search))
  const shown = searched.filter((s) => matchesFilter(statuses.get(s.trialId) ?? 'unassigned', filter))
  const count = (f: StatusFilter) => searched.filter((s) => matchesFilter(statuses.get(s.trialId) ?? 'unassigned', f)).length
  const options: Array<FilterOption<StatusFilter>> = [
    { value: 'all', label: tx(NS.all), count: count('all') },
    { value: 'unassigned', label: tx(STATUS.unassigned.label), count: count('unassigned') },
    { value: 'waiting', label: tx(STATUS.waiting.label), count: count('waiting') },
    { value: 'signed_up', label: tx(STATUS.signed_up.label), count: count('signed_up') },
  ]

  return (
    <div className="page">
      <div className="page__inner">
        <TrialsAreaTabs />
        <PageHeader title={tx(TR.newTitle)} subtitle={tx(TR.newSubtitle)} />
        <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          {students.length === 0 ? (
            <EmptyState title={tx(TR.nothingNew)} />
          ) : (
            <>
              <div className="ns-toolbar">
                <label className="search ns-toolbar__search">
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
                <FilterChips options={options} value={filter} onChange={setFilter} label={tx(NS.filterLabel)} formatCount={(n) => number(n)} />
              </div>
              {shown.length === 0 ? (
                <EmptyState title={tx(NS.noMatch)} />
              ) : (
                <div className="ns-list">
                  {shown.map((s) => (
                    <StudentCard
                      key={s.trialId}
                      s={s}
                      status={statuses.get(s.trialId) ?? 'unassigned'}
                      canAssign={q.data?.canAssign === true}
                      // PD-16: a form that became a family is frozen.
                      onEdit={access.sales && !s.enrolment ? () => setEditing(s) : undefined}
                      onPayments={mayRequestPayment ? () => setPaying(s) : undefined}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </QueryBoundary>
        {/* PD-42 PR-3: the families supervisors entered by hand, to whoever owns them (the server's answer). */}
        <EnteredFamilies />
        {editing && <EditSubscriptionDialog student={editing} onClose={() => setEditing(null)} />}
        {paying && <TrialPaymentsDialog trialId={paying.trialId} name={paying.parent.name} onClose={() => setPaying(null)} />}
      </div>
    </div>
  )
}

/**
 * PD-32: one family, read top to bottom -- who (the parent, the status, who
 * recorded it), the trial it came from, then three blocks side by side
 * (contact, payment, setup) and the children in one aligned table.
 */
function StudentCard({
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
  return (
    <article className="card ns-card" aria-labelledby={headingId}>
      <header className="ns-card__head">
        <div className="ns-card__who">
          <div className="ns-card__title-row">
            <h2 id={headingId} className="ns-card__title" dir="auto">{s.parent.name}</h2>
            <Badge tone={STATUS[status].tone} dot>{tx(STATUS[status].label)}</Badge>
          </div>
          <p className="ns-card__byline">
            {tx(NS.recorded)} <span dir="auto">{s.recordedBy.name}</span> · <time dateTime={s.recordedAt}>{formatWhen(s.recordedAt, locale)}</time>
            {s.updatedAt && (
              <> · {tx(NS.updated)} <time dateTime={s.updatedAt}>{formatWhen(s.updatedAt, locale)}</time></>
            )}
          </p>
        </div>
        {(onEdit || onPayments) && (
          <div className="ns-card__actions">
            {onEdit && <button type="button" className="btn btn--sm" onClick={onEdit}>{tx(TR.editForm)}</button>}
            {onPayments && <button type="button" className="btn btn--sm" onClick={onPayments}>{tx(PAY.trialAction)}</button>}
          </div>
        )}
      </header>

      <p className="ns-card__trial">
        <Icon name="calendar" size={14} />
        <span className="ns-card__trial-label">{tx(NS.trial)}</span>
        <span dir="auto">{s.prospectName}</span>
        {s.trialTeacher && <><span aria-hidden="true">·</span><span dir="auto">{s.trialTeacher.name}</span></>}
        {s.trialAt && <><span aria-hidden="true">·</span><time dateTime={s.trialAt}>{formatWhen(s.trialAt, locale)}</time></>}
      </p>

      <div className="ns-card__blocks">
        <section className="ns-block" aria-label={tx(NS.contact)}>
          <h3 className="ns-block__title">{tx(NS.contact)}</h3>
          <dl className="ns-pairs">
            <div>
              <dt>{tx(TR.parentPhone)}</dt>
              <dd><bdi dir="ltr" className="ns-ltr">{s.parent.phone}</bdi></dd>
            </div>
            <div>
              <dt>{tx(TR.email)}</dt>
              <dd>{s.parent.email ? <bdi dir="ltr" className="ns-ltr">{s.parent.email}</bdi> : <span className="ts-muted">—</span>}</dd>
            </div>
          </dl>
        </section>
        <section className="ns-block" aria-label={tx(NS.payment)}>
          <h3 className="ns-block__title">{tx(NS.payment)}</h3>
          <dl className="ns-pairs">
            <div>
              <dt>{tx(TR.paymentMethod)}</dt>
              <dd>{tx(PAYMENT_METHOD[s.payment.method] ?? { en: s.payment.method, ar: s.payment.method })}</dd>
            </div>
            <div>
              <dt>{tx(TR.currency)}</dt>
              <dd>{currencyName(s.payment.currency, locale)}</dd>
            </div>
          </dl>
          {onPayments && <TrialRequestsSummary trialId={s.trialId} />}
        </section>
        <NewStudentSetup s={s} canAssign={canAssign} />
      </div>

      <section className="ns-children" aria-labelledby={`${headingId}-children`}>
        <h3 id={`${headingId}-children`} className="ns-block__title">
          {tx(NS.children)} <span className="ns-count">{number(s.children.length)}</span>
        </h3>
        <div className="table-wrap">
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
                  <th scope="row" dir="auto">{c.name}</th>
                  <td className="ns-num">{number(c.age)}</td>
                  <td dir="auto">{c.course}</td>
                  <td dir="auto">{c.teacher.name}</td>
                  <td className="ns-num">{money(c.packagePrice)}</td>
                  <td className="ns-num">{money(c.lessonPrice)}</td>
                  <td>
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
      </section>
    </article>
  )
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
