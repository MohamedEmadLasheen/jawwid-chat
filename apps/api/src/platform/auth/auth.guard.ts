import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthError, AuthErrorCode } from './auth.errors';
import type { Actor } from '../types';

export const PUBLIC_ROUTE = 'jawwid:public-route';

/** Marks a route reachable without a session. Login, refresh, reset and health only. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  ip?: string;
  actor?: Actor;
  sessionId?: string;
}

/**
 * The global authentication gate.
 *
 * Registered as an APP_GUARD, so a route is protected BY DEFAULT and must opt
 * out with @Public(). The opposite arrangement -- protect by opting in -- means
 * every new controller is unauthenticated until someone remembers, and nobody
 * remembers forever. Three routes were already in exactly that state before
 * Phase 1 (`student-group/:learnerId/sync`, `DELETE /notifications/devices/:token`,
 * `POST /notifications/:id/delivered`); this shape is why they cannot recur.
 *
 * `x-actor-id` is gone. It is never read, and a request carrying it is treated
 * exactly like one that does not: identity comes from the signed token, or the
 * request is refused.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const header = request.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    const token = raw?.startsWith('Bearer ') ? raw.slice(7).trim() : '';
    if (!token) {
      throw new AuthError(AuthErrorCode.MISSING_TOKEN, 'authentication required');
    }

    const authenticated = await this.auth.authenticate(token);
    if (!authenticated) {
      throw new AuthError(AuthErrorCode.INVALID_TOKEN, 'session is not valid');
    }

    // The ONLY place an actor is attached to a request.
    request.actor = authenticated.actor;
    request.sessionId = authenticated.claims.sid;
    return true;
  }
}
