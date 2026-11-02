/**
 * The Prisma connection pool, sized in one place.
 *
 * Without `connection_limit` Prisma sizes the pool at num_physical_cpus x 2 + 1
 * -- whatever CPU count the container reports, which can be the host's, so
 * the deployed pool size was never actually known -- and a request waits at
 * most `pool_timeout` for a connection. A handful of long transactions
 * (realtime delivery holds FOR SHARE locks across a dozen round trips) then
 * starve every other request, which fails with "Timed out fetching a new
 * connection" or an interactive transaction's 2 s maxWait.
 *
 * Budget (DigitalOcean managed Postgres, 1 GiB plan: 22 usable connections):
 *   - the API:    DATABASE_POOL_MAX         = 7 (both deploy workflows)
 *   - the worker: DATABASE_WORKER_POOL_MAX  = 3 (its loops are sequential)
 * so 10 in steady state and 20 while a deploy briefly runs the old and new
 * instance of each side by side, leaving 2 for migrations and an operator's
 * psql. Raise them only together with the database plan.
 *
 * Also in the budget, if ever enabled: ActorScopedDatabase's second client on
 * DATABASE_APP_URL (unset in every deployment today) is sized by the same
 * variables, so enabling it doubles each process's share -- halve both first.
 * The CLIs (src/cli) are short-lived one-shot processes and keep Prisma's own
 * default pool; run them one at a time against production.
 *
 * Both variables are required in staging and production (manifest.tsv). Left
 * unset -- a laptop, CI -- the size stays Prisma's own default, so local and CI
 * runs keep the pool they were written against.
 *
 * STATEMENT TIMEOUT. DATABASE_STATEMENT_TIMEOUT_MS (15000 in both workflows) is
 * set on every API and worker session through the URL's `options`
 * (`-c statement_timeout=N`), so one runaway query is cancelled (SQLSTATE 57014)
 * instead of holding a connection of a 10-connection budget. Per STATEMENT, not
 * per transaction: a long transaction of short statements is unaffected. The
 * one statement that legitimately scales with the whole academy -- the lesson
 * materializer -- raises its own limit locally (SchedulingService.materialize).
 * Unset or 0 means no limit (a laptop, CI; or an escape hatch in a deployment).
 * Migrations never pass through here (psql with DATABASE_URL), and the CLIs
 * use the 'cli' role: a pool of 2 and no statement timeout.
 */
export const DATABASE_POOL_DEFAULTS = { poolTimeoutSeconds: 10, cliConnectionLimit: 2 } as const;

const MAX_CONNECTION_LIMIT = 50;

/**
 * Which process this is: the worker sizes its pool by DATABASE_WORKER_POOL_MAX;
 * a CLI (src/cli) gets a pool of 2 and no statement timeout.
 */
export type DatabasePoolRole = 'api' | 'worker' | 'cli';
let processRole: DatabasePoolRole = 'api';

/** Called by worker.ts before Nest builds any PrismaService. */
export function setDatabasePoolRole(role: DatabasePoolRole): void {
  processRole = role;
}

/**
 * The database URL with `connection_limit` (this process's pool variable, when
 * set) and `pool_timeout` added. A URL that already names either keeps its own
 * value: an operator who wrote it into the URL meant it. Undefined in,
 * undefined out (Prisma then reports the missing variable itself).
 */
export function pooledDatabaseUrl(
  url: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  role: DatabasePoolRole = processRole,
): string | undefined {
  if (!url) return url;
  const parsed = new URL(url);
  const limit = connectionLimit(env, role);
  if (limit !== null && !parsed.searchParams.has('connection_limit')) {
    parsed.searchParams.set('connection_limit', String(limit));
  }
  if (!parsed.searchParams.has('pool_timeout')) {
    parsed.searchParams.set('pool_timeout', String(DATABASE_POOL_DEFAULTS.poolTimeoutSeconds));
  }
  const statementTimeout = role === 'cli' ? 0 : statementTimeoutMs(env);
  if (statementTimeout > 0 && !parsed.searchParams.has('options')) {
    parsed.searchParams.set('options', `-c statement_timeout=${statementTimeout}`);
  }
  return parsed.toString();
}

/** DATABASE_STATEMENT_TIMEOUT_MS: 0..600000, unset or 0 = no limit. */
export function statementTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.DATABASE_STATEMENT_TIMEOUT_MS ?? '').trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 600_000) {
    throw new Error('DATABASE_STATEMENT_TIMEOUT_MS must be an integer from 0 to 600000 (0 = no limit)');
  }
  return n;
}

function connectionLimit(env: NodeJS.ProcessEnv, role: DatabasePoolRole): number | null {
  if (role === 'cli') return DATABASE_POOL_DEFAULTS.cliConnectionLimit;
  const name = role === 'worker' ? 'DATABASE_WORKER_POOL_MAX' : 'DATABASE_POOL_MAX';
  const raw = (env[name] ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CONNECTION_LIMIT) {
    throw new Error(`${name} must be an integer from 1 to ${MAX_CONNECTION_LIMIT}`);
  }
  return n;
}
