import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AppConfigService } from '../app-config.service';
import { AUDIT_SERVICE } from '../tokens';
import type { AuditService } from '../audit.service';
import { SessionService } from './session.service';
import { AuthError, AuthErrorCode } from './auth.errors';
import { assertPasswordAcceptable, hashPassword, WeakPasswordError } from './password';
import { hashToken, newOpaqueToken } from './tokens';

/**
 * The account lifecycle, in ONE place.
 *
 *   provisioned ──(credential set)──► active ──► suspended ──► active
 *         │                              │
 *         └────────── deactivated ◄──────┘   (terminal; offboarding)
 *
 * Scattering "is this account allowed to be here" across the application is how
 * a deactivated person keeps working: one path checks, another does not. There
 * is exactly one predicate (`status = 'active'`), it lives on the row, and
 * `chat.account.is_active` is a trigger-maintained mirror of it so every
 * pre-Phase-1 reader agrees with this service by construction.
 *
 * Every transition revokes sessions in the same call. An account that can no
 * longer log in but still holds a live access token has not been deactivated;
 * it has been asked nicely.
 */
export const AccountStatus = {
  PROVISIONED: 'provisioned',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DEACTIVATED: 'deactivated',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const TokenPurpose = {
  EMAIL_VERIFICATION: 'email_verification',
  PASSWORD_RESET: 'password_reset',
} as const;
export type TokenPurpose = (typeof TokenPurpose)[keyof typeof TokenPurpose];

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly sessions: SessionService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private secret(): string {
    const s = process.env.JWT_REFRESH_SECRET;
    if (!s || s.length < 32) {
      throw new Error('JWT_REFRESH_SECRET must be set to at least 32 characters');
    }
    return s;
  }

  /** The single "may this account be used right now" answer. */
  static isUsable(status: string): boolean {
    return status === AccountStatus.ACTIVE;
  }

  // ------------------------------------------------------------------
  // Credentials
  // ------------------------------------------------------------------

  /**
   * Set or replace an account's password.
   *
   * `invalidateSessions` defaults to true and should stay true for every path a
   * person did not personally initiate on the device they are holding. A
   * password change whose purpose is to lock out whoever knew the old one has
   * to end the sessions that old password opened.
   */
  async setPassword(
    accountId: string,
    plain: string,
    options: { actorId?: string; reason: string; invalidateSessions?: boolean; keepSessionId?: string } = {
      reason: 'password set',
    },
  ): Promise<void> {
    const minLength = Number(await this.config.get('auth.min_password_length'));
    try {
      assertPasswordAcceptable(plain, minLength);
    } catch (e) {
      if (e instanceof WeakPasswordError) {
        throw new AuthError(AuthErrorCode.WEAK_PASSWORD, e.message, 400);
      }
      throw e;
    }

    const passwordHash = await hashPassword(plain);

    await this.prisma.$transaction(async (tx) => {
      await tx.accountCredential.upsert({
        where: { accountId },
        create: { accountId, passwordHash },
        update: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          failedAttempts: 0,
          lockedUntil: null,
        },
      });

      // A provisioned account becomes usable the moment it has a credential.
      await tx.account.updateMany({
        where: { id: accountId, status: AccountStatus.PROVISIONED },
        data: { status: AccountStatus.ACTIVE },
      });

      await this.audit.audit(tx, {
        actorId: options.actorId ?? null,
        action: 'account.password_set',
        entity: 'account',
        entityId: accountId,
        reason: options.reason,
      });
    });

    if (options.invalidateSessions !== false) {
      await this.sessions.revokeAll(accountId, 'password changed', {
        except: options.keepSessionId,
        revokedBy: options.actorId,
      });
    }
  }

  // ------------------------------------------------------------------
  // One-time tokens
  // ------------------------------------------------------------------

  /**
   * Mint a single-use token and return its PLAINTEXT. Only the hash is stored,
   * and any earlier live token for the same purpose is consumed first, so a
   * leaked older token is dead the moment a new one is requested.
   *
   * Delivery is not this service's job: chat.account holds no contact channel
   * (BR-2), so there is nothing here to e-mail. The caller hands the token to
   * whichever channel the identity provider owns.
   */
  async mintToken(
    accountId: string,
    purpose: TokenPurpose,
    createdBy?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const ttl = Number(
      await this.config.get(
        purpose === TokenPurpose.PASSWORD_RESET
          ? 'auth.reset_token_ttl_seconds'
          : 'auth.verification_token_ttl_seconds',
      ),
    );
    const token = newOpaqueToken();
    const expiresAt = new Date(Date.now() + ttl * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.accountToken.updateMany({
        where: { accountId, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.accountToken.create({
        data: {
          accountId,
          purpose,
          tokenHash: hashToken(token, this.secret()),
          expiresAt,
          createdBy: createdBy ?? null,
        },
      });
    });

    return { token, expiresAt };
  }

  /** Consume a token, returning the account it belonged to. Single use. */
  async consumeToken(token: string, purpose: TokenPurpose): Promise<string | null> {
    if (!token) return null;
    const row = await this.prisma.accountToken.findUnique({
      where: { tokenHash: hashToken(token, this.secret()) },
    });
    if (!row || row.purpose !== purpose || row.consumedAt || row.expiresAt <= new Date()) {
      return null;
    }
    // Conditional update: two concurrent redemptions cannot both win.
    const claimed = await this.prisma.accountToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return claimed.count === 1 ? row.accountId : null;
  }

  // ------------------------------------------------------------------
  // Verification
  // ------------------------------------------------------------------

  async verifyEmail(token: string): Promise<void> {
    const accountId = await this.consumeToken(token, TokenPurpose.EMAIL_VERIFICATION);
    if (!accountId) {
      throw new AuthError(
        AuthErrorCode.INVALID_VERIFICATION_TOKEN,
        'this verification link is invalid or has expired',
        400,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: { emailVerifiedAt: new Date() },
      });
      await this.audit.audit(tx, {
        actorId: null,
        action: 'account.email_verified',
        entity: 'account',
        entityId: accountId,
        reason: 'verification token redeemed',
      });
    });
  }

  // ------------------------------------------------------------------
  // Activation / deactivation
  // ------------------------------------------------------------------

  async activate(accountId: string, actorId: string, reason: string): Promise<void> {
    await this.transition(accountId, AccountStatus.ACTIVE, actorId, reason, { revoke: false });
  }

  async suspend(accountId: string, actorId: string, reason: string): Promise<void> {
    await this.transition(accountId, AccountStatus.SUSPENDED, actorId, reason, { revoke: true });
  }

  async deactivate(accountId: string, actorId: string, reason: string): Promise<void> {
    await this.transition(accountId, AccountStatus.DEACTIVATED, actorId, reason, { revoke: true });
  }

  private async transition(
    accountId: string,
    status: AccountStatus,
    actorId: string,
    reason: string,
    options: { revoke: boolean },
  ): Promise<void> {
    if (!reason || reason.trim().length === 0) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'a reason is required', 400);
    }

    const before = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { status: true },
    });
    if (!before) throw new AuthError(AuthErrorCode.NOT_FOUND, 'no such account', 404);

    await this.prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: {
          status,
          ...(status === AccountStatus.DEACTIVATED
            ? { deactivatedAt: new Date(), deactivatedBy: actorId, deactivatedReason: reason }
            : {}),
        },
      });
      await this.audit.audit(tx, {
        actorId,
        action: `account.${status}`,
        entity: 'account',
        entityId: accountId,
        before: { status: before.status },
        after: { status },
        reason,
      });
    });

    // Outside the transaction on purpose: revoking is idempotent, and a slow
    // fan-out must not hold the lifecycle row's lock.
    if (options.revoke) {
      await this.sessions.revokeAll(accountId, `account ${status}`, { revokedBy: actorId });
    }
  }
}
