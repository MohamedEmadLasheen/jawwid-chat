import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Icon, type IconName } from '@/shared/components/Icon'
import { MastFigures, type MastFigure } from '@/shared/components/PageHeader'
import { useTeacherDetail } from '@/features/teachers/hooks'
import { useTeacherAssignments } from '@/features/organization/hooks'
import type { TeacherFile, TeacherSetup } from './api'
import { T, useCopy, type Pair } from './copy'
import { useCalendarDate } from './calendar'
import { useDeletionRequest } from './hooks'
import { useLessonReports } from './LessonReports'
import { currentMonth } from './TeacherWork'

/**
 * The record's head (Attio's anatomy, one fixed layout): who the teacher is in
 * one sentence, at most six highlights of this month, and one callout with one
 * action when something needs a person. Every number is the server's; a number
 * the viewer may not read, or that failed, is left out, never shown as zero.
 */

export type FileTab = 'overview' | 'students' | 'schedule' | 'pay' | 'leave' | 'evaluations' | 'records'

export function RecordIdentity({
  file,
  back,
  actions,
}: {
  file: TeacherFile
  back: { to: string; label: string }
  actions?: ReactNode
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const cal = useCalendarDate()
  const sentence = useIdentitySentence(file)
  const t = file.teacher
  const tone = !t.isActive ? 'left' : t.away || (file.setup?.missing ?? 0) > 0 ? 'away' : 'active'
  return (
    <>
    <Link to={back.to} className="mast__back">
      <Icon name="arrowBack" size={15} />
      {back.label}
    </Link>
    <div className="tf-head__row">
      <div className="tf-head__lead">
        <div className="tf-head__who">
          <Avatar name={t.name} seed={t.id} size="lg" />
          <div className="tf-head__text">
            <h1 className="tf-head__name" dir="auto">
              {t.name}
            </h1>
            <p className="tf-head__line">
              <span className={`tf-dot tf-dot--${tone}`} aria-hidden="true" />
              <span>
                {sentence}
                {t.away && (
                  <>
                    {locale === 'ar' ? '، ' : ', '}
                    {tx(t.away.kind === 'leave' ? T.onLeaveUntil : t.away.kind === 'suspended' ? T.suspendedUntil : T.offUntil, {
                      date: cal.day(t.away.until),
                    }).replace(/^./, (c) => c.toLocaleLowerCase(LOCALE_TAG[locale]))}
                  </>
                )}
                .
              </span>
            </p>
          </div>
        </div>
      </div>
      {actions && <div className="tf-head__actions">{actions}</div>}
    </div>
    </>
  )
}

/** "Active since September 2025, supervised by Ola Mahmoud, has not signed in yet" -- status and supervisor as one sentence. */
function useIdentitySentence(file: TeacherFile): ReactNode {
  const tx = useCopy()
  const { locale } = useI18n()
  const cal = useCalendarDate()
  // The supervisor's name comes from the organization's teacher assignments, which only
  // some roles may read; without it the sentence says only whether there is one.
  const assignments = useTeacherAssignments(true)
  const t = file.teacher
  const joined = file.personal.joinedOn
  const parts: ReactNode[] = []
  if (!t.isActive) {
    parts.push(t.leftAt ? tx(T.idLeftOn, { date: cal.day(t.leftAt.slice(0, 10)) }) : tx(T.idLeft))
  } else {
    if (file.setup && file.setup.missing > 0) parts.push(tx(T.idInSetup))
    else parts.push(joined ? tx(T.idActiveSince, { date: cal.month(joined.slice(0, 7)) }) : tx(T.idActive))
    const named = assignments.data?.teachers.find((a) => a.id === t.id)
    if (named?.supervisor) {
      const [before, after] = tx(T.idSupervisedBy, { name: '\u0000' }).split('\u0000')
      parts.push(
        <span key="sup" className="tf-nowrap">
          {before}
          <strong className="tf-head__person">
            <bdi>{named.supervisor.name}</bdi>
          </strong>
          {after}
        </span>,
      )
    } else if (named ? true : file.setup ? !file.setup.supervisor : false) {
      parts.push(tx(T.idNoSupervisor))
    }
    const status = file.signIn?.status
    if (status === 'provisioned') parts.push(tx(T.idNotSignedIn))
    else if (status === 'none') parts.push(tx(T.idNoSignIn))
    else if (status === 'suspended') parts.push(tx(T.idSignInSuspended))
  }
  const sep = locale === 'ar' ? '، ' : ', '
  return parts.map((p, i) => (
    <span key={i}>
      {i > 0 && sep}
      {p}
    </span>
  ))
}

/** At most six highlights of the month, each opening the tab that explains it. */
export function RecordHighlights({ file, onTab }: { file: TeacherFile; onTab: (t: FileTab) => void }) {
  const tx = useCopy()
  const { number, locale } = useI18n()
  const month = currentMonth()
  const detail = useTeacherDetail(file.teacher.id, month)
  const reports = useLessonReports(file.teacher.id, month, null)
  const d = detail.data
  const counts = reports.data?.pages[0]?.counts
  const pct = (r: number | null) =>
    r === null ? null : new Intl.NumberFormat(LOCALE_TAG[locale], { style: 'percent', maximumFractionDigits: 0 }).format(r)
  const pending = <span className="skeleton tf-fig-wait" aria-hidden="true" />
  const active = file.teacher.isActive

  const figures: MastFigure[] = [
    {
      key: 'students',
      label: tx(T.hlStudents),
      value: number(file.assignedStudents.length),
      onClick: () => onTab('students'),
    },
  ]
  if (active && (detail.isLoading || d)) {
    const held = d?.categories.find((c) => c.key === 'held')?.lessons ?? 0
    figures.push({
      key: 'lessons',
      label: tx(T.hlLessons),
      value: d ? number(held) : pending,
      tone: d && held === 0 ? 'quiet' : undefined,
      note: d?.summary ? tx(T.hlLessonsOf, { n: number(d.summary.totalScheduled) }) : undefined,
    })
  }
  if (active && (reports.isLoading || counts)) {
    // Red only while the teacher works here: a missed report of someone who left asks nothing of anyone.
    figures.push({
      key: 'missing',
      label: tx(T.hlMissing),
      value: counts ? number(counts.missing) : pending,
      tone: counts && counts.missing > 0 ? 'urgent' : counts && counts.missing === 0 ? 'quiet' : undefined,
      note: counts && counts.late > 0 ? tx(T.hlLateWritten, { n: number(counts.late) }) : undefined,
      onClick: () => onTab('records'),
    })
  }
  if (active && (detail.isLoading || d)) {
    const att = d ? pct(d.rates.attendance) : null
    const rel = d ? pct(d.rates.teacherReliability) : null
    // A rate with no lessons behind it is left out, not shown as a dash.
    if (!d || att !== null) figures.push({ key: 'attendance', label: tx(T.kpiAttendance), value: !d ? pending : (att as string) })
    if (!d || rel !== null) figures.push({ key: 'reliability', label: tx(T.kpiReliability), value: !d ? pending : (rel as string) })
  }
  const setup = file.setup
  if (setup && file.teacher.isActive && setup.missing > 0) {
    figures.push({
      key: 'setup',
      label: tx(T.hlSetup),
      value: number(setup.missing),
      note: tx(T.hlSetupOf, { n: number(SETUP_KEYS.length) }),
      onClick: () => onTab('overview'),
    })
  }
  if (!active) return null
  return (
    <section className="tf-highlights" aria-label={tx(T.highlights)}>
      <MastFigures figures={figures.slice(0, 6)} />
    </section>
  )
}

export const SETUP_KEYS = [
  ['signedIn', T.todoSignedIn],
  ['supervisor', T.todoSupervisor],
  ['contact', T.todoContact],
  ['payTerms', T.todoPayTerms],
  ['payoutAccount', T.todoPayoutAccount],
  ['leaveAllowance', T.todoLeaveAllowance],
  ['shift', T.todoShift],
  ['availability', T.todoAvailability],
  ['profile', T.todoProfile],
] as const satisfies ReadonlyArray<readonly [keyof TeacherSetup, Pair]>

export interface CalloutAction {
  label: string
  onClick: () => void
}

/**
 * One state callout, one action: the first of the file's open matters, in the
 * order a manager would deal with them. A pending deletion request has its own
 * callout (DeletionRequestBanner), so nothing else is said while it stands.
 */
export function useRecordCallout(
  file: TeacherFile,
  go: { setup: () => void; records: () => void },
): { tone: 'waiting' | 'urgent' | 'neutral'; icon: IconName; title: string; body?: string; action?: CalloutAction } | null {
  const tx = useCopy()
  const { number, locale } = useI18n()
  const deletion = useDeletionRequest(file.teacher.id)
  const reports = useLessonReports(file.teacher.id, currentMonth(), null)
  if (deletion.data?.request?.state === 'pending') return null
  const t = file.teacher
  // A teacher who left needs nothing done; the sentence under the name says so.
  if (!t.isActive) return null
  const setup = file.setup
  if (setup && setup.missing > 0) {
    const sep = locale === 'ar' ? '، ' : ', '
    const todo = SETUP_KEYS.filter(([k]) => !setup[k]).map(([, label]) => tx(label))
    const shown = todo.slice(0, 3).join(sep)
    return {
      tone: 'waiting',
      icon: 'tasks',
      title: tx(T.calloutSetupTitle),
      body: tx(T.calloutSetupBody, { steps: todo.length > 3 ? tx(T.calloutSetupMore, { steps: shown, n: number(todo.length - 3) }) : shown }),
      action: { label: tx(T.finishSetup), onClick: go.setup },
    }
  }
  const page = reports.data?.pages[0]
  const missing = page?.counts.missing ?? 0
  if (missing > 0) {
    const sep = locale === 'ar' ? '، ' : ', '
    const who = (page?.lessons ?? []).filter((l) => l.status === 'missing' && l.learner?.name && !l.anotherFamily).map((l) => l.learner!.name as string)
    return {
      tone: 'urgent',
      icon: 'file',
      title: missing === 1 ? tx(T.calloutMissingOne) : tx(T.calloutMissingTitle, { n: number(missing) }),
      body: who.length > 0 ? tx(T.calloutMissingWho, { names: [...new Set(who)].slice(0, 3).join(sep) }) : undefined,
      action: { label: tx(T.calloutMissingAction), onClick: go.records },
    }
  }
  const open = file.supervision.complaints.filter((c) => (c.status ?? (c.resolution ? 'resolved' : 'open')) === 'open').length
  if (open > 0) {
    return {
      tone: 'waiting',
      icon: 'alert',
      title: open === 1 ? tx(T.calloutComplaintsOne) : tx(T.calloutComplaintsTitle, { n: number(open) }),
      body: tx(T.calloutComplaintsBody),
      action: { label: tx(T.calloutComplaintsAction), onClick: go.records },
    }
  }
  return null
}

export function RecordCallout({ callout }: { callout: NonNullable<ReturnType<typeof useRecordCallout>> }) {
  return (
    <div className={`tf-callout tf-callout--${callout.tone}`} role="status">
      <span className="tf-callout__icon" aria-hidden="true">
        <Icon name={callout.icon} size={18} />
      </span>
      <div className="tf-callout__text">
        <p className="tf-callout__title">{callout.title}</p>
        {callout.body && <p className="tf-callout__body">{callout.body}</p>}
      </div>
      {callout.action && (
        <button type="button" className="btn btn--primary tf-callout__action" onClick={callout.action.onClick}>
          {callout.action.label}
        </button>
      )}
    </div>
  )
}
