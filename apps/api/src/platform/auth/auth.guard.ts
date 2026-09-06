import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';

export const PUBLIC_ROUTE = 'jawwid:public-route';

/** Marks a route reachable without a session. Login, refresh and health only. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

/**
 * The global authentication gate (D-6). Owner: AI #1's domain, implemented by
 * AI #7.
 *
 * Registered as an APP_GUARD, so a route is protected by default and must opt
 * OUT with @Public(). The opposite arrangement -- protect by opting in -- means
 * every new controller is unauthenticated until someone remembers, and nobody
 * remembers forever.
 *
 * `x-actor-id` is gone. It is never read, and a request carrying it gets
 * exactly the same treatment as one that does not: identity comes from the
 * signed token or the request is refused.
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

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      actor?: unknown;
      sessionId?: string;
    }>();

    const header = request.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    const token = raw?.startsWith('Bearer ') ? raw.slice(7).trim() : '';
    if (!token) {
      throw new UnauthorizedException({
        error: { code: 'AUTH.MISSING_TOKEN', message: 'authentication required' },
      });
    }

    const authenticated = await this.auth.authenticate(token);
    if (!authenticated) {
      throw new UnauthorizedException({
        error: { code: 'AUTH.INVALID_TOKEN', message: 'session is not valid' },
      });
    }

    // The ONLY place an actor is attached to a request.
    request.actor = authenticated.actor;
    request.sessionId = authenticated.claims.sid;
    return true;
  }
}
