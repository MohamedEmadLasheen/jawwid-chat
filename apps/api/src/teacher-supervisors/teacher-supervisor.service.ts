import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, REALTIME_REVOCATION } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { NO_REALTIME_REVOCATION, type RealtimeRevocation } from '../platform/realtime-revocation';
import { TeacherScopeService } from '../platform/teacher-scope';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { SeatPolicyRegistry } from '../communication/seats/seat-policy';
import { ActorKind, ConversationType, StaffRole } from '../communication/contracts/vocab';
import { SupervisionConversationService } from '../supervision/supervision-conversation.service';
import { TrialGroupService } from '../lessons/trial-group.service';

/** The reason a teacher supervisor sits in a group of their own teacher (chat.seat_reason). */
export const SUPERVISION_SEAT = 'supervision';

/** chat.config: the switch the last complete re-seat followed. */
const RESEATED_KEY = 'teacher_supervisor.reseated_strict';

const REASON_MAX = 500;
const CANDIDATE_LIMIT = 200;

const denied = (reason: string) => new CommError(CommErrorCode.TEACHER_FILE_DENIED, reason);
const invalid = (reason: string) => new CommError(CommErrorCode.VALIDATION, reason, 400);

/**
 * PD-35: teacher supervisors.
 *
 *   assignment   each teacher's ONE supervisor, a primary supervisor of the
 *                Teachers department, set by the Teachers Manager or the super
 *                admin (chat.teacher_supervisor_assignment). With the strict
 *                switch on it decides who works on the teacher; with it off it
 *                is recorded and shown, and the department works as before.
 *   'supervision' seat
 *                a teacher supervisor (or the Teachers Manager) joins, visibly,
 *                a Student Group or family group of a child their teacher
 *                teaches, or that teacher's supervision / trial group -- through
 *                the PD-35 seat primitive (ConversationSeatService). Anything
 *                else is refused: "ask the Teachers Manager".
 */
@Injectable()
export class TeacherSupervisorService implements OnModuleInit {
  private readonly log = new Logger(TeacherSupervisorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly seats: SeatPolicyRegistry,
    private readonly scope: TeacherScopeService,
    private readonly supervisionChats: SupervisionConversationService,
    private readonly trialGroups: TrialGroupService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Optional()
    @Inject(REALTIME_REVOCATION)
    private readonly revocation: RealtimeRevocation = NO_REALTIME_REVOCATION,
  ) {}

  onModuleInit(): void {
    if (this.seats.get(SUPERVISION_SEAT)) return;
    this.seats.register({
      reason: SUPERVISION_SEAT,
      canJoin: async (actor, conv, ctx) => {
        const [row] = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
          SELECT chat.seat_eligible_supervision(${actor.actorId}::uuid, ${conv.id}::uuid, ${ctx.now}::timestamptz) AS ok`;
        if (row?.ok) return { allowed: true, onBehalfMode: null, moderation: 'published' };
        // A conversation the caller cannot otherwise see is not theirs to learn about.
        if (ctx.standing === null && !(await this.inTeachersDepartment(actor))) {
          return { allowed: false, code: CommErrorCode.CONVERSATION_NOT_FOUND, reason: 'conversation not found' };
        }
        return {
          allowed: false,
          code: CommErrorCode.SEAT_NOT_ELIGIBLE,
          reason: 'only the groups of your own teachers; ask the Teachers Manager',
        };
      },
      roleLabel: (actor) =>
        actor.staffRole === StaffRole.SUPER_ADMIN ? 'super_admin' : actor.staffRole === StaffRole.MANAGER ? 'manager' : 'teacher_supervisor',
    });
  }

  // ------------------------------------------------------------------
  // Assignment
  // ------------------------------------------------------------------

  /** Every teacher with their supervisor, the supervisors to choose from, and how many are unassigned. */
  async assignments(actorId: string) {
    const actor = await this.requireAssigner(actorId);
    const org = actor.organizationId as string;
    const [teachers, supervisors, strict] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string; name: string; active: boolean; supervisor_id: string | null; supervisor_name: string | null; supervisor_live: boolean | null; assigned_at: Date | null }>>`
        SELECT t.id::text AS id, t.name, (t.is_active AND t.left_at IS NULL) AS active,
               a.supervisor_id::text AS supervisor_id, s.name AS supervisor_name, a.assigned_at,
               -- A supervisor who left, or left the department, supervises no one.
               (s.is_active AND s.left_at IS NULL AND EXISTS (
                  SELECT 1 FROM chat.department_member m JOIN chat.department d ON d.id = m.department_id
                   WHERE m.staff_id = s.id AND m.position = 'supervisor' AND d.kind = 'teachers')) AS supervisor_live
          FROM chat.teacher t
          LEFT JOIN chat.teacher_supervisor_assignment a ON a.teacher_id = t.id
          LEFT JOIN chat.staff s ON s.id = a.supervisor_id
         WHERE t.organization_id = ${org}::uuid
         ORDER BY (t.is_active AND t.left_at IS NULL) DESC, t.name`,
      this.eligibleSupervisors(org),
      this.scope.strict(),
    ]);
    return {
      strictScope: strict,
      unassigned: teachers.filter((t) => t.active && !(t.supervisor_id && t.supervisor_live)).length,
      teachers: teachers.map((t) => ({
        id: t.id,
        name: t.name,
        isActive: t.active,
        supervisor: t.supervisor_id ? { id: t.supervisor_id, name: t.supervisor_name ?? '', isActive: t.supervisor_live === true } : null,
        assignedAt: t.assigned_at?.toISOString() ?? null,
      })),
      supervisors,
    };
  }

  /** { supervisorId: uuid | null, reason? } -- null takes the teacher's supervisor away. */
  async assign(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const actor = await this.requireAssigner(actorId);
    const org = actor.organizationId as string;
    if (!isUuid(teacherId)) throw new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'teacher not found');
    const teacher = await this.prisma.teacher.findFirst({ where: { id: teacherId, organizationId: org }, select: { id: true } });
    if (!teacher) throw new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'teacher not found');
    const supervisorId = body.supervisorId === null ? null : body.supervisorId;
    if (supervisorId !== null && (typeof supervisorId !== 'string' || !isUuid(supervisorId))) {
      throw invalid('supervisorId: a uuid, or null to take the supervisor away');
    }
    const reason = parseReason(body.reason);
    if (supervisorId !== null && !(await this.eligibleSupervisors(org)).some((s) => s.id === supervisorId)) {
      throw invalid('supervisorId: a primary supervisor of the Teachers department');
    }

    const strict = await this.scope.strict();
    const changed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'teacher_supervisor:' + teacher.id}))`;
      const [before] = await tx.$queryRaw<Array<{ supervisor_id: string }>>`
        SELECT supervisor_id::text AS supervisor_id FROM chat.teacher_supervisor_assignment WHERE teacher_id = ${teacher.id}::uuid`;
      const previous = before?.supervisor_id ?? null;
      if (previous === supervisorId) return null;
      if (supervisorId === null) {
        await tx.$executeRaw`DELETE FROM chat.teacher_supervisor_assignment WHERE teacher_id = ${teacher.id}::uuid`;
      } else {
        await tx.$executeRaw`
          INSERT INTO chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id, assigned_by, reason)
          VALUES (${teacher.id}::uuid, ${org}::uuid, ${supervisorId}::uuid, ${actor.actorId}::uuid, ${reason})
          ON CONFLICT (teacher_id) DO UPDATE
             SET supervisor_id = EXCLUDED.supervisor_id, assigned_by = EXCLUDED.assigned_by, reason = EXCLUDED.reason`;
      }
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: supervisorId === null ? 'teacher_supervisor.unassigned' : 'teacher_supervisor.assigned',
        entity: 'teacher',
        entityId: teacher.id,
        before: { supervisorId: previous },
        after: { supervisorId },
        reason: reason ?? (supervisorId === null ? 'teacher supervisor removed' : 'teacher supervisor assigned'),
      });
      // With the switch on, the teacher's supervision conversation and trial group
      // seat the new supervisor and let the old one go. Never created here.
      const reseated: string[] = [];
      if (strict) {
        for (const type of [ConversationType.TEACHER_SUPERVISION, ConversationType.TRIAL_GROUP]) {
          const conv = await tx.conversation.findFirst({
            where: {
              organizationId: org,
              archivedAt: null,
              type,
              ...(type === ConversationType.TEACHER_SUPERVISION ? { supervisedTeacherId: teacher.id } : { trialTeacherId: teacher.id }),
            },
            select: { id: true },
          });
          if (!conv) continue;
          if (type === ConversationType.TEACHER_SUPERVISION) await this.supervisionChats.ensureInTx(tx, teacher.id, org, actor.actorId);
          else await this.trialGroups.ensureInTx(tx, teacher.id, org, actor.actorId);
          reseated.push(conv.id);
        }
      }
      return { previous, reseated };
    });

    // RT-009: the previous supervisor's live rooms, once the change has committed.
    // Seats that no longer hold end at the next seat sweep; access already has.
    if (changed && strict && changed.previous && changed.reseated.length > 0) {
      for (const id of changed.reseated) this.revocation.leaveConversation([changed.previous], id);
      await this.revocation.confirmRevoked();
    }
    return { teacherId: teacher.id, supervisorId };
  }

  /**
   * Every live supervision conversation and trial group re-seated by the
   * switch, in either direction and whatever the teacher's state: on, each
   * keeps its teacher's own supervisor and the Teachers Manager; off, the whole
   * department again. One conversation's failure does not stop the rest; it is
   * counted, and reseatIfChanged runs again until none fails.
   */
  async reseatAll(): Promise<{ reseated: number; failed: number }> {
    const rows = await this.prisma.conversation.findMany({
      where: { archivedAt: null, type: { in: [ConversationType.TEACHER_SUPERVISION, ConversationType.TRIAL_GROUP] } },
      select: { id: true, type: true },
    });
    let reseated = 0;
    let failed = 0;
    for (const c of rows) {
      try {
        const { removed } = await this.prisma.$transaction((tx) =>
          c.type === ConversationType.TEACHER_SUPERVISION
            ? this.supervisionChats.resyncStaffInTx(tx, c.id)
            : this.trialGroups.resyncStaffInTx(tx, c.id),
        );
        // RT-009: the staff who lost their place leave the live room.
        if (removed.length > 0) {
          this.revocation.leaveConversation(removed, c.id);
          await this.revocation.confirmRevoked();
        }
        reseated += 1;
      } catch (e) {
        failed += 1;
        this.log.error(`teacher supervisor reseat failed for conversation ${c.id}: ${(e as Error).message}`);
      }
    }
    return { reseated, failed };
  }

  /**
   * reseatAll, when the switch differs from the one the last complete re-seat
   * followed (chat.config 'teacher_supervisor.reseated_strict'; absent reads as
   * off, the state before PD-35). The worker calls it at start and on every
   * seat sweep, so a change of the switch, or a re-seat that failed part-way,
   * is acted on without a restart.
   */
  async reseatIfChanged(): Promise<{ reseated: number; failed: number } | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ strict: boolean; reseated: boolean }>>`
      SELECT chat.teacher_scope_strict() AS strict,
             coalesce((SELECT value = 'true'::jsonb FROM chat.config WHERE key = ${RESEATED_KEY}), false) AS reseated`;
    if (!row || row.strict === row.reseated) return null;
    this.log.warn(`teacher supervisor scope is ${row.strict ? 'strict' : 'department-wide'}; re-seating supervision conversations and trial groups`);
    const result = await this.reseatAll();
    if (result.failed === 0) {
      await this.prisma.$executeRaw`
        INSERT INTO chat.config (key, value, scope, description)
        VALUES (${RESEATED_KEY}, ${JSON.stringify(row.strict)}::jsonb, 'teachers',
                'PD-35: the strict switch the last complete re-seat followed (written by the worker).')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    } else {
      this.log.error(`teacher supervisor reseat: ${result.failed} conversation(s) failed; retried at the next seat sweep`);
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Joining a group
  // ------------------------------------------------------------------

  /**
   * The groups the caller may join to support their teachers -- titles and who
   * they are about, never a message. `teacherId` narrows to one teacher; `q`
   * matches the group's title, a child's name or the teacher's name.
   */
  async joinCandidates(actorId: string, query: { teacherId?: string; q?: string }) {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) throw denied('staff only');
    if (query.teacherId !== undefined && !isUuid(query.teacherId)) throw invalid('teacherId: a uuid');
    const q = typeof query.q === 'string' && query.q.trim() ? `%${query.q.trim().replace(/[%_\\]/g, '\\$&')}%` : null;
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; type: string; title: string | null; teacher_id: string; teacher_name: string; learners: string[] | null; last_activity_at: Date | null; member: boolean; seated: boolean }>
    >`
      WITH mine AS (
        SELECT t AS teacher_id FROM chat.staff_supervised_teacher_ids(${actor.actorId}::uuid, now()) t
         WHERE ${query.teacherId ?? null}::uuid IS NULL OR t = ${query.teacherId ?? null}::uuid
      ), groups AS (
        SELECT c.id, c.type, c.title, l.teacher_id, c.last_activity_at
          FROM chat.conversation c JOIN chat.learner l ON l.id = c.learner_id
         WHERE c.type = 'student_group' AND c.archived_at IS NULL AND l.teacher_id IN (SELECT teacher_id FROM mine)
        UNION
        SELECT c.id, c.type, c.title, l.teacher_id, c.last_activity_at
          FROM chat.conversation c
          JOIN chat.conversation_learner cl ON cl.conversation_id = c.id
          JOIN chat.learner l ON l.id = cl.learner_id
         WHERE c.type = 'family_group' AND c.archived_at IS NULL AND l.teacher_id IN (SELECT teacher_id FROM mine)
        UNION
        SELECT c.id, c.type, c.title, coalesce(c.supervised_teacher_id, c.trial_teacher_id), c.last_activity_at
          FROM chat.conversation c
         WHERE c.type IN ('teacher_supervision', 'trial_group') AND c.archived_at IS NULL
           AND coalesce(c.supervised_teacher_id, c.trial_teacher_id) IN (SELECT teacher_id FROM mine)
      )
      SELECT g.id::text AS id, g.type, g.title, g.teacher_id::text AS teacher_id, t.name AS teacher_name,
             (SELECT array_agg(DISTINCT x.name ORDER BY x.name) FROM chat.learner x
               WHERE x.id = (SELECT c.learner_id FROM chat.conversation c WHERE c.id = g.id)
                  OR x.id IN (SELECT cl.learner_id FROM chat.conversation_learner cl WHERE cl.conversation_id = g.id)) AS learners,
             g.last_activity_at,
             EXISTS (SELECT 1 FROM chat.conversation_member m
                      WHERE m.conversation_id = g.id AND m.actor_id = ${actor.actorId}::uuid AND m.left_at IS NULL) AS member,
             EXISTS (SELECT 1 FROM chat.conversation_seat st
                      WHERE st.conversation_id = g.id AND st.staff_id = ${actor.actorId}::uuid AND st.left_at IS NULL) AS seated
        FROM groups g JOIN chat.teacher t ON t.id = g.teacher_id
       WHERE ${q}::text IS NULL OR g.title ILIKE ${q} OR t.name ILIKE ${q}
          OR EXISTS (SELECT 1 FROM chat.learner x
                      WHERE (x.id = (SELECT c.learner_id FROM chat.conversation c WHERE c.id = g.id)
                             OR x.id IN (SELECT cl.learner_id FROM chat.conversation_learner cl WHERE cl.conversation_id = g.id))
                        AND x.name ILIKE ${q})
       ORDER BY g.last_activity_at DESC NULLS LAST
       LIMIT ${CANDIDATE_LIMIT}`;
    return {
      groups: rows.map((r) => ({
        conversationId: r.id,
        type: r.type,
        title: r.title,
        teacher: { id: r.teacher_id, name: r.teacher_name },
        learners: r.learners ?? [],
        lastActivityAt: r.last_activity_at?.toISOString() ?? null,
        // A member in their own right has nothing to join; a seat holder may leave.
        membership: r.seated ? 'seated' : r.member ? 'member' : 'none',
      })),
    };
  }

  // ------------------------------------------------------------------

  private async requireAssigner(actorId: string): Promise<Actor> {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) throw denied('staff only');
    if (actor.staffRole === StaffRole.SUPER_ADMIN) return actor;
    const [{ manager }] = await this.prisma.$queryRaw<Array<{ manager: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM chat.department d
                      WHERE d.kind = 'teachers' AND d.organization_id = ${actor.organizationId}::uuid
                        AND d.manager_id = ${actor.actorId}::uuid) AS manager`;
    if (!manager || actor.staffRole !== StaffRole.MANAGER) {
      throw denied('teachers are assigned to supervisors by the Teachers Manager');
    }
    return actor;
  }

  private async inTeachersDepartment(actor: Actor): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<Array<{ role: string | null }>>`
      SELECT chat.teachers_department_role(${actor.actorId}::uuid) AS role`;
    return !!row?.role;
  }

  /** The live primary supervisors of the organization's Teachers department. */
  private eligibleSupervisors(organizationId: string) {
    return this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT s.id::text AS id, s.name
        FROM chat.department_member m
        JOIN chat.department d ON d.id = m.department_id
        JOIN chat.staff s ON s.id = m.staff_id
       WHERE d.kind = 'teachers' AND d.organization_id = ${organizationId}::uuid
         AND m.position = 'supervisor' AND s.is_active AND s.left_at IS NULL
       ORDER BY s.name`;
  }
}

function parseReason(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw invalid('reason: text');
  const t = v.trim();
  if (!t) return null;
  if (t.length > REASON_MAX) throw invalid(`reason: at most ${REASON_MAX} characters`);
  return t;
}

