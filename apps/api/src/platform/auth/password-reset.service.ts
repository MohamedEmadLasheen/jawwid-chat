import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AUDIT_SERVICE } from '../tokens';
import type { AuditService } from '../audit.service';
import { AuthError, AuthErrorCode } from './auth.errors';
import { AuthService } from './auth.service';
import { hashPassword, spendComparableTime } from './password';
import { isPasswordLengthAcceptable } from './password-policy';
import { MIN_SECRET_LENGTH } from './auth.config';
import { RevocationUnconfirmedError } from '../realtime-revocation';

/** How long a code lives: long enough to be passed on by hand. */
export const RESET_CODE_MINUTES = 10;
/** PD-43: how long a first sign-in code lives -- a new person may not open the app the same day. */
export const FIRST_LOGIN_CODE_HOURS = 72;
/** Wrong tries before a code is spent and the administrator must issue another. */
export const RESET_CODE_TRIES = 5;
/** Codes one account may be issued in an hour, whoever issues them. */
export const RESET_CODES_PER_HOUR = 10;

export const RESET_AUDIT = {
  ISSUED: 'account.password_reset_issued',
  COMPLETED: 'account.password_reset_completed',
  /** PD-25: a parent asked for a code, and one was sent to the contact method on file. */
  RECOVERY_SENT: 'account.recovery_code_sent',
  /** PD-43: a first sign-in code for an account that has never signed in. Completing it writes `account.activated` (SQL). */
  FIRST_LOGIN_ISSUED: 'account.first_login_code_issued',
} as const;

/**
 * PD-43: what a code is for. `reset` -- a new password for an account in use
 * (PD-21, PD-25). `first_login` -- the first password of a provisioned account;
 * completing it also activates the account (chat.activate_account_with_code).
 * Kind-agnostic: teachers now, PD-40's staff accounts later.
 */
export type ResetCodePurpose = 'reset' | 'first_login';

/** PD-25: where a code the parent asked for is sent. */
export type RecoveryChannel = 'email' | 'whatsapp';
/** PD-25: codes a parent may ask for in an hour, by either channel. */
export const RECOVERY_CODES_PER_HOUR = 5;
/** PD-25: the shortest wait between two codes a parent asks for (the app's "Resend" countdown). */
export const RECOVERY_RESEND_SECONDS = 60;

/** The revocation reason a completed reset writes on every session it ends. */
export const RESET_REVOCATION_REASON = 'password reset';

export interface IssueResetInput {
  readonly accountId: string;
  readonly organizationId: string;
  /** The administrator: staff id (audit actor, chat.password_reset_code.issued_by)... */
  readonly issuedByStaffId: string;
  /** ...and account id (chat.session.revoked_by, when signing out everywhere now). */
  readonly issuedByAccountId: string;
  readonly reason: string;
  /** End every session now, before the person has chosen a new password (a compromised account). */
  readonly signOutEverywhere: boolean;
  /** PD-43: `first_login` for an account that has never signed in. Default `reset`. */
  readonly purpose?: ResetCodePurpose;
}

/**
 * PD-21: an administrator resets another account's password, and NEVER LEARNS
 * A PASSWORD.
 *
 *   1. issue()    -- AccountAdminService, after AuthorizationService allowed it.
 *                    A 6-digit code (10 minutes, 5 tries) is returned ONCE to
 *                    the administrator, who passes it on by hand. Only its hash
 *                    is kept; any earlier live code is superseded.
 *   2. complete() -- public. The person sends their login, the code and the
 *                    password they chose. In ONE transaction: the code is spent,
 *                    the password set, the lockout cleared, every session of
 *                    the account revoked, and the reset audited. The client then
 *                    signs in through POST /auth/login like anyone else.
 *
 * The old password keeps working until step 2, unless the administrator chose
 * to sign the account out everywhere at step 1 -- then nothing works until the
 * person finishes the reset.
 *
 * PD-43 adds a purpose: a `first_login` code (72 hours) is how a new account
 * gets its first password, and completing it activates the account, in the
 * same transaction, through chat.activate_account_with_code -- the only way the
 * database lets an account move from provisioned to active.
 *
 * PD-25 adds the parent's own way in: issueRecovery() stores a code the parent
 * asked for (channel email / whatsapp, no issuer) for AccountRecoveryService to
 * send, and confirmRecovery() checks a WhatsApp code without spending it. Both
 * end at the same complete().
 *
 * NO ENUMERATION. complete() refuses with one code whether the login is
 * unknown, the code wrong, spent or expired, and spends a real Argon2id hash on
 * every refusal so timing does not tell them apart. The controller spends the
 * login limiter (per identifier and per source) before anything else.
 */
@Injectable()
export class PasswordResetService {
  private readonly log = new Logger('PasswordReset');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** Returns the plain code: the ONLY time it exists outside the person's hands. */
  async issue(input: IssueResetInput): Promise<{ code: string; expiresAt: Date; revokedSessions: number }> {
    const recent = await this.prisma.passwordResetCode.count({
      where: { accountId: input.accountId, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= RESET_CODES_PER_HOUR) throw new AuthError(AuthErrorCode.RATE_LIMITED, 3600);

    const purpose: ResetCodePurpose = input.purpose ?? 'reset';
    const code = newCode();
    const expiresAt = new Date(
      Date.now() + (purpose === 'first_login' ? FIRST_LOGIN_CODE_HOURS * 3_600_000 : RESET_CODE_MINUTES * 60_000),
    );
    const { id, revoked } = await this.prisma.$transaction(async (tx) => {
      // A reissue kills every live code, and the audit names them.
      const superseded = await tx.passwordResetCode.findMany({
        where: { accountId: input.accountId, usedAt: null, supersededAt: null },
        select: { id: true },
      });
      await tx.passwordResetCode.updateMany({
        where: { accountId: input.accountId, usedAt: null, supersededAt: null },
        data: { supersededAt: new Date() },
      });
      const row = await tx.passwordResetCode.create({
        data: {
          organizationId: input.organizationId,
          accountId: input.accountId,
          issuedBy: input.issuedByStaffId,
          codeHash: resetCodeHash(input.accountId, code, purpose),
          reason: input.reason,
          expiresAt,
          purpose,
        },
        select: { id: true },
      });
      const revokedSessions = input.signOutEverywhere
        ? await this.auth.revokeAccountSessionsInTx(tx, input.accountId, 'password reset issued', {
            revokedBy: input.issuedByAccountId,
            actorId: input.issuedByStaffId,
          })
        : 0;
      // Never the code, nor its hash: only what an incident review needs.
      await this.audit.audit(tx, {
        actorId: input.issuedByStaffId,
        action: purpose === 'first_login' ? RESET_AUDIT.FIRST_LOGIN_ISSUED : RESET_AUDIT.ISSUED,
        entity: 'account',
        entityId: input.accountId,
        after: {
          resetCodeId: row.id,
          purpose,
          supersedes: superseded.map((s) => s.id),
          expiresAt: expiresAt.toISOString(),
          signOutEverywhere: input.signOutEverywhere,
        },
        reason: input.reason,
      });
      return { id: row.id, revoked: revokedSessions };
    });
    if (input.signOutEverywhere) await this.enforce(input.accountId, revoked > 0);
    this.log.log(`reset code ${id} issued for account ${input.accountId}`);
    return { code, expiresAt, revokedSessions: revoked };
  }

  async complete(rawUsername: string, rawCode: string, password: string): Promise<{ ok: true }> {
    // Exactly what POST /auth/login does with `username`, so the login the
    // person types here is the login they will sign in with.
    const subject = rawUsername.trim();
    const code = rawCode.trim();
    if (!isPasswordLengthAcceptable(password)) {
      throw new AuthError(AuthErrorCode.PASSWORD_TOO_WEAK);
    }
    const account =
      subject && /^[0-9]{6}$/.test(code)
        ? await this.prisma.account.findUnique({ where: { subject }, select: { id: true } })
        : null;
    const live = account
      ? await this.prisma.passwordResetCode.findFirst({
          where: { accountId: account.id, usedAt: null, supersededAt: null, expiresAt: { gt: new Date() } },
        })
      : null;
    if (!account || !live || live.attempts >= RESET_CODE_TRIES) {
      await spendComparableTime(password);
      throw new AuthError(AuthErrorCode.RESET_CODE_INVALID);
    }

    if (!sameHash(live.codeHash, resetCodeHash(account.id, code, live.purpose === 'first_login' ? 'first_login' : 'reset'))) {
      const attempts = live.attempts + 1;
      await this.prisma.passwordResetCode.update({
        where: { id: live.id },
        data: attempts >= RESET_CODE_TRIES ? { attempts, supersededAt: new Date() } : { attempts },
      });
      await spendComparableTime(password);
      throw new AuthError(AuthErrorCode.RESET_CODE_INVALID);
    }

    // OUTSIDE the transaction: Argon2id must not hold a pooled connection.
    const passwordHash = await hashPassword(password);
    const revoked = await this.prisma.$transaction(async (tx) => {
      // Re-read under the transaction: two submissions of one code finish once.
      const spent = await tx.passwordResetCode.updateMany({
        where: { id: live.id, usedAt: null, supersededAt: null },
        data: { usedAt: new Date() },
      });
      if (spent.count !== 1) throw new AuthError(AuthErrorCode.RESET_CODE_INVALID);
      await tx.accountCredential.upsert({
        where: { accountId: account.id },
        create: { accountId: account.id, passwordHash },
        update: { passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
      });
      const count = await this.auth.revokeAccountSessionsInTx(tx, account.id, RESET_REVOCATION_REASON);
      // The person is the actor, and has no staff id (audit_log.actor_id names
      // staff): no actor, the account as entity, the issuer in `after`.
      await this.audit.audit(tx, {
        actorId: null,
        action: RESET_AUDIT.COMPLETED,
        entity: 'account',
        entityId: account.id,
        after: { resetCodeId: live.id, channel: live.channel, purpose: live.purpose, issuedBy: live.issuedBy, revokedSessions: count },
        reason: 'the account holder set a new password with a one-time reset code',
      });
      // PD-43: a first sign-in code also activates the account (provisioned ->
      // active), here, so the code is never spent without it. The SQL writer
      // refuses anything but a spent first_login code of a provisioned account.
      if (live.purpose === 'first_login') {
        await tx.$queryRaw`SELECT chat.activate_account_with_code(${live.id}::uuid)::text AS activated`;
      }
      return count;
    });
    await this.enforce(account.id, revoked > 0);
    this.log.log(`account ${account.id} completed a password reset`);
    return { ok: true };
  }

  /**
   * PD-25: a code a parent asked for themself, for the e-mail or WhatsApp on
   * file. Returns null -- and issues nothing -- inside the resend wait or past
   * the hourly cap; the caller answers the parent the same either way, so
   * neither tells an outsider the account exists.
   *
   * `code` lets the forgot-e-mail flow send ONE code to a phone that more than
   * one parent account shares; each row still hashes it with its own account.
   * The newest code wins: any live code -- an administrator's too -- is
   * superseded, exactly as issue() does.
   */
  async issueRecovery(input: {
    readonly accountId: string;
    readonly organizationId: string;
    readonly channel: RecoveryChannel;
    readonly code?: string;
  }): Promise<{ code: string; expiresAt: Date } | null> {
    const hourAgo = new Date(Date.now() - 3_600_000);
    const latest = await this.prisma.passwordResetCode.findFirst({
      where: { accountId: input.accountId, issuedBy: null, createdAt: { gte: hourAgo } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < RECOVERY_RESEND_SECONDS * 1000) return null;
    const [mine, all] = await Promise.all([
      this.prisma.passwordResetCode.count({ where: { accountId: input.accountId, issuedBy: null, createdAt: { gte: hourAgo } } }),
      this.prisma.passwordResetCode.count({ where: { accountId: input.accountId, createdAt: { gte: hourAgo } } }),
    ]);
    if (mine >= RECOVERY_CODES_PER_HOUR || all >= RESET_CODES_PER_HOUR) return null;

    const code = input.code ?? newCode();
    const expiresAt = new Date(Date.now() + RESET_CODE_MINUTES * 60_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetCode.updateMany({
        where: { accountId: input.accountId, usedAt: null, supersededAt: null },
        data: { supersededAt: new Date() },
      });
      const row = await tx.passwordResetCode.create({
        data: {
          organizationId: input.organizationId,
          accountId: input.accountId,
          issuedBy: null,
          channel: input.channel,
          codeHash: resetCodeHash(input.accountId, code, 'reset'),
          reason: `the parent asked for a recovery code by ${input.channel}`,
          expiresAt,
        },
        select: { id: true },
      });
      // Never the code, the e-mail or the phone: the channel says where it went.
      await this.audit.audit(tx, {
        actorId: null,
        action: RESET_AUDIT.RECOVERY_SENT,
        entity: 'account',
        entityId: input.accountId,
        after: { resetCodeId: row.id, channel: input.channel, expiresAt: expiresAt.toISOString() },
        reason: 'the parent asked to recover their account',
      });
    });
    return { code, expiresAt };
  }

  /**
   * PD-25 forgot-e-mail: is `code` the live WhatsApp code of this account? A
   * match stamps verified_at and leaves the code live, so the same code may then
   * complete a reset. A miss spends one of the code's five tries, exactly as
   * complete() does, so the two steps together never allow more than five.
   */
  async confirmRecovery(accountId: string, rawCode: string): Promise<boolean> {
    const code = rawCode.trim();
    if (!/^[0-9]{6}$/.test(code)) return false;
    const live = await this.prisma.passwordResetCode.findFirst({
      where: { accountId, channel: 'whatsapp', usedAt: null, supersededAt: null, expiresAt: { gt: new Date() } },
    });
    if (!live || live.attempts >= RESET_CODE_TRIES) return false;
    if (!sameHash(live.codeHash, resetCodeHash(accountId, code, 'reset'))) {
      const attempts = live.attempts + 1;
      await this.prisma.passwordResetCode.update({
        where: { id: live.id },
        data: attempts >= RESET_CODE_TRIES ? { attempts, supersededAt: new Date() } : { attempts },
      });
      return false;
    }
    if (!live.verifiedAt) {
      await this.prisma.passwordResetCode.updateMany({ where: { id: live.id, verifiedAt: null }, data: { verifiedAt: new Date() } });
    }
    return true;
  }

  /**
   * The sessions are revoked in the committed transaction, so every request on
   * them is already refused; the barrier only fences sockets already open. An
   * UNCONFIRMED barrier must not turn a reset that happened into a 503 the
   * client would retry with a code that is now spent -- it is logged, and the
   * periodic realtime revalidation closes those sockets within its interval.
   */
  private async enforce(accountId: string, revokedAny: boolean): Promise<void> {
    try {
      await this.auth.enforceAccountRevocation(accountId, revokedAny);
    } catch (e) {
      if (!(e instanceof RevocationUnconfirmedError)) throw e;
      this.log.warn(`account ${accountId}: socket revocation not confirmed after a password reset`);
    }
  }
}

/** A uniformly random 6-digit code. */
export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Labels the key derived for first sign-in codes, so it is never the refresh-token key itself. */
const FIRST_LOGIN_KEY_LABEL = 'jawwid:first-login-code:v1';

/**
 * What is stored for a code. A reset code lives 10 minutes and keeps PD-21's
 * sha256. A first sign-in code lives 72 hours, so it is a KEYED hash
 * (owner rule: never recoverable from storage; PD-40 review G1): HMAC-SHA256
 * under a key derived from JWT_REFRESH_SECRET for this purpose alone, as the
 * refresh-token hash is keyed. Someone who reads chat.password_reset_code
 * cannot try the 10^6 codes offline without the server's secret. Rotating that
 * secret voids live first sign-in codes; the administrator issues new ones.
 */
export function resetCodeHash(accountId: string, code: string, purpose: ResetCodePurpose): string {
  if (purpose !== 'first_login') return createHash('sha256').update(`${accountId}:${code}`).digest('hex');
  const secret = (process.env.JWT_REFRESH_SECRET ?? '').trim();
  if (secret.length < MIN_SECRET_LENGTH) throw new Error('JWT_REFRESH_SECRET is required to hash a first sign-in code');
  const key = createHmac('sha256', secret).update(FIRST_LOGIN_KEY_LABEL).digest();
  return createHmac('sha256', key).update(`${accountId}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}
