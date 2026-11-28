import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { STEPS, countLabel } from '@/core/i18n/counts'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { FilterChips } from '@/shared/components/FilterChips'
import { Menu, type MenuItem } from '@/shared/components/Menu'
import { PageHeader } from '@/shared/components/PageHeader'
import { RecordCallout, RecordHighlights, RecordIdentity, useRecordCallout, type FileTab } from './RecordHead'
import { QueryBoundary } from '@/shared/components/States'
import type { Complaint, EntryBrief, TeacherFile, TeacherHistoryEvent } from './api'
import { HISTORY_ACTION, T, useCopy } from './copy'
import { useCalendarDate } from './calendar'
import { Refusal, isTeacherFileRefusal } from './Refusal'
import { useReissueFirstLogin, useTeacherFile, useTeacherHistory } from './hooks'
import { FirstLoginCodeDialog, GiveSignInDialog } from './AddTeacherDialog'
import { AddEntryDialog, EditPersonalDialog, type EntryIntent } from './TeacherFileDialogs'
import { ComplaintItem, UpholdDialog } from './Complaint'
import { SupervisionTimeline } from './SupervisionTimeline'
import { EvaluationsSection } from './Evaluations'
import { EmploymentSection, FinancialSummarySection, HistorySection, usePayroll } from './Payroll'
import { MonthlyKpis, TeacherScheduleSection, currentMonth, teacherAreaLinks, type TeacherWorkLinks } from './TeacherWork'
import { ShiftSection } from '@/features/schedule/ShiftSection'
import './teacher-files.css'
import '@/features/teachers/stack-table.css'
import { MonthPicker } from '@/features/teachers/MonthPicker'
import { studentPath } from '@/features/profiles/api'
import { OpenSupervisionButton, TeacherLeaveSection } from '@/features/supervision/TeacherLeaveSection'
import { OpenCaseButton } from '@/features/cases/OpenCaseDialog'
import { OffboardButton, ReactivateButton } from './Offboarding'
import { DeletionRequestBanner } from './DeletionRequest'
import { ChangeSignInButton } from './ChangeSignIn'
import { By } from './Byline'
import { LessonReports } from './LessonReports'

const FILE_TABS: readonly FileTab[] = ['overview', 'students', 'schedule', 'pay', 'leave', 'evaluations', 'records']

/**
 * PD-10: one teacher's file, as a record. The masthead says who this is, what
 * stands open about them and the one thing to do next; the rest of the file
 * is behind its tabs (`?tab=`), each a short page, instead of one long scroll.
 * Which controls appear comes from the server's `access`.
 */
export function TeacherFilePage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const { teacherId = '' } = useParams<{ teacherId: string }>()
  const tx = useCopy()
  const file = useTeacherFile(teacherId)
  const data = file.data

  if (isTeacherFileRefusal(file.error) || !data) {
    return (
      <div className="page">
        <div className="page__inner">
          <PageHeader back={{ to: basePath, label: tx(T.back) }} eyebrow={eyebrow} title={tx(T.filesTitle)} />
          {isTeacherFileRefusal(file.error) ? (
            <Refusal error={file.error} />
          ) : (
            <QueryBoundary isLoading={file.isLoading} error={file.error} onRetry={() => void file.refetch()}>
              {null}
            </QueryBoundary>
          )}
        </div>
      </div>
    )
  }
  return <TeacherRecord data={data} basePath={basePath} />
}

function TeacherRecord({ data, basePath }: { data: TeacherFile; basePath: string }) {
  const tx = useCopy()
  const [editing, setEditing] = useState(false)
  const [intent, setIntent] = useState<EntryIntent | null>(null)
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab') as FileTab | null
  const tab: FileTab = asked && FILE_TABS.includes(asked) ? asked : 'overview'
  const setTab = (next: FileTab) => {
    const p = new URLSearchParams(params)
    if (next === 'overview') p.delete('tab')
    else p.set('tab', next)
    setParams(p, { replace: true })
  }
  // The header's quieter actions keep their own dialogs; the "⋯" menu presses them.
  const proxies = useRef<HTMLDivElement>(null)
  const press = (act: string) => proxies.current?.querySelector<HTMLButtonElement>(`[data-act="${act}"] > button`)?.click()
  const links = teacherAreaLinks(basePath)
  const label: Record<FileTab, string> = {
    overview: tx(T.tabOverview),
    students: tx(T.tabStudents),
    schedule: tx(T.schedule),
    pay: tx(T.tabPay),
    leave: tx(T.tabLeave),
    evaluations: tx(T.tabEvaluations),
    records: tx(T.tabRecords),
  }
  const callout = useRecordCallout(data, {
    setup: () => {
      setTab('overview')
      // The checklist is the first sheet of Overview: bring it into view.
      requestAnimationFrame(() => document.getElementById('tf-setup')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }))
    },
    records: () => setTab('records'),
  })

  const canWrite = data.access.canWriteSupervision
  const signIn = data.signIn
  const more: MenuItem[] = canWrite
    ? [
        ...(signIn?.canGive ? [{ key: 'give', label: tx(T.giveSignIn), icon: 'password' as const, onSelect: () => press('give') }] : []),
        ...(signIn?.canSendCode ? [{ key: 'code', label: tx(T.sendNewCode), icon: 'send' as const, onSelect: () => press('code') }] : []),
        ...(signIn?.canChange ? [{ key: 'signin', label: tx(T.changeSignIn), icon: 'mail' as const, onSelect: () => press('signin') }] : []),
        { key: 'case', label: tx(T.escalate), icon: 'alert' as const, onSelect: () => press('case') },
        ...(data.onboarding?.canReactivate && !data.teacher.isActive ? [{ key: 'reactivate', label: tx(T.reactivate), icon: 'undo' as const, onSelect: () => press('reactivate') }] : []),
        ...(data.onboarding?.canOffboard && data.teacher.isActive ? [{ key: 'offboard', label: tx(T.offboard), icon: 'userMinus' as const, danger: true, onSelect: () => press('offboard') }] : []),
      ]
    : []
  const openComplaints = data.supervision.complaints.filter((c) => (c.status ?? (c.resolution ? 'resolved' : 'open')) === 'open').length
  const tabOptions = FILE_TABS.map((t) => ({
    value: t,
    label: label[t],
    count: t === 'students' && data.assignedStudents.length > 0 ? data.assignedStudents.length : t === 'records' && openComplaints > 0 ? openComplaints : undefined,
  }))

  return (
    <div className="page tf-record">
      <div className="page__inner">
        <header className="page-header tf-head">
          <RecordIdentity
            file={data}
            back={{ to: basePath, label: tx(T.back) }}
            actions={
              canWrite ? (
                <>
                  {/* The callout's action is the page's one solid button; otherwise the supervision chat is. */}
                  {data.teacher.isActive && (
                    <OpenSupervisionButton teacherId={data.teacher.id} className={callout?.action ? 'btn' : 'btn btn--primary'} />
                  )}
                  {more.length > 0 && <Menu label={tx(T.moreFor, { name: data.teacher.name })} items={more} />}
                </>
              ) : undefined
            }
          />
          <RecordHighlights file={data} onTab={setTab} />
          {callout && <RecordCallout callout={callout} />}
          {/* PD-56 O-3: the teacher asked to delete their account (shown only while pending), offboarded or not. */}
          <DeletionRequestBanner teacherId={data.teacher.id} name={data.teacher.name} />
          <div className="mast__tabs">
            <FilterChips<FileTab> variant="tabs" label={tx(T.fileSections)} value={tab} onChange={setTab} options={tabOptions} />
          </div>
        </header>
        {canWrite && (
          <div className="tf-proxy" ref={proxies}>
            {/* Mounted whatever the file says: a code shown once must outlive the reload. */}
            <span data-act="give">
              <GiveSignInButton show={!!signIn?.canGive} teacherId={data.teacher.id} basePath={basePath} />
            </span>
            <span data-act="code">{signIn?.canSendCode && <SendCodeButton teacherId={data.teacher.id} />}</span>
            <span data-act="signin">
              <ChangeSignInButton show={!!signIn?.canChange} teacherId={data.teacher.id} signedIn={signIn?.status === 'active'} />
            </span>
            {/* PD-35 B5: escalate about this teacher (the server checks the scope). */}
            <span data-act="case">
              <OpenCaseButton subject={{ kind: 'teacher', id: data.teacher.id }} target="teachers" />
            </span>
            {/* PD-43 PR-1b: the server says who may (the routes re-check). */}
            <span data-act="reactivate">
              <ReactivateButton show={!!data.onboarding?.canReactivate && !data.teacher.isActive} teacherId={data.teacher.id} name={data.teacher.name} />
            </span>
            <span data-act="offboard">
              <OffboardButton show={!!data.onboarding?.canOffboard && data.teacher.isActive} teacherId={data.teacher.id} name={data.teacher.name} />
            </span>
          </div>
        )}
        <FileSections tab={tab} file={data} links={links} onEdit={() => setEditing(true)} onAdd={setIntent} />
        {editing && <EditPersonalDialog file={data} onClose={() => setEditing(false)} />}
        {intent && <AddEntryDialog teacherId={data.teacher.id} intent={intent} onClose={() => setIntent(null)} />}
      </div>
    </div>
  )
}

/** One tab of the file at a time. The work sits on sheets; who the teacher is sits beside it, on the canvas. */
function FileSections({
  tab,
  file,
  links,
  onEdit,
  onAdd,
}: {
  tab: FileTab
  file: TeacherFile
  links?: TeacherWorkLinks
  onEdit: () => void
  onAdd: (i: EntryIntent) => void
}) {
  const payroll = usePayroll(file)
  // RQA-F1: one month for the monthly figures and the lesson reports they count.
  const [month, setMonth] = useState(currentMonth)
  return (
    <>
      {tab === 'overview' && (
        <div className="split split--wide-aside tf-file">
          <div className="tf-file__main">
            <SetupChecklist file={file} />
            <Monthly file={file} onAdd={onAdd} links={links} month={month} onMonth={setMonth} />
          </div>
          <aside className="tf-file__side">
            <Personal file={file} onEdit={onEdit} />
            <EmploymentSection file={file} payroll={payroll} onEdit={onEdit} />
          </aside>
        </div>
      )}
      {tab === 'students' && <Students file={file} />}
      {tab === 'schedule' && (
        <>
          <TeacherScheduleSection teacherId={file.teacher.id} links={links} />
          {/* PD-38: category and shift, effective-dated. */}
          <ShiftSection teacherId={file.teacher.id} />
        </>
      )}
      {tab === 'pay' && (
        <>
          {/* PD-18: the super admin and the Teachers manager (PD-43); the server re-checks every route. */}
          <FinancialSummarySection payroll={payroll} />
          <HistorySection kind="bonus" file={file} payroll={payroll} />
          <HistorySection kind="deduction" file={file} payroll={payroll} />
        </>
      )}
      {tab === 'leave' && (
        <>
          {/* PD-12: the manager (and super admin) edit the record; the same two set the allowance. */}
          <TeacherLeaveSection teacherId={file.teacher.id} canSetAllowance={file.access.canEditPersonal} />
          <DaysOff file={file} onAdd={onAdd} />
        </>
      )}
      {/* PD-35: evaluations and improvement plans; the teacher sees them once shared. */}
      {tab === 'evaluations' && (
        <EvaluationsSection teacherId={file.teacher.id} canWrite={file.access.canWriteSupervision} canEditCriteria={file.access.canEditPersonal} />
      )}
      {tab === 'records' && (
        <>
          <Complaints file={file} onAdd={onAdd} />
          {/* PD-11's timeline: every record about the teacher in one line, plus notes and the bonus ticket. */}
          <SupervisionTimeline teacherId={file.teacher.id} canWrite={file.access.canWriteSupervision} />
          {/* RQA-F1: the reports behind the on-time figure, for the month chosen on Overview. */}
          <LessonReports teacherId={file.teacher.id} month={month} />
          {/* PD-43: the teacher's and their login's lifecycle. */}
          <LifecycleHistory teacherId={file.teacher.id} />
        </>
      )}
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
    <section className="tf-section" aria-labelledby={id}>
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
  const { number, locale } = useI18n()
  const setup = file.setup
  if (!setup || !file.teacher.isActive || (setup.missing === 0 && setup.payMatchesShift)) return null
  return (
    <Section
      id="tf-setup"
      title={tx(T.setupTitle)}
      action={
        <span className="sr-only">{setup.missing === 1 ? tx(T.oneStepLeft) : tx(T.stepsLeft, { steps: countLabel(setup.missing, number(setup.missing), STEPS, locale) })}</span>
      }
    >
      <ul className="tf-setup">
        {/* What is left first; what is done after it, quieter. */}
        {[...SETUP_STEPS].sort((a, b) => Number(setup[a[0]]) - Number(setup[b[0]])).map(([key, label]) => (
          <li key={key} className={setup[key] ? 'is-done' : undefined}>
            <Icon name={setup[key] ? 'checkCircle' : 'circle'} size={18} />
            <span className="tf-setup__label">{tx(label)}</span>
            <span className="sr-only">{tx(setup[key] ? T.done : T.stepNotDone)}</span>
          </li>
        ))}
      </ul>
      {!setup.payMatchesShift && (
        <p className="tf-note tf-note--waiting" role="note">
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
                <By name={who(e)} when={dateTime(e.at)} />
                {e.reason && (
                  <span className="tf-history__reason" dir="auto">
                    {e.reason}
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
  const { dateTime } = useI18n()
  return <By name={entry.author.name} when={dateTime(entry.createdAt)} />
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
        file.access.canEditPersonal && file.teacher.isActive && (
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
        <p className="tf-kv__foot">
          <By prefix={tx(T.lastEditBy)} name={p.updatedBy.name} when={dateTime(p.updatedAt)} />
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
          <table className="table stack-table">
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
                  <td>
                    {/* PD-17: the child's Student Profile. */}
                    <Link to={studentPath(s.learnerId)}>{s.name}</Link>
                  </td>
                  <td data-label={tx(T.level)}><bdi>{s.level ?? tx(T.none)}</bdi></td>
                  <td data-label={tx(T.family)}><bdi>{s.family.displayName}</bdi></td>
                  <td data-label={tx(T.supervisor)}><bdi>{s.supervisor?.name ?? tx(T.none)}</bdi></td>
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

function Monthly({
  file,
  onAdd,
  links,
  month,
  onMonth: setMonth,
}: {
  file: TeacherFile
  onAdd: (i: EntryIntent) => void
  links?: TeacherWorkLinks
  month: string
  onMonth: (month: string) => void
}) {
  const tx = useCopy()
  const { number } = useI18n()
  const cal = useCalendarDate()
  const items = file.supervision.monthlyComments
  return (
    <Section
      id="tf-monthly"
      title={tx(T.monthly)}
      action={
        <MonthPicker value={month} onChange={(next) => next <= currentMonth() && setMonth(next)} label={tx(T.month)} showLabel={false} />
      }
    >
      <MonthlyKpis teacherId={file.teacher.id} month={month} links={links} />
      <div className="tf-section__head">
        <h3 className="tf-subtitle">{tx(T.comments)}</h3>
        {file.access.canWriteSupervision && file.teacher.isActive && (
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
