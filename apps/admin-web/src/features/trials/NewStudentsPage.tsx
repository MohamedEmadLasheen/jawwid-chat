import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { TrialPaymentsDialog } from '@/features/payments/TrialPaymentsDialog'
import { PAY } from '@/features/payments/copy'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { Pair } from '../teachers/copy'
import { describeOpsError } from '../teachers/opsCopy'
import { trialsApi, type NewStudentDto } from './api'
import { TrialsAreaTabs, useTrialsAccess } from './area'
import { PAYMENT_METHOD, TR, WEEKDAY, formatMoney, formatWhen } from './copy'
import { useNewStudents, useTrialOp } from './hooks'
import { SubscriptionForm, draftFrom, formErrors, toInput, type SubscriptionDraft } from './SubscriptionForm'
import { NewStudentSetup } from './NewStudentSetup'
import '../teachers/teachers.css'
import './trials.css'

/**
 * The New Students page (trial journey): every family that subscribed after a
 * trial, exactly as Sales recorded it in Chat -- the parent, each child with
 * their course, teacher, prices and weekly times, and the payment. These
 * details live here only; the trial group was told "The student has
 * subscribed." and nothing more. Operations, Sales and the super admin read
 * it; Sales may correct a typo.
 */
export function NewStudentsPage() {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const q = useNewStudents()
  const access = useTrialsAccess()
  const [editing, setEditing] = useState<NewStudentDto | null>(null)
  const [paying, setPaying] = useState<NewStudentDto | null>(null)
  const { staff } = useSession()
  const students = q.data?.students ?? []
  // PD-27: before Assign, Sales, the Operations Manager (who assigns) and the
  // super admin ask for the subscription payment. The server decides each request.
  const mayRequestPayment = access.sales || q.data?.canAssign === true || (staff !== null && isSuperAdmin(staff.role))

  return (
    <div className="page">
      <div className="page__inner">
        <TrialsAreaTabs />
        <PageHeader title={tx(TR.newTitle)} subtitle={tx(TR.newSubtitle)} />
        <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          {students.length === 0 ? (
            <EmptyState title={tx(TR.nothingNew)} />
          ) : (
            <div className="tj-students">
              {students.map((s) => (
                <StudentCard
                  key={s.trialId}
                  s={s}
                  canAssign={q.data?.canAssign === true}
                  // PD-16: a form that became a family is frozen.
                  onEdit={access.sales && !s.enrolment ? () => setEditing(s) : undefined}
                  onPayments={mayRequestPayment && !s.enrolment ? () => setPaying(s) : undefined}
                />
              ))}
            </div>
          )}
        </QueryBoundary>
        {editing && <EditSubscriptionDialog student={editing} onClose={() => setEditing(null)} />}
        {paying && <TrialPaymentsDialog trialId={paying.trialId} name={paying.parent.name} onClose={() => setPaying(null)} />}
      </div>
    </div>
  )
}

function StudentCard({ s, onEdit, onPayments, canAssign }: { s: NewStudentDto; onEdit?: () => void; onPayments?: () => void; canAssign: boolean }) {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const money = (n: number) => formatMoney(n, s.payment.currency, locale)
  return (
    <article className="card tj-student" aria-labelledby={`ns-${s.trialId}`}>
      <div className="tj-student__head">
        <h2 id={`ns-${s.trialId}`} className="tj-student__title" dir="auto">{s.parent.name}</h2>
        <span className="ts-muted tj-student__meta">
          {tx(TR.trialOn)}: <span dir="auto">{s.prospectName}</span>
          {s.trialTeacher && <> · {s.trialTeacher.name}</>}
          {s.trialAt && <> · {formatWhen(s.trialAt, locale)}</>}
        </span>
        {onEdit && (
          <button type="button" className="btn btn--sm" onClick={onEdit}>{tx(TR.editForm)}</button>
        )}
        {onPayments && (
          <button type="button" className="btn btn--sm" onClick={onPayments}>{tx(PAY.trialAction)}</button>
        )}
      </div>

      <dl className="tj-facts">
        <div>
          <dt>{tx(TR.parentPhone)}</dt>
          <dd dir="ltr">{s.parent.phone}</dd>
        </div>
        <div>
          <dt>{tx(TR.email)}</dt>
          <dd dir="ltr">{s.parent.email ?? '—'}</dd>
        </div>
        <div>
          <dt>{tx(TR.currency)}</dt>
          <dd>{s.payment.currency}</dd>
        </div>
        <div>
          <dt>{tx(TR.paymentMethod)}</dt>
          <dd>{tx(PAYMENT_METHOD[s.payment.method] ?? { en: s.payment.method, ar: s.payment.method })}</dd>
        </div>
      </dl>

      <div className="table-wrap">
        <table className="table ts-plain-rows">
          <caption className="sr-only">{tx(TR.childrenSection)}</caption>
          <thead>
            <tr>
              <th scope="col">{tx(TR.childName)}</th>
              <th scope="col">{tx(TR.childAge)}</th>
              <th scope="col">{tx(TR.course)}</th>
              <th scope="col">{tx(TR.assignedTeacher)}</th>
              <th scope="col">{tx(TR.packagePrice)}</th>
              <th scope="col">{tx(TR.lessonPrice)}</th>
              <th scope="col">{tx(TR.schedule)}</th>
            </tr>
          </thead>
          <tbody>
            {s.children.map((c, i) => (
              <tr key={i}>
                <th scope="row" dir="auto">{c.name}</th>
                <td>{c.age}</td>
                <td dir="auto">{c.course}</td>
                <td>{c.teacher.name}</td>
                <td>{money(c.packagePrice)}</td>
                <td>{money(c.lessonPrice)}</td>
                <td>
                  <ul className="tj-schedule-list">
                    {c.schedule.map((x) => (
                      <li key={`${x.weekday}@${x.time}`}>{tx(WEEKDAY[x.weekday] ?? { en: String(x.weekday), ar: String(x.weekday) })} <span dir="ltr">{x.time}</span></li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewStudentSetup s={s} canAssign={canAssign} />

      <p className="ts-muted tj-student__meta">
        {tx(TR.recordedBy)} {s.recordedBy.name} · {formatWhen(s.recordedAt, locale)}
        {s.updatedAt && <> · {tx(TR.updated)} {formatWhen(s.updatedAt, locale)}</>}
      </p>
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
