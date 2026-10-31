import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommEvent, type LessonChange, type LessonChangedPayload, type ScheduleRefreshedPayload } from '../communication/contracts/events';
import { notifyOutboxWake } from '../communication/outbox/outbox-wake';

type Tx = Prisma.TransactionClient;

/** How many unannounced changes one sweep takes (the rest wait for the next). */
export const UNANNOUNCED_BATCH = 500;

/**
 * PD-46 §3.2-3.4: every lesson change is announced, once.
 *
 *   record()               the writer's path: in the caller's transaction, one
 *                          `lesson.changed` per lesson, keyed
 *                          lesson:<id>:<revision>:<change> (a retried
 *                          transaction enqueues nothing new), and the
 *                          transaction marked as the writer, so the safety net
 *                          (chat.lesson_change_unannounced) stands aside.
 *   announceUnannounced()  the safety net's sweep: whatever changed WITHOUT the
 *                          writer -- weekly materialization, a raw SQL update --
 *                          is announced late but never lost. Lessons created
 *                          from a weekly time become ONE `schedule.refreshed`
 *                          per batch (plan §2, Q8), everything else a
 *                          `lesson.changed` with change `external`.
 *
 * A signal, never content: clients refetch through their authorized routes.
 */
@Injectable()
export class LessonEvents {
  constructor(private readonly prisma: PrismaService) {}

  /** This transaction announces its own lesson changes. */
  static async markWriter(tx: Tx): Promise<void> {
    await tx.$queryRaw`SELECT set_config('chat.lesson_writer', 'on', true)`;
  }

  /** One `lesson.changed` per lesson (current revision), in `tx`. Returns how many were new. */
  async record(tx: Tx, lessonIds: readonly string[], change: LessonChange): Promise<number> {
    await LessonEvents.markWriter(tx);
    const ids = [...new Set(lessonIds)];
    if (ids.length === 0) return 0;
    const payloads = await this.payloads(tx, ids, change);
    let enqueued = 0;
    for (const p of payloads) enqueued += await this.enqueueKeyed(tx, `lesson:${p.lessonId}:${p.revision}:${p.change}`, CommEvent.LESSON_CHANGED, p);
    if (enqueued > 0) notifyOutboxWake();
    return enqueued;
  }

  /** The safety net's sweep. Returns what it announced. */
  async announceUnannounced(limit = UNANNOUNCED_BATCH): Promise<{ lessons: number; refreshed: number }> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ lesson_id: string; revision: bigint; organization_id: string; teacher_id: string; from_slot: boolean }>>`
        SELECT lesson_id::text, revision, organization_id::text, teacher_id::text, from_slot
          FROM chat.lesson_change_unannounced
         ORDER BY recorded_at
         LIMIT ${limit}
           FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return { lessons: 0, refreshed: 0 };

      // Materialized weekly lessons: one refresh per organization for its teachers and learners.
      const slotRows = rows.filter((x) => x.from_slot);
      const learnerOf = new Map(
        (slotRows.length === 0 ? [] : await tx.$queryRaw<Array<{ id: string; learner_id: string | null }>>`
          SELECT id::text, learner_id::text FROM chat.lesson WHERE id = ANY (${slotRows.map((r) => r.lesson_id)}::uuid[])`)
          .map((l) => [l.id, l.learner_id]),
      );
      const refreshed = new Map<string, { teachers: Set<string>; learners: Set<string> }>();
      for (const r of slotRows) {
        const batch = refreshed.get(r.organization_id) ?? { teachers: new Set<string>(), learners: new Set<string>() };
        batch.teachers.add(r.teacher_id);
        const learner = learnerOf.get(r.lesson_id);
        if (learner) batch.learners.add(learner);
        refreshed.set(r.organization_id, batch);
      }
      for (const [organizationId, batch] of refreshed) {
        const payload: ScheduleRefreshedPayload = {
          organizationId, teacherIds: [...batch.teachers].sort(), learnerIds: [...batch.learners].sort(),
        };
        await tx.outboxEvent.create({ data: { type: CommEvent.SCHEDULE_REFRESHED, payload: payload as unknown as Prisma.InputJsonValue } });
      }

      // Everything else: a signal per lesson, at its CURRENT revision (several
      // unannounced revisions of one lesson are one signal).
      const others = [...new Set(rows.filter((x) => !x.from_slot).map((x) => x.lesson_id))];
      let lessons = 0;
      for (const p of await this.payloads(tx, others, 'external')) {
        lessons += await this.enqueueKeyed(tx, `lesson:${p.lessonId}:${p.revision}:external`, CommEvent.LESSON_CHANGED, p);
      }

      await tx.$executeRaw`
        DELETE FROM chat.lesson_change_unannounced u
         USING (SELECT unnest(${rows.map((r) => r.lesson_id)}::uuid[]) AS lesson_id,
                       unnest(${rows.map((r) => r.revision)}::bigint[]) AS revision) d
         WHERE u.lesson_id = d.lesson_id AND u.revision = d.revision`;
      if (lessons + refreshed.size > 0) notifyOutboxWake();
      return { lessons, refreshed: refreshed.size };
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
