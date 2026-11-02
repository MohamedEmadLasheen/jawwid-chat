import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { CommErrorCode } from './errors';

/**
 * TEACHER-027: the database could not serve the request in time.
 *
 * Under load (systest, host load ~90) a burst of reads answered bare 500s:
 * P1001 (database unreachable / connect timeout), P2024 (no pool connection
 * within pool_timeout) and P2028 (an interactive transaction past its timeout).
 * None of them is a bug in the request: nothing was committed (a transaction
 * that fails is rolled back; a statement that never ran wrote nothing), and the
 * same request may succeed a moment later. So they are a retryable 503 with
 * Retry-After, never a 500 a client treats as final.
 *
 * Also here: a statement cancelled by DATABASE_STATEMENT_TIMEOUT_MS (#348,
 * SQLSTATE 57014), which rolls its transaction back the same way.
 *
 * Not here, deliberately: P1017 (the server closed the connection), which can
 * arrive after a COMMIT was sent, so "nothing was saved" would not be known.
 */
const UNAVAILABLE_CODES = new Set(['P1001', 'P2024', 'P2028']);

/** Seconds a client should wait before retrying. Short: the pool frees in milliseconds. */
export const DATABASE_RETRY_AFTER_SECONDS = 2;

/**
 * The Prisma error code (or `57014` for a statement timeout) that makes this
 * error "the database was unavailable", or null for any other error.
 */
export function databaseUnavailableCause(e: unknown): string | null {
  if (!(e instanceof Error)) return null;
  const code = prismaCodeOf(e);
  if (code && UNAVAILABLE_CODES.has(code)) return code;
  // A cancelled statement reaches us as text, whichever Prisma class carries it:
  // `PostgresError { code: "57014", message: "canceling statement due to statement timeout" }`.
  if (/\b57014\b|canceling statement due to statement timeout/.test(e.message)) return '57014';
  return null;
}

/** The Prisma code an error carries: `code` on a request error, `errorCode` on an initialization error. */
export function prismaCodeOf(e: unknown): string | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return e.code;
  if (e instanceof Prisma.PrismaClientInitializationError) return e.errorCode ?? null;
  return null;
}

/**
 * Maps a database-unavailable error to 503 + Retry-After with the stable
 * {error:{code,message}} body. Every other Prisma error goes to Nest's default
 * handling unchanged (a 500, logged with its stack).
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientInitializationError, Prisma.PrismaClientUnknownRequestError)
export class DatabaseUnavailableFilter extends BaseExceptionFilter {
  catch(exception: Error, host: ArgumentsHost): void {
    if (host.getType() !== 'http' || databaseUnavailableCause(exception) === null) {
      super.catch(exception, host);
      return;
    }
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Retry-After', String(DATABASE_RETRY_AFTER_SECONDS));
    response.status(503).json({
      error: { code: CommErrorCode.DATABASE_UNAVAILABLE, message: 'the server is busy and nothing was saved; try again in a moment' },
    });
  }
}
