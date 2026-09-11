import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Actor, SYSTEM_ACTOR } from './types';
import { ActorKind, Locale, StaffRole } from '../communication/contracts/vocab';

/**
 * PLATFORM SEAM - AI #1 OWNS THIS.
 *
 * Two resolutions, and the difference matters:
 *
 *   resolveActor(actorId)        by domain id. Used for ids the system already
 *                                trusts (an outbox row, a membership row).
 *   resolveForAccount(account)   by AUTHENTICATED ACCOUNT. This is the only
 *                                path a request's identity may take (PR-B):
 *                                verified JWT sub -> chat.account.subject ->
 *                                account -> principal -> Actor.
 *
 * A caller can never name the actor it wants to be. `resolveForAccount` starts
 * from a row the login proved, and the principal is found from the account --
 * not the other way round.
 */
export interface IdentityService {
  resolveActor(actorId: string): Promise<Actor | null>;
  resolveForAccount(account: ResolvableAccount): Promise<Actor | null>;
}

/** The account fields identity resolution needs. Deliberately not the whole row. */
export interface ResolvableAccount {
  readonly id: string;
  readonly kind: string;
  readonly organizationId: string;
}

@Injectable()
export class PrismaIdentityService implements IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveActor(actorId: string): Promise<Actor | null> {
    if (actorId === SYSTEM_ACTOR.actorId) return SYSTEM_ACTOR;

    const staff = await this.prisma.staff.findUnique({ where: { id: actorId } });
    if (staff) return toStaffActor(staff);

    const contact = await this.prisma.contact.findUnique({
      where: { id: actorId },
      include: { family: true },
    });
    if (contact) return toContactActor(contact);

    // PR-A landed chat.teacher, so a teacher is a row with a name and an
    // is_active flag. The old synthesis -- "a teacher is any uuid that appears
    // in learner.teacher_id", displayName hard-coded 'Teacher', isActive always
    // true -- is deleted (IDENTITY-MODEL §2.1). An id with no teacher row is
    // now nobody, which is what it always should have been.
    const teacher = await this.prisma.teacher.findUnique({ where: { id: actorId } });
    if (teacher) return toTeacherActor(teacher);

    return null;
  }

  /**
   * The production identity chain. `account.kind` decides which principal table
   * is consulted, so an account cannot resolve to a principal of another kind
   * even if a stale row links it.
   */
  async resolveForAccount(account: ResolvableAccount): Promise<Actor | null> {
    switch (account.kind) {
      case 'staff': {
        const staff = await this.prisma.staff.findFirst({ where: { accountId: account.id } });
        return staff ? toStaffActor(staff) : null;
      }
      case 'family': {
        const contact = await this.prisma.contact.findFirst({
          where: { accountId: account.id },
          include: { family: true },
        });
        return contact ? toContactActor(contact) : null;
      }
      case 'teacher': {
        const teacher = await this.prisma.teacher.findUnique({
          where: { accountId: account.id },
        });
        return teacher ? toTeacherActor(teacher) : null;
      }
      default:
        return null;
    }
  }
}

function toStaffActor(staff: {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  leftAt: Date | null;
  organizationId: string;
}): Actor {
  return {
    actorId: staff.id,
    kind: ActorKind.STAFF,
    displayName: staff.name,
    locale: 'ar',
    isActive: staff.isActive && staff.leftAt === null,
    staffRole: staff.role as StaffRole,
    organizationId: staff.organizationId,
  };
}

function toContactActor(contact: {
  id: string;
  name: string;
  isActive: boolean;
  familyId: string;
  canMessage: boolean;
  organizationId: string;
  family: { language: string };
}): Actor {
  return {
    actorId: contact.id,
    kind: ActorKind.CONTACT,
    displayName: contact.name,
    locale: contact.family.language as Locale,
    isActive: contact.isActive,
    familyId: contact.familyId,
    canMessage: contact.canMessage,
    organizationId: contact.organizationId,
  };
}

function toTeacherActor(teacher: {
  id: string;
  name: string;
  isActive: boolean;
  leftAt: Date | null;
  organizationId: string;
}): Actor {
  return {
    actorId: teacher.id,
    kind: ActorKind.TEACHER,
    displayName: teacher.name,
    locale: 'ar',
    // left_at is the offboarding record (IDENTITY-MODEL §5); a teacher who has
    // left is inactive even if nobody flipped is_active in the same statement.
    isActive: teacher.isActive && teacher.leftAt === null,
    organizationId: teacher.organizationId,
  };
}
