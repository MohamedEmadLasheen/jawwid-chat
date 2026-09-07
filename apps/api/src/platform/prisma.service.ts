import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Actor } from './types';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run a unit of work with the caller's identity visible to PostgreSQL, so
   * row-level security applies to it.
   *
   * The policies in supabase/migrations resolve the caller through
   * chat.current_subject() / chat.current_organization_id(), which read session
   * settings. Nothing set them before Phase 1, which is the whole reason RLS was
   * inert: the policies were correct and simply never had a caller to match.
   *
   * Three properties matter here:
   *
   *  1. `set_config(..., true)` makes the settings TRANSACTION-LOCAL. That is
   *     what makes this safe behind a connection pool -- the settings cannot
   *     leak into the next request that borrows the connection, and they cannot
   *     vanish mid-statement.
   *  2. It must be an INTERACTIVE transaction. A raw query outside one has no
   *     transaction for the settings to be local to.
   *  3. RLS is defence in depth, never the decision. AuthorizationService has
   *     already decided by the time this runs; the database's job is to make a
   *     missing `where` return nothing instead of everything.
   *
   * An unexpectedly empty result on a write path is therefore an authorization
   * failure, not "nothing to do" -- callers must treat it as such.
   */
  async withActor<T>(
    actor: Pick<Actor, 'actorId' | 'kind' | 'accountId' | 'organizationId'>,
    subject: string | null,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('chat.actor_subject', ${subject ?? ''}, true)`;
      await tx.$executeRaw`select set_config('chat.actor_kind', ${actor.kind}, true)`;
      await tx.$executeRaw`select set_config('chat.actor_id', ${actor.actorId}, true)`;
      await tx.$executeRaw`select set_config('chat.actor_organization', ${
        actor.organizationId ?? ''
      }, true)`;
      return work(tx);
    });
  }
}
