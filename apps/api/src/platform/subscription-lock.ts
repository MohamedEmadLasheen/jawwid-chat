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

export function subscriptionLockEnforced(): boolean {
  return process.env.SUBSCRIPTION_LOCK_ENFORCED === 'true';
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
    const rows = await this.prisma.$queryRaw<
      Array<{ learner_id: string; name: string; reasons: string[]; label: string | null; due: string | null }>
    >`
      SELECT a.learner_id::text, l.name, a.reasons, i.label, to_char(a.overdue_due_on, 'YYYY-MM-DD') AS due
        FROM chat.learner_access a
        JOIN chat.learner l ON l.id = a.learner_id
        LEFT JOIN chat.family_instalment i ON i.id = a.overdue_instalment_id
       WHERE chat.learner_lesson_lock(a.learner_id) IS NOT NULL
         AND a.learner_id IN (
           SELECT cl.learner_id FROM chat.conversation_learner cl
             JOIN chat.conversation c ON c.id = cl.conversation_id
            WHERE c.id = ${conversationId}::uuid AND c.type = 'family_group'
           UNION
           SELECT c.learner_id FROM chat.conversation c
            WHERE c.id = ${conversationId}::uuid AND c.type = 'student_group' AND c.learner_id IS NOT NULL)
       ORDER BY l.name, a.learner_id`;
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
