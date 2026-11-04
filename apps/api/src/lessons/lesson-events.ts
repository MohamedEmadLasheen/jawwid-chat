import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommEvent, type LessonChange, type LessonChangedPayload, type ScheduleRefreshedPayload } from '../communication/contracts/events';
import { notifyOutboxWake } from '../communication/outbox/outbox-wake';

type Tx = Prisma.TransactionClient;

/** How many unannounced changes one sweep takes (the rest wait for the next). */
export const UNANNOUNCED_BATCH = 500;

/** How many batches of non-weekly changes one sweep takes before yielding the tick. */
export const UNANNOUNCED_ROUNDS = 20;

/**
 * PD-46 §3.2-3.4: every lesson change is announced, once.
 *
 * The database notes EVERY change a reader sees in
 * chat.lesson_change_unannounced, by (lesson, revision). Then:
 *
 *   record()               the writer's path: in the caller's transaction, one
 *                          `lesson.changed` per lesson, keyed
 *                          lesson:<id>:<revision>:<change> (a retried
 *                          transaction enqueues nothing new), and the noted rows
 *                          of exactly those lessons, up to the revision
 *                          announced, deleted -- so the sweep does not announce
 *                          them again. A lesson changed in the same transaction
 *                          but not passed here keeps its row and is swept.
 *   announceUnannounced()  the safety net's sweep: whatever is left -- a writer
 *                          that bypassed record(), a raw SQL update -- is
 *                          announced late but never lost. Lessons created from a
 *                          weekly time become ONE `schedule.refreshed` per
 *                          organization per sweep (plan §2, Q8), everything
 *                          else a `lesson.changed` with change `external`.
 *
 * A signal, never content: clients refetch through their authorized routes.
 */
@Injectable()
export class LessonEvents {
  constructor(private readonly prisma: PrismaService) {}

  /** One `lesson.changed` per lesson (current revision), in `tx`. Returns how many were new. */
  async record(tx: Tx, lessonIds: readonly string[], change: LessonChange): Promise<number> {
    const ids = [...new Set(lessonIds)];
    if (ids.length === 0) return 0;
    const payloads = await this.payloads(tx, ids, change);
    // One statement for every lesson (#420 review), not one per lesson: a
    // weekly-times change or a pause announces many inside a locked transaction.
    const at = new Date();
    const enqueued = payloads.length === 0 ? 0 : await tx.$executeRaw`
      INSERT INTO chat.outbox_event (id, type, payload, status, attempts, available_at, created_at, idempotency_key)
      SELECT gen_random_uuid(), ${CommEvent.LESSON_CHANGED}, p.payload, 'pending', 0, ${at}, ${at}, p.key
        FROM unnest(${payloads.map((p) => JSON.stringify(p))}::jsonb[],
                    ${payloads.map((p) => `lesson:${p.lessonId}:${p.revision}:${p.change}`)}::text[]) AS p(payload, key)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`;
    // Announced up to this revision: one signal covers every earlier change of
    // the lesson too (clients refetch the current row).
    await tx.$executeRaw`
      DELETE FROM chat.lesson_change_unannounced u
       USING (SELECT unnest(${payloads.map((p) => p.lessonId)}::uuid[]) AS lesson_id,
                     unnest(${payloads.map((p) => p.revision)}::bigint[]) AS revision) d
       WHERE u.lesson_id = d.lesson_id AND u.revision <= d.revision`;
    if (enqueued > 0) notifyOutboxWake();
    return enqueued;
  }

  /** The safety net's sweep, until it is drained (or UNANNOUNCED_ROUNDS batches). Returns what it announced. */
  async announceUnannounced(limit = UNANNOUNCED_BATCH): Promise<{ lessons: number; refreshed: number }> {
    const refreshed = await this.announceMaterialized();
    let lessons = 0;
    for (let round = 0; round < UNANNOUNCED_ROUNDS; round++) {
      const batch = await this.announceBatch(limit);
      lessons += batch.announced;
      if (batch.taken < limit) break;
    }
    return { lessons, refreshed };
  }

  /**
   * Every lesson a weekly time created since the last sweep, all at once: one
   * `schedule.refreshed` per organization, however many lessons a
   * materialization wrote (plan §2, Q8).
   */
  private async announceMaterialized(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ organization_id: string; teacher_id: string; learner_id: string | null }>>`
        WITH taken AS (
          SELECT lesson_id, revision FROM chat.lesson_change_unannounced
           WHERE from_slot FOR UPDATE SKIP LOCKED),
        gone AS (
          DELETE FROM chat.lesson_change_unannounced u USING taken t
           WHERE u.lesson_id = t.lesson_id AND u.revision = t.revision
          RETURNING u.lesson_id, u.organization_id, u.teacher_id)
        SELECT DISTINCT g.organization_id::text, g.teacher_id::text, l.learner_id::text
          FROM gone g LEFT JOIN chat.lesson l ON l.id = g.lesson_id`;
      const byOrg = new Map<string, { teachers: Set<string>; learners: Set<string> }>();
      for (const r of rows) {
        const batch = byOrg.get(r.organization_id) ?? { teachers: new Set<string>(), learners: new Set<string>() };
        batch.teachers.add(r.teacher_id);
        if (r.learner_id) batch.learners.add(r.learner_id);
        byOrg.set(r.organization_id, batch);
      }
      for (const [organizationId, batch] of byOrg) {
        const payload: ScheduleRefreshedPayload = {
          organizationId, teacherIds: [...batch.teachers].sort(), learnerIds: [...batch.learners].sort(),
        };
        await tx.outboxEvent.create({ data: { type: CommEvent.SCHEDULE_REFRESHED, payload: payload as unknown as Prisma.InputJsonValue } });
      }
      if (byOrg.size > 0) notifyOutboxWake();
      return byOrg.size;
    });
  }

  /** One batch of the other changes: a signal per lesson at its CURRENT revision. */
  private async announceBatch(limit: number): Promise<{ taken: number; announced: number }> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ lesson_id: string; revision: bigint }>>`
        SELECT lesson_id::text, revision
          FROM chat.lesson_change_unannounced
         WHERE NOT from_slot
         ORDER BY recorded_at
         LIMIT ${limit}
           FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return { taken: 0, announced: 0 };
      // Several unannounced revisions of one lesson are one signal.
      const ids = [...new Set(rows.map((x) => x.lesson_id))];
      let announced = 0;
      for (const p of await this.payloads(tx, ids, 'external')) {
        announced += await this.enqueueKeyed(tx, `lesson:${p.lessonId}:${p.revision}:external`, CommEvent.LESSON_CHANGED, p);
      }
      await tx.$executeRaw`
        DELETE FROM chat.lesson_change_unannounced u
         USING (SELECT unnest(${rows.map((r) => r.lesson_id)}::uuid[]) AS lesson_id,
                       unnest(${rows.map((r) => r.revision)}::bigint[]) AS revision) d
         WHERE u.lesson_id = d.lesson_id AND u.revision = d.revision`;
      if (announced > 0) notifyOutboxWake();
      return { taken: rows.length, announced };
    });
  }

  private async payloads(tx: Tx, ids: string[], change: LessonChange): Promise<LessonChangedPayload[]> {
    if (ids.length === 0) return [];
    const rows = await tx.$queryRaw<Array<{
      id: string; revision: bigint; teacher_id: string; learner_id: string | null; organization_id: string;
      starts_at: Date; previous_starts_at: Date | null; conversation_ids: string[] | null;
    }>>`
      SELECT l.id::text, l.revision, l.teacher_id::text, l.learner_id::text, l.organization_id::text,
             l.starts_at, prev.starts_at AS previous_starts_at,
             (SELECT array_agg(c.id::text ORDER BY c.created_at)
                FROM chat.conversation c
               WHERE c.archived_at IS NULL AND c.organization_id = l.organization_id AND l.learner_id IS NOT NULL
                 AND ((c.type = 'student_group' AND c.learner_id = l.learner_id)
                      OR (c.type = 'family_group' AND EXISTS (
                            SELECT 1 FROM chat.conversation_learner cl WHERE cl.conversation_id = c.id AND cl.learner_id = l.learner_id)))
             ) AS conversation_ids
        FROM chat.lesson l
        LEFT JOIN chat.lesson prev ON prev.id = l.moved_from
       WHERE l.id = ANY (${ids}::uuid[])`;
    return rows.map((r) => ({
      lessonId: r.id,
      revision: Number(r.revision),
      change,
      teacherId: r.teacher_id,
      learnerId: r.learner_id,
      organizationId: r.organization_id,
      startsAt: r.starts_at.toISOString(),
      previousStartsAt: change === 'moved' && r.previous_starts_at ? r.previous_starts_at.toISOString() : null,
      conversationIds: r.conversation_ids ?? [],
    }));
  }

  /**
   * 1 when this key is new, 0 when it was already enqueued. Timestamped by THIS
   * process's clock, as every other outbox row is (Prisma's client-side
   * default): the worker claims by its own clock, and a database clock ahead of
   * it would leave the row unclaimable for as long as the skew.
   */
  private async enqueueKeyed(tx: Tx, key: string, type: string, payload: object): Promise<number> {
    const at = new Date();
    return tx.$executeRaw`
      INSERT INTO chat.outbox_event (id, type, payload, status, attempts, available_at, created_at, idempotency_key)
      VALUES (gen_random_uuid(), ${type}, ${JSON.stringify(payload)}::jsonb, 'pending', 0, ${at}, ${at}, ${key})
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`;
  }
}
