import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { IDENTITY_SERVICE } from '../platform/tokens';
import type { IdentityService } from '../platform/identity.service';
import { ActorKind } from '../communication/contracts/vocab';
import { CommEvent } from '../communication/contracts/events';
import { OutboxService } from '../communication/outbox/outbox.service';
import { OutboxWorker, type ReportDelivery } from '../communication/outbox/outbox.worker';
import { NotificationPipeline } from '../communication/notifications/notification-pipeline.service';

/** Owner D-1 (2026-11-06): managers are alerted 6 hours before the 24-hour deadline, i.e. at 18 h. */
export const DUE_SOON_BEFORE_MS = 6 * 3_600_000;
const SWEEP_BATCH = 100;
const TASK_SWEEP_BATCH = 50;

type Stage = 'due_soon' | 'overdue';
type Kind = 'report_received_staff' | 'report_child_safety' | 'report_due_soon' | 'report_overdue';

interface ReportRow {
  id: string;
  organization_id: string;
  reason: string;
  priority: string;
  status: string;
  due_at: Date;
  subject_kind: string;
  subject_id: string;
  reporter_kind: string;
  reporter_id: string | null;
}

/**
 * PD-57 ENG-04 (closure plan 2026-11-06 D-1, D-4; roadmap 2026-11-03 §5.2):
 * who hears of a report, and when.
 *
 *   report.created    normal: report_received_staff to the responsible managers
 *                     (chat.content_report_managers: live managers of the
 *                     report's departments holding moderation.view, never its
 *                     subject), else every Super Admin; quiet hours kept.
 *                     child_safety (filed, or a duplicate that raised it):
 *                     report_child_safety to every Super Admin and every live
 *                     holder of moderation.child_safety + moderation.view, at
 *                     once -- critical, so past quiet hours, the hourly cap and
 *                     preferences; one push each, never coalesced -- and never
 *                     to a department manager (D-4)
 *   18 h unresolved   report_due_soon to the same people as above
 *   24 h unresolved   report_overdue to every Super Admin; overdue_at set
 *   report.answered   report_answered to the reporter (in-app + push, quiet
 *                     hours kept), deep-linked to My reports. Nobody when the
 *                     reporter erased their account or is no longer live
 *
 * Every text is fixed (no placeholder); the entry carries ids, the reason, the
 * priority and dueAt only -- never the note, the evidence, the reporter, the
 * reviewer or the subject. Each (kind, report, recipient) once (dedupe key).
 * A report resolved since its alert was queued is not alerted.
 *
 * The sweep (every 5 minutes, worker.ts) marks a stage in
 * chat.content_report_alert (unique per report and stage) and queues
 * `report.escalated` in the same transaction, over rows taken FOR UPDATE SKIP
 * LOCKED: two workers, or a restart, alert each stage once. It also raises a
 * missing PD-47 `content_report` task and completes the task of a resolved
 * report (the triggers of 20261106150000 do both in the report's own
 * transaction; this is the guarantee, as PD-47's own sweep is for its sources).
 */
@Injectable()
export class ReportEscalationService implements ReportDelivery, OnModuleInit {
  private readonly log = new Logger(ReportEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly pipeline: NotificationPipeline,
    private readonly worker: OutboxWorker,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  /** ModerationModule depends on Communication, so the worker cannot inject this without a cycle. */
  onModuleInit(): void {
    this.worker.useReportDelivery(this);
  }

  // ------------------------------------------------------------------
  // Delivery (from the outbox worker)
  // ------------------------------------------------------------------

  async deliver(type: string, payload: Record<string, unknown>, now: Date = new Date()): Promise<void> {
    const reportId = typeof payload.reportId === 'string' ? payload.reportId : null;
    if (!reportId) return;
    const report = await this.report(reportId);
    if (!report || (typeof payload.organizationId === 'string' && payload.organizationId !== report.organization_id)) return;

    if (type === CommEvent.REPORT_ANSWERED) return this.answered(report, now);
    // Resolved since: nobody needs to act on it any more.
    if (report.status !== 'open' && report.status !== 'in_review') return;
    const childSafety = report.reason === 'child_safety';
    if (type === CommEvent.REPORT_CREATED) {
      // A block's case: the managers were already told by ENG-03's
      // block_created_manager notice (A-2a, once per case); a second "new
      // report" alert would only duplicate it. Its clock, task and 18 h / 24 h
      // escalations still run below.
      if (report.reason === 'blocked') return;
      const kind: Kind = childSafety ? 'report_child_safety' : 'report_received_staff';
      return this.tell(report, kind, await this.responsible(report), now);
    }
    if (type === CommEvent.REPORT_ESCALATED) {
      const stage = payload.stage as Stage;
      if (stage === 'due_soon') return this.tell(report, 'report_due_soon', await this.responsible(report), now);
      if (stage === 'overdue') return this.tell(report, 'report_overdue', await this.superAdmins(report), now);
    }
  }

  private async tell(report: ReportRow, kind: Kind, recipients: readonly string[], now: Date): Promise<void> {
    const critical = report.reason === 'child_safety';
    const dueAt = report.due_at.toISOString();
    for (const recipientId of recipients) {
      const recipient = await this.identity.resolveActor(recipientId);
      if (!recipient || !recipient.isActive || recipient.kind !== ActorKind.STAFF || recipient.organizationId !== report.organization_id) continue;
      await this.pipeline.emit({
        dedupeKey: `${kind}:${report.id}:${recipientId}`,
        ruleKey: kind,
        eventType: kind,
        templateKey: kind,
        recipientId,
        locale: recipient.locale,
        // child_safety: at once, past quiet hours, the cap and preferences (roadmap §5.2).
        priority: critical ? 'critical' : kind === 'report_overdue' ? 'high' : 'normal',
        respectQuietHours: !critical,
        subject: { type: 'content_report', id: report.id },
        refs: { reportId: report.id },
        variables: { reportId: report.id, reason: report.reason, priority: report.priority, dueAt },
        scheduledAt: now,
      });
    }
  }

  /** "The academy has answered your report": no reviewer, no subject, no words of the answer. */
  private async answered(report: ReportRow, now: Date): Promise<void> {
    if (report.status !== 'actioned' && report.status !== 'dismissed') return;
    // Erased (PD-56 anonymised the reference): there is nobody to tell.
    if (!report.reporter_id) return;
    const reporter = await this.identity.resolveActor(report.reporter_id);
    if (!reporter || !reporter.isActive || reporter.kind !== report.reporter_kind || reporter.organizationId !== report.organization_id) return;
    await this.pipeline.emit({
      dedupeKey: `report_answered:${report.id}:${reporter.actorId}`,
      ruleKey: 'report_answered',
      eventType: 'report_answered',
      templateKey: 'report_answered',
      recipientId: reporter.actorId,
      locale: reporter.locale,
      priority: 'normal',
      subject: { type: 'content_report', id: report.id },
      refs: { reportId: report.id },
      scheduledAt: now,
    });
  }

  /** normal: the responsible managers, else every Super Admin. child_safety: every Super Admin and holder. */
  private async responsible(report: ReportRow): Promise<string[]> {
    if (report.reason === 'child_safety') {
      const holders = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT s.id::text AS id
          FROM chat.staff s
         CROSS JOIN LATERAL chat.staff_access_profile(s.id) p
         WHERE s.organization_id = ${report.organization_id}::uuid AND s.is_active AND s.left_at IS NULL
           AND p.permissions @> array['moderation.view', 'moderation.child_safety']::text[]`;
      return this.notSubject(report, [...(await this.superAdmins(report)), ...holders.map((h) => h.id)]);
    }
    const managers = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT x.id::text AS id FROM chat.content_report_managers(${report.id}::uuid) AS x(id) ORDER BY x.id`;
    return managers.length ? managers.map((x) => x.id) : this.superAdmins(report);
  }

  private async superAdmins(report: ReportRow): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s.id::text AS id FROM chat.staff s
       WHERE s.organization_id = ${report.organization_id}::uuid AND s.role = 'super_admin' AND s.is_active AND s.left_at IS NULL
       ORDER BY s.id`;
    return this.notSubject(report, rows.map((r) => r.id));
  }

  /** Never the report's own subject (closure plan §3), once each. */
  private notSubject(report: ReportRow, ids: string[]): string[] {
    return [...new Set(ids)].filter((id) => !(report.subject_kind === 'staff' && report.subject_id === id)).sort();
  }

  private async report(id: string): Promise<ReportRow | null> {
    const [row] = await this.prisma.$queryRaw<ReportRow[]>`
      SELECT id::text AS id, organization_id::text AS organization_id, reason, priority, status, due_at,
             subject_kind, subject_id::text AS subject_id, reporter_kind, reporter_id::text AS reporter_id
        FROM chat.content_report WHERE id = ${id}::uuid`;
    return row ?? null;
  }

  // ------------------------------------------------------------------
  // The sweep (worker.ts, every 5 minutes)
  // ------------------------------------------------------------------

  /** Idempotent and safe on every replica at once. `now` is injectable for fixed-instant tests. */
  async sweep(now: Date = new Date()): Promise<{ dueSoon: number; overdue: number; tasks: number }> {
    const out = { dueSoon: 0, overdue: 0, tasks: 0 };
    for (;;) {
      const batch = await this.sweepBatch(now);
      out.dueSoon += batch.dueSoon;
      out.overdue += batch.overdue;
      if (batch.taken < SWEEP_BATCH) break;
    }
    out.tasks = await this.sweepTasks();
    if (out.dueSoon || out.overdue) this.log.log(`report sweep: ${out.dueSoon} due soon, ${out.overdue} overdue`);
    return out;
  }

  private async sweepBatch(now: Date): Promise<{ taken: number; dueSoon: number; overdue: number }> {
    return this.prisma.$transaction(async (tx) => {
      const soonUntil = new Date(now.getTime() + DUE_SOON_BEFORE_MS);
      const rows = await tx.$queryRaw<Array<{ id: string; organization_id: string; overdue: boolean }>>`
        SELECT r.id::text AS id, r.organization_id::text AS organization_id, (r.due_at <= ${now}::timestamptz) AS overdue
          FROM chat.content_report r
         WHERE r.status IN ('open', 'in_review')
           AND r.due_at <= ${soonUntil}::timestamptz
           AND (NOT EXISTS (SELECT 1 FROM chat.content_report_alert a WHERE a.report_id = r.id AND a.stage = 'due_soon')
                OR (r.due_at <= ${now}::timestamptz
                    AND NOT EXISTS (SELECT 1 FROM chat.content_report_alert a WHERE a.report_id = r.id AND a.stage = 'overdue')))
         ORDER BY r.due_at, r.id
         LIMIT ${SWEEP_BATCH}
         FOR UPDATE OF r SKIP LOCKED`;
      let dueSoon = 0;
      let overdue = 0;
      for (const r of rows) {
        // A report past 24 h whose 18 h stage never went (the worker was down)
        // still tells its managers: they were never told.
        const stages: Stage[] = r.overdue ? ['due_soon', 'overdue'] : ['due_soon'];
        for (const stage of stages) {
          const marked = await tx.$queryRaw<Array<{ id: string }>>`
            INSERT INTO chat.content_report_alert (organization_id, report_id, stage)
            VALUES (${r.organization_id}::uuid, ${r.id}::uuid, ${stage})
            ON CONFLICT (report_id, stage) DO NOTHING
            RETURNING id::text AS id`;
          if (!marked.length) continue;
          if (stage === 'overdue') {
            // Once (the guard allows it once, at or after due_at).
            await tx.$executeRaw`
              UPDATE chat.content_report SET overdue_at = greatest(${now}::timestamptz, due_at)
               WHERE id = ${r.id}::uuid AND overdue_at IS NULL`;
            overdue += 1;
          } else {
            dueSoon += 1;
          }
          await this.outbox.enqueue(tx, CommEvent.REPORT_ESCALATED, { organizationId: r.organization_id, reportId: r.id, stage });
        }
      }
      return { taken: rows.length, dueSoon, overdue };
    });
  }

  /** The PD-47 guarantee: a task for every unresolved report, none left open for a resolved one. */
  private async sweepTasks(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      (SELECT r.id::text AS id FROM chat.content_report r
        WHERE r.status IN ('open', 'in_review')
          AND NOT EXISTS (SELECT 1 FROM chat.work_task t
                           WHERE t.organization_id = r.organization_id AND t.source_key = 'content_report:' || r.id::text)
        ORDER BY r.due_at LIMIT ${TASK_SWEEP_BATCH})
      UNION
      (SELECT r.id::text FROM chat.content_report r
         JOIN chat.work_task t ON t.organization_id = r.organization_id AND t.source_key = 'content_report:' || r.id::text
        WHERE r.status IN ('actioned', 'dismissed') AND t.state IN ('open', 'awaiting_decision')
        LIMIT ${TASK_SWEEP_BATCH})`;
    let n = 0;
    for (const { id } of rows) {
      try {
        await this.prisma.$queryRaw`SELECT chat.work_task_sync_content_report(${id}::uuid)::text AS id`;
        n += 1;
      } catch (e) {
        this.log.warn(`report task sync failed for one report: ${(e as Error).name}`);
      }
    }
    return n;
  }
}
