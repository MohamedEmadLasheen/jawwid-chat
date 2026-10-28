/**
 * PD-40: the database's catalogue and legacy bundles are the TypeScript ones.
 *
 * The migration 20261027190000_chat_pd040_access_roles.sql seeds
 * chat.permission and chat.legacy_permission_bundle inside a generated block.
 * This spec renders that block from catalogue.ts and legacy-bundles.ts and
 * fails when the migration's copy differs, so the SQL rules (H5's "grant only
 * what you hold", chat.staff_access_profile) and the API can never disagree.
 *
 * A LATER MIGRATION THAT CHANGES THE CATALOGUE never edits that block: once
 * applied anywhere, a migration file is frozen. It adds its own rows in a
 * generated block of its own, listed in LATER below, and the 20261027190000
 * block is rendered WITHOUT them. Together the blocks are the whole catalogue;
 * the database-level check is test/integration/pd040-access-roles.spec.ts.
 * Regenerate every block with: PD040_WRITE_SEED=1 npx jest pd040-catalogue-seed
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSIONS } from '@platform/permissions/catalogue';
import { legacyBundle, legacyBundleNames, type LegacyTier, type StaffPlacement } from '@platform/permissions/legacy-bundles';

const MIGRATIONS = join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations');
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

type BundleRow = readonly [tier: string, kind: string, key: string];

interface Block {
  migration: string;
  begin: string;
  end: string;
  /** Which catalogue keys and bundle rows this block inserts. */
  permission: (key: string) => boolean;
  bundle: (row: BundleRow) => boolean;
}

/** Rows a later migration adds to the catalogue, oldest first. */
const LATER: ReadonlyArray<{ migration: string; tag: string; permissions: readonly string[]; bundles: readonly BundleRow[] }> = [
  {
    // PD-43: adding and offboarding teachers; the Teachers manager holds payroll (owner N2).
    migration: '20261028100000_chat_pd043_teacher_onboarding.sql',
    tag: 'pd043',
    permissions: ['teachers.create', 'teachers.offboard'],
    bundles: [
      ['manager', 'teachers', 'teacher_files.finance'],
      ['manager', 'teachers', 'teachers.create'],
      ['manager', 'teachers', 'teachers.offboard'],
      ['supervisor', 'teachers', 'teachers.create'],
    ],
  },
  {
    // PD-42 (PD-30-amendment-carried-over): the supervisors who enter
    // families, and their managers, may carry a package over from Core.
    migration: '20261028110000_chat_pd042_direct_enrolment.sql',
    tag: 'pd042',
    permissions: ['subscriptions.carry_over'],
    bundles: [
      ['manager', 'operations', 'subscriptions.carry_over'],
      ['manager', 'sales', 'subscriptions.carry_over'],
      ['supervisor', 'operations', 'subscriptions.carry_over'],
      ['supervisor', 'sales', 'subscriptions.carry_over'],
    ],
  },
  {
    // PD-40 shadow QA (2026-10-28): what Sales and Teachers-department members
    // reach today, so that enforcing refuses none of it (plan §14).
    migration: '20261028120000_chat_pd040_shadow_qa_bundles.sql',
    tag: 'pd040qa',
    permissions: [],
    bundles: [
      ['manager', 'sales', 'cases.view'],
      ['manager', 'sales', 'lessons.view'],
      ['supervisor', 'sales', 'cases.view'],
      ['supervisor', 'sales', 'lessons.view'],
      ['supervisor', 'teachers', 'reports.view'],
    ],
  },
  {
    // PD-42 PR-2: a Sales account edits the contact record of the families it owns.
    migration: '20261028210000_chat_pd042_intake_scope.sql',
    tag: 'pd042b',
    permissions: [],
    bundles: [
      ['manager', 'sales', 'parents.edit'],
      ['supervisor', 'sales', 'parents.edit'],
    ],
  },
];

const laterKey = new Set(LATER.flatMap((l) => l.permissions));
const laterRow = new Set(LATER.flatMap((l) => l.bundles.map((r) => r.join('|'))));

const BLOCKS: Block[] = [
  {
    migration: '20261027190000_chat_pd040_access_roles.sql',
    begin: '-- BEGIN GENERATED pd040 seed -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit',
    end: '-- END GENERATED pd040 seed',
    permission: (key) => !laterKey.has(key),
    bundle: (row) => !laterRow.has(row.join('|')),
  },
  ...LATER.map((l) => ({
    migration: l.migration,
    begin: `-- BEGIN GENERATED ${l.tag} catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit`,
    end: `-- END GENERATED ${l.tag} catalogue rows`,
    permission: (key: string) => l.permissions.includes(key),
    bundle: (row: BundleRow) => l.bundles.some((r) => r.join('|') === row.join('|')),
  })),
];

/** Every bundle row the TypeScript bundles hold, in a stable order. */
function bundleRows(): BundleRow[] {
  const rows: BundleRow[] = [];
  for (const name of legacyBundleNames()) {
    if (name === 'super_admin') continue;
    const [tier, kind] = name.split(':') as [LegacyTier, string];
    const placement: StaffPlacement =
      kind === 'none' ? { kind: null, position: null } : { kind: kind as StaffPlacement['kind'], position: tier === 'manager' ? 'manager' : 'member' };
    for (const key of [...legacyBundle(tier, placement)].sort()) rows.push([tier, kind, key]);
  }
  return rows;
}

function render(block: Block): string {
  const permissions = PERMISSIONS.filter((p) => block.permission(p.key)).map(
    (p) => `  (${[q(p.key), q(p.page), q(p.action), q(p.label.en), q(p.label.ar), q(p.risk), String(p.delegable), q(p.introducedBy)].join(', ')})`,
  );
  const bundles = bundleRows()
    .filter(block.bundle)
    .map(([tier, kind, key]) => `  (${q(tier)}, ${q(kind)}, ${q(key)})`);
  const lines = [block.begin];
  if (permissions.length > 0) {
    lines.push('insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values', permissions.join(',\n') + ';');
  }
  if (permissions.length > 0 && bundles.length > 0) lines.push('');
  if (bundles.length > 0) {
    lines.push('insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values', bundles.join(',\n') + ';');
  }
  lines.push(block.end);
  return lines.join('\n');
}

describe('PD-40: the migration seeds exactly the TypeScript catalogue and bundles', () => {
  it.each(BLOCKS.map((b) => [b.migration, b] as const))('the generated block of %s is up to date', (_name, block) => {
    const file = join(MIGRATIONS, block.migration);
    const sql = readFileSync(file, 'utf8');
    const start = sql.indexOf(block.begin);
    const end = sql.indexOf(block.end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const current = sql.slice(start, end + block.end.length);
    const want = render(block);
    if (process.env.PD040_WRITE_SEED === '1' && current !== want) writeFileSync(file, sql.replace(current, want));
    expect(readFileSync(file, 'utf8').slice(start, start + want.length)).toBe(want);
  });

  it('every row a later block claims is in the TypeScript catalogue and bundles, so the blocks together are the whole of it', () => {
    const keys = new Set(PERMISSIONS.map((p) => p.key));
    const rows = new Set(bundleRows().map((r) => r.join('|')));
    expect([...laterKey].filter((k) => !keys.has(k))).toEqual([]);
    expect([...laterRow].filter((r) => !rows.has(r))).toEqual([]);
  });

  it('every bundle the code knows has rows or is deliberately empty', () => {
    const names = legacyBundleNames();
    expect(names).toContain('super_admin');
    expect(names).toEqual(expect.arrayContaining(['manager:operations', 'manager:teachers', 'manager:sales', 'manager:none', 'legacy_department:none']));
  });
});
