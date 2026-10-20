import { Inject, Injectable, Optional } from '@nestjs/common';
import { Learner, LearnerSuspension } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, REALTIME_REVOCATION } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { NO_REALTIME_REVOCATION, type RealtimeRevocation } from '../platform/realtime-revocation';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import {
  ActorKind,
  CardKind,
  LessonOutcome,
  SUSPENSION_REASONS,
  TRANSFER_REASONS,
} from '../communication/contracts/vocab';
import { DEFAULT_ZONE, LessonService, cancelReminders, invalid, stateError, textField, type Tx } from './lesson.service';
import { SchedulingService } from './scheduling.service';
import { SupervisionConversationService } from '../supervision/supervision-conversation.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A temporary pause longer than this is a stop, or needs re-recording. */
const MAX_PAUSE_DAYS = 120;
/** The zone a learner's dates are read in when their teacher has none recorded. */

/**
 * PD-11 T3: a learner moving between teachers, and a learner's study pausing,
 * resuming or stopping.
 *
 * A TRANSFER is one call to chat.transfer_learner (the second writer of
 * chat.learner.teacher_id, PD-11), which moves the groups and the future
 * lessons in the same transaction; around it this service posts the family's
 * card and the new teacher's handover, tells Core, evicts the old teacher's
 * sockets (RT-009) and keeps the learner's regular times when the new teacher
 * is free at them.
 *
 * A SUSPENSION removes the paused (or every) future lesson as `suspended` --
 * counted against nobody -- and the materializer skips the paused dates. Core
 * holds the package; Chat tells it. The worker sweep warns the family and the
 * team before a return, and resumes the lessons on the day.
 */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly scheduling: SchedulingService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly supervisionChats: SupervisionConversationService,
    @Optional()
    @Inject(REALTIME_REVOCATION)
    private readonly revocation: RealtimeRevocation = NO_REALTIME_REVOCATION,
  ) {}

  // ------------------------------------------------------------------
  // Transfers
  // ------------------------------------------------------------------

  async transfer(actorId: string, learnerId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { learner } = await this.scheduling.learnerFor(actor, learnerId, 'transfer');
    const toTeacherId = body.toTeacherId;
    if (typeof toTeacherId !== 'string' || !isUuid(toTeacherId)) throw invalid('toTeacherId: must be a uuid');
    const reasonCode = body.reason;
    if (typeof reasonCode !== 'string' || !TRANSFER_REASONS.has(reasonCode)) {
      throw invalid(`reason: one of ${[...TRANSFER_REASONS].join(', ')}`);
    }
    const note = textField(body, 'note', 1000, false);
    const handover = textField(body, 'handoverNote', 2000, false);
    const keepTimes = body.keepTimes !== false;

    const toTeacher = await this.prisma.teacher.findFirst({ where: { id: toTeacherId, organizationId: learner.organizationId } });
    if (!toTeacher) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    const fromTeacher = learner.teacherId
      ? await this.prisma.teacher.findUnique({ where: { id: learner.teacherId }, select: { id: true, name: true } })
      : null;
    const oldSlots = await this.prisma.learnerScheduleSlot.findMany({ where: { learnerId: learner.id, validTo: null } });
    const before = await this.futureOpenLessonIds(learner.id);
    // The handover reaches the new teacher in their supervision conversation
    // (one per teacher, with the Teachers department -- PD-12), opened inside
    // the transaction below. An inactive new teacher has none, and gets none.
    const lang = await this.lessons.languageOf({ learner: { familyId: learner.familyId } });

    const { evictions, transferId } = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ conversation_id: string; removed_teacher_id: string }>>`
          SELECT conversation_id::text, removed_teacher_id::text
            FROM chat.transfer_learner(${learner.id}::uuid, ${toTeacher.id}::uuid, ${reasonCode},
                                       ${note}, ${handover}, ${actor.actorId}::uuid)`;
        const record = await tx.learnerTransfer.findFirstOrThrow({
          where: { learnerId: learner.id },
          orderBy: { createdAt: 'desc' },
        });
        const subject = { id: null, learnerId: learner.id, organizationId: learner.organizationId, teacherId: toTeacher.id };
        // The family hears who teaches their child now -- never why (the reason is internal).
        await this.lessons.postCard(tx, subject, null, CardKind.LEARNER_TRANSFERRED, {
          learnerName: learner.name,
          teacherName: toTeacher.name,
        }, lang);
        const handoverChat = toTeacher.isActive && toTeacher.leftAt === null
          ? await this.supervisionChats.ensureInTx(tx, toTeacher.id, toTeacher.organizationId, actor.actorId)
          : null;
        if (handoverChat) {
          await this.lessons.postCardInto(tx, handoverChat, null, actor, CardKind.LEARNER_HANDOVER, {
            learnerName: learner.name,
            fromTeacherName: fromTeacher?.name ?? null,
            handoverNote: handover,
            transferId: record.id,
          }, 'ar');
        }
        await this.outbox.enqueue(tx, CommEvent.LEARNER_TRANSFERRED, {
          transferId: record.id,
          learnerId: learner.id,
          fromTeacherId: learner.teacherId,
          toTeacherId: toTeacher.id,
          reasonCode,
        });
        return { evictions: rows, transferId: record.id };
      }),
    );

    // RT-009: the old teacher's sockets leave the rooms they were removed from,
    // and the transfer is not reported complete until no node can still deliver
    // on a decision made before it.
    for (const e of evictions) this.revocation.leaveConversation([e.removed_teacher_id], e.conversation_id);
    if (evictions.length) await this.revocation.confirmRevoked();

    // Keep the regular times when the new teacher is free at them, in the same zone.
    let scheduleKept = oldSlots.length === 0;
    if (keepTimes && oldSlots.length > 0) {
      const tz = await this.prisma.teacherAvailability.findFirst({ where: { teacherId: toTeacher.id }, select: { timezone: true } });
      if (tz && oldSlots.every((s) => s.timezone === tz.timezone)) {
        const moved = (await this.prisma.learner.findUniqueOrThrow({ where: { id: learner.id } })) as Learner;
        try {
          await this.scheduling.applySchedule(
            actor,
            moved,
            oldSlots.map((s) => ({ weekday: s.weekday, startMinute: s.startMinute, durationMinutes: s.durationMinutes })),
            null,
            null,
          );
          scheduleKept = true;
        } catch (e) {
          if (!(e instanceof CommError) || e.code !== CommErrorCode.LESSON_STATE) throw e;
        }
      }
    }

    const after = await this.prisma.lesson.findMany({ where: { id: { in: before } }, select: { teacherId: true, outcome: true } });
    return {
      transferId,
      toTeacherId: toTeacher.id,
      lessonsMoved: after.filter((l) => l.outcome === null && l.teacherId === toTeacher.id).length,
      lessonsRescheduled: after.filter((l) => l.outcome === LessonOutcome.RESCHEDULED).length,
      scheduleKept,
    };
  }

  /** A learner's transfers. The Teachers department sees all; a teacher sees the handovers they received. */
  async transfers(actorId: string, learnerId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const { learner, standing } = await this.scheduling.learnerFor(actor, learnerId, 'read_schedule');
    if (standing !== 'manager' && standing !== 'teacher') {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'transfers are read by the Teachers department and the receiving teacher');
    }
    const rows = await this.prisma.learnerTransfer.findMany({
      where: { learnerId: learner.id, ...(standing === 'teacher' ? { toTeacherId: actor.actorId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return {
      transfers: rows.map((r) => ({
        id: r.id,
        fromTeacherId: r.fromTeacherId,
        toTeacherId: r.toTeacherId,
        handoverNote: r.handoverNote,
        createdAt: r.createdAt.toISOString(),
        // The reason and the internal note are the department's, not the teacher's.
        ...(standing === 'manager' ? { reason: r.reasonCode, note: r.note } : {}),
      })),
    };
  }

  // ------------------------------------------------------------------
  // Suspensions
  // ------------------------------------------------------------------

  async suspend(actorId: string, learnerId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { learner } = await this.scheduling.learnerFor(actor, learnerId, 'suspend');
    const kind = body.kind;
    if (kind !== 'temporary' && kind !== 'permanent') throw invalid('kind: temporary or permanent');
    const reasonCode = body.reason;
    if (typeof reasonCode !== 'string' || !SUSPENSION_REASONS.has(reasonCode)) {
      throw invalid(`reason: one of ${[...SUSPENSION_REASONS].join(', ')}`);
    }
    const note = textField(body, 'note', 1000, false);
    const zone = await this.zoneOf(learner);
    const today = await this.localToday(zone);
    const startsOn = body.startsOn === undefined ? today : dateField(body.startsOn, 'startsOn');
    if (startsOn < today) throw invalid('startsOn: today or later');
    let returnOn: string | null = null;
    if (kind === 'temporary') {
      returnOn = dateField(body.returnOn, 'returnOn');
      if (returnOn <= startsOn) throw invalid('returnOn: after startsOn');
      if (daysBetween(startsOn, returnOn) > MAX_PAUSE_DAYS) throw invalid(`returnOn: at most ${MAX_PAUSE_DAYS} days after startsOn`);
    } else if (body.returnOn !== undefined) {
      throw invalid('returnOn: a permanent stop has no return date');
    }
    if (await this.prisma.learnerSuspension.count({ where: { learnerId: learner.id, status: 'active' } })) {
      throw stateError('this learner is already paused or stopped; extend or end that first');
    }

    const lang = await this.lessons.languageOf({ learner: { familyId: learner.familyId } });
    const suspension = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.learnerSuspension.create({
          data: {
            organizationId: learner.organizationId,
            learnerId: learner.id,
            kind,
            reasonCode,
            note,
            startsOn: new Date(`${startsOn}T00:00:00Z`),
            returnOn: returnOn ? new Date(`${returnOn}T00:00:00Z`) : null,
            createdBy: actor.actorId,
          },
        });
        await this.suspendLessons(tx, actor, learner.id, zone, startsOn, returnOn);
        if (kind === 'permanent') {
          await tx.$executeRaw`
            UPDATE chat.learner_schedule_slot SET valid_to = greatest(valid_from, ${startsOn}::date)
             WHERE learner_id = ${learner.id}::uuid AND valid_to IS NULL`;
        }
        await this.lessons.postCard(tx, this.subject(learner), null, CardKind.LEARNER_SUSPENDED, {
          learnerName: learner.name,
          kind,
          startsOn,
          returnOn,
        }, lang);
        await this.outbox.enqueue(tx, CommEvent.LEARNER_ENROLLMENT_CHANGED, {
          learnerId: learner.id,
          suspensionId: created.id,
          status: kind === 'temporary' ? 'paused' : 'left',
          startsOn,
          returnOn,
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: kind === 'temporary' ? 'learner.paused' : 'learner.stopped',
          entity: 'learner',
          entityId: learner.id,
          after: { suspensionId: created.id, startsOn, returnOn, reasonCode },
          reason: note ?? reasonCode,
        });
        return created;
      }),
    );
    return this.suspensionDto(suspension, learner);
  }

  /** Move a temporary pause's return date. Lessons in the new window are suspended; the notice re-arms. */
  async extend(actorId: string, suspensionId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { suspension, learner } = await this.loadSuspension(actor, suspensionId);
    if (suspension.kind !== 'temporary') throw stateError('a permanent stop has no return date to move');
    const returnOn = dateField(body.returnOn, 'returnOn');
    const startsOn = iso(suspension.startsOn);
    if (returnOn <= startsOn) throw invalid('returnOn: after the start of the pause');
    if (daysBetween(startsOn, returnOn) > MAX_PAUSE_DAYS) throw invalid(`returnOn: at most ${MAX_PAUSE_DAYS} days after the start`);
    const zone = await this.zoneOf(learner);
    const lang = await this.lessons.languageOf({ learner: { familyId: learner.familyId } });
    const updated = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.learnerSuspension.update({
          where: { id: suspension.id },
          data: { returnOn: new Date(`${returnOn}T00:00:00Z`), returnNotifiedAt: null },
        });
        await this.suspendLessons(tx, actor, learner.id, zone, startsOn, returnOn);
        await this.lessons.postCard(tx, this.subject(learner), null, CardKind.LEARNER_SUSPENDED, {
          learnerName: learner.name, kind: 'temporary', startsOn, returnOn,
        }, lang);
        await this.outbox.enqueue(tx, CommEvent.LEARNER_ENROLLMENT_CHANGED, {
          learnerId: learner.id, suspensionId: suspension.id, status: 'paused', startsOn, returnOn,
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'learner.pause_extended', entity: 'learner', entityId: learner.id,
          before: { returnOn: suspension.returnOn ? iso(suspension.returnOn) : null }, after: { returnOn },
          reason: textField(body, 'note', 1000, false) ?? 'return date moved',
        });
        return row;
      }),
    );
    await this.scheduling.materialize();
    return this.suspensionDto(updated, learner);
  }

  /** End a pause (or a stop) now: lessons resume from the regular times still in force. */
  async end(actorId: string, suspensionId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const { suspension, learner } = await this.loadSuspension(actor, suspensionId);
    const ended = await this.finish(suspension, learner, actor);
    await this.scheduling.materialize();
    return this.suspensionDto(ended, learner);
  }

  /**
   * The lists the administration works from: learners paused (with their return
   * date) or stopped (with their reason). The Teachers department sees the whole
   * organization; an Operations supervisor sees the children they supervise.
   * `packageBalance` is Core's (PD-10) and is null until Core exposes it.
   */
  async list(actorId: string, query: { kind?: string; status?: string }) {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF || !actor.organizationId || !actor.isActive) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'staff only');
    }
    const manager = actor.staffRole === 'super_admin' || (await this.lessons.isManager(actor));
    const scope = manager ? null : await this.lessons.supervisedLearnerIds(actor, new Date());
    if (scope !== null && scope.length === 0) return { suspensions: [] };
    const rows = await this.prisma.learnerSuspension.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(query.kind === 'temporary' || query.kind === 'permanent' ? { kind: query.kind } : {}),
        status: query.status === 'ended' ? 'ended' : 'active',
        ...(scope ? { learnerId: { in: scope } } : {}),
      },
      orderBy: [{ returnOn: 'asc' }, { createdAt: 'desc' }],
      take: 1000,
    });
    const learners = await this.prisma.learner.findMany({
      where: { id: { in: rows.map((r) => r.learnerId) } },
      include: { family: { select: { id: true, displayName: true } }, teacher: { select: { id: true, name: true } } },
    });
    const byId = new Map(learners.map((l) => [l.id, l]));
    return {
      suspensions: rows.map((r) => {
        const l = byId.get(r.learnerId);
        return {
          ...this.suspensionDto(r, l ?? null),
          family: l ? { id: l.family.id, displayName: l.family.displayName } : null,
          teacher: l?.teacher ? { id: l.teacher.id, name: l.teacher.name } : null,
          packageBalance: null,
        };
      }),
    };
  }

  /**
   * The worker's pass: a return-date notice `lesson.return_notice_days` before the
   * day (to the family's group; the team reads it from needs-action), and on the
   * day the pause ends by itself and the lessons resume.
   */
  async sweep(): Promise<{ noticed: number; resumed: number }> {
    const days = Number(await this.config.get('lesson.return_notice_days'));
    // "Today" is each pause's own: the learner's teacher's zone.
    const due = await this.prisma.$queryRaw<Array<{ id: string; ended: boolean }>>`
      WITH s AS (
        SELECT s.id, s.return_on, s.return_notified_at,
               (now() AT TIME ZONE coalesce(
                  (SELECT a.timezone FROM chat.teacher_availability a
                     JOIN chat.learner l ON l.teacher_id = a.teacher_id
                    WHERE l.id = s.learner_id LIMIT 1),
                  ${DEFAULT_ZONE}))::date AS today
          FROM chat.learner_suspension s
         WHERE s.status = 'active' AND s.kind = 'temporary'
      )
      SELECT s.id::text AS id, s.return_on <= s.today AS ended
        FROM s
       WHERE s.return_on <= s.today
          OR (s.return_notified_at IS NULL AND s.return_on - ${days}::int <= s.today)
       LIMIT 500`;
    let noticed = 0;
    let resumed = 0;
    for (const row of due) {
      const suspension = await this.prisma.learnerSuspension.findUniqueOrThrow({ where: { id: row.id } });
      const learner = await this.prisma.learner.findUniqueOrThrow({ where: { id: suspension.learnerId } });
      if (row.ended) {
        await this.finish(suspension, learner, null);
        resumed += 1;
      } else if (!suspension.returnNotifiedAt) {
        const lang = await this.lessons.languageOf({ learner: { familyId: learner.familyId } });
        await this.prisma.$transaction(async (tx) => {
          await tx.learnerSuspension.update({ where: { id: suspension.id }, data: { returnNotifiedAt: new Date() } });
          await this.lessons.postCard(tx, this.subject(learner), null, CardKind.LEARNER_RETURN_SOON, {
            learnerName: learner.name,
            returnOn: iso(suspension.returnOn as Date),
          }, lang);
        });
        noticed += 1;
      }
    }
    if (resumed) await this.scheduling.materialize();
    return { noticed, resumed };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async finish(suspension: LearnerSuspension, learner: Learner, actor: Actor | null) {
    if (suspension.status !== 'active') throw stateError('this pause has already ended');
    const lang = await this.lessons.languageOf({ learner: { familyId: learner.familyId } });
    return this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.learnerSuspension.update({
          where: { id: suspension.id },
          data: { status: 'ended', endedAt: new Date(), endedBy: actor?.actorId ?? null },
        });
        await this.lessons.postCard(tx, this.subject(learner), null, CardKind.LEARNER_RESUMED, {
          learnerName: learner.name,
          kind: suspension.kind,
        }, lang);
        await this.outbox.enqueue(tx, CommEvent.LEARNER_ENROLLMENT_CHANGED, {
          learnerId: learner.id,
          suspensionId: suspension.id,
          status: 'resumed',
          startsOn: iso(suspension.startsOn),
          returnOn: suspension.returnOn ? iso(suspension.returnOn) : null,
        });
        await this.audit.audit(tx, {
          actorId: actor?.actorId ?? null,
          action: 'learner.resumed',
          entity: 'learner',
          entityId: learner.id,
          after: { suspensionId: suspension.id },
          reason: actor ? 'pause ended by staff' : 'return date reached',
        });
        return row;
      }),
    );
  }

  /** Every open future lesson of the learner whose local date falls in [from, until) becomes `suspended`. */
  private async suspendLessons(tx: Tx, actor: Actor, learnerId: string, zone: string, from: string, until: string | null) {
    const ids = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT l.id::text AS id FROM chat.lesson l
       WHERE l.learner_id = ${learnerId}::uuid AND l.outcome IS NULL AND l.starts_at > now()
         AND (l.starts_at AT TIME ZONE ${zone})::date >= ${from}::date
         AND (${until}::date IS NULL OR (l.starts_at AT TIME ZONE ${zone})::date < ${until}::date)`;
    if (ids.length === 0) return;
    await tx.lesson.updateMany({
      where: { id: { in: ids.map((r) => r.id) } },
      data: {
        outcome: LessonOutcome.SUSPENDED,
        outcomeNote: 'study paused',
        outcomeByKind: ActorKind.STAFF,
        outcomeBy: actor.actorId,
        outcomeAt: new Date(),
      },
    });
    for (const r of ids) await cancelReminders(tx, r.id);
  }

  private async loadSuspension(actor: Actor, suspensionId: string) {
    if (!isUuid(suspensionId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'suspension not found');
    const suspension = await this.prisma.learnerSuspension.findUnique({ where: { id: suspensionId } });
    if (!suspension || suspension.organizationId !== actor.organizationId) {
      throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'suspension not found');
    }
    const { learner } = await this.scheduling.learnerFor(actor, suspension.learnerId, 'suspend');
    if (suspension.status !== 'active') throw stateError('this pause has already ended');
    return { suspension, learner };
  }

  /** The zone a learner's dates are read in: their teacher's. */
  private async zoneOf(learner: Learner): Promise<string> {
    if (!learner.teacherId) return DEFAULT_ZONE;
    const row = await this.prisma.teacherAvailability.findFirst({ where: { teacherId: learner.teacherId }, select: { timezone: true } });
    return row?.timezone ?? DEFAULT_ZONE;
  }

  private async localToday(zone: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ d: string }>>`SELECT to_char((now() AT TIME ZONE ${zone})::date, 'YYYY-MM-DD') AS d`;
    return rows[0].d;
  }

  private async futureOpenLessonIds(learnerId: string): Promise<string[]> {
    const rows = await this.prisma.lesson.findMany({
      where: { learnerId, outcome: null, startsAt: { gt: new Date() } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private subject(learner: Learner) {
    return { id: null, learnerId: learner.id, organizationId: learner.organizationId, teacherId: learner.teacherId ?? '' };
  }

  private suspensionDto(s: LearnerSuspension, learner: Pick<Learner, 'id' | 'name'> | null) {
    return {
      id: s.id,
      learner: learner ? { id: learner.id, name: learner.name } : { id: s.learnerId, name: '' },
      kind: s.kind,
      reason: s.reasonCode,
      note: s.note,
      startsOn: iso(s.startsOn),
      returnOn: s.returnOn ? iso(s.returnOn) : null,
      status: s.status,
      returnNotifiedAt: s.returnNotifiedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    };
  }
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateField(v: unknown, key: string): string {
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw invalid(`${key}: a date as YYYY-MM-DD`);
  }
  return v;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
