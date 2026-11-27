import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge, type Tone } from '@/shared/components/Badge'
import { PageHeader } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { formatDay } from '@/features/instalments/copy'
import { WEEKDAY } from '@/features/trials/copy'
import { parentPath, profileKeys, studentPath, type StudentProfile } from './api'
import { P, describeError, isProfileRefusal, useCopy } from './copy'
import { useStudent } from './hooks'
import { AttentionRow, Calm, Fact, Sheet, longDay } from './RecordParts'
import { RecordHead, fill, useWalk, type Callout, type Highlight } from './RecordHead'
import { RecordPanel, RecordTabs, useRecordTab, type RecordTab } from './RecordTabs'
import { dayMonthIn, familyTime, weekdayIn, zoneLabel } from '@/core/time/academyTime'
import { SubscriptionPanel } from '@/features/subscriptions/SubscriptionPanel'
import { useSubscription } from '@/features/subscriptions/hooks'
import { REASON_LABEL, S, STATE_LABEL } from '@/features/subscriptions/copy'
import type { AccessState, Standing } from '@/features/subscriptions/api'
import { CarriedOverPanel } from '@/features/intake/CarriedOverPanel'
import { useCarriedOver } from '@/features/intake/hooks'
import { ChangeTeacherDialog } from '@/features/teachers/ChangeTeacherDialog'
import { O } from '@/features/teachers/opsCopy'
import { useMayChangeTeacher } from '@/features/teachers/hooks'
import './profiles.css'

const ACCESS_TONE: Record<AccessState, Tone> = { open: 'ok', grace: 'warn', locked: 'danger' }

type TabKey = 'overview' | 'subscription' | 'schedule' | 'family'

/** Which tab a link's hash opens: `#package` is on Subscription, `#parents` on Family. */
const SECTION_TAB: Record<string, TabKey> = { attention: 'overview', student: 'overview', package: 'subscription', parents: 'family' }

/**
 * PD-17: the Student Profile -- photo, name, age, class schedule, assigned
 * teacher and course. The server opens it to the administration (the Teachers
 * department, the super admin, the child's supervisor) and to the child's own
 * teacher in the app; staff also get the date of birth and the parents, whose
 * Parent Profile then decides by its own rule. Nothing here is money.
 *
 * The same record as a parent's, compact: a masthead (who it is, the lessons
 * bought, used and left, the next lesson), and a tab each for what waits, the
 * subscription, the weekly times and the family.
 */
export function StudentProfilePage() {
  const { learnerId = '' } = useParams<{ learnerId: string }>()
  const tx = useCopy()
  const { locale } = useI18n()
  const student = useStudent(learnerId)

  return (
    <div className="page rec">
      <div className="page__inner">
        {student.data ? (
          <StudentFile s={student.data} />
        ) : (
          <>
            <PageHeader title={tx(P.studentEyebrow)} />
            {isProfileRefusal(student.error) ? (
              <EmptyState icon="lock" title={describeError(student.error, locale)} />
            ) : (
              <QueryBoundary isLoading={student.isLoading} error={student.error} onRetry={() => void student.refetch()}>
                {null}
              </QueryBoundary>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StudentFile({ s }: { s: StudentProfile }) {
  const tx = useCopy()
  const { locale, number } = useI18n()
  const otx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const queryClient = useQueryClient()
  // PD-31: "Change teacher" for the administration; the server decides (PD-8 scope).
  const mayChangeTeacher = useMayChangeTeacher()
  const [changing, setChanging] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  // PD-30: lessons bought and used, the lock, exceptions -- billing readers only (the server decides).
  // PD-42: the package carried over from Jawwid Core -- when the server answers for this viewer.
  // Each is read here as well as by its panel, so the masthead and the tabs show only what the server sent.
  const subscription = useSubscription(s.id)
  const standing = subscription.data?.standing
  const carried = useCarriedOver(s.id)
  const hasSubscription = !!subscription.data || (!!carried.data && (!!carried.data.package || carried.data.can.carryOver))
  const hasFamily = !!s.family && s.family.parents.length > 0

  const tabKeys: TabKey[] = ['overview', ...(hasSubscription ? (['subscription'] as const) : []), 'schedule', ...(hasFamily ? (['family'] as const) : [])]
  const { tab, open: openTab } = useRecordTab<TabKey>(tabKeys, SECTION_TAB)
  const tabs: Array<RecordTab<TabKey>> = [
    { key: 'overview', label: tx(P.tabOverview) },
    ...(hasSubscription ? [{ key: 'subscription' as const, label: tx(S.title) }] : []),
    { key: 'schedule', label: tx(P.tabSchedule), count: s.schedule.length > 0 ? <span className="count count--quiet">{number(s.schedule.length)}</span> : undefined },
    ...(hasFamily ? [{ key: 'family' as const, label: tx(P.family) }] : []),
  ]

  const next = s.schedule
    .filter((x): x is typeof x & { nextStartsAt: string } => !!x.nextStartsAt)
    .sort((a, b) => a.nextStartsAt.localeCompare(b.nextStartsAt))[0]

  const walk = useWalk('students', s.id, studentPath)
  const highlights = useStudentHighlights(s, standing, next)
  const callout = studentCallout(s, standing, tx, locale)
  const sep = locale === 'ar' ? '، ' : ', '
  const line = (
    <>
      {s.family ? fill(tx(P.lineStudentIn), { family: <bdi>{s.family.name}</bdi> }) : tx(P.lineStudent)}
      {sep}
      {s.teacher ? fill(tx(P.lineTaughtBy), { name: <strong><bdi>{s.teacher.name}</bdi></strong> }) : tx(P.lineNoTeacher)}
    </>
  )

  return (
    <>
      <RecordHead
        back={walk ? { to: '/students', label: tx(P.studentsTitle) } : undefined}
        walk={walk}
        lead={<Avatar name={s.name} seed={s.id} src={s.avatarUrl} size="lg" />}
        name={s.name}
        status={
          // With nothing bought and nothing holding it back there is no subscription to describe.
          standing && (standing.state !== 'open' || standing.lessonsIncluded !== null) && (
            <Badge tone={ACCESS_TONE[standing.state]} dot={standing.state === 'open'}>
              {standing.state === 'open' ? tx(P.subscriptionOpen) : tx(STATE_LABEL[standing.state])}
            </Badge>
          )
        }
        line={line}
        highlights={highlights}
        callout={callout}
        actions={
          mayChangeTeacher &&
          s.teacher && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDone(null)
                setChanging(true)
              }}
            >
              {otx(O.changeTeacher)}
            </button>
          )
        }
        tabs={<RecordTabs name="st" label={tx(P.fileIndex)} tabs={tabs} value={tab} onChange={openTab} />}
      />
      {changing && (
        <ChangeTeacherDialog
          target={{ kind: 'learner', id: s.id, name: s.name, currentTeacherId: s.teacher?.id ?? null }}
          onClose={() => setChanging(false)}
          onDone={(text) => {
            setChanging(false)
            setDone(text)
            void queryClient.invalidateQueries({ queryKey: profileKeys.student(s.id) })
          }}
        />
      )}
      {done && (
        <p className="notice notice--info rec-done" role="status">
          {done}
        </p>
      )}

      <RecordPanel name="st" tab="overview" value={tab}>
        <div className="split rec-split">
          <div className="rec-main">
            <StudentAttention s={s} standing={standing} />
          </div>
          <aside className="rec-aside">
            <StudentFacts s={s} />
          </aside>
        </div>
      </RecordPanel>

      {/* Always in the document, so each read is asked for once; its tab is offered only when the server answers. */}
      <RecordPanel name="st" tab="subscription" value={tab}>
        <div className="split rec-split rec-split--sub">
          <div className="rec-main">
            <SubscriptionPanel learnerId={s.id} />
          </div>
          <aside className="rec-aside" data-section="package">
            <CarriedOverPanel learnerId={s.id} name={s.name} />
          </aside>
        </div>
      </RecordPanel>

      <RecordPanel name="st" tab="schedule" value={tab}>
        <ScheduleSheet s={s} />
      </RecordPanel>

      {hasFamily && s.family && (
        <RecordPanel name="st" tab="family" value={tab}>
          <ParentsSheet family={s.family} />
        </RecordPanel>
      )}
    </>
  )
}

type NextSlot = StudentProfile['schedule'][number] & { nextStartsAt: string }

/**
 * A student's highlights: the next lesson, the lessons left (and used) and
 * bought, the teacher, the course and the age. Lesson counts are drawn only
 * when the server answers the subscription for this viewer.
 */
function useStudentHighlights(s: StudentProfile, standing: Standing | undefined, next: NextSlot | undefined): Highlight[] {
  const tx = useCopy()
  const { locale, number } = useI18n()
  const none = (text: string) => <span className="rec-hl__none">{text}</span>
  const out: Highlight[] = []
  if (next) {
    out.push({
      key: 'next',
      icon: 'calendar',
      label: tx(P.nextLesson),
      // The hour as the weekly time states it: the teacher's wall clock.
      value: <bdi dir="ltr">{next.start}</bdi>,
      note: `${weekdayIn(next.nextStartsAt, next.timezone, locale)} ${dayMonthIn(next.nextStartsAt, next.timezone, locale)}`,
      to: '#schedule',
    })
  }
  if (standing) {
    if (standing.lessonsLeft !== null) {
      out.push({
        key: 'left',
        icon: 'hourglass',
        label: tx(P.lessonsLeftWord),
        value: number(standing.lessonsLeft),
        tone: standing.state === 'locked' ? 'urgent' : standing.state === 'grace' ? 'waiting' : undefined,
        note:
          standing.state === 'grace' && standing.graceLeft !== null
            ? tx(S.graceLeft, { n: standing.graceLeft })
            : standing.lessonsUsed !== null
              ? tx(P.hlUsed, { n: number(standing.lessonsUsed) })
              : undefined,
        to: '#subscription',
      })
    }
    if (standing.lessonsIncluded !== null) out.push({ key: 'bought', icon: 'stack', label: tx(S.included), value: number(standing.lessonsIncluded), to: '#subscription' })
  }
  // The teacher is named in the head's sentence; course and age are who the child is.
  out.push({ key: 'course', icon: 'book', label: tx(P.course), value: s.course ? <bdi>{s.course.name}</bdi> : none(tx(P.notSet)), text: true })
  out.push({ key: 'age', icon: 'user', label: tx(P.age), value: s.age === null ? none(tx(P.notSet)) : tx(P.years, { n: s.age }), text: true })
  return out
}

/**
 * The one thing on this student that needs a person: a locked or closing
 * subscription first, then no teacher, then no regular times.
 */
function studentCallout(s: StudentProfile, standing: Standing | undefined, tx: ReturnType<typeof useCopy>, locale: 'ar' | 'en'): Callout | null {
  const sep = locale === 'ar' ? '، ' : ', '
  if (standing && standing.state !== 'open') {
    const why = standing.lockReasons.map((r) => tx(REASON_LABEL[r])).join(sep)
    return {
      tone: standing.state === 'locked' ? 'urgent' : 'waiting',
      title: tx(standing.state === 'locked' ? P.stCalloutLocked : P.stCalloutGrace),
      body: why ? tx(P.stCalloutWhy, { why }) : standing.state === 'grace' && standing.graceLeft !== null ? tx(S.graceLeft, { n: standing.graceLeft }) : undefined,
      action: (
        <Link className="btn btn--sm" to="#subscription">
          {tx(P.seeSubscription)}
        </Link>
      ),
    }
  }
  if (!s.teacher) return { tone: 'waiting', title: tx(P.noTeacherYet) }
  if (s.schedule.length === 0) {
    return {
      tone: 'waiting',
      title: tx(P.noSchedule),
      action: (
        <Link className="btn btn--sm" to="#schedule">
          {tx(P.seeSchedule)}
        </Link>
      ),
    }
  }
  return null
}

/**
 * What waits on this student now: a subscription that is locked or on its
 * grace lessons (and why), no teacher, no regular times. One calm line otherwise.
 */
function StudentAttention({ s, standing }: { s: StudentProfile; standing: Standing | undefined }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const held = standing && standing.state !== 'open' ? standing : null
  const count = (held ? 1 : 0) + (s.teacher ? 0 : 1) + (s.schedule.length === 0 ? 1 : 0)
  // One thing waiting is the head's callout; the list is for when there is more than one.
  if (count === 1) return null
  return (
    <Sheet id="st-attention" section="attention" title={tx(P.attention)} count={count > 0 ? count : undefined}>
      {count === 0 ? (
        <Calm>{tx(P.calmStudent)}</Calm>
      ) : (
        <ul className="rec-list">
          {held && (
            <AttentionRow
              tone={held.state === 'locked' ? 'late' : 'waiting'}
              title={tx(S.title)}
              tag={<Badge tone={ACCESS_TONE[held.state]}>{tx(STATE_LABEL[held.state])}</Badge>}
              sub={
                (held.lockReasons.length > 0 || (held.state === 'grace' && held.graceLeft !== null)) && (
                  <>
                    {held.lockReasons.map((r) => (
                      <span key={r}>{tx(REASON_LABEL[r])}</span>
                    ))}
                    {held.overdue && (
                      <span>
                        <bdi>{held.overdue.label}</bdi>, {formatDay(held.overdue.dueDate, locale)}
                      </span>
                    )}
                    {held.state === 'grace' && held.graceLeft !== null && <span>{tx(S.graceLeft, { n: held.graceLeft })}</span>}
                  </>
                )
              }
              action={
                <Link className="btn btn--sm" to="#subscription">
                  {tx(P.seeSubscription)}
                </Link>
              }
            />
          )}
          {!s.teacher && <AttentionRow tone="waiting" title={tx(P.noTeacherYet)} />}
          {s.schedule.length === 0 && (
            <AttentionRow
              tone="waiting"
              title={tx(P.noSchedule)}
              action={
                <Link className="btn btn--sm" to="#schedule">
                  {tx(P.seeSchedule)}
                </Link>
              }
            />
          )}
        </ul>
      )}
    </Sheet>
  )
}

/** Who the student is: age, course and teacher, quiet facts on the canvas. */
function StudentFacts({ s }: { s: StudentProfile }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const notSet = <span className="rec-missing">{tx(P.notSet)}</span>
  // Age, course and teacher are the head's highlights; the margin keeps what they do not say.
  if (s.birthDate === undefined) return null
  return (
    <section className="aside-group rec-group" aria-labelledby="st-info" data-section="student">
      <div className="rec-group__head">
        <h2 id="st-info" className="aside-group__title">
          {tx(P.studentInfo)}
        </h2>
      </div>
      <dl className="rec-facts">
        <Fact icon="calendar" label={tx(P.birthDate)}>
          {s.birthDate ? longDay(s.birthDate, locale) : notSet}
        </Fact>
      </dl>
    </section>
  )
}

/** The weekly times: the day, the hour on the teacher's clock, the length, and the family's own clock beside it. */
function ScheduleSheet({ s }: { s: StudentProfile }) {
  const tx = useCopy()
  const { locale, number } = useI18n()
  const zones = [...new Set(s.schedule.map((x) => x.timezone))]
  // PD-45 §7: no app clock yet -> the clock the family's country implies, marked approximate.
  const estimated = !s.familyTimeZone && !!s.familyTimeZoneEstimate
  return (
    <div className="rec-narrow">
      <Sheet
        id="st-schedule"
        section="schedule"
        title={tx(P.schedule)}
        count={s.schedule.length > 0 ? number(s.schedule.length) : undefined}
        action={zones.length === 1 && s.schedule.length > 0 ? <span className="rec-sheet__aside">{zoneLabel(zones[0]!, locale)}</span> : undefined}
      >
        {s.schedule.length === 0 ? (
          <p className="rec-empty">{tx(P.noSchedule)}</p>
        ) : (
          <ul className="rec-list">
            {s.schedule.map((x, i) => {
              // PD-22: the family's own clock beside the teacher's, when they differ.
              const theirs = x.nextStartsAt ? familyTime(x.nextStartsAt, s.familyTimeZone ?? s.familyTimeZoneEstimate, locale) : null
              return (
                <li key={i} className="rec-slot-row">
                  <strong className="rec-slot-row__day">{tx(WEEKDAY[x.weekday] ?? { en: String(x.weekday), ar: String(x.weekday) })}</strong>
                  <span className="rec-slot-row__time">
                    <bdi dir="ltr">{x.start}</bdi>
                  </span>
                  <span className="rec-slot-row__length">{tx(P.minutes, { n: x.durationMinutes })}</span>
                  <span className="rec-slot-row__more">
                    {zones.length > 1 && <span>{zoneLabel(x.timezone, locale)}</span>}
                    {theirs && <span>{tx(estimated ? P.familyLocalEstimate : P.familyLocal, { time: theirs })}</span>}
                    {x.nextStartsAt && <span>{tx(P.nextOn, { when: `${weekdayIn(x.nextStartsAt, x.timezone, locale)} ${dayMonthIn(x.nextStartsAt, x.timezone, locale)}` })}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Sheet>
    </div>
  )
}

/** The parents, each a way into their own file: the Parent Profile then decides by its own rule. */
function ParentsSheet({ family }: { family: NonNullable<StudentProfile['family']> }) {
  const tx = useCopy()
  const { number } = useI18n()
  const navigate = useNavigate()
  return (
    <div className="rec-narrow">
      <Sheet id="st-parents" section="parents" title={tx(P.parents)} count={number(family.parents.length)} rule={tx(P.parentsHint)}>
        <ul className="rec-list">
          {family.parents.map((p) => (
            <li
              key={p.id}
              className="rec-kid"
              onClick={(e) => {
                // The whole row opens the file; the name is the link the keyboard uses.
                if (!(e.target as HTMLElement).closest('a, button')) navigate(parentPath(p.id))
              }}
            >
              <Avatar name={p.name} seed={p.id} />
              <Link className="rec-kid__name" to={parentPath(p.id)}>
                <bdi>{p.name}</bdi>
              </Link>
              <RowActions
                label={tx(P.more, { name: p.name })}
                primary={
                  // The name is the link; this is only a larger target for the pointer.
                  <Link className="btn btn--sm" to={parentPath(p.id)} tabIndex={-1} aria-hidden="true">
                    {tx(P.openFile)}
                  </Link>
                }
              />
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  )
}
