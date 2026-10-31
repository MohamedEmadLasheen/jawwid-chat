/**
 * The Prisma connection pool, sized in one place.
 *
 * Without `connection_limit` Prisma sizes the pool at CPUs x 2 + 1 -- three
 * connections on a 1 vCPU App Platform instance -- and a request waits at most
 * `pool_timeout` for one. A handful of long transactions (realtime delivery
 * holds FOR SHARE locks across a dozen round trips) then starve every other
 * request, which fails with "Timed out fetching a new connection" or an
 * interactive transaction's 2 s maxWait.
 *
 * Budget (DigitalOcean managed Postgres, 1 GiB plan: 22 usable connections):
 * the API and the worker each get DATABASE_POOL_MAX, set to 5 by both deploy
 * workflows, so 10 in steady state and 20 while a deploy briefly runs the old
 * and new instance side by side, leaving 2 for migrations and an operator's
 * psql. Raise it only together with the database plan.
 *
 * DATABASE_POOL_MAX is required in staging and production (manifest.tsv). Left
 * unset -- a laptop, CI -- the size stays Prisma's own default, so local and CI
 * runs keep the pool they were written against.
 */
export const DATABASE_POOL_DEFAULTS = { poolTimeoutSeconds: 10 } as const;

const MAX_CONNECTION_LIMIT = 50;

/**
 * DATABASE_URL with `connection_limit` (DATABASE_POOL_MAX, when set) and
 * `pool_timeout` added. A URL that already names either keeps its own value: an operator who
 * wrote it into the URL meant it. Undefined in, undefined out (Prisma then
 * reports the missing variable itself).
 */
export function pooledDatabaseUrl(url: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!url) return url;
  const parsed = new URL(url);
  const limit = connectionLimit(env);
  if (limit !== null && !parsed.searchParams.has('connection_limit')) {
    parsed.searchParams.set('connection_limit', String(limit));
  }
  if (!parsed.searchParams.has('pool_timeout')) {
    parsed.searchParams.set('pool_timeout', String(DATABASE_POOL_DEFAULTS.poolTimeoutSeconds));
  }
  return parsed.toString();
}

function connectionLimit(env: NodeJS.ProcessEnv): number | null {
  const raw = (env.DATABASE_POOL_MAX ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CONNECTION_LIMIT) {
    throw new Error(`DATABASE_POOL_MAX must be an integer from 1 to ${MAX_CONNECTION_LIMIT}`);
  }
  return n;
}
