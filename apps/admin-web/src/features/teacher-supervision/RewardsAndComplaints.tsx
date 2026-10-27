import { useId, useState } from 'react'
import { ApiError } from '@/core/api/errors'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { teacherFilePath } from '@/features/supervision/TeachersTabs'
import { describeError as describeDiscipline } from '@/features/discipline/copy'
import { useViolations } from '@/features/discipline/hooks'
import { DecideDialog } from '@/features/discipline/DisciplineDialogs'
import { describeError } from '@/features/teacher-files/copy'
import { useTeacherList } from '@/features/teacher-files/hooks'
import { useMoney } from '@/features/teacher-files/Payroll'
import { ComplaintItem, UpholdDialog } from '@/features/teacher-files/Complaint'
import { AddEntryDialog, type EntryIntent } from '@/features/teacher-files/TeacherFileDialogs'
import type { ComplaintSource } from '@/features/teacher-files/api'
import type { SupervisedComplaint } from './api'
import { H, useCopy } from './copy'
import { useDeductionDefaults, useRecordReward, useRewards, useSetDeductionDefault, useSupervisedComplaints } from './hooks'
import { SectionIntro } from './SectionIntro'

const MONEY = /^\d{1,10}(\.\d{1,2})?$/

// ---------------------------------------------------------------------------
// 4. Grants and rewards
// ---------------------------------------------------------------------------

export function RewardsSection({ basePath }: { basePath: string }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const money = useMoney()
  const list = useRewards()
  const [recording, setRecording] = useState(false)
  const canViewAmounts = list.data?.canViewAmounts ?? false
  const rows = list.data?.rewards ?? []
  return (
    <>
      <SectionIntro
        hint={tx(H.rewardsHint)}
        actions={
          <button type="button" className="btn btn--sm" onClick={() => setRecording(true)}>
            {tx(H.recordReward)}
          </button>
        }
      />
      {list.error ? (
        <EmptyState icon="lock" title={describeError(list.error, locale)} />
      ) : (
        <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
          {rows.length === 0 ? (
            <EmptyState title={tx(H.empty)} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{tx(H.teacher)}</th>
                    <th scope="col">{tx(H.reason)}</th>
                    {canViewAmounts && <th scope="col">{tx(H.amount)}</th>}
                    <th scope="col">{tx(H.date)}</th>
                    <th scope="col">{tx(H.recordedBy)}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td dir="auto">
                        <Link to={teacherFilePath(basePath, r.teacher.id)}>{r.teacher.name}</Link>
                      </td>
                      <td dir="auto">{r.reason}</td>
                      {canViewAmounts && (
                        <td>{r.amount ? money(r.amount.amount, r.amount.currency) : <span className="th-muted">{tx(H.awaitingAmount)}</span>}</td>
                      )}
                      <td>{dateTime(r.recordedAt)}</td>
                      <td dir="auto">{r.recordedBy.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryBoundary>
      )}
      {canViewAmounts && <DeductionDefaults />}
      {recording && <RewardDialog withAmount={canViewAmounts} onClose={() => setRecording(false)} />}
    </>
  )
}

function RewardDialog({ withAmount, onClose }: { withAmount: boolean; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const teachers = useTeacherList()
  const record = useRecordReward()
  const teacherId = useId()
  const reasonId = useId()
  const amountId = useId()
  const [teacher, setTeacher] = useState('')
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [touched, setTouched] = useState(false)
  const missing = { teacher: !teacher, reason: !reason.trim(), amount: amount.trim() !== '' && !MONEY.test(amount.trim()) }

  return (
    <Dialog
      title={tx(H.recordReward)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={record.isPending}
            onClick={() => {
              setTouched(true)
              if (missing.teacher || missing.reason || missing.amount) return
              // With an amount, ONE request records the reward and prices it (PD-26):
              // a refusal (no pay terms that month) records nothing at all.
              record.mutate(
                { teacherId: teacher, reason: reason.trim(), ...(withAmount && amount.trim() ? { amount: amount.trim() } : {}) },
                { onSuccess: onClose },
              )
            }}
          >
            {record.isPending ? '…' : tx(H.recordReward)}
          </button>
        </>
      }
    >
      <p className="field__hint">{tx(H.rewardsHint)}</p>
      <div className="field">
        <label className="field__label" htmlFor={teacherId}>
          {tx(H.teacher)}
        </label>
        <select id={teacherId} className="input" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
          <option value="">—</option>
          {(teachers.data?.teachers ?? [])
            .filter((t) => t.isActive)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
        {touched && missing.teacher && <span className="field__error">{tx(H.teacher)}</span>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={reasonId}>
          {tx(H.reason)}
        </label>
        <textarea id={reasonId} className="input" rows={3} dir="auto" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
        {touched && missing.reason && <span className="field__error">{tx(H.reason)}</span>}
      </div>
      {withAmount && (
        <div className="field">
          <label className="field__label" htmlFor={amountId}>
            {tx(H.amountOptional)}
          </label>
          <input id={amountId} className="input" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="field__hint">{tx(H.amountHint)}</span>
          {touched && missing.amount && <span className="field__error">{tx(H.amountInvalid)}</span>}
        </div>
      )}
      {record.error ? (
        <div className="banner banner--danger" role="alert">
          {/* With an amount, the one conflict a new reward meets is a month with no pay terms (PD-26). */}
          {record.error instanceof ApiError && record.error.code === 'COMM.TEACHER_FILE_CONFLICT' && withAmount
            ? tx(H.rewardNoTerms)
            : describeError(record.error, locale)}
        </div>
      ) : null}
    </Dialog>
  )
}

/** The super admin's default deduction amounts, per currency (PD-26). */
function DeductionDefaults() {
  const tx = useCopy()
  const { locale } = useI18n()
  const money = useMoney()
  const defaults = useDeductionDefaults(true)
  const save = useSetDeductionDefault()
  const [extra, setExtra] = useState('')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const currencies = [...new Set([...(defaults.data?.currencies ?? []), ...(/^[A-Z]{3}$/.test(extra) ? [extra] : [])])]
  if (defaults.error) return null
  const current = (kind: 'deduction_1' | 'deduction_2', currency: string) =>
    defaults.data?.defaults.find((d) => d.kind === kind && d.currency === currency) ?? null

  return (
    <section className="card panel th-defaults" aria-labelledby="th-defaults">
      <h2 id="th-defaults" className="th-subtitle">
        {tx(H.defaultsTitle)}
      </h2>
      <p className="field__hint">{tx(H.defaultsHint)}</p>
      {currencies.length === 0 && <p className="th-muted">{tx(H.noCurrencies)}</p>}
      {currencies.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tx(H.currency)}</th>
                <th scope="col">{tx(H.first)}</th>
                <th scope="col">{tx(H.second)}</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((cur) => (
                <tr key={cur}>
                  <td dir="ltr">{cur}</td>
                  {(['deduction_1', 'deduction_2'] as const).map((kind) => {
                    const key = `${kind}|${cur}`
                    const value = draft[key] ?? ''
                    const now = current(kind, cur)
                    return (
                      <td key={kind}>
                        <div className="th-default-cell">
                          <span>{now ? money(now.amount, cur) : <span className="th-muted">{tx(H.notSet)}</span>}</span>
                          <input
                            className="input th-amount"
                            inputMode="decimal"
                            dir="ltr"
                            aria-label={`${tx(kind === 'deduction_1' ? H.first : H.second)} ${cur}`}
                            value={value}
                            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="btn btn--sm"
                            disabled={save.isPending || !MONEY.test(value.trim())}
                            onClick={() =>
                              save.mutate(
                                { kind, currency: cur, amount: value.trim() },
                                { onSuccess: () => setDraft((d) => ({ ...d, [key]: '' })) },
                              )
                            }
                          >
                            {tx(H.set)}
                          </button>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <label className="field th-currency">
        <span className="field__label">{tx(H.addCurrency)}</span>
        <input className="input" dir="ltr" maxLength={3} value={extra} onChange={(e) => setExtra(e.target.value.toUpperCase())} />
      </label>
      {save.error ? (
        <div className="banner banner--danger" role="alert">
          {describeError(save.error, locale)}
        </div>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 5. Complaints
// ---------------------------------------------------------------------------

type Source = 'all' | ComplaintSource

export function ComplaintsSection() {
  const tx = useCopy()
  const { locale } = useI18n()
  const [source, setSource] = useState<Source>('all')
  const list = useSupervisedComplaints(source === 'all' ? undefined : source)
  // An upheld complaint is decided like any violation: find the one waiting for it.
  const waiting = useViolations({ state: 'open', kind: 'complaints' })
  const [intent, setIntent] = useState<{ teacherId: string | null; intent: EntryIntent } | null>(null)
  const [upholding, setUpholding] = useState<SupervisedComplaint | null>(null)
  const [deciding, setDeciding] = useState<string | null>(null)
  const canWrite = list.data?.access.canWriteSupervision ?? false
  const rows = list.data?.complaints ?? []
  const violation = deciding ? (waiting.data?.violations ?? []).find((v) => v.complaint?.id === deciding) : undefined

  return (
    <>
      <SectionIntro
        hint={tx(H.complaintsHint)}
        actions={
          canWrite && (
            <button
              type="button"
              className="btn btn--sm"
              // Staff record management or parent complaints; an app complaint is the parent's own (PD-32).
              onClick={() =>
                setIntent({ teacherId: null, intent: { kind: 'complaint', ...(source === 'management' || source === 'parent' ? { source } : {}) } })
              }
            >
              {tx(H.recordComplaint)}
            </button>
          )
        }
      />
      <div className="toolbar">
        <FilterChips<Source>
          label={tx(H.complaints)}
          value={source}
          onChange={setSource}
          options={[
            { value: 'all', label: tx(H.all) },
            { value: 'management', label: tx(H.fromManagement) },
            { value: 'parent', label: tx(H.fromParents) },
            { value: 'parent_app', label: tx(H.fromParentApp) },
          ]}
        />
      </div>
      {list.error ? (
        <EmptyState icon="lock" title={describeError(list.error, locale)} />
      ) : (
        <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
          {rows.length === 0 ? (
            <EmptyState title={tx(H.empty)} />
          ) : (
            <ul className="tf-entries th-complaints">
              {rows.map((c) => (
                <ComplaintItem
                  key={c.id}
                  complaint={c}
                  teacherName={c.teacher.name}
                  canWrite={canWrite}
                  onFollowUp={() => setIntent({ teacherId: c.teacher.id, intent: { kind: 'complaint_followup', refersTo: c.id } })}
                  onResolve={() => setIntent({ teacherId: c.teacher.id, intent: { kind: 'complaint_resolution', refersTo: c.id } })}
                  onUphold={() => setUpholding(c)}
                  onDecide={() => setDeciding(c.id)}
                />
              ))}
            </ul>
          )}
        </QueryBoundary>
      )}
      {intent && <AddEntryDialog teacherId={intent.teacherId} intent={intent.intent} onClose={() => setIntent(null)} />}
      {upholding && <UpholdDialog complaint={upholding} onClose={() => setUpholding(null)} />}
      {deciding && violation && <DecideDialog violation={violation} onClose={() => setDeciding(null)} />}
      {deciding && !violation && waiting.error ? (
        <div className="banner banner--danger" role="alert">
          {describeDiscipline(waiting.error, locale)}
        </div>
      ) : null}
    </>
  )
}
