import { Inject, Injectable } from '@nestjs/common';
import { Conversation, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { AuthorizationService } from '../platform/authorization.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import { ActorKind, ConversationType, LessonKind, MemberRole } from '../communication/contracts/vocab';
import { CardPoster } from '../supervision/card-poster';
import { renderTrialCardBody, type CardLanguage } from './trial-cards';
import { ACADEMY_ZONE, canonicalZone, whenWithZone } from '../platform/time-zone';

type Tx = Prisma.TransactionClient;

/** The trial a card is about, as TrialService holds it. */
export interface TrialForCard {
  id: string;
  organizationId: string;
  teacherId: string;
  startsAt: Date;
  endsAt: Date;
  prospect: { displayName: string; level: string | null } | null;
}

/**
 * PD-11 T4 (part 2), membership as decided for the trial journey (owner,
 * 2026-10-20): each teacher's one permanent, staff-only TRIAL GROUP.
 *
 *   permanent  the teacher and the Teachers department's live conversation
 *              staff (the Teacher Supervisors), synced every time the group is
 *              ensured
 *   by choice  the trial desk -- Sales and Operations supervisors (owner,
 *              2026-10-21) -- JOIN when a trial needs them and LEAVE when it
 *              does not. Every one of them has the same right, and nothing
 *              here adds or removes one on their behalf -- except one who has
 *              left both departments, whose seat is ended at the next sync.
 *
 * Membership only decides who is notified. Access is the database's decision
 * (chat.staff_conversation_access's 'trial_group' branch): Sales and the
 * Teachers department read and write the group whether they are members or not,
 * so a trial-desk supervisor who left can still find it and rejoin. Trial records
 * are keyed by the trial, never by the group or its members, so joining and
 * leaving never touch an outcome or a statistic.
 *
 * It is created when the teacher's first trial is booked (in the booking's own
 * transaction) or when Sales or the Teachers department opens it, and never
 * twice (an advisory lock plus a partial unique index). It is never archived
 * here.
 */
@Injectable()
export class TrialGroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    private readonly cards: CardPoster,
    private readonly config: AppConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** Open one teacher's trial group (Sales or the Teachers department; the caller has checked). */
  async open(actor: Actor, teacherId: string) {
    if (!isUuid(teacherId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    const conv = await this.prisma.$transaction((tx) =>
      this.ensureInTx(tx, teacherId, actor.organizationId as string, actor.kind === ActorKind.STAFF ? actor.actorId : null),
    );
    return { conversationId: conv.id };
  }

  /** The teacher's own trial group, opened from the app. */
  async openOwn(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.TEACHER || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'only a teacher has a trial group of their own');
    }
    const conv = await this.prisma.$transaction((tx) => this.ensureInTx(tx, actor.actorId, actor.organizationId as string, null));
    return { conversationId: conv.id };
  }

  /**
   * Find or create the teacher's live trial group and bring its permanent
   * membership in line: the teacher and the Teachers department are seated;
   * staff who are in neither the Teachers department nor the trial desk any more
   * lose their seat. Trial-desk supervisors who chose to join stay. Runs inside the
   * caller's transaction, so a booking and the card it posts commit together.
   */
  async ensureInTx(tx: Tx, teacherId: string, organizationId: string, byStaffId: string | null): Promise<Conversation> {
    const teacher = await tx.teacher.findFirst({
      where: { id: teacherId, organizationId, isActive: true, leftAt: null },
      select: { id: true, name: true },
    });
    if (!teacher) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'trial_group:' + teacherId}))`;

    let conv = await tx.conversation.findFirst({
      where: { type: ConversationType.TRIAL_GROUP, trialTeacherId: teacherId, archivedAt: null },
    });
    const added: string[] = [];
    const removed: string[] = [];

    if (!conv) {
      conv = await tx.conversation.create({
        data: {
          organizationId,
          type: ConversationType.TRIAL_GROUP,
          trialTeacherId: teacherId,
          familyId: null,
          learnerId: null,
          // The staff side's name for it; the teacher's app shows its own label.
          title: teacher.name,
          teacherRequiresApproval: false,
          parentRequiresApproval: false,
        },
      });
      await tx.conversationMember.create({
        data: { conversationId: conv.id, actorId: teacherId, actorKind: ActorKind.TEACHER, memberRole: MemberRole.TEACHER, addedBy: byStaffId },
      });
      added.push(teacherId);
      await this.audit.audit(tx, {
        actorId: byStaffId, action: 'trial_group.created', entity: 'conversation', entityId: conv.id,
        after: { teacherId }, reason: 'trial group opened',
      });
    }
    if (conv.title !== teacher.name) {
      conv = await tx.conversation.update({ where: { id: conv.id }, data: { title: teacher.name } });
    }

    const live = await tx.conversationMember.findMany({ where: { conversationId: conv.id, leftAt: null } });
    if (!live.some((m) => m.actorId === teacherId)) {
      await tx.conversationMember.create({
        data: { conversationId: conv.id, actorId: teacherId, actorKind: ActorKind.TEACHER, memberRole: MemberRole.TEACHER, addedBy: byStaffId },
      });
      added.push(teacherId);
    }
    const liveStaff = new Set(live.filter((m) => m.actorKind === ActorKind.STAFF).map((m) => m.actorId));
    const staff = await this.syncStaff(tx, conv.id, teacherId, organizationId, byStaffId, liveStaff);
    added.push(...staff.added);
    removed.push(...staff.removed);
    if (added.length > 0 || removed.length > 0) {
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, { conversationId: conv.id, added, removed });
    }
    return conv;
  }

  /**
   * PD-35: bring an existing trial group's staff in line with the strict
   * switch, whatever the teacher's state -- an inactive teacher's group follows
   * the switch too. Creates nothing and never touches the teacher's own row.
   * Returns the staff added and removed.
   */
  async resyncStaffInTx(tx: Tx, conversationId: string): Promise<{ added: string[]; removed: string[] }> {
    const conv = await tx.conversation.findFirst({
      where: { id: conversationId, type: ConversationType.TRIAL_GROUP, archivedAt: null },
      select: { id: true, organizationId: true, trialTeacherId: true },
    });
    if (!conv?.trialTeacherId) return { added: [], removed: [] };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'trial_group:' + conv.trialTeacherId}))`;
    const live = await tx.conversationMember.findMany({
      where: { conversationId: conv.id, leftAt: null, actorKind: ActorKind.STAFF },
      select: { actorId: true },
    });
    const staff = await this.syncStaff(tx, conv.id, conv.trialTeacherId, conv.organizationId, null, new Set(live.map((m) => m.actorId)));
    if (staff.added.length > 0 || staff.removed.length > 0) {
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, { conversationId: conv.id, ...staff });
    }
    return staff;
  }

  /**
   * The permanent staff of a trial group: the Teachers department, or with the
   * switch on the teacher's own supervisor and the Teachers Manager. Under the
   * caller's per-teacher lock.
   */
  private async syncStaff(
    tx: Tx,
    conversationId: string,
    teacherId: string,
    organizationId: string,
    byStaffId: string | null,
    liveStaff: ReadonlySet<string>,
  ): Promise<{ added: string[]; removed: string[] }> {
    const staff = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT s.id::text AS id
        FROM chat.staff s
       WHERE s.organization_id = ${organizationId}::uuid
         AND s.is_active AND s.left_at IS NULL
         AND s.role IN ('admin', 'coverage', 'manager')
         AND chat.teachers_department_role(s.id) IS NOT NULL
         -- PD-35: with the switch on, the teacher's own supervisor and the Teachers Manager.
         AND (NOT chat.teacher_scope_strict() OR chat.staff_teacher_scope(s.id, ${teacherId}::uuid) IN ('self', 'manager'))
       ORDER BY s.id`;
    const wanted = new Set(staff.map((s) => s.id));
    const added: string[] = [];
    const removed: string[] = [];
    for (const id of wanted) {
      if (liveStaff.has(id)) continue;
      await tx.conversationMember.create({
        data: { conversationId, actorId: id, actorKind: ActorKind.STAFF, memberRole: MemberRole.ADMIN, addedBy: byStaffId },
      });
      added.push(id);
    }
    // A seat ends only for someone who may no longer sit here at all; a Sales
    // supervisor's own choice to stay is never undone by a sync.
    const sales = liveStaff.size === 0 ? new Set<string>() : await this.inSales(tx, [...liveStaff]);
    // PD-35: nor is a visible seat taken by choice -- it is the seat service's to end.
    const seated = new Set(
      (await tx.$queryRaw<Array<{ staff_id: string }>>`
        SELECT staff_id::text AS staff_id FROM chat.conversation_seat
         WHERE conversation_id = ${conversationId}::uuid AND left_at IS NULL AND member_id IS NOT NULL`).map((r) => r.staff_id),
    );
    const leaving = [...liveStaff].filter((id) => !wanted.has(id) && !sales.has(id) && !seated.has(id));
    if (leaving.length > 0) {
      await tx.conversationMember.updateMany({
        where: { conversationId, actorId: { in: leaving }, leftAt: null },
        data: { leftAt: new Date() },
      });
      removed.push(...leaving);
    }
    return { added, removed };
  }

  /**
   * Post a trial card into the teacher's trial group, in the caller's
   * transaction (the group is ensured first). Written in the teacher's language.
   */
  async postCard(tx: Tx, trial: TrialForCard, recorder: Actor | null, kind: string, extra: Record<string, unknown> = {}) {
    const conv = await this.ensureInTx(tx, trial.teacherId, trial.organizationId, recorder?.kind === ActorKind.STAFF ? recorder.actorId : null);
    const teacher = await this.conversations.requireActor(trial.teacherId);
    const lang: CardLanguage = teacher.locale === 'en' ? 'en' : 'ar';
    const payload = {
      trialId: trial.id,
      prospectName: trial.prospect?.displayName ?? '',
      level: trial.prospect?.level ?? null,
      startsAt: trial.startsAt.toISOString(),
      durationMinutes: Math.round((trial.endsAt.getTime() - trial.startsAt.getTime()) / 60_000),
      when: await this.when(trial.startsAt, lang),
      ...extra,
    };
    await this.cards.post(tx, conv, recorder, { kind, payload, body: renderTrialCardBody(kind, payload, lang) });
    return conv;
  }

  /**
   * A Sales or Operations supervisor joins a teacher's trial group, to handle a trial in it.
   * Idempotent: joining twice is one seat.
   */
  async join(actor: Actor, conversationId: string) {
    const conv = await this.trialGroup(actor, conversationId);
    if (!(await this.canSitAsSales(actor))) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'only a Sales or Operations supervisor joins a trial group by choice');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'trial_group:' + (conv.trialTeacherId as string)}))`;
      const seated = await tx.conversationMember.findFirst({ where: { conversationId: conv.id, actorId: actor.actorId, leftAt: null } });
      if (seated) return;
      await tx.conversationMember.create({
        data: { conversationId: conv.id, actorId: actor.actorId, actorKind: ActorKind.STAFF, memberRole: MemberRole.ADMIN, addedBy: actor.actorId },
      });
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, { conversationId: conv.id, added: [actor.actorId], removed: [] });
      await this.audit.audit(tx, {
        actorId: actor.actorId, action: 'trial_group.joined', entity: 'conversation', entityId: conv.id,
        after: { teacherId: conv.trialTeacherId }, reason: 'trial-desk supervisor joined',
      });
    });
    return this.context(actor, conversationId);
  }

  /**
   * A Sales or Operations supervisor leaves a teacher's trial group. The teacher and the
   * Teachers department are permanent and cannot leave. Nothing about any trial
   * changes: outcomes are the trial's, not the member's.
   */
  async leave(actor: Actor, conversationId: string) {
    const conv = await this.trialGroup(actor, conversationId);
    if (actor.kind !== ActorKind.STAFF || (await this.isPermanentStaff(actor.actorId, conv.trialTeacherId as string))) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'the teacher and the Teacher Supervisors are permanent members of a trial group');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'trial_group:' + (conv.trialTeacherId as string)}))`;
      const left = await tx.conversationMember.updateMany({
        where: { conversationId: conv.id, actorId: actor.actorId, leftAt: null },
        data: { leftAt: new Date() },
      });
      if (left.count === 0) return;
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, { conversationId: conv.id, added: [], removed: [actor.actorId] });
      await this.audit.audit(tx, {
        actorId: actor.actorId, action: 'trial_group.left', entity: 'conversation', entityId: conv.id,
        after: { teacherId: conv.trialTeacherId }, reason: 'trial-desk supervisor left',
      });
    });
    return this.context(actor, conversationId);
  }

  /** Who the caller is in this trial group, for the Admin Web's join/leave bar. */
  async context(actor: Actor, conversationId: string) {
    const conv = await this.trialGroup(actor, conversationId);
    const teacher = await this.prisma.teacher.findUnique({ where: { id: conv.trialTeacherId as string }, select: { id: true, name: true } });
    const seated = actor.kind === ActorKind.STAFF
      && (await this.prisma.conversationMember.count({ where: { conversationId: conv.id, actorId: actor.actorId, leftAt: null } })) > 0;
    const permanent = actor.kind === ActorKind.STAFF && (await this.isPermanentStaff(actor.actorId, conv.trialTeacherId as string));
    const sales = await this.canSitAsSales(actor);
    return {
      conversationId: conv.id,
      teacher,
      membership: {
        isMember: seated,
        permanent,
        canJoin: sales && !seated,
        canLeave: seated && !permanent,
      },
    };
  }

  /** The live trial group `conversationId`, in the caller's organization, or 404. */
  async trialGroup(actor: Actor, conversationId: string): Promise<Conversation> {
    if (!isUuid(conversationId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'trial group not found');
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId: actor.organizationId ?? undefined, type: ConversationType.TRIAL_GROUP, archivedAt: null },
    });
    if (!conv || !actor.organizationId) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'trial group not found');
    return conv;
  }

  private async canSitAsSales(actor: Actor): Promise<boolean> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive) return false;
    return (await this.inSales(this.prisma, [actor.actorId])).has(actor.actorId);
  }

  /** The Teachers department -- with PD-35's switch on, the teacher's own supervisor and the Teachers Manager. */
  private async isPermanentStaff(staffId: string, teacherId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ permanent: boolean }>>`
      SELECT chat.teachers_department_role(${staffId}::uuid) IS NOT NULL
             AND (NOT chat.teacher_scope_strict()
                  OR chat.staff_teacher_scope(${staffId}::uuid, ${teacherId}::uuid) IN ('self', 'manager')) AS permanent`;
    return rows[0]?.permanent === true;
  }

  /** Of `ids`, the live conversation staff of the trial desk (Sales or Operations). */
  private async inSales(db: Tx | PrismaService, ids: string[]): Promise<Set<string>> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT s.id::text AS id
        FROM chat.staff s
       WHERE s.id = ANY(${ids}::uuid[])
         AND s.is_active AND s.left_at IS NULL
         AND s.role IN ('admin', 'coverage', 'manager')
         AND chat.trial_desk_role(s.id) IS NOT NULL`;
    return new Set(rows.map((r) => r.id));
  }

  /**
   * What "+" offers the teacher in their own trial group: a report for each of
   * their trials that has started and has no outcome yet. Advisory -- the
   * attendance route decides again.
   */
  async ticketsFor(actorId: string, conversationId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const tenant = this.authz.canActInOrganization(actor, conv.organizationId);
    if (!tenant.allowed) throw new CommError(tenant.code, tenant.reason, 404);
    if (
      conv.type !== ConversationType.TRIAL_GROUP || conv.archivedAt
      || actor.kind !== ActorKind.TEACHER || !actor.isActive || conv.trialTeacherId !== actor.actorId
    ) {
      return { tickets: [] };
    }
    const rows = await this.prisma.$queryRaw<Array<{ id: string; starts_at: Date; ends_at: Date; display_name: string }>>`
      SELECT l.id::text AS id, l.starts_at, l.ends_at, p.display_name
        FROM chat.lesson l JOIN chat.trial_prospect p ON p.id = l.prospect_id
       WHERE l.kind = ${LessonKind.TRIAL} AND l.teacher_id = ${actor.actorId}::uuid
         AND l.outcome IS NULL AND l.starts_at <= now()
       ORDER BY l.starts_at
       LIMIT 50`;
    return {
      tickets: rows.map((r) => ({
        ticket: 'trial_report' as const,
        trialId: r.id,
        prospectName: r.display_name,
        startsAt: r.starts_at.toISOString(),
        durationMinutes: Math.round((r.ends_at.getTime() - r.starts_at.getTime()) / 60_000),
      })),
    };
  }

  /**
   * The instant in the academy's zone, naming that zone (PD-22): members of one
   * conversation live in different countries, so the text must not pass for
   * anyone's own clock. Clients draw `startsAt` in the reader's zone instead.
   */
  async when(at: Date, lang: CardLanguage): Promise<string> {
    const zone = canonicalZone(await this.config.get('stats.zone')) ?? ACADEMY_ZONE;
    return whenWithZone(at, zone, lang);
  }
}
