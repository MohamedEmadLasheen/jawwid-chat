import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, IDENTITY_SERVICE } from '../../platform/tokens';
import type { AuditService, Tx } from '../../platform/audit.service';
import type { IdentityService } from '../../platform/identity.service';
import { ActorKind } from '../contracts/vocab';
import { signAvatar } from './avatar-urls';

/**
 * The parent's own profile, and their children's.
 *
 * ## Two owners, one person
 *
 * A name and a profile are owned by different tables on purpose. `chat.contact.name` and
 * `chat.learner.name` are the ONLY source of truth for names, and this service writes them
 * in place rather than keeping a second copy -- a profile that cached a name would drift
 * from the chat list, the group header and the message author the moment either changed.
 * The About lives in the sibling `*_profile` tables, which are Chat's own.
 *
 * ## The photos are not set here
 *
 * The parent's and each child's photo are the account photos every chat surface shows, and
 * they have exactly one writer: `/me/avatar` and `/me/children/:id/avatar`
 * (avatar.service.ts). This profile only carries their `self` links.
 *
 * ## The authorization shape, and why it is not a permission check
 *
 * Nothing here takes an owner id. The caller is resolved from the bearer token, and a
 * learner is reachable only by being in the caller's OWN family:
 *
 *     token -> actorId -> contact -> contact.familyId -> learner.familyId
 *
 * So "edit another parent" is not a request this API can express, and "edit another
 * family's child" is denied by a `where` clause rather than by an `if`. A `learnerId` from
 * the client is treated as untrusted throughout: it is only ever used INSIDE a query
 * already narrowed to the caller's family, so somebody else's learner is simply not found.
 * That is the same predicate the rest of the parent surface already uses.
 *
 * ## One code for two denials
 *
 * A learner that does not exist and a learner belonging to another family both raise
 * LEARNER_NOT_IN_FAMILY. Distinguishing them would make this an oracle for which learner
 * ids are real.
 */
@Injectable()
export class ParentProfileService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- read

  /** The caller's own profile and their family's children. Takes no target. */
  async me(actorId: string): Promise<ParentProfileDto> {
    const contact = await this.requireContact(actorId);

    const [profile, learners, account] = await Promise.all([
      this.prisma.contactProfile.findUnique({ where: { contactId: contact.id } }),
      this.prisma.learner.findMany({
        where: { familyId: contact.familyId },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          level: true,
          avatarObjectKey: true,
          profile: { select: { about: true } },
        },
      }),
      contact.accountId
        ? this.prisma.account.findUnique({
            where: { id: contact.accountId },
            select: { subject: true },
          })
        : Promise.resolve(null),
    ]);

    return {
      displayName: contact.name,
      relationship: contact.relationship,
      // The login identity, read-only: this service never writes it. Changing how somebody
      // authenticates is not a profile edit.
      signInIdentity: account?.subject ?? null,
      about: profile?.about ?? null,
      // The same `self` links GET /me/photo hands out.
      avatarUrl: signAvatar('contact', contact.id, 'self', contact.id, contact.avatarObjectKey),
      canMessage: contact.canMessage === true,
      children: learners.map((l) => ({
        id: l.id,
        displayName: l.name,
        level: l.level,
        about: l.profile?.about ?? null,
        avatarUrl: signAvatar('learner', l.id, 'self', contact.id, l.avatarObjectKey),
      })),
    };
  }

  // ---------------------------------------------------------------- parent edits

  /**
   * Save the caller's own name and/or About in one call.
   *
   * Partial by design: an absent field is "leave it alone", which is what lets the client
   * save one field without having to send -- and therefore without being able to clobber --
   * the other. `null` for About is an explicit clear; the name has no clear, because a
   * person with no name is not a state this product has.
   */
  async updateMe(
    actorId: string,
    input: { name?: unknown; about?: unknown },
  ): Promise<ParentProfileDto> {
    const contact = await this.requireContact(actorId);

    const name = input.name === undefined ? undefined : this.requireName(input.name);
    const about = input.about === undefined ? undefined : this.normaliseAbout(input.about);
    if (name === undefined && about === undefined) return this.me(actorId);

    await this.prisma.$transaction(async (tx) => {
      if (name !== undefined && name !== contact.name) {
        await tx.contact.update({ where: { id: contact.id }, data: { name } });
        await this.audit.audit(tx, {
          actorId: contact.id,
          action: 'profile.name.changed',
          entity: 'contact',
          entityId: contact.id,
          // The old and new NAME. A name is the thing being changed, so it belongs in the
          // record; no key, no url, no token ever goes in here.
          before: { name: contact.name },
          after: { name },
          reason: 'contact renamed themselves',
        });
      }
      if (about !== undefined) {
        await this.writeAbout(tx, contact.id, 'contact', contact.id, about);
      }
    });

    return this.me(actorId);
  }

  // ---------------------------------------------------------------- child edits

  /** The same, for a child of the caller's family. The server decides whether it is. */
  async updateChild(
    actorId: string,
    learnerId: string,
    input: { name?: unknown; about?: unknown },
  ): Promise<ParentProfileDto> {
    const contact = await this.requireContact(actorId);
    const learner = await this.requireOwnLearner(contact.familyId, learnerId);

    const name = input.name === undefined ? undefined : this.requireName(input.name);
    const about = input.about === undefined ? undefined : this.normaliseAbout(input.about);
    if (name === undefined && about === undefined) return this.me(actorId);

    await this.prisma.$transaction(async (tx) => {
      if (name !== undefined && name !== learner.name) {
        // Narrowed by familyId as well as id. Belt and braces: the learner was already
        // proven to be in this family, and the write re-states it so a future refactor
        // cannot widen the update by dropping the check above.
        const changed = await tx.learner.updateMany({
          where: { id: learner.id, familyId: contact.familyId },
          data: { name },
        });
        if (changed.count !== 1) {
          throw new CommError(
            CommErrorCode.LEARNER_NOT_IN_FAMILY,
            'that learner is not in your family',
            404,
          );
        }
        await this.audit.audit(tx, {
          actorId: contact.id,
          action: 'profile.child.name.changed',
          entity: 'learner',
          entityId: learner.id,
          before: { name: learner.name },
          after: { name },
          reason: 'authorized contact renamed a learner in their family',
        });
      }
      if (about !== undefined) {
        await this.writeAbout(tx, contact.id, 'learner', learner.id, about);
      }
    });

    return this.me(actorId);
  }

  // ---------------------------------------------------------------- internals

  /**
   * Resolve the caller as a family contact, and read their own row.
   *
   * The only input is the actor id the guard took from the verified token. There is no
   * parameter through which a caller could name somebody else, which is what makes editing
   * another parent structurally impossible rather than merely forbidden.
   */
  private async requireContact(actorId: string): Promise<ContactRow> {
    const actor = await this.identity.resolveActor(actorId);
    if (!actor) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
    if (!actor.isActive) {
      throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'this account is not active', 403);
    }
    if (actor.kind !== ActorKind.CONTACT) {
      throw new CommError(
        CommErrorCode.PROFILE_NOT_AVAILABLE,
        'only a family contact has a parent profile',
        403,
      );
    }

    const contact = await this.prisma.contact.findFirst({
      where: { id: actor.actorId, isActive: true },
      select: {
        id: true,
        familyId: true,
        accountId: true,
        name: true,
        relationship: true,
        canMessage: true,
        avatarObjectKey: true,
      },
    });
    if (!contact) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
    return contact;
  }

  /**
   * THE CHILD AUTHORIZATION BOUNDARY.
   *
   * `learnerId` arrives from the client and is untrusted. It is used only inside a query
   * already narrowed to the caller's family, so a learner belonging to anybody else is not
   * found -- and the refusal is indistinguishable from "no such learner".
   */
  private async requireOwnLearner(
    familyId: string,
    learnerId: unknown,
  ): Promise<{ id: string; name: string }> {
    const id = typeof learnerId === 'string' ? learnerId.trim() : '';
    if (!UUID.test(id)) {
      throw new CommError(
        CommErrorCode.LEARNER_NOT_IN_FAMILY,
        'that learner is not in your family',
        404,
      );
    }

    const learner = await this.prisma.learner.findFirst({
      where: { id, familyId },
      select: { id: true, name: true },
    });
    if (!learner) {
      throw new CommError(
        CommErrorCode.LEARNER_NOT_IN_FAMILY,
        'that learner is not in your family',
        404,
      );
    }
    return learner;
  }

  /**
   * Upsert one About, with an audit entry naming which kind of row moved. The actor is
   * always the parent who saved it -- for a child's About too.
   */
  private async writeAbout(
    tx: Tx,
    actorId: string,
    kind: 'contact' | 'learner',
    id: string,
    about: string | null,
  ): Promise<void> {
    if (kind === 'contact') {
      await tx.contactProfile.upsert({
        where: { contactId: id },
        create: { contactId: id, about },
        update: { about },
      });
    } else {
      await tx.learnerProfile.upsert({
        where: { learnerId: id },
        create: { learnerId: id, about },
        update: { about },
      });
    }

    await this.audit.audit(tx, {
      actorId,
      action: kind === 'contact' ? 'profile.about.saved' : 'profile.child.about.saved',
      entity: kind,
      entityId: id,
      // Length, not content: an About is the person's own prose and the audit trail has no
      // business keeping a copy of it. What matters for an audit is that it changed.
      after: { aboutLength: about?.length ?? 0 },
      reason: `${kind} About saved`,
    });
  }

  /** A name a person can actually be called. Rejects blank and absurd. */
  private requireName(raw: unknown): string {
    const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      throw new CommError(
        CommErrorCode.PROFILE_FIELD_INVALID,
        `a name must be between ${NAME_MIN} and ${NAME_MAX} characters`,
        400,
      );
    }
    return name;
  }

  /** Trim, bound, and treat whitespace-only as cleared. */
  private normaliseAbout(raw: unknown): string | null {
    if (raw === null) return null;
    const about = typeof raw === 'string' ? raw.trim() : '';
    if (!about) return null;
    if (about.length > ABOUT_MAX) {
      throw new CommError(
        CommErrorCode.PROFILE_FIELD_INVALID,
        `About must be ${ABOUT_MAX} characters or fewer`,
        400,
      );
    }
    return about;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bounds match the column check constraint; see the migration. */
const NAME_MIN = 1;
const NAME_MAX = 120;
const ABOUT_MAX = 1000;

/** What a parent is told about themselves. No ids beyond what the UI must address. */
export interface ParentProfileDto {
  displayName: string;
  relationship: string | null;
  /** The login identity, read-only. Never writable through this service. */
  signInIdentity: string | null;
  about: string | null;
  avatarUrl: string | null;
  canMessage: boolean;
  children: ChildProfileDto[];
}

export interface ChildProfileDto {
  /** Addressable so the client can target an edit; it is not a secret. */
  id: string;
  displayName: string;
  level: string | null;
  about: string | null;
  avatarUrl: string | null;
}

type ContactRow = {
  id: string;
  familyId: string;
  accountId: string | null;
  name: string;
  relationship: string | null;
  canMessage: boolean;
  avatarObjectKey: string | null;
};
