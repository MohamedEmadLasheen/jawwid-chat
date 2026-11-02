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

/** PD-55 PR-5: a lesson's badge -- named for effort, never a rank. */
export type Badge = 'bronze' | 'silver' | 'gold';
const BADGES: readonly Badge[] = ['bronze', 'silver', 'gold'];

/** The badge [stars] earned and the stars the next one needs, from the configured thresholds. */
export function badgeOf(stars: number, thresholds: readonly number[]): { badge: Badge | null; nextBadgeAt: number | null } {
  const sorted = [...thresholds].slice(0, BADGES.length).sort((a, b) => a - b);
  let badge: Badge | null = null;
  sorted.forEach((t, i) => {
    if (stars >= t) badge = BADGES[i]!;
  });
  return { badge, nextBadgeAt: sorted.find((t) => t > stars) ?? null };
}

interface LessonNow {
  lessonId: string;
  learnerId: string;
  learnerName: string;
  startsAt: string;
  endsAt: string;
  stars: number;
  badge: Badge | null;
  nextBadgeAt: number | null;
}

/** One learner's rewards in one lesson -- never anyone else's, never compared. */
export interface LessonRewards {
  stars: number;
  badge: Badge | null;
  nextBadgeAt: number | null;
  /** The praise given, oldest first: a stamp's key, or the teacher's own words. */
  praise: Array<{ key: string | null; text: string | null }>;
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

  /**
   * PD-55 PR-5: one lesson's rewards for its learner -- the report card's row,
   * and later PD-54's history. The lesson's teacher, an active contact of the
   * learner's family, or staff who supervise the teacher; anyone else is told
   * there is no such lesson.
   *
   * Staff reach is ALWAYS strict -- the teachers they supervise (PD-35's
   * chat.staff_supervised_teacher_ids: their assignments, a backup's, the
   * Teachers manager's and the super admin's whole organization) -- whatever
   * TEACHER_SUPERVISOR_STRICT_SCOPE says: a child's rewards are read on least
   * privilege, never department-wide.
   */
  async forLesson(actorId: string, lessonId: string): Promise<LessonRewards> {
    if (!(await this.config.get('rewards.enabled'))) throw notFound();
    if (!isUuid(lessonId)) throw notFound();
    const actor = await this.conversations.requireActor(actorId);
    const [l] = await this.prisma.$queryRaw<Array<{ learner_id: string | null; teacher_id: string; family_id: string | null }>>`
      select ls.learner_id, ls.teacher_id, lr.family_id
        from chat.lesson ls left join chat.learner lr on lr.id = ls.learner_id
       where ls.id = ${lessonId}::uuid`;
    if (!l || !l.learner_id) throw notFound();
    let allowed = false;
    if (actor.kind === 'teacher') allowed = actor.actorId === l.teacher_id;
    else if (actor.kind === 'contact') {
      const [c] = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
        select exists (select 1 from chat.contact c where c.id = ${actor.actorId}::uuid and c.is_active and c.family_id = ${l.family_id}::uuid) as ok`;
      allowed = c?.ok === true;
    } else if (actor.kind === 'staff') {
      const [c] = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
        select ${l.teacher_id}::uuid in (select chat.staff_supervised_teacher_ids(${actor.actorId}::uuid)) as ok`;
      allowed = c?.ok === true;
    }
    if (!allowed) throw notFound();

    const stars = await this.stars(this.prisma, lessonId, l.learner_id);
    const praise = await this.prisma.$queryRaw<Array<{ praise_key: string | null; praise_text: string | null }>>`
      select e.praise_key, e.praise_text from chat.learner_reward_event e
       where e.lesson_id = ${lessonId}::uuid and e.learner_id = ${l.learner_id}::uuid and e.kind = 'praise'
         and not exists (select 1 from chat.learner_reward_event u where u.undoes = e.id)
       order by e.created_at, e.id`;
    return {
      stars,
      ...badgeOf(stars, await this.config.get('rewards.lesson_badge_thresholds')),
      praise: praise.map((p) => ({ key: p.praise_key, text: p.praise_text })),
    };
  }

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
    const thresholds = await this.config.get('rewards.lesson_badge_thresholds');
    return {
      lessons: rows.map((r) => ({
        lessonId: r.lesson_id,
        learnerId: r.learner_id,
        learnerName: r.learner_name,
        startsAt: r.starts_at.toISOString(),
        endsAt: r.ends_at.toISOString(),
        stars: Number(r.stars),
        ...badgeOf(Number(r.stars), thresholds),
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
    const thresholds = await this.config.get('rewards.lesson_badge_thresholds');

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
          ...badgeOf(stars, thresholds),
        });
      }
      return { event: { id: eventId, kind, stickerKey, praiseKey, praiseText }, stars, ...badgeOf(stars, thresholds) };
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
