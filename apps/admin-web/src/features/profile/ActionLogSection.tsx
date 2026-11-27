import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/core/api/client'
import { ApiError } from '@/core/api/errors'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { useCopy, type Pair } from '@/features/organization/copy'
import { ACTION_LOG } from '@/features/intake/historyCopy'
import { parentPath } from '@/features/profiles/api'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { Sheet } from '@/features/profiles/RecordParts'

/** One line of GET /staff/:id/action-log (apps/api ActionLogService). */
export interface ActionLogEntry {
  id: string
  action: string
  entity: string
  entityId: string
  reason: string | null
  at: string
  duringSupport: boolean
}

const L = {
  title: { en: 'Action log', ar: 'سجل الإجراءات' },
  hint: {
    en: 'Newest first, from the records the system keeps. A case shows only that it was acted on; open it to see more.',
    ar: 'الأحدث أولًا، من السجلات التي يحفظها النظام. الحالة تُظهر فقط أنه جرى عليها إجراء؛ افتحها لترى المزيد.',
  },
  empty: { en: 'Nothing recorded in this period.', ar: 'لا شيء مسجّل في هذه الفترة.' },
  period: { en: 'Period', ar: 'الفترة' },
  days30: { en: 'Last 30 days', ar: 'آخر 30 يومًا' },
  days90: { en: 'Last 90 days', ar: 'آخر 90 يومًا' },
  days365: { en: 'Last 12 months', ar: 'آخر 12 شهرًا' },
  more: { en: 'Load more', ar: 'عرض المزيد' },
  support: { en: 'During a support session', ar: 'خلال جلسة دعم' },
  // An act the list has no wording for is named by what it was about, never by its record key.
  acted: { en: 'Recorded an action', ar: 'سجّل إجراءً' },
  // Signing in and out, in words. A renewal is the app keeping the same sign-in alive.
  signedIn: { en: 'Signed in', ar: 'سجّل الدخول' },
  renewed: { en: 'Stayed signed in', ar: 'بقي مسجّلًا للدخول' },
  signedOut: { en: 'Signed out', ar: 'سجّل الخروج' },
  actedOn: { en: 'Recorded an action on {thing}', ar: 'سجّل إجراءً على {thing}' },
} satisfies Record<string, Pair>

/** Readable names for the acts a supervisor does most; any other is shown as recorded. */
const ACTION: Record<string, Pair> = {
  'supervision_case.opened': { en: 'Opened a case', ar: 'فتح حالة' },
  'supervision_case.assigned': { en: 'Assigned a case', ar: 'أسند حالة' },
  'supervision_case.status': { en: 'Changed a case\'s status', ar: 'غيّر حالة تصعيد' },
  'supervision_case.due': { en: 'Set a case\'s due date', ar: 'حدّد موعد حالة' },
  'supervision_case.note': { en: 'Added a note to a case', ar: 'أضاف ملاحظة إلى حالة' },
  'teacher.lateness_recorded': { en: 'Recorded a teacher lateness', ar: 'سجّل تأخر معلم' },
  'teacher.absence_recorded': { en: 'Recorded a teacher absence', ar: 'سجّل غياب معلم' },
  'teacher.complaint_upheld': { en: 'Upheld a complaint', ar: 'أيّد شكوى' },
  'teacher_evaluation.recorded': { en: 'Recorded an evaluation', ar: 'سجّل تقييمًا' },
  'teacher_evaluation.shared': { en: 'Shared an evaluation', ar: 'شارك تقييمًا' },
  'improvement_plan.created': { en: 'Created an improvement plan', ar: 'أنشأ خطة تحسين' },
  'improvement_plan.shared': { en: 'Shared an improvement plan', ar: 'شارك خطة تحسين' },
  'report_correction.requested': { en: 'Requested a report correction', ar: 'طلب تصحيح تقرير' },
  'lesson.report_edited': { en: 'Edited a lesson report', ar: 'عدّل تقرير حصة' },
  'lesson.ruling_decided': { en: 'Decided a ruling', ar: 'أصدر قرارًا' },
  'learner.supervisor_assigned': { en: 'Assigned a child to a supervisor', ar: 'أسند طفلًا إلى مشرف' },
  'seat.joined': { en: 'Joined a group', ar: 'انضم إلى مجموعة' },
  'seat.left': { en: 'Left a group', ar: 'غادر مجموعة' },
  // PD-47 PR-7: what they did to a task themselves (the task's id only).
  'task.created': { en: 'Gave a task', ar: 'أسند مهمة' },
  'task.reassigned': { en: 'Handed a task on', ar: 'أسند مهمة لغيره' },
  'task.out_of_scope': { en: 'Said a task was not theirs', ar: 'قال إن مهمة ليست من مسؤوليته' },
  'task.returned': { en: 'Returned a task with instructions', ar: 'أعاد مهمة بتعليمات' },
  'task.completed': { en: 'Completed a task', ar: 'أنجز مهمة' },
  'task.acknowledged': { en: 'Acknowledged a task no longer needed', ar: 'أقرّ بمهمة لم تعد مطلوبة' },
  'task.removed': { en: 'Removed a task', ar: 'أزال مهمة' },
  'task.commented': { en: 'Commented on a task', ar: 'علّق على مهمة' },
  'task.due_changed': { en: 'Changed a task\'s due date', ar: 'غيّر موعد مهمة' },
  'task.priority_changed': { en: 'Changed a task\'s level', ar: 'غيّر مستوى مهمة' },
  // PD-42: entering families by hand.
  ...ACTION_LOG,
}

/**
 * A sign-in record in words. The server writes one line each time a sign-in is
 * made, kept alive or ended; its reason there is a machine's word ("refresh",
 * "rotated"), so it is worded here and that word is not shown.
 */
function sessionAct(e: ActionLogEntry): Pair | null {
  if (e.action === 'session.created') return e.reason === 'login' ? L.signedIn : L.renewed
  if (e.action === 'session.revoked') return e.reason === 'rotated' ? L.renewed : L.signedOut
  return null
}
/** How many lines the log shows before "Load more". */
const GLANCE = 8
const MACHINE_REASONS = new Set(['login', 'refresh', 'rotated', 'logout'])

interface Line {
  entry: ActionLogEntry
  label: string
  /** How many records in a row say the same thing (a sign-in kept alive all morning is one line). */
  times: number
  session: boolean
}

/** What a line was about, for an act with no wording of its own. */
const THING: Record<string, Pair> = {
  supervision_case: { en: 'a case', ar: 'حالة' },
  work_task: { en: 'a task', ar: 'مهمة' },
  teacher: { en: 'a teacher', ar: 'معلم' },
  learner: { en: 'a student', ar: 'طالب' },
  conversation: { en: 'a conversation', ar: 'محادثة' },
  staff: { en: 'a staff member', ar: 'موظف' },
  contact: { en: 'a parent', ar: 'ولي أمر' },
  family: { en: 'a family', ar: 'أسرة' },
}

/** Where a line's subject is opened -- each page decides for itself whether the viewer may see it. */
function linkFor(e: ActionLogEntry): string | null {
  const id = encodeURIComponent(e.entityId)
  switch (e.entity) {
    case 'supervision_case':
      return `/cases?case=${id}`
    // PD-47: Tasks says plainly when the reader may not see it.
    case 'work_task':
      return `/tasks?task=${id}`
    case 'teacher':
      return `/teachers/files/${id}`
    case 'learner':
      return `/students/${id}`
    case 'conversation':
      return `/chat/${id}`
    case 'staff':
      return `/profile/${id}`
    case 'contact':
      return parentPath(e.entityId)
    default:
      return null
  }
}

/**
 * PD-35 B7: a staff member's action log, on their profile. Shown to whoever
 * the server lets read it (themselves, their department's manager, the super
 * admin); a "not found" shows nothing at all.
 */
const PERIODS = [
  { days: 30, label: L.days30 },
  { days: 90, label: L.days90 },
  { days: 365, label: L.days365 },
] as const

interface Page {
  entries: ActionLogEntry[]
  nextCursor: string | null
}

export function ActionLogSection({
  staffId,
  onReadable,
}: {
  staffId: string
  /** Told once the server has answered: whether this viewer may read the log at all. */
  onReadable?: (readable: boolean) => void
}) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const [days, setDays] = useState(30)
  // A glance first: the newest few lines, and the rest on request.
  const [expanded, setExpanded] = useState(false)
  const query = useInfiniteQuery({
    queryKey: ['action-log', staffId, days],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<Page>(`/staff/${encodeURIComponent(staffId)}/action-log`, {
        // 30 days is the server's default window; a longer one is asked for.
        ...(days !== 30 ? { from: new Date(Date.now() - days * 86_400_000).toISOString() } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor,
    // A new period keeps the lines on screen until it arrives.
    placeholderData: (previous) => previous,
    retry: false,
    staleTime: 30_000,
  })
  const refused = query.error instanceof ApiError && query.error.isNotFound
  const answered = Boolean(query.data) || Boolean(query.error)
  useEffect(() => {
    if (answered) onReadable?.(!refused)
  }, [answered, refused, onReadable])
  if (refused) return null
  if (!answered) return null
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? []
  const lines: Line[] = []
  for (const e of entries) {
    const act = sessionAct(e)
    const thing = THING[e.entity]
    const label = act ? tx(act) : ACTION[e.action] ? tx(ACTION[e.action]!) : thing ? tx(L.actedOn, { thing: tx(thing) }) : tx(L.acted)
    const last = lines[lines.length - 1]
    // Only sign-in records fold: every other act is about something and keeps its own line.
    if (act && last?.session && last.label === label && last.entry.duringSupport === e.duringSupport) last.times += 1
    else lines.push({ entry: e, label, times: 1, session: act !== null })
  }
  return (
    <Sheet
      id="sp-action-log"
      section="action-log"
      title={tx(L.title)}
      rule={tx(L.hint)}
      action={
        <label className="sp-period">
          <span className="sr-only">{tx(L.period)}</span>
          <SearchableSelect className="select" aria-label={tx(L.period)} value={days} onValueChange={(v) => setDays(Number(v))}>
            {PERIODS.map((p) => (
              <option key={p.days} value={p.days}>{tx(p.label)}</option>
            ))}
          </SearchableSelect>
        </label>
      }
    >
      <QueryBoundary isLoading={false} error={query.error} onRetry={() => void query.refetch()} compact>
        {entries.length === 0 ? (
          <p className="rec-empty">{tx(L.empty)}</p>
        ) : (
          <ol className="pp-tl pp-tl--newest-first sp-log">
            {(expanded ? lines : lines.slice(0, GLANCE)).map(({ entry: e, label, times, session }) => {
              const to = linkFor(e)
              return (
                <li key={e.id} className={session ? 'sp-log__line sp-log__line--session' : 'sp-log__line'}>
                  <div className="sp-log__what">
                    {to ? <Link to={to}>{label}</Link> : <strong>{label}</strong>}
                    {times > 1 && <span className="sp-repeat ltr">×{times}</span>}
                  </div>
                  <div className="pp-tl__when">
                    <time dateTime={e.at}>{dateTime(e.at)}</time>
                    {e.duringSupport && <> · <span>{tx(L.support)}</span></>}
                  </div>
                  {e.reason && !(session && MACHINE_REASONS.has(e.reason)) && (
                    <div className="pp-tl__when">
                      <span dir="auto">{e.reason}</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
        {(query.hasNextPage || (!expanded && lines.length > GLANCE)) && (
          <p className="sp-sheet__more">
            <button
              type="button"
              className="btn btn--sm"
              disabled={query.isFetchingNextPage}
              onClick={() => {
                // First the lines already here; once they are all shown, the next page.
                const hidden = !expanded && lines.length > GLANCE
                setExpanded(true)
                if (!hidden) void query.fetchNextPage()
              }}
            >
              {tx(L.more)}
            </button>
          </p>
        )}
      </QueryBoundary>
    </Sheet>
  )
}
