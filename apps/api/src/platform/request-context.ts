import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, type NestMiddleware } from '@nestjs/common';

/**
 * PD-21: what the rest of a request needs to know about HOW it was
 * authenticated, without threading it through every signature.
 *
 * One fact today: the support session (impersonation) the request runs in, if
 * any. AuthenticatedGuard writes it; PrismaAuditService stamps it on every
 * audit row, and MessageService on every message, so an action an
 * administrator took as a parent or teacher is never mistaken for theirs.
 *
 * The store is created per HTTP request by RequestContextMiddleware, which
 * runs before the guards, and is MUTATED by the guard -- run() must wrap the
 * whole request, and a guard's own async frame cannot carry a new store to the
 * handler. Outside a request (workers, CLIs, sockets) there is no store, and
 * nothing is stamped.
 */
export interface RequestContext {
  impersonationId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The support session this request runs in, or null. */
export function currentImpersonationId(): string | null {
  return storage.getStore()?.impersonationId ?? null;
}

/** For tests and non-HTTP entry points that need a scope of their own. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(_req: unknown, _res: unknown, next: (error?: unknown) => void): void {
    storage.run({}, () => next());
  }
}
