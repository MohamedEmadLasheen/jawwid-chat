import { Badge } from '@/shared/components/Badge'
import type { ReportStatus } from './api'
import { MOD, useCopy } from './copy'
import { dueClock } from './dueClock'

/** The time left against the 24 h, or how late it is. Plain Latin digits, as the rest of the console. */
export function DueClockView({ dueAt, status, nowMs, overdueAt }: { dueAt: string; status: ReportStatus; nowMs: number; overdueAt?: string | null }) {
  const tx = useCopy()
  const c = dueClock(dueAt, status, nowMs, overdueAt)
  if (c.state === 'closed') return <span>{tx(MOD.closed)}</span>
  const text = tx(c.state === 'overdue' ? MOD.past : MOD.left, { h: c.hours, m: c.minutes })
  // Plenty of time is plain text; a tag only when the time is short or past.
  return (
    <span data-testid="due-clock" data-state={c.state}>
      {c.state === 'ok' ? <span className="mod-left">{text}</span> : <Badge tone={c.state === 'overdue' ? 'danger' : 'warn'} dot>{text}</Badge>}
    </span>
  )
}
