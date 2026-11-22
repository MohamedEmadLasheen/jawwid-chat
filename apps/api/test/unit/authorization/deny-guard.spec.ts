/**
 * Access management M3: PermissionGuard and a DENY. A deny is not shadowed: when a key the route accepts is denied, the request is
 * refused in every mode and for every tier (the legacy-tier shadow behaviour is for accounts that LACK a key, never for a restriction).
 * With nothing denied the guard behaves exactly as before (production today: deny enforcement is off, so `denied` is always empty).
 */
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffRole } from '@communication/contracts/vocab';
import { CommError, CommErrorCode } from '@platform/errors';
import { Requires } from '@platform/permissions/route-access';
import { PermissionGuard, shadowDenials } from '@platform/permissions/permission.guard';
import type { AccessProfile, PermissionService } from '@platform/permissions/permission.service';
import type { Actor } from '@platform/types';
import { admin } from '../../support/fixtures';

class Routes {
  @Requires('materials.review')
  review() {}
  @Requires('materials.author', 'materials.review')
  either() {}
}

const ctx = (actor: Actor, handler: keyof Routes): ExecutionContext =>
  ({
    getType: () => 'http',
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ actor, method: 'POST', route: { path: `/t/${handler}` } }) }),
  }) as unknown as ExecutionContext;

const guardFor = (profile: Partial<AccessProfile>) =>
  new PermissionGuard(new Reflector(), {
    profileOf: async () => ({ tier: 'supervisor', departmentKind: 'teachers', placement: 'member', permissions: new Set<string>(), denied: new Set<string>(), ...profile }),
  } as unknown as PermissionService);

async function outcome(p: Promise<boolean>): Promise<string> {
  try {
    await p;
    return 'allowed';
  } catch (e) {
    return e instanceof CommError ? e.code : String(e);
  }
}

beforeEach(() => shadowDenials.clear());

describe('PermissionGuard and denies (M3)', () => {
  it('a denied key is refused for a legacy-tier account that shadow mode would otherwise let through', async () => {
    const guard = guardFor({ tier: 'supervisor', denied: new Set(['materials.review']) });
    expect(await outcome(guard.canActivate(ctx(admin(), 'review')))).toBe(CommErrorCode.PERMISSION_DENIED);
    expect(shadowDenials.size).toBe(0);
  });

  it.each(['manager', 'supervisor', 'legacy_department', 'specialist'])('%s: refused when the route\'s only key is denied', async (tier) => {
    const guard = guardFor({ tier, denied: new Set(['materials.review']) });
    expect(await outcome(guard.canActivate(ctx(admin('x', StaffRole.MANAGER), 'review')))).toBe(CommErrorCode.PERMISSION_DENIED);
  });

  it('a route with several keys is still open through a key that is not denied', async () => {
    const guard = guardFor({ permissions: new Set(['materials.author']), denied: new Set(['materials.review']) });
    expect(await outcome(guard.canActivate(ctx(admin(), 'either')))).toBe('allowed');
  });

  it('a route whose keys are ALL denied or lacking is refused when one of them is denied', async () => {
    const guard = guardFor({ permissions: new Set<string>(), denied: new Set(['materials.author']) });
    expect(await outcome(guard.canActivate(ctx(admin(), 'either')))).toBe(CommErrorCode.PERMISSION_DENIED);
  });

  it('with nothing denied the guard is exactly as before: a legacy-tier account lacking the key is still shadowed through', async () => {
    const guard = guardFor({ tier: 'supervisor', denied: new Set<string>() });
    expect(await outcome(guard.canActivate(ctx(admin(), 'review')))).toBe('allowed');
    expect(shadowDenials.size).toBe(1);
  });

  it('a held, undenied key passes', async () => {
    const guard = guardFor({ permissions: new Set(['materials.review']) });
    expect(await outcome(guard.canActivate(ctx(admin(), 'review')))).toBe('allowed');
  });
});
