import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Actor, SYSTEM_ACTOR } from './types';
import { ActorKind, Locale, StaffRole } from '../communication/contracts/vocab';
import {
  AuthzRole,
  PermissionOverride,
  resolveEffectivePermissions,
} from './rbac/permissions';

/**
 * Resolves an opaque actor id, or an account, into the full server-side
 * identity every authorization decision is made against.
 *
 * PHASE 1: teacher identity is real. Before this, a teacher "existed" iff some
 * chat.learner.teacher_id equalled the id, `displayName` was the literal string
 * 'Teacher', and `isActive` was hard-coded true -- so a teacher could never be
 * deactivated and an unknown uuid could become a teacher by being written into
 * a learner row. Teachers now resolve from chat.teacher and nowhere else.
 */
export interface IdentityService {
  /** By domain actor id (staff.id | contact.id | teacher.id). */
  resolveActor(actorId: string): Promise<Actor | null>;
  /** By login. Used by authentication, which knows the account before the actor. */
  resolveByAccount(accountId: string): Promise<Actor | null>;
}

@Injectable()
export class PrismaIdentityService implements IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveActor(actorId: string): Promise<Actor | null> {
    if (actorId === SYSTEM_ACTOR.actorId) return SYSTEM_ACTOR;
    if (!isUuid(actorId)) return null;

    const staff = await this.prisma.staff.findUnique({ where: { id: actorId } });
    if (staff) return this.staffActor(staff);

    const contact = await this.prisma.contact.findUnique({
      where: { id: actorId },
      include: { family: true },
    });
    if (contact) return this.contactActor(contact);

    const teacher = await this.prisma.teacher.findUnique({ where: { id: actorId } });
    if (teacher) return this.teacherActor(teacher);

    return null;
  }

  /**
   * An account has exactly one principal. The lookups are ordered but not
   * ambiguous: chat.staff.account_id and chat.teacher.account_id are UNIQUE, and
   * a contact's account is unique per family.
   */
  async resolveByAccount(accountId: string): Promise<Actor | null> {
    const staff = await this.prisma.staff.findFirst({ where: { accountId } });
    if (staff) return this.staffActor(staff);

    const teacher = await this.prisma.teacher.findFirst({ where: { accountId } });
    if (teacher) return this.teacherActor(teacher);

    const contact = await this.prisma.contact.findFirst({
      where: { accountId },
      include: { family: true },
    });
    if (contact) return this.contactActor(contact);

    return null;
  }

  // ------------------------------------------------------------------
  // Principals
  // ------------------------------------------------------------------

  private async staffActor(staff: {
    id: string;
    accountId: string | null;
    organizationId: string;
    name: string;
    role: string;
    department: string | null;
    isActive: boolean;
    leftAt: Date | null;
  }): Promise<Actor> {
    // A departmental staff member holds no family-communication role. Giving
    // them one here and subtracting it later would mean two places knew the
    // rule; the role they resolve to IS the role they hold.
    const authzRole = staff.department ? null : (staff.role as AuthzRole);
    return {
      actorId: staff.id,
      kind: ActorKind.STAFF,
      displayName: staff.name,
      locale: 'ar',
      isActive: staff.isActive && staff.leftAt === null,
      organizationId: staff.organizationId,
      accountId: staff.accountId ?? undefined,
      staffRole: staff.role as StaffRole,
      department: staff.department,
      permissions: await this.permissionsFor(staff.accountId, authzRole),
    };
  }

  private async teacherActor(teacher: {
    id: string;
    accountId: string | null;
    organizationId: string;
    name: string;
    isActive: boolean;
    leftAt: Date | null;
  }): Promise<Actor> {
    return {
      actorId: teacher.id,
      kind: ActorKind.TEACHER,
      displayName: teacher.name,
      locale: 'ar',
      isActive: teacher.isActive && teacher.leftAt === null,
      organizationId: teacher.organizationId,
      accountId: teacher.accountId ?? undefined,
      permissions: await this.permissionsFor(teacher.accountId, AuthzRole.TEACHER),
    };
  }

  private async contactActor(contact: {
    id: string;
    accountId: string | null;
    organizationId: string;
    familyId: string;
    name: string;
    isActive: boolean;
    canMessage: boolean;
    family: { language: string };
  }): Promise<Actor> {
    return {
      actorId: contact.id,
      kind: ActorKind.CONTACT,
      displayName: contact.name,
      locale: contact.family.language as Locale,
      isActive: contact.isActive,
      organizationId: contact.organizationId,
      accountId: contact.accountId ?? undefined,
      familyId: contact.familyId,
      canMessage: contact.canMessage,
      permissions: await this.permissionsFor(contact.accountId, AuthzRole.PARENT),
    };
  }

  // ------------------------------------------------------------------
  // Permissions
  // ------------------------------------------------------------------

  /**
   * Role defaults plus this account's ALLOW/DENY overrides, resolved by the one
   * precedence function (rbac/permissions.ts).
   *
   * A principal with no account -- provisioned by Core but not yet given a
   * login -- holds nothing. That is deliberate: they cannot authenticate, so
   * anything they "hold" could only be exercised by a code path that skipped
   * authentication.
   */
  private async permissionsFor(
    accountId: string | null,
    role: AuthzRole | null,
  ): Promise<ReadonlySet<string>> {
    if (!accountId || !role) return new Set<string>();

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { status: true, overrides: { select: { permission: true, effect: true, expiresAt: true } } },
    });
    if (!account || account.status !== 'active') return new Set<string>();

    return resolveEffectivePermissions(role, account.overrides as PermissionOverride[]);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every actor id is a uuid column. Prisma raises a driver-level error on a
 * malformed uuid, which would surface as a 500 on a request that is simply
 * unauthenticated; refusing it here keeps "unknown actor" a 401.
 */
function isUuid(value: string): boolean {
  return UUID.test(value);
}
