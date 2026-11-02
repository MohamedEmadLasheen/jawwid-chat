import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';

/**
 * PD-55: rewards a teacher gives a child during the child's lesson
 * (docs/product/pd055-whiteboard-teaching-and-rewards-plan.md §3-§4).
 *
 * THE RULES (the database's guard enforces them again, and RLS a third time):
 *   * only the learner's own teacher, during one of that learner's lessons with
 *     them -- from rewards.award_window_before_minutes before it to
 *     rewards.award_window_after_minutes after, and only a lesson that took or
 *     is taking place (outcome null or held);
 *   * a star, a sticker or a praise stamp is one star; a celebration is none;
 *   * a mistaken reward is withdrawn by its teacher within 2 minutes -- an
 *     'undo' row, never shown to the family as anything taken away;
 *   * nothing here ever answers about more than one learner to anyone but
 *     that learner's teacher: there are no comparisons.
 *
 * Everything is 404 while rewards.enabled is off.
 */
export const STICKER_KEYS = ['star', 'medal', 'trophy', 'rocket', 'sun', 'rainbow', 'crown', 'balloon', 'heart', 'thumbs_up', 'check'] as const;
export const PRAISE_KEYS = [
  'excellent', 'well_done', 'great', 'champion',
  'excellent_ar', 'well_done_ar', 'great_ar', 'champion_ar',
] as const;
const KINDS = ['star', 'sticker', 'praise', 'celebration'] as const;
type GivenKind = (typeof KINDS)[number];

export interface GiveRewardInput {
  lessonId?: unknown;
  kind?: unknown;
  stickerKey?: unknown;
  praiseKey?: unknown;
  praiseText?: unknown;
  boardId?: unknown;
  clientEventId?: unknown;
}

interface LessonNow {
  lessonId: string;
  learnerId: string;
  learnerName: string;
  startsAt: string;
  endsAt: string;
  stars: number;
}

const invalid = (why: string) => new CommError(CommErrorCode.VALIDATION, why, 400);
const notFound = () => new CommError(CommErrorCode.LESSON_NOT_FOUND, 'no such lesson of yours', 404);

@Injectable()
export class RewardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
  ) {}

  /** The teacher's lessons that are on now, each with its learner and their stars so far -- the tray's "For". */
  async lessonsNow(actorId: string): Promise<{ lessons: LessonNow[] }> {
    const teacherId = await this.requireTeacher(actorId);
    const rows = await this.prisma.$queryRaw<Array<{ lesson_id: string; learner_id: string; learner_name: string; starts_at: Date; ends_at: Date; stars: number }>>`
      select l.id as lesson_id, l.learner_id, lr.name as learner_name, l.starts_at, l.ends_at,
             ${this.starsSql(Prisma.sql`l.id`, Prisma.sql`l.learner_id`)} as stars
        from chat.lesson l
        join chat.learner lr on lr.id = l.learner_id and lr.teacher_id = l.teacher_id
       where l.teacher_id = ${teacherId}::uuid
         and (l.outcome is null or l.outcome = 'held')
         and now() between l.starts_at - make_interval(mins => ${await this.config.get('rewards.award_window_before_minutes')}::int)
                       and l.ends_at + make_interval(mins => ${await this.config.get('rewards.award_window_after_minutes')}::int)
       order by l.starts_at, lr.name`;
    return {
      lessons: rows.map((r) => ({
        lessonId: r.lesson_id,
        learnerId: r.learner_id,
        learnerName: r.learner_name,
        startsAt: r.starts_at.toISOString(),
        endsAt: r.ends_at.toISOString(),
        stars: Number(r.stars),
      })),
    };
  }

  /** Records one reward for one learner, and tells the family. Idempotent on clientEventId. */
  async give(actorId: string, learnerId: string, input: GiveRewardInput) {
    const teacherId = await this.requireTeacher(actorId);
    const kind = input.kind;
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) throw invalid(`kind: one of ${KINDS.join(', ')}`);
    const stickerKey = kind === 'sticker' ? this.oneOf(input.stickerKey, STICKER_KEYS, 'stickerKey') : null;
    let praiseKey: string | null = null;
    let praiseText: string | null = null;
    if (kind === 'praise') {
      if (input.praiseText !== undefined && input.praiseText !== null) {
        if (typeof input.praiseText !== 'string' || input.praiseText.trim().length < 1 || input.praiseText.trim().length > 40) {
          throw invalid('praiseText: 1-40 characters');
        }
        praiseText = input.praiseText.trim();
      } else {
        praiseKey = this.oneOf(input.praiseKey, PRAISE_KEYS, 'praiseKey');
      }
    }
    const clientEventId = this.uuid(input.clientEventId, 'clientEventId');
    const boardId = input.boardId === undefined || input.boardId === null ? null : this.uuid(input.boardId, 'boardId');
    const lesson = await this.requireLessonNow(teacherId, learnerId, input.lessonId);

    return this.prisma.$transaction(async (tx) => {
      // A retried tap replays; two at once meet the unique key, and the second replays too.
      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        insert into chat.learner_reward_event
          (id, organization_id, learner_id, lesson_id, teacher_id, board_id, kind, sticker_key, praise_key, praise_text, client_event_id)
        values (${randomUUID()}::uuid, ${lesson.organizationId}::uuid, ${learnerId}::uuid, ${lesson.id}::uuid, ${teacherId}::uuid,
                (select id from chat.whiteboard where id = ${boardId}::uuid and teacher_id = ${teacherId}::uuid),
                ${kind}, ${stickerKey}, ${praiseKey}, ${praiseText}, ${clientEventId}::uuid)
        on conflict (teacher_id, client_event_id) do nothing
        returning id::text as id`;
      let eventId = inserted[0]?.id;
      if (!eventId) {
        const [prior] = await tx.$queryRaw<Array<{ id: string; learner_id: string; lesson_id: string }>>`
          select id::text as id, learner_id::text as learner_id, lesson_id::text as lesson_id
            from chat.learner_reward_event where teacher_id = ${teacherId}::uuid and client_event_id = ${clientEventId}::uuid`;
        // The same clientEventId for another learner or lesson is a client bug, not a retry.
        if (!prior || prior.learner_id !== learnerId || prior.lesson_id !== lesson.id) {
          throw new CommError(CommErrorCode.VALIDATION, 'clientEventId was already used for another reward', 409);
        }
        eventId = prior.id;
      }
      const stars = await this.stars(tx, lesson.id, learnerId);
      if (inserted[0]) {
        await this.outbox.enqueue(tx, CommEvent.LEARNER_REWARD_GIVEN, {
          learnerId,
          lessonId: lesson.id,
          eventId,
          kind: kind as GivenKind,
          stickerKey,
          praiseKey,
          praiseText,
          stars,
        });
      }
      return { event: { id: eventId, kind, stickerKey, praiseKey, praiseText }, stars };
    });
  }

  /** Withdraws one of this teacher's own rewards, within 2 minutes. */
  async undo(actorId: string, learnerId: string, eventId: string) {
    const teacherId = await this.requireTeacher(actorId);
    if (!isUuid(eventId)) throw notFound();
    const [target] = await this.prisma.$queryRaw<Array<{ lesson_id: string; organization_id: string; kind: string; created_at: Date; undone: boolean }>>`
      select e.lesson_id, e.organization_id, e.kind, e.created_at,
             exists (select 1 from chat.learner_reward_event u where u.undoes = e.id) as undone
        from chat.learner_reward_event e
        join chat.learner lr on lr.id = e.learner_id and lr.teacher_id = e.teacher_id
       where e.id = ${eventId}::uuid and e.teacher_id = ${teacherId}::uuid and e.learner_id = ${learnerId}::uuid`;
    // No longer this learner's teacher (a transfer): the same answer as an unknown reward.
    if (!target || target.kind === 'undo') throw notFound();
    if (target.undone) return { stars: await this.stars(this.prisma, target.lesson_id, learnerId) };
    if (Date.now() - target.created_at.getTime() > 2 * 60_000) {
      throw new CommError(CommErrorCode.VALIDATION, 'a reward can be withdrawn only within 2 minutes', 409);
    }
    return this.prisma.$transaction(async (tx) => {
      // Two undos at once: the second meets learner_reward_event_undone_once and changes nothing.
      const inserted = await tx.$executeRaw`
        insert into chat.learner_reward_event (organization_id, learner_id, lesson_id, teacher_id, kind, undoes, client_event_id)
        values (${target.organization_id}::uuid, ${learnerId}::uuid, ${target.lesson_id}::uuid, ${teacherId}::uuid, 'undo', ${eventId}::uuid, ${randomUUID()}::uuid)
        on conflict (undoes) where kind = 'undo' do nothing`;
      const stars = await this.stars(tx, target.lesson_id, learnerId);
      if (inserted > 0) {
        await this.outbox.enqueue(tx, CommEvent.LEARNER_REWARD_UNDONE, { learnerId, lessonId: target.lesson_id, eventId, stars });
      }
      return { stars };
    });
  }

  // -- helpers -------------------------------------------------------------------------

  private async requireTeacher(actorId: string): Promise<string> {
    if (!(await this.config.get('rewards.enabled'))) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'not found', 404);
    const actor = await this.conversations.requireActor(actorId);
    // A parent or a staff member never gives a reward: the same answer as an unknown lesson.
    if (actor.kind !== 'teacher') throw notFound();
    return actor.actorId;
  }

  private async requireLessonNow(teacherId: string, learnerId: string, lessonId: unknown) {
    if (!isUuid(learnerId) || typeof lessonId !== 'string' || !isUuid(lessonId)) throw notFound();
    const [l] = await this.prisma.$queryRaw<Array<{ id: string; organization_id: string; on_now: boolean; took_place: boolean }>>`
      select l.id, l.organization_id,
             now() between l.starts_at - make_interval(mins => ${await this.config.get('rewards.award_window_before_minutes')}::int)
                       and l.ends_at + make_interval(mins => ${await this.config.get('rewards.award_window_after_minutes')}::int) as on_now,
             (l.outcome is null or l.outcome = 'held') as took_place
        from chat.lesson l
        join chat.learner lr on lr.id = l.learner_id and lr.teacher_id = l.teacher_id
       where l.id = ${lessonId}::uuid and l.learner_id = ${learnerId}::uuid and l.teacher_id = ${teacherId}::uuid`;
    // Another teacher's learner, another learner's lesson: indistinguishable from none.
    if (!l) throw notFound();
    if (!l.took_place || !l.on_now) throw new CommError(CommErrorCode.VALIDATION, 'rewards count only during the lesson', 409);
    return { id: l.id, organizationId: l.organization_id };
  }

  /** A learner's stars in one lesson: one per star, sticker or praise not withdrawn. */
  private starsSql(lesson: Prisma.Sql, learner: Prisma.Sql) {
    return Prisma.sql`(select count(*)::int from chat.learner_reward_event e
                        where e.lesson_id = ${lesson} and e.learner_id = ${learner}
                          and e.kind in ('star', 'sticker', 'praise')
                          and not exists (select 1 from chat.learner_reward_event u where u.undoes = e.id))`;
  }

  private async stars(tx: Prisma.TransactionClient | PrismaService, lessonId: string, learnerId: string): Promise<number> {
    const [r] = await tx.$queryRaw<Array<{ stars: number }>>`
      select ${this.starsSql(Prisma.sql`${lessonId}::uuid`, Prisma.sql`${learnerId}::uuid`)} as stars`;
    return Number(r?.stars ?? 0);
  }

  private oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw invalid(`${field}: one of ${allowed.join(', ')}`);
    return value as T;
  }

  private uuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !isUuid(value)) throw invalid(`${field}: a uuid`);
    return value;
  }
}
