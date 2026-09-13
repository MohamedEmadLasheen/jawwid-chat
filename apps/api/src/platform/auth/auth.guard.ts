import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthError, AuthErrorCode } from './auth.errors';
import type { Actor } from '../types';

export const PUBLIC_ROUTE = 'jawwid:public-route';

/** Marks a route reachable without a session. Login and refresh only. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

/** What the guard attaches. The ONLY source of request identity. */
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  actor?: Actor;
  accountId?: string;
  sessionId?: string;
}

/**
 * The global authentication gate (PR-B).
 *
 * Registered as an APP_GUARD, so a route is protected BY DEFAULT and must opt
 * out with `@Public()`. The opposite arrangement -- protect by opting in --
 * leaves every new controller unauthenticated until someone remembers, and
 * that is exactly how API-CONTRACT §5 S-2 happened (three routes with no actor
 * check at all: student-group sync, device unregister, delivery receipts).
 * Those three are now covered without being touched, because the default
 * changed.
 *
 * `x-actor-id` IS NOT READ HERE, and a request carrying it gets exactly the
 * same treatment as one that does not (AUTH-INV-1). Identity comes from the
 * signed token or the request is refused with 401 -- never 500, never a
 * default actor (AUTH-INV-2).
 */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket identity is NOT handled here. The gateway still resolves its
    // own actor from the handshake, and platform/identity-seam.ts keeps a build
    // in that state from starting outside a local environment. Returning true
    // for a non-HTTP context does not open the socket: it leaves it exactly as
    // contained as it was.
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers['authorization']);
    if (!token) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);

    const authenticated = await this.auth.authenticate(token);
    if (!authenticated) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);

    // The ONLY place an actor is attached to a request.
    request.actor = authenticated.actor;
    request.accountId = authenticated.accountId;
    request.sessionId = authenticated.sessionId;

    void this.auth.touchSession(authenticated.sessionId);
    return true;
  }
}

/**
 * Extracts the credential from an `Authorization` header.
 *
 * Strict on purpose: the scheme must be exactly `Bearer` followed by a single
 * space and a non-empty token. A lenient parser that accepts `bearer`,
 * `Bearer  x`, or a duplicated header is a place where two parsers can
 * disagree about what the credential is.
 */
export function bearerToken(header: string | string[] | undefined): string | null {
  // A duplicated Authorization header is refused rather than resolved: which
  // one wins is the kind of ambiguity a proxy and an app can answer differently.
  if (Array.isArray(header)) return null;
  if (typeof header !== 'string') return null;

  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return null;

  const token = header.slice(prefix.length);
  if (token.length === 0 || token !== token.trim()) return null;
  return token;
}
