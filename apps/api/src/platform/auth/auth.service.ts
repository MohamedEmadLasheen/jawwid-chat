import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AUDIT_SERVICE, IDENTITY_SERVICE, REALTIME_REVOCATION } from '../tokens';
import {
  NO_REALTIME_REVOCATION,
  RevocationUnconfirmedError,
  type RealtimeRevocation,
} from '../realtime-revocation';
import type { IdentityService } from '../identity.service';
import type { AuditService, Tx } from '../audit.service';
import type { Actor } from '../types';
import { AuthorizationService } from '../authorization.service';
import { accountAdminStandingOf } from '../account-admin-standing';
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
import { clientOfPlatform, sessionPolicyFor, sessionWindow, type SessionClient } from './session-policy';
import { AccountAdminScope } from '../account-admin-scope';

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

/**
 * PD-21 support sessions: each step (a fresh token from the administrator's own
 * session) gives this many minutes, never past MAX_MINUTES from the start.
 * The database states the hour too (impersonation_session_at_most_an_hour).
 */
export const SUPPORT_SESSION = { STEP_MINUTES: 15, MAX_MINUTES: 60 } as const;

/** PD-21: what a request on a support session carries beyond its actor. */
export interface SupportSessionFacts {
  /** chat.impersonation_session.id */
  readonly id: string;
  /** The administrator: staff id and account id. */
  readonly staffId: string;
  readonly staffAccountId: string;
}

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
  /** PD-23: Admin Web "keep me signed in on this device". Honoured per session-policy.ts. */
  readonly remember?: boolean;
}

/**
 * PD-23: what a refresh carries from the row it rotates. Read from the row,
 * never restated by the client, so a refresh cannot buy a longer policy.
 */
interface LoginChain {
  readonly authenticatedAt: Date;
  readonly client: SessionClient | null;
  readonly remembered: boolean;
}

/** PD-23: the revocation reason when a session reaches its policy's limit at a refresh. */
export const LIFETIME_REASON = 'session lifetime reached';

export interface AuthenticatedSession {
  readonly actor: Actor;
  readonly accountId: string;
  readonly sessionId: string;
  readonly claims: AccessClaims;
  /** PD-21: present when this is a support session -- an administrator acting as the account. */
  readonly impersonation?: SupportSessionFacts;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
  readonly sessionId: string;
  readonly sessionCreatedAt: Date;
  readonly actor: Actor;
  /** PD-23: "keep me signed in" is in effect for this session. */
  readonly remembered: boolean;
  /** PD-23: the refresh token stops working at this time unless used first. */
  readonly expiresAt: Date;
  /** PD-23: the session ends at this time however it is used; null = no absolute limit. */
  readonly absoluteExpiresAt: Date | null;
}

const PLATFORMS = new Set(['ios', 'android', 'web']);

/** PD-23: one row of a Devices & sessions list. */
export interface LiveSession {
  readonly id: string;
  readonly platform: string | null;
  readonly deviceName: string | null;
  readonly appVersion: string | null;
  /** When the password was entered for this login (not the last rotation). */
  readonly signedInAt: Date;
  readonly lastSeenAt: Date | null;
  readonly expiresAt: Date;
  readonly remembered: boolean;
}

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
/** For requests refused regardless: only an UNCONFIRMED barrier is swallowed, never another error. */
function ignoreUnconfirmed(e: unknown): void {
  if (!(e instanceof RevocationUnconfirmedError)) throw e;
}

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  private cachedConfig: AuthConfig | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    // RT-009: revocations reach sockets already open, not only the next request.
    @Optional()
    @Inject(REALTIME_REVOCATION)
    private readonly revocation: RealtimeRevocation = NO_REALTIME_REVOCATION,
    // PD-21: re-decides a support session's permission on every request.
    // Absent (a hand-built test service), every support session is refused.
    @Optional() private readonly authz?: AuthorizationService,
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
    const typed = username.trim();
    // Exactly as typed, else lower-cased: a teacher's sign-in is stored
    // lower-cased (PD-43), and an older account with capitals keeps matching
    // exactly. PasswordResetService.complete() applies the same rule.
    const exact = typed
      ? await this.prisma.account.findUnique({ where: { subject: typed }, include: { credential: true } })
      : null;
    const lower = typed.toLowerCase();
    const account =
      exact || !typed || lower === typed
        ? exact
        : await this.prisma.account.findUnique({ where: { subject: lower }, include: { credential: true } });
    const subject = account?.subject ?? typed;

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
    context: LoginContext & { deviceId?: string | null; chain?: LoginChain },
    reason: 'login' | 'refresh',
  ): Promise<TokenPair> {
    const config = this.config();
    const refreshToken = newRefreshToken();

    // PD-23: the policy is decided here, for login and refresh alike, from the
    // CURRENT principal. A login has no chain yet: its authenticated_at is the
    // column default (the database's now), and the window is counted from now.
    const now = new Date();
    const client = context.chain ? context.chain.client : clientOfPlatform(context.device?.platform);
    const policy = sessionPolicyFor(actor, client, context.chain ? context.chain.remembered : context.remember === true);
    const window = sessionWindow(policy, context.chain?.authenticatedAt ?? now, now, config.refreshTtlSeconds);
    if (window.expiresAt <= now) {
      // refresh() checks this before it rotates; reaching here is a race with
      // the clock, and the answer is the same: sign in again.
      throw new AuthError(AuthErrorCode.SESSION_REVOKED);
    }

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
          expiresAt: window.expiresAt,
          lastSeenAt: new Date(),
          ipHash: hashIp(context.ip, config.refreshSecret),
          userAgent: context.userAgent?.slice(0, 200) ?? null,
          // PD-23. authenticated_at is set only on a refresh (copied); a login
          // takes the column default, so it can never postdate created_at.
          ...(context.chain ? { authenticatedAt: context.chain.authenticatedAt } : {}),
          client,
          remembered: policy.remembered,
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
        after: {
          accountId: account.id,
          actorKind: actor.kind,
          deviceId: deviceId ?? null,
          policy: policy.name,
          expiresAt: window.expiresAt.toISOString(),
        },
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
      remembered: policy.remembered,
      expiresAt: window.expiresAt,
      absoluteExpiresAt: window.absoluteExpiresAt,
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
        impersonationId: true,
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

    // The token asserted an actor; the database decides one (gates 3 and 4).
    const actor = await this.liveActorOf(account, claims.act, claims.knd);
    if (!actor) return null;

    if (session.impersonationId) {
      const impersonation = await this.liveSupportSession(session.impersonationId, account);
      if (!impersonation) return null;
      return { actor, accountId: account.id, sessionId: session.id, claims, impersonation };
    }
    return { actor, accountId: account.id, sessionId: session.id, claims };
  }

  /**
   * PD-21, gate 5 -- for a support session only. Everything that let the
   * administrator open it must STILL hold, now:
   *   - the support session has not ended and has not expired;
   *   - the administrator's own session is live (signing out ends it);
   *   - the administrator's account and staff row are live;
   *   - canAdministerAccount still allows them to impersonate this account.
   * Anything else ends the support session on the record and refuses.
   */
  private async liveSupportSession(
    impersonationId: string,
    target: { id: string; organizationId: string; kind: string },
  ): Promise<SupportSessionFacts | null> {
    const row = await this.prisma.impersonationSession.findUnique({ where: { id: impersonationId } });
    if (!row || row.targetAccountId !== target.id || row.endedAt) return null;
    const refuse = async (why: string) => {
      await this.prisma.impersonationSession
        .updateMany({ where: { id: row.id, endedAt: null }, data: { endedAt: new Date(), endedReason: why } })
        .catch(() => undefined);
      return null;
    };
    if (row.expiresAt <= new Date()) return refuse('expired');
    if (!this.authz) return refuse('support sessions are not served here');

    const staffSession = await this.prisma.session.findUnique({
      where: { id: row.staffSessionId },
      select: {
        revokedAt: true,
        revokedReason: true,
        expiresAt: true,
        account: { select: { id: true, subject: true, kind: true, isActive: true, status: true, organizationId: true } },
      },
    });
    // Mid-refresh: the administrator's session was just rotated and refresh()
    // is about to move the support session onto its successor. Refuse THIS
    // request, but do not end the support session over it.
    if (staffSession?.revokedReason === 'rotated') return null;
    if (!staffSession || staffSession.revokedAt || staffSession.expiresAt <= new Date() || staffSession.account.id !== row.staffAccountId) {
      return refuse("the administrator's own session ended");
    }
    const staff = await this.liveActorOf(staffSession.account, row.staffId, 'staff');
    if (!staff) return refuse('the administrator is no longer active');
    const decision = this.authz.canAdministerAccount(
      staff,
      { accountId: target.id, organizationId: target.organizationId, kind: target.kind },
      'impersonate',
      await accountAdminStandingOf(this.prisma, staff),
    );
    if (!decision.allowed) return refuse('the administrator may no longer open this account');
    // TEACHER-011: a teacher account, only while the teacher stays in the administrator's scope.
    if (target.kind === 'teacher') {
      const teacher = await this.prisma.teacher.findUnique({ where: { accountId: target.id }, select: { id: true } });
      if (!(await new AccountAdminScope(this.prisma).covers(staff, { kind: target.kind, teacherId: teacher?.id }))) {
        return refuse('the teacher is no longer in the administrator\'s scope');
      }
    }
    return { id: row.id, staffId: row.staffId, staffAccountId: row.staffAccountId };
  }

  /**
   * PD-21: the TARGET-side session of a support session, inside the caller's
   * transaction. Not a login: no device, no last_login_at, no failure reset,
   * no session.created audit (the caller writes impersonation.started). Its
   * refresh token is generated and DISCARDED -- the column is NOT NULL and
   * unique -- so the session can never be refreshed; a new access token comes
   * only from the administrator's own session (signSupportAccessToken).
   */
  async openSupportSessionInTx(
    tx: Tx,
    input: { impersonationId: string; account: { id: string; organizationId: string }; expiresAt: Date },
  ): Promise<string> {
    const config = this.config();
    const created = await tx.session.create({
      data: {
        organizationId: input.account.organizationId,
        accountId: input.account.id,
        deviceId: null,
        refreshTokenHash: hashRefreshToken(newRefreshToken(), config.refreshSecret),
        expiresAt: input.expiresAt,
        lastSeenAt: new Date(),
        impersonationId: input.impersonationId,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** PD-21: an access token for a support session's target-side session. */
  signSupportAccessToken(
    account: { subject: string; organizationId: string },
    actor: Actor,
    sessionId: string,
  ): { accessToken: string; expiresInSeconds: number } {
    const config = this.config();
    const accessToken = signAccessToken(
      { sub: account.subject, sid: sessionId, act: actor.actorId, knd: actor.kind, org: actor.organizationId ?? account.organizationId },
      config,
    );
    return { accessToken, expiresInSeconds: config.accessTtlSeconds };
  }

  /**
   * RT-009. The realtime re-check: is each socket's identity still entitled to
   * live data, as of NOW?
   *
   * A socket outlives its access token (15 minutes) by design -- disconnecting
   * on token expiry would churn every mobile client -- so it cannot re-run
   * `authenticate()`. It re-runs the same gates from the database instead:
   *   - SESSION-PRECISE: one of the socket's OWN sessions -- the one it
   *     connected with, or a successor `refresh` rebound it to -- is still
   *     live and belongs to its account. Another live session of the same
   *     account never vouches for it: logging out one device ends that
   *     device's sockets even while another device stays signed in;
   *   - the account is active (gate 3);
   *   - the principal still resolves, is active, and is the SAME actor the
   *     socket connected as (gate 4), read fresh -- a role change, a
   *     deactivation or a withdrawn contact is never answered from the socket.
   *
   * Batched: one session query for every socket asked about, one principal
   * resolution per distinct account. Returns, per input index, the CURRENT
   * actor or null. Fails closed: anything not established is null.
   */
  async revalidateRealtime(
    sockets: ReadonlyArray<{ accountId: string; sessionIds: readonly string[]; actorId: string; kind: string }>,
  ): Promise<Array<Actor | null>> {
    const sessionIds = [...new Set(sockets.flatMap((s) => s.sessionIds))];
    if (sessionIds.length === 0) return sockets.map(() => null);
    const live = await this.prisma.session.findMany({
      where: { id: { in: sessionIds }, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        accountId: true,
        account: {
          select: { id: true, subject: true, kind: true, isActive: true, status: true, organizationId: true },
        },
      },
    });
    const byId = new Map(live.map((row) => [row.id, row]));
    const actorByAccount = new Map<string, Promise<Actor | null>>();
    return Promise.all(
      sockets.map(async (s) => {
        const session = s.sessionIds.map((id) => byId.get(id)).find((row) => row?.accountId === s.accountId);
        if (!session) return null;
        const key = `${s.accountId}:${s.actorId}:${s.kind}`;
        if (!actorByAccount.has(key)) actorByAccount.set(key, this.liveActorOf(session.account, s.actorId, s.kind));
        return (await actorByAccount.get(key)) ?? null;
      }),
    );
  }

  /**
   * Gates 3 and 4, in ONE place, for both callers above: the account is
   * active, its principal resolves and is active, and it is the actor that was
   * asserted. A disagreement means stale or tampered -- refuse rather than
   * prefer either side.
   */
  private async liveActorOf(
    account: { id: string; subject: string; kind: string; isActive: boolean; status: string; organizationId: string },
    actorId: string,
    kind: string,
  ): Promise<Actor | null> {
    if (!account.isActive || account.status !== ACTIVE_STATUS) return null;
    const actor = await this.identity.resolveForAccount(account);
    if (!actor || !actor.isActive) return null;
    if (actor.actorId !== actorId || actor.kind !== kind) return null;
    return actor;
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
    // PD-21: a support session has no refresh token to present. Belt and braces.
    if (session.impersonationId) throw new AuthError(AuthErrorCode.SESSION_REVOKED);

    const account = session.account;
    if (!account.isActive || account.status !== ACTIVE_STATUS) {
      await this.revokeBeforeRefusing(session.id, 'account is not active');
      throw new AuthError(AuthErrorCode.ACCOUNT_DISABLED);
    }

    const actor = await this.identity.resolveForAccount(account);
    if (!actor || !actor.isActive) {
      await this.revokeBeforeRefusing(session.id, 'principal is not active');
      throw new AuthError(AuthErrorCode.ACCOUNT_DISABLED);
    }

    // PD-23: would the successor still be inside its policy? Decided BEFORE the
    // rotation: a row retired as 'rotated' and then refused would leave the
    // client holding a rotated token, and presenting that again reads as theft.
    const chain: LoginChain = {
      authenticatedAt: session.authenticatedAt,
      client: session.client === 'app' || session.client === 'web' ? session.client : null,
      remembered: session.remembered,
    };
    const now = new Date();
    const policy = sessionPolicyFor(actor, chain.client, chain.remembered);
    if (sessionWindow(policy, chain.authenticatedAt, now, config.refreshTtlSeconds).expiresAt <= now) {
      await this.revokeBeforeRefusing(session.id, LIFETIME_REASON);
      throw new AuthError(AuthErrorCode.SESSION_REVOKED);
    }

    // Retire the presented session and mint its successor. Two transactions,
    // each internally atomic: the rotation is recorded before the new session
    // exists, so an interruption between them leaves the caller logged out
    // rather than holding two live sessions.
    await this.revoke(session.id, 'rotated', undefined, actor.actorId);
    const pair = await this.issue(account, actor, { ...context, deviceId: session.deviceId, chain }, 'refresh');
    // RT-009: rotation is the same login continuing, not a revocation. Sockets
    // bound to the retired session now also answer to its successor, so a
    // later logout of the successor still reaches them.
    this.revocation.sessionRotated(session.id, pair.sessionId);
    // PD-21: a support session started from this session follows it to its
    // successor (the database allows that move through a rotation only).
    await this.prisma.impersonationSession.updateMany({
      where: { staffSessionId: session.id, endedAt: null },
      data: { staffSessionId: pair.sessionId },
    });
    return pair;
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
    // RT-009: committed above, so enforce it on sockets already open, and fence
    // every node. This request is refused whatever happens, so an unconfirmed
    // barrier changes nothing it reports -- it is attempted, not required.
    this.revocation.disconnectAccount(accountId);
    await this.revocation.confirmRevoked().catch(ignoreUnconfirmed);
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
    const revoked = await this.prisma.$transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason, revokedBy: revokedBy ?? null },
      });

      // IDEMPOTENT, AND HONESTLY SO. A second logout finds nothing live and
      // writes NO audit row, because nothing changed -- an audit trail that
      // records a revocation that did not happen is worse than one that is
      // quiet. API-CONTRACT §3.1 keeps the response {ok:true} either way.
      if (result.count === 0) return false;

      await this.audit.audit(tx, {
        actorId: actorId ?? revokedBy ?? null,
        action: AUDIT_ACTION.SESSION_REVOKED,
        entity: 'session',
        entityId: sessionId,
        after: { revokedBy: revokedBy ?? null },
        reason,
      });
      return true;
    });
    // RT-009: a real revocation (logout, a disabled account or principal)
    // ends the sockets bound to this session. Rotation is NOT a revocation --
    // `refresh` rebinds those sockets to the successor instead.
    if (reason === 'rotated') return;
    if (revoked) this.revocation.disconnectSessions([sessionId]);
    // The completion barrier -- also when nothing was live, since this may be
    // the retry of a revocation that committed and was not confirmed. Throws
    // RevocationUnconfirmedError (503) rather than report an unconfirmed end.
    await this.revocation.confirmRevoked();
  }

  /** A revocation on a request that is refused anyway: its barrier cannot change the answer. */
  private async revokeBeforeRefusing(sessionId: string, reason: string): Promise<void> {
    await this.revoke(sessionId, reason).catch(ignoreUnconfirmed);
  }

  async revokeAllForAccount(accountId: string, reason: string): Promise<void> {
    const revoked = await this.prisma.$transaction((tx) => this.revokeAccountSessionsInTx(tx, accountId, reason));
    await this.enforceAccountRevocation(accountId, revoked > 0);
  }

  /**
   * PD-21: every live session of an account, revoked INSIDE the caller's
   * transaction -- so a password reset or a suspension and the end of the
   * sessions it implies commit together or not at all. Returns how many were
   * live. The caller MUST follow the commit with enforceAccountRevocation().
   *
   * `revokedBy` is the administrator's ACCOUNT id (chat.session.revoked_by
   * references chat.account); `actorId` their staff id, for the audit row.
   */
  async revokeAccountSessionsInTx(
    tx: Tx,
    accountId: string,
    reason: string,
    by?: { revokedBy: string; actorId: string },
  ): Promise<number> {
    const result = await tx.session.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason, revokedBy: by?.revokedBy ?? null },
    });
    if (result.count === 0) return 0;

    await this.audit.audit(tx, {
      actorId: by?.actorId ?? null,
      action: AUDIT_ACTION.SESSION_REVOKED,
      entity: 'account',
      entityId: accountId,
      after: { revokedSessions: result.count },
      reason,
    });
    return result.count;
  }

  /**
   * RT-009: every session is gone, so every socket of the account goes too;
   * and, as for a single session, not reported complete until confirmed --
   * also when nothing was live, since this may be a retry.
   */
  async enforceAccountRevocation(accountId: string, revokedAny: boolean): Promise<void> {
    if (revokedAny) this.revocation.disconnectAccount(accountId);
    await this.revocation.confirmRevoked();
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
  // Devices & sessions (PD-23)
  // -------------------------------------------------------------------------

  /**
   * The account's live sessions: one row per signed-in device or browser.
   * Rotation retires rows as it goes, so "live" is already one row per login.
   *
   * Support sessions (PD-21) are NOT listed: they are an administrator's, they
   * end with the administrator's own session, and the person cannot end them
   * from here. Their record is chat.impersonation_session.
   */
  async listLiveSessions(accountId: string): Promise<LiveSession[]> {
    const rows = await this.prisma.session.findMany({
      where: { accountId, revokedAt: null, expiresAt: { gt: new Date() }, impersonationId: null },
      select: {
        id: true,
        authenticatedAt: true,
        lastSeenAt: true,
        expiresAt: true,
        client: true,
        remembered: true,
        device: { select: { platform: true, name: true, appVersion: true } },
      },
      orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { authenticatedAt: 'desc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      platform: row.device?.platform ?? (row.client === 'web' ? 'web' : null),
      deviceName: row.device?.name ?? null,
      appVersion: row.device?.appVersion ?? null,
      signedInAt: row.authenticatedAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
      remembered: row.remembered,
    }));
  }

  /**
   * Ends ONE live session of `accountId`. False when the account has no such
   * live session -- which the callers answer as not found, so a session id of
   * another account is indistinguishable from a made-up one.
   *
   * `revokedBy` is the ACCOUNT that asked (the holder, or an administrator):
   * chat.session.revoked_by references chat.account.
   */
  async revokeSessionOf(
    accountId: string,
    sessionId: string,
    reason: string,
    by: { revokedBy: string; actorId: string },
  ): Promise<boolean> {
    const owned = await this.prisma.session.findFirst({
      where: { id: sessionId, accountId, revokedAt: null, impersonationId: null },
      select: { id: true },
    });
    if (!owned) return false;
    await this.revoke(sessionId, reason, by.revokedBy, by.actorId);
    return true;
  }

  /**
   * "Sign out all other devices": every live session of the account except
   * `keepSessionId`, in ONE transaction with its audit row. Support sessions
   * are left to their administrator (see listLiveSessions).
   */
  async revokeOtherSessions(
    accountId: string,
    keepSessionId: string,
    reason: string,
    by: { revokedBy: string; actorId: string },
  ): Promise<number> {
    const ids = await this.prisma.$transaction(async (tx) => {
      const live = await tx.session.findMany({
        where: { accountId, revokedAt: null, impersonationId: null, id: { not: keepSessionId } },
        select: { id: true },
      });
      if (live.length === 0) return [];
      const targets = live.map((row) => row.id);
      await tx.session.updateMany({
        where: { id: { in: targets }, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason, revokedBy: by.revokedBy },
      });
      await this.audit.audit(tx, {
        actorId: by.actorId,
        action: AUDIT_ACTION.SESSION_REVOKED,
        entity: 'account',
        entityId: accountId,
        after: { revokedSessions: targets.length, kept: keepSessionId },
        reason,
      });
      return targets;
    });
    // RT-009: the sockets of exactly those sessions -- not the account's, which
    // would also end the device that asked.
    if (ids.length > 0) this.revocation.disconnectSessions(ids);
    await this.revocation.confirmRevoked();
    return ids.length;
  }

  // -------------------------------------------------------------------------
  // Provisioning
  // -------------------------------------------------------------------------

  /**
   * Sets an account's password. NOT an endpoint: there is no public
   * registration and no self-service reset in the MVP (PRD §7.1), so this is
   * reached only from seeds, tests and manager-driven provisioning. The
   * administrator-issued reset (PD-21) is PasswordResetService, which also
   * revokes the account's sessions; this does not.
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
