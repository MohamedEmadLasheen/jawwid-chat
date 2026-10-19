import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import { CardKind, SupervisionKind } from '../communication/contracts/vocab';
import { LessonService, invalid, textField } from './lesson.service';
import { SupervisionConversationService } from '../supervision/supervision-conversation.service';

const ENTRY_KINDS: ReadonlySet<string> = new Set([SupervisionKind.COMPLAINT, SupervisionKind.MONTHLY_COMMENT, SupervisionKind.NOTE]);
const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * PD-10/PD-11: the Teacher Supervision section -- one timeline per teacher, read
 * and written by the Teachers department and the super admin only (PD-10's
 * table; never the teacher, never a family).
 *
 * The timeline is a QUERY over the records that already exist -- the entries
 * written here, the rulings decided on the teacher's lessons, the lessons the
 * teacher did not give, transfers in and out, days off -- so nothing is
 * recorded twice and nothing can drift.
 *
 * The bonus ticket writes a `bonus` entry and posts a card into the teacher's
 * supervision conversation -- ONE per teacher, with the whole Teachers
 * department (PD-12, reconciled 2026-10-19). The amount is payroll's (PD-10):
 * Chat records the reason and tells Core/HR.
 */
@Injectable()
export class SupervisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly outbox: OutboxService,
    private readonly supervisionChats: SupervisionConversationService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async timeline(actorId: string, teacherId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const teacher = await this.supervisedTeacher(actor, teacherId);
    const [entries, rulings, missed, transfersIn, transfersOut, daysOff] = await Promise.all([
      this.prisma.teacherSupervisionEntry.findMany({ where: { teacherId: teacher.id }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.lessonRuling.findMany({
        where: { lesson: { teacherId: teacher.id }, decision: { not: null } },
        include: { lesson: { select: { id: true, startsAt: true, learner: { select: { name: true } }, prospect: { select: { displayName: true } } } } },
        orderBy: { decidedAt: 'desc' },
        take: 200,
      }),
      this.prisma.lesson.findMany({
        where: { teacherId: teacher.id, outcome: { in: ['teacher_apology', 'teacher_no_show'] } },
        include: { learner: { select: { name: true } }, prospect: { select: { displayName: true } } },
        orderBy: { startsAt: 'desc' },
        take: 200,
      }),
      this.prisma.learnerTransfer.findMany({ where: { toTeacherId: teacher.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.learnerTransfer.findMany({ where: { fromTeacherId: teacher.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.teacherDayOff.findMany({ where: { teacherId: teacher.id }, orderBy: { day: 'desc' }, take: 100 }),
    ]);
    const learnerNames = new Map(
      (await this.prisma.learner.findMany({
        where: { id: { in: [...transfersIn, ...transfersOut].map((t) => t.learnerId) } },
        select: { id: true, name: true },
      })).map((l) => [l.id, l.name]),
    );

    const items = [
      ...entries.map((e) => ({
        id: e.id,
        type: e.kind,
        at: e.createdAt.toISOString(),
        body: e.body,
        period: e.period ? e.period.toISOString().slice(0, 7) : null,
        by: e.createdBy,
      })),
      ...rulings.map((r) => ({
        id: r.id,
        type: r.kind,
        at: (r.decidedAt ?? r.openedAt).toISOString(),
        decision: r.decision,
        body: r.decisionNote ?? r.reason,
        lesson: { id: r.lesson.id, startsAt: r.lesson.startsAt.toISOString(), learnerName: r.lesson.learner?.name ?? r.lesson.prospect?.displayName ?? '' },
        by: r.decidedBy,
      })),
      ...missed.map((l) => ({
        id: l.id,
        type: l.outcome as string,
        at: (l.outcomeAt ?? l.startsAt).toISOString(),
        body: l.outcomeNote,
        lesson: { id: l.id, startsAt: l.startsAt.toISOString(), learnerName: l.learner?.name ?? l.prospect?.displayName ?? '' },
      })),
      ...transfersIn.map((t) => ({
        id: t.id,
        type: 'transfer_in',
        at: t.createdAt.toISOString(),
        reason: t.reasonCode,
        body: t.note,
        learner: { id: t.learnerId, name: learnerNames.get(t.learnerId) ?? '' },
        by: t.decidedBy,
      })),
      ...transfersOut.map((t) => ({
        id: t.id,
        type: 'transfer_out',
        at: t.createdAt.toISOString(),
        reason: t.reasonCode,
        body: t.note,
        learner: { id: t.learnerId, name: learnerNames.get(t.learnerId) ?? '' },
        by: t.decidedBy,
      })),
      ...daysOff.map((d) => ({
        id: d.id,
        type: 'day_off',
        at: d.createdAt.toISOString(),
        day: d.day.toISOString().slice(0, 10),
        body: d.reason,
        by: d.createdBy,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    // Who recorded each item, by name: the page shows people, not ids.
    const staffIds = [...new Set(items.map((i) => ('by' in i ? i.by : null)).filter((x): x is string => !!x))];
    const staff = staffIds.length
      ? await this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })
      : [];
    const nameOf = new Map(staff.map((s) => [s.id, s.name]));
    return {
      teacher: { id: teacher.id, name: teacher.name },
      items: items.map((i) => ({ ...i, byName: 'by' in i && i.by ? (nameOf.get(i.by) ?? null) : null })),
    };
  }

  /** A complaint, a monthly comment (one month, `period: YYYY-MM`) or a note. */
  async addEntry(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const teacher = await this.supervisedTeacher(actor, teacherId);
    const kind = body.kind;
    if (typeof kind !== 'string' || !ENTRY_KINDS.has(kind)) throw invalid(`kind: one of ${[...ENTRY_KINDS].join(', ')}`);
    const text = textField(body, 'body', 2000, true) as string;
    let period: Date | null = null;
    if (kind === SupervisionKind.MONTHLY_COMMENT) {
      if (typeof body.period !== 'string' || !MONTH_RE.test(body.period)) throw invalid('period: a month as YYYY-MM');
      period = new Date(`${body.period}-01T00:00:00Z`);
    }
    const entry = await this.prisma.$transaction(async (tx) => {
      const created = await tx.teacherSupervisionEntry.create({
        data: { organizationId: teacher.organizationId, teacherId: teacher.id, kind, body: text, period, createdBy: actor.actorId },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId, action: `teacher.supervision_${kind}`, entity: 'teacher', entityId: teacher.id,
        after: { entryId: created.id }, reason: kind,
      });
      return created;
    });
    return { id: entry.id, kind: entry.kind };
  }

  /**
   * The bonus ticket: a `bonus` entry, a card in the teacher's supervision chat,
   * and a note to Core/HR. No amount travels through Chat.
   */
  async bonus(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const teacher = await this.supervisedTeacher(actor, teacherId);
    const reason = textField(body, 'reason', 2000, true) as string;
    let chatId = '';
    const entry = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const chat = await this.supervisionChats.ensureInTx(tx, teacher.id, teacher.organizationId, actor.actorId);
        chatId = chat.id;
        const created = await tx.teacherSupervisionEntry.create({
          data: {
            organizationId: teacher.organizationId,
            teacherId: teacher.id,
            kind: SupervisionKind.BONUS,
            body: reason,
            conversationId: chat.id,
            createdBy: actor.actorId,
          },
        });
        await this.lessons.postCardInto(tx, chat, null, actor, CardKind.TEACHER_BONUS, { teacherName: teacher.name, reason }, 'ar');
        await this.outbox.enqueue(tx, CommEvent.TEACHER_BONUS_RECORDED, { teacherId: teacher.id, entryId: created.id });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'teacher.bonus', entity: 'teacher', entityId: teacher.id,
          after: { entryId: created.id }, reason,
        });
        return created;
      }),
    );
    return { id: entry.id, kind: entry.kind, conversationId: chatId };
  }

  /** The teacher's supervision conversation (one per teacher, with the Teachers department), opened if needed. */
  async supervisionChat(actorId: string, teacherId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const teacher = await this.supervisedTeacher(actor, teacherId);
    const chat = await this.prisma.$transaction((tx) =>
      this.supervisionChats.ensureInTx(tx, teacher.id, teacher.organizationId, actor.actorId),
    );
    return { conversationId: chat.id };
  }

  /** PD-10: the Teachers department and the super admin; anyone else -- the teacher included -- reads it as unknown. */
  private async supervisedTeacher(actor: Actor, teacherId: string) {
    if (!isUuid(teacherId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    const allowed = actor.kind === 'staff' && actor.isActive && !!actor.organizationId
      && (actor.staffRole === 'super_admin' || (await this.lessons.isManager(actor)));
    if (!allowed) throw new CommError(CommErrorCode.LESSON_DENIED, 'the supervision section belongs to the Teachers department');
    const teacher = await this.prisma.teacher.findFirst({ where: { id: teacherId, organizationId: actor.organizationId } });
    if (!teacher) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    return teacher;
  }
}
