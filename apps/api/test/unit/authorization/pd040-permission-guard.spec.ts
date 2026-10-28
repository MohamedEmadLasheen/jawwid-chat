/**
 * PD-40: PermissionGuard, the page and action gate.
 *
 * Checked on real route metadata (the decorators on a test controller) with a
 * stubbed chat.staff_access_profile -- answered here from the TypeScript
 * bundles, which pd040-catalogue-seed.spec.ts pins to the SQL ones:
 *   - only staff are checked; parents, teachers and public routes pass;
 *   - a route that declares nothing is refused to staff, in shadow mode too;
 *   - self-service passes without a lookup; a held key passes;
 *   - in shadow mode a legacy-tier account lacking the key is let through and
 *     counted; an account outside the legacy tiers is refused anyway.
 *
 * Pure: no database, no Nest application.
 */
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffRole } from '@communication/contracts/vocab';
import { Public } from '@platform/auth/auth.guard';
import { CommError, CommErrorCode } from '@platform/errors';
import { NotForStaff, Requires, SelfService } from '@platform/permissions/route-access';
import { PERMISSION_GUARD_MODE, PermissionGuard, shadowDenials } from '@platform/permissions/permission.guard';
import { NO_ACCESS, type AccessProfile, type PermissionService } from '@platform/permissions/permission.service';
import { legacyTierOf, permissionsOf, type StaffPlacement } from '@platform/permissions/legacy-bundles';
import type { Actor } from '@platform/types';
import { admin, parent, teacher } from '../../support/fixtures';

class Routes {
  @Requires('certificates.view')
  certificates() {}
  @Requires('billing.record', 'billing.verify')
  payments() {}
  @SelfService()
  me() {}
  @NotForStaff()
  teacherOwn() {}
  undeclared() {}
  @Public()
  login() {}
}

@Public()
class PublicRoutes {
  media() {}
}

function context(actor: Actor | undefined, handler: keyof Routes | 'media', cls: object = Routes): ExecutionContext {
  const request = { actor, method: 'GET', route: { path: `/test/${handler}` } };
  const target = cls === PublicRoutes ? PublicRoutes.prototype.media : (Routes.prototype as unknown as Record<string, () => void>)[handler];
  return {
    getType: () => 'http',
    getHandler: () => target,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/**
 * chat.staff_access_profile for an actor placed in `rows[0]` (or nowhere), with
 * `granted` keys from access roles. Counts its calls.
 */
function departments(rows: Array<{ kind: string; position: string }>, granted: string[] = []) {
  const calls = { n: 0 };
  const placement: StaffPlacement = rows[0]
    ? { kind: rows[0].kind as StaffPlacement['kind'], position: rows[0].position as StaffPlacement['position'] }
    : { kind: null, position: null };
  const prisma = {
    profileOf: async (actor: Actor): Promise<AccessProfile> => {
      calls.n++;
      if (actor.kind !== 'staff') return NO_ACCESS;
      const tier = actor.staffRole === 'specialist' ? 'specialist' : legacyTierOf(actor.staffRole);
      return {
        tier,
        departmentKind: placement.kind,
        placement: placement.position,
        permissions: new Set([...permissionsOf(actor, placement), ...granted]),
      };
    },
  } as unknown as PermissionService;
  return { prisma, calls };
}

const TEACHERS_MEMBER = [{ kind: 'teachers', position: 'member' }];

async function refusal(p: Promise<boolean>): Promise<string> {
  try {
    await p;
    return 'allowed';
  } catch (e) {
    return e instanceof CommError ? e.code : String(e);
  }
}

beforeEach(() => shadowDenials.clear());

describe('PD-40: PermissionGuard', () => {
  it('runs in shadow mode until PD-40 PR-6 switches it', () => {
    expect(PERMISSION_GUARD_MODE).toBe('shadow');
  });

  it('passes public routes, on the handler or the class, without looking at the actor', async () => {
    const { prisma, calls } = departments([]);
    const guard = new PermissionGuard(new Reflector(), prisma);
    expect(await guard.canActivate(context(undefined, 'login'))).toBe(true);
    expect(await guard.canActivate(context(undefined, 'media', PublicRoutes))).toBe(true);
    expect(calls.n).toBe(0);
  });

  it('checks only staff: a parent and a teacher pass every declared route and are left to the service', async () => {
    const { prisma, calls } = departments([]);
    const guard = new PermissionGuard(new Reflector(), prisma);
    for (const actor of [parent(), teacher()]) {
      for (const route of ['certificates', 'payments', 'teacherOwn', 'me'] as const) {
        expect(await guard.canActivate(context(actor, route))).toBe(true);
      }
    }
    expect(calls.n).toBe(0);
  });

  it('refuses staff a route that declares nothing -- in shadow mode too, the super admin included', async () => {
    const guard = new PermissionGuard(new Reflector(), departments([]).prisma);
    for (const actor of [admin(), admin('super-1', StaffRole.SUPER_ADMIN)]) {
      expect(await refusal(guard.canActivate(context(actor, 'undeclared')))).toBe(CommErrorCode.PERMISSION_DENIED);
    }
  });

  it('passes self-service without a profile lookup', async () => {
    const { prisma, calls } = departments(TEACHERS_MEMBER);
    const guard = new PermissionGuard(new Reflector(), prisma);
    expect(await guard.canActivate(context(admin(), 'me'))).toBe(true);
    expect(calls.n).toBe(0);
  });

  it('passes a staff member who holds one of the keys, and counts nothing', async () => {
    const guard = new PermissionGuard(new Reflector(), departments(TEACHERS_MEMBER).prisma);
    expect(await guard.canActivate(context(admin(), 'certificates'))).toBe(true);
    const superAdmin = new PermissionGuard(new Reflector(), departments([]).prisma);
    expect(await superAdmin.canActivate(context(admin('super-1', StaffRole.SUPER_ADMIN), 'payments'))).toBe(true);
    expect(shadowDenials.size).toBe(0);
  });

  it('shadow mode: a legacy-tier account without the key is let through and counted', async () => {
    const guard = new PermissionGuard(new Reflector(), departments([]).prisma);
    // An admin with no department holds no certificate key (only the Teachers department does).
    expect(await guard.canActivate(context(admin(), 'certificates'))).toBe(true);
    // A staff member on a teacher's own surface.
    expect(await guard.canActivate(context(admin(), 'teacherOwn'))).toBe(true);
    expect([...shadowDenials.entries()]).toEqual([
      ['GET /test/certificates supervisor', 1],
      ['GET /test/teacherOwn supervisor', 1],
    ]);
  });

  it('an account outside the legacy tiers has no bundle to shadow: refused even in shadow mode', async () => {
    const guard = new PermissionGuard(new Reflector(), departments(TEACHERS_MEMBER).prisma);
    const specialist = admin('designer-1', 'specialist');
    expect(await refusal(guard.canActivate(context(specialist, 'certificates')))).toBe(CommErrorCode.PERMISSION_DENIED);
    expect(await refusal(guard.canActivate(context(specialist, 'teacherOwn')))).toBe(CommErrorCode.PERMISSION_DENIED);
    expect(await guard.canActivate(context(specialist, 'me'))).toBe(true);
    expect(shadowDenials.size).toBe(0);
  });

  it('a specialist reaches exactly what its granted roles hold -- the Designer opens certificates, not payments', async () => {
    const guard = new PermissionGuard(new Reflector(), departments([], ['certificates.view', 'certificates.design']).prisma);
    const designer = admin('designer-1', 'specialist');
    expect(await guard.canActivate(context(designer, 'certificates'))).toBe(true);
    expect(await refusal(guard.canActivate(context(designer, 'payments')))).toBe(CommErrorCode.PERMISSION_DENIED);
    expect(shadowDenials.size).toBe(0);
  });

  it('a granted role adds to a legacy bundle: an Operations supervisor given certificates.view opens them', async () => {
    const guard = new PermissionGuard(new Reflector(), departments([{ kind: 'operations', position: 'member' }], ['certificates.view']).prisma);
    expect(await guard.canActivate(context(admin(), 'certificates'))).toBe(true);
    expect(shadowDenials.size).toBe(0);
  });

  it('a stale department row does not lend its keys to a role that cannot hold them', async () => {
    const guard = new PermissionGuard(new Reflector(), departments([{ kind: 'teachers', position: 'manager' }]).prisma);
    // An admin listed as the Teachers manager: no department at all, so no certificate key.
    await guard.canActivate(context(admin(), 'certificates'));
    expect([...shadowDenials.keys()]).toEqual(['GET /test/certificates supervisor']);
  });

  it('leaves WebSocket contexts to the gateway', async () => {
    const guard = new PermissionGuard(new Reflector(), departments([]).prisma);
    expect(await guard.canActivate({ getType: () => 'ws' } as unknown as ExecutionContext)).toBe(true);
  });
});
