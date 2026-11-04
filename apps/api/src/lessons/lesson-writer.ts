import type { Prisma } from '@prisma/client';
import type { LessonChange } from '../communication/contracts/events';
import { PrismaService } from '../platform/prisma.service';
import { LessonEvents } from './lesson-events';

type Tx = Prisma.TransactionClient;

/**
 * PD-46 §3.1: the ONE TypeScript path that writes chat.lesson.
 *
 * Every create and update goes through here, in the caller's transaction, and
 * is announced in that same transaction (LessonEvents.record: one keyed
 * `lesson.changed` per lesson, at the revision the write produced, and that
 * lesson's safety-net rows taken back). Nothing here decides whether a write is
 * allowed -- the callers and the database guards still do; this only makes sure
 * no write is silent.
 *
 * The guard `scripts/qa/guards.sh lesson-writer` refuses a `.lesson.create /
 * update / updateMany / upsert` or an `UPDATE chat.lesson` anywhere else in
 * src/.
 *
 * The SQL writers (chat.materialize_lessons, chat.transfer_learner) stay
 * set-based in SQL. The database notes every change they make
 * (chat.lesson_change_unannounced), in any transaction, and the worker's sweep
 * announces what no writer took back -- weekly lessons as one
 * schedule.refreshed. There is no transaction-wide flag to lift (#390 review).
 */
export class LessonWriter {
  private readonly events: LessonEvents;

  constructor(prisma: PrismaService) {
    this.events = new LessonEvents(prisma);
  }

  /** Insert one lesson and announce it. */
  async create<I extends Prisma.LessonInclude | undefined = undefined>(
    tx: Tx,
    change: LessonChange,
    data: Prisma.LessonUncheckedCreateInput,
    include?: I,
  ): Promise<Prisma.LessonGetPayload<{ include: I }>> {
    const row = await tx.lesson.create({ data, include: include as I });
    await this.events.record(tx, [row.id], change);
    return row as Prisma.LessonGetPayload<{ include: I }>;
  }

  /** Update one lesson by id and announce it. */
  async update<I extends Prisma.LessonInclude | undefined = undefined>(
    tx: Tx,
    change: LessonChange,
    id: string,
    data: Prisma.LessonUncheckedUpdateInput,
    include?: I,
  ): Promise<Prisma.LessonGetPayload<{ include: I }>> {
    const row = await tx.lesson.update({ where: { id }, data, include: include as I });
    await this.events.record(tx, [id], change);
    return row as Prisma.LessonGetPayload<{ include: I }>;
  }

  /** Update every lesson `where` matches, announce each one, and return their ids (`count` = ids.length). */
  async updateMany(
    tx: Tx,
    change: LessonChange,
    where: Prisma.LessonWhereInput,
    data: Prisma.LessonUncheckedUpdateManyInput,
  ): Promise<string[]> {
    const rows = await tx.lesson.updateManyAndReturn({ where, data, select: { id: true } });
    const ids = rows.map((r) => r.id);
    await this.events.record(tx, ids, change);
    return ids;
  }


  /** Announce lessons a raw statement of the caller's changed (its `RETURNING id`). */
  async announce(tx: Tx, change: LessonChange, ids: readonly string[]): Promise<void> {
    await this.events.record(tx, ids, change);
  }

  /**
   * Bookkeeping no reader sees (reminders were scheduled): the revision does
   * not move, so there is nothing to announce and the safety net records nothing.
   */
  static async markRemindersScheduled(db: Pick<Tx, 'lesson'>, id: string): Promise<void> {
    await db.lesson.update({ where: { id }, data: { remindersScheduledAt: new Date() } });
  }

}

/** The announced kind of a change that sets this outcome. */
export function changeOfOutcome(outcome: string | null): LessonChange {
  switch (outcome) {
    case 'held':
      return 'held';
    case 'student_apology':
    case 'teacher_apology':
    case 'admin_cancelled':
      return 'cancelled';
    case 'rescheduled':
      return 'moved';
    case 'suspended':
      return 'paused';
    default:
      return 'outcome';
  }
}
