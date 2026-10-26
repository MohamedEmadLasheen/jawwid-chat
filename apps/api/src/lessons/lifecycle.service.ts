import { Inject, Injectable, Optional } from '@nestjs/common';
import { Learner, LearnerSuspension } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { awayRefusal } from '../leave/away';
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
import { SchedulingService, hhmm, minuteField, slotsField, type WeeklySlot } from './scheduling.service';
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

  /**
   * PD-31: change one learner's teacher. `slots` is the full new weekly set
   * for the new teacher; without it the current times are kept, and the change
   * is refused unless the new teacher is free at every one of them -- the times
   * are never dropped (the old `scheduleKept: false`).
   */
  async transfer(actorId: string, learnerId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { learner } = await this.scheduling.learnerFor(actor, learnerId, 'transfer');
    const opts = transferFields(body);
    const slots = body.slots === undefined || body.slots === null ? {} : { [learner.id]: body.slots };
    const [r] = await this.transferLearners(actor, [learner], opts, slots);
    return { ...r, toTeacherId: opts.toTeacherId, scheduleKept: true };
  }

  /**
   * PD-31: change the teacher of a group -- every child in it taught by the
   * old teacher (`fromTeacherId` when the group's children have several), in
   * ONE transaction. The same conversation keeps all its history.
   */
  async transferGroup(actorId: string, conversationId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const opts = transferFields(body);
    const { learners } = await this.groupLearners(actor, conversationId, body.fromTeacherId);
    const slots = body.slots === undefined || body.slots === null ? {} : body.slots;
    if (typeof slots !== 'object' || Array.isArray(slots)) throw invalid('slots: an object of learnerId -> weekly times');
    const results = await this.transferLearners(actor, learners, opts, slots as Record<string, unknown>);
    return { learners: results };
  }

  /** What a change of teacher would do, before anyone confirms it (one learner). */
  async transferPreview(actorId: string, learnerId: string, toTeacherId: string | undefined) {
    const actor = await this.conversations.requireActor(actorId);
    const { learner } = await this.scheduling.learnerFor(actor, learnerId, 'transfer');
    return this.preview(actor, [learner], toTeacherId, null);
  }

  /** What a change of teacher would do, for a group's children. */
  async groupPreview(actorId: string, conversationId: string, toTeacherId: string | undefined, fromTeacherId: string | undefined) {
    const actor = await this.conversations.requireActor(actorId);
    const { learners, groupTeachers } = await this.groupLearners(actor, conversationId, fromTeacherId, true);
    return this.preview(actor, learners, toTeacherId, groupTeachers);
  }

  /**
   * The teachers a learner may be moved to: active teachers of the
   * organization, with whether they are away (PD-26: leave or suspension
   * refuses a new student). For the staff who change teachers.
   */
  async candidates(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    // Whoever may change some child's teacher: the super admin, the Teachers
    // department, or a staff member acting for some child's PD-8 supervisor
    // (themselves, an active backup, the supervisor's manager).
    const allowed = actor.kind === ActorKind.STAFF && actor.isActive && (
      actor.staffRole === 'super_admin'
      || (await this.lessons.isManager(actor))
      || (await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
           SELECT EXISTS (SELECT 1 FROM chat.learner_supervision ls
                           WHERE ls.organization_id = ${actor.organizationId}::uuid
                             AND ls.supervisor_id IN (SELECT chat.staff_principals(${actor.actorId}::uuid, now()))) AS ok`)[0]?.ok === true);
    if (!allowed) throw new CommError(CommErrorCode.LESSON_DENIED, 'the teachers list is for the staff who change teachers');
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string; active: boolean; kind: string | null; until: Date | null }>>`
      SELECT t.id::text, t.name, (t.is_active AND t.left_at IS NULL) AS active, a.kind, a.until
        FROM chat.teacher t
        LEFT JOIN LATERAL chat.teacher_away(t.id, chat.academy_today()) a ON true
       WHERE t.organization_id = ${actor.organizationId}::uuid
       ORDER BY t.name`;
    return {
      teachers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        isActive: r.active,
        away: r.kind && r.kind !== 'day_off' && r.until ? { kind: r.kind, until: r.until.toISOString().slice(0, 10) } : null,
      })),
    };
  }

  private async groupLearners(actor: Actor, conversationId: string, fromTeacher: unknown, previewOnly = false) {
    const conv = await this.conversations.requireConversation(conversationId);
    if (conv.organizationId !== actor.organizationId) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'conversation not found');
    const ids = await this.lessons.learnersOf(conv);
    if (ids.length === 0) throw stateError('this conversation is not about a student');
    // Authorize EVERY child of the group before anything about it is read: a
    // reader who may not change each child's teacher learns nothing, not even
    // the teachers' names. (A PD-8 family group has one supervisor, so the
    // staff who may act on one child may act on all.)
    const all: Learner[] = [];
    for (const id of ids) all.push((await this.scheduling.learnerFor(actor, id, 'transfer')).learner);
    all.sort((a, b) => a.name.localeCompare(b.name));
    const teacherIds = [...new Set(all.map((l) => l.teacherId).filter((t): t is string => !!t))];
    const groupTeachers = await this.prisma.teacher.findMany({
      where: { id: { in: teacherIds }, organizationId: actor.organizationId as string },
      select: { id: true, name: true },
    });
    let from: string;
    if (fromTeacher !== undefined && fromTeacher !== null && fromTeacher !== '') {
      if (typeof fromTeacher !== 'string' || !teacherIds.includes(fromTeacher)) throw invalid('fromTeacherId: a teacher of this group');
      from = fromTeacher;
    } else if (teacherIds.length === 1) {
      from = teacherIds[0];
    } else if (previewOnly && teacherIds.length > 1) {
      return { learners: [], groupTeachers };
    } else {
      throw invalid(teacherIds.length ? 'fromTeacherId: the group has several teachers; name the one being replaced' : 'this group has no teacher');
    }
    return { learners: all.filter((x) => x.teacherId === from), groupTeachers };
  }

  private async preview(actor: Actor, learners: Learner[], toTeacherId: string | undefined, groupTeachers: Array<{ id: string; name: string }> | null) {
    if (typeof toTeacherId !== 'string' || !isUuid(toTeacherId)) throw invalid('toTeacherId: must be a uuid');
    const toTeacher = await this.prisma.teacher.findFirst({ where: { id: toTeacherId, organizationId: actor.organizationId as string }, select: { id: true, name: true } });
    if (!toTeacher) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    const [away] = await this.prisma.$queryRaw<Array<{ kind: string; until: Date }>>`
      SELECT kind, until FROM chat.teacher_away(${toTeacher.id}::uuid, chat.academy_today())`;
    const out = [];
    for (const l of learners) {
      const duration = await this.scheduling.currentDuration(l.id);
      const current = await this.scheduling.currentSlots(l.id);
      const zones = await this.zonesFor(l.id, toTeacher.id);
      const slots = [];
      for (const c of current) {
        const s = { weekday: c.weekday, startMinute: minuteField(c.start, 'start'), durationMinutes: c.durationMinutes ?? duration };
        // The same instants on the new teacher's clock (PD-22); null when a clock
        // change in one zone only means the time cannot be kept exactly.
        const kept = zones ? await this.scheduling.convertWeekly(s, zones.from, zones.to) : null;
        slots.push({
          ...c,
          keptAs: kept ? { weekday: kept.weekday, start: hhmm(kept.startMinute) } : null,
          zoneShift: zones !== null && kept === null,
          free: kept ? await this.scheduling.isFree(toTeacher.id, l.id, kept) : false,
        });
      }
      const future = await this.prisma.lesson.count({ where: { learnerId: l.id, outcome: null, startsAt: { gt: new Date() } } });
      const unmovable = await this.prisma.$queryRaw<Array<{ id: string; kind: string; starts_at: Date }>>`
        SELECT l.id::text, l.kind, l.starts_at FROM chat.lesson l
         WHERE l.learner_id = ${l.id}::uuid AND l.outcome IS NULL AND l.starts_at > now() AND l.schedule_slot_id IS NULL
           AND EXISTS (SELECT 1 FROM chat.lesson x
                        WHERE x.teacher_id = ${toTeacher.id}::uuid AND x.learner_id IS DISTINCT FROM ${l.id}::uuid
                          AND (x.outcome IS NULL OR x.outcome IN ('held', 'student_no_show', 'teacher_no_show'))
                          AND tstzrange(x.starts_at, x.ends_at) && tstzrange(l.starts_at, l.ends_at))
         ORDER BY l.starts_at`;
      const fromTeacher = l.teacherId ? await this.prisma.teacher.findUnique({ where: { id: l.teacherId }, select: { id: true, name: true } }) : null;
      out.push({
        id: l.id,
        name: l.name,
        fromTeacher,
        slots,
        allFree: slots.every((x) => x.free),
        futureLessons: future,
        unmovable: unmovable.map((u) => ({ lessonId: u.id, kind: u.kind, startsAt: u.starts_at.toISOString() })),
      });
    }
    return {
      toTeacher: {
        ...toTeacher,
        away: away && away.kind !== 'day_off' ? { kind: away.kind, until: away.until.toISOString().slice(0, 10) } : null,
      },
      locked: learners.length ? await this.scheduling.lockOf(learners[0].id) : null,
      ...(groupTeachers ? { groupTeachers } : {}),
      learners: out,
    };
  }

  /**
   * The change of teacher itself (PD-11 T3, made whole by PD-31). Everything is
   * checked first -- the new teacher is active and not away (PD-26), and free
   * at every weekly time each learner will have -- and then done in ONE
   * transaction: chat.transfer_learner (the guarded writer of
   * chat.learner.teacher_id: the same conversation, the old teacher leaves and
   * the new one joins, past lessons stay with the old teacher), the new weekly
   * times, the family's card, the handover, the audit and Core's event.
   */
  private async transferLearners(
    actor: Actor,
    learners: Learner[],
    opts: { toTeacherId: string; reasonCode: string; note: string | null; handover: string | null },
    slotsBy: Record<string, unknown>,
  ) {
    if (learners.length === 0) throw stateError('no student of this group has that teacher');
    const toTeacher = await this.prisma.teacher.findFirst({ where: { id: opts.toTeacherId, organizationId: learners[0].organizationId } });
    if (!toTeacher) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    if (!toTeacher.isActive || toTeacher.leftAt !== null) throw stateError('an inactive teacher cannot take a learner');
    const away = await awayRefusal(this.prisma, toTeacher);
    if (away) throw new CommError(CommErrorCode.LESSON_STATE, away, 409);

    // Plan every learner's new weekly times before anything is written.
    const plans: Array<{ learner: Learner; oldSlotIds: string[]; slots: WeeklySlot[]; before: string[]; from: { id: string; name: string } | null }> = [];
    for (const learner of learners) {
      if (learner.teacherId === toTeacher.id) throw stateError(`${learner.name} already has this teacher`);
      const old = await this.prisma.learnerScheduleSlot.findMany({ where: { learnerId: learner.id, validTo: null } });
      const duration = await this.scheduling.currentDuration(learner.id);
      const asked = slotsBy[learner.id];
      let slots: WeeklySlot[];
      if (asked === undefined) {
        // Keep the same INSTANTS: each weekly time is read in its own zone and
        // written on the new teacher's clock (PD-22 anchors a weekly lesson in
        // its teacher's zone). A wall-clock copy would shift a family's lesson by
        // the zones' difference.
        const toZone = old.length ? await this.scheduling.teacherZone(toTeacher.id) : null;
        slots = [];
        const busy: string[] = [];
        for (const o of old) {
          const was = { weekday: o.weekday, startMinute: o.startMinute, durationMinutes: o.durationMinutes };
          const kept = await this.scheduling.convertWeekly(was, o.timezone, toZone as string);
          if (!kept) busy.push(`${WEEKDAY[o.weekday]} ${hhmm(o.startMinute)} (the two zones change their clocks on different days)`);
          else if (!(await this.scheduling.isFree(toTeacher.id, learner.id, kept))) busy.push(`${WEEKDAY[o.weekday]} ${hhmm(o.startMinute)}`);
          else slots.push(kept);
        }
        if (busy.length) throw stateError(`times_not_free: ${toTeacher.name} cannot keep ${busy.join(', ')} for ${learner.name}; choose new times`);
      } else {
        slots = slotsField(asked, false).map((s) => ({ ...s, durationMinutes: duration }));
        await this.scheduling.assertFree(toTeacher.id, learner.id, slots);
      }
      const fromTeacher = learner.teacherId
        ? await this.prisma.teacher.findUnique({ where: { id: learner.teacherId }, select: { id: true, name: true } })
        : null;
      plans.push({ learner, oldSlotIds: old.map((s) => s.id), slots, before: await this.futureOpenLessonIds(learner.id), from: fromTeacher });
    }
    // Siblings moving together must not take the same time of the new teacher.
    for (let i = 0; i < plans.length; i++) {
      for (let j = i + 1; j < plans.length; j++) {
        for (const a of plans[i].slots) {
          for (const b of plans[j].slots) {
            if (a.weekday === b.weekday && a.startMinute < b.startMinute + b.durationMinutes && b.startMinute < a.startMinute + a.durationMinutes) {
              throw invalid(`slots: ${plans[i].learner.name} and ${plans[j].learner.name} cannot both have ${WEEKDAY[a.weekday]} ${hhmm(a.startMinute)}`);
            }
          }
        }
      }
    }
    const needsZone = plans.some((p) => p.slots.length > 0);
    const timezone = needsZone ? await this.scheduling.teacherZone(toTeacher.id) : null;
    const from = await this.scheduling.teacherToday(toTeacher.id);
    const handoverChatOk = toTeacher.isActive && toTeacher.leftAt === null;

    const done = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const results: Array<{ learnerId: string; transferId: string; evictions: Array<{ conversation_id: string; removed_teacher_id: string }> }> = [];
        for (const plan of plans) {
          const { learner } = plan;
          const lang = await this.lessons.languageOf({ learner: { familyId: learner.familyId } });
          const rows = await tx.$queryRaw<Array<{ conversation_id: string; removed_teacher_id: string }>>`
            SELECT conversation_id::text, removed_teacher_id::text
              FROM chat.transfer_learner(${learner.id}::uuid, ${toTeacher.id}::uuid, ${opts.reasonCode},
                                         ${opts.note}, ${opts.handover}, ${actor.actorId}::uuid)`;
          const record = await tx.learnerTransfer.findFirstOrThrow({
            where: { learnerId: learner.id },
            orderBy: { createdAt: 'desc' },
          });
          if (plan.slots.length > 0 || plan.oldSlotIds.length > 0) {
            await this.scheduling.applyScheduleTx(
              tx, actor, learner, toTeacher.id, timezone ?? DEFAULT_ZONE, plan.slots, from, plan.oldSlotIds,
            );
          }
          const subject = { id: null, learnerId: learner.id, organizationId: learner.organizationId, teacherId: toTeacher.id };
          // The family hears who teaches their child now -- never why (the reason is internal).
          await this.lessons.postCard(tx, subject, null, CardKind.LEARNER_TRANSFERRED, {
            learnerName: learner.name,
            teacherName: toTeacher.name,
          }, lang);
          const handoverChat = handoverChatOk
            ? await this.supervisionChats.ensureInTx(tx, toTeacher.id, toTeacher.organizationId, actor.actorId)
            : null;
          if (handoverChat) {
            await this.lessons.postCardInto(tx, handoverChat, null, actor, CardKind.LEARNER_HANDOVER, {
              learnerName: learner.name,
              fromTeacherName: plan.from?.name ?? null,
              handoverNote: opts.handover,
              transferId: record.id,
            }, 'ar');
          }
          await this.outbox.enqueue(tx, CommEvent.LEARNER_TRANSFERRED, {
            transferId: record.id,
            learnerId: learner.id,
            fromTeacherId: learner.teacherId,
            toTeacherId: toTeacher.id,
            reasonCode: opts.reasonCode,
          });
          await this.recordStranded(tx, learner, toTeacher, plan.before, lang, actor);
          results.push({ learnerId: learner.id, transferId: record.id, evictions: rows });
        }
        // The new weekly times' lessons, and any week the new teacher is busy, in
        // the same transaction: nothing after the commit can fail the change.
        await this.scheduling.materialize(tx);
        await this.scheduling.collectBlocked(tx);
        return results;
      }),
    );

    // RT-009: the old teacher's sockets leave the rooms they were removed from,
    // and the change is not reported complete until no node can still deliver
    // on a decision made before it.
    const evictions = done.flatMap((d) => d.evictions);
    for (const e of evictions) this.revocation.leaveConversation([e.removed_teacher_id], e.conversation_id);
    if (evictions.length) await this.revocation.confirmRevoked();

    const out = [];
    for (const d of done) {
      const plan = plans.find((p) => p.learner.id === d.learnerId)!;
      const [moved, lost] = await Promise.all([
        this.prisma.lesson.count({ where: { learnerId: d.learnerId, teacherId: toTeacher.id, outcome: null, startsAt: { gt: new Date() } } }),
        this.prisma.lesson.count({ where: { id: { in: plan.before }, outcome: LessonOutcome.RESCHEDULED, scheduleSlotId: null } }),
      ]);
      out.push({ learnerId: d.learnerId, transferId: d.transferId, lessonsMoved: moved, lessonsRescheduled: lost });
    }
    return out;
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
    const department = actor.staffRole !== 'super_admin' && (await this.lessons.isManager(actor));
    const teachers = department ? await this.lessons.teacherScope.scopeOf(actor) : null;
    const manager = actor.staffRole === 'super_admin' || (teachers?.all ?? false);
    // PD-35: a narrowed teacher supervisor sees their teachers' children's pauses
    // and, like anyone, the children they supervise.
    const scope = manager
      ? null
      : [
          ...new Set([
            ...(await this.lessons.supervisedLearnerIds(actor, new Date())),
            ...(teachers && !teachers.all
              ? (await this.prisma.learner.findMany({
                  where: { organizationId: actor.organizationId, teacherId: { in: [...teachers.teacherIds] } },
                  select: { id: true },
                })).map((l) => l.id)
              : []),
          ]),
        ];
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

  /**
   * A one-off lesson (a make-up, a moved or added lesson) the change of
   * teacher could not carry -- chat.transfer_learner rescheduled it because the
   * new teacher was busy -- is never left behind in silence: it is listed in
   * Needs action (reason teacher_changed) with what blocks it, and the family
   * is told a new time follows. Weekly lessons are re-created at the new times.
   */
  private async recordStranded(
    tx: Tx,
    learner: Learner,
    toTeacher: { id: string; name: string },
    before: string[],
    lang: 'ar' | 'en',
    actor: Actor,
  ) {
    const stranded = await tx.$queryRaw<Array<{ id: string; starts_at: Date; ends_at: Date; kind: string; blocker: string | null }>>`
      SELECT l.id::text, l.starts_at, l.ends_at, l.kind,
             (SELECT x.id::text FROM chat.lesson x
               WHERE x.teacher_id = ${toTeacher.id}::uuid
                 AND (x.outcome IS NULL OR x.outcome IN ('held', 'student_no_show', 'teacher_no_show'))
                 AND tstzrange(x.starts_at, x.ends_at) && tstzrange(l.starts_at, l.ends_at)
               ORDER BY x.starts_at LIMIT 1) AS blocker
        FROM chat.lesson l
       WHERE l.id = ANY(${before}::uuid[]) AND l.schedule_slot_id IS NULL AND l.outcome = 'rescheduled'
         AND NOT EXISTS (SELECT 1 FROM chat.lesson y WHERE y.moved_from = l.id)`;
    for (const l of stranded) {
      if (!l.blocker) continue;
      await tx.lessonBlockedOccurrence.create({
        data: {
          organizationId: learner.organizationId,
          learnerId: learner.id,
          teacherId: toTeacher.id,
          reason: 'teacher_changed',
          strandedLesson: l.id,
          startsAt: l.starts_at,
          endsAt: l.ends_at,
          blockedBy: l.blocker,
        },
      });
      const subject = { id: l.id, learnerId: learner.id, organizationId: learner.organizationId, teacherId: toTeacher.id };
      await this.lessons.postCard(tx, subject, actor, CardKind.LESSON_UNSCHEDULED, {
        lessonId: l.id,
        learnerName: learner.name,
        teacherName: toTeacher.name,
        startsAt: l.starts_at.toISOString(),
        endsAt: l.ends_at.toISOString(),
        kind: l.kind,
      }, lang);
    }
  }

  /** The learner's weekly zone and the new teacher's, or null when there are no weekly times. */
  private async zonesFor(learnerId: string, toTeacherId: string): Promise<{ from: string; to: string } | null> {
    const slot = await this.prisma.learnerScheduleSlot.findFirst({ where: { learnerId, validTo: null }, select: { timezone: true } });
    if (!slot) return null;
    const to = await this.prisma.teacherAvailability.findFirst({ where: { teacherId: toTeacherId }, select: { timezone: true } });
    return to ? { from: slot.timezone, to: to.timezone } : null;
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

const WEEKDAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function transferFields(body: Record<string, unknown>) {
  const toTeacherId = body.toTeacherId;
  if (typeof toTeacherId !== 'string' || !isUuid(toTeacherId)) throw invalid('toTeacherId: must be a uuid');
  const reasonCode = body.reason;
  if (typeof reasonCode !== 'string' || !TRANSFER_REASONS.has(reasonCode)) {
    throw invalid(`reason: one of ${[...TRANSFER_REASONS].join(', ')}`);
  }
  return {
    toTeacherId,
    reasonCode,
    note: textField(body, 'note', 1000, false),
    handover: textField(body, 'handoverNote', 2000, false),
  };
}
