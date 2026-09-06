import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Actor, SYSTEM_ACTOR } from './types';
import { ActorKind, Locale, StaffRole } from '../communication/contracts/vocab';

/**
 * PLATFORM SEAM - AI #1 OWNS THIS.
 *
 * Teacher identity does not exist yet (QA correction C-1, owned by AI #1).
 * Until it lands, a teacher is recognised by appearing as chat.learner.teacher_id.
 * When AI #1 adds a real teacher table this resolver changes and nothing else does.
 */
export interface IdentityService {
  resolveActor(actorId: string): Promise<Actor | null>;
}

@Injectable()
export class PrismaIdentityService implements IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveActor(actorId: string): Promise<Actor | null> {
    if (actorId === SYSTEM_ACTOR.actorId) return SYSTEM_ACTOR;

    const staff = await this.prisma.staff.findUnique({ where: { id: actorId } });
    if (staff) {
      return {
        actorId: staff.id,
        kind: ActorKind.STAFF,
        displayName: staff.name,
        locale: 'ar',
        isActive: staff.isActive && staff.leftAt === null,
        staffRole: staff.role as StaffRole,
      };
    }

    const contact = await this.prisma.contact.findUnique({
      where: { id: actorId },
      include: { family: true },
    });
    if (contact) {
      return {
        actorId: contact.id,
        kind: ActorKind.CONTACT,
        displayName: contact.name,
        locale: contact.family.language as Locale,
        isActive: contact.isActive,
        familyId: contact.familyId,
        canMessage: contact.canMessage,
      };
    }

    // AI #1 SEAM: replace with a real teacher lookup once chat.teacher exists.
    const asTeacher = await this.prisma.learner.findFirst({
      where: { teacherId: actorId },
      select: { teacherId: true },
    });
    if (asTeacher?.teacherId) {
      return {
        actorId,
        kind: ActorKind.TEACHER,
        displayName: 'Teacher',
        locale: 'ar',
        isActive: true,
      };
    }

    return null;
  }
}
