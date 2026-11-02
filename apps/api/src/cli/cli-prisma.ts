import { PrismaClient } from '@prisma/client';
import { pooledDatabaseUrl } from '../platform/database-pool';

/**
 * The one way a CLI opens the database: a pool of 2 and no statement timeout
 * (database-pool.ts, role 'cli'). A CLI is a one-shot operator tool -- a
 * backfill may legitimately run one long statement -- but its pool still counts
 * against the managed database's 22 connections while the API and worker run.
 */
export function cliPrismaClient(url: string | undefined = process.env.DATABASE_URL): PrismaClient {
  return new PrismaClient({ datasourceUrl: pooledDatabaseUrl(url, process.env, 'cli') });
}
