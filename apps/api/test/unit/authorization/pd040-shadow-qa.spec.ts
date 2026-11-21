/**
 * PD-40: what answers 200 today must still be allowed once PermissionGuard
 * enforces.
 *
 * The fixture is the system-test QA pass in shadow mode at main a547b0e2
 * (2026-10-28): every parameter-free Admin Web GET, per seeded persona, and
 * the ones that answered 200. For each persona and each of those routes, the
 * route's declaration must admit the persona's legacy bundle -- self-service,
 * or a key the bundle holds. A route the service serves today but the bundle
 * would refuse is a break waiting for the enforce flip (PD-40 PR-6): the fix
 * is either the key in the bundle (the access is intended) or a tighter
 * service (it is not), decided route by route in plan §14.
 *
 * Pure: the controllers are imported, nothing boots.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legacyBundle, legacyTierOf, type StaffPlacement } from '@platform/permissions/legacy-bundles';
import { collectRoutes } from '../../support/route-inventory';

interface Persona {
  role: string;
  kind: NonNullable<StaffPlacement['kind']>;
  position: NonNullable<StaffPlacement['position']>;
  get200: string[];
}

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'pd040-systest-200-a547b0e2.json'), 'utf8')) as {
  personas: Record<string, Persona>;
};

const routes = collectRoutes().filter((r) => r.method === 'GET');
const byPath = new Map(routes.map((r) => [r.path, r]));

/**
 * Routes a later owner decision REMOVED from a persona on purpose, so that the a547b0e2 snapshot no longer
 * applies to them (plan section 14: the access was not intended, the bundle is right). Each needs a reason.
 */
const INTENDED_REMOVALS: ReadonlyArray<readonly [persona: string, path: string, why: string]> = [
  ['sales.manager', '/admin/accounts', 'PD-59 (owner 2026-11-21): Sales does not administer family login accounts'],
];
const removed = new Set(INTENDED_REMOVALS.map(([n, p]) => `${n} ${p}`));

const rows = Object.entries(fixture.personas)
  .flatMap(([name, p]) => p.get200.map((path) => [name, path, p] as const))
  .filter(([name, path]) => !removed.has(`${name} ${path.split('?')[0]}`));

describe('PD-40: every route a persona reaches today stays allowed under enforcement', () => {
  it('the fixture covers the five seeded staff personas', () => {
    expect(Object.keys(fixture.personas).sort()).toEqual(['ops.manager', 'sales.manager', 'sup.noura', 'teachers.manager', 'tsup.heba']);
    expect(rows.length).toBeGreaterThan(200);
  });

  it('an intended removal is still a removal: the bundle really refuses the route', () => {
    for (const [name, path] of INTENDED_REMOVALS) {
      const p = fixture.personas[name]!;
      expect(p.get200.map((x) => x.split('?')[0])).toContain(path);
      const access = byPath.get(path)!.access;
      if (access?.kind !== 'requires') throw new Error('not a keyed route');
      const bundle = legacyBundle(legacyTierOf(p.role), { kind: p.kind, position: p.position });
      expect(access.anyOf.some((k) => bundle.has(k))).toBe(false);
    }
  });

  it.each(rows)('%s: GET %s', (_name, path, persona) => {
    const route = byPath.get(path.split('?')[0]!);
    expect({ path, known: route !== undefined }).toEqual({ path, known: true });
    if (!route || route.isPublic) return;
    const access = route.access;
    expect({ path, declared: access !== undefined }).toEqual({ path, declared: true });
    if (!access || access.kind === 'self') return;
    expect({ path, kind: access.kind }).toEqual({ path, kind: 'requires' });
    if (access.kind !== 'requires') return;
    const bundle = legacyBundle(legacyTierOf(persona.role), { kind: persona.kind, position: persona.position });
    expect({ path, needs: access.anyOf, held: access.anyOf.some((k) => bundle.has(k)) }).toEqual({ path, needs: access.anyOf, held: true });
  });
});
