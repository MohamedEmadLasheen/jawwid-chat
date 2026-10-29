import type { Pair } from '@/features/organization/copy'
import type { TaskSummary } from './api'
import { REASON_LABEL, SOURCE_REASON, SOURCE_TITLE, STATE_LABEL } from './copy'

type Tx = (pair: Pair, params?: Record<string, string | number>) => string
interface Fmt {
  locale: string
  dateTime: (iso: string) => string
  date: (iso: string) => string
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))

/** Money in its minor unit (piastres, cents), in the viewer's language. */
export function money(minor: unknown, currency: unknown, locale: string): string {
  const n = Number(minor)
  const code = str(currency)
  if (!Number.isFinite(n) || !/^[A-Z]{3}$/.test(code)) return ''
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { style: 'currency', currency: code }).format(n / 100)
}

/** A day on the academy's calendar (YYYY-MM-DD), shown as a date. */
const day = (v: unknown, fmt: Fmt) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? fmt.date(`${v.slice(0, 10)}T12:00:00Z`) : '')

/**
 * What the task says. A manual task's title is a person's words; a system
 * task's is ours, filled from its source now (the server sends the params).
 */
export function titleOf(t: Pick<TaskSummary, 'title' | 'source' | 'titleParams'>, tx: Tx, fmt: Fmt): string {
  if (!t.source) return t.title
  const p = t.titleParams ?? {}
  const pair = SOURCE_TITLE[t.source.type]
  if (!pair) return t.title || t.source.type
  return tx(pair, {
    learner: str(p.learnerName),
    teacher: str(p.teacherName),
    family: str(p.familyName),
    title: str(p.caseTitle),
    label: str(p.label),
    balance: str(p.balance),
    count: str(p.count),
    prospect: str(p.prospectName),
    when: typeof p.startsAt === 'string' ? fmt.dateTime(p.startsAt) : '',
    first: day(p.firstDay, fmt),
    last: day(p.lastDay, fmt),
    amount: money(p.amountMinor, p.currency, fmt.locale),
  })
}

/** The one state a person reads on a row. */
export function stateOf(t: Pick<TaskSummary, 'state' | 'outcome' | 'instructions' | 'sourceState'>): keyof typeof STATE_LABEL {
  if (t.state === 'completed') return t.outcome === 'acknowledged' ? 'acknowledged' : 'completed'
  if (t.state === 'removed') return 'removed'
  if (t.sourceState === 'withdrawn') return 'withdrawn'
  if (t.state === 'awaiting_decision') return 'awaiting_decision'
  return t.instructions ? 'returned' : 'open'
}

export const STATE_TONE: Record<keyof typeof STATE_LABEL, 'warn' | 'info' | 'ok' | 'neutral' | 'waiting'> = {
  open: 'info',
  returned: 'warn',
  awaiting_decision: 'waiting',
  withdrawn: 'neutral',
  completed: 'ok',
  acknowledged: 'ok',
  removed: 'neutral',
}

/** Why the level is what it is, when something raised it; a person's level needs no reason. */
export function reasonOf(t: Pick<TaskSummary, 'priorityReason' | 'source'>, tx: Tx): string | null {
  if (t.priorityReason === 'manual') return null
  if (t.priorityReason === 'source') {
    const own = t.source ? SOURCE_REASON[t.source.type] : undefined
    return tx(own ?? REASON_LABEL.source)
  }
  return tx(REASON_LABEL[t.priorityReason])
}

/** Where the work behind a system task is done, in this app. */
export function sourceLink(t: Pick<TaskSummary, 'source' | 'titleParams'>): string | null {
  if (!t.source) return null
  const learner = typeof t.titleParams?.learnerId === 'string' ? t.titleParams.learnerId : null
  switch (t.source.type) {
    case 'case':
      return `/cases?case=${encodeURIComponent(t.source.id)}`
    case 'leave_decision':
      return '/teachers/leave'
    case 'violation_decision':
      return '/teachers/discipline'
    case 'lesson_report':
    case 'report_correction':
    case 'lesson_ruling':
      return '/teachers/needs-action'
    case 'instalment':
      return learner ? `/students/${encodeURIComponent(learner)}` : '/instalments'
    case 'package_low':
    case 'renewal_request':
      return learner ? `/students/${encodeURIComponent(learner)}` : null
    case 'receipt_review':
    case 'checkout_failed':
      return '/payments'
    case 'family_unsupervised':
    case 'new_student_assign':
    case 'new_student_group':
      return '/trials/new-students'
    case 'teacher_setup':
      return `/teachers/files/${encodeURIComponent(t.source.id)}`
    case 'teacher_unsupervised':
      // The source is the spell; its teacher comes with the title.
      return typeof t.titleParams?.teacherId === 'string' ? `/teachers/files/${encodeURIComponent(t.titleParams.teacherId)}` : null
    default:
      return null
  }
}
