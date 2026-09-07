import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Actor } from './types';

/** What every query inside one request runs against. */
interface ActorContext {
  readonly tx: Prisma.TransactionClient;
  readonly actorId: string;
}

/**
 * The request-scoped database context.
 *
 * Node's AsyncLocalStorage carries it through the whole async call tree without
 * a single service signature changing -- which matters, because the alternative
 * (threading a `tx` argument through every method of every service) is exactly
 * the refactor of working code this phase was told not to make.
 */
const actorContext = new AsyncLocalStorage<ActorContext>();

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
   * The policies resolve the caller through `chat.current_subject()` and
   * `chat.current_organization_id()`, which read session settings. Nothing set
   * them before Phase 1 -- that, and not the policies, is why RLS was inert.
   *
   * Three properties make this safe:
   *
   *  1. `set_config(..., true)` makes the settings TRANSACTION-LOCAL, so they
   *     cannot leak into the next request that borrows the connection from the
   *     pool, and cannot vanish mid-statement.
   *  2. It is an INTERACTIVE transaction, so the settings have a transaction to
   *     be local to. A raw query outside one has none.
   *  3. The connection running the request is `chat_app`, which is NOBYPASSRLS.
   *     Without that, all of the above is decoration.
   *
   * RLS remains defence in depth: AuthorizationService has already decided by
   * the time this runs. What the database adds is that a missing `where`
   * returns nothing rather than everything -- so an unexpectedly empty result on
   * a write path is an authorization failure, never "nothing to do".
   */
  async runWithActor<T>(
    actor: Pick<Actor, 'actorId' | 'kind' | 'accountId' | 'organizationId'>,
    subject: string | null,
    work: () => Promise<T>,
  ): Promise<T> {
    // Already inside a context (a nested call, or a test that established one):
    // join it rather than opening a second transaction, which Prisma forbids.
    if (actorContext.getStore()) return work();

    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`select set_config('chat.actor_subject', ${subject ?? ''}, true)`;
        await tx.$executeRaw`select set_config('chat.actor_kind', ${actor.kind}, true)`;
        await tx.$executeRaw`select set_config('chat.actor_id', ${actor.actorId}, true)`;
        await tx.$executeRaw`select set_config('chat.actor_organization', ${
          actor.organizationId ?? ''
        }, true)`;
        return actorContext.run({ tx, actorId: actor.actorId }, work);
      },
      {
        // A whole request runs inside this transaction, so the ceiling has to be
        // a request timeout rather than Prisma's 5s default -- and it must stay
        // bounded, because an unbounded one holds a pooled connection for ever.
        timeout: Number(process.env.DATABASE_TRANSACTION_TIMEOUT_MS ?? 15_000),
        maxWait: Number(process.env.DATABASE_TRANSACTION_MAX_WAIT_MS ?? 5_000),
      },
    );
  }

  /** The transaction the current request is running in, if any. */
  static currentTransaction(): Prisma.TransactionClient | null {
    return actorContext.getStore()?.tx ?? null;
  }

  /** True while a request-scoped actor context is established. */
  static hasActorContext(): boolean {
    return actorContext.getStore() !== undefined;
  }
}

/**
 * Wraps PrismaService so that every query a service makes lands on the current
 * request's transaction -- and therefore inside the actor context RLS reads.
 *
 * Services keep calling `this.prisma.message.findMany(...)`. Outside a request
 * (the worker, migrations, a unit test) there is no context and every call goes
 * straight to the real client, so nothing about those paths changes.
 *
 * `$transaction` is FLATTENED rather than forwarded: PostgreSQL has no nested
 * transactions and Prisma refuses to open one, so a service that opens its own
 * transaction inside a request joins the request's instead. That is the
 * behaviour those call sites already want -- an audit row written "in the same
 * transaction as the action it records" is now in the same transaction as the
 * whole request.
 */
export function withRequestScopedTransaction(base: PrismaService): PrismaService {
  const own = (property: string | symbol): unknown => {
    const value = Reflect.get(base, property) as unknown;
    // Always bound to the real client. Prisma's delegates and lifecycle methods
    // use private state, and calling them with the proxy as `this` throws.
    return typeof value === 'function' ? (value as () => unknown).bind(base) : value;
  };

  return new Proxy(base, {
    get(_target, property) {
      const tx = PrismaService.currentTransaction();
      if (!tx) return own(property);

      if (property === '$transaction') {
        return async (arg: unknown) =>
          typeof arg === 'function'
            ? (arg as (client: Prisma.TransactionClient) => unknown)(tx)
            : // The array form is a batch; inside an open transaction the
              // statements are already atomic, so awaiting them is equivalent.
              Promise.all(arg as Promise<unknown>[]);
      }

      // Lifecycle and connection management always belong to the real client.
      if (
        property === '$connect' ||
        property === '$disconnect' ||
        property === 'runWithActor' ||
        property === 'onModuleInit' ||
        property === 'onModuleDestroy'
      ) {
        return own(property);
      }

      if (property in tx) {
        const value = (tx as unknown as Record<string | symbol, unknown>)[property];
        return typeof value === 'function' ? (value as () => unknown).bind(tx) : value;
      }

      return own(property);
    },
  });
}
