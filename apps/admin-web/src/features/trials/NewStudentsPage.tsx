import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { TrialPaymentsDialog, TrialRequestsSummary } from '@/features/payments/TrialPaymentsDialog'
import { PAY } from '@/features/payments/copy'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import type { MenuItem } from '@/shared/components/Menu'
import { PageHeader } from '@/shared/components/PageHeader'
import {
  Age,
  Board,
  BoardCard,
  DetailSection,
  RequestQueue,
  useWidePane,
  waitedOvernight,
  type BoardStage,
  type FlowStep,
} from '@/shared/components/RequestQueue'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import type { Pair } from '../teachers/copy'
import { describeOpsError } from '../teachers/opsCopy'
import { trialsApi, type NewStudentDto } from './api'
import { TRIALS_AREA_BASE, TRIALS_TABS, TrialsAreaTabs, useTrialsAccess } from './area'
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
  yearsWord,
  type NewStudentStatus,
  type StatusFilter,
} from './newStudentsCopy'
import { useNewStudents, useTrialOp } from './hooks'
import { SubscriptionForm, draftFrom, formErrors, toInput, type SubscriptionDraft } from './SubscriptionForm'
import { NewStudentSetup, type SetupIntent } from './NewStudentSetup'
import { EnteredFamilies } from '@/features/intake/EnteredFamilies'
import '../teachers/teachers.css'
import './trials.css'
import './new-students.css'

/** The board's stages, in the order a family moves through them. A locked sign-up is still waiting for the parent. */
const STAGES = ['unassigned', 'waiting', 'signed_up'] as const
type Stage = (typeof STAGES)[number]
const stageOf = (status: NewStudentStatus): Stage => (status === 'locked' ? 'waiting' : status)

/** When the family's present wait began: recorded, until someone is assigned; assigned, from then on. */
const since = (s: NewStudentDto) => s.enrolment?.assignedAt ?? s.recordedAt
/** A family nobody was assigned to since before today is late; a parent's turn is never late. */
/**
 * Late, by the same rule as the Requests hub (waited since before today), but only where this desk acts:
 * a family nobody was assigned to, a code the parent asked for, a locked sign-up. The parent's own turn is never late.
 */
const assignLate = (s: NewStudentDto, status: NewStudentStatus) =>
  status === 'unassigned'
    ? waitedOvernight(s.recordedAt)
    : (status === 'locked' || s.enrolment?.parentSignup.state === 'code_waiting') && waitedOvernight(since(s))

/**
 * The New Students page (trial journey): every family that subscribed after a
 * trial, exactly as Sales recorded it in Chat -- the parent, each child with
 * their course, teacher, prices and weekly times, and the payment. These
 * details live here only; the trial group was told "The student has
 * subscribed." and nothing more. Operations, Sales and the super admin read
 * it; Sales may correct a typo.
 *
 * Composed as a board: a column for each stage of the setup, in order (not
 * assigned, waiting for the parent, signed up), a card for each family with
 * the one step it needs next. The open family's record and its steps are in
 * the inspector. No figure strip repeats the columns' counts; below 1100px the stages are the board's tabs,
 * and below 1100px, where there is no room for columns, they are its tabs.
 */
export function NewStudentsPage() {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const q = useNewStudents()
  const access = useTrialsAccess()
  const wide = useWidePane()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<NewStudentDto | null>(null)
  const [paying, setPaying] = useState<NewStudentDto | null>(null)
  // PD-44: the filter lives in the URL, so a Dashboard tile opens the filter
  // it counted (?filter=unassigned|waiting|signed_up) and a later link moves it too.
  const [params, setParams] = useSearchParams()
  // The Requests page links here with the family to open (?open=<trial id>).
  const [openId, setOpenId] = useState<string | null>(params.get('open'))
  const [intent, setIntent] = useState<{ id: string; act: SetupIntent } | null>(null)
  const [search, setSearch] = useState('')
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
  const canAssign = q.data?.canAssign === true
  // PD-27: Sales, the Operations Manager (who assigns) and the super admin ask
  // for the subscription payment before Assign, and still see the trial's
  // requests after it (read only). The server decides each request.
  const mayRequestPayment = access.sales || canAssign || (staff !== null && isSuperAdmin(staff.role))

  // PD-32: one status per family drives its tag and its stage; the search is on names.
  const statuses = useMemo(() => new Map(students.map((s) => [s.trialId, newStudentStatus(s)])), [students])
  const statusOf = (s: NewStudentDto) => statuses.get(s.trialId) ?? 'unassigned'
  const searched = students.filter((s) => matchesSearch(s, search))
  const shown = searched.filter((s) => matchesFilter(statusOf(s), filter))
  const inStage = (stage: Stage) => searched.filter((s) => stageOf(statusOf(s)) === stage)


  const mayEdit = (s: NewStudentDto) => access.sales && !s.enrolment // PD-16: a form that became a family is frozen.
  const more = (s: NewStudentDto): MenuItem[] => [
    ...(mayRequestPayment ? [{ key: 'pay', label: tx(PAY.trialAction), icon: 'card' as const, onSelect: () => setPaying(s) }] : []),
    ...(mayEdit(s) ? [{ key: 'edit', label: tx(TR.editForm), icon: 'pencil' as const, onSelect: () => setEditing(s) }] : []),
  ]
  const openWith = (s: NewStudentDto, act: SetupIntent) => {
    setOpenId(s.trialId)
    setIntent({ id: s.trialId, act })
  }

  /** The names of a family's children, as one phrase. */
  const childNames = (s: NewStudentDto) => (
    <span className="rq-names">
      {s.children.map((c, i) => (
        <span key={i}>
          {i > 0 && (locale === 'ar' ? '، ' : ', ')}
          <bdi>{c.name}</bdi>
        </span>
      ))}
    </span>
  )

  /**
   * A family on the board: the parent, its status word where the stage alone
   * does not say it (a code asked for, a lock), the waiting fact, the children
   * and who looks after them, how long it has waited, and its one next step.
   * A family that finished its setup is a quiet card.
   */
  const card = (s: NewStudentDto) => {
    const status = statusOf(s)
    const e = s.enrolment ?? null
    const group = e?.groupConversationId ?? null
    const codeWaiting = e?.parentSignup.state === 'code_waiting'
    const late = assignLate(s, status)
    const fact = !e
      ? tx(NS.factUnassigned)
      : status === 'locked'
        ? tx(NS.factLocked)
        : codeWaiting
          ? tx(NS.factCode)
          : status === 'signed_up'
            ? tx(NS.factSignedUp)
            : !group && e.canCreateGroup
              ? tx(NS.factNoGroup)
              : tx(NS.factNotStarted)
    const primary =
      !e && canAssign ? (
        <button type="button" className="btn btn--sm" onClick={() => openWith(s, 'assign')}>{tx(NS.assignSupervisor)}</button>
      ) : status === 'locked' ? (
        <button type="button" className="btn btn--sm" onClick={() => setOpenId(s.trialId)}>{tx(NS.open)}</button>
      ) : codeWaiting ? (
        <button type="button" className="btn btn--sm" onClick={() => setOpenId(s.trialId)}>{tx(NS.showCode)}</button>
      ) : e && !group && e.canCreateGroup ? (
        <button type="button" className="btn btn--sm" onClick={() => openWith(s, 'group')}>{tx(NS.createGroup)}</button>
      ) : group ? (
        <button type="button" className="btn btn--sm" onClick={() => navigate(`/chat/${group}`)}>{tx(NS.openGroup)}</button>
      ) : (
        <button type="button" className="btn btn--sm" onClick={() => setOpenId(s.trialId)}>{tx(NS.open)}</button>
      )
    return (
      <BoardCard
        key={s.trialId}
        title={s.parent.name}
        selected={open?.trialId === s.trialId}
        onOpen={() => setOpenId(s.trialId)}
        quiet={status === 'signed_up' && !!group}
        status={
          undefined
        }
        fact={fact}
        age={<Age iso={since(s)} late={late} />}
        actions={<RowActions label={`${tx(NS.moreActions)}: ${s.parent.name}`} primary={primary} more={more(s)} />}
      >
        <p className="rq-card__line">
          <Icon name="students" size={16} />
          {childNames(s)}
        </p>
        {e?.supervisor && status !== 'signed_up' && (
          <p className="rq-card__line">
            <Icon name="user" size={16} />
            <bdi>{e.supervisor.name}</bdi>
          </p>
        )}
      </BoardCard>
    )
  }

  // Beside the board the inspector always shows a family: the one picked, else the first on the board.
  const listed = wide ? searched : shown
  const open = listed.find((s) => s.trialId === openId) ?? (wide ? [...STAGES].flatMap((st) => listed.filter((s) => stageOf(statusOf(s)) === st))[0] ?? null : null)
  const openStatus = open ? statusOf(open) : 'unassigned'

  const stages: Array<BoardStage<Stage>> = STAGES.map((stage) => {
    const families = inStage(stage)
    return {
      key: stage,
      label: tx(STATUS[stage].label),
      count: families.length,
      // A solid red count only over cards whose red age asks this desk to act.
      urgent: families.some((s) => assignLate(s, statusOf(s))),
      quiet: stage === 'signed_up',
      cards: families.map(card),
      empty: tx(NS.stageEmpty),
    }
  })

  const offered = TRIALS_TABS.filter((t) => t.offered(access)).length > 1
  return (
    <div className="page rq-page ns-page">
      <div className="page__inner">
        <PageHeader
          title={tx(TR.newTitle)}
          subtitle={tx(NS.rule)}
          tabs={offered ? <TrialsAreaTabs /> : undefined}
        />
        <RequestQueue
          label={tx(NS.panelLabel)}
          reserve={wide && q.isLoading}
          detail={
            open && {
              id: open.trialId,
              title: open.parent.name,
              kind: { icon: 'newStudents', label: tx(NS.kind) },
              pinned: true,
              onClose: () => setOpenId(null),
              body: (
                <FamilyRecord
                  s={open}
                  status={
                    <>
                      <Badge tone={STATUS[openStatus].tone} dot>{tx(STATUS[openStatus].label)}</Badge>
                      <Age iso={since(open)} late={assignLate(open, openStatus)} />
                    </>
                  }
                  canAssign={canAssign}
                  showRequests={mayRequestPayment}
                  more={more(open)}
                  intent={intent?.id === open.trialId ? intent.act : null}
                  onIntentDone={() => setIntent(null)}
                />
              ),
            }
          }
        >
          <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
            {students.length === 0 ? (
              // The one empty state of the page: what will be here, and where it comes from.
              <div className="sheet rq-blank">
                <EmptyState
                  title={tx(TR.nothingNew)}
                  hint={tx(NS.emptyHint)}
                  action={<Link className="btn btn--sm" to={TRIALS_AREA_BASE}>{tx(NS.openTrials)}</Link>}
                />
              </div>
            ) : (
              <>
                <div className="rq-bar ns-find">
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
                  <div className="sheet rq-blank">
                    <EmptyState title={tx(NS.noMatch)} />
                  </div>
                ) : (
                  // With room, every column stays on the board (a filter does not reshape it); without, the stages are tabs.
                  <Board label={tx(NS.filterLabel)} stages={stages} value={wide || filter === 'all' ? 'all' : filter} onChange={setFilter} />
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
 * PD-32: one family's record in the inspector, read top to bottom -- who
 * recorded it, its steps from the trial to the parent's sign-up, then the
 * contact, the payment and the children. Its next step is the foot's action.
 */
function FamilyRecord({
  s,
  status,
  canAssign,
  showRequests,
  more,
  intent,
  onIntentDone,
}: {
  s: NewStudentDto
  status: ReactNode
  canAssign: boolean
  showRequests: boolean
  more: MenuItem[]
  intent: SetupIntent | null
  onIntentDone: () => void
}) {
  const { locale, number } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const money = (n: number) => formatAmount(n, s.payment.currency, locale)
  const sep = locale === 'ar' ? '، ' : ', '
  const before: FlowStep[] = [
    {
      key: 'trial',
      label: tx(NS.stepTrial),
      state: 'done',
      meta: (
        <>
          <bdi>{s.prospectName}</bdi>
          {s.trialTeacher && <>{sep}<bdi>{s.trialTeacher.name}</bdi></>}
          {s.trialAt && <>{sep}<time dateTime={s.trialAt}>{formatWhen(s.trialAt, locale)}</time></>}
        </>
      ),
    },
    {
      key: 'recorded',
      label: tx(NS.stepRecorded),
      state: 'done',
      meta: (
        <>
          {tx(NS.recorded)} <bdi>{s.recordedBy.name}</bdi>{sep}<time dateTime={s.recordedAt}>{formatWhen(s.recordedAt, locale)}</time>
          {s.updatedAt && (
            <>{sep}{tx(NS.updated)} <time dateTime={s.updatedAt}>{formatWhen(s.updatedAt, locale)}</time></>
          )}
        </>
      ),
    },
  ]
  return (
    <div className="ns-record">
      <NewStudentSetup s={s} status={status} canAssign={canAssign} before={before} intent={intent} onIntentDone={onIntentDone} more={more}>
        <DetailSection title={tx(NS.contact)}>
          <dl className="rq-fields">
            <div className="rq-field">
              <dt>{tx(TR.parentPhone)}</dt>
              <dd><bdi dir="ltr" className="ns-ltr">{s.parent.phone}</bdi></dd>
            </div>
            <div className="rq-field">
              <dt>{tx(TR.email)}</dt>
              <dd>{s.parent.email ? <bdi dir="ltr" className="ns-ltr">{s.parent.email}</bdi> : <span className="ts-muted">{tx(NS.none)}</span>}</dd>
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
          {showRequests && <TrialRequestsSummary trialId={s.trialId} />}
        </DetailSection>
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
                    <th scope="row" className="ns-c-name"><bdi>{c.name}</bdi></th>
                    <td className="ns-num ns-c-age" data-unit={yearsWord(c.age, locale)}>{number(c.age)}</td>
                    <td className="ns-c-course"><bdi>{c.course}</bdi></td>
                    <td className="ns-c-teacher"><bdi>{c.teacher.name}</bdi></td>
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
      </NewStudentSetup>
    </div>
  )
}

/** PD-45: "Egypt · Giza" / "مصر · الجيزة" from the names the server sent, or a dash for a form that has none. */
function formLocationText(location: NewStudentDto['parent']['location'], locale: 'ar' | 'en') {
  if (!location) return <span className="ts-muted">{locale === 'ar' ? NS.none.ar : NS.none.en}</span>
  const { country, subdivision } = location.names
  const name = (n: { ar: string; en: string }) => (locale === 'ar' ? n.ar : n.en)
  return <bdi>{subdivision ? `${name(country)}${locale === 'ar' ? '، ' : ', '}${name(subdivision)}` : name(country)}</bdi>
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
