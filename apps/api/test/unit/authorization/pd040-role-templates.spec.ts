/**
 * PD-40 PR-4: the template access roles every organization starts with.
 *
 * The migration seeds them from a generated block; this spec renders it from
 * role-templates.ts and fails when the copy differs (as pd040-catalogue-seed
 * does for the catalogue). It also holds each template to the rules a grant
 * will meet anyway, so a template is never seeded that nobody could be given:
 * every key in the catalogue, in roles, and -- for a specialist template --
 * delegable, so the department manager who holds it may grant it (S1, H5).
 *
 * The Designer (plan §7, PD-41): certificates.view + certificates.design,
 * never certificates.deliver. Its exact routes are pinned in
 * pd040-route-permissions.spec.ts ("PD-41: the Designer ..."); here: whatever
 * its keys open is a certificates route and nothing else.
 *
 * Regenerate the block with: PD040_WRITE_SEED=1 npx jest pd040-role-templates
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSIONS } from '@platform/permissions/catalogue';
import { legacyBundle } from '@platform/permissions/legacy-bundles';
import { ACCESS_ROLE_TEMPLATES, type AccessRoleTemplate } from '@platform/permissions/role-templates';
import { collectRoutes } from '../../support/route-inventory';

const MIGRATIONS = join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations');
const BEGIN = '-- BEGIN GENERATED pd040 role templates -- by test/unit/authorization/pd040-role-templates.spec.ts; do not edit';
const END = '-- END GENERATED pd040 role templates';
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function render(templates: readonly AccessRoleTemplate[]): string {
  const rows = templates.map(
    (t) =>
      `        (${[q(t.key), q(t.nameEn), q(t.nameAr), q(t.description), q(t.maxTier)].join(', ')}, array[${[...t.permissions]
        .sort()
        .map(q)
        .join(', ')}]::text[])`,
  );
  return [BEGIN, rows.join(',\n'), END].join('\n');
}

const byKey = new Map(PERMISSIONS.map((p) => [p.key, p]));
const designer = ACCESS_ROLE_TEMPLATES.find((t) => t.key === 'designer')!;

describe('PD-40 PR-4: the template roles the migration seeds', () => {
  it.each([...new Set(ACCESS_ROLE_TEMPLATES.map((t) => t.migration))])('the generated block of %s is up to date', (migration) => {
    const file = join(MIGRATIONS, migration);
    const sql = readFileSync(file, 'utf8');
    const start = sql.indexOf(BEGIN);
    const end = sql.indexOf(END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const current = sql.slice(start, end + END.length);
    const want = render(ACCESS_ROLE_TEMPLATES.filter((t) => t.migration === migration));
    if (process.env.PD040_WRITE_SEED === '1' && current !== want) writeFileSync(file, sql.replace(current, want));
    expect(readFileSync(file, 'utf8').slice(start, start + want.length)).toBe(want);
  });

  it.each(ACCESS_ROLE_TEMPLATES.map((t) => [t.key, t] as const))('%s: a valid role key whose every key is in the catalogue and may go in a role', (_key, t) => {
    expect(t.key).toMatch(/^[a-z][a-z0-9_]{1,62}$/);
    expect(t.permissions.length).toBeGreaterThan(0);
    expect(new Set(t.permissions).size).toBe(t.permissions.length);
    for (const key of t.permissions) expect({ key, known: byKey.has(key), inRoles: byKey.get(key)?.inRoles }).toEqual({ key, known: true, inRoles: true });
  });

  it.each(ACCESS_ROLE_TEMPLATES.filter((t) => t.maxTier === 'specialist').map((t) => [t.key, t] as const))(
    '%s: a specialist template a department manager can grant -- every key delegable and held by some manager bundle',
    (_key, t) => {
      for (const key of t.permissions) expect({ key, delegable: byKey.get(key)?.delegable }).toEqual({ key, delegable: true });
      const managers = (['operations', 'teachers', 'sales'] as const).filter((kind) => {
        const held = legacyBundle('manager', { kind, position: 'manager' });
        return t.permissions.every((k) => held.has(k));
      });
      expect(managers.length).toBeGreaterThan(0);
    },
  );
});

describe('PD-40 PR-4: the Designer (plan §7, PD-41)', () => {
  it('is a specialist role holding certificates.view and certificates.design -- and never certificates.deliver', () => {
    expect(designer).toMatchObject({ maxTier: 'specialist' });
    expect([...designer.permissions].sort()).toEqual(['certificates.design', 'certificates.view']);
    expect(designer.permissions).not.toContain('certificates.deliver');
  });

  it("the Teachers manager is who may grant it among the department managers (S1, H5)", () => {
    const grants = (['operations', 'teachers', 'sales'] as const).filter((kind) =>
      designer.permissions.every((k) => legacyBundle('manager', { kind, position: 'manager' }).has(k)),
    );
    expect(grants).toEqual(['teachers']);
  });

  it('everything its keys open is a certificates route, and something is', () => {
    const keys = new Set<string>(designer.permissions);
    const reached = collectRoutes()
      .filter((r) => r.access?.kind === 'requires' && r.access.anyOf.some((k) => keys.has(k)))
      .map((r) => `${r.method} ${r.path}`);
    expect(reached.length).toBeGreaterThan(0);
    expect(reached.filter((r) => !/^[A-Z]+ \/(learner-)?certificates(\/|$)/.test(r))).toEqual([]);
  });
});
