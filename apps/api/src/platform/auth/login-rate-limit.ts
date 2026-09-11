import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AuthError, AuthErrorCode } from './auth.errors';

/**
 * Rate limiting for POST /auth/login (PR-B).
 *
 * REQUIRED BY: `docs/architecture/IDENTITY-MODEL.md` §4 ("Rate limiting on
 * `/auth/login`"), `API-CONTRACT.md` §3.1 (which lists `COMMON.RATE_LIMITED`
 * 429 among login's errors), PRD §7.1 and
 * `docs/infrastructure/architecture.md` §8 ("Rate limiting is configurable per
 * surface (authentication, ...)"). No document sets the values --
 * `handoff-ai5.md` §4 says "the values are yours to set" -- so the numbers
 * below are chosen here and named.
 *
 * RESERVATION, NOT CHECK-THEN-COUNT
 * ---------------------------------
 * The first version of this file read the counter, decided, ran the login, and
 * incremented afterwards. The window between the read and the increment spanned
 * the whole handler including a ~200ms Argon2id verification, so a concurrent
 * burst all read the same count, all passed, and all ran Argon2id: 120 of 120
 * requests got past a limit of 10, in 626ms.
 *
 * So a slot is now RESERVED -- incremented and checked in one atomic step --
 * before the password is verified. Every attempt consumes its unit up front,
 * which is what makes the limit hold under concurrency. A single Redis Lua
 * script does it, and Redis executes a script atomically, so no interleaving is
 * possible between the increment and the comparison.
 *
 * WHY THIS IS NOT THE ACCOUNT LOCKOUT
 * -----------------------------------
 * chat.account_credential already locks one account after 10 failures. That
 * control is keyed on the ACCOUNT, so it does nothing at all against password
 * spraying -- one attempt against each of ten thousand accounts never trips any
 * account's counter, and the attacker is never slowed down.
 *
 * The dimension that catches spraying is the SOURCE. So this limiter reserves
 * on two keys at once:
 *
 *   identifier  stops repeated guessing at one account (defence in depth with
 *               the lockout, which it deliberately matches at 10)
 *   source      stops one origin spreading its attempts across many accounts
 *
 * and the source budget is deliberately NOT released by a success. Releasing it
 * would hand an attacker who controls one valid account a free counter reset
 * between spray bursts.
 *
 * !! THE SOURCE DIMENSION IS ONLY AS GOOD AS THE ADDRESS IT IS GIVEN !!
 * `login-rate-limit` does not decide what "the source" is; the caller passes
 * it. Deriving a real client address behind a reverse proxy is an unsolved
 * deployment question in this repository -- see auth.controller.ts and the PR
 * description. This class is correct for whatever address it is handed.
 *
 * WHY REDIS, NOT MEMORY
 * ---------------------
 * `docs/infrastructure/architecture.md` §10: "API instances -- stateless; add
 * replicas." A per-process counter would therefore multiply the real limit by
 * the replica count and reset on every deploy -- a limiter that reports success
 * while enforcing nothing. REDIS_URL is already required in local, staging and
 * production (`infra/env/manifest.tsv`), and the same Redis already backs
 * presence, typing and the Socket.IO adapter, so this introduces no new
 * dependency and no new configuration.
 *
 * FAILURE POLICY: FAIL CLOSED
 * ---------------------------
 * If Redis cannot be reached, login is refused. That is the canonical
 * availability posture, not a choice made here: `architecture.md` §7 grades a
 * Redis outage "severe -- **not ready** -> drained", so an instance that cannot
 * reach Redis is already being taken out of the load balancer. Failing open for
 * the seconds before it drains would remove brute-force protection from an
 * endpoint that runs Argon2id at 19 MiB and ~200 ms per attempt -- which is
 * also, on its own, the cheapest denial-of-service amplifier in the system.
 */

/** Attempts per identifier per window. Matches the account lockout threshold so
 *  the two controls agree rather than one silently masking the other. */
export const IDENTIFIER_MAX_ATTEMPTS = 10;

/** Attempts per source per window. 30 in 15 minutes is 2/min sustained from one
 *  origin -- far above a person mistyping, far below a spray worth running. */
export const SOURCE_MAX_ATTEMPTS = 30;

export const WINDOW_SECONDS = 900; // 15 minutes

const KEY_PREFIX = 'ratelimit:login';

/** Which budget refused the attempt. 0 = none. */
export const ALLOWED = 0;

export interface ReserveResult {
  /** 0 when the attempt is allowed; otherwise the 1-based index of the budget
   *  that was exceeded. */
  readonly exceeded: number;
  /** Seconds until that budget frees up. Only meaningful when exceeded > 0. */
  readonly retryAfterSeconds: number;
}

/**
 * The storage contract.
 *
 * Deliberately expressed as RESERVE, not as get/incr/expire. A store cannot
 * implement this interface non-atomically without lying about it, and the
 * limiter above therefore cannot be made racy by a future refactor of the
 * transport: the atomicity requirement is part of the type.
 */
export interface RateLimitStore {
  /** Consume one unit from EVERY budget, atomically, and report the first that
   *  is now over its limit. */
  reserve(keys: readonly string[], limits: readonly number[], windowSeconds: number): Promise<ReserveResult>;
  /** Release a whole budget (used only for the identifier, only on success). */
  drop(key: string): Promise<void>;
}

export const RATE_LIMIT_STORE = Symbol('LoginRateLimitStore');

/**
 * Neither the login identifier nor the source is ever stored in the clear.
 *
 * The identifier is `chat.account.subject`, which IS the login credential half
 * of the pair; a Redis key naming it would turn a cache dump into a list of
 * valid usernames. IDENTITY-MODEL §6 says the same about addresses ("no raw
 * IP"). Truncated SHA-256 keeps both opaque while staying a stable key.
 */
export function rateLimitKey(dimension: 'id' | 'ip', value: string): string {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${KEY_PREFIX}:${dimension}:${digest}`;
}

@Injectable()
export class LoginRateLimiter {
  private readonly log = new Logger(LoginRateLimiter.name);

  constructor(@Optional() @Inject(RATE_LIMIT_STORE) private readonly store?: RateLimitStore) {}

  /**
   * Reserves a slot, or refuses.
   *
   * MUST be called before the password is verified. A refused caller never
   * reaches Argon2id -- otherwise the limiter would bound the guessing but not
   * the CPU and memory burn it also exists to bound.
   *
   * Identical for an existing and a non-existing subject: the identifier key is
   * a hash of whatever was submitted, and nothing consults the database first.
   * A 429 therefore reveals nothing about whether the account exists.
   */
  async reserve(subject: string, source: string | undefined): Promise<void> {
    if (!this.store) {
      // No store configured at all is a deployment error, not a quiet bypass.
      throw new AuthError(AuthErrorCode.RATE_LIMITED, WINDOW_SECONDS);
    }

    const keys = [rateLimitKey('id', normalizeSubject(subject))];
    const limits = [IDENTIFIER_MAX_ATTEMPTS];
    if (source) {
      keys.push(rateLimitKey('ip', source));
      limits.push(SOURCE_MAX_ATTEMPTS);
    }

    let result: ReserveResult;
    try {
      result = await this.store.reserve(keys, limits, WINDOW_SECONDS);
    } catch (error) {
      // FAIL CLOSED. See the file header: the instance is being drained anyway,
      // and an unmetered Argon2id endpoint is the worse outcome.
      this.log.error(
        `login rate limiter could not reach its store; refusing login: ${errorName(error)}`,
      );
      throw new AuthError(AuthErrorCode.RATE_LIMITED, WINDOW_SECONDS);
    }

    if (result.exceeded !== ALLOWED) {
      throw new AuthError(
        AuthErrorCode.RATE_LIMITED,
        result.retryAfterSeconds > 0 ? result.retryAfterSeconds : WINDOW_SECONDS,
      );
    }
  }

  /**
   * Releases the IDENTIFIER budget after a successful login, so a person who
   * mistyped their password four times is not still penalised once they get it
   * right.
   *
   * The SOURCE budget is deliberately left alone. Releasing it would let an
   * attacker who holds one valid account reset their spray counter at will,
   * which is exactly the attack that dimension exists to stop.
   */
  async clearIdentifier(subject: string): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.drop(rateLimitKey('id', normalizeSubject(subject)));
    } catch (error) {
      // Bookkeeping, not a gate. Failing here leaves the reservation in place,
      // which errs towards refusing rather than towards allowing.
      this.log.error(`login rate limiter could not release an identifier: ${errorName(error)}`);
    }
  }
}

/** The subject is matched case-insensitively so `Parent-1` and `parent-1`
 *  cannot be used as two separate budgets for the same account. */
function normalizeSubject(subject: string): string {
  return subject.trim().toLowerCase();
}

/** Never the message: an ioredis error can embed the connection string, and a
 *  connection string carries a password. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
