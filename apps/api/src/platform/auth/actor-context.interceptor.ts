import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, firstValueFrom, from } from 'rxjs';
import { PrismaService } from '../prisma.service';
import type { Actor } from '../types';

/**
 * Runs every authenticated request inside its actor's database context.
 *
 * This is the piece that turns row-level security from a set of policies into a
 * control. The policies resolve the caller through session settings; this
 * establishes them, per request, transaction-locally, on a connection that
 * cannot bypass RLS.
 *
 * ORDER MATTERS. It is registered as an APP_INTERCEPTOR, which Nest runs AFTER
 * guards -- so `request.actor` is already the verified identity by the time it
 * is read here. An unauthenticated (public) route has no actor and simply runs
 * outside a context, which is why login can read `chat.account` before there is
 * an organization to scope to.
 *
 * A request that opens a transaction for its whole duration is a real cost: it
 * holds one pooled connection until the response is produced. That is bounded
 * by DATABASE_TRANSACTION_TIMEOUT_MS, and it buys atomicity as well as RLS --
 * a request that fails half way no longer leaves the writes it had already made.
 */
@Injectable()
export class ActorContextInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<{ actor?: Actor; subject?: string }>();
    const actor = request.actor;
    if (!actor) return next.handle();

    return from(
      this.prisma.runWithActor(actor, request.subject ?? null, () =>
        firstValueFrom(next.handle()),
      ),
    );
  }
}
