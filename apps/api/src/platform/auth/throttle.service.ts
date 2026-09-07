import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { AppConfigService } from '../app-config.service';
import { AuthError, AuthErrorCode } from './auth.errors';

/**
 * The scopes a request can be throttled on, and what each is for.
 *
 * Two axes, deliberately, because they fail differently:
 *
 *   *_ip       bounds one source. Cheap to evade by rotating addresses, which
 *              is why it is not the only one.
 *   *_subject  bounds attempts against one target, from anywhere. Address
 *              rotation does not help an attacker here, which is what makes
 *              password spraying expensive rather than free.
 */
export const ThrottleScope = {
  LOGIN_IP: 'login_ip',
  LOGIN_SUBJECT: 'login_subject',
  RESET_REQUEST_IP: 'reset_request_ip',
  RESET_REQUEST_SUBJECT: 'reset_request_subject',
  RESET_REDEEM_IP: 'reset_redeem_ip',
} as const;
export type ThrottleScope = (typeof ThrottleScope)[keyof typeof ThrottleScope];

interface AttemptResult {
  blocked: boolean;
  attempts: number;
  retry_after_seconds: number;
}

/**
 * Rate limiting for the endpoints that can be reached without a session.
 *
 * WHERE IT SITS. The credential lockout that Phase 1 already had is per
 * ACCOUNT and stops somebody guessing one person's password. This is per
 * SOURCE and per TARGET, and stops the attacks that never trip an account
 * lockout: spraying one password across many subjects, hammering
 * forgot-password to learn which subjects exist, and guessing a reset token.
 *
 * WHAT IT MUST NOT DO. It must not become the enumeration oracle it exists to
 * prevent. Every counter is recorded and every refusal is identical whether or
 * not the subject exists -- a subject-scoped counter is incremented for an
 * unknown subject exactly as for a known one, and the response body and status
 * do not vary. The keys are hashed, so the table never accumulates a list of
 * real subjects or a log of addresses.
 *
 * WHAT IT CANNOT DO. A distributed attack from thousands of addresses defeats
 * any per-address counter, and no application-level limiter changes that. The
 * per-subject counter still bounds the damage per target; volume defence
 * belongs at the edge. docs/security/AUTH-THROTTLING.md states this plainly
 * rather than letting the existence of this file imply otherwise.
 */
@Injectable()
export class ThrottleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  private secret(): string {
    const s = process.env.JWT_REFRESH_SECRET;
    if (!s || s.length < 32) {
      throw new Error('JWT_REFRESH_SECRET must be set to at least 32 characters');
    }
    return s;
  }

  /** Keys are keyed hashes: the table stores no address and no subject. */
  bucket(scope: ThrottleScope, value: string): string {
    const digest = createHmac('sha256', this.secret())
      .update(`${scope}:${value.trim().toLowerCase()}`)
      .digest('base64url')
      .slice(0, 43);
    return `${scope}:${digest}`;
  }

  private async limitFor(scope: ThrottleScope): Promise<number> {
    switch (scope) {
      case ThrottleScope.LOGIN_IP:
        return Number(await this.config.get('auth.throttle.login_per_ip'));
      case ThrottleScope.LOGIN_SUBJECT:
        return Number(await this.config.get('auth.throttle.login_per_subject'));
      case ThrottleScope.RESET_REQUEST_IP:
        return Number(await this.config.get('auth.throttle.reset_request_per_ip'));
      case ThrottleScope.RESET_REQUEST_SUBJECT:
        return Number(await this.config.get('auth.throttle.reset_request_per_subject'));
      case ThrottleScope.RESET_REDEEM_IP:
        return Number(await this.config.get('auth.throttle.reset_redeem_per_ip'));
    }
  }

  /**
   * Record one attempt and refuse if the bucket has tripped.
   *
   * An absent value (no address behind a proxy that strips it) is NOT treated
   * as a free pass: it becomes its own bucket, so every such caller shares one
   * counter rather than each getting an unlimited one.
   */
  async hit(scope: ThrottleScope, value: string | undefined): Promise<void> {
    const [limit, windowSeconds, blockSeconds] = await Promise.all([
      this.limitFor(scope),
      this.config.get('auth.throttle.window_seconds'),
      this.config.get('auth.throttle.block_seconds'),
    ]);

    const bucket = this.bucket(scope, value ?? 'unattributed');
    const [result] = await this.prisma.$queryRaw<AttemptResult[]>`
      select * from chat.record_auth_attempt(
        ${bucket}, ${scope}, ${limit}::int, ${Number(windowSeconds)}::int,
        ${Number(blockSeconds)}::int)
    `;

    if (result?.blocked) {
      throw new AuthError(
        AuthErrorCode.TOO_MANY_ATTEMPTS,
        'too many attempts; try again later',
        429,
      );
    }
  }

  /** Called after a success, so an honest mistyped password leaves no residue. */
  async clear(scopes: Array<[ThrottleScope, string | undefined]>): Promise<void> {
    const buckets = scopes.map(([scope, value]) => this.bucket(scope, value ?? 'unattributed'));
    if (buckets.length === 0) return;
    await this.prisma.$queryRaw<Array<{ clear_auth_attempts: number }>>`
      select chat.clear_auth_attempts(${buckets}::text[])
    `;
  }
}
