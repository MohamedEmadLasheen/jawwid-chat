/**
 * PD-40: scripts/ops/pd040-enforce-readiness.sql is run by the operator against
 * production, so it must stay what its header promises -- read-only, no names --
 * and must place staff the way the API does (legacyTierOf, legacy-bundles.ts;
 * chat.staff_tier in SQL). No database: the file is read and checked as text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legacyTierOf } from '@platform/permissions/legacy-bundles';

const FILE = join(__dirname, '..', '..', '..', '..', '..', 'scripts', 'ops', 'pd040-enforce-readiness.sql');
const sql = readFileSync(FILE, 'utf8');
/** The statements, comments stripped. */
const code = sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

describe('PD-40: the enforce-readiness audit is safe to hand to an operator', () => {
  it('is one read-only transaction that ends in ROLLBACK', () => {
    const statements = code.split(';').map((s) => s.trim().toLowerCase()).filter(Boolean);
    expect(statements[0]).toBe('begin transaction read only');
    expect(statements[statements.length - 1]).toBe('rollback');
    expect(statements.slice(1, -1).every((s) => s.startsWith('with') || s.startsWith('select'))).toBe(true);
  });

  it('writes nothing and calls no function that could', () => {
    expect(code).not.toMatch(/\b(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|copy|call|do|commit|set_config|nextval)\b/i);
  });

  it('never selects a name, an e-mail or another personal field', () => {
    expect(code).not.toMatch(/\.(name|subject|display_name|email|phone)\b/i);
    expect(code).not.toMatch(/chat\.(account|contact|account_credential|parent_file)\b/i);
  });

  it("maps every staff role to the tier the API gives it (legacyTierOf; chat.staff_tier)", () => {
    const pairs = [...code.matchAll(/when '([a-z_]+)'\s+then '([a-z_]+)'/g)].map((m) => [m[1]!, m[2]!] as const);
    const roles = ['super_admin', 'manager', 'admin', 'coverage', 'finance', 'technical', 'academic', 'specialist'];
    expect(pairs.map(([role]) => role).sort()).toEqual([...roles].sort());
    for (const [role, tier] of pairs) {
      const api = role === 'specialist' ? 'specialist' : legacyTierOf(role);
      expect({ role, tier }).toEqual({ role, tier: api });
    }
  });
});
