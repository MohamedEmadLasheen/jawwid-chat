import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PD-30: is a child's group locked for payment?
 *
 * The STATE is the database's (chat.learner_access, kept by
 * chat.refresh_learner_access in every writer's transaction). This reader only
 * answers the two questions enforcement asks -- "is this conversation locked,
 * and for which children?" and "is this child locked?" -- and says whether
 * enforcement is on at all.
 *
 * SUBSCRIPTION_LOCK_ENFORCED switches enforcement, not the state: with it off
 * the ledger, the balance and the state are still computed and shown to staff
 * and parents, and nothing is refused. Owner decision 2026-10-26: on in
 * staging, off in production until the owner turns it on.
 */
export interface LockedChild {
  learnerId: string;
  learnerName: string;
  /** 'balance' and / or 'overdue'. */
  reasons: string[];
  /** The overdue instalment's label and due day, when 'overdue' is a reason. */
  instalmentLabel: string | null;
  overdueDueOn: string | null;
}

export interface SubscriptionLockReader {
  /** SUBSCRIPTION_LOCK_ENFORCED, read on every call so a test may flip it. */
  readonly enforced: boolean;
  /** The locked children a family or student group is about; [] when it is not locked or not a group. */
  lockedChildren(conversationId: string): Promise<LockedChild[]>;
  /** Whether one child is locked (state, whatever the switch says). */
  isLocked(learnerId: string): Promise<boolean>;
  /**
   * PD-30 <-> PD-31 interface (department head, 2026-10-26): chat.learner_lesson_lock --
   * null when open (grace included), else why: 'balance' | 'overdue' ('overdue' wins).
   * The state, whatever the switch says; check `enforced` before refusing.
   */
  lockOf(learnerId: string): Promise<'balance' | 'overdue' | null>;
}

/** 'true' / '1' / 'yes' / 'on', any case: enforced. Anything else, or unset: off. */
export function subscriptionLockEnforced(): boolean {
  return ['true', '1', 'yes', 'on'].includes((process.env.SUBSCRIPTION_LOCK_ENFORCED ?? '').trim().toLowerCase());
}

/** No locks at all: what a construction without the reader gets (unit harnesses). */
export const NO_SUBSCRIPTION_LOCK: SubscriptionLockReader = Object.freeze({
  enforced: false,
  lockedChildren: async () => [],
  isLocked: async () => false,
  lockOf: async () => null,
});

@Injectable()
export class SqlSubscriptionLock implements SubscriptionLockReader {
  constructor(private readonly prisma: PrismaService) {}

  get enforced(): boolean {
    return subscriptionLockEnforced();
  }

  async lockedChildren(conversationId: string): Promise<LockedChild[]> {
    // Computed now (chat.compute_learner_access, as chat.learner_lesson_lock
    // does), never read from a possibly stale state row. The children a group
    // is about: its chat.conversation_learner rows, its student; a group with
    // neither falls back to every child of its family (fail closed).
    const rows = await this.prisma.$queryRaw<
      Array<{ learner_id: string; name: string; reasons: string[]; label: string | null; due: string | null }>
    >`
      WITH conv AS (
        SELECT c.id, c.type, c.family_id, c.learner_id FROM chat.conversation c
         WHERE c.id = ${conversationId}::uuid AND c.type IN ('family_group', 'student_group')
      ), named AS (
        SELECT cl.learner_id FROM chat.conversation_learner cl JOIN conv ON conv.id = cl.conversation_id
        UNION
        SELECT conv.learner_id FROM conv WHERE conv.learner_id IS NOT NULL
      ), children AS (
        SELECT learner_id FROM named
        UNION
        SELECT l.id FROM chat.learner l JOIN conv ON conv.family_id = l.family_id
         WHERE NOT EXISTS (SELECT 1 FROM named)
      )
      SELECT l.id::text AS learner_id, l.name, c.reasons, i.label, to_char(c.overdue_due_on, 'YYYY-MM-DD') AS due
        FROM children ch
        JOIN chat.learner l ON l.id = ch.learner_id
        CROSS JOIN LATERAL chat.compute_learner_access(l.id) c
        LEFT JOIN chat.family_instalment i ON i.id = c.overdue_instalment_id
       WHERE c.state = 'locked'
       ORDER BY l.name, l.id`;
    return rows.map((r) => ({
      learnerId: r.learner_id,
      learnerName: r.name,
      reasons: r.reasons,
      instalmentLabel: r.label,
      overdueDueOn: r.due,
    }));
  }

  async isLocked(learnerId: string): Promise<boolean> {
    return (await this.lockOf(learnerId)) !== null;
  }

  /** chat.learner_lesson_lock: null when open (grace included), else 'balance' | 'overdue' ('overdue' wins). */
  async lockOf(learnerId: string): Promise<'balance' | 'overdue' | null> {
    const rows = await this.prisma.$queryRaw<Array<{ lock: 'balance' | 'overdue' | null }>>`
      SELECT chat.learner_lesson_lock(${learnerId}::uuid) AS lock`;
    return rows[0]?.lock ?? null;
  }
}
