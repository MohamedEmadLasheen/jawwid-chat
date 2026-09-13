import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';

/**
 * The authentication error contract (API-CONTRACT §2, table of AUTH.* codes).
 *
 * Separate from CommErrorCode because these are not communication-domain
 * refusals: they are decided before any controller runs, and clients branch on
 * them to decide whether to refresh, re-login, or stop for good.
 */
export enum AuthErrorCode {
  /** 401. Missing / malformed / expired bearer token. Refresh once, then end. */
  UNAUTHENTICATED = 'AUTH.UNAUTHENTICATED',
  /** 401. Login: wrong username OR wrong password -- one code for both. */
  INVALID_CREDENTIALS = 'AUTH.INVALID_CREDENTIALS',
  /** 403. Account deactivated or suspended. Terminal for the client. */
  ACCOUNT_DISABLED = 'AUTH.ACCOUNT_DISABLED',
  /** 403. Temporarily locked after repeated failures. Terminal until unlock. */
  ACCOUNT_LOCKED = 'AUTH.ACCOUNT_LOCKED',
  /** 401. Refresh token revoked, rotated-and-reused, or session deleted. */
  SESSION_REVOKED = 'AUTH.SESSION_REVOKED',
  /** 403. Authenticated, but lacks the permission key. */
  FORBIDDEN = 'AUTH.FORBIDDEN',
  /**
   * 429. Too many login attempts from this identifier or this source.
   *
   * A COMMON.* code rather than an AUTH.* one because that is what
   * API-CONTRACT §2 names, and §3.1 lists it among POST /auth/login's errors.
   * It is served through this filter because login is where it is raised.
   */
  RATE_LIMITED = 'COMMON.RATE_LIMITED',
}

/**
 * The uniform messages.
 *
 * UNIFORM ON PURPOSE. `INVALID_CREDENTIALS` must read identically whether the
 * subject exists or not: a body that says "no such user" enumerates accounts,
 * and so does one that says "wrong password". Adopted from the archived AI #8
 * guard (315ed95) along with the rest of its uniform-401 discipline.
 */
const MESSAGES: Record<AuthErrorCode, string> = {
  [AuthErrorCode.UNAUTHENTICATED]: 'authentication required',
  [AuthErrorCode.INVALID_CREDENTIALS]: 'invalid credentials',
  [AuthErrorCode.ACCOUNT_DISABLED]: 'account is not active',
  [AuthErrorCode.ACCOUNT_LOCKED]: 'too many attempts; try again later',
  [AuthErrorCode.SESSION_REVOKED]: 'session is no longer valid',
  [AuthErrorCode.FORBIDDEN]: 'not permitted',
  // Deliberately the same wording the design system already specifies for this
  // state (docs/design/screens/auth.md §8: "Too many attempts. Try again in a
  // few minutes."), and deliberately identical whether the account exists or
  // not -- a rate-limit response that differs would enumerate accounts just as
  // effectively as a login response that differs.
  [AuthErrorCode.RATE_LIMITED]: 'too many attempts; try again later',
};

const STATUS: Record<AuthErrorCode, number> = {
  [AuthErrorCode.UNAUTHENTICATED]: 401,
  [AuthErrorCode.INVALID_CREDENTIALS]: 401,
  [AuthErrorCode.ACCOUNT_DISABLED]: 403,
  [AuthErrorCode.ACCOUNT_LOCKED]: 403,
  [AuthErrorCode.SESSION_REVOKED]: 401,
  [AuthErrorCode.FORBIDDEN]: 403,
  [AuthErrorCode.RATE_LIMITED]: 429,
};

/**
 * An authentication refusal.
 *
 * Carries no detail beyond the code. Anything more -- which claim failed, which
 * gate refused, whether the account exists -- is a probe oracle, so it is
 * logged server-side and never serialised.
 */
export class AuthError extends Error {
  readonly status: number;

  /**
   * Seconds until the caller may retry. Serialised as the `Retry-After` header,
   * which API-CONTRACT §2 requires for COMMON.RATE_LIMITED ("Includes
   * `Retry-After`") and which the design system consumes as a visible countdown
   * (docs/design/screens/auth.md §8). Undefined for every other code.
   */
  constructor(
    readonly code: AuthErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(MESSAGES[code]);
    this.name = 'AuthError';
    this.status = STATUS[code];
  }
}

/** Maps an AuthError to the same `{error:{code,message}}` body every route uses. */
@Catch(AuthError)
export class AuthErrorFilter implements ExceptionFilter {
  catch(exception: AuthError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    // The header carries the wait; the BODY does not. A body field counting
    // down per-account would leak which accounts are under attack, and the
    // header is what API-CONTRACT §2 specifies.
    if (exception.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil(exception.retryAfterSeconds))));
    }

    response.status(exception.status).json({
      error: { code: exception.code, message: exception.message },
    });
  }
}
