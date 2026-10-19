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
 * PD-11 T4 (part 2): each teacher's one staff-only TRIAL GROUP.
 *
 * Its members are the teacher and the Sales department's live conversation
 * staff (owner decision 2026-10-19: the whole department), synced every time
 * it is ensured. The Teachers department reads and writes it too, through
 * chat.staff_conversation_access's 'trial_group' branch, without being a
 * member -- so it is not notified of every trial of every teacher. Membership
 * only decides who is notified; access is the database's decision.
 *
 * It is created when the teacher's first trial is booked (in the booking's own
 * transaction) or when Sales or the Teachers department opens it, and never
 * twice (an advisory lock plus a partial unique index).
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
   * Find or create the teacher's live trial group and bring its staff
   * membership in line with the Sales department. Runs inside the caller's
   * transaction, so a booking and the card it posts commit together.
   */
  async ensureInTx(tx: Tx, teacherId: string, organizationId: string, byStaffId: string | null): Promise<Conversation> {
    const teacher = await tx.teacher.findFirst({
      where: { id: teacherId, organizationId, isActive: true, leftAt: null },
      select: { id: true, name: true },
    });
    if (!teacher) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'trial_group:' + teacherId}))`;

    const staff = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT s.id::text AS id
        FROM chat.staff s
       WHERE s.organization_id = ${organizationId}::uuid
         AND s.is_active AND s.left_at IS NULL
         AND s.role IN ('admin', 'coverage', 'manager')
         AND chat.sales_department_role(s.id) IS NOT NULL
       ORDER BY s.id`;
    const wanted = new Set(staff.map((s) => s.id));

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
    for (const id of wanted) {
      if (liveStaff.has(id)) continue;
      await tx.conversationMember.create({
        data: { conversationId: conv.id, actorId: id, actorKind: ActorKind.STAFF, memberRole: MemberRole.ADMIN, addedBy: byStaffId },
      });
      added.push(id);
    }
    const leaving = [...liveStaff].filter((id) => !wanted.has(id));
    if (leaving.length > 0) {
      await tx.conversationMember.updateMany({
        where: { conversationId: conv.id, actorId: { in: leaving }, leftAt: null },
        data: { leftAt: new Date() },
      });
      removed.push(...leaving);
    }
    if (added.length > 0 || removed.length > 0) {
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, { conversationId: conv.id, added, removed });
    }
    return conv;
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

  /** The instant in the academy's zone, as the group reads it. */
  private async when(at: Date, lang: CardLanguage): Promise<string> {
    const zone = String(await this.config.get('stats.zone'));
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
      timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    }).format(at);
  }
}
