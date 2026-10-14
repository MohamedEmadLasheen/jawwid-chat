/**
 * Migration-chain guard for the 2026-10-13/14 security fixes.
 *
 * apply.sh applies every UNAPPLIED file in filename order -- including a file
 * whose timestamp is OLDER than migrations already applied. So a port of the
 * phase-7 lineage (20260907100100_chat_phase1_rbac.sql, which redefines
 * transfer_ownership / offboard_staff with `coalesce(p_actor_id, ...)`) would
 * run AFTER the fixes and silently overwrite them. This test reads the
 * migration files and refuses that shape, and any re-grant of what the fixes
 * revoked, before it can reach a database.
 *
 * Pure: reads files, no database.
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '../../../../../supabase/migrations');
const SCHEMA = join(__dirname, '../../../prisma/schema.prisma');

const BOUNDARY = '20261014090000';
const REPAIR = '20261014090100';

/** Functions whose security properties the fixes established. */
const PROTECTED = [
  'transfer_ownership', 'offboard_staff', 'assign_family_owner', 'dispute_attention_order',
  'transfer_staff_families', 'deactivate_staff',
  'log_event', 'write_audit', 'recompute_family_state', 'extend_stickiness',
  'link_staff_account', 'link_contact_account',
  'guard_owner_change', 'guard_learner_assignment_change', 'guard_super_admin_grant',
];
/** Must take their actor from chat.trusted_staff_actor in every definition from the boundary on. */
const ACTOR_FUNCTIONS = [
  'transfer_ownership', 'offboard_staff', 'assign_family_owner', 'dispute_attention_order',
  'transfer_staff_families', 'deactivate_staff',
];
/** Definitions that predate the fixes and are already part of the applied chain. */
const HISTORICAL = new Set([
  '20260905090500_chat_logs_and_state_cache',
  '20260905090600_chat_coverage_engine',
  '20260905090700_chat_ownership_invariants',
  '20260905090800_chat_attention_and_workload',
  '20260905090900_chat_core_integration',
  '20260905091200_chat_rls',
  '20260905094000_chat_od01_conversation_reconciliation',
  '20260923130000_chat_learner_assignment_authority',
  '20261013120000_chat_super_admin_role',
]);
const REQUEST_ROLES = '(public|anon|authenticated|chat_app)';

export function auditMigrations(dir: string, schemaPath: string): string[] {
  const violations: string[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const versions = files.map((f) => f.slice(0, 14));

  const dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
  if (dupes.length) violations.push(`duplicate migration version(s): ${[...new Set(dupes)].join(', ')}`);

  const boundary = files.find((f) => f.startsWith(BOUNDARY));
  const repair = files.find((f) => f.startsWith(REPAIR));
  if (!boundary || !repair) violations.push('the ownership boundary and repair migrations must both be present');

  for (const file of files) {
    const name = file.replace(/\.sql$/, '');
    const version = file.slice(0, 14);
    const sql = readFileSync(join(dir, file), 'utf8');

    for (const fn of PROTECTED) {
      const defines = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+chat\\.${fn}\\s*\\(`, 'i').test(sql);
      if (!defines) continue;
      if (version < BOUNDARY && !HISTORICAL.has(name)) {
        violations.push(`${file} redefines chat.${fn} with a timestamp older than ${BOUNDARY}: it would run after the fixes and overwrite them`);
      }
      if (version >= BOUNDARY && ACTOR_FUNCTIONS.includes(fn)) {
        const body = sql.slice(sql.search(new RegExp(`function\\s+chat\\.${fn}\\s*\\(`, 'i')));
        const end = body.indexOf('$$;', body.indexOf('$$') + 2);
        const def = end > 0 ? body.slice(0, end) : body;
        if (/coalesce\s*\(\s*p_(actor|staff)_id/i.test(def)) {
          violations.push(`${file} reintroduces a caller-supplied actor in chat.${fn}`);
        }
        if (!/trusted_staff_actor\s*\(/i.test(def)) {
          violations.push(`${file} defines chat.${fn} without chat.trusted_staff_actor`);
        }
      }
      if (version >= BOUNDARY && fn === 'log_event' && /returns\s+uuid/i.test(sql.slice(sql.search(/function\s+chat\.log_event/i)))) {
        violations.push(`${file} defines chat.log_event returning uuid (event_log.id is bigint)`);
      }
    }

    if (version > REPAIR) {
      const execGrant = new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+chat\\.(${PROTECTED.join('|')})\\b[^;]*\\bto\\b[^;]*\\b${REQUEST_ROLES}\\b`, 'i');
      if (execGrant.test(sql)) violations.push(`${file} re-grants EXECUTE on a protected function to a request role`);
    }
    if (version > '20261013160000') {
      const tableUpdate = new RegExp(
        `grant\\s+(all|update|[a-z, ]*\\bupdate\\b)(?!\\s*\\()[^;]*\\bon\\s+(table\\s+)?chat\\.(staff|family|learner|contact)\\b[^;]*\\bto\\b[^;]*\\b${REQUEST_ROLES}\\b`, 'i');
      if (tableUpdate.test(sql)) violations.push(`${file} grants table-level UPDATE on a protected table to a request role`);
      const columnUpdate = new RegExp(
        `grant\\s+update\\s*\\(([^)]*)\\)\\s*on\\s+chat\\.(staff|family|learner|contact)\\b[^;]*\\bto\\b[^;]*\\b${REQUEST_ROLES}\\b`, 'gi');
      const forbidden: Record<string, string[]> = {
        staff: ['role', 'is_active', 'left_at', 'account_id', 'organization_id'],
        family: ['owner_id'],
        learner: ['teacher_id'],
        contact: ['account_id'],
      };
      for (const m of sql.matchAll(columnUpdate)) {
        const cols = m[1].split(',').map((c) => c.trim().replace(/"/g, ''));
        const hit = cols.filter((c) => forbidden[m[2].toLowerCase()].includes(c));
        if (hit.length) violations.push(`${file} grants UPDATE on protected chat.${m[2]} column(s) ${hit.join(', ')} to a request role`);
      }
    }
  }

  const schema = readFileSync(schemaPath, 'utf8');
  const staff = schema.slice(schema.indexOf('model Staff {'), schema.indexOf('\n}', schema.indexOf('model Staff {')));
  const avatar = (staff.match(/^\s*avatarObjectKey\s/gm) ?? []).length;
  if (avatar !== 1) violations.push(`model Staff declares avatarObjectKey ${avatar} times (expected exactly 1)`);

  return violations;
}

describe('migration-chain security guard', () => {
  it('the repository chain is clean', () => {
    expect(auditMigrations(MIGRATIONS, SCHEMA)).toEqual([]);
  });

  describe('it catches what it exists for (negative controls on a scratch copy)', () => {
    function scratch(extra: Record<string, string>): string {
      const dir = mkdtempSync(join(tmpdir(), 'mig-guard-'));
      for (const f of readdirSync(MIGRATIONS)) writeFileSync(join(dir, f), readFileSync(join(MIGRATIONS, f)));
      for (const [f, body] of Object.entries(extra)) writeFileSync(join(dir, f), body);
      return dir;
    }
    const PHASE7_STYLE = `create or replace function chat.transfer_ownership(
  p_family_id uuid, p_to_staff_id uuid, p_reason text, p_actor_id uuid default null
) returns void language plpgsql as $$
declare v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
begin end; $$;`;

    it('a phase-7 style port with an older timestamp', () => {
      const v = auditMigrations(scratch({ '20260907100100_chat_phase1_rbac.sql': PHASE7_STYLE }), SCHEMA);
      expect(v.join('\n')).toMatch(/older than 20261014090000/);
    });

    it('a later definition that trusts p_actor_id again', () => {
      const v = auditMigrations(scratch({ '20261101000000_regress.sql': PHASE7_STYLE }), SCHEMA);
      expect(v.join('\n')).toMatch(/reintroduces a caller-supplied actor/);
    });

    it('a re-grant of EXECUTE or of a protected column, and a duplicate version', () => {
      const v = auditMigrations(
        scratch({
          '20261101000001_regrant.sql':
            'grant execute on function chat.write_audit(uuid, text, text, uuid, text, jsonb, jsonb) to authenticated;\n' +
            'grant update (owner_id) on chat.family to authenticated;\n' +
            'grant update on chat.staff to chat_app;',
          '20261101000001_duplicate.sql': 'select 1;',
        }),
        SCHEMA,
      ).join('\n');
      expect(v).toMatch(/re-grants EXECUTE/);
      expect(v).toMatch(/protected chat.family column\(s\) owner_id/);
      expect(v).toMatch(/table-level UPDATE on a protected table/);
      expect(v).toMatch(/duplicate migration version/);
    });

    it('a duplicated Staff.avatarObjectKey', () => {
      const dir = mkdtempSync(join(tmpdir(), 'schema-guard-'));
      const schema = readFileSync(SCHEMA, 'utf8').replace(
        'model Staff {\n',
        'model Staff {\n  avatarObjectKey String? @map("avatar_object_key")\n',
      );
      writeFileSync(join(dir, 'schema.prisma'), schema);
      expect(auditMigrations(MIGRATIONS, join(dir, 'schema.prisma')).join('\n')).toMatch(/avatarObjectKey 2 times/);
    });
  });
});
