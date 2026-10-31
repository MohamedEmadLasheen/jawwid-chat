import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FamilyAccessGrant } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_HOURS = 24;
const MAX_HOURS = 7 * 24;
/** The grantor's list keeps ended grants this long. */
const RECENT_DAYS = 30;

export interface FamilyAccessGrantDto {
  id: string;
  family: { id: string; name: string };
  grantee: { id: string; name: string };
  grantedBy: { id: string; name: string };
  purpose: string;
  startsAt: string;
  endsAt: string;
  revokedAt: string | null;
  status: 'active' | 'ended' | 'revoked';
}

/**
 * ADMIN-002 (owner decision 2026-10-31): exceptional access to ONE family's
 * parent accounts -- temporary, purpose-bound, logged, and over on its own.
 *
 *   grant    the Operations Manager or the super admin, to a live Operations
 *            staff member of the organization (never themselves), for a
 *            purpose, for `hours` (default 24, at most 7 days)
 *   active   not revoked and starts_at <= now() < ends_at, read on every use
 *            (chat.family_access_grant_active) -- no job ends access
 *   revoke   the grantor, the Operations Manager or the super admin, early
 *   sweep    the worker writes 'family_access.expired' near the end, once
 *
 * Every audit row carries the owner's four fields: who authorized it
 * (grantedBy), who accessed (granteeId / accessorId), the reason (purpose)
 * and the duration (startsAt, endsAt and, at revocation or expiry, endedAt).
 * What a grant opens is account administration only (AccountAdminScope);
 * nothing notifies the parent.
 */
@Injectable()
export class FamilyAccessService {
  private readonly log = new Logger('FamilyAccess');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async grant(
    actor: Actor,
    input: { familyId?: unknown; granteeId?: unknown; purpose?: unknown; hours?: unknown },
  ): Promise<FamilyAccessGrantDto> {
    const org = await this.requireGrantor(actor);
    const familyId = uuid('familyId', input.familyId);
    const granteeId = uuid('granteeId', input.granteeId);
    const purpose = typeof input.purpose === 'string' ? input.purpose.trim() : '';
    if (purpose.length < 1 || purpose.length > 500) throw invalid('purpose: say why, in 1 to 500 characters');
    const hours = input.hours === undefined || input.hours === null || input.hours === '' ? DEFAULT_HOURS : Number(input.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) throw invalid(`hours: a whole number from 1 to ${MAX_HOURS}`);
    if (granteeId === actor.actorId) throw invalid('granteeId: access is granted to someone else, never to oneself');
    if (!(await this.isOperationsStaff(granteeId, org))) {
      throw invalid('granteeId: family access is granted to a live Operations staff member of the organization');
    }
    const family = await this.prisma.family.findFirst({ where: { id: familyId, organizationId: org }, select: { id: true } });
    if (!family) throw invalid('familyId: no such family');

    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + hours * 3_600_000);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.familyAccessGrant.create({
        data: { organizationId: org, familyId, granteeId, grantedBy: actor.actorId, purpose, startsAt, endsAt },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'family_access.granted',
        entity: 'family_access_grant',
        entityId: created.id,
        after: facts(created),
        reason: purpose,
      });
      return created;
    });
    this.log.log(`family access ${row.id}: staff ${granteeId} on family ${familyId} until ${endsAt.toISOString()}, by ${actor.actorId}`);
    return (await this.dtos([row]))[0]!;
  }

  /**
   * The grantor's view (the Operations Manager, the super admin): every grant
   * of the organization, live or ended in the last 30 days. Anyone else on
   * staff: their own live grants, with their expiry.
   */
  async list(actor: Actor): Promise<{ grants: FamilyAccessGrantDto[] }> {
    const org = requireStaff(actor);
    const now = new Date();
    const rows = (await this.mayGrant(actor, org))
      ? await this.prisma.familyAccessGrant.findMany({
          where: { organizationId: org, endsAt: { gt: new Date(now.getTime() - RECENT_DAYS * 86_400_000) } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        })
      : await this.prisma.familyAccessGrant.findMany({
          where: { organizationId: org, granteeId: actor.actorId, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
          orderBy: { endsAt: 'asc' },
        });
    return { grants: await this.dtos(rows) };
  }

  async revoke(actor: Actor, grantId: string, input: { reason?: unknown }): Promise<FamilyAccessGrantDto> {
    const org = requireStaff(actor);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 1 || reason.length > 500) throw invalid('reason: say why, in 1 to 500 characters');
    const row = UUID.test(grantId) ? await this.prisma.familyAccessGrant.findFirst({ where: { id: grantId, organizationId: org } }) : null;
    if (!row || !(row.grantedBy === actor.actorId || (await this.mayGrant(actor, org)))) {
      throw new CommError(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND, 'no such grant of yours');
    }
    const now = new Date();
    if (row.revokedAt || row.endsAt <= now) throw new CommError(CommErrorCode.ACCOUNT_ADMIN_STATE, 'this grant has already ended', 409);
    const updated = await this.prisma.$transaction(async (tx) => {
      const done = await tx.familyAccessGrant.update({
        where: { id: row.id },
        data: { revokedAt: now, revokedBy: actor.actorId, revokeReason: reason },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'family_access.revoked',
        entity: 'family_access_grant',
        entityId: row.id,
        after: { ...facts(done), endedAt: now.toISOString(), revokedBy: actor.actorId },
        reason,
      });
      return done;
    });
    return (await this.dtos([updated]))[0]!;
  }

  /** The grant that lets `granteeId` administer this family's parent accounts now, if any. */
  async activeGrant(granteeId: string, familyId: string, at: Date = new Date()): Promise<FamilyAccessGrant | null> {
    return activeGrant(this.prisma, granteeId, familyId, at);
  }

  /**
   * The worker's sweep: one 'family_access.expired' row per grant that ran out
   * unrevoked, written once (expiry_audited_at). Access already ended at
   * ends_at -- this is the log, not the lock.
   */
  async sweepExpired(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.familyAccessGrant.findMany({
      where: { revokedAt: null, expiryAuditedAt: null, endsAt: { lte: now } },
      orderBy: { endsAt: 'asc' },
      take: 200,
    });
    let written = 0;
    for (const row of due) {
      const done = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.familyAccessGrant.updateMany({ where: { id: row.id, expiryAuditedAt: null }, data: { expiryAuditedAt: now } });
        if (claimed.count === 0) return false;
        await this.audit.audit(tx, {
          actorId: null,
          action: 'family_access.expired',
          entity: 'family_access_grant',
          entityId: row.id,
          after: { ...facts(row), endedAt: row.endsAt.toISOString() },
          reason: row.purpose,
        });
        return true;
      });
      if (done) written += 1;
    }
    return written;
  }

  // ------------------------------------------------------------------

  /** The super admin, or the Operations Manager of the caller's organization. */
  private async mayGrant(actor: Actor, org: string): Promise<boolean> {
    if (actor.staffRole === StaffRole.SUPER_ADMIN) return true;
    if (actor.staffRole !== StaffRole.MANAGER) return false;
    const dept = await this.prisma.department.findFirst({
      where: { organizationId: org, kind: 'operations', managerId: actor.actorId },
      select: { id: true },
    });
    return dept !== null;
  }

  private async requireGrantor(actor: Actor): Promise<string> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.ACCOUNT_ADMIN_DENIED, 'only the Operations Manager or the super admin grants family access');
    }
    if (!(await this.mayGrant(actor, actor.organizationId))) {
      throw new CommError(CommErrorCode.ACCOUNT_ADMIN_DENIED, 'only the Operations Manager or the super admin grants family access');
    }
    return actor.organizationId;
  }

  private async isOperationsStaff(staffId: string, org: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM chat.staff s
          JOIN chat.department_member m ON m.staff_id = s.id
          JOIN chat.department d ON d.id = m.department_id
         WHERE s.id = ${staffId}::uuid AND s.is_active AND s.left_at IS NULL
           AND s.organization_id = ${org}::uuid AND d.kind = 'operations' AND d.organization_id = ${org}::uuid) AS ok`;
    return rows[0]?.ok === true;
  }

  private async dtos(rows: FamilyAccessGrant[]): Promise<FamilyAccessGrantDto[]> {
    if (rows.length === 0) return [];
    const [families, staff] = await Promise.all([
      this.prisma.family.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.familyId))] } }, select: { id: true, displayName: true } }),
      this.prisma.staff.findMany({
        where: { id: { in: [...new Set(rows.flatMap((r) => [r.granteeId, r.grantedBy]))] } },
        select: { id: true, name: true },
      }),
    ]);
    const familyName = new Map(families.map((f) => [f.id, f.displayName]));
    const staffName = new Map(staff.map((x) => [x.id, x.name]));
    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      family: { id: r.familyId, name: familyName.get(r.familyId) ?? '' },
      grantee: { id: r.granteeId, name: staffName.get(r.granteeId) ?? '' },
      grantedBy: { id: r.grantedBy, name: staffName.get(r.grantedBy) ?? '' },
      purpose: r.purpose,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
      status: r.revokedAt ? 'revoked' : r.endsAt <= now ? 'ended' : 'active',
    }));
  }
}

/** The grant that lets `granteeId` administer this family's parent accounts at `at`, if any. */
export async function activeGrant(
  prisma: PrismaService,
  granteeId: string,
  familyId: string,
  at: Date = new Date(),
): Promise<FamilyAccessGrant | null> {
  const [row] = await prisma.$queryRaw<Array<{ id: string | null }>>`
    SELECT chat.family_access_grant_active(${granteeId}::uuid, ${familyId}::uuid, ${at}::timestamptz)::text AS id`;
  return row?.id ? prisma.familyAccessGrant.findUnique({ where: { id: row.id } }) : null;
}

/**
 * ADMIN-002: one use of a grant -- an account-administration read or act, or
 * a support session's start -- logged with the owner's four fields and who
 * actually accessed.
 */
export async function recordUse(
  audit: AuditService,
  prisma: PrismaService,
  grant: FamilyAccessGrant,
  accessorId: string,
  act: string,
  accountId: string,
): Promise<void> {
  // Its own transaction: the use is logged when access is granted, whatever the act after it does.
  await prisma.$transaction((tx) =>
    audit.audit(tx, {
      actorId: accessorId,
      action: 'family_access.used',
      entity: 'family_access_grant',
      entityId: grant.id,
      after: { ...facts(grant), accessorId, act, accountId },
      reason: grant.purpose,
    }),
  );
}

/** The owner's four fields: who authorized, who was granted, the reason, the window. */
export function facts(row: Pick<FamilyAccessGrant, 'grantedBy' | 'granteeId' | 'familyId' | 'purpose' | 'startsAt' | 'endsAt'>) {
  return {
    grantedBy: row.grantedBy,
    granteeId: row.granteeId,
    familyId: row.familyId,
    reason: row.purpose,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  };
}

function requireStaff(actor: Actor): string {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) {
    throw new CommError(CommErrorCode.ACCOUNT_ADMIN_DENIED, 'family access is for staff');
  }
  return actor.organizationId;
}

function uuid(field: string, value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(`${field}: a uuid`);
  return value;
}

function invalid(reason: string): CommError {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}
