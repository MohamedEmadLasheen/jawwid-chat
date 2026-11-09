import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { IDENTITY_SERVICE } from '../platform/tokens';
import type { IdentityService } from '../platform/identity.service';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import { CommError, CommErrorCode } from '../platform/errors';
import { ActorKind } from '../communication/contracts/vocab';
import { NotificationPipeline } from '../communication/notifications/notification-pipeline.service';
import { AccountDeletionService, view, type DeletionRequestView } from './account-deletion.service';

/** The reminders (owner O-3 brief): day 21 and day 28 of the 30. */
export const REMINDER_DAYS = [21, 28] as const;
type ReminderDay = (typeof REMINDER_DAYS)[number];
const DAY_MS = 86_400_000;
const SWEEP_BATCH = 50;

/** What the holder's Delete account screen is told before they choose. */
export interface DeletionStatus {
  kind: 'family' | 'teacher';
  /** True: nothing is open, deleting is immediate. False: a request, deleted by the deadline. */
  immediate: boolean;
  openItems: string[];
  /** The pending request, else the latest one (cancelled or completed), else null. */
  request: DeletionRequestView | null;
  /** If a request were made now, its deadline (the database's clock, +30 days). */
  deadlineIfRequested: string;
}

/** The Teacher File's banner. */
export interface StaffDeletionRequestView {
  request: DeletionRequestView | null;
  /** What is still open on the teacher now: what "Close and delete" would leave flagged. */
  leftOpen: { futureLessons: number; assignedLearners: number; openPayroll: boolean } | null;
  canComplete: boolean;
}

/**
 * PD-56 O-3 (owner, 2026-11-07): "the teacher requests deletion in the app;
 * staff close the lessons and payroll; the account is deleted within 30 days."
 *
 *   holder   GET /me/account/deletion: whether deleting is immediate, the
 *            request and the would-be deadline. POST /me/account/delete makes
 *            the request (AccountDeletionService). POST
 *            /me/account/deletion-request/cancel while pending.
 *   staff    the Teacher File's banner and "Close and delete account": who may
 *            is PD-43's offboarding rule (the super admin or the Teachers
 *            manager of the teacher's organization), checked by the caller.
 *   worker   sweep(now): day 21 and day 28 reminders to the task's assignee,
 *            the Teachers manager and the teacher's supervisor, once per
 *            request and day (chat.account_deletion_reminder) and once per
 *            recipient (the PD-34 dedupe key); then, past the deadline, the
 *            same erasure (chat.complete_account_deletion_request, via
 *            'deadline').
 *
 * `now` is injectable so tests run at fixed instants.
 */
@Injectable()
export class TeacherDeletionRequestService {
  private readonly log = new Logger(TeacherDeletionRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deletion: AccountDeletionService,
    private readonly pipeline: NotificationPipeline,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  // ------------------------------------------------------------------
  // The holder
  // ------------------------------------------------------------------

  async status(accountId: string): Promise<DeletionStatus> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { kind: true } });
    if (!account) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
    if (account.kind !== 'family' && account.kind !== 'teacher') throw new AuthError(AuthErrorCode.FORBIDDEN);
    const [row] = await this.prisma.$queryRaw<Array<{ items: string[]; deadline: Date }>>`
      SELECT CASE WHEN ${account.kind} = 'teacher' THEN chat.teacher_deletion_open_items(${accountId}::uuid) ELSE '{}'::text[] END AS items,
             now() + interval '720 hours' AS deadline`;
    const items = row?.items ?? [];
    return {
      kind: account.kind,
      immediate: items.length === 0,
      openItems: items,
      request: account.kind === 'teacher' ? await this.latestOf(accountId) : null,
      deadlineIfRequested: row!.deadline.toISOString(),
    };
  }

  async cancel(accountId: string): Promise<DeletionRequestView> {
    // A request is a teacher's own: anyone else is refused before anything is read.
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { kind: true } });
    if (account?.kind !== 'teacher') throw new AuthError(AuthErrorCode.FORBIDDEN);
    const [row] = await this.prisma.$queryRaw<Array<{ r: DeletionRequestView }>>`
      SELECT chat.cancel_account_deletion_request(${accountId}::uuid) AS r`.catch((e: unknown) => {
      if (/no pending deletion request/.test(String((e as Error)?.message ?? ''))) {
        throw new AuthError(AuthErrorCode.DELETION_REQUEST_NOT_PENDING);
      }
      throw e;
    });
    return view(row!.r);
  }

  // ------------------------------------------------------------------
  // Staff (the caller has checked who may, and that the teacher is in their organization)
  // ------------------------------------------------------------------

  async forTeacher(teacherId: string, canComplete: boolean): Promise<StaffDeletionRequestView> {
    const teacher = await this.prisma.teacher.findUnique({ where: { id: teacherId }, select: { accountId: true } });
    if (!teacher?.accountId) return { request: null, leftOpen: null, canComplete: false };
    const request = await this.latestOf(teacher.accountId);
    if (!request || request.state !== 'pending') return { request, leftOpen: null, canComplete: false };
    const [row] = await this.prisma.$queryRaw<Array<{ left: StaffDeletionRequestView['leftOpen'] }>>`
      SELECT chat.teacher_deletion_left_open(${teacher.accountId}::uuid) AS left`;
    return { request, leftOpen: row?.left ?? null, canComplete };
  }

  /** "Close and delete account": the pending request of this teacher, completed by `staff`. */
  async complete(teacherId: string, staff: { staffId: string; staffAccountId: string | null }) {
    const teacher = await this.prisma.teacher.findUnique({ where: { id: teacherId }, select: { accountId: true } });
    const request = teacher?.accountId ? await this.latestOf(teacher.accountId) : null;
    if (!request || request.state !== 'pending') {
      throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this teacher has no pending deletion request', 409);
    }
    const done = await this.deletion.completeRequest(request.id, staff);
    return { requestId: done.requestId, leftOpen: done.leftOpen, request: await this.byId(request.id) };
  }

  // ------------------------------------------------------------------
  // The worker
  // ------------------------------------------------------------------

  /**
   * Idempotent and safe on every replica at once. Always ends: a request that
   * fails here (a database error, completed by staff in between, or a worker
   * clock ahead of the database's -- the database refuses before its own
   * deadline) is not taken again in this sweep, and a batch that completes
   * nothing ends it. The next sweep tries them again.
   *
   * Erasures run before reminders, and each reminder row is isolated: a
   * failing reminder (the notification store down, a request cancelled
   * between the select and the insert) never holds a deletion past its
   * 30 days.
   */
  async sweep(now: Date = new Date()): Promise<{ reminded: number; erased: number; failed: number; payrollSettled: number; handoversSettled: number }> {
    let erased = 0;
    const failed: string[] = [];
    for (;;) {
      const due = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM chat.account_deletion_request
         WHERE state = 'pending' AND deadline_at <= ${now}::timestamptz
           AND NOT (id = ANY(${failed}::uuid[]))
         ORDER BY deadline_at, id LIMIT ${SWEEP_BATCH}`;
      let done = 0;
      for (const { id } of due) {
        try {
          await this.deletion.completeRequest(id, null);
          done += 1;
        } catch (e) {
          failed.push(id);
          if (!(e instanceof CommError)) this.log.warn(`deletion request ${id} not completed at its deadline: ${(e as Error).name}`);
        }
      }
      erased += done;
      if (due.length < SWEEP_BATCH || done === 0) break;
    }
    const reminded = await this.remind(now);
    // What erasures left for later: payout accounts once the payroll is settled, learners handed over.
    const [settled] = await this.prisma.$queryRaw<Array<{ r: { payrollSettled?: number; handoversSettled?: number } }>>`
      SELECT chat.erased_teacher_sweep(${SWEEP_BATCH}::int) AS r`;
    const payrollSettled = settled?.r.payrollSettled ?? 0;
    const handoversSettled = settled?.r.handoversSettled ?? 0;
    if (reminded || erased || failed.length || payrollSettled || handoversSettled) {
      this.log.log(`deletion requests: ${reminded} reminded, ${erased} erased at the deadline, ${failed.length} failed; ` +
        `${payrollSettled} payout accounts deleted, ${handoversSettled} handovers settled`);
    }
    return { reminded, erased, failed: failed.length, payrollSettled, handoversSettled };
  }

  private async remind(now: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; organization_id: string; teacher_id: string; requested_at: Date; deadline_at: Date }>>`
      SELECT r.id::text AS id, r.organization_id::text AS organization_id, r.teacher_id::text AS teacher_id, r.requested_at, r.deadline_at
        FROM chat.account_deletion_request r
       WHERE r.state = 'pending'
         AND r.requested_at + interval '504 hours' <= ${now}::timestamptz
         AND r.deadline_at > ${now}::timestamptz
         AND NOT EXISTS (SELECT 1 FROM chat.account_deletion_reminder m
                          WHERE m.request_id = r.id
                            AND m.day = CASE WHEN r.requested_at + interval '672 hours' <= ${now}::timestamptz THEN 28 ELSE 21 END)
       ORDER BY r.requested_at, r.id
       LIMIT ${SWEEP_BATCH * 4}`;
    let sent = 0;
    for (const r of rows) {
      try {
        if (await this.remindOne(r, now)) sent += 1;
      } catch (e) {
        // Not marked, so the next sweep sends it again; the dedupe key absorbs a partial send.
        this.log.warn(`deletion request ${r.id}: reminder not sent: ${(e as Error).name}`);
      }
    }
    return sent;
  }

  /** One request's reminder: sent to each recipient, then marked. True when this call marked it. */
  private async remindOne(
    r: { id: string; organization_id: string; teacher_id: string; requested_at: Date; deadline_at: Date },
    now: Date,
  ): Promise<boolean> {
    // Only the latest day that has come: a worker down over day 21 does not send it late beside day 28.
    const day: ReminderDay = now.getTime() >= r.requested_at.getTime() + 28 * DAY_MS ? 28 : 21;
    const recipients = await this.reminderRecipients(r.id, r.organization_id, r.teacher_id);
    const taskId = await this.taskOf(r.organization_id, r.id);
    // Sent first, then marked: a crash in between re-sends, and the dedupe key absorbs it.
    for (const recipientId of recipients) {
      const recipient = await this.identity.resolveActor(recipientId);
      if (!recipient || !recipient.isActive || recipient.kind !== ActorKind.STAFF || recipient.organizationId !== r.organization_id) continue;
      const rule = `teacher_deletion_day${day}`;
      await this.pipeline.emit({
        dedupeKey: `${rule}:${r.id}:${recipientId}`,
        ruleKey: rule,
        eventType: rule,
        templateKey: rule,
        recipientId,
        locale: recipient.locale,
        priority: day === 28 ? 'high' : 'normal',
        subject: taskId ? { type: 'task', id: taskId } : null,
        refs: { taskId: taskId ?? undefined },
        variables: { deadlineAt: r.deadline_at.toISOString() },
        scheduledAt: now,
      });
    }
    const marked = await this.prisma.$executeRaw`
      INSERT INTO chat.account_deletion_reminder (request_id, day)
      SELECT ${r.id}::uuid, d FROM unnest(${day === 28 ? [21, 28] : [21]}::smallint[]) AS d
      ON CONFLICT (request_id, day) DO NOTHING`;
    return marked > 0;
  }

  /** The task's assignee as it stands, the Teachers manager (else the super admin), the teacher's supervisor. Once each. */
  private async reminderRecipients(requestId: string, organizationId: string, teacherId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string | null }>>`
      SELECT coalesce(t.assignee_staff_id, t.assignee_teacher_id)::text AS id
        FROM chat.work_task t
       WHERE t.organization_id = ${organizationId}::uuid AND t.source_key = ${`teacher_deletion_request:${requestId}`}
         AND t.state IN ('open', 'awaiting_decision')
      UNION ALL SELECT chat.work_task_teachers_manager(${organizationId}::uuid)::text
      UNION ALL SELECT chat.work_task_teacher_supervisor(${teacherId}::uuid)::text`;
    return [...new Set(rows.map((x) => x.id).filter((x): x is string => !!x))].sort();
  }

  private async taskOf(organizationId: string, requestId: string): Promise<string | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.work_task
       WHERE organization_id = ${organizationId}::uuid AND source_key = ${`teacher_deletion_request:${requestId}`}`;
    return row?.id ?? null;
  }

  // ------------------------------------------------------------------

  private async latestOf(accountId: string): Promise<DeletionRequestView | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ r: DeletionRequestView }>>`
      SELECT chat.account_deletion_request_json(q) AS r FROM chat.account_deletion_request q
       WHERE q.account_id = ${accountId}::uuid
       ORDER BY (q.state = 'pending') DESC, q.requested_at DESC, q.id DESC LIMIT 1`;
    return row ? view(row.r) : null;
  }

  private async byId(id: string): Promise<DeletionRequestView | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ r: DeletionRequestView }>>`
      SELECT chat.account_deletion_request_json(q) AS r FROM chat.account_deletion_request q WHERE q.id = ${id}::uuid`;
    return row ? view(row.r) : null;
  }
}
