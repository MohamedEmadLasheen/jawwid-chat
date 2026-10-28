/**
 * PD-40: the database's catalogue and legacy bundles are the TypeScript ones.
 *
 * The migration 20261027190000_chat_pd040_access_roles.sql seeds
 * chat.permission and chat.legacy_permission_bundle inside a generated block.
 * This spec renders that block from catalogue.ts and legacy-bundles.ts and
 * fails when the migration's copy differs, so the SQL rules (H5's "grant only
 * what you hold", chat.staff_access_profile) and the API can never disagree.
 * Regenerate with: PD040_WRITE_SEED=1 npx jest pd040-catalogue-seed
 *
 * A later migration that changes the catalogue adds its own rows; the
 * database-level check is test/integration/pd040-access-roles.spec.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSIONS } from '@platform/permissions/catalogue';
import { legacyBundle, legacyBundleNames, type LegacyTier, type StaffPlacement } from '@platform/permissions/legacy-bundles';

const MIGRATION = join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations', '20261027190000_chat_pd040_access_roles.sql');
const BEGIN = '-- BEGIN GENERATED pd040 seed -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit';
const END = '-- END GENERATED pd040 seed';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function seed(): string {
  const permissions = PERMISSIONS.map(
    (p) => `  (${[q(p.key), q(p.page), q(p.action), q(p.label.en), q(p.label.ar), q(p.risk), String(p.delegable), q(p.introducedBy)].join(', ')})`,
  );
  const bundles: string[] = [];
  for (const name of legacyBundleNames()) {
    if (name === 'super_admin') continue;
    const [tier, kind] = name.split(':') as [LegacyTier, string];
    const placement: StaffPlacement =
      kind === 'none' ? { kind: null, position: null } : { kind: kind as StaffPlacement['kind'], position: tier === 'manager' ? 'manager' : 'member' };
    for (const key of [...legacyBundle(tier, placement)].sort()) bundles.push(`  (${q(tier)}, ${q(kind)}, ${q(key)})`);
  }
  return [
    BEGIN,
    'insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values',
    permissions.join(',\n') + ';',
    '',
    'insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values',
    bundles.join(',\n') + ';',
    END,
  ].join('\n');
}

describe('PD-40: the migration seeds exactly the TypeScript catalogue and bundles', () => {
  it('the generated block is up to date', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const start = sql.indexOf(BEGIN);
    const end = sql.indexOf(END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const current = sql.slice(start, end + END.length);
    const want = seed();
    if (process.env.PD040_WRITE_SEED === '1' && current !== want) writeFileSync(MIGRATION, sql.replace(current, want));
    expect(readFileSync(MIGRATION, 'utf8').slice(start, start + want.length)).toBe(want);
  });

  it('every bundle the code knows has rows or is deliberately empty', () => {
    const names = legacyBundleNames();
    expect(names).toContain('super_admin');
    expect(names).toEqual(expect.arrayContaining(['manager:operations', 'manager:teachers', 'manager:sales', 'manager:none', 'legacy_department:none']));
  });
});
