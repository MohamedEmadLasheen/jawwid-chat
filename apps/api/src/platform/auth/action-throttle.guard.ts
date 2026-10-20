import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfigService, COMMUNICATION_CONFIG_DEFAULTS } from '../app-config.service';
import { AuthError, AuthErrorCode } from './auth.errors';
import type { AuthenticatedRequest } from './auth.guard';
import { RATE_LIMIT_STORE, type RateLimitStore, type ReserveResult } from './login-rate-limit';

/**
 * Abuse limits for AUTHENTICATED actions (Phase 8, rebuilt on main's design).
 *
 * WHAT THIS ADDS
 * --------------
 * Login is bounded by LoginRateLimiter. Everything behind it was bounded only
 * by authorization, which answers "may this actor do this at all" -- not "may
 * this actor do it four thousand times a minute". A compromised or scripted
 * session flooding a family's thread, minting presigned uploads until the
 * bucket bill is a problem, or firing a story at every family over and over is
 * doing something it is AUTHORIZED to do. Nothing counted it.
 *
 * ONE STORE, NOT TWO
 * ------------------
 * The counters live in the same Redis-backed RateLimitStore the login limiter
 * uses: the same atomic reserve script, the same fixed window, the same hashed
 * keys, under a distinct prefix (`ratelimit:action:<scope>:<digest>`). A second
 * mechanism with its own storage and its own off-by-one is how two limiters end
 * up disagreeing during an incident.
 *
 * The numbers live in chat.config (`abuse.throttle.*`, seeded by
 * 20261021020000_chat_abuse_limits.sql), so correcting one is an operations
 * change rather than a deploy. docs/security/ABUSE-LIMITS.md lists them.
 */

/**
 * The rationed actions. Each value is both the Redis key segment and the tail of
 * its chat.config key (`abuse.throttle.<value>`).
 *
 * Every scope is per ACTOR, never per address: an authenticated caller has
 * something better than an IP -- an identity the signed token established, that
 * survives address rotation and that can be revoked.
 */
export const ActionScope = {
  MESSAGE_SEND: 'message_send_actor',
  ATTACHMENT_UPLOAD: 'attachment_upload_actor',
  STORY_PUBLISH: 'story_publish_actor',
  CALL_START: 'call_start_actor',
} as const;

export type ActionScope = (typeof ActionScope)[keyof typeof ActionScope];

export const RATE_LIMITED_ACTION = 'jawwid:rate-limited-action';

/**
 * Bound how often one authenticated actor may perform this action.
 *
 *   @RateLimited(ActionScope.MESSAGE_SEND)
 *   @Post()
 *   async send(...) { ... }
 */
export const RateLimited = (scope: ActionScope): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMITED_ACTION, scope);

const KEY_PREFIX = 'ratelimit:action';

/**
 * The actor id is never stored in the clear: a Redis dump must not be a list of
 * who was active. Truncated SHA-256, exactly as `rateLimitKey` does for login.
 */
export function actionRateLimitKey(scope: ActionScope, actorId: string): string {
  const digest = createHash('sha256').update(actorId).digest('hex').slice(0, 32);
  return `${KEY_PREFIX}:${scope}:${digest}`;
}

/**
 * How long one reservation may take before the action is let through.
 *
 * ioredis with `maxRetriesPerRequest: 1` already fails fast against a server
 * that refuses connections; this bounds the other case -- a Redis that accepts
 * the command and never answers -- so a stalled store adds at most this much
 * latency to a message send instead of hanging it.
 */
export const ACTION_LIMIT_STORE_TIMEOUT_MS = 500;

/**
 * The authenticated-abuse gate.
 *
 * OPT-IN, the opposite arrangement from AuthenticatedGuard. Authentication is
 * default-on because a route nobody remembered to protect is a hole. Rate
 * limiting is default-off because each check is a Redis round trip, and paying
 * it on paging through history or on `GET /health` buys nothing. The decorator
 * names the handful of actions that are expensive to repeat.
 *
 * ORDER MATTERS. Registered as an APP_GUARD AFTER AuthenticatedGuard (see
 * auth.module.ts), so `request.actor` is already resolved from the signed token.
 * Running first would count against an identity nothing had verified -- one an
 * attacker chooses freely, which makes the counter worthless.
 *
 * It counts the ATTEMPT, before the handler. Counting successes would let a
 * client whose payload fails validation retry without limit, and a refused
 * request still costs the parse, the authorization query and the round trip.
 * Nothing is released on success either: this is a rate, not a lockout.
 *
 * FAILURE POLICY: FAIL OPEN -- deliberately the opposite of login
 * ---------------------------------------------------------------
 * If the store cannot be reached (or does not answer within
 * ACTION_LIMIT_STORE_TIMEOUT_MS, or REDIS_URL is unset), the action is ALLOWED
 * and an error is logged.
 *
 * Login fails closed because what it protects is a secret: an unmetered
 * Argon2id endpoint is a brute-force oracle and a CPU amplifier, and a refused
 * login costs a retry. Neither half holds here. These callers have already
 * proven who they are; every one of these actions is still fully authorized
 * per request; and the abuse being bounded is VOLUME by an identity we can
 * revoke. Failing closed would turn a Redis blip into "nobody can send a
 * message, upload a photo or start a call" -- a self-inflicted outage of the
 * product's core function, far worse than a minute of unmetered sends by a
 * session that is already accountable. The instance is drained anyway once
 * readiness sees Redis gone (architecture.md section 7).
 */
@Injectable()
export class ActionThrottleGuard implements CanActivate {
  private readonly log = new Logger(ActionThrottleGuard.name);
  private warnedNoStore = false;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
    @Optional() @Inject(RATE_LIMIT_STORE) private readonly store?: RateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket frames are bounded in the gateway, per socket, in memory
    // (communication/realtime/frame-budget.ts): a typing indicator fires per
    // keystroke and must not cost a round trip each.
    if (context.getType() !== 'http') return true;

    const scope = this.reflector.getAllAndOverride<ActionScope | undefined>(RATE_LIMITED_ACTION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scope) return true;

    // The token-derived actor, and nothing the caller sent. AuthenticatedGuard
    // has already refused a request without one; reaching here without an
    // actor means a `@Public()` route was decorated, and there is no identity
    // to ration -- ActorId() refuses that request as a 401 anyway.
    const actorId = context.switchToHttp().getRequest<AuthenticatedRequest>().actor?.actorId;
    if (!actorId) return true;

    if (!this.store) {
      if (!this.warnedNoStore) {
        this.warnedNoStore = true;
        this.log.error('no rate limit store (REDIS_URL unset); authenticated action limits are OFF');
      }
      return true;
    }

    const [limit, windowSeconds] = await Promise.all([
      this.number(`abuse.throttle.${scope}`, 0),
      // A window of 0 would EXPIRE the counter as it is created, which is no
      // limit at all, so the window alone must be positive.
      this.number('abuse.throttle.window_seconds', 1),
    ]);

    let result: ReserveResult;
    try {
      result = await within(
        this.store.reserve([actionRateLimitKey(scope, actorId)], [limit], windowSeconds),
        ACTION_LIMIT_STORE_TIMEOUT_MS,
      );
    } catch (error) {
      // FAIL OPEN. See the class comment.
      this.log.error(`action rate limit store unavailable; allowing ${scope}: ${errorName(error)}`);
      return true;
    }

    if (result.exceeded !== 0) {
      throw new AuthError(
        AuthErrorCode.RATE_LIMITED,
        result.retryAfterSeconds > 0 ? result.retryAfterSeconds : windowSeconds,
      );
    }
    return true;
  }

  /**
   * A number from chat.config, or its compiled default when the row is missing,
   * unreadable, or not an integer >= `min`. A limit of zero is honoured (it
   * refuses every attempt): an operator tightening a limit must never be read
   * as switching it off.
   */
  private async number(key: AbuseConfigKey, min: number): Promise<number> {
    const fallback = COMMUNICATION_CONFIG_DEFAULTS[key];
    try {
      return configInteger(await this.config.get(key), min) ?? fallback;
    } catch {
      return fallback;
    }
  }
}

type AbuseConfigKey = `abuse.throttle.${ActionScope}` | 'abuse.throttle.window_seconds';

/**
 * A jsonb config value as an integer >= `min`, or null. Only a number or a
 * numeric string counts: `Number(null)` is 0, and a row set to JSON null must
 * fall back to the default rather than silently refuse everything.
 */
export function configInteger(raw: unknown, min: number): number | null {
  const value =
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isInteger(value) && value >= min ? value : null;
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms);
  });
  return Promise.race([p, expiry]).finally(() => clearTimeout(timer));
}

/** Never the message: an ioredis error can embed the connection string. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
