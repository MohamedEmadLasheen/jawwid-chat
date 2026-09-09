/**
 * Which database role this PROCESS connects as.
 *
 * The API and the worker run the same image and the same AppModule, so they
 * build the same Prisma client from the same factory -- but they must not
 * connect as the same database role:
 *
 *   API     chat_app      NOBYPASSRLS. Row-level security is one of its two
 *                         authorization layers, and every request runs inside
 *                         an actor context (PrismaService.runWithActor).
 *
 *   worker  chat_service  BYPASSRLS. It acts for the SYSTEM, not for a user:
 *                         it drains the outbox and runs the deadline sweeps,
 *                         and there is no actor whose context it could adopt.
 *
 * THE DEFECT THIS EXISTS TO FIX
 * The worker had no way to say which of the two it was, so it took the
 * schema's `env("DATABASE_URL")` -- chat_app -- and every RLS policy applied to
 * it with an EMPTY actor context. It could still claim outbox rows (that table
 * carries a blanket policy), but every read it needs in order to ROUTE what it
 * claimed returned nothing: the message was invisible, so its visibility read
 * as `internal`; the members were invisible, so the audience was empty; and an
 * empty audience is not an error. `drain()` marked every row `published` and
 * delivered it to nobody, at full throughput, with no error in any log.
 *
 * WHY THE PROCESS DECLARES ITSELF, AND NOTHING INFERS IT
 * Two inferences look tempting and are both wrong:
 *
 *   "DATABASE_SERVICE_URL is set, so I must be the worker" -- this makes the
 *   API silently switch to a BYPASSRLS connection the moment that variable
 *   leaks into its environment (one shared env file is enough). That converts a
 *   delivery bug into an authorization bug, which is far worse.
 *
 *   "argv[1] ends with worker.js" -- true of the deployed command and of
 *   nothing else: not jest, not a bundler, not any wrapper. It fails SILENTLY
 *   toward the API default, which is the one direction a guess must never fail.
 *
 * So the worker states the fact it alone knows, exactly as it already states it
 * to the error tracker (`createErrorTracker('worker', build)`). The default is
 * 'api' because that is the RLS-ENFORCED connection: anything that has not
 * declared itself -- a test, a script, a future entrypoint -- gets the
 * least-privileged role rather than the one that ignores every policy.
 */
export type DatabaseRole = 'api' | 'worker';

/**
 * Deliberately module-scoped rather than an environment variable: this is a
 * property of the running process, not of its configuration, and configuration
 * is exactly what must not be able to change it.
 */
let declared: DatabaseRole = 'api';

/**
 * Declare this process's database role.
 *
 * MUST be called before the Nest container is created, because the Prisma
 * provider factory reads it while constructing the client. Importing AppModule
 * does not construct anything, so the top of an entrypoint's bootstrap() is
 * early enough.
 */
export function declareDatabaseRole(role: DatabaseRole): void {
  declared = role;
}

/** The role this process has declared. Exported for the startup assertion. */
export function currentDatabaseRole(): DatabaseRole {
  return declared;
}

/** Test-only: restore the default so one spec cannot leak into the next. */
export function resetDatabaseRole(): void {
  declared = 'api';
}

export class WorkerDatabaseUrlMissing extends Error {
  constructor() {
    super(
      'refusing to start: the worker requires DATABASE_SERVICE_URL.\n' +
        'It must NOT fall back to DATABASE_URL. That connection is chat_app, ' +
        'which cannot see the messages, members or recipients the worker needs ' +
        'in order to route what it drains -- so the worker would mark every ' +
        'event published and deliver none of them, without raising anything.\n' +
        'Point DATABASE_SERVICE_URL at chat_service (created NOLOGIN by ' +
        'supabase/migrations/20260907120000_chat_phase1_runtime_role.sql; grant ' +
        'it LOGIN and a password from the secret store).',
    );
    this.name = 'WorkerDatabaseUrlMissing';
  }
}

/**
 * The datasource URL override for this process, or `undefined` to use the one
 * the Prisma schema already names.
 *
 * `undefined` for the API is the whole point: it leaves `env("DATABASE_URL")`
 * in prisma/schema.prisma as the single authority for the request path, so
 * nothing about the API's connection changes and the schema stays the
 * migration authority it already is.
 *
 * For the worker it throws rather than returning `undefined`, because
 * `undefined` would mean "use DATABASE_URL" -- the exact silent fallback this
 * function exists to remove. A worker with no service credential must not
 * start; a crash-looping worker is loud, and the alternative is a worker that
 * looks perfectly healthy while delivering nothing.
 */
export function datasourceUrlForRole(
  role: DatabaseRole = declared,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (role !== 'worker') return undefined;

  // Trimmed, because a secret store that renders an empty value produces a
  // present-but-blank variable, and `''` is not a connection string.
  const url = env.DATABASE_SERVICE_URL?.trim();
  if (!url) throw new WorkerDatabaseUrlMissing();
  return url;
}
