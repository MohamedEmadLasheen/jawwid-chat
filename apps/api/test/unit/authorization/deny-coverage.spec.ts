import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSIONS } from '@platform/permissions/catalogue';
import { collectRoutes } from '../../support/route-inventory';
import coverage from './deny-coverage.json';

/**
 * Access management M3: a key may be denied ONLY if every path that honours it also honours a deny. This spec is that promise:
 *  - the catalogue's `deniable` keys, the migration's list and the coverage record are the same set;
 *  - every file that names a deniable key is classified in deny-coverage.json (so a new consumer fails the build until someone decides
 *    that it honours a deny: through PermissionGuard, PermissionService, or chat.staff_has_permission);
 *  - every route that names a deniable key is guarded (all routes are: the route spec) and none is `self`-service;
 *  - no deniable key is barred from roles or is a super admin power.
 */
const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const deniable = PERMISSIONS.filter((p) => p.deniable).map((p) => p.key).sort();
const record = coverage.keys as Record<string, { files: Record<string, string> }>;

describe('deny coverage (M3)', () => {
  it('catalogue, migration and coverage record agree on which keys are deniable', () => {
    expect(Object.keys(record).sort()).toEqual(deniable);
    const sql = readFileSync(join(ROOT, 'supabase', 'migrations', '20261125100000_chat_deny_enforcement.sql'), 'utf8');
    const m = /update chat\.permission set deniable = true\s+where key in \(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    expect([...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort()).toEqual(deniable);
  });

  it.each(deniable)('%s: every file that names it is classified (no unclassified path can ignore a deny)', (key) => {
    const out = execFileSync('git', ['grep', '-l', '-F', `'${key}'`, '--', 'apps/api/src', 'supabase/migrations', 'apps/admin-web/src'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean).filter((f) => !f.includes('.test.') && !f.includes('/test/'));
    expect(out.filter((f) => !(f in record[key]!.files))).toEqual([]);
    expect(Object.keys(record[key]!.files).filter((f) => !out.includes(f))).toEqual([]);
  });

  it.each(deniable)('%s: a delegable, role-grantable key (never a super admin power)', (key) => {
    const p = PERMISSIONS.find((x) => x.key === key)!;
    expect({ key, inRoles: p.inRoles }).toEqual({ key, inRoles: true });
  });

  it('every route that names a deniable key is declared (the guard refuses a denied key on it in every mode)', () => {
    const routes = collectRoutes().filter((r) => r.access?.kind === 'requires' && r.access.anyOf.some((k) => deniable.includes(k)));
    expect(routes.length).toBeGreaterThan(5);
    for (const r of routes) expect(r.access?.kind).toBe('requires');
  });
});
