/**
 * PD-40: PermissionGuard, the page and action gate.
 *
 * Checked on real route metadata (the decorators on a test controller) with a
 * stubbed department lookup:
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
import type { PrismaService } from '@platform/prisma.service';
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

/** The department lookup: one row, or none. Counts its calls. */
function departments(rows: Array<{ kind: string; position: string }>) {
  const calls = { n: 0 };
  const prisma = { $queryRaw: async () => (calls.n++, rows) } as unknown as PrismaService;
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

  it('passes self-service without a department lookup', async () => {
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
