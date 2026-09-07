import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthorizationService } from '../authorization.service';
import { AccountService, AccountStatus, TokenPurpose } from '../auth/account.service';
import { SessionService } from '../auth/session.service';
import { AuthError, AuthErrorCode } from '../auth/auth.errors';
import { ALL_PERMISSIONS, OverrideEffect, Permission } from '../rbac/permissions';
import { Actor } from '../types';
import { AUDIT_SERVICE } from '../tokens';
import type { AuditService } from '../audit.service';

export interface AccountView {
  id: string;
  subject: string;
  kind: string;
  status: string;
  emailVerified: boolean;
  lastLoginAt: string | null;
  activeSessions: number;
  overrides: Array<{ permission: string; effect: string; expiresAt: string | null; reason: string }>;
}

/**
 * User management: the `users.manage` surface.
 *
 * Everything here is an act by one person upon another's ability to get in, so
 * every method requires the permission key, requires a reason, and audits. None
 * of it can be reached by holding a role -- it is checked against the actor's
 * EFFECTIVE permissions, so a per-account DENY removes it from a super_admin
 * too.
 *
 * What is deliberately absent: any way to read a password hash, any way to read
 * another person's tokens, and any way to log in as somebody else. Provisioning
 * a credential mints one; it never reveals one that exists.
 */
@Injectable()
export class UserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly accounts: AccountService,
    private readonly sessions: SessionService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private require(actor: Actor): void {
    const decision = this.authz.can(actor, Permission.USERS_MANAGE);
    if (!decision.allowed) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, decision.reason, 403);
    }
  }

  /**
   * Accounts within the actor's organization.
   *
   * The tenant filter is derived from the authenticated actor, never from a
   * query parameter: a super_admin of one academy administers that academy, and
   * there is no request shape that says otherwise.
   */
  async list(actor: Actor, limit = 100): Promise<AccountView[]> {
    this.require(actor);
    const rows = await this.prisma.account.findMany({
      where: actor.organizationId ? { organizationId: actor.organizationId } : { id: { in: [] } },
      include: {
        overrides: true,
        sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return rows.map(toAccountView);
  }

  private async requireSameTenant(actor: Actor, accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: {
        overrides: true,
        sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } },
      },
    });
    // Cross-tenant reads as NOT FOUND. Telling an administrator of one academy
    // that an account id belongs to another is already a cross-tenant leak.
    if (!account || (actor.organizationId && account.organizationId !== actor.organizationId)) {
      throw new AuthError(AuthErrorCode.NOT_FOUND, 'no such account', 404);
    }
    return account;
  }

  async get(actor: Actor, accountId: string): Promise<AccountView> {
    this.require(actor);
    return toAccountView(await this.requireSameTenant(actor, accountId));
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  async activate(actor: Actor, accountId: string, reason: string): Promise<void> {
    this.require(actor);
    await this.requireSameTenant(actor, accountId);
    await this.accounts.activate(accountId, actor.actorId, reason);
  }

  async suspend(actor: Actor, accountId: string, reason: string): Promise<void> {
    this.require(actor);
    await this.requireSameTenant(actor, accountId);
    await this.accounts.suspend(accountId, actor.actorId, reason);
  }

  async deactivate(actor: Actor, accountId: string, reason: string): Promise<void> {
    this.require(actor);
    await this.requireSameTenant(actor, accountId);
    if (accountId === actor.accountId) {
      // Deactivating yourself locks the operation out of its own administration
      // if you are the last super_admin, and it is never the intended action.
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'an account cannot deactivate itself', 400);
    }
    await this.accounts.deactivate(accountId, actor.actorId, reason);
  }

  // ------------------------------------------------------------------
  // Credentials and sessions
  // ------------------------------------------------------------------

  /** Set a credential. Every existing session for that account is revoked. */
  async setPassword(
    actor: Actor,
    accountId: string,
    password: string,
    reason: string,
  ): Promise<void> {
    this.require(actor);
    await this.requireSameTenant(actor, accountId);
    await this.accounts.setPassword(accountId, password, {
      actorId: actor.actorId,
      reason,
      invalidateSessions: true,
    });
  }

  /**
   * Mint a reset token for somebody else, for the MVP's manager-driven reset
   * (PRD 7.1). The plaintext is returned ONCE, to the administrator, who hands
   * it over through whatever channel they already use -- chat.account holds no
   * contact channel, so there is nothing here to send it to.
   */
  async issueResetToken(
    actor: Actor,
    accountId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    this.require(actor);
    await this.requireSameTenant(actor, accountId);
    const issued = await this.accounts.mintToken(
      accountId,
      TokenPurpose.PASSWORD_RESET,
      actor.actorId,
    );
    return { token: issued.token, expiresAt: issued.expiresAt.toISOString() };
  }

  async issueVerificationToken(
    actor: Actor,
    accountId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    this.require(actor);
    await this.requireSameTenant(actor, accountId);
    const issued = await this.accounts.mintToken(
      accountId,
      TokenPurpose.EMAIL_VERIFICATION,
      actor.actorId,
    );
    return { token: issued.token, expiresAt: issued.expiresAt.toISOString() };
  }

  /** "Sign this person out everywhere" (PRD 7.1: admins can revoke any session). */
  async revokeSessions(actor: Actor, accountId: string, reason: string): Promise<number> {
    this.require(actor);
    await this.requireSameTenant(actor, accountId);
    const count = await this.sessions.revokeAll(accountId, reason, { revokedBy: actor.actorId });
    await this.prisma.$transaction((tx) =>
      this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'account.sessions_revoked',
        entity: 'account',
        entityId: accountId,
        after: { revoked: count },
        reason,
      }),
    );
    return count;
  }

  // ------------------------------------------------------------------
  // Permission overrides
  // ------------------------------------------------------------------

  /**
   * Grant or refuse ONE permission to ONE account.
   *
   * This is the alternative to inventing a role for every exception. A DENY
   * removes a permission the role grants and takes effect on the next request,
   * because permissions are resolved per request rather than carried in the
   * token.
   */
  async setOverride(
    actor: Actor,
    accountId: string,
    permission: string,
    effect: string,
    reason: string,
    expiresAt?: Date | null,
  ): Promise<void> {
    this.require(actor);
    await this.requireSameTenant(actor, accountId);

    if (!ALL_PERMISSIONS.includes(permission as Permission)) {
      throw new AuthError(AuthErrorCode.NOT_FOUND, `unknown permission ${permission}`, 400);
    }
    if (effect !== OverrideEffect.ALLOW && effect !== OverrideEffect.DENY) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'effect must be allow or deny', 400);
    }
    if (!reason || reason.trim().length === 0) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'an override must state a reason', 400);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.accountPermissionOverride.upsert({
        where: { accountId_permission: { accountId, permission } },
        create: {
          accountId,
          permission,
          effect,
          reason,
          grantedBy: actor.actorId,
          expiresAt: expiresAt ?? null,
        },
        update: { effect, reason, grantedBy: actor.actorId, expiresAt: expiresAt ?? null },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'account.permission_override_set',
        entity: 'account',
        entityId: accountId,
        after: { permission, effect, expiresAt: expiresAt ?? null },
        reason,
      });
    });
  }

  async clearOverride(
    actor: Actor,
    accountId: string,
    permission: string,
    reason: string,
  ): Promise<void> {
    this.require(actor);
    await this.requireSameTenant(actor, accountId);
    await this.prisma.$transaction(async (tx) => {
      await tx.accountPermissionOverride.deleteMany({ where: { accountId, permission } });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'account.permission_override_cleared',
        entity: 'account',
        entityId: accountId,
        after: { permission },
        reason,
      });
    });
  }
}

function toAccountView(account: {
  id: string;
  subject: string;
  kind: string;
  status: string;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  sessions: Array<{ id: string }>;
  overrides: Array<{ permission: string; effect: string; expiresAt: Date | null; reason: string }>;
}): AccountView {
  // Explicitly constructed. The credential relation is not loaded and no field
  // of it appears here, so a password hash cannot reach a response by accident.
  return {
    id: account.id,
    subject: account.subject,
    kind: account.kind,
    status: account.status,
    emailVerified: account.emailVerifiedAt !== null,
    lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
    activeSessions: account.sessions.length,
    overrides: account.overrides.map((o) => ({
      permission: o.permission,
      effect: o.effect,
      expiresAt: o.expiresAt?.toISOString() ?? null,
      reason: o.reason,
    })),
  };
}

export { AccountStatus };
