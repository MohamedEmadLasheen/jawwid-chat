import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import audit from './department-kind-audit.json';

/**
 * Access management M2: the department-kind audit as a regression guard. Every live SQL function that reads a department
 * table (chat.department, department_member, department_account) or names a department kind must be classified in
 * department-kind-audit.json. A new such function fails the build until someone has decided how it treats a configurable
 * department (kind 'general'): core-only, by id, by design, or fixed. Nothing here changes behaviour; it makes the audit permanent.
 */
const MIGRATIONS = join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations');
const READS = /chat\.department\b|department_member|department_account|d\.kind|department_kind/;

function liveFunctions(): Map<string, string> {
  const latest = new Map<string, string>();
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    for (const m of sql.matchAll(/create (?:or replace )?function chat\.(\w+)\([\s\S]*?\n\$\$;/gi)) latest.set(m[1]!, m[0]);
    for (const m of sql.matchAll(/drop function (?:if exists )?chat\.(\w+)/gi)) latest.delete(m[1]!);
  }
  return latest;
}

describe('department-kind audit registry (M2)', () => {
  const live = liveFunctions();
  const readers = [...live].filter(([, body]) => READS.test(body)).map(([name]) => name).sort();
  const registry = audit.functions as Record<string, string>;

  it('every live function that reads departments is classified', () => {
    expect(readers.filter((n) => !(n in registry))).toEqual([]);
  });

  it('no classified function is gone or no longer reads departments (the registry stays true)', () => {
    expect(Object.keys(registry).filter((n) => !readers.includes(n))).toEqual([]);
  });

  it('every class is a documented one', () => {
    const known = new Set(Object.keys(audit.classes));
    expect(Object.entries(registry).filter(([, c]) => !known.has(c))).toEqual([]);
  });

  it('the corrected rules really carry the core-department guard or compare ids', () => {
    for (const name of Object.entries(registry).filter(([, c]) => c === 'fixed_m2').map(([n]) => n)) {
      expect({ name, guarded: /is_core_department_kind|staff_department_id/.test(live.get(name)!) }).toEqual({ name, guarded: true });
    }
  });

  it('the legacy bundle has no row for a configurable department: it starts with no tier-default access', () => {
    const sql = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(join(MIGRATIONS, f), 'utf8')).join('\n');
    expect(/insert into chat\.legacy_permission_bundle[\s\S]{0,4000}'general'/i.test(sql)).toBe(false);
  });
});
