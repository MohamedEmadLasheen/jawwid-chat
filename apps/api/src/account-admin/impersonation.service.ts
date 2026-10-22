import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { AUDIT_SERVICE, IDENTITY_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { IdentityService } from '../platform/identity.service';
import { AuthorizationService } from '../platform/authorization.service';
import { AuthService, SUPPORT_SESSION } from '../platform/auth/auth.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { Actor } from '../platform/types';

export const IMPERSONATION_AUDIT = {
  STARTED: 'impersonation.started',
  EXTENDED: 'impersonation.extended',
  ENDED: 'impersonation.ended',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON = 500;
const LIST_LIMIT = 100;

/** Who the administrator is, as the guard established it -- never from the body. */
export interface AdministratorContext {
  actor: Actor;
  accountId: string;
  sessionId: string;
}

export interface SupportSessionDto {
  id: string;
  target: { accountId: string; kind: 'family' | 'teacher'; name: string; actorId: string };
  staff: { id: string; name: string };
  reason: string;
  startedAt: string;
  expiresAt: string;
  /** The hard end: an hour after the start, however often it is extended. */
  endsAtLatest: string;
  endedAt: string | null;
  endedReason: string | null;
  actions: number;
}

export interface SupportTokenDto {
  session: SupportSessionDto;
  /** An access token for the TARGET account, on the support session. No refresh token exists. */
  accessToken: string;
  expiresInSeconds: number;
}

/**
 * PD-20: impersonation -- an administrator acting as a parent or teacher
 * account, in a "support session" that:
 *   - is decided by AuthorizationService.canAdministerAccount('impersonate')
 *     (any staff role; parent and teacher accounts only), and RE-decided on
 *     every request it serves (AuthService.authenticate);
 *   - is a session of the target account, marked as a support session, whose
 *     access token is handed to the administrator's own browser, and which has
 *     no refresh token: a new token comes only from POST .../token, on the
 *     administrator's own authenticated request;
 *   - lasts SUPPORT_SESSION.STEP_MINUTES, extendable up to
 *     SUPPORT_SESSION.MAX_MINUTES from its start, and dies with the
 *     administrator's own session, account or permission;
 *   - records who, whom, why, start and end (chat.impersonation_session),
 *     every request (chat.impersonation_action, SupportSessionInterceptor),
 *     and stamps every audit row and message written meanwhile.
 *
 * One live support session per administrator: starting another ends the
 * previous one ('superseded').
 */
@Injectable()
export class ImpersonationService {
  private readonly log = new Logger('Impersonation');

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly auth: AuthService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async start(admin: AdministratorContext, input: { accountId?: unknown; reason?: unknown }): Promise<SupportTokenDto> {
    const reason = requireReason(input.reason);
    const accountId = typeof input.accountId === 'string' ? input.accountId : '';
    const organizationId = requireStaff(admin.actor);
    const target = UUID.test(accountId)
      ? await this.prisma.account.findUnique({
          where: { id: accountId },
          select: { id: true, organizationId: true, kind: true, subject: true, isActive: true, status: true, staff: { select: { id: true, role: true } } },
        })
      : null;
    if (!target) throw new CommError(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND, 'no such account');
    const decision = this.authz.canAdministerAccount(
      admin.actor,
      { accountId: target.id, organizationId: target.organizationId, kind: target.kind, staffId: target.staff?.id, staffRole: target.staff?.role },
      'impersonate',
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    // Only an account that could sign in itself: a support session never
    // reaches what the person could not.
    const targetActor =
      target.isActive && target.status === 'active' ? await this.identity.resolveForAccount(target) : null;
    if (!targetActor || !targetActor.isActive) {
      throw new CommError(CommErrorCode.ACCOUNT_ADMIN_STATE, 'this account cannot sign in, so it cannot be opened', 409);
    }

    const now = Date.now();
    const expiresAt = new Date(now + SUPPORT_SESSION.STEP_MINUTES * 60_000);
    const created = await this.prisma.$transaction(async (tx) => {
      // One live support session per administrator.
      const previous = await tx.impersonationSession.findMany({
        where: { staffId: admin.actor.actorId, endedAt: null },
        select: { id: true, sessionId: true },
      });
      for (const p of previous) await this.endInTx(tx, admin, p, 'superseded by a new support session');

      const row = await tx.impersonationSession.create({
        data: {
          organizationId,
          staffId: admin.actor.actorId,
          staffAccountId: admin.accountId,
          staffSessionId: admin.sessionId,
          targetAccountId: target.id,
          targetKind: target.kind,
          reason,
          expiresAt,
        },
        select: { id: true },
      });
      const sessionId = await this.auth.openSupportSessionInTx(tx, {
        impersonationId: row.id,
        account: { id: target.id, organizationId: target.organizationId },
        expiresAt,
      });
      await tx.impersonationSession.update({ where: { id: row.id }, data: { sessionId } });
      await this.audit.audit(tx, {
        actorId: admin.actor.actorId,
        action: IMPERSONATION_AUDIT.STARTED,
        entity: 'account',
        entityId: target.id,
        after: { impersonationId: row.id, targetKind: target.kind, expiresAt: expiresAt.toISOString() },
        reason,
        impersonationId: row.id,
      });
      return { id: row.id, sessionId };
    });
    this.log.log(`support session ${created.id}: staff ${admin.actor.actorId} as account ${target.id}`);
    return this.tokenFor(created.id, created.sessionId, target, targetActor);
  }

  /**
   * A fresh access token for a live support session -- after a reload, or to
   * keep working. Extends the session by one step, never past an hour from its
   * start. Only the administrator who started it, from the same session.
   */
  async token(admin: AdministratorContext, impersonationId: string): Promise<SupportTokenDto> {
    const row = await this.ownLive(admin, impersonationId);
    const latest = row.startedAt.getTime() + SUPPORT_SESSION.MAX_MINUTES * 60_000;
    const expiresAt = new Date(Math.min(Date.now() + SUPPORT_SESSION.STEP_MINUTES * 60_000, latest));
    if (expiresAt.getTime() <= Date.now()) {
      throw new CommError(CommErrorCode.IMPERSONATION_ENDED, 'this support session has reached its hour; start a new one', 409);
    }
    await this.prisma.$transaction(async (tx) => {
      if (expiresAt > row.expiresAt) {
        await tx.impersonationSession.update({ where: { id: row.id }, data: { expiresAt } });
        await tx.session.update({ where: { id: row.sessionId! }, data: { expiresAt } });
        await this.audit.audit(tx, {
          actorId: admin.actor.actorId,
          action: IMPERSONATION_AUDIT.EXTENDED,
          entity: 'account',
          entityId: row.targetAccountId,
          after: { impersonationId: row.id, expiresAt: expiresAt.toISOString() },
          reason: row.reason,
          impersonationId: row.id,
        });
      }
    });
    const target = await this.prisma.account.findUniqueOrThrow({
      where: { id: row.targetAccountId },
      select: { id: true, organizationId: true, kind: true, subject: true, isActive: true, status: true },
    });
    const targetActor = await this.identity.resolveForAccount(target);
    if (!targetActor || !targetActor.isActive || !target.isActive || target.status !== 'active') {
      await this.end(admin, row.id, 'the account can no longer sign in');
      throw new CommError(CommErrorCode.IMPERSONATION_ENDED, 'the account can no longer sign in', 409);
    }
    return this.tokenFor(row.id, row.sessionId!, target, targetActor);
  }

  /** Exit. Idempotent: ending an ended session changes nothing. */
  async end(admin: AdministratorContext, impersonationId: string, reason = 'ended by the administrator'): Promise<SupportSessionDto> {
    requireStaff(admin.actor);
    const row = UUID.test(impersonationId)
      ? await this.prisma.impersonationSession.findUnique({ where: { id: impersonationId }, select: { id: true, staffId: true, sessionId: true, endedAt: true } })
      : null;
    if (!row || row.staffId !== admin.actor.actorId) {
      throw new CommError(CommErrorCode.IMPERSONATION_NOT_FOUND, 'no such support session of yours');
    }
    // The session row is revoked in the same transaction, and every request on
    // it re-reads that row; a support session never holds a socket
    // (RealtimeGateway refuses one), so there is nothing else to disconnect.
    if (!row.endedAt) await this.prisma.$transaction((tx) => this.endInTx(tx, admin, row, reason));
    return this.dto(row.id);
  }

  /**
   * The record. The super admin sees every support session of the
   * organization; anyone else their own. Optionally of one account.
   */
  async list(actor: Actor, query: { accountId?: string }): Promise<{ sessions: SupportSessionDto[] }> {
    const organizationId = requireStaff(actor);
    const rows = await this.prisma.impersonationSession.findMany({
      where: {
        organizationId,
        ...(actor.staffRole === StaffRole.SUPER_ADMIN ? {} : { staffId: actor.actorId }),
        ...(query.accountId && UUID.test(query.accountId) ? { targetAccountId: query.accountId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: LIST_LIMIT,
      select: { id: true },
    });
    return { sessions: await Promise.all(rows.map((r) => this.dto(r.id))) };
  }

  /** The trail of one support session: every request, in order. Same visibility as list(). */
  async actions(actor: Actor, impersonationId: string) {
    const organizationId = requireStaff(actor);
    const row = UUID.test(impersonationId)
      ? await this.prisma.impersonationSession.findUnique({ where: { id: impersonationId }, select: { id: true, staffId: true, organizationId: true } })
      : null;
    if (!row || row.organizationId !== organizationId || (actor.staffRole !== StaffRole.SUPER_ADMIN && row.staffId !== actor.actorId)) {
      throw new CommError(CommErrorCode.IMPERSONATION_NOT_FOUND, 'no such support session');
    }
    const actions = await this.prisma.impersonationAction.findMany({
      where: { impersonationId: row.id },
      orderBy: { id: 'asc' },
      take: 1000,
    });
    return {
      session: await this.dto(row.id),
      actions: actions.map((a) => ({ method: a.method, route: a.route, status: a.status, at: a.at.toISOString() })),
    };
  }

  // -------------------------------------------------------------------------

  private async ownLive(admin: AdministratorContext, impersonationId: string) {
    requireStaff(admin.actor);
    const row = UUID.test(impersonationId)
      ? await this.prisma.impersonationSession.findUnique({ where: { id: impersonationId } })
      : null;
    if (!row || row.staffId !== admin.actor.actorId) {
      throw new CommError(CommErrorCode.IMPERSONATION_NOT_FOUND, 'no such support session of yours');
    }
    if (row.endedAt || row.expiresAt <= new Date() || !row.sessionId) {
      throw new CommError(CommErrorCode.IMPERSONATION_ENDED, 'this support session has ended', 409);
    }
    // Re-decided: the administrator may have lost the right since it started.
    const target = await this.prisma.account.findUniqueOrThrow({
      where: { id: row.targetAccountId },
      select: { id: true, organizationId: true, kind: true },
    });
    const decision = this.authz.canAdministerAccount(admin.actor, { accountId: target.id, organizationId: target.organizationId, kind: target.kind }, 'impersonate');
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    return row;
  }

  private async endInTx(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    admin: AdministratorContext,
    row: { id: string; sessionId: string | null },
    reason: string,
  ): Promise<void> {
    const ended = await tx.impersonationSession.updateMany({
      where: { id: row.id, endedAt: null },
      data: { endedAt: new Date(), endedReason: reason },
    });
    if (ended.count === 0) return;
    if (row.sessionId) {
      await tx.session.updateMany({
        where: { id: row.sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'support session ended', revokedBy: admin.accountId },
      });
    }
    const target = await tx.impersonationSession.findUniqueOrThrow({ where: { id: row.id }, select: { targetAccountId: true } });
    await this.audit.audit(tx, {
      actorId: admin.actor.actorId,
      action: IMPERSONATION_AUDIT.ENDED,
      entity: 'account',
      entityId: target.targetAccountId,
      after: { impersonationId: row.id },
      reason,
      impersonationId: row.id,
    });
  }

  private async tokenFor(
    impersonationId: string,
    sessionId: string,
    target: { id: string; subject: string; organizationId: string },
    targetActor: Actor,
  ): Promise<SupportTokenDto> {
    const signed = this.auth.signSupportAccessToken({ subject: target.subject, organizationId: target.organizationId }, targetActor, sessionId);
    return { session: await this.dto(impersonationId), accessToken: signed.accessToken, expiresInSeconds: signed.expiresInSeconds };
  }

  private async dto(id: string): Promise<SupportSessionDto> {
    const row = await this.prisma.impersonationSession.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { actions: true } } },
    });
    const [staff, target] = await Promise.all([
      this.prisma.staff.findUniqueOrThrow({ where: { id: row.staffId }, select: { id: true, name: true } }),
      this.prisma.account.findUniqueOrThrow({
        where: { id: row.targetAccountId },
        select: {
          teacher: { select: { id: true, name: true } },
          contacts: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' }, take: 1 },
        },
      }),
    ]);
    const person = row.targetKind === 'teacher' ? target.teacher : target.contacts[0];
    return {
      id: row.id,
      target: { accountId: row.targetAccountId, kind: row.targetKind as 'family' | 'teacher', name: person?.name ?? '', actorId: person?.id ?? '' },
      staff,
      reason: row.reason,
      startedAt: row.startedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      endsAtLatest: new Date(row.startedAt.getTime() + SUPPORT_SESSION.MAX_MINUTES * 60_000).toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      endedReason: row.endedReason,
      actions: row._count.actions,
    };
  }
}

function requireStaff(actor: Actor): string {
  if (!actor.isActive) throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not open a support session');
  if (actor.kind !== ActorKind.STAFF || !actor.organizationId) {
    throw new CommError(CommErrorCode.ACCOUNT_ADMIN_DENIED, 'only staff open support sessions');
  }
  return actor.organizationId;
}

function requireReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (!reason) throw new CommError(CommErrorCode.VALIDATION, 'reason: required', 400);
  if (reason.length > MAX_REASON) throw new CommError(CommErrorCode.VALIDATION, `reason: at most ${MAX_REASON} characters`, 400);
  return reason;
}
