import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AppConfigService } from '../app-config.service';
import { IDENTITY_SERVICE, AUDIT_SERVICE } from '../tokens';
import type { IdentityService } from '../identity.service';
import type { AuditService } from '../audit.service';
import type { Actor } from '../types';
import { DUMMY_PASSWORD_HASH, verifyPassword } from './password';
import { AccessClaims, parseTtlSeconds, signAccessToken, verifyAccessToken } from './tokens';
import { AuthError, AuthErrorCode, invalidCredentials } from './auth.errors';
import { AccountService, AccountStatus, TokenPurpose } from './account.service';
import {
  DeviceDescriptor,
  SessionContext,
  SessionService,
} from './session.service';

export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
  readonly actor: Actor;
}

export interface AuthenticatedRequestIdentity {
  readonly actor: Actor;
  readonly claims: AccessClaims;
  /**
   * The account's opaque token subject.
   *
   * Carried on the request so ActorContextInterceptor can set
   * `chat.actor_subject`, which is what every RLS policy resolves the caller
   * through. It is an internal identifier and is never published to a client.
   */
  readonly subject: string;
}

/**
 * Authentication.
 *
 * Deliberately NOT a second identity system: chat.account was already the
 * account record, this adds credentials and sessions beside it, and the actor
 * is resolved through the existing IdentityService -- so every authorization
 * decision downstream is unchanged and cannot be bypassed by a new login path.
 *
 * THE THREE GATES, all required on every request:
 *   1. the access token's signature verifies (HS256, algorithm fixed);
 *   2. the session row is live -- not revoked, not expired, still owned by the
 *      account in the token;
 *   3. the principal is still active, re-read from the database.
 *
 * Gate 2 is what makes logout, a device revocation, a suspension and a password
 * reset take effect on the NEXT request instead of at token expiry. Gate 3 is
 * what makes an offboarded person stop being a supervisor immediately.
 *
 * Nothing the token asserts beyond identity is used. Role, tenant, permissions
 * and scope are re-derived server-side every time.
 */
@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly sessions: SessionService,
    private readonly accounts: AccountService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private accessSecret(): string {
    const s = process.env.JWT_ACCESS_SECRET;
    if (!s || s.length < 32) {
      // Fail closed. A short or missing signing secret means forgeable tokens.
      throw new Error('JWT_ACCESS_SECRET must be set to at least 32 characters');
    }
    return s;
  }

  private async accessTtl(): Promise<number> {
    return parseTtlSeconds(
      process.env.JWT_ACCESS_TTL,
      Number(await this.config.get('auth.access_token_ttl_seconds')),
    );
  }

  // ------------------------------------------------------------------
  // Login
  // ------------------------------------------------------------------

  /**
   * Every failure below returns the SAME error, and unknown subjects still pay
   * for a password verification, so neither the body nor the timing tells an
   * attacker which subjects exist. The two exceptions are deliberate: a
   * disabled account and a locked credential are told apart, because a person
   * locked out of their own account needs to know why and neither answer
   * reveals anything an attacker could not obtain by trying.
   */
  async login(
    subject: string,
    password: string,
    device?: DeviceDescriptor,
    context: SessionContext = {},
  ): Promise<LoginResult> {
    const account = await this.prisma.account.findFirst({
      where: { subject },
      include: { credential: true },
    });

    if (!account || !account.credential) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      throw invalidCredentials();
    }

    if (!AccountService.isUsable(account.status)) {
      throw new AuthError(
        AuthErrorCode.ACCOUNT_DISABLED,
        account.status === AccountStatus.PROVISIONED
          ? 'this account has not been activated yet'
          : 'this account is disabled',
      );
    }

    const [maxAttempts, lockoutSeconds] = await Promise.all([
      this.config.get('auth.max_failed_attempts'),
      this.config.get('auth.lockout_seconds'),
    ]);

    if (account.credential.lockedUntil && account.credential.lockedUntil > new Date()) {
      throw new AuthError(AuthErrorCode.ACCOUNT_LOCKED, 'too many attempts; try again later');
    }

    if (!(await verifyPassword(password, account.credential.passwordHash))) {
      const attempts = account.credential.failedAttempts + 1;
      await this.prisma.accountCredential.update({
        where: { accountId: account.id },
        data: {
          failedAttempts: attempts,
          lockedUntil:
            attempts >= Number(maxAttempts)
              ? new Date(Date.now() + Number(lockoutSeconds) * 1000)
              : null,
        },
      });
      throw invalidCredentials();
    }

    const actor = await this.identity.resolveByAccount(account.id);
    if (!actor || !actor.isActive) {
      // The credential was right but the person is not active -- offboarded
      // staff, a departed contact. Same answer as a wrong password: whether a
      // former colleague still has an account is not the attacker's business.
      this.log.warn(`account ${account.id} authenticated but resolves to no active actor`);
      throw invalidCredentials();
    }

    await this.prisma.accountCredential.update({
      where: { accountId: account.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });

    const issued = await this.sessions.issue(account.id, device, context);

    await this.prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'auth.login',
        entity: 'session',
        entityId: issued.sessionId,
        reason: 'password login',
      });
    });

    return this.result(account.id, actor, issued.sessionId, issued.refreshToken);
  }

  private async result(
    accountId: string,
    actor: Actor,
    sessionId: string,
    refreshToken: string,
  ): Promise<LoginResult> {
    const ttl = await this.accessTtl();
    const accessToken = signAccessToken(
      {
        sub: accountId,
        sid: sessionId,
        act: actor.actorId,
        knd: actor.kind,
        org: actor.organizationId,
      },
      this.accessSecret(),
      ttl,
    );
    return {
      accessToken,
      refreshToken,
      expiresInSeconds: ttl,
      actor: { ...actor, sessionId },
    };
  }

  // ------------------------------------------------------------------
  // Per-request verification
  // ------------------------------------------------------------------

  async authenticate(token: string): Promise<AuthenticatedRequestIdentity | null> {
    const claims = verifyAccessToken(token, this.accessSecret());
    if (!claims) return null;

    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: { revokedAt: true, expiresAt: true, accountId: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    // A token whose session belongs to a different account is a forged or
    // stitched token, whatever its signature says.
    if (session.accountId !== claims.sub) return null;

    const account = await this.prisma.account.findUnique({
      where: { id: claims.sub },
      select: { status: true, subject: true },
    });
    if (!account || !AccountService.isUsable(account.status)) return null;

    // Re-resolved from the database on every request: role, tenant, permissions
    // and activity are current, never whatever they were when the token was
    // minted.
    const actor = await this.identity.resolveByAccount(claims.sub);
    if (!actor || !actor.isActive) return null;
    if (actor.actorId !== claims.act) return null;

    void this.sessions.touch(claims.sid);
    return { actor: { ...actor, sessionId: claims.sid }, claims, subject: account.subject };
  }

  // ------------------------------------------------------------------
  // Refresh / logout
  // ------------------------------------------------------------------

  async refresh(
    refreshToken: string,
    device?: DeviceDescriptor,
    context: SessionContext = {},
  ): Promise<LoginResult> {
    const session = await this.sessions.findByRefreshToken(refreshToken);
    if (!session) {
      throw new AuthError(AuthErrorCode.SESSION_INVALID, 'session is not valid');
    }

    if (!AccountService.isUsable(session.account.status)) {
      await this.sessions.revoke(session.id, 'account not active');
      throw new AuthError(AuthErrorCode.SESSION_INVALID, 'session is not valid');
    }

    const actor = await this.identity.resolveByAccount(session.accountId);
    if (!actor || !actor.isActive) {
      await this.sessions.revoke(session.id, 'principal not active');
      throw new AuthError(AuthErrorCode.SESSION_INVALID, 'session is not valid');
    }

    // Rotate: the presented token is retired as it is used, so a stolen one is
    // useful at most once and its use invalidates the legitimate holder's --
    // which is how the theft becomes visible rather than silent.
    await this.sessions.rotate(session.id);

    const issued = await this.sessions.issue(
      session.accountId,
      device ??
        (session.device
          ? {
              clientKey: session.device.clientKey,
              platform: session.device.platform,
              appVersion: session.device.appVersion ?? undefined,
              displayName: session.device.displayName ?? undefined,
            }
          : undefined),
      context,
    );

    return this.result(session.accountId, actor, issued.sessionId, issued.refreshToken);
  }

  async logout(sessionId: string, actorId?: string): Promise<void> {
    const revoked = await this.sessions.revoke(sessionId, 'logout', actorId);
    if (revoked > 0 && actorId) {
      await this.prisma.$transaction((tx) =>
        this.audit.audit(tx, {
          actorId,
          action: 'auth.logout',
          entity: 'session',
          entityId: sessionId,
          reason: 'logout',
        }),
      );
    }
  }

  // ------------------------------------------------------------------
  // Password lifecycle
  // ------------------------------------------------------------------

  /**
   * Change one's own password. The current password is required, so a stolen
   * access token cannot be escalated into permanent control of the account.
   *
   * Every OTHER session is revoked; the caller keeps theirs, because ending the
   * session of the person who just proved they know the password would be
   * theatre rather than security.
   */
  async changePassword(
    accountId: string,
    actorId: string,
    currentPassword: string,
    newPassword: string,
    keepSessionId?: string,
  ): Promise<void> {
    const credential = await this.prisma.accountCredential.findUnique({ where: { accountId } });
    if (!credential || !(await verifyPassword(currentPassword, credential.passwordHash))) {
      throw invalidCredentials();
    }
    await this.accounts.setPassword(accountId, newPassword, {
      actorId,
      reason: 'password changed by the account holder',
      invalidateSessions: true,
      keepSessionId,
    });
  }

  /**
   * Begin a password reset.
   *
   * Returns nothing about whether the subject exists -- the caller always
   * reports the same thing -- because a forgot-password endpoint that answers
   * differently for a known subject is an account enumeration oracle.
   *
   * The token is returned to the CALLER (the controller decides whether it may
   * be surfaced) rather than delivered here: chat.account carries no contact
   * channel by design, so there is nothing in this schema to send it to.
   */
  async beginPasswordReset(subject: string): Promise<{ token: string; expiresAt: Date } | null> {
    const account = await this.prisma.account.findFirst({
      where: { subject },
      select: { id: true, status: true },
    });
    if (!account || !AccountService.isUsable(account.status)) return null;
    return this.accounts.mintToken(account.id, TokenPurpose.PASSWORD_RESET);
  }

  /**
   * Complete a password reset.
   *
   * EVERY session is revoked, including one the attacker may be holding. A
   * reset whose whole purpose is to recover a compromised account has not
   * recovered it while the intruder's token still works.
   */
  async completePasswordReset(token: string, newPassword: string): Promise<void> {
    const accountId = await this.accounts.consumeToken(token, TokenPurpose.PASSWORD_RESET);
    if (!accountId) {
      throw new AuthError(
        AuthErrorCode.INVALID_RESET_TOKEN,
        'this reset link is invalid or has expired',
        400,
      );
    }
    await this.accounts.setPassword(accountId, newPassword, {
      reason: 'password reset',
      invalidateSessions: true,
    });
  }
}
