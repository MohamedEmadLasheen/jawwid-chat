import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { AuthorizationService, type AccountAdminAct, type AccountAdminTarget } from '../platform/authorization.service';
import { accountKindsAdministered, type AccountAdminStanding } from '../platform/account-admin-policy';
import { accountAdminStandingOf } from '../platform/account-admin-standing';
import { AuthService } from '../platform/auth/auth.service';
import { toSessionListDto, type SessionDto } from '../platform/auth/auth.dto';
import { PasswordResetService, RESET_CODE_MINUTES } from '../platform/auth/password-reset.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { Actor } from '../platform/types';

export const ACCOUNT_AUDIT = {
  SUSPENDED: 'account.suspended',
  REACTIVATED: 'account.reactivated',
} as const;

/** The revocation reason a suspension writes on every session it ends. */
export const SUSPENSION_REVOCATION_REASON = 'account suspended';

/** PD-23: the revocation reason an administrator's sign-out writes, followed by their reason. */
export const ADMIN_SIGN_OUT_REASON = 'signed out by an administrator';

const LIST_LIMIT = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON = 500;
const MAX_QUERY = 80;

export interface AccountSummaryDto {
  accountId: string;
  kind: 'staff' | 'family' | 'teacher';
  /** The person: the staff member, the teacher, or the family's parent. */
  name: string;
  staffRole: string | null;
  /** Family accounts: the family, and its children -- an administrator looks a student up by name. */
  familyName: string | null;
  children: string[];
  /** provisioned | active | suspended | deactivated */
  status: string;
  /** Has a password at all (a PD-16 parent who never signed up has none). */
  hasLogin: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  /** What THIS caller may do now. Advisory: every action is decided again on the server. */
  allowed: { resetPassword: boolean; suspend: boolean; reactivate: boolean; impersonate: boolean; signOut: boolean };
}

const ACCOUNT_SELECT = {
  id: true,
  organizationId: true,
  kind: true,
  status: true,
  isActive: true,
  lastLoginAt: true,
  credential: { select: { lockedUntil: true } },
  staff: { select: { id: true, name: true, role: true } },
  teacher: { select: { id: true, name: true } },
  contacts: {
    select: {
      id: true,
      name: true,
      family: { select: { displayName: true, learners: { select: { name: true }, orderBy: { name: 'asc' }, take: 10 } } },
    },
    orderBy: { createdAt: 'asc' },
    take: 1,
  },
} satisfies Prisma.AccountSelect;

type AccountRow = Prisma.AccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

/**
 * PD-21: account administration from the Admin Portal -- find an account,
 * reset its password, suspend it, reactivate it.
 *
 * EVERY ACTION IS DECIDED HERE, on the server, by
 * AuthorizationService.canAdministerAccount, before the target's state is even
 * read; the `allowed` flags in the list are a convenience for the UI and
 * nothing more. Every write is audited in the same transaction as the change
 * it records, with the administrator as actor and their reason.
 *
 * No route here ever returns a password, a password hash, a login identifier
 * or a contact channel.
 */
@Injectable()
export class AccountAdminService {
  private readonly log = new Logger('AccountAdmin');

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly auth: AuthService,
    private readonly resets: PasswordResetService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /**
   * The accounts this caller may administer (PD-40): parents for the
   * Operations and Sales departments, teachers for the Teachers department,
   * all three kinds for the super admin, nothing for anyone else. Never the
   * caller's own, never the super admin's. Searchable by the person's, the
   * family's or a child's name. `administers` tells the page which kinds to
   * offer; an empty list is an answer, not an error.
   */
  async list(
    actor: Actor,
    query: { q?: string; kind?: string },
  ): Promise<{ accounts: AccountSummaryDto[]; truncated: boolean; administers: string[] }> {
    const organizationId = this.requireStaff(actor);
    const standing = await accountAdminStandingOf(this.prisma, actor);
    const kinds: string[] = accountKindsAdministered(actor, standing);
    if (kinds.length === 0) return { accounts: [], truncated: false, administers: [] };
    const kind = query.kind && kinds.includes(query.kind) ? [query.kind] : kinds;
    const q = query.q?.trim().slice(0, MAX_QUERY);
    const like = q ? { contains: q, mode: Prisma.QueryMode.insensitive } : undefined;

    const rows = await this.prisma.account.findMany({
      where: {
        organizationId,
        kind: { in: kind },
        // Never the caller's own, never the super admin's.
        NOT: [{ staff: { id: actor.actorId } }, { staff: { role: StaffRole.SUPER_ADMIN } }],
        ...(like
          ? {
              OR: [
                { staff: { name: like } },
                { teacher: { name: like } },
                {
                  contacts: {
                    some: {
                      OR: [
                        { name: like },
                        { family: { displayName: like } },
                        { family: { learners: { some: { name: like } } } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: ACCOUNT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT + 1,
    });

    return {
      truncated: rows.length > LIST_LIMIT,
      accounts: rows.slice(0, LIST_LIMIT).map((row) => this.summary(actor, row, standing)),
      administers: kinds,
    };
  }

  async get(actor: Actor, accountId: string): Promise<AccountSummaryDto> {
    this.requireStaff(actor);
    const row = await this.loadRow(accountId);
    const standing = await accountAdminStandingOf(this.prisma, actor);
    // Another tenant's account, the caller's own, the super admin's, or a kind
    // the caller does not administer: not listed, so not found either (the
    // decision says which, for the logs). Every kind's acts include a reset.
    const decision = this.authz.canAdministerAccount(actor, toTarget(row), 'reset_password', standing);
    if (!decision.allowed) throw new CommError(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND, decision.reason);
    return this.summary(actor, row, standing);
  }

  // -------------------------------------------------------------------------
  // Password reset
  // -------------------------------------------------------------------------

  /**
   * Issues a one-time reset code and returns it to the administrator ONCE.
   * The administrator passes it on; the person sets their own password with
   * POST /auth/password-reset. The administrator never learns a password.
   */
  async issuePasswordReset(
    actor: Actor,
    actorAccountId: string,
    accountId: string,
    input: { reason?: unknown; signOutEverywhere?: unknown },
  ): Promise<{ code: string; expiresAt: string; expiresInMinutes: number; signedOutSessions: number }> {
    const reason = requireReason(input.reason);
    const { row } = await this.authorize(actor, accountId, 'reset_password');
    // Offboarded is final; a suspended account may be reset (and then reactivated).
    if (row.status === 'deactivated') {
      throw new CommError(CommErrorCode.ACCOUNT_ADMIN_STATE, 'a deactivated account has no password to reset', 409);
    }
    const issued = await this.resets.issue({
      accountId: row.id,
      organizationId: row.organizationId,
      issuedByStaffId: actor.actorId,
      issuedByAccountId: actorAccountId,
      reason,
      signOutEverywhere: input.signOutEverywhere === true,
    });
    return {
      code: issued.code,
      expiresAt: issued.expiresAt.toISOString(),
      expiresInMinutes: RESET_CODE_MINUTES,
      signedOutSessions: issued.revokedSessions,
    };
  }

  // -------------------------------------------------------------------------
  // Suspend / reactivate
  // -------------------------------------------------------------------------

  /**
   * Sets an account inactive. ONE TRANSACTION: the account is suspended
   * through chat.deactivate_principal (RT-032 journal: open sockets, call rooms
   * and scheduled notifications are cleaned up after commit), every session is
   * revoked -- so a later reactivation cannot revive one -- and the suspension
   * is audited. Then the realtime barrier: not reported done until confirmed.
   *
   * Idempotent: suspending a suspended account changes nothing, writes no
   * audit row, and re-runs the barrier (the retry of an unconfirmed one).
   */
  async suspend(
    actor: Actor,
    actorAccountId: string,
    accountId: string,
    input: { reason?: unknown },
  ): Promise<AccountSummaryDto> {
    const reason = requireReason(input.reason);
    await this.authorize(actor, accountId, 'suspend');

    const outcome = await this.prisma.$transaction(async (tx) => {
      const status = await lockStatus(tx, accountId);
      if (status === 'suspended') return { changed: false, revoked: 0 };
      if (status !== 'active') {
        throw new CommError(CommErrorCode.ACCOUNT_ADMIN_STATE, `a ${status} account cannot be suspended`, 409);
      }
      await tx.$queryRaw`
        SELECT chat.deactivate_principal('account', ${accountId}::uuid, ${`suspended by an administrator: ${reason}`},
                                         ${actor.actorId}::uuid, 'suspended')::text`;
      await tx.account.update({ where: { id: accountId }, data: { deactivatedBy: actorAccountId } });
      const revoked = await this.auth.revokeAccountSessionsInTx(tx, accountId, SUSPENSION_REVOCATION_REASON, {
        revokedBy: actorAccountId,
        actorId: actor.actorId,
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: ACCOUNT_AUDIT.SUSPENDED,
        entity: 'account',
        entityId: accountId,
        before: { status: 'active' },
        after: { status: 'suspended', revokedSessions: revoked },
        reason,
      });
      return { changed: true, revoked };
    });
    await this.auth.enforceAccountRevocation(accountId, outcome.revoked > 0);
    if (outcome.changed) this.log.log(`account ${accountId} suspended by staff ${actor.actorId}`);
    return this.summary(actor, await this.loadRow(accountId), await accountAdminStandingOf(this.prisma, actor));
  }

  /**
   * Returns a SUSPENDED account to active. Its sessions stay revoked: the
   * person signs in again. Never reverses a deactivation (offboarding).
   * Idempotent on an active account.
   */
  async reactivate(
    actor: Actor,
    accountId: string,
    input: { reason?: unknown },
  ): Promise<AccountSummaryDto> {
    const reason = requireReason(input.reason);
    await this.authorize(actor, accountId, 'reactivate');

    const changed = await this.prisma.$transaction(async (tx) => {
      const status = await lockStatus(tx, accountId);
      if (status === 'active') return false;
      if (status !== 'suspended') {
        throw new CommError(CommErrorCode.ACCOUNT_ADMIN_STATE, `a ${status} account is not reactivated from here`, 409);
      }
      const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`
        SELECT chat.reactivate_account(${accountId}::uuid, ${reason}) AS ok`;
      if (!row?.ok) throw new CommError(CommErrorCode.ACCOUNT_ADMIN_STATE, 'the account changed; reload it', 409);
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: ACCOUNT_AUDIT.REACTIVATED,
        entity: 'account',
        entityId: accountId,
        before: { status: 'suspended' },
        after: { status: 'active' },
        reason,
      });
      return true;
    });
    if (changed) this.log.log(`account ${accountId} reactivated by staff ${actor.actorId}`);
    return this.summary(actor, await this.loadRow(accountId), await accountAdminStandingOf(this.prisma, actor));
  }

  // -------------------------------------------------------------------------

  /** The decision first, then the row's existence is revealed: never the other way round. */
  // -------------------------------------------------------------------------
  // PD-23: the account's devices & sessions
  // -------------------------------------------------------------------------

  /** The account's live sessions. Read under the same decision as ending them. */
  async listSessions(actor: Actor, accountId: string): Promise<{ sessions: SessionDto[] }> {
    const { row } = await this.authorize(actor, accountId, 'sign_out');
    return toSessionListDto(await this.auth.listLiveSessions(row.id), null);
  }

  /** Ends one session of the account. Audited by AuthService.revoke with the administrator's reason. */
  async revokeSession(
    actor: Actor,
    actorAccountId: string,
    accountId: string,
    sessionId: string,
    input: { reason?: unknown },
  ): Promise<{ ok: true }> {
    const reason = requireReason(input.reason);
    const { row } = await this.authorize(actor, accountId, 'sign_out');
    const ended = UUID.test(sessionId)
      ? await this.auth.revokeSessionOf(row.id, sessionId, `${ADMIN_SIGN_OUT_REASON}: ${reason}`, {
          revokedBy: actorAccountId,
          actorId: actor.actorId,
        })
      : false;
    if (!ended) throw new CommError(CommErrorCode.SESSION_NOT_FOUND, 'no such session');
    this.log.log(`session ${sessionId} of account ${row.id} ended by staff ${actor.actorId}`);
    return { ok: true };
  }

  /**
   * Ends every session of the account -- including a support session, the same
   * as a suspension does. The account stays active: the person signs in again.
   */
  async revokeAllSessions(
    actor: Actor,
    actorAccountId: string,
    accountId: string,
    input: { reason?: unknown },
  ): Promise<{ revoked: number }> {
    const reason = requireReason(input.reason);
    const { row } = await this.authorize(actor, accountId, 'sign_out');
    const revoked = await this.prisma.$transaction((tx) =>
      this.auth.revokeAccountSessionsInTx(tx, row.id, `${ADMIN_SIGN_OUT_REASON}: ${reason}`, {
        revokedBy: actorAccountId,
        actorId: actor.actorId,
      }),
    );
    await this.auth.enforceAccountRevocation(row.id, revoked > 0);
    this.log.log(`all ${revoked} sessions of account ${row.id} ended by staff ${actor.actorId}`);
    return { revoked };
  }

  private async authorize(actor: Actor, accountId: string, act: AccountAdminAct): Promise<{ row: AccountRow }> {
    this.requireStaff(actor);
    const row = await this.loadRow(accountId);
    const decision = this.authz.canAdministerAccount(actor, toTarget(row), act, await accountAdminStandingOf(this.prisma, actor));
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    return { row };
  }

  /** Refuses non-staff before ANY lookup, so a parent or teacher learns nothing about account ids. */
  private requireStaff(actor: Actor): string {
    if (!actor.isActive) throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not administer accounts');
    if (actor.kind !== ActorKind.STAFF || !actor.organizationId) {
      throw new CommError(CommErrorCode.ACCOUNT_ADMIN_DENIED, 'only staff administer accounts');
    }
    return actor.organizationId;
  }

  private async loadRow(accountId: string): Promise<AccountRow> {
    const row = UUID.test(accountId)
      ? await this.prisma.account.findUnique({ where: { id: accountId }, select: ACCOUNT_SELECT })
      : null;
    if (!row) throw new CommError(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND, 'no such account');
    return row;
  }

  private summary(actor: Actor, row: AccountRow, standing: AccountAdminStanding): AccountSummaryDto {
    const target = toTarget(row);
    const may = (act: AccountAdminAct) => this.authz.canAdministerAccount(actor, target, act, standing).allowed;
    const contact = row.contacts[0];
    const lockedUntil = row.credential?.lockedUntil && row.credential.lockedUntil > new Date() ? row.credential.lockedUntil : null;
    return {
      accountId: row.id,
      kind: row.kind as AccountSummaryDto['kind'],
      name: row.staff?.name ?? row.teacher?.name ?? contact?.name ?? '',
      staffRole: row.staff?.role ?? null,
      familyName: contact?.family.displayName ?? null,
      children: contact?.family.learners.map((l) => l.name) ?? [],
      status: row.status,
      hasLogin: row.credential !== null,
      lockedUntil: lockedUntil?.toISOString() ?? null,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      allowed: {
        resetPassword: may('reset_password') && row.status !== 'deactivated',
        suspend: may('suspend') && row.status === 'active',
        reactivate: may('reactivate') && row.status === 'suspended',
        // PD-21: only an account that could sign in itself can be opened.
        impersonate: may('impersonate') && row.status === 'active',
        // PD-23: a suspended account's sessions are already gone.
        signOut: may('sign_out') && row.status === 'active',
      },
    };
  }
}

function toTarget(row: AccountRow): AccountAdminTarget {
  return {
    accountId: row.id,
    organizationId: row.organizationId,
    kind: row.kind,
    staffId: row.staff?.id ?? null,
    staffRole: row.staff?.role ?? null,
  };
}

/** Locks the account row for the rest of the transaction and reads its status. */
async function lockStatus(tx: Prisma.TransactionClient, accountId: string): Promise<string> {
  const [row] = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM chat.account WHERE id = ${accountId}::uuid FOR UPDATE`;
  if (!row) throw new CommError(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND, 'no such account');
  return row.status;
}

function requireReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (!reason) throw new CommError(CommErrorCode.VALIDATION, 'reason: required', 400);
  if (reason.length > MAX_REASON) throw new CommError(CommErrorCode.VALIDATION, `reason: at most ${MAX_REASON} characters`, 400);
  return reason;
}
