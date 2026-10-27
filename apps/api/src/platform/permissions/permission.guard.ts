import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_ROUTE, type AuthenticatedRequest } from '../auth/auth.guard';
import { CommError, CommErrorCode } from '../errors';
import { ActorKind } from '../../communication/contracts/vocab';
import { ROUTE_ACCESS, describeRouteAccess, type RouteAccess } from './route-access';
import { LEGACY_TIERS, PermissionService } from './permission.service';

/**
 * PD-40 rollout switch. `shadow`: a legacy-tier staff member whose request the
 * guard would refuse is LET THROUGH and counted, so the bundles can be checked
 * against real traffic before anything is refused. `enforce`: refused.
 *
 * A constant, not an environment variable, on purpose: switching to
 * enforcement is one reviewed line (PD-40 PR-6), never a console edit. Two
 * refusals hold in either mode -- a route that declares nothing, and an
 * account outside the legacy tiers (a `specialist`), which has no bundle to
 * shadow: its permissions are exactly its granted roles.
 */
export const PERMISSION_GUARD_MODE: 'shadow' | 'enforce' = 'shadow';

export interface ShadowDenial {
  method: string;
  route: string;
  tier: string;
  needs: string;
}

/**
 * Would-be refusals seen in shadow mode, by `METHOD route tier`. Read by the
 * spec and logged at warn on every occurrence, so the system-test stack's
 * logs are the evidence that enforcing refuses nothing legitimate.
 */
export const shadowDenials = new Map<string, number>();

type GuardedRequest = AuthenticatedRequest & {
  method?: string;
  route?: { path?: string };
  /** Resolved once per request, for anything downstream that asks. */
  permissions?: ReadonlySet<string>;
};

/**
 * PD-40 layer 1: the page and action gate, directly after AuthenticatedGuard.
 *
 * It answers one question -- does this STAFF caller hold a key the route
 * declares? -- and nothing else. Department, scope, state and every other rule
 * stay in the services, so this layer can only ever narrow access. Parents,
 * teachers and support sessions pass it on every declared route.
 *
 * Deny by default: a route that declares nothing is refused to staff even in
 * shadow mode, and the route spec fails the build first.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly log = new Logger('PermissionGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly access: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;

    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const actor = request.actor;
    // AuthenticatedGuard runs first and refuses a request without one.
    if (!actor || actor.kind !== ActorKind.STAFF) return true;

    const access = this.reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, targets);
    const route = `${request.method ?? '?'} ${request.route?.path ?? '?'}`;
    if (!access) {
      this.log.error(`UNDECLARED_ROUTE ${route}: refused to staff (PD-40: every route declares its permission)`);
      throw new CommError(CommErrorCode.PERMISSION_DENIED, 'this route declares no permission');
    }
    if (access.kind === 'self') return true;

    const profile = await this.access.profileOf(actor);
    request.permissions = profile.permissions;
    const allowed = access.kind === 'requires' && access.anyOf.some((key) => profile.permissions.has(key));
    if (allowed) return true;

    const tier = profile.tier ?? 'none';
    if (PERMISSION_GUARD_MODE === 'shadow' && LEGACY_TIERS.has(tier)) {
      const needs = describeRouteAccess(access);
      const key = `${route} ${tier}`;
      shadowDenials.set(key, (shadowDenials.get(key) ?? 0) + 1);
      this.log.warn(`SHADOW_DENIED ${route} tier=${tier} role=${actor.staffRole} needs=${needs}`);
      return true;
    }
    throw new CommError(CommErrorCode.PERMISSION_DENIED, `this account may not use ${route}`);
  }
}
