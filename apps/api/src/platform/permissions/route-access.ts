import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from './catalogue';

/**
 * PD-40: what a route asks of a STAFF caller. Every handler declares exactly
 * one of these, or is `@Public()` (auth.guard.ts); the route spec
 * (pd040-route-permissions.spec.ts) fails on a handler that declares none, and
 * PermissionGuard refuses a staff caller on one at runtime.
 *
 *   @Requires(...keys)  staff need at least one of the keys
 *   @SelfService()      any signed-in principal, about themself: their own
 *                       session, profile, notifications, devices, or an
 *                       advisory "what may I offer" probe
 *   @NotForStaff()      a parent's or a teacher's own surface; staff are refused
 *
 * Only STAFF callers are checked. A parent, a teacher or a support session
 * passes this layer on any declared route and is decided by the service
 * exactly as before: the catalogue is the staff permission system.
 */
export const ROUTE_ACCESS = 'jawwid:route-access';

export type RouteAccess =
  | { kind: 'requires'; anyOf: readonly PermissionKey[] }
  | { kind: 'self' }
  | { kind: 'not_for_staff' };

export function Requires(...anyOf: [PermissionKey, ...PermissionKey[]]): MethodDecorator & ClassDecorator {
  return SetMetadata(ROUTE_ACCESS, Object.freeze({ kind: 'requires', anyOf: Object.freeze([...anyOf]) }) satisfies RouteAccess);
}

export function SelfService(): MethodDecorator & ClassDecorator {
  return SetMetadata(ROUTE_ACCESS, Object.freeze({ kind: 'self' }) satisfies RouteAccess);
}

export function NotForStaff(): MethodDecorator & ClassDecorator {
  return SetMetadata(ROUTE_ACCESS, Object.freeze({ kind: 'not_for_staff' }) satisfies RouteAccess);
}

/** A short form for the generated route table and the logs. */
export function describeRouteAccess(access: RouteAccess | undefined): string {
  if (!access) return 'UNDECLARED';
  if (access.kind === 'self') return 'self-service';
  if (access.kind === 'not_for_staff') return 'not for staff';
  return access.anyOf.join(' | ');
}
