import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AUDIT_SERVICE, IDENTITY_SERVICE } from '../tokens';
import type { IdentityService } from '../identity.service';
import type { AuditService, Tx } from '../audit.service';
import type { Actor } from '../types';
import { AuthError, AuthErrorCode } from './auth.errors';
import { AuthConfig, loadAuthConfig } from './auth.config';
import {
  AccessClaims,
  hashIp,
  hashRefreshToken,
  newRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from './jwt';
import { hashPassword, spendComparableTime, verifyPassword } from './password';
import { subjectHash } from './subject-hash';

/**
 * The canonical event and action names (API-CONTRACT §3.1). Constants so a
 * typo cannot silently write an event nobody queries -- and because the
 * chat.event_log CHECK constraint admits exactly these two auth values
 * (20260912090000), a wrong string fails at the database rather than at review.
 */
export const AUTH_EVENT = {
  LOGIN_FAILED: 'auth.login_failed',
  REFRESH_REUSE_DETECTED: 'auth.refresh_reuse_detected',
} as const;

export const AUDIT_ACTION = {
  SESSION_CREATED: 'session.created',
  SESSION_REVOKED: 'session.revoked',
} as const;

/** Lockout policy. Beside the credential row, not in Redis: a lockout that
 *  disappears when the cache restarts is not a lockout. */
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MINUTES = 15;

/** Statuses that may hold a session. Anything else is refused everywhere. */
const ACTIVE_STATUS = 'active';

/** The revocation reason a reuse sweep writes. Read back by the audit tests. */
export const REUSE_REASON = 'refresh reuse detected';

export interface DeviceInput {
  readonly platform?: string;
  readonly name?: string;
  readonly appVersion?: string;
}

export interface LoginContext {
  readonly userAgent?: string;
  readonly ip?: string;
  readonly device?: DeviceInput;
}

export interface AuthenticatedSession {
  readonly actor: Actor;
  readonly accountId: string;
  readonly sessionId: string;
  readonly claims: AccessClaims;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
  readonly sessionId: string;
  readonly sessionCreatedAt: Date;
  readonly actor: Actor;
}

const PLATFORMS = new Set(['ios', 'android', 'web']);

/**
 * Runtime authentication (PR-B).
 *
 * Built on the PR-A schema (`chat.account_credential`, `chat.session`,
 * `chat.device`, `chat.teacher`), which this adds no DDL to.
 *
 * THE ONE RULE: identity derives exclusively from a verified credential --
 * a password at login, a session row at refresh, a signed token afterwards.
 * `x-actor-id` is not read anywhere in this file, in the guard, or in the
 * decorator (AUTH-INV-1).
 *
 * Every request re-reads the session and the principal. That is one indexed
 * lookup per request, and it is what makes logout, revocation and deactivation
 * take effect immediately rather than at token expiry (IDENTITY-MODEL §2).
 */
@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  private cachedConfig: AuthConfig | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /**
   * Resolved lazily and then cached, so a unit test can set the environment
   * before the first call. Failure throws AuthConfigurationError, which
   * main.ts also triggers at boot so a bad deployment never reaches a request.
   */
  private config(): AuthConfig {
    this.cachedConfig ??= loadAuthConfig();
    return this.cachedConfig;
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  /**
   * `username` on the wire is `chat.account.subject`
   * (`authentication-decision-gate.md` §5: there is no username column and no
   * email column; the subject is the login identifier).
   */
  async login(username: string, password: string, context: LoginContext = {}): Promise<TokenPair> {
    const subject = username.trim();

    const account = subject
      ? await this.prisma.account.findUnique({
          where: { subject },
          include: { credential: true },
        })
      : null;

    if (!account || !account.credential) {
      // Spend a real Argon2id verification so an unknown subject costs the same
      // as a known one. Without this the response time enumerates accounts.
      await spendComparableTime(password);
      await this.recordLoginFailure(null, subject, 'invalid_credentials');
      throw new AuthError(AuthErrorCode.INVALID_CREDENTIALS);
    }

    // Lockout is checked BEFORE the password: a locked account must not be a
    // free password oracle, and checking it first also stops the attempt
    // counter from being pushed further by an attacker who is already locked.
    if (account.credential.lockedUntil && account.credential.lockedUntil > new Date()) {
      await this.recordLoginFailure(account.id, subject, 'account_locked');
      throw new AuthError(AuthErrorCode.ACCOUNT_LOCKED);
    }

    // OUTSIDE any transaction, deliberately. Argon2id at m=19456 takes ~200ms;
    // holding a pooled database connection for that would turn the login path
    // into a connection-pool exhaustion vector under load.
    if (!(await verifyPassword(password, account.credential.passwordHash))) {
      await this.recordLoginFailure(
        account.id,
        subject,
        'invalid_credentials',
        account.credential.failedAttempts,
      );
      throw new AuthError(AuthErrorCode.INVALID_CREDENTIALS);
    }

    // The password was right. From here the codes may distinguish causes: the
    // caller has already proven they hold the credential, so telling them the
    // account is disabled discloses nothing they could not learn by asking a
    // manager -- and the client needs it to show a terminal message (§7).
    if (!account.isActive || account.status !== ACTIVE_STATUS) {
      await this.clearFailures(account.id);
      await this.recordLoginFailure(account.id, subject, 'account_disabled');
      throw new AuthError(AuthErrorCode.ACCOUNT_DISABLED);
    }

    const actor = await this.identity.resolveForAccount(account);
    if (!actor) {
      // An account with a credential but no principal is a provisioning defect,
      // not a client error. Logged with the account id only -- never the
      // subject, which is the login identifier.
      this.log.error(`account ${account.id} authenticated but resolves to no principal`);
      await this.recordLoginFailure(account.id, subject, 'no_principal');
      throw new AuthError(AuthErrorCode.ACCOUNT_DISABLED);
    }
    if (!actor.isActive) {
      await this.recordLoginFailure(account.id, subject, 'principal_inactive');
      throw new AuthError(AuthErrorCode.ACCOUNT_DISABLED);
    }

    return this.issue(account, actor, context, 'login');
  }

  /**
   * The failed-login record (API-CONTRACT §3.1).
   *
   * ONE TRANSACTION with the attempt counter it increments, so a lockout can
   * never advance without the event that explains it, and an event can never
   * claim an increment that rolled back.
   *
   * The payload carries a HASH of the submitted identifier and a reason code,
   * never the raw subject and never anything derived from the password. An
   * unknown subject is recorded too -- that is precisely the row that shows a
   * spray -- but with accountId null, because there is no account to name.
   */
  private async recordLoginFailure(
    accountId: string | null,
    subject: string,
    reason: string,
    previousAttempts?: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (accountId !== null && previousAttempts !== undefined) {
        const attempts = previousAttempts + 1;
        await tx.accountCredential.update({
          where: { accountId },
          data: {
            failedAttempts: attempts,
            lockedUntil:
              attempts >= MAX_FAILED_ATTEMPTS
                ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
                : null,
          },
        });
      }

      await this.audit.event(tx, {
        // `system`: a failed login has no authenticated principal by
        // definition, and event_log.actor_type admits only
        // contact|staff|teacher|system.
        actorKind: 'system',
        actorId: null,
        type: AUTH_EVENT.LOGIN_FAILED,
        payload: { subjectHash: subjectHash(subject), reason, accountId },
      });
    });
  }

  private async clearFailures(accountId: string): Promise<void> {
    await this.prisma.accountCredential.update({
      where: { accountId },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  }

  /**
   * A device record per login (PRD §7.1; API-CONTRACT §3.1 sends
   * `{platform, name?}`). PR-A deliberately put no unique key on chat.device,
   * leaving "does a returning device reuse its row" to this PR: it does, matched
   * on (account, platform, name), so a phone that signs in twice does not
   * accumulate rows. `name` is a label such as "iPhone" and is never a contact
   * channel (BR-2).
   */
  private async upsertDevice(
    tx: Tx,
    accountId: string,
    organizationId: string,
    device?: DeviceInput,
  ): Promise<string | null> {
    if (!device?.platform || !PLATFORMS.has(device.platform)) return null;

    const name = device.name?.slice(0, 120) ?? null;
    const existing = await tx.device.findFirst({
      where: { accountId, platform: device.platform, name },
      select: { id: true },
    });

    if (existing) {
      await tx.device.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), appVersion: device.appVersion?.slice(0, 40) ?? null },
      });
      return existing.id;
    }

    const created = await tx.device.create({
      data: {
        // SET EXPLICITLY, not left to the column default. The default is
        // chat.default_organization_id(), which is the DEFAULT tenant -- not
        // this account's. Relying on it stamps every device and session of
        // every other organization with the wrong tenant, and the restrictive
        // `organization_id = chat.current_organization_id()` policy would then
        // hide the row from the tenant that owns it the moment RLS is engaged.
        organizationId,
        accountId,
        platform: device.platform,
        name,
        appVersion: device.appVersion?.slice(0, 40) ?? null,
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * Mints a session. ONE TRANSACTION covering the device row, the session row,
   * the lastLoginAt stamp, the cleared failure counter and the audit entry.
   *
   * IDENTITY-MODEL §6: the audit entry belongs "in the same transaction" as the
   * action it records. If the audit write fails, the session is not created --
   * which is the correct direction to fail. A session nobody can account for is
   * worse than a login that has to be retried.
   *
   * The token is signed AFTER the transaction commits, from the row it
   * returned, so a token can never reference a session that was rolled back.
   */
  private async issue(
    account: { id: string; organizationId: string; subject: string },
    actor: Actor,
    context: LoginContext & { deviceId?: string | null },
    reason: 'login' | 'refresh',
  ): Promise<TokenPair> {
    const config = this.config();
    const refreshToken = newRefreshToken();

    const session = await this.prisma.$transaction(async (tx) => {
      if (reason === 'login') {
        await tx.accountCredential.update({
          where: { accountId: account.id },
          data: { failedAttempts: 0, lockedUntil: null },
        });
        await tx.account.update({
          where: { id: account.id },
          data: { lastLoginAt: new Date() },
        });
      }

      const deviceId =
        context.deviceId ??
        (await this.upsertDevice(tx, account.id, account.organizationId, context.device));

      const created = await tx.session.create({
        data: {
          // Explicit, for the reason given in upsertDevice: the column default is
          // the DEFAULT organization, not this account's.
          organizationId: account.organizationId,
          accountId: account.id,
          deviceId: deviceId ?? null,
          refreshTokenHash: hashRefreshToken(refreshToken, config.refreshSecret),
          expiresAt: new Date(Date.now() + config.refreshTtlSeconds * 1000),
          lastSeenAt: new Date(),
          ipHash: hashIp(context.ip, config.refreshSecret),
          userAgent: context.userAgent?.slice(0, 200) ?? null,
        },
        select: { id: true, createdAt: true },
      });

      // API-CONTRACT §3.1: audit_log {action:'session.created', entity:'session',
      // entityId, actorId, reason:'login'}.
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: AUDIT_ACTION.SESSION_CREATED,
        entity: 'session',
        entityId: created.id,
        // No token, no hash, no subject. Only what an incident review needs to
        // place the session: who, as what, on what kind of device.
        after: { accountId: account.id, actorKind: actor.kind, deviceId: deviceId ?? null },
        reason,
      });

      return created;
    });

    const accessToken = signAccessToken(
      {
        // `sub` is the account SUBJECT, not the account id: it is the canonical
        // login identifier, and it is what a future Core OIDC `sub` would map
        // onto (IDENTITY-MODEL §4.1).
        sub: account.subject,
        sid: session.id,
        act: actor.actorId,
        knd: actor.kind,
        org: actor.organizationId ?? account.organizationId,
      },
      config,
    );

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: config.accessTtlSeconds,
      sessionId: session.id,
      sessionCreatedAt: session.createdAt,
      actor,
    };
  }

  // -------------------------------------------------------------------------
  // Bearer verification -- the production identity chain
  // -------------------------------------------------------------------------

  /**
   * Bearer JWT -> verified `sub` -> chat.account.subject -> account -> actor.
   *
   * Four gates, all required:
   *   1. the signature, issuer, audience and expiry verify;
   *   2. the session row is live (not revoked, not expired) and belongs to the
   *      same account the token names;
   *   3. the account is still active;
   *   4. the principal still resolves and is still active.
   *
   * Gate 2 is what makes logout immediate. Gates 3 and 4 are what make
   * deactivation immediate. The token's claims are used to FIND rows, never to
   * assert anything: `act` is checked against the principal the account
   * actually resolves to, so a token whose actor claim was tampered with (and
   * somehow signed) still cannot act as that actor.
   */
  async authenticate(token: string): Promise<AuthenticatedSession | null> {
    const result = verifyAccessToken(token, this.config());
    if (!result.ok) {
      this.log.debug(`bearer refused: ${result.reason}`);
      return null;
    }
    const claims = result.claims;

    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        accountId: true,
        account: {
          select: { id: true, subject: true, kind: true, isActive: true, status: true, organizationId: true },
        },
      },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

    const account = session.account;
    // The session must belong to the account the token names. Without this a
    // valid token for account A plus a session id belonging to B would pass.
    if (account.subject !== claims.sub) return null;
    if (!account.isActive || account.status !== ACTIVE_STATUS) return null;

    const actor = await this.identity.resolveForAccount(account);
    if (!actor || !actor.isActive) return null;

    // The token asserted an actor; the database decided one. If they disagree,
    // the token is stale or tampered with -- refuse rather than prefer either.
    if (actor.actorId !== claims.act || actor.kind !== claims.knd) return null;

    return { actor, accountId: account.id, sessionId: session.id, claims };
  }

  /** Best-effort liveness marker. Never blocks or fails a request. */
  async touchSession(sessionId: string): Promise<void> {
    try {
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { lastSeenAt: new Date() },
      });
    } catch {
      /* a session revoked between authenticate() and here is not an error */
    }
  }

  // -------------------------------------------------------------------------
  // Refresh
  // -------------------------------------------------------------------------

  /**
   * Rotation with reuse detection (API-CONTRACT §3.1).
   *
   * The presented token is retired as it is used, so a stolen one is useful at
   * most once. Presenting an ALREADY-ROTATED token revokes the whole session:
   * that can only happen if two parties hold the same token, which means one of
   * them stole it, and ending the session is how the theft stops being useful.
   */
  async refresh(refreshToken: string, context: LoginContext = {}): Promise<TokenPair> {
    const config = this.config();
    const presented = refreshToken.trim();
    if (!presented) throw new AuthError(AuthErrorCode.SESSION_REVOKED);

    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(presented, config.refreshSecret) },
      include: { account: true },
    });

    if (!session) throw new AuthError(AuthErrorCode.SESSION_REVOKED);

    if (session.revokedAt) {
      // REUSE. If it was retired by rotation, the legitimate holder has a newer
      // token and this presenter should not exist. Revoke every live session on
      // the account, not just this one -- the attacker may already have rotated
      // into a session of their own.
      if (session.revokedReason === 'rotated') {
        await this.handleRefreshReuse(session.id, session.accountId);
      }
      throw new AuthError(AuthErrorCode.SESSION_REVOKED);
    }

    if (session.expiresAt <= new Date()) throw new AuthError(AuthErrorCode.SESSION_REVOKED);

    const account = session.account;
    if (!account.isActive || account.status !== ACTIVE_STATUS) {
      await this.revoke(session.id, 'account is not active');
      throw new AuthError(AuthErrorCode.ACCOUNT_DISABLED);
    }

    const actor = await this.identity.resolveForAccount(account);
    if (!actor || !actor.isActive) {
      await this.revoke(session.id, 'principal is not active');
      throw new AuthError(AuthErrorCode.ACCOUNT_DISABLED);
    }

    // Retire the presented session and mint its successor. Two transactions,
    // each internally atomic: the rotation is recorded before the new session
    // exists, so an interruption between them leaves the caller logged out
    // rather than holding two live sessions.
    await this.revoke(session.id, 'rotated', undefined, actor.actorId);
    return this.issue(account, actor, { ...context, deviceId: session.deviceId }, 'refresh');
  }

  /**
   * Refresh-token reuse: the single most important thing this service records.
   *
   * Two parties presented the same rotated token, so one of them stole it.
   * ONE TRANSACTION revokes every live session on the account AND writes the
   * canonical `auth.refresh_reuse_detected` event plus an audit row. If the
   * event cannot be written the revocation rolls back -- because a mass
   * revocation nobody can explain is an incident that has already been lost.
   *
   * Before PR-B's audit work this was a Logger.warn and nothing else: the theft
   * was detected, acted on, and then forgotten.
   */
  private async handleRefreshReuse(sessionId: string, accountId: string): Promise<void> {
    this.log.warn(
      `refresh reuse detected on session ${sessionId}; revoking all sessions for the account`,
    );

    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.session.updateMany({
        where: { accountId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedReason: REUSE_REASON,
        },
      });

      await this.audit.event(tx, {
        actorKind: 'system',
        actorId: null,
        type: AUTH_EVENT.REFRESH_REUSE_DETECTED,
        // No token and no hash of one: the replayed value is a live credential
        // for as long as it is written down anywhere.
        payload: { accountId, sessionId, revokedSessions: revoked.count },
      });

      await this.audit.audit(tx, {
        actorId: null,
        action: AUDIT_ACTION.SESSION_REVOKED,
        entity: 'account',
        entityId: accountId,
        after: { revokedSessions: revoked.count, trigger: sessionId },
        reason: REUSE_REASON,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Revocation
  // -------------------------------------------------------------------------

  /**
   * `chat.session` carries `check ((revoked_at is null) = (revoked_reason is
   * null))`, so a reason is not optional -- the database refuses a revocation
   * that does not say why.
   */
  async revoke(
    sessionId: string,
    reason: string,
    revokedBy?: string,
    actorId?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason, revokedBy: revokedBy ?? null },
      });

      // IDEMPOTENT, AND HONESTLY SO. A second logout finds nothing live and
      // writes NO audit row, because nothing changed -- an audit trail that
      // records a revocation that did not happen is worse than one that is
      // quiet. API-CONTRACT §3.1 keeps the response {ok:true} either way.
      if (result.count === 0) return;

      await this.audit.audit(tx, {
        actorId: actorId ?? revokedBy ?? null,
        action: AUDIT_ACTION.SESSION_REVOKED,
        entity: 'session',
        entityId: sessionId,
        after: { revokedBy: revokedBy ?? null },
        reason,
      });
    });
  }

  async revokeAllForAccount(accountId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: { accountId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
      if (result.count === 0) return;

      await this.audit.audit(tx, {
        actorId: null,
        action: AUDIT_ACTION.SESSION_REVOKED,
        entity: 'account',
        entityId: accountId,
        after: { revokedSessions: result.count },
        reason,
      });
    });
  }

  /**
   * Idempotent by nature: a second call finds nothing live and still succeeds.
   *
   * API-CONTRACT §3.1: audit_log {action:'session.revoked', entity:'session',
   * entityId, reason:'logout'}.
   */
  async logout(sessionId: string, actorId?: string): Promise<void> {
    await this.revoke(sessionId, 'logout', undefined, actorId);
  }

  // -------------------------------------------------------------------------
  // Provisioning
  // -------------------------------------------------------------------------

  /**
   * Sets an account's password. NOT an endpoint: there is no public
   * registration and no self-service reset in the MVP (PRD §7.1), so this is
   * reached only from seeds, tests and manager-driven provisioning.
   */
  async setPassword(accountId: string, plain: string): Promise<void> {
    const passwordHash = await hashPassword(plain);
    await this.prisma.accountCredential.upsert({
      where: { accountId },
      create: { accountId, passwordHash },
      update: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
  }
}
