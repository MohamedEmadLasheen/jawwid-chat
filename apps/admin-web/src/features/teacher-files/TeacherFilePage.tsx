import { useCallback, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { PageHeader } from '@/shared/components/PageHeader'
import { QueryBoundary } from '@/shared/components/States'
import type { Complaint, EntryBrief, TeacherFile, TeacherHistoryEvent } from './api'
import { HISTORY_ACTION, T, useCopy } from './copy'
import { useCalendarDate } from './calendar'
import { Refusal, isTeacherFileRefusal } from './Refusal'
import { useReissueFirstLogin, useTeacherFile, useTeacherHistory } from './hooks'
import { FirstLoginCodeDialog, GiveSignInDialog } from './AddTeacherDialog'
import { AddEntryDialog, EditPersonalDialog, type EntryIntent } from './TeacherFileDialogs'
import { AwayBadge, ComplaintItem, UpholdDialog } from './Complaint'
import { SupervisionTimeline } from './SupervisionTimeline'
import { EvaluationsSection } from './Evaluations'
import { EmploymentSection, FinancialSummarySection, HistorySection, usePayroll } from './Payroll'
import { MonthlyKpis, TeacherScheduleSection, currentMonth, teacherAreaLinks, type TeacherWorkLinks } from './TeacherWork'
import { ShiftSection } from '@/features/schedule/ShiftSection'
import './teacher-files.css'
import { studentPath } from '@/features/profiles/api'
import { OpenSupervisionButton, TeacherLeaveSection } from '@/features/supervision/TeacherLeaveSection'
import { OpenCaseButton } from '@/features/cases/OpenCaseDialog'
import { OffboardButton, ReactivateButton } from './Offboarding'

/**
 * PD-10: one teacher's file. Sections in the order the owner listed them;
 * the ones that wait on PD-9 or on Jawwid Core say so instead of showing a
 * plausible zero. Which controls appear comes from the server's `access`.
 */
export function TeacherFilePage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const { teacherId = '' } = useParams<{ teacherId: string }>()
  const tx = useCopy()
  const file = useTeacherFile(teacherId)
  const [editing, setEditing] = useState(false)
  const [intent, setIntent] = useState<EntryIntent | null>(null)
  const data = file.data
  const links = teacherAreaLinks(basePath)

  return (
    <div className="page">
      <div className="page__inner">
        <p className="tf-back">
          <Link to={basePath}>{tx(T.back)}</Link>
        </p>
        {isTeacherFileRefusal(file.error) ? (
          <Refusal error={file.error} />
        ) : (
          <QueryBoundary isLoading={file.isLoading} error={file.error} onRetry={() => void file.refetch()}>
            {data && (
              <>
                <PageHeader
                  eyebrow={eyebrow}
                  title={data.teacher.name}
                  status={
                    <>
                      <Badge tone={data.teacher.isActive ? 'ok' : 'outline'} dot>
                        {tx(data.teacher.isActive ? T.active : T.inactive)}
                      </Badge>
                      <AwayBadge away={data.teacher.away} />
                      <SignInBadge status={data.signIn?.status} />
                    </>
                  }
                  actions={
                    data.access.canWriteSupervision ? (
                      <>
                        {/* Mounted whatever the file says: a code shown once must outlive the reload. */}
                        <GiveSignInButton show={!!data.signIn?.canGive} teacherId={data.teacher.id} basePath={basePath} />
                        {data.signIn?.canSendCode && <SendCodeButton teacherId={data.teacher.id} />}
                        {data.teacher.isActive && <OpenSupervisionButton teacherId={data.teacher.id} />}
                        {/* PD-35 B5: escalate about this teacher (the server checks the scope). */}
                        <OpenCaseButton subject={{ kind: 'teacher', id: data.teacher.id }} target="teachers" />
                        {/* PD-43 PR-1b: the server says who may (the routes re-check). */}
                        <ReactivateButton
                          show={!!data.onboarding?.canReactivate && !data.teacher.isActive}
                          teacherId={data.teacher.id}
                          name={data.teacher.name}
                        />
                        <OffboardButton
                          show={!!data.onboarding?.canOffboard && data.teacher.isActive}
                          teacherId={data.teacher.id}
                          name={data.teacher.name}
                        />
                      </>
                    ) : undefined
                  }
                />
                <FileSections file={data} links={links} onEdit={() => setEditing(true)} onAdd={setIntent} />
                {editing && <EditPersonalDialog file={data} onClose={() => setEditing(false)} />}
                {intent && <AddEntryDialog teacherId={data.teacher.id} intent={intent} onClose={() => setIntent(null)} />}
              </>
            )}
          </QueryBoundary>
        )}
      </div>
    </div>
  )
}

/** The sections in the order the owner listed them (2026-10-21); the timeline closes the file. */
function FileSections({
  file,
  links,
  onEdit,
  onAdd,
}: {
  file: TeacherFile
  links?: TeacherWorkLinks
  onEdit: () => void
  onAdd: (i: EntryIntent) => void
}) {
  const payroll = usePayroll(file)
  return (
    <>
      <SetupChecklist file={file} />
      <Personal file={file} onEdit={onEdit} />
      <EmploymentSection file={file} payroll={payroll} onEdit={onEdit} />
      <Students file={file} />
      {/* PD-38: category and shift, effective-dated. */}
      <ShiftSection teacherId={file.teacher.id} />
      <TeacherScheduleSection teacherId={file.teacher.id} links={links} />
      <Monthly file={file} onAdd={onAdd} links={links} />
      <Complaints file={file} onAdd={onAdd} />
      {/* PD-35: evaluations and improvement plans; the teacher sees them once shared. */}
      <EvaluationsSection teacherId={file.teacher.id} canWrite={file.access.canWriteSupervision} canEditCriteria={file.access.canEditPersonal} />
      {/* PD-18: the super admin and the Teachers manager (PD-43); the server re-checks every route. */}
      <FinancialSummarySection payroll={payroll} />
      <HistorySection kind="bonus" file={file} payroll={payroll} />
      <HistorySection kind="deduction" file={file} payroll={payroll} />
      <DaysOff file={file} onAdd={onAdd} />
      {/* PD-12: the manager (and super admin) edit the record; the same two set the allowance. */}
      <TeacherLeaveSection teacherId={file.teacher.id} canSetAllowance={file.access.canEditPersonal} />
      {/* PD-43: the teacher's and their login's lifecycle. */}
      <LifecycleHistory teacherId={file.teacher.id} />
      {/* PD-11's timeline: every record about the teacher in one line, plus notes and the bonus ticket. */}
      <SupervisionTimeline teacherId={file.teacher.id} canWrite={file.access.canWriteSupervision} />
      {payroll.dialogs}
    </>
  )
}

function Section({
  id,
  title,
  action,
  hint,
  children,
}: {
  id: string
  title: string
  action?: ReactNode
  hint?: string
  children: ReactNode
}) {
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

const SETUP_STEPS = [
  ['signedIn', T.stepSignedIn],
  ['supervisor', T.stepSupervisor],
  ['contact', T.stepContact],
  ['payTerms', T.stepPayTerms],
  ['payoutAccount', T.stepPayoutAccount],
  ['leaveAllowance', T.stepLeaveAllowance],
  ['shift', T.stepShift],
  ['availability', T.stepAvailability],
  ['profile', T.stepProfile],
] as const

/** PD-43: what is still to set up for an active teacher, read live; gone once everything is done. */
function SetupChecklist({ file }: { file: TeacherFile }) {
  const tx = useCopy()
  const { number } = useI18n()
  const setup = file.setup
  if (!setup || !file.teacher.isActive || (setup.missing === 0 && setup.payMatchesShift)) return null
  return (
    <Section
      id="tf-setup"
      title={tx(T.setupTitle)}
      action={
        <Badge tone="warn">{setup.missing === 1 ? tx(T.oneStepLeft) : tx(T.stepsLeft, { n: number(setup.missing) })}</Badge>
      }
    >
      <ul className="tf-setup">
        {SETUP_STEPS.map(([key, label]) => (
          <li key={key}>
            <span>{tx(label)}</span>
            <Badge tone={setup[key] ? 'ok' : 'outline'} dot>
              {tx(setup[key] ? T.done : T.stepNotDone)}
            </Badge>
          </li>
        ))}
      </ul>
      {!setup.payMatchesShift && (
        <p className="banner banner--warn" role="note">
          {tx(T.payMismatch)}
        </p>
      )}
    </Section>
  )
}

/** PD-43: added, sign-in, supervisor, offboarded, reactivated -- newest first, with who and why. */
function LifecycleHistory({ teacherId }: { teacherId: string }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const history = useTeacherHistory(teacherId)
  const events = history.data?.events
  const what = (e: TeacherHistoryEvent) => {
    if (e.action === 'teacher_supervisor.assigned') {
      return tx(T.historySupervisorChanged, { from: e.detail.from?.name ?? tx(T.historyNone), to: e.detail.to?.name ?? tx(T.historyNone) })
    }
    const label = HISTORY_ACTION[e.action]
    return label ? tx(label) : e.action
  }
  // No staff member: the teacher themselves for their own sign-in, the system otherwise.
  const who = (e: TeacherHistoryEvent) =>
    e.actor?.name ?? tx(e.action === 'account.activated' || e.action === 'account.password_reset_completed' ? T.historyByTeacher : T.historyAutomatic)
  return (
    <Section id="tf-history" title={tx(T.historyTitle)}>
      <QueryBoundary isLoading={history.isLoading} error={history.error} onRetry={() => void history.refetch()}>
        {events && events.length === 0 && <p className="tf-muted">{tx(T.historyEmpty)}</p>}
        {events && events.length > 0 && (
          <ul className="tf-history">
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <strong dir="auto">{what(e)}</strong>
                <span className="tf-byline">
                  {' '}
                  · <bdi>{who(e)}</bdi> · {dateTime(e.at)}
                </span>
                {e.reason && (
                  <span className="tf-muted" dir="auto">
                    {' '}
                    · {e.reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </Section>
  )
}

function Byline({ entry }: { entry: EntryBrief }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  return <span className="tf-byline">{tx(T.by, { name: entry.author.name, date: dateTime(entry.createdAt) })}</span>
}

function Personal({ file, onEdit }: { file: TeacherFile; onEdit: () => void }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const cal = useCalendarDate()
  const p = file.personal
  const missing = <span className="tf-muted">{tx(T.notRecorded)}</span>
  return (
    <Section
      id="tf-personal"
      title={tx(T.personal)}
      action={
        file.access.canEditPersonal && (
          <button type="button" className="btn btn--sm" onClick={onEdit} aria-label={tx(T.editPersonal)}>
            {tx(T.edit)}
          </button>
        )
      }
    >
      <dl className="tf-kv">
        <dt>{tx(T.fullName)}</dt>
        <dd><bdi>{p.fullName}</bdi></dd>
        <dt>{tx(T.phone)}</dt>
        {/* The value is LTR; the cell keeps the page direction, so it sits beside its label. */}
        <dd>{p.phone ? <bdi dir="ltr">{p.phone}</bdi> : missing}</dd>
        <dt>{tx(T.email)}</dt>
        <dd>{p.email ? <bdi dir="ltr">{p.email}</bdi> : missing}</dd>
        <dt>{tx(T.joinedOn)}</dt>
        <dd>{p.joinedOn ? cal.day(p.joinedOn) : missing}</dd>
      </dl>
      {p.updatedBy && p.updatedAt && (
        <p className="tf-byline">
          {tx(T.lastEdit, {
            name: p.updatedBy.name,
            date: dateTime(p.updatedAt),
          })}
        </p>
      )}
    </Section>
  )
}

function Students({ file }: { file: TeacherFile }) {
  const tx = useCopy()
  const rows = file.assignedStudents
  return (
    <Section id="tf-students" title={`${tx(T.assigned)} (${rows.length})`} hint={tx(T.assignedHint)}>
      {rows.length === 0 ? (
        <p className="tf-muted">{tx(T.noStudents)}</p>
      ) : (
        <div className="table-wrap tf-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tx(T.child)}</th>
                <th scope="col">{tx(T.level)}</th>
                <th scope="col">{tx(T.family)}</th>
                <th scope="col">{tx(T.supervisor)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.learnerId}>
                  <td dir="auto">
                    {/* PD-17: the child's Student Profile. */}
                    <Link to={studentPath(s.learnerId)}>{s.name}</Link>
                  </td>
                  <td dir="auto">{s.level ?? tx(T.none)}</td>
                  <td dir="auto">{s.family.displayName}</td>
                  <td dir="auto">{s.supervisor?.name ?? tx(T.none)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function Complaints({ file, onAdd }: { file: TeacherFile; onAdd: (i: EntryIntent) => void }) {
  const tx = useCopy()
  const write = file.access.canWriteSupervision
  const items = file.supervision.complaints
  const [upholding, setUpholding] = useState<Complaint | null>(null)
  return (
    <Section
      id="tf-complaints"
      title={tx(T.complaints)}
      action={
        write && (
          <button type="button" className="btn btn--sm" onClick={() => onAdd({ kind: 'complaint' })}>
            {tx(T.addComplaint)}
          </button>
        )
      }
    >
      {items.length === 0 ? (
        <p className="tf-muted">{tx(T.noComplaints)}</p>
      ) : (
        <ul className="tf-entries">
          {items.map((c) => (
            <ComplaintItem
              key={c.id}
              complaint={c}
              canWrite={write}
              onFollowUp={() => onAdd({ kind: 'complaint_followup', refersTo: c.id })}
              onResolve={() => onAdd({ kind: 'complaint_resolution', refersTo: c.id })}
              onUphold={() => setUpholding(c)}
            />
          ))}
        </ul>
      )}
      {upholding && <UpholdDialog complaint={upholding} onClose={() => setUpholding(null)} />}
    </Section>
  )
}

function Monthly({ file, onAdd, links }: { file: TeacherFile; onAdd: (i: EntryIntent) => void; links?: TeacherWorkLinks }) {
  const tx = useCopy()
  const { number } = useI18n()
  const cal = useCalendarDate()
  const [month, setMonth] = useState(currentMonth)
  const items = file.supervision.monthlyComments
  return (
    <Section
      id="tf-monthly"
      title={tx(T.monthly)}
      action={
        <label className="tf-month">
          <span className="field__label">{tx(T.month)}</span>
          <input
            className="input"
            type="month"
            value={month}
            max={currentMonth()}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            aria-label={tx(T.month)}
          />
        </label>
      }
    >
      <MonthlyKpis teacherId={file.teacher.id} month={month} links={links} />
      <div className="tf-section__head">
        <h3 className="tf-subtitle">{tx(T.comments)}</h3>
        {file.access.canWriteSupervision && (
          <button type="button" className="btn btn--sm" onClick={() => onAdd({ kind: 'monthly_comment' })}>
            {tx(T.addMonthly)}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="tf-muted">{tx(T.noMonthly)}</p>
      ) : (
        <ul className="tf-entries">
          {items.map((m) => (
            <li key={m.month} className="tf-entry">
              <div className="tf-entry__head">
                <strong>{cal.month(m.month)}</strong>
                <Byline entry={m.current} />
                {m.earlierVersions.length > 0 && (
                  <span className="tf-muted">{tx(T.earlierVersions, { n: number(m.earlierVersions.length) })}</span>
                )}
              </div>
              <p className="tf-entry__body" dir="auto">
                {m.current.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function DaysOff({ file, onAdd }: { file: TeacherFile; onAdd: (i: EntryIntent) => void }) {
  const tx = useCopy()
  const cal = useCalendarDate()
  const write = file.access.canWriteSupervision
  const items = file.supervision.daysOff
  return (
    <Section
      id="tf-days-off"
      title={tx(T.daysOff)}
      hint={tx(T.daysOffHint)}
      action={
        write && (
          <button type="button" className="btn btn--sm" onClick={() => onAdd({ kind: 'day_off' })}>
            {tx(T.addDayOff)}
          </button>
        )
      }
    >
      {items.length === 0 ? (
        <p className="tf-muted">{tx(T.noDaysOff)}</p>
      ) : (
        <ul className="tf-entries">
          {items.map((d) => (
            <li key={d.id} className="tf-entry">
              <div className="tf-entry__head">
                <strong className={d.cancellation ? 'tf-struck' : undefined}>{cal.day(d.date)}</strong>
                {d.cancellation && <Badge tone="outline">{tx(T.cancelled)}</Badge>}
                <Byline entry={d} />
              </div>
              <p className="tf-entry__body" dir="auto">
                {d.body}
              </p>
              {d.cancellation ? (
                <div className="tf-followup">
                  <p className="tf-entry__body" dir="auto">
                    {d.cancellation.body}
                  </p>
                  <Byline entry={d.cancellation} />
                </div>
              ) : (
                write && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      onAdd({
                        kind: 'day_off_cancellation',
                        refersTo: d.id,
                        date: d.date,
                      })
                    }
                    aria-label={`${tx(T.cancel)} — ${cal.day(d.date)}`}
                  >
                    {tx(T.cancel)}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** PD-43: a login that waits for its first sign-in, or is suspended. Nothing for an active login. */
function SignInBadge({ status }: { status?: string }) {
  const tx = useCopy()
  if (status === 'provisioned') return <Badge tone="warn">{tx(T.notSignedInYet)}</Badge>
  if (status === 'suspended') return <Badge tone="outline">{tx(T.signInSuspended)}</Badge>
  if (status === 'none') return <Badge tone="outline">{tx(T.noSignIn)}</Badge>
  return null
}

/** PD-43: a new first sign-in code; the server decides who may and who sees it. */
function SendCodeButton({ teacherId }: { teacherId: string }) {
  const tx = useCopy()
  const reissue = useReissueFirstLogin(teacherId)
  const answer = reissue.data
  return (
    <>
      <button type="button" className="btn" disabled={reissue.isPending} onClick={() => reissue.mutate()}>
        {reissue.isPending ? tx(T.sending) : tx(T.sendNewCode)}
      </button>
      {answer && <FirstLoginCodeDialog signIn={answer.signIn} firstLogin={answer.firstLogin} onClose={() => reissue.reset()} />}
    </>
  )
}

/** PD-43 Give sign-in, for a teacher who has no login. */
function GiveSignInButton({ show, teacherId, basePath }: { show: boolean; teacherId: string; basePath: string }) {
  const tx = useCopy()
  const [open, setOpen] = useState(false)
  // Stable: the Dialog re-focuses whenever onClose changes.
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      {show && (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {tx(T.giveSignIn)}
        </button>
      )}
      {open && <GiveSignInDialog teacherId={teacherId} basePath={basePath} onClose={close} />}
    </>
  )
}
