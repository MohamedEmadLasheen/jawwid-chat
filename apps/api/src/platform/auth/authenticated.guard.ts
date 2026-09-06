import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticationService } from './authentication.service';

export const IS_PUBLIC = 'jawwid:public';

/** Marks a route reachable without a token. Only probes should use it. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * The single authentication boundary.
 *
 * Registered as an APP_GUARD, so it runs before every controller. A route is
 * reachable unauthenticated only if it is under /health (the probes main.ts
 * excludes from the API prefix) or is explicitly marked @Public().
 *
 * It sets request.user; it makes no authorization decision. Whether the actor
 * may do the thing remains AuthorizationService's job, unchanged.
 */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  constructor(
    private readonly auth: AuthenticationService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const path: string = request.path ?? request.url ?? '';
    if (path === '/health' || path.startsWith('/health/')) return true;

    const principal = await this.auth.authenticate(request.headers?.authorization);
    if (!principal) {
      throw new UnauthorizedException({
        error: { code: 'AUTH.UNAUTHENTICATED', message: 'a valid access token is required' },
      });
    }

    request.user = principal;
    return true;
  }
}
