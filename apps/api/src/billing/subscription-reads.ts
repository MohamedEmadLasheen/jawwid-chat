import type { LearnerSubscription } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import { day } from './validate';

/**
 * PD-30: what a child's subscriptions add up to. Plain reads over the ledger
 * (chat.learner_subscription) and the state the database keeps
 * (chat.learner_access); shared by the parent's /me/billing, the staff views
 * and the lesson report's "Lesson N of M". Nothing here decides access.
 */

export type AccessState = 'open' | 'grace' | 'locked';

export interface ChildSubscription {
  child: { id: string; name: string };
  /** The subscription running today (else the next one, else the last). Null: none recorded. */
  current: { id: string; planMonths: number | null; lessonsIncluded: number; startsOn: string } | null;
  /** Every standing subscription together. Null when there is none. */
  lessonsIncluded: number | null;
  lessonsUsed: number | null;
  lessonsLeft: number | null;
  /** Lessons that may still take place after the balance ran out, before the group locks. */
  graceLeft: number | null;
  state: AccessState;
  /** 'balance' and / or 'overdue' -- why it is locked. */
  lockReasons: string[];
  overdue: { instalmentId: string; label: string; dueDate: string } | null;
}

/** What staff also see: the signed balance, the reasons an exception holds off, the hold. */
export interface StaffChildSubscription extends ChildSubscription {
  balance: number | null;
  excepted: string[];
  held: boolean;
}

type AccessRow = {
  learner_id: string;
  state: AccessState;
  reasons: string[];
  excepted: string[];
  balance: number | null;
  grace_left: number | null;
  overdue_instalment_id: string | null;
  overdue_due_on: string | null;
  held: boolean;
};

export async function academyToday(prisma: PrismaService): Promise<string> {
  const rows = await prisma.$queryRaw<{ today: string }[]>`SELECT chat.pd030_today()::text AS today`;
  return rows[0]!.today;
}

/** Standing rows in the order they are used up: by start day, then as added. */
export function standingInOrder(rows: LearnerSubscription[]): LearnerSubscription[] {
  return rows
    .filter((r) => r.voidedAt === null)
    .sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

/** The subscription running on `today`: the latest started one, else the first still to start. */
export function currentOf(standing: LearnerSubscription[], today: string): LearnerSubscription | null {
  if (standing.length === 0) return null;
  const started = standing.filter((r) => day(r.startsOn) <= today);
  return started.length > 0 ? started[started.length - 1]! : standing[0]!;
}

/**
 * PD-30 (9): "Lesson N of M" for the next lesson -- its place in the
 * subscription it falls in. The lessons used so far fill the subscriptions in
 * order; the next one is in the first that is not full. Past the last one (a
 * grace lesson) it stays in the last: N > M says so. Null without a ledger.
 */
export function positionOf(standing: LearnerSubscription[], used: number): { n: number; m: number } | null {
  if (standing.length === 0) return null;
  const next = used + 1;
  let before = 0;
  for (const row of standing) {
    if (next <= before + row.lessonsIncluded) return { n: next - before, m: row.lessonsIncluded };
    before += row.lessonsIncluded;
  }
  const last = standing[standing.length - 1]!;
  return { n: next - (before - last.lessonsIncluded), m: last.lessonsIncluded };
}

/**
 * PD-42: the lessons a carried-over package had already used in Jawwid Core
 * (entered as they stood). They count as used, exactly as
 * chat.compute_learner_access counts them: 12 done of 20 -> "Lesson 13 of 20".
 */
export function lessonsUsedBefore(standing: LearnerSubscription[]): number {
  return standing.reduce((n, r) => n + r.lessonsUsedBefore, 0);
}

export async function lessonPosition(prisma: PrismaService, learnerId: string): Promise<{ n: number; m: number } | null> {
  const standing = standingInOrder(await prisma.learnerSubscription.findMany({ where: { learnerId } }));
  if (standing.length === 0) return null;
  const rows = await prisma.$queryRaw<{ used: number }[]>`
    SELECT chat.learner_lessons_used(${learnerId}::uuid, ${day(standing[0]!.startsOn)}::date) AS used`;
  return positionOf(standing, Number(rows[0]?.used ?? 0) + lessonsUsedBefore(standing));
}

/** Each child's subscription standing, for a family (or the listed children of it). */
export async function childSubscriptions(
  prisma: PrismaService,
  familyId: string,
  learnerIds?: string[],
): Promise<StaffChildSubscription[]> {
  const learners = await prisma.learner.findMany({
    where: { familyId, ...(learnerIds ? { id: { in: learnerIds } } : {}) },
    select: { id: true, name: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (learners.length === 0) return [];
  const ids = learners.map((l) => l.id);
  const [today, ledger, access, labels] = await Promise.all([
    academyToday(prisma),
    prisma.learnerSubscription.findMany({ where: { learnerId: { in: ids } } }),
    prisma.$queryRaw<AccessRow[]>`
      SELECT a.learner_id::text, a.state, a.reasons, a.excepted, a.balance, a.grace_left,
             a.overdue_instalment_id::text, to_char(a.overdue_due_on, 'YYYY-MM-DD') AS overdue_due_on, a.held
        FROM chat.learner_access a WHERE a.learner_id = ANY(${ids}::uuid[])`,
    prisma.familyInstalment.findMany({ where: { familyId }, select: { id: true, label: true } }),
  ]);
  const accessOf = new Map(access.map((a) => [a.learner_id, a]));
  const labelOf = new Map(labels.map((i) => [i.id, i.label]));
  return learners.map((l) => {
    const standing = standingInOrder(ledger.filter((r) => r.learnerId === l.id));
    const current = currentOf(standing, today);
    const a = accessOf.get(l.id);
    const included = standing.length > 0 ? standing.reduce((n, r) => n + r.lessonsIncluded, 0) : null;
    const balance = included === null ? null : a?.balance ?? included - lessonsUsedBefore(standing);
    return {
      child: { id: l.id, name: l.name },
      current: current
        ? { id: current.id, planMonths: current.planMonths, lessonsIncluded: current.lessonsIncluded, startsOn: day(current.startsOn) }
        : null,
      lessonsIncluded: included,
      lessonsUsed: included === null || balance === null ? null : included - balance,
      lessonsLeft: balance === null ? null : Math.max(0, balance),
      graceLeft: balance !== null && balance <= 0 ? a?.grace_left ?? null : null,
      state: a?.state ?? 'open',
      lockReasons: a?.reasons ?? [],
      overdue:
        a?.overdue_instalment_id && a.overdue_due_on
          ? { instalmentId: a.overdue_instalment_id, label: labelOf.get(a.overdue_instalment_id) ?? '', dueDate: a.overdue_due_on }
          : null,
      balance,
      excepted: a?.excepted ?? [],
      held: a?.held ?? false,
    };
  });
}

/**
 * The parent's view: nothing about exceptions (the owner's rule). A child an
 * exception lets go on past the balance reads as open with no lessons left;
 * the grace countdown is not shown for it.
 */
export function forParent(s: StaffChildSubscription): ChildSubscription {
  const excused = s.excepted.includes('balance');
  return {
    child: s.child,
    current: s.current,
    lessonsIncluded: s.lessonsIncluded,
    lessonsUsed: s.lessonsUsed,
    lessonsLeft: s.lessonsLeft,
    graceLeft: excused ? null : s.graceLeft,
    state: s.state,
    lockReasons: s.lockReasons,
    overdue: s.overdue,
  };
}
