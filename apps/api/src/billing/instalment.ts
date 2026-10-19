/**
 * PD-12 S3: an instalment's derived status and the page's order. Pure, so the
 * rules are unit-testable whole.
 *
 *   status = paid      Core says paid
 *            overdue   open, due before today
 *            due       open, due today
 *            upcoming  open, due after today
 *   (today is the academy's day, in schedule.timezone)
 *
 *   order  = overdue (oldest first) > due today > upcoming (soonest) > paid (latest first)
 */
export type InstalmentStatus = 'overdue' | 'due' | 'upcoming' | 'paid';

export function statusOf(inv: { status: 'open' | 'paid'; dueDate: string }, today: string): InstalmentStatus {
  if (inv.status === 'paid') return 'paid';
  if (inv.dueDate < today) return 'overdue';
  if (inv.dueDate === today) return 'due';
  return 'upcoming';
}

const RANK: Record<InstalmentStatus, number> = { overdue: 0, due: 1, upcoming: 2, paid: 3 };

export function compareInstalments(
  a: { status: InstalmentStatus; dueDate: string; id: string },
  b: { status: InstalmentStatus; dueDate: string; id: string },
): number {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
  const byDate = a.status === 'paid' ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate);
  return byDate || a.id.localeCompare(b.id);
}

/** Whole days late (overdue) or until due (upcoming); 0 today. */
export function daysFrom(today: string, dueDate: string): number {
  return Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
