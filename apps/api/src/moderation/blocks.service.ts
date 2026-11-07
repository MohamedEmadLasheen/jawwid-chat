import { Inject, Injectable } from '@nestjs/common';
import type { ActorBlock, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import { AUDIT_SERVICE, IDENTITY_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { actorRefKey, type IdentityService } from '../platform/identity.service';
import type { Actor } from '../platform/types';
import { SYSTEM_ACTOR } from '../platform/types';
import { currentImpersonationId } from '../platform/request-context';
import { forgetBlocks } from '../platform/blocks';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import { StaffRole } from '../communication/contracts/vocab';
import { signActorAvatar } from '../communication/profile/avatar-urls';
import { SUBJECT_KINDS, UNRESOLVED, type SubjectKind } from './dto';
import { personOf, type Person } from './people';
import { reportDepartments, type Party } from './departments';
import { DUE_MS } from './reports.service';

/** Compiled default for chat.config `block.limit.per_blocker_day` (20261104100000 seeds the same). */
export const BLOCK_LIMIT_DEFAULT = 20;
const LIMIT_KEY = 'block.limit.per_blocker_day';
const MINE_LIMIT = 500;

type Db = PrismaService | Prisma.TransactionClient;
type BlockerKind = 'contact' | 'teacher';

/** Why a block is refused (403 COMM.BLOCK_NOT_ALLOWED, `detail.reason`). */
export type BlockRefusal = 'staff_caller' | 'self' | 'official_account' | 'manager' | 'super_admin';

export interface BlockDto {
  id: string;
  subject: { kind: SubjectKind; id: string; name: string; avatar?: string };
  createdAt: string;
}

/**
 * PD-57 WP-2 (closure plan 2026-11-06 §5 and §6, roadmap §6.1-§6.3): blocking.
 *
 *   who       a parent (contact) or a teacher, signed in themself -- never staff
 *             (§6.1 rule 5), never a support session (§6)
 *   whom      a contact, teacher or staff member they are a live member of a
 *             conversation with; never themself, the official account, a
 *             department manager (role `manager`, or chat.department.manager_id)
 *             or the Super Admin (§6.1 rule 6). The protected targets are
 *             checked BEFORE the shared conversation, so they are always 403,
 *             as the contract says.
 *   once      one block per pair (the database's unique key): blocking again
 *             answers the existing block (200)
 *   limit     `block.limit.per_blocker_day` blocks per rolling 24 hours, counted
 *             from the audit trail's `block.created` rows (one per block made,
 *             so block/unblock cycles count), in the database's clock, under a
 *             per-blocker advisory lock. Not the case reports: a re-block
 *             re-uses its open case and would not be counted.
 *   the case  the blocker's open person report about the blocked person (any
 *             reason) is the case, else a new `blocked` one (§6.1 rule 4), its
 *             departments from both sides (closure plan §3); a new case is
 *             announced with ENG-02's `report.created`, a re-used one is not
 *   managers  §6.3, one notice per (case, manager), ON CONFLICT DO NOTHING:
 *             re-blocking while the case is open tells nobody again; only the
 *             notices actually written are sent `block_created_manager`
 *
 * Everything in one transaction. The audit rows name ids only, never content.
 */
@Injectable()
export class BlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  async block(actorId: string, body: Record<string, unknown>): Promise<{ status: 200 | 201; body: BlockDto }> {
    const { actor, accountId } = await this.requireBlocker(actorId);
    const blocker: Party & { kind: BlockerKind } = { kind: actor.kind as BlockerKind, id: actor.actorId };
    const target = await this.target(actor, body);
    const organizationId = actor.organizationId as string;

    const out = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`block:${blocker.kind}:${blocker.id}`}, 0))`;
      const existing = await tx.actorBlock.findUnique({
        where: { blockerKind_blockerId_blockedKind_blockedId: { blockerKind: blocker.kind, blockerId: blocker.id, blockedKind: target.person.kind, blockedId: target.person.id } },
      });
      if (existing) return { status: 200 as const, row: existing };

      await this.withinLimit(tx, blocker.id);
      const caseId = await this.caseFor(tx, organizationId, actor, accountId, target);
      const row = await tx.actorBlock.create({
        data: {
          organizationId,
          blockerKind: blocker.kind,
          blockerId: blocker.id,
          blockerAccountId: accountId,
          blockedKind: target.person.kind,
          blockedId: target.person.id,
          caseReportId: caseId,
        },
      });
      const managers = await this.responsibleManagers(tx, blocker, target.person);
      const told = managers.length === 0 ? [] : (await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO chat.actor_block_manager_notice (organization_id, block_id, case_report_id, manager_staff_id)
        SELECT ${organizationId}::uuid, ${row.id}::uuid, ${caseId}::uuid, m FROM unnest(${managers}::uuid[]) AS m
        ON CONFLICT (case_report_id, manager_staff_id) DO NOTHING
        RETURNING manager_staff_id::text AS id`).map((r) => r.id).sort();
      await this.audit.audit(tx, {
        actorId: blocker.id,
        action: 'block.created',
        entity: 'actor_block',
        entityId: row.id,
        after: {
          blockerKind: blocker.kind,
          blockerId: blocker.id,
          blockedKind: target.person.kind,
          blockedId: target.person.id,
          caseReportId: caseId,
          managersTold: told,
        },
        reason: 'blocked by the person themself',
      });
      if (told.length > 0) {
        await this.outbox.enqueue(tx, CommEvent.BLOCK_CREATED, {
          organizationId,
          blockId: row.id,
          reportId: caseId,
          blockerKind: blocker.kind,
          blockerId: blocker.id,
          blockedKind: target.person.kind,
          blockedId: target.person.id,
          managerStaffIds: told,
        });
      }
      return { status: 201 as const, row };
    });
    forgetBlocks(blocker.id);
    return { status: out.status, body: toDto(out.row, target.person.name) };
  }

  async unblock(actorId: string, blockId: string): Promise<void> {
    if (currentImpersonationId()) throw supportSession();
    const actor = await this.conversations.requireActor(actorId);
    const absent = () => new CommError(CommErrorCode.BLOCK_NOT_FOUND, 'no such block', 404);
    if (!isUuid(blockId)) throw absent();
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.actorBlock.findUnique({ where: { id: blockId.toLowerCase() } });
      if (!row || row.blockerId !== actor.actorId || row.blockerKind !== actor.kind) throw absent();
      await tx.actorBlock.delete({ where: { id: row.id } });
      await this.audit.audit(tx, {
        actorId: row.blockerId,
        action: 'block.removed',
        entity: 'actor_block',
        entityId: row.id,
        before: { blockerKind: row.blockerKind, blockerId: row.blockerId, blockedKind: row.blockedKind, blockedId: row.blockedId, caseReportId: row.caseReportId },
        reason: 'unblocked by the person themself',
      });
    });
    forgetBlocks(actor.actorId);
  }

  /** GET /me/blocks: newest first. Staff have none. */
  async mine(actorId: string): Promise<BlockDto[]> {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== 'contact' && actor.kind !== 'teacher') return [];
    const rows = await this.prisma.actorBlock.findMany({
      where: { blockerKind: actor.kind, blockerId: actor.actorId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: MINE_LIMIT,
    });
    if (rows.length === 0) return [];
    const people = await this.identity.resolveActors(rows.map((r) => ({ actorId: r.blockedId, actorKind: r.blockedKind })));
    const cases = new Map(
      (await this.prisma.contentReport.findMany({
        where: { id: { in: rows.map((r) => r.caseReportId).filter((x): x is string => !!x) } },
        select: { id: true, conversationId: true },
      })).map((c) => [c.id, c.conversationId]),
    );
    return rows.map((r) => {
      const person = people.get(actorRefKey({ actorId: r.blockedId, actorKind: r.blockedKind }));
      const context = r.caseReportId ? cases.get(r.caseReportId) : null;
      // The photo, signed for this viewer in the conversation the block's case names (re-authorized per request).
      const avatar = person && context ? signActorAvatar(person, context, actor.actorId) : null;
      const dto = toDto(r, person?.displayName ?? '');
      if (avatar) dto.subject.avatar = avatar;
      return dto;
    });
  }

  /**
   * Roadmap §6.3 (A-2a, owner 2026-11-04), as the ENG-03 brief makes it exact:
   *
   *   family   every supervisor of the family's children (chat.learner_supervision,
   *            all the family's learners) -> each supervisor's department's
   *            manager (department_member -> department.manager_id), across
   *            departments, deduplicated
   *   teacher  the teacher's PD-35 supervisor(s) (chat.teacher_supervisor_assignment)
   *            -> their department's manager
   *
   * Live, active staff only. A blocked person who is one of them is left out and
   * every Super Admin is told in their place; nobody at all -> every Super Admin.
   * Sorted. Exported for the fallback test: the API refuses a manager as a
   * target, so the rule is otherwise only reached if that ever changes.
   */
  async responsibleManagers(db: Db, blocker: Party, blocked: Party): Promise<string[]> {
    const contact = blocker.kind === 'contact'
      ? await db.contact.findUnique({ where: { id: blocker.id }, select: { familyId: true, organizationId: true } })
      : null;
    const teacher = blocker.kind === 'teacher'
      ? await db.teacher.findUnique({ where: { id: blocker.id }, select: { organizationId: true } })
      : null;
    const organizationId = contact?.organizationId ?? teacher?.organizationId;
    if (!organizationId) return [];
    const supervisors = contact
      ? await db.$queryRaw<Array<{ id: string }>>`
          SELECT DISTINCT ls.supervisor_id::text AS id
            FROM chat.learner l JOIN chat.learner_supervision ls ON ls.learner_id = l.id
           WHERE l.family_id = ${contact.familyId}::uuid AND l.organization_id = ${organizationId}::uuid`
      : await db.$queryRaw<Array<{ id: string }>>`
          SELECT DISTINCT supervisor_id::text AS id FROM chat.teacher_supervisor_assignment
           WHERE teacher_id = ${blocker.id}::uuid AND organization_id = ${organizationId}::uuid`;
    const ids = supervisors.map((s) => s.id);
    const managers = ids.length === 0 ? [] : (await db.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT d.manager_id::text AS id
        FROM chat.department_member dm
        JOIN chat.department d ON d.id = dm.department_id AND d.organization_id = ${organizationId}::uuid
        JOIN chat.staff s ON s.id = d.manager_id AND s.is_active AND s.left_at IS NULL
       WHERE dm.staff_id = ANY(${ids}::uuid[])`).map((r) => r.id);
    const blockedIsOne = blocked.kind === 'staff' && managers.includes(blocked.id);
    const kept = managers.filter((id) => !(blocked.kind === 'staff' && id === blocked.id));
    if (blockedIsOne || kept.length === 0) {
      const supers = await db.staff.findMany({
        where: { organizationId, role: StaffRole.SUPER_ADMIN, isActive: true, leftAt: null },
        select: { id: true },
      });
      for (const s of supers) if (!kept.includes(s.id) && !(blocked.kind === 'staff' && s.id === blocked.id)) kept.push(s.id);
    }
    return [...new Set(kept)].sort();
  }

  // ------------------------------------------------------------------

  /** A live parent or teacher in their own session, with their account. */
  private async requireBlocker(actorId: string): Promise<{ actor: Actor; accountId: string }> {
    if (currentImpersonationId()) throw supportSession();
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind === 'staff') throw notAllowed('staff_caller', 'staff never block; report instead');
    if (!actor.isActive || !actor.organizationId || (actor.kind !== 'contact' && actor.kind !== 'teacher')) {
      throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'this account cannot block');
    }
    const self = await personOf(this.prisma, actor.kind, actor.actorId);
    if (!self?.accountId || !self.isActive) throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'this account cannot block');
    return { actor, accountId: self.accountId };
  }

  private async target(actor: Actor, body: Record<string, unknown>): Promise<{ person: Person; conversationId: string }> {
    const subject = body.subject as { kind?: unknown; id?: unknown } | undefined;
    if (!subject || typeof subject !== 'object' || typeof subject.kind !== 'string' || typeof subject.id !== 'string') {
      throw new CommError(CommErrorCode.VALIDATION, 'subject: {kind, id} is required', 400);
    }
    if (subject.kind === SYSTEM_ACTOR.kind || subject.id === SYSTEM_ACTOR.actorId) {
      throw notAllowed('official_account', 'the academy\'s official account cannot be blocked');
    }
    if (!(SUBJECT_KINDS as readonly string[]).includes(subject.kind)) {
      throw new CommError(CommErrorCode.VALIDATION, `subject.kind: must be one of ${SUBJECT_KINDS.join(', ')}`, 400);
    }
    const kind = subject.kind as SubjectKind;
    if (!isUuid(subject.id)) throw noShared();
    const id = subject.id.toLowerCase();
    if (kind === actor.kind && id === actor.actorId) throw notAllowed('self', 'you cannot block yourself');
    const person = await personOf(this.prisma, kind, id);
    if (!person || person.organizationId !== actor.organizationId) throw noShared();
    if (person.kind === 'staff') {
      if (person.role === StaffRole.SUPER_ADMIN) throw notAllowed('super_admin', 'the Super Admin cannot be blocked');
      const manages = await this.prisma.department.count({ where: { managerId: person.id } });
      if (person.role === StaffRole.MANAGER || manages > 0) throw notAllowed('manager', 'a department manager cannot be blocked');
    }
    const [shared] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id::text AS id
        FROM chat.conversation_member mine
        JOIN chat.conversation_member theirs
          ON theirs.conversation_id = mine.conversation_id AND theirs.left_at IS NULL
         AND theirs.actor_kind = ${person.kind} AND theirs.actor_id = ${person.id}::uuid
        JOIN chat.conversation c ON c.id = mine.conversation_id AND c.organization_id = ${person.organizationId}::uuid
       WHERE mine.actor_id = ${actor.actorId}::uuid AND mine.left_at IS NULL AND mine.actor_kind = ${actor.kind}
       ORDER BY c.created_at DESC
       LIMIT 1`;
    if (!shared) throw noShared();
    return { person, conversationId: shared.id };
  }

  /** The blocker's open person report about this person (any reason), else a new `blocked` case. */
  private async caseFor(
    tx: Prisma.TransactionClient,
    organizationId: string,
    actor: Actor,
    accountId: string,
    target: { person: Person; conversationId: string },
  ): Promise<string> {
    const open = await tx.contentReport.findFirst({
      where: {
        reporterKind: actor.kind,
        reporterId: actor.actorId,
        targetKind: 'person',
        subjectKind: target.person.kind,
        subjectId: target.person.id,
        messageId: null,
        status: { in: [...UNRESOLVED] },
      },
      select: { id: true },
    });
    if (open) return open.id;
    const departmentIds = await reportDepartments(tx, { kind: target.person.kind, id: target.person.id }, { alsoFor: { kind: actor.kind as SubjectKind, id: actor.actorId } });
    const created = await tx.contentReport.create({
      data: {
        organizationId,
        reporterKind: actor.kind,
        reporterId: actor.actorId,
        reporterAccountId: accountId,
        targetKind: 'person',
        messageId: null,
        conversationId: target.conversationId,
        subjectKind: target.person.kind,
        subjectId: target.person.id,
        reason: 'blocked',
        note: null,
        evidence: { author: { kind: target.person.kind, id: target.person.id, name: target.person.name } },
        departmentIds,
        // The database sets the clock and the priority; this only satisfies the type.
        dueAt: new Date(Date.now() + DUE_MS),
      },
      select: { id: true, priority: true },
    });
    // A NEW case is announced exactly as ENG-02 announces a report (ReportCreatedPayload),
    // so the queue's flow is one. A re-used open report announces nothing more.
    // (ENG-04 sends no immediate staff alert for reason `blocked`: block_created_manager is it.)
    await this.outbox.enqueue(tx, CommEvent.REPORT_CREATED, {
      organizationId,
      reportId: created.id,
      priority: created.priority as 'urgent' | 'normal',
      change: 'created',
    });
    return created.id;
  }

  private async withinLimit(tx: Prisma.TransactionClient, blockerId: string): Promise<void> {
    const row = await tx.config.findUnique({ where: { key: LIMIT_KEY } });
    const n = row?.value;
    const limit = typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : BLOCK_LIMIT_DEFAULT;
    const [count] = await tx.$queryRaw<Array<{ n: number; wait: number | null }>>`
      SELECT count(*)::int AS n,
             ceil(extract(epoch FROM (min(at) + interval '24 hours' - now())))::int AS wait
        FROM chat.audit_log
       WHERE action = 'block.created' AND actor_id = ${blockerId}::uuid
         AND at > now() - interval '24 hours'`;
    if ((count?.n ?? 0) >= limit) {
      throw new AuthError(AuthErrorCode.RATE_LIMITED, Math.min(86_400, Math.max(1, count?.wait ?? 86_400)));
    }
  }
}

function toDto(row: ActorBlock, name: string): BlockDto {
  return {
    id: row.id,
    subject: { kind: row.blockedKind as SubjectKind, id: row.blockedId, name },
    createdAt: row.createdAt.toISOString(),
  };
}

function notAllowed(reason: BlockRefusal, message: string): CommError {
  return new CommError(CommErrorCode.BLOCK_NOT_ALLOWED, message, 403, { reason });
}

function noShared(): CommError {
  return new CommError(CommErrorCode.BLOCK_NO_SHARED_CONVERSATION, 'nobody to block here', 404);
}

function supportSession(): CommError {
  return new CommError(CommErrorCode.SUPPORT_SESSION_FORBIDDEN, 'a block is made by the person themself, never in a support session');
}
