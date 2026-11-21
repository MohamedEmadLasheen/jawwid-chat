import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';

/**
 * PD-59 retention: a lead that has not converted within 12 months of its last MEANINGFUL activity loses
 * its personal data -- the confined contact (parent name, phone, WhatsApp, e-mail) and the free-text notes
 * that could hold more. Stage, lost-reason code, timestamps and counts stay as analytics.
 *
 * "Meaningful activity" (apps/api, docs/product/pd-registry/PD-59.md): the lead created; contacted; a stage
 * change; a follow-up change; a contact edit; a reassignment (each moves `last_activity_at`); and a trial
 * booked or held for the lead (the later of its lesson's creation and end). Reads and views, list or detail,
 * never count -- opening a lead must not keep its data alive.
 *
 * A lead that is a customer is never purged: converted, linked to a learner, with a subscribed trial or any
 * enrolment record are kept whole (chat.sales_lead_expired). The work is one SQL function,
 * chat.purge_expired_sales_leads, which takes an advisory lock (one run at a time), locks each candidate row
 * (skipping a lead being changed), re-checks the expiry after the lock, deletes
 * through the table's own guard (that allows it only while the purge runs), writes one audit row per lead (its
 * id and what was cleared, never a value) and touches NO family, parent record, contact or learner.
 *
 * Safe by default (the repository's switch convention: environment flags, read at each sweep, off unless set;
 * a change needs a restart of the worker's environment, not a code change):
 *   SALES_LEAD_RETENTION_ENABLED=true   the worker runs the job at all (default: it does not)
 *   SALES_LEAD_RETENTION_DRY_RUN=false  actually delete; any other value only lists what would go (default: dry run)
 *   SALES_LEAD_RETENTION_BATCH=n        leads per pass, 1..1000 (default 200)
 */
export const RETENTION_MONTHS = 12;
export const DEFAULT_BATCH = 200;
export const MAX_BATCH = 1000;

export function retentionConfig(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; dryRun: boolean; batch: number } {
  const raw = Number(env.SALES_LEAD_RETENTION_BATCH ?? DEFAULT_BATCH);
  const batch = Number.isInteger(raw) && raw >= 1 ? Math.min(raw, MAX_BATCH) : DEFAULT_BATCH;
  return {
    enabled: (env.SALES_LEAD_RETENTION_ENABLED ?? '').trim().toLowerCase() === 'true',
    dryRun: (env.SALES_LEAD_RETENTION_DRY_RUN ?? '').trim().toLowerCase() !== 'false',
    batch,
  };
}

@Injectable()
export class SalesLeadRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  /** One pass: the ids of the leads purged (or, in a dry run, that would be). Idempotent: a purged lead no longer qualifies. */
  async run(opts: { dryRun: boolean; limit: number }): Promise<{ dryRun: boolean; leadIds: string[] }> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit), 1), MAX_BATCH);
    const rows = await this.prisma.$queryRaw<Array<{ purge_expired_sales_leads: string }>>`
      SELECT chat.purge_expired_sales_leads(${limit}::integer, ${opts.dryRun}::boolean)::text AS purge_expired_sales_leads`;
    return { dryRun: opts.dryRun, leadIds: rows.map((r) => r.purge_expired_sales_leads) };
  }

  /** The worker's pass, per the switches above. Returns null when the job is off. */
  async sweep(env: NodeJS.ProcessEnv = process.env): Promise<{ dryRun: boolean; leadIds: string[] } | null> {
    const cfg = retentionConfig(env);
    if (!cfg.enabled) return null;
    return this.run({ dryRun: cfg.dryRun, limit: cfg.batch });
  }
}
