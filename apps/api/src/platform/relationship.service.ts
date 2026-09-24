import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** A uuid, and nothing else, reaches a uuid column. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a teacher and a family contact are an authorized pair (PD-6).
 *
 * PD-6 permits direct Parent <-> Teacher communication, and direct calling,
 * only where the relationship is authorized; an unauthorized pair stays denied.
 * This is the application half of that question. The database half is
 * `chat.teacher_parent_authorized(uuid, uuid)`, added in the same change.
 *
 * The two are deliberately written independently rather than one delegating to
 * the other. The policy requires the rule at both layers, and a wrapper around
 * the SQL function would give two call sites for one implementation -- so a
 * mistake in that implementation would look agreed-upon rather than wrong.
 * Written twice, a divergence is a failing test, and
 * `teacher-parent-relationship.spec.ts` asserts they agree case for case.
 *
 * NOTHING CONSUMES THIS YET. It is added and proven before any authorization
 * decision is moved onto it; BR-1 and its database backstop are unchanged.
 */
@Injectable()
export class RelationshipService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * True when the teacher teaches a learner in the contact's family and both
   * sides may currently communicate.
   *
   * Fails closed: an id that is not a uuid, an unknown row, a teacher who is
   * inactive or has left, a contact who is inactive or lacks `can_message`, a
   * pair with no learner between them, or rows in different organizations all
   * answer false.
   *
   * A database failure is NOT converted into false. An outage must surface as
   * an error rather than as a quiet "not authorized", which would be
   * indistinguishable from a real refusal in logs and in support.
   */
  async teacherParentAuthorized(teacherId: string, contactId: string): Promise<boolean> {
    if (!UUID.test(teacherId ?? '') || !UUID.test(contactId ?? '')) return false;

    const teacher = await this.prisma.teacher.findUnique({
      where: { id: teacherId },
      select: { id: true, organizationId: true, isActive: true, leftAt: true },
    });
    // `leftAt` as well as `isActive`: a teacher who has left is inactive even if
    // nobody flipped the flag in the same statement. identity.service.ts
    // resolves a teacher by exactly this rule.
    if (!teacher || !teacher.isActive || teacher.leftAt !== null) return false;

    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, familyId: true, organizationId: true, isActive: true, canMessage: true },
    });
    if (!contact || !contact.isActive || !contact.canMessage) return false;

    // Tenancy before the relationship lookup: two organizations may hold rows
    // that would otherwise satisfy it.
    if (contact.organizationId !== teacher.organizationId) return false;

    const learner = await this.prisma.learner.findFirst({
      where: {
        teacherId: teacher.id,
        familyId: contact.familyId,
        organizationId: teacher.organizationId,
      },
      select: { id: true },
    });

    return learner !== null;
  }
}
