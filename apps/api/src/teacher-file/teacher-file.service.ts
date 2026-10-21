import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AuthorizationService } from '../platform/authorization.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import type { TeacherFileAccess, TeachersDepartmentRole } from '../platform/teacher-file-policy';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { ActorKind } from '../communication/contracts/vocab';

/**
 * What the Teacher File writes. The first three are entries on PD-11's
 * timeline (chat.teacher_supervision_entry); a day off and its cancellation
 * are PD-11's chat.teacher_day_off -- the one record of days off, which the
 * scheduler reads -- added and removed.
 */
export const TeacherFileEntryKind = {
  COMPLAINT: 'complaint',
  COMPLAINT_RESOLUTION: 'complaint_resolution',
  MONTHLY_COMMENT: 'monthly_comment',
  DAY_OFF: 'day_off',
  DAY_OFF_CANCELLATION: 'day_off_cancellation',
} as const;
export type TeacherFileEntryKind = (typeof TeacherFileEntryKind)[keyof typeof TeacherFileEntryKind];
const KINDS: ReadonlySet<string> = new Set(Object.values(TeacherFileEntryKind));

/** Same shapes the table's CHECK constraints accept; checked here first for a readable 400. */
const PHONE = /^\+?[0-9][0-9 ()-]{5,30}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
/** chat.teacher_supervision_entry's CHECK; a day off's reason is chat.teacher_day_off's 500. */
const BODY_MAX = 2000;
const DAY_OFF_REASON_MAX = 500;

type Entry = Prisma.TeacherSupervisionEntryGetPayload<object>;
type DayOff = Prisma.TeacherDayOffGetPayload<object>;

/**
 * PD-10: the administration-only Teacher File -- personal information,
 * assigned students and the supervision timeline -- and the ONLY reader or
 * writer of chat.teacher_file and its phone (teacher-file-confinement.spec
 * fails the build otherwise). The timeline and days off are PD-11's tables
 * (20261018160000, 20261018140000), shared with the lessons code.
 *
 * Who may do what is AuthorizationService.teacherFileAccess; the database
 * triggers of 20261018170000 and PD-11 decide only whether a row is lawful.
 * The gate runs BEFORE the teacher is looked up, so a refused actor learns
 * nothing about which teacher ids exist; a foreign or unknown id is the same 404.
 */
@Injectable()
export class TeacherFileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------

  /** Every teacher of the organization, with what the list needs and nothing personal. */
  async list(actorId: string) {
    const { actor, access } = await this.gate(actorId, (a) => a.canView);
    const org = actor.organizationId as string;

    const teachers = await this.prisma.teacher.findMany({
      where: { organizationId: org },
      select: { id: true, name: true, isActive: true, leftAt: true },
      orderBy: { name: 'asc' },
    });
    const ids = teachers.map((t) => t.id);
    const students = await this.prisma.learner.groupBy({
      by: ['teacherId'],
      where: { organizationId: org, teacherId: { in: ids } },
      _count: { _all: true },
    });
    const studentCount = new Map(students.map((r) => [r.teacherId, r._count._all]));
    const open = await this.openComplaintCounts(ids);

    return {
      access: publicAccess(access),
      teachers: teachers.map((t) => ({
        id: t.id,
        name: t.name,
        isActive: t.isActive && t.leftAt === null,
        studentCount: studentCount.get(t.id) ?? 0,
        openComplaints: open.get(t.id) ?? 0,
      })),
    };
  }

  async detail(actorId: string, teacherId: string) {
    const { actor, access } = await this.gate(actorId, (a) => a.canView);
    const teacher = await this.requireTeacher(actor, teacherId);

    const [file, learners, entries, daysOff, deductions] = await Promise.all([
      this.prisma.teacherFile.findUnique({ where: { teacherId: teacher.id } }),
      this.prisma.learner.findMany({
        where: { organizationId: teacher.organizationId, teacherId: teacher.id },
        include: { family: { select: { id: true, displayName: true } } },
        orderBy: [{ name: 'asc' }],
      }),
      this.prisma.teacherSupervisionEntry.findMany({
        where: { teacherId: teacher.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.teacherDayOff.findMany({ where: { teacherId: teacher.id }, orderBy: { day: 'desc' } }),
      this.prisma.teacherViolation.findMany({
        where: { teacherId: teacher.id, decision: { in: ['deduction_1', 'deduction_2'] } },
        orderBy: { decidedAt: 'desc' },
      }),
    ]);

    const supervision = await this.prisma.learnerSupervision.findMany({
      where: { learnerId: { in: learners.map((l) => l.id) } },
    });
    const supervisorOf = new Map(supervision.map((r) => [r.learnerId, r.supervisorId]));
    const staffIds = new Set<string>([
      ...supervision.map((r) => r.supervisorId),
      ...entries.map((e) => e.createdBy),
      ...daysOff.map((d) => d.createdBy),
      ...deductions.map((v) => v.decidedBy as string),
    ]);
    if (file?.updatedBy) staffIds.add(file.updatedBy);
    const staff = await this.prisma.staff.findMany({
      where: { id: { in: [...staffIds] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(staff.map((s) => [s.id, s.name]));
    const person = (id: string) => ({ id, name: nameOf.get(id) ?? '' });

    return {
      access: publicAccess(access),
      teacher: {
        id: teacher.id,
        name: teacher.name,
        isActive: teacher.isActive && teacher.leftAt === null,
        leftAt: teacher.leftAt,
      },
      personal: {
        fullName: teacher.name,
        phone: file?.adminOnlyPhone ?? null,
        email: file?.email ?? null,
        joinedOn: file?.joinedOn ? isoDate(file.joinedOn) : null,
        updatedAt: file?.updatedAt ?? null,
        updatedBy: file?.updatedBy ? person(file.updatedBy) : null,
      },
      assignedStudents: learners.map((l) => {
        const supervisorId = supervisorOf.get(l.id);
        return {
          learnerId: l.id,
          name: l.name,
          level: l.level,
          family: { id: l.family.id, displayName: l.family.displayName },
          supervisor: supervisorId ? person(supervisorId) : null,
        };
      }),
      employment: { teachingMarket: file?.teachingMarket ?? null, studentCount: learners.length },
      supervision: shapeTimeline(entries, daysOff, person),
      // PD-18: what was recorded, for everyone who reads the file. The AMOUNTS are
      // payroll's and come only from GET /teacher-files/:id/finance (super admin).
      history: {
        bonuses: entries
          .filter((e) => e.kind === 'bonus')
          .map((e) => ({ id: e.id, reason: e.body, createdAt: e.createdAt, author: person(e.createdBy) })),
        deductions: deductions.map((v) => ({
          id: v.id,
          step: v.decision as 'deduction_1' | 'deduction_2',
          violation: v.kind,
          month: isoDate(v.month).slice(0, 7),
          note: v.decisionNote,
          decidedAt: v.decidedAt,
          author: person(v.decidedBy as string),
        })),
      },
    };
  }

  // ------------------------------------------------------------------
  // Writing
  // ------------------------------------------------------------------

  /**
   * Phone, email and joining date. A field left out is unchanged; null clears
   * it. The audit row names WHICH fields changed and never their values: the
   * audit trail is read more widely than the Teacher File is.
   */
  async updatePersonal(
    actorId: string,
    teacherId: string,
    body: { phone?: unknown; email?: unknown; joinedOn?: unknown; teachingMarket?: unknown; reason?: unknown },
  ) {
    const { actor } = await this.gate(actorId, (a) => a.canEditPersonal);
    const teacher = await this.requireTeacher(actor, teacherId);

    const patch: { adminOnlyPhone?: string | null; email?: string | null; joinedOn?: Date | null; teachingMarket?: string | null } = {};
    if (body.phone !== undefined) patch.adminOnlyPhone = optionalMatching('phone', body.phone, PHONE, 'is not a phone number');
    if (body.email !== undefined) {
      const email = optionalMatching('email', body.email, EMAIL, 'is not an email address');
      if (email && email.length > 254) throw invalid('email', 'must be at most 254 characters');
      patch.email = email ? email.toLowerCase() : null;
    }
    if (body.teachingMarket !== undefined) {
      const market = optionalMatching('teachingMarket', body.teachingMarket, /^.{1,80}$/u, 'must be at most 80 characters');
      patch.teachingMarket = market;
    }
    if (body.joinedOn !== undefined) patch.joinedOn = body.joinedOn === null ? null : requireDate('joinedOn', body.joinedOn);
    if (Object.keys(patch).length === 0) throw invalid('body', 'nothing to change');
    const reason = requireText('reason', body.reason, 500);

    await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const before = await tx.teacherFile.findUnique({ where: { teacherId: teacher.id } });
      await tx.teacherFile.upsert({
        where: { teacherId: teacher.id },
        create: { teacherId: teacher.id, organizationId: teacher.organizationId, ...patch, updatedBy: actor.actorId },
        update: { ...patch, updatedBy: actor.actorId },
      });
      const changed = (Object.keys(patch) as Array<keyof typeof patch>).filter(
        (k) => String(before?.[k] ?? null) !== String(patch[k] ?? null),
      );
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_file.personal_updated',
        entity: 'teacher',
        entityId: teacher.id,
        after: { changed: changed.map((k) => (k === 'adminOnlyPhone' ? 'phone' : k)) },
        reason,
      });
    });
    return this.detail(actorId, teacher.id);
  }

  /** One timeline entry. Entries are never edited: a correction is another entry. */
  async addEntry(
    actorId: string,
    teacherId: string,
    body: {
      kind?: unknown;
      body?: unknown;
      month?: unknown;
      dayOffOn?: unknown;
      refersTo?: unknown;
      sourceConversationId?: unknown;
      sourceMessageId?: unknown;
    },
  ) {
    const { actor } = await this.gate(actorId, (a) => a.canWriteSupervision);
    const teacher = await this.requireTeacher(actor, teacherId);

    if (typeof body.kind !== 'string' || !KINDS.has(body.kind)) {
      throw invalid('kind', `must be one of ${[...KINDS].join(', ')}`);
    }
    const kind = body.kind as TeacherFileEntryKind;
    if (kind === TeacherFileEntryKind.DAY_OFF || kind === TeacherFileEntryKind.DAY_OFF_CANCELLATION) {
      return this.dayOff(actor, teacher, kind, body);
    }
    const text = requireText('body', body.body, BODY_MAX);
    const data: Prisma.TeacherSupervisionEntryUncheckedCreateInput = {
      organizationId: teacher.organizationId,
      teacherId: teacher.id,
      kind,
      body: text,
      createdBy: actor.actorId,
    };

    switch (kind) {
      case TeacherFileEntryKind.MONTHLY_COMMENT:
        if (typeof body.month !== 'string' || !MONTH.test(body.month)) throw invalid('month', 'must be YYYY-MM');
        data.period = requireDate('month', `${body.month}-01`);
        break;
      case TeacherFileEntryKind.COMPLAINT_RESOLUTION:
        data.refersTo = requireUuid('refersTo', body.refersTo);
        break;
      case TeacherFileEntryKind.COMPLAINT:
        if (body.sourceConversationId !== undefined && body.sourceConversationId !== null) {
          data.conversationId = await this.readableSource(actor, body.sourceConversationId);
          if (body.sourceMessageId !== undefined && body.sourceMessageId !== null) {
            data.sourceMessageId = requireUuid('sourceMessageId', body.sourceMessageId);
          }
        } else if (body.sourceMessageId !== undefined && body.sourceMessageId !== null) {
          throw invalid('sourceMessageId', 'needs sourceConversationId');
        }
        break;
    }

    const entry = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const row = await tx.teacherSupervisionEntry.create({ data });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_file.entry_added',
        entity: 'teacher',
        entityId: teacher.id,
        after: { entryId: row.id, kind },
        // The entry's text is the reason, and it stays in the timeline: the
        // audit trail is read more widely than the Teacher File is.
        reason: `supervision entry: ${kind}`,
      });
      return row;
    });
    return { id: entry.id, kind: entry.kind, createdAt: entry.createdAt };
  }

  /**
   * A day off is PD-11's chat.teacher_day_off: adding one makes the day
   * unavailable for make-ups; cancelling removes the row (the audit row keeps
   * who, when and why). `refersTo` of a cancellation is the day off's id.
   */
  private async dayOff(
    actor: Actor,
    teacher: { id: string; organizationId: string },
    kind: TeacherFileEntryKind,
    body: { body?: unknown; dayOffOn?: unknown; refersTo?: unknown },
  ) {
    const text = requireText('body', body.body, DAY_OFF_REASON_MAX);
    if (kind === TeacherFileEntryKind.DAY_OFF) {
      const day = requireDate('dayOffOn', body.dayOffOn);
      const row = await this.write(async (tx) => {
        await this.conversations.assertActorLive(tx, actor);
        const created = await tx.teacherDayOff.create({
          data: { organizationId: teacher.organizationId, teacherId: teacher.id, day, reason: text, createdBy: actor.actorId },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'teacher.day_off_added',
          entity: 'teacher',
          entityId: teacher.id,
          after: { date: isoDate(day), dayOffId: created.id },
          reason: 'day off recorded on the Teacher File',
        });
        return created;
      });
      return { id: row.id, kind, createdAt: row.createdAt };
    }
    const id = requireUuid('refersTo', body.refersTo);
    const removedAt = new Date();
    await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const target = await tx.teacherDayOff.findFirst({ where: { id, teacherId: teacher.id } });
      if (!target) {
        throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'that day off does not exist (already cancelled?)', 409);
      }
      await tx.teacherDayOff.delete({ where: { id } });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher.day_off_removed',
        entity: 'teacher',
        entityId: teacher.id,
        before: { date: isoDate(target.day), dayOffId: id },
        reason: text,
      });
    });
    return { id, kind, createdAt: removedAt };
  }

  // ------------------------------------------------------------------

  /** Shared with TeacherPayrollService: the access decision runs before any teacher lookup. */
  async gate(actorId: string, needs: (a: TeacherFileAccess) => boolean) {
    const actor = await this.conversations.requireActor(actorId);
    const access = this.authz.teacherFileAccess(actor, {
      organizationId: actor.organizationId ?? '',
      teachersDepartmentRole: await this.teachersDepartmentRole(actor),
    });
    if (!needs(access)) {
      throw new CommError(
        CommErrorCode.TEACHER_FILE_DENIED,
        access.canView ? 'this change to a Teacher File is not yours to make' : 'Teacher Files are administration-only',
      );
    }
    return { actor, access };
  }

  private async teachersDepartmentRole(actor: Actor): Promise<TeachersDepartmentRole> {
    if (actor.kind !== ActorKind.STAFF || !actor.organizationId) return null;
    const dept = await this.prisma.department.findFirst({
      where: { organizationId: actor.organizationId, kind: 'teachers' },
      include: { members: { where: { staffId: actor.actorId }, select: { staffId: true } } },
    });
    if (!dept) return null;
    if (dept.managerId === actor.actorId) return 'manager';
    return dept.members.length > 0 ? 'member' : null;
  }

  async requireTeacher(actor: Actor, teacherId: string) {
    const notFound = new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'teacher not found');
    if (!isUuid(teacherId)) throw notFound;
    const teacher = await this.prisma.teacher.findUnique({ where: { id: teacherId } });
    if (!teacher || teacher.organizationId !== actor.organizationId) throw notFound;
    return teacher;
  }

  /**
   * A complaint may point at the conversation it came from only if the writer
   * can read that conversation: the link must never become a way to learn that
   * a conversation exists. Refused exactly like an unknown id.
   */
  private async readableSource(actor: Actor, value: unknown): Promise<string> {
    const id = requireUuid('sourceConversationId', value);
    const refused = invalid('sourceConversationId', 'is not a conversation you can read');
    const conversation = await this.conversations.requireConversation(id).catch(() => null);
    if (!conversation) throw refused;
    const membership = await this.conversations.membershipOf(conversation.id, actor.actorId);
    const decision = await this.conversations.canReadResolved(actor, conversation, membership);
    if (!decision.allowed) throw refused;
    return conversation.id;
  }

  private async openComplaintCounts(teacherIds: string[]): Promise<Map<string, number>> {
    if (teacherIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ teacher_id: string; open: number }>>`
      SELECT c.teacher_id::text AS teacher_id, count(*)::int AS open
        FROM chat.teacher_supervision_entry c
       WHERE c.kind = 'complaint'
         AND c.teacher_id = ANY(${teacherIds}::uuid[])
         AND NOT EXISTS (SELECT 1 FROM chat.teacher_supervision_entry r WHERE r.refers_to = c.id)
       GROUP BY c.teacher_id`;
    return new Map(rows.map((r) => [r.teacher_id, r.open]));
  }

  private async write<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      throw mapTimelineRefusal(e);
    }
  }
}

/** The access flags a client may see. `canViewFinance` offers PD-18's payroll sections, which re-check it. */
function publicAccess(a: TeacherFileAccess) {
  return { canEditPersonal: a.canEditPersonal, canWriteSupervision: a.canWriteSupervision, canViewFinance: a.canViewFinance };
}

/**
 * The flat, newest-first entries become what a supervisor reads: complaints
 * with their resolution, monthly comments with their earlier versions, and the
 * days off (PD-11's rows; a cancelled day off no longer exists, so
 * `cancellation` is always null -- the audit trail has it).
 */
export function shapeTimeline(entries: Entry[], daysOff: DayOff[], person: (id: string) => { id: string; name: string }) {
  const followUp = new Map<string, Entry>();
  for (const e of entries) if (e.refersTo) followUp.set(e.refersTo, e);
  const brief = (e: Entry) => ({ id: e.id, body: e.body, createdAt: e.createdAt, author: person(e.createdBy) });

  const complaints = entries
    .filter((e) => e.kind === TeacherFileEntryKind.COMPLAINT)
    .map((e) => {
      const r = followUp.get(e.id);
      return {
        ...brief(e),
        source: e.conversationId ? { conversationId: e.conversationId, messageId: e.sourceMessageId } : null,
        resolution: r ? brief(r) : null,
      };
    });

  const byMonth = new Map<string, Entry[]>();
  for (const e of entries.filter((x) => x.kind === TeacherFileEntryKind.MONTHLY_COMMENT)) {
    const key = isoDate(e.period as Date).slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), e]);
  }
  const monthlyComments = [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, versions]) => ({ month, current: brief(versions[0]), earlierVersions: versions.slice(1).map(brief) }));

  const days = [...daysOff]
    .sort((a, b) => b.day.getTime() - a.day.getTime())
    .map((d) => ({
      id: d.id,
      body: d.reason ?? '',
      createdAt: d.createdAt,
      author: person(d.createdBy),
      date: isoDate(d.day),
      cancellation: null,
    }));

  return { complaints, monthlyComments, daysOff: days };
}

/** A database refusal of an unlawful entry becomes 409, never a 500. */
export function mapTimelineRefusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  const text = e instanceof Error ? e.message : String(e);
  const code = (e as { meta?: { code?: string } })?.meta?.code ?? (e as { code?: string })?.code ?? '';
  if (
    ['23514', '42501', '23503', '23505', 'P2002', 'P2003'].includes(code) ||
    /check_violation|insufficient_privilege|foreign_key_violation|unique_violation|violates|23514|42501|23503|23505/.test(text)
  ) {
    if (/teacher_day_off_once_per_day|teacherId_day|\(teacher_id, day\)/.test(text)) {
      return new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'that day off is already recorded', 409);
    }
    if (code === 'P2002' || /teacher_supervision_entry_one_resolution/.test(text)) {
      return new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'that complaint already has a resolution', 409);
    }
    const why = /ERROR:\s*([^\n]+)/.exec(text)?.[1] ?? /Message: `([^`]+)`/.exec(text)?.[1] ?? 'the timeline refused this entry';
    return new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, why.replace(/^.*?ERROR:\s*/, ''), 409);
  }
  return e;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const invalid = (field: string, why: string) => new CommError(CommErrorCode.VALIDATION, `${field}: ${why}`, 400);

function requireUuid(field: string, value: unknown): string {
  if (!isUuid(value)) throw invalid(field, 'must be a uuid');
  return value.toLowerCase();
}

function requireText(field: string, value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw invalid(field, 'is required');
  if (value.trim().length > max) throw invalid(field, `must be at most ${max} characters`);
  return value.trim();
}

function optionalMatching(field: string, value: unknown, shape: RegExp, why: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw invalid(field, 'must be a string or null');
  const v = value.trim();
  if (v.length === 0) return null;
  if (!shape.test(v)) throw invalid(field, why);
  return v;
}

/** A calendar date, YYYY-MM-DD, that really exists (no 2026-02-31). */
function requireDate(field: string, value: unknown): Date {
  if (typeof value !== 'string' || !DATE.test(value)) throw invalid(field, 'must be YYYY-MM-DD');
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || isoDate(d) !== value) throw invalid(field, 'is not a calendar date');
  return d;
}
