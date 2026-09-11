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
 * WHY THIS IS NOT THE ACCOUNT LOCKOUT
 * -----------------------------------
 * chat.account_credential already locks one account after 10 failures. That
 * control is keyed on the ACCOUNT, so it does nothing at all against password
 * spraying -- one attempt against each of ten thousand accounts never trips any
 * account's counter, and the attacker is never slowed down.
 *
 * The dimension that catches spraying is the SOURCE. So this limiter counts on
 * two keys at once:
 *
 *   identifier  stops repeated guessing at one account (defence in depth with
 *               the lockout, which it deliberately matches at 10)
 *   source IP   stops one origin spreading its attempts across many accounts
 *
 * and the source budget is deliberately NOT reset by a success. Resetting it
 * would hand an attacker who controls one valid account a free counter reset
 * between spray bursts.
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

/** Failures per identifier per window. Matches the account lockout threshold so
 *  the two controls agree rather than one silently masking the other. */
export const IDENTIFIER_MAX_FAILURES = 10;

/** Failures per source per window. 30 in 15 minutes is 2/min sustained from one
 *  origin -- far above a person mistyping, far below a spray worth running. */
export const SOURCE_MAX_FAILURES = 30;

export const WINDOW_SECONDS = 900; // 15 minutes

const KEY_PREFIX = 'ratelimit:login';

/** The slice of ioredis this needs. Keeps the unit tests off a real socket
 *  without letting them substitute different BEHAVIOUR -- the integration suite
 *  runs the same code against a real server. */
export interface RateLimitStore {
  get(key: string): Promise<string | null>;
  ttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export const RATE_LIMIT_STORE = Symbol('LoginRateLimitStore');

/**
 * Neither the login identifier nor the IP is ever stored in the clear.
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
   * Refuses the attempt if either budget is already spent.
   *
   * Called BEFORE the password is verified, so a blocked caller never reaches
   * Argon2id -- otherwise the limiter would stop the guessing but not the CPU
   * burn it exists to bound.
   *
   * Identical for an existing and a non-existing subject: the identifier key is
   * a hash of whatever was submitted, and nothing consults the database first.
   * A 429 therefore reveals nothing about whether the account exists.
   */
  async assertWithinLimit(subject: string, ip: string | undefined): Promise<void> {
    if (!this.store) {
      // No store configured at all is a deployment error, not a quiet bypass.
      throw new AuthError(AuthErrorCode.RATE_LIMITED, WINDOW_SECONDS);
    }

    const keys: Array<[string, number]> = [
      [rateLimitKey('id', normalizeSubject(subject)), IDENTIFIER_MAX_FAILURES],
    ];
    if (ip) keys.push([rateLimitKey('ip', ip), SOURCE_MAX_FAILURES]);

    for (const [key, limit] of keys) {
      let count: number;
      try {
        count = Number((await this.store.get(key)) ?? 0);
      } catch (error) {
        // FAIL CLOSED. See the file header: the instance is being drained
        // anyway, and an unmetered Argon2id endpoint is the worse outcome.
        this.log.error(
          `login rate limiter could not reach its store; refusing login: ${errorName(error)}`,
        );
        throw new AuthError(AuthErrorCode.RATE_LIMITED, WINDOW_SECONDS);
      }

      if (count >= limit) {
        throw new AuthError(AuthErrorCode.RATE_LIMITED, await this.retryAfter(key));
      }
    }
  }

  /**
   * Spends one unit of both budgets.
   *
   * Called on EVERY refused login, whatever the reason -- wrong password, no
   * such subject, disabled, locked. Counting only "invalid credentials" would
   * leave a disabled or locked account as an unmetered oracle, and would let an
   * attacker probe which of those an account is for free.
   */
  async recordFailure(subject: string, ip: string | undefined): Promise<void> {
    if (!this.store) return;

    const keys = [rateLimitKey('id', normalizeSubject(subject))];
    if (ip) keys.push(rateLimitKey('ip', ip));

    for (const key of keys) {
      try {
        const count = await this.store.incr(key);
        // Fixed window: the expiry is set by whichever attempt opened it, so
        // the window runs from the first failure rather than sliding forward
        // with every new one (which would never expire under sustained load).
        if (count === 1) await this.store.expire(key, WINDOW_SECONDS);
      } catch (error) {
        // A failure to RECORD is not a reason to refuse the request that already
        // failed for its own reason. assertWithinLimit is the gate; this is
        // bookkeeping, and it fails closed on the next attempt anyway because
        // that call cannot read the store either.
        this.log.error(`login rate limiter could not record a failure: ${errorName(error)}`);
      }
    }
  }

  /**
   * Clears the IDENTIFIER budget after a successful login, so a person who
   * mistyped their password four times is not still penalised once they get it
   * right.
   *
   * The SOURCE budget is deliberately left alone. Clearing it would let an
   * attacker who holds one valid account reset their spray counter at will,
   * which is exactly the attack this limiter exists to stop.
   */
  async clearIdentifier(subject: string): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.expire(rateLimitKey('id', normalizeSubject(subject)), 0);
    } catch (error) {
      this.log.error(`login rate limiter could not clear an identifier: ${errorName(error)}`);
    }
  }

  private async retryAfter(key: string): Promise<number> {
    try {
      const ttl = await this.store!.ttl(key);
      // -1 = no expiry, -2 = no key. Neither should happen for a key we just
      // read a count from; fall back to the full window rather than to 0, which
      // would invite an immediate retry.
      return ttl > 0 ? ttl : WINDOW_SECONDS;
    } catch {
      return WINDOW_SECONDS;
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
