/**
 * PD-59 retention: the job is off and a dry run unless switched on, bounded by a batch, calls only the one
 * SQL function, and that function (chat.purge_expired_sales_leads) is written so it can touch nothing but a
 * lead's own PII. What it does to rows is NOT proven by this file: the throwaway-Postgres check run for the PR
 * (results in its description) exercised it; no integration spec in this repository does yet.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_BATCH, MAX_BATCH, RETENTION_MONTHS, SalesLeadRetentionService, retentionConfig,
} from '../../../src/sales-pipeline/lead-retention.service';

const MIGRATION = join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations', '20261121100000_chat_pd059_sales_pipeline.sql');

describe('the retention switches', () => {
  it('are OFF and a dry run by default, so nothing runs or deletes unless it is switched on', () => {
    expect(retentionConfig({})).toEqual({ enabled: false, dryRun: true, batch: DEFAULT_BATCH });
    expect(retentionConfig({ SALES_LEAD_RETENTION_ENABLED: 'true' })).toMatchObject({ enabled: true, dryRun: true });
    expect(retentionConfig({ SALES_LEAD_RETENTION_ENABLED: 'yes' }).enabled).toBe(false);
    // only an explicit "false" deletes
    for (const v of ['', '0', 'no', 'FALSEY', undefined]) expect(retentionConfig({ SALES_LEAD_RETENTION_DRY_RUN: v }).dryRun).toBe(true);
    expect(retentionConfig({ SALES_LEAD_RETENTION_ENABLED: 'true', SALES_LEAD_RETENTION_DRY_RUN: 'false' })).toMatchObject({ enabled: true, dryRun: false });
  });

  it('bounds the batch', () => {
    expect(retentionConfig({ SALES_LEAD_RETENTION_BATCH: '50' }).batch).toBe(50);
    expect(retentionConfig({ SALES_LEAD_RETENTION_BATCH: '999999' }).batch).toBe(MAX_BATCH);
    for (const v of ['0', '-3', 'abc', '1.5']) expect(retentionConfig({ SALES_LEAD_RETENTION_BATCH: v }).batch).toBe(DEFAULT_BATCH);
  });

  it('the worker\'s pass does nothing, and reads nothing, while the job is off', async () => {
    const calls: unknown[] = [];
    const prisma = { $queryRaw: async (...a: unknown[]) => { calls.push(a); return []; } };
    const service = new SalesLeadRetentionService(prisma as never);
    expect(await service.sweep({})).toBeNull();
    expect(calls).toEqual([]);
  });

  it('when on it asks the database function once, with the batch and the dry-run flag, and reports lead ids only', async () => {
    const seen: unknown[][] = [];
    const prisma = { $queryRaw: async (_s: TemplateStringsArray, ...v: unknown[]) => { seen.push(v); return [{ purge_expired_sales_leads: 'lead-1' }]; } };
    const service = new SalesLeadRetentionService(prisma as never);
    expect(await service.sweep({ SALES_LEAD_RETENTION_ENABLED: 'true', SALES_LEAD_RETENTION_BATCH: '25' })).toEqual({ dryRun: true, leadIds: ['lead-1'] });
    expect(seen).toEqual([[25, true]]);
    expect(await service.run({ dryRun: false, limit: 5000 })).toEqual({ dryRun: false, leadIds: ['lead-1'] });
    expect(seen[1]).toEqual([MAX_BATCH, false]);
  });
});

describe('the purge function in the migration', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const fn = (name: string) => {
    const start = sql.indexOf(`create or replace function chat.${name}(`);
    expect(start).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf('$$;', sql.indexOf('as $$', start)) + 3);
  };

  it('is 12 months, never converted, and keeps the clock to meaningful activity (not reads)', () => {
    expect(RETENTION_MONTHS).toBe(12);
    const expired = fn('sales_lead_expired');
    expect(expired).toContain("interval '12 months'");
    expect(expired).toContain('p.converted_at is null');
    expect(expired).toContain('p.last_activity_at');
    expect(expired).not.toMatch(/audit_log|viewed/);
  });

  it('touches only the lead\'s own PII: never a family, a parent, a contact, a learner or an account', () => {
    const purge = fn('purge_expired_sales_leads') + fn('expired_sales_leads') + fn('sales_lead_expired');
    const touched = [...purge.matchAll(/\b(?:delete from|update|insert into)\s+chat\.([a-z_]+)/g)].map((m) => m[1]).sort();
    expect([...new Set(touched)]).toEqual(['audit_log', 'sales_lead_contact', 'trial_prospect', 'trial_student']);
    // Customers are only ever READ, to be kept (never written): the same tables the purge must not write.
    for (const table of ['family', 'contact', 'learner', 'parent_file', 'account', 'family_contact_key']) {
      expect(purge).not.toMatch(new RegExp(`chat\\.${table}\\b`));
    }
  });

  it('clears notes and the contact, keeps the analytics columns, and audits ids and flags, never a value', () => {
    const purge = fn('purge_expired_sales_leads');
    expect(purge).toContain('set note = null, follow_up_note = null');
    for (const kept of ['pipeline_stage', 'lost_reason', 'last_contacted_at']) expect(purge).not.toContain(kept);
    expect(purge).toContain("jsonb_build_object('contactDeleted'");
    expect(purge).not.toMatch(/phone|whatsapp|email|parent_name/);
  });

  it('S3: never a customer -- converted, learner-linked, subscribed, or enrolled leads are kept whole', () => {
    const expired = fn('sales_lead_expired');
    for (const kept of ['p.converted_at is null', 'p.converted_family_id is null', 'p.learner_id is null', "o.result = 'subscribed'", 'chat.student_enrolment']) {
      expect(expired).toContain(kept);
    }
  });

  it('S4: one run at a time, candidates locked skip-locked, expiry re-checked after the lock', () => {
    const purge = fn('purge_expired_sales_leads');
    expect(purge).toContain("pg_try_advisory_xact_lock(hashtext('chat.purge_expired_sales_leads'))");
    expect(purge).toContain('for update of p skip locked');
    expect(purge.indexOf('if not chat.sales_lead_expired(r.prospect_id)')).toBeLessThan(purge.indexOf('delete from chat.sales_lead_contact'));
  });

  it('S2: the backfill gives a pre-PD-59 prospect to its creator only when the creator is live Sales staff (never the super admin)', () => {
    const at = sql.indexOf('update chat.trial_prospect p\n   set owner_staff_id = p.created_by');
    expect(at).toBeGreaterThan(-1);
    const block = sql.slice(at, sql.indexOf(';', at));
    expect(block).toContain('p.owner_staff_id is null');
    expect(block).toContain("s.role <> 'super_admin'");
    expect(block).toContain('chat.sales_department_role(s.id) is not null');
  });

  it('defaults to a dry run, and is closed to every request role', () => {
    expect(fn('purge_expired_sales_leads')).toContain('p_dry_run boolean default true');
    expect(sql).toMatch(/revoke all on function chat\.purge_expired_sales_leads\(integer, boolean\) from public, anon, authenticated, chat_app/);
  });
});
