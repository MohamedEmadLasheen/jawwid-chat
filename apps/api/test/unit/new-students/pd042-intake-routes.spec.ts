/**
 * PD-42 (review of #214, P1): every /family-intake route, and which legacy
 * bundles pass its PD-40 key -- the Layer-1 gate, enforced once the guard
 * leaves shadow. Layer 2 (FamilyIntakeService, the database) narrows it again:
 * e.g. org.manage lets the Teachers manager reach the route, and the service
 * answers INTAKE_DENIED (pd042-ops-side-api.spec.ts).
 */
import 'reflect-metadata';
import { FamilyIntakeController } from '../../../src/new-students/intake.controller';
import { ROUTE_ACCESS, type RouteAccess } from '../../../src/platform/permissions/route-access';
import { legacyBundle, legacyBundleNames, type StaffPlacement } from '../../../src/platform/permissions/legacy-bundles';

function bundle(name: string): ReadonlySet<string> {
  if (name === 'super_admin') return legacyBundle('super_admin', { kind: null, position: null });
  const [tier, kind] = name.split(':') as ['manager' | 'supervisor' | 'legacy_department', string];
  const placement: StaffPlacement = {
    kind: kind === 'none' ? null : (kind as StaffPlacement['kind']),
    position: tier === 'manager' ? 'manager' : tier === 'supervisor' ? 'member' : null,
  };
  return legacyBundle(tier === 'legacy_department' ? null : tier, placement);
}

function passes(handler: keyof FamilyIntakeController): string[] {
  const fn = FamilyIntakeController.prototype[handler] as unknown as object;
  const access = Reflect.getMetadata(ROUTE_ACCESS, fn) as RouteAccess | undefined;
  if (!access || access.kind !== 'requires') throw new Error(`${String(handler)}: no @Requires`);
  return legacyBundleNames().filter((b) => access.anyOf.some((k) => bundle(b).has(k))).sort();
}

const ENTRANTS = ['manager:operations', 'manager:sales', 'super_admin', 'supervisor:operations', 'supervisor:sales'];
const MANAGERS = ['manager:operations', 'manager:sales', 'manager:teachers', 'super_admin'];

describe('/family-intake: who passes each route\'s key', () => {
  it.each([
    ['options', ENTRANTS],
    ['entered', ENTRANTS],
    ['family', ENTRANTS],
    ['enter', ENTRANTS],
    ['addChildren', ENTRANTS],
    ['setSignInEmail', ENTRANTS],
    ['suggestSupervisor', ENTRANTS],
    // The Operations manager places a waiting family; the Sales manager changes a Sales owner (plan §8, org.manage).
    ['assignOperationsSupervisor', MANAGERS],
    ['changeSalesOwner', MANAGERS],
    ['carriedOverOf', ENTRANTS],
    ['carryOver', ENTRANTS],
    ['voidCarryOver', ENTRANTS],
  ] as Array<[keyof FamilyIntakeController, string[]]>)('%s', (handler, expected) => {
    expect(passes(handler)).toEqual([...expected].sort());
  });

  it('the Sales manager passes the Sales owner change; the Operations manager passes placing a family', () => {
    expect(passes('changeSalesOwner')).toContain('manager:sales');
    expect(passes('assignOperationsSupervisor')).toContain('manager:operations');
  });

  it('every handler is in the table above', () => {
    const handlers = Object.getOwnPropertyNames(FamilyIntakeController.prototype).filter((n) => n !== 'constructor').sort();
    expect(handlers).toEqual([
      'addChildren', 'assignOperationsSupervisor', 'carriedOverOf', 'carryOver', 'changeSalesOwner', 'enter', 'entered',
      'family', 'options', 'setSignInEmail', 'suggestSupervisor', 'voidCarryOver',
    ]);
  });
});
