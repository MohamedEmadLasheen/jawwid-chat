import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { CommError, CommErrorCode } from './errors';
import type { Actor } from './types';

/**
 * The restricted runtime path: request work on `chat_app`, inside a trusted,
 * transaction-local actor context (RLS-STRATEGY §3, `withActor`).
 *
 * ## Where the identity comes from
 *
 * Never from the request. The guard has already verified the bearer token and
 * resolved account -> principal on the server-side connection; the staff row's
 * `account_id` IS that authenticated account (IdentityService.resolveForAccount
 * found the staff member by it). So the subject is read here, server side, from
 * `actor.actorId` -- a value only the guard writes -- and handed to Postgres with
 * `set_config(..., is_local => true)`. `chat.actor_staff_id` (a raw-id fallback
 * in chat.current_staff_id) is never set.
 *
 * ## Why it cannot leak between requests
 *
 * Every setting is transaction-local: Postgres discards it at COMMIT or
 * ROLLBACK, so a pooled connection returns to the pool with no identity, and a
 * statement outside `withActor` runs as nobody (RLS then shows nothing). There
 * is no session-level `SET`, no `SET ROLE`, and no settings cache.
 *
 * ## Fail closed
 *
 * Inside the transaction, before `fn` runs, Postgres must confirm that the
 * connection is a request role (not the owner, not BYPASSRLS) and that
 * `chat.current_staff_id()` resolves to exactly this actor. Anything else --
 * wrong DATABASE_APP_URL, an inactive account, a missing login -- is refused
 * rather than run with the wrong identity or none.
 *
 * Enabled only when DATABASE_APP_URL is set; read nowhere else in apps/api/src.
 */
@Injectable()
export class ActorScopedDatabase implements OnModuleDestroy {
  private readonly log = new Logger(ActorScopedDatabase.name);
  private readonly client: PrismaClient | null;

  constructor(
    private readonly owner: PrismaService,
    url: string | null | undefined = process.env.DATABASE_APP_URL,
  ) {
    this.client = url ? new PrismaClient({ datasourceUrl: url }) : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async withActor<T>(
    actor: Actor,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options: { timeout?: number } = {},
  ): Promise<T> {
    if (!this.client) throw new Error('the restricted runtime role is not configured (DATABASE_APP_URL)');
    if (actor.kind !== 'staff' || !actor.organizationId || !actor.isActive) {
      throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'no active staff actor for a scoped transaction', 403);
    }

    // Server side: the authenticated account's subject, from the trusted actor id.
    const [identity] = await this.owner.$queryRaw<Array<{ subject: string }>>`
      select a.subject
        from chat.staff s
        join chat.account a on a.id = s.account_id
       where s.id = ${actor.actorId}::uuid
         and s.organization_id = ${actor.organizationId}::uuid
         and s.is_active and s.left_at is null
         and a.is_active and a.status = 'active'`;
    if (!identity) {
      throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'the actor has no active login to scope a transaction to', 403);
    }

    return this.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`select set_config('chat.actor_subject', ${identity.subject}, true),
                                    set_config('chat.actor_organization', ${actor.organizationId}, true)`;
        const [ctx] = await tx.$queryRaw<Array<{ server_side: boolean; bypass: boolean; staff: string | null }>>`
          select chat.caller_is_server_side() as server_side,
                 (select rolbypassrls from pg_roles where rolname = current_user) as bypass,
                 chat.current_staff_id()::text as staff`;
        if (!ctx || ctx.server_side || ctx.bypass || ctx.staff !== actor.actorId) {
          this.log.error('refusing a scoped transaction: the connection is not the restricted role or the identity did not resolve');
          throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'the actor context could not be established', 403);
        }
        return fn(tx);
      },
      { timeout: options.timeout ?? 15_000 },
    );
  }

  /** For tests and diagnostics: the identity a connection has OUTSIDE any scoped transaction. */
  async ambientIdentity(): Promise<{ subject: string | null; organization: string | null; staff: string | null; pid: number }> {
    if (!this.client) throw new Error('the restricted runtime role is not configured');
    const [row] = await this.client.$queryRaw<Array<{ subject: string | null; organization: string | null; staff: string | null; pid: number }>>`
      select nullif(current_setting('chat.actor_subject', true), '') as subject,
             nullif(current_setting('chat.actor_organization', true), '') as organization,
             chat.current_staff_id()::text as staff,
             pg_backend_pid() as pid`;
    return row;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
