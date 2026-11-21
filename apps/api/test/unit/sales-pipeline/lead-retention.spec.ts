/**
 * PD-59 retention: the job is off and a dry run unless switched on, bounded by a batch, calls only the one
 * SQL function, and that function (chat.purge_expired_sales_leads) is written so it can touch nothing but a
 * lead's own PII. What it does to rows -- only expired, unconverted leads; analytics kept; idempotent;
 * recent leads skipped; families, parents and learners untouched -- is proven against a real Postgres in the
 * migration smoke check recorded on the PR (the database refuses a purge of a fresh lead even when asked).
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
    const expired = fn('expired_sales_leads');
    expect(expired).toContain("interval '12 months'");
    expect(expired).toContain('p.converted_at is null');
    expect(expired).toContain('p.last_activity_at');
    expect(expired).not.toMatch(/audit_log|viewed/);
  });

  it('touches only the lead\'s own PII: never a family, a parent, a contact, a learner or an account', () => {
    const purge = fn('purge_expired_sales_leads') + fn('expired_sales_leads');
    const touched = [...purge.matchAll(/\b(?:delete from|update|insert into)\s+chat\.([a-z_]+)/g)].map((m) => m[1]).sort();
    expect([...new Set(touched)]).toEqual(['audit_log', 'sales_lead_contact', 'trial_prospect', 'trial_student']);
    for (const table of ['family', 'contact', 'learner', 'parent_file', 'account', 'student_enrolment', 'family_contact_key']) {
      expect(purge).not.toMatch(new RegExp(`chat\\.${table}\\b`));
    }
  });

  it('clears notes and the contact, keeps the analytics columns, and audits ids and flags, never a value', () => {
    const purge = fn('purge_expired_sales_leads');
    expect(purge).toContain('set note = null, follow_up_note = null');
    for (const kept of ['pipeline_stage', 'lost_reason', 'last_contacted_at', 'created_at']) expect(purge).not.toContain(kept);
    expect(purge).toContain("jsonb_build_object('contactDeleted'");
    expect(purge).not.toMatch(/phone|whatsapp|email|parent_name/);
  });

  it('defaults to a dry run, and is closed to every request role', () => {
    expect(fn('purge_expired_sales_leads')).toContain('p_dry_run boolean default true');
    expect(sql).toMatch(/revoke all on function chat\.purge_expired_sales_leads\(integer, boolean\) from public, anon, authenticated, chat_app/);
  });
});
