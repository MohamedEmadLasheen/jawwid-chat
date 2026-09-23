import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Actor } from './types';
import { ActorKind } from '../communication/contracts/vocab';

/**
 * PD-6. Is this teacher authorized to hold a direct channel with this parent?
 *
 * WHY THIS IS A SEPARATE SERVICE
 * ------------------------------
 * Until PD-6, BR-1 was decidable from two Actor objects: `contact + teacher`
 * was refused, full stop. `AuthorizationService` could therefore be a pure,
 * synchronous, database-free decision surface, and every one of its unit tests
 * runs without a database because of it.
 *
 * PD-6 makes the decision depend on a RELATIONSHIP, which lives in the
 * database. The obvious move -- give `AuthorizationService` a Prisma client --
 * would destroy that property and turn the one file where the communication
 * matrix lives into a file that cannot be reasoned about without a server.
 *
 * So the relationship is resolved HERE, ahead of the policy, and handed to the
 * policy as a plain boolean fact:
 *
 *     RelationshipService.teacherParentAuthorized()   <- reads the database
 *              |
 *              v  a resolved fact
 *     AuthorizationService.canOpenDirect / canSend / canCall   <- decides
 *
 * `AuthorizationService` never imports this class.
 *
 * TRUST
 * -----
 * Nothing a client sends is evidence. `teacherId` and `contactId` are lookup
 * KEYS: they select rows, they never assert a property of those rows. Every
 * condition below is read from a table synchronized from Jawwid Core.
 *
 * NOT A CACHE
 * -----------
 * Callers re-resolve this on every operation -- each send, each call start,
 * each media-token issue -- so a relationship revoked in Core is refused on the
 * very next check, including mid-call. Nothing here memoizes.
 *
 * SECOND ENFORCEMENT, NOT THE ONLY ONE
 * ------------------------------------
 * `chat.teacher_parent_authorized(uuid, uuid)` is the same rule in SQL and is
 * reached by the database's own constraint triggers. This service is not that
 * function's client: the two evaluate the relationship independently, so a bug
 * in one does not become a bug in both, and the database still refuses an
 * unauthorized pair with this process bypassed entirely.
 * Parity between them is asserted by
 * test/integration/relationship-predicate.spec.ts.
 */
export interface RelationshipService {
  /**
   * True only when a live learner links this contact's family to this teacher,
   * both sides are live, and all three rows sit in one organization.
   *
   * Fails closed: an unknown id, an inactive party or an unreadable row is
   * `false`. There is no branch that returns `true` without a complete chain.
   */
  teacherParentAuthorized(teacherId: string, contactId: string): Promise<boolean>;

  /**
   * The same question asked about a pair of resolved actors, in either order.
   *
   * Call sites deal in `Actor`s and should not have to work out which side is
   * the teacher -- getting that backwards would silently query the wrong
   * direction and deny a legitimate pair. A pair that is not exactly one
   * teacher and one contact is not a teacher/parent pairing at all and is
   * `false` here; the ordinary matrix rules in `AuthorizationService` decide
   * such pairs.
   */
  pairingAuthorized(a: Actor, b: Actor): Promise<boolean>;
}

@Injectable()
export class PrismaRelationshipService implements RelationshipService {
  constructor(private readonly prisma: PrismaService) {}

  async teacherParentAuthorized(teacherId: string, contactId: string): Promise<boolean> {
    // Guard the degenerate inputs before touching the database. Prisma would
    // treat an empty string as a value to match rather than as "no id given",
    // and `findFirst` on a bad uuid raises rather than returning null.
    if (!isUuid(teacherId) || !isUuid(contactId)) return false;

    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: {
        familyId: true,
        isActive: true,
        canMessage: true,
        organizationId: true,
      },
    });
    // can_message is the same capability the messaging path already honours.
    // A contact without it is a relative on the record, not a correspondent.
    if (!contact || !contact.isActive || !contact.canMessage) return false;

    const teacher = await this.prisma.teacher.findUnique({
      where: { id: teacherId },
      select: { isActive: true, leftAt: true, organizationId: true },
    });
    // is_active and left_at are separate facts in this schema: a teacher can be
    // deactivated with no offboarding date recorded, and an offboarded teacher
    // can still carry is_active = true until a sync catches up. Both are
    // required, so neither omission can leave a channel open.
    if (!teacher || !teacher.isActive || teacher.leftAt !== null) return false;

    // Tenant isolation, checked explicitly rather than assumed. Prisma reaches
    // the database as an application role, not through the restrictive
    // organization policies, so this boundary is ours to enforce here.
    if (contact.organizationId !== teacher.organizationId) return false;

    // The link itself. `findFirst` rather than a count: a family with two
    // learners taught by the same teacher is one relationship, not two, and a
    // duplicate path must not change the answer.
    const link = await this.prisma.learner.findFirst({
      where: {
        familyId: contact.familyId,
        teacherId,
        organizationId: contact.organizationId,
      },
      select: { id: true },
    });

    return link !== null;
  }

  async pairingAuthorized(a: Actor, b: Actor): Promise<boolean> {
    const teacher = a.kind === ActorKind.TEACHER ? a : b.kind === ActorKind.TEACHER ? b : null;
    const contact = a.kind === ActorKind.CONTACT ? a : b.kind === ActorKind.CONTACT ? b : null;
    if (!teacher || !contact) return false;

    return this.teacherParentAuthorized(teacher.actorId, contact.actorId);
  }
}

/**
 * Every id in this schema is a uuid. Rejecting anything else here keeps a
 * malformed client value from reaching Prisma, where it would raise instead of
 * simply not matching -- a denial must look like a denial, not like a 500.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
