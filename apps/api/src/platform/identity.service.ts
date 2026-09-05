import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Actor, SYSTEM_ACTOR } from './types';

/**
 * PLATFORM SEAM - AI #1 OWNS THIS.
 * Reference implementation reads the Staff/Contact shells. Replace with the
 * real identity/auth service; keep this interface.
 */
export interface IdentityService {
  resolveActor(userId: string): Promise<Actor | null>;
  /** Every user who should receive realtime + delivery for a family thread. */
  familyThreadAudience(familyId: string): Promise<Actor[]>;
}

@Injectable()
export class PrismaIdentityService implements IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveActor(userId: string): Promise<Actor | null> {
    if (userId === SYSTEM_ACTOR.userId) return SYSTEM_ACTOR;

    const staff = await this.prisma.staff.findUnique({ where: { id: userId } });
    if (staff) {
      return {
        userId: staff.id,
        kind: 'STAFF',
        displayName: staff.name,
        locale: staff.locale,
        staffRole: staff.role,
        isActive: staff.isActive,
      };
    }

    const contact = await this.prisma.contact.findUnique({ where: { id: userId } });
    if (contact) {
      return {
        userId: contact.id,
        kind: 'CONTACT',
        displayName: contact.name,
        locale: contact.locale,
        contactId: contact.id,
        familyId: contact.familyId,
        canMessage: contact.canMessage,
        isActive: contact.isActive,
      };
    }

    return null;
  }

  async familyThreadAudience(familyId: string): Promise<Actor[]> {
    const family = await this.prisma.family.findUnique({
      where: { id: familyId },
      include: { contacts: { where: { isActive: true } }, owner: true },
    });
    if (!family) return [];

    const contacts: Actor[] = family.contacts.map((c) => ({
      userId: c.id,
      kind: 'CONTACT' as const,
      displayName: c.name,
      locale: c.locale,
      contactId: c.id,
      familyId: c.familyId,
      canMessage: c.canMessage,
      isActive: c.isActive,
    }));

    const owner: Actor = {
      userId: family.owner.id,
      kind: 'STAFF',
      displayName: family.owner.name,
      locale: family.owner.locale,
      staffRole: family.owner.role,
      isActive: family.owner.isActive,
    };

    return [...contacts, owner];
  }
}
