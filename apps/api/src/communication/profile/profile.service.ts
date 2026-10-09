import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, IDENTITY_SERVICE, OBJECT_STORAGE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import type { IdentityService } from '../../platform/identity.service';
import type { ObjectStorage, UploadAuthorization } from '../attachments/object-storage';
import type { Actor } from '../../platform/types';
import { ActorKind } from '../contracts/vocab';
import { signAvatar } from './avatar-urls';

/**
 * The signed-in parent's own profile, and the photos they are allowed to manage.
 *
 * ## WHOSE PROFILE: NEVER A PARAMETER
 *
 * Every method takes `actorId` and nothing else identifying. That id comes from the
 * authenticated request, which only the auth guard writes, which only a verified token
 * produces. There is no route parameter, body field or header naming a parent, so there is
 * no id to tamper with: `GET /me/profile` cannot be pointed at somebody else because it
 * takes no target at all.
 *
 * ## PARENT -> CHILD: THE FAMILY IS THE JOIN, NOT A CHECK AFTERWARDS
 *
 * A learner is reachable only through `familyId` resolved from the caller's own contact
 * row. The family predicate is part of the WHERE clause rather than an `if` after the
 * fetch, so there is no code path that loads somebody else's learner and then decides. A
 * learner in another family answers exactly as a learner that does not exist
 * (LEARNER_NOT_FOUND, 404), so the endpoint cannot be used to discover which ids are real.
 *
 * ## WHAT A PARENT MAY CHANGE: THE PHOTO, AND NOTHING ELSE
 *
 * There is no generic update method here and no object is ever spread into a Prisma
 * `data`. Each method writes one named column. Academic identity, teacher assignment,
 * level, schedule, subscription and every permission flag are unreachable from this
 * service by construction, not by validation.
 *
 * ## NO CONTACT FILE
 *
 * `chat.contact` has no phone or email column and this service does not invent one. The
 * only email-shaped value in the system is `chat.account.subject`, which is the LOGIN
 * IDENTITY: it is returned read-only and there is no method here that writes it, because
 * changing an auth identity without a verification flow is a security change disguised as
 * a profile edit.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** The caller's own profile. Takes no target: there is nothing to tamper with. */
  async me(actorId: string): Promise<ParentProfileDto> {
    const { actor, contact } = await this.requireContact(actorId);

    const account = contact.accountId
      ? await this.prisma.account.findUnique({
          where: { id: contact.accountId },
          select: { subject: true },
        })
      : null;

    const learners = await this.prisma.learner.findMany({
      where: { familyId: contact.familyId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, level: true, avatarObjectKey: true },
    });

    return {
      displayName: contact.name,
      relationship: contact.relationship,
      // The login identity, read-only. See the class doc.
      signInIdentity: account?.subject ?? null,
      avatarUrl: await this.signAvatar(contact.avatarObjectKey),
      canMessage: actor.canMessage === true,
      children: await Promise.all(
        learners.map(async (l) => ({
          id: l.id,
          displayName: l.name,
          level: l.level,
          avatarUrl: await this.signAvatar(l.avatarObjectKey),
        })),
      ),
    };
  }

  /**
   * Authorize a profile-photo upload.
   *
   * The same object-storage seam, bucket and signing rules attachments and stories use --
   * there is no second upload pipeline. The returned key is a NAME: holding it reads
   * nothing, because reads are minted per request by [signAvatar] for the owner only.
   *
   * Type and size are enforced HERE, server-side. A client check is a convenience; this is
   * the control.
   */
  async authorizeAvatarUpload(
    actorId: string,
    params: { mimeType: string; byteSize: number },
  ): Promise<UploadAuthorization> {
    // Any principal that can OWN a photo may ask for an upload grant -- contact, staff or
    // teacher. The grant is bound to a type and a size and names no actor, so it confers
    // nothing beyond "you may put these bytes at this key"; ownership is decided when the
    // key is committed, below.
    await this.requireAvatarOwner(actorId);

    if (!AVATAR_TYPES.test(params.mimeType)) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        `mime type ${params.mimeType} is not allowed for a profile photo`,
        400,
      );
    }
    if (
      !Number.isFinite(params.byteSize) ||
      params.byteSize <= 0 ||
      params.byteSize > MAX_AVATAR_BYTES
    ) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TOO_LARGE,
        `a profile photo must be between 1 and ${MAX_AVATAR_BYTES} bytes`,
        400,
      );
    }

    return this.storage.authorizeUpload({
      prefix: 'avatars',
      mimeType: params.mimeType,
      byteSize: params.byteSize,
    });
  }

  /**
   * Set or replace THE CALLER'S OWN photo. Writes one column on one row.
   *
   * Takes no target id -- not a contact id, not a teacher id, not a staff id. The row
   * written is the one the bearer token resolves to, which is what makes mutating somebody
   * else's photo structurally impossible rather than merely forbidden.
   *
   * A contact gets their whole profile back, as they always did. Staff and teachers have no
   * parent profile, so they get the smaller shape -- which is a strict SUBSET of the
   * parent's, so a client that reads only `displayName` and `avatarUrl` works for all three.
   */
  async setAvatar(actorId: string, objectKey: string): Promise<ParentProfileDto | ActorAvatarDto> {
    const owner = await this.requireAvatarOwner(actorId);
    const key = this.requireAvatarKey(objectKey);

    await this.writeOwnAvatar(owner, key);

    return owner.kind === ActorKind.CONTACT
      ? this.me(actorId)
      : { displayName: owner.displayName, avatarUrl: await this.signAvatar(key) };
  }

  /**
   * Remove the caller's own photo. The fallback avatar is the client's business.
   *
   * The stored object is deliberately NOT deleted: removal is a profile edit, and a
   * retention sweep is a separate concern with its own lifecycle. Nulling the column is
   * what makes the photo unreachable, because every read is signed from the column.
   */
  async removeAvatar(actorId: string): Promise<ParentProfileDto | ActorAvatarDto> {
    const owner = await this.requireAvatarOwner(actorId);

    if (owner.avatarObjectKey) {
      await this.writeOwnAvatar(owner, null);
    }

    return owner.kind === ActorKind.CONTACT
      ? this.me(actorId)
      : { displayName: owner.displayName, avatarUrl: null };
  }

  /**
   * The caller's own name and photo, whatever kind they are.
   *
   * The one read a teacher or an admin needs to render their own avatar control. A contact
   * may call it too, but has the richer `me()` available.
   */
  async myAvatar(actorId: string): Promise<ActorAvatarDto> {
    const owner = await this.requireAvatarOwner(actorId);
    return {
      displayName: owner.displayName,
      avatarUrl: await this.signAvatar(owner.avatarObjectKey),
    };
  }

  /**
   * Set or replace a child's photo.
   *
   * `learnerId` arrives from the client and is treated as untrusted: it is used only
   * INSIDE a query already narrowed to the caller's own family, so a learner belonging to
   * anybody else is simply not found.
   */
  async setChildAvatar(
    actorId: string,
    learnerId: string,
    objectKey: string,
  ): Promise<ParentProfileDto> {
    const { contact } = await this.requireContact(actorId);
    const learner = await this.requireOwnLearner(contact.familyId, learnerId);
    const key = this.requireAvatarKey(objectKey);

    await this.prisma.$transaction(async (tx) => {
      // Conditional on the family as well as the id: belt and braces, so even a future
      // refactor of the lookup cannot turn this into an unscoped write.
      const changed = await tx.learner.updateMany({
        where: { id: learner.id, familyId: contact.familyId },
        data: { avatarObjectKey: key },
      });
      if (changed.count === 0) {
        throw new CommError(CommErrorCode.LEARNER_NOT_FOUND, 'learner not found', 404);
      }
      await this.audit.audit(tx, {
        actorId: contact.id,
        action: 'profile.child.avatar.set',
        entity: 'learner',
        entityId: learner.id,
        after: { avatarObjectKey: key },
        reason: 'contact set a photo for a learner in their family',
      });
    });

    return this.me(actorId);
  }

  /** Remove a child's photo, under the same family predicate. */
  async removeChildAvatar(actorId: string, learnerId: string): Promise<ParentProfileDto> {
    const { contact } = await this.requireContact(actorId);
    const learner = await this.requireOwnLearner(contact.familyId, learnerId);

    if (learner.avatarObjectKey) {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.learner.updateMany({
          where: { id: learner.id, familyId: contact.familyId },
          data: { avatarObjectKey: null },
        });
        if (changed.count === 0) {
          throw new CommError(CommErrorCode.LEARNER_NOT_FOUND, 'learner not found', 404);
        }
        await this.audit.audit(tx, {
          actorId: contact.id,
          action: 'profile.child.avatar.removed',
          entity: 'learner',
          entityId: learner.id,
          before: { avatarObjectKey: learner.avatarObjectKey },
          reason: 'contact removed a photo for a learner in their family',
        });
      });
    }

    return this.me(actorId);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** The caller as a family contact, or a refusal. Staff and teachers have no parent profile. */
  /**
   * Resolve the caller as somebody who may own a photo, and read their own row.
   *
   * ## This is the authorization boundary, and it takes no target
   *
   * The only input is `actorId`, which the controller takes from the bearer token via
   * `@ActorId()` -- never from a path, a body or a query. So there is no id for a caller to
   * substitute: a teacher resolves to their own teacher row and a staff member to their own
   * staff row, and "mutate somebody else's avatar" is not a request this API can express.
   * That is the same property that makes the parent flow safe (no `:parentId` anywhere).
   *
   * Three kinds can own a photo. A learner cannot act, so they never reach here -- their
   * photo is set by an authorized contact of the same family, which stays in
   * `setChildAvatar`. The system actor owns nothing.
   */
  private async requireAvatarOwner(actorId: string): Promise<AvatarOwner> {
    const actor = await this.identity.resolveActor(actorId);
    if (!actor) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
    if (!actor.isActive) {
      throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'this account is not active', 403);
    }

    // `where` is keyed by the RESOLVED actor id in every branch. Nothing from the request
    // reaches it.
    switch (actor.kind) {
      case ActorKind.CONTACT: {
        const row = await this.prisma.contact.findFirst({
          where: { id: actor.actorId, isActive: true },
          select: { id: true, name: true, avatarObjectKey: true },
        });
        if (!row) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
        return { ...row, kind: ActorKind.CONTACT, displayName: row.name };
      }
      case ActorKind.STAFF: {
        const row = await this.prisma.staff.findFirst({
          where: { id: actor.actorId, isActive: true },
          select: { id: true, name: true, avatarObjectKey: true },
        });
        if (!row) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
        return { ...row, kind: ActorKind.STAFF, displayName: row.name };
      }
      case ActorKind.TEACHER: {
        const row = await this.prisma.teacher.findFirst({
          where: { id: actor.actorId, isActive: true },
          select: { id: true, name: true, avatarObjectKey: true },
        });
        if (!row) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
        return { ...row, kind: ActorKind.TEACHER, displayName: row.name };
      }
      default:
        throw new CommError(
          CommErrorCode.PROFILE_NOT_AVAILABLE,
          'this kind of principal has no profile photo',
          403,
        );
    }
  }

  /**
   * Write one avatar column on the owner's OWN row, with an audit entry.
   *
   * The table is chosen by the owner's resolved kind, never by anything the caller said.
   * `null` removes. The audit record carries the KEY and never the bytes or a URL.
   */
  private async writeOwnAvatar(owner: AvatarOwner, key: string | null): Promise<void> {
    const entity = owner.kind;
    const verb = key === null ? 'removed' : 'set';

    await this.prisma.$transaction(async (tx) => {
      const data = { avatarObjectKey: key };
      switch (owner.kind) {
        case ActorKind.CONTACT:
          await tx.contact.update({ where: { id: owner.id }, data });
          break;
        case ActorKind.STAFF:
          await tx.staff.update({ where: { id: owner.id }, data });
          break;
        case ActorKind.TEACHER:
          await tx.teacher.update({ where: { id: owner.id }, data });
          break;
      }
      await this.audit.audit(tx, {
        actorId: owner.id,
        action: `profile.avatar.${verb}`,
        entity,
        entityId: owner.id,
        ...(key === null
          ? { before: { avatarObjectKey: owner.avatarObjectKey } }
          : { after: { avatarObjectKey: key } }),
        reason: `${entity} ${verb} their own profile photo`,
      });
    });
  }

  private async requireContact(actorId: string): Promise<{ actor: Actor; contact: ContactRow }> {
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
        avatarObjectKey: true,
      },
    });
    if (!contact) {
      throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
    }
    return { actor, contact };
  }

  /** A learner in the caller's OWN family, or a 404 that reveals nothing. */
  private async requireOwnLearner(familyId: string, learnerId: string): Promise<LearnerRow> {
    if (typeof learnerId !== 'string' || !UUID.test(learnerId)) {
      // A malformed id fails closed and identically, so probing with junk learns nothing.
      throw new CommError(CommErrorCode.LEARNER_NOT_FOUND, 'learner not found', 404);
    }
    const learner = await this.prisma.learner.findFirst({
      where: { id: learnerId, familyId },
      select: { id: true, avatarObjectKey: true },
    });
    if (!learner) {
      throw new CommError(CommErrorCode.LEARNER_NOT_FOUND, 'learner not found', 404);
    }
    return learner;
  }

  /**
   * The key must be one this system issues, and must stay inside the avatar prefix.
   *
   * Without this a caller could hand back any string -- `stories/<someone-else's-media>`,
   * or a traversal -- and have the row point at it, turning a profile update into a read
   * of somebody else's object the next time it is signed.
   */
  private requireAvatarKey(objectKey: unknown): string {
    const key = typeof objectKey === 'string' ? objectKey.trim() : '';
    if (!AVATAR_KEY.test(key)) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        'that is not an avatar object key',
        400,
      );
    }
    return key;
  }

  /**
   * Delegates to the shared rule, which Group Info uses too. Kept as a method because
   * every call site here reads better for it, and because the storage seam is held here.
   */
  private signAvatar(objectKey: string | null): Promise<string | null> {
    return signAvatar(this.storage, objectKey);
  }
}

/** Images only, and only the formats a phone camera or gallery actually produces. */
const AVATAR_TYPES = /^image\/(jpeg|png|webp|heic)$/;
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `avatars/<uuid-ish name>` and nothing else -- no traversal, no other prefix. */
const AVATAR_KEY = /^avatars\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type ContactRow = {
  id: string;
  familyId: string;
  accountId: string | null;
  name: string;
  relationship: string | null;
  avatarObjectKey: string | null;
};

type LearnerRow = { id: string; avatarObjectKey: string | null };

/** What a parent is told about themselves. No ids beyond what the UI must address. */
/**
 * The caller's own name and photo, for a principal that has no richer profile.
 *
 * Deliberately a strict SUBSET of [ParentProfileDto]'s first fields, so one client can read
 * either: the Admin Web avatar panel and the teacher's My Account both want exactly these
 * two, and a parent's fuller response satisfies them too.
 */
export interface ActorAvatarDto {
  displayName: string;
  avatarUrl: string | null;
}

/** A principal that may own a photo, with their own row already read. */
interface AvatarOwner {
  id: string;
  kind: string;
  displayName: string;
  avatarObjectKey: string | null;
}

export interface ParentProfileDto {
  displayName: string;
  relationship: string | null;
  /** The login identity, read-only. Never writable through this service. */
  signInIdentity: string | null;
  avatarUrl: string | null;
  canMessage: boolean;
  children: ChildProfileDto[];
}

export interface ChildProfileDto {
  /** Addressable so the client can target a photo change; it is not a secret. */
  id: string;
  displayName: string;
  level: string | null;
  avatarUrl: string | null;
}
