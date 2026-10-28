import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AUDIT_SERVICE, OBJECT_STORAGE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import type { Actor } from '../../platform/types';
import { AVATAR_KINDS, avatarKeyOf, avatarPrefixFor, type AvatarKind } from '../../platform/avatar-keys';
import {
  AVATAR_HEAD_BYTES,
  AVATAR_REJECTION_MESSAGE,
  MAX_AVATAR_BYTES,
  isAvatarMime,
  judgeAvatar,
} from '../../staff-profile/image-inspection';
import type { ObjectStorage, UploadAuthorization } from '../attachments/object-storage';
import { ConversationService } from '../conversations/conversation.service';
import { signAvatar } from './avatar-urls';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whose photo a write is about: the caller themself, or one of their children. */
export type AvatarTarget = { kind: 'self' } | { kind: 'child'; learnerId: string };

/**
 * PD-17: may `viewer` see `targetId`'s photo on that person's profile (context
 * `profile`)? Registered by the module that owns the profile, which applies the
 * same rule its own page does. Re-run on every request, like every other context.
 */
export type ProfileAvatarReader = (viewer: Actor, targetId: string) => Promise<boolean>;

interface PhotoRow {
  id: string;
  organizationId: string;
  familyId: string | null;
  avatarObjectKey: string | null;
}

const absent = () => new CommError(CommErrorCode.PROFILE_PHOTO_NOT_FOUND, 'not available', 404);
const invalid = (message: string) => new CommError(CommErrorCode.PROFILE_PHOTO_INVALID, message, 400);

/**
 * Profile photos for everyone in a conversation, WhatsApp-style (owner
 * decision 2026-10-19): parents and teachers set their own photo, parents set
 * their children's, staff keep using their staff profile (RT-037 rules and
 * audit there are unchanged).
 *
 * READ -- who may see a photo is decided per request, never by the link:
 *   - `self`: your own photo, or a child of your own family;
 *   - a conversation: you may read that conversation NOW (the one read check
 *     every path uses, staff scope included), and the person is or was a member
 *     of it or wrote in it, or the child is the one it is about -- in the same
 *     organization;
 *   - `profile` (PD-17): you may open that person's Parent or Student Profile
 *     now, by the rule the profile's own module registered.
 * Every refusal is the same 404.
 *
 * WRITE -- the key a photo is committed under must be structurally under the
 * owner's own prefix (`avatars/<kind>/<owner id>/<uuid>`, also a CHECK in the
 * database), and the stored bytes -- not the client's claim -- must be a real
 * JPEG/PNG/WebP within limits, exactly as for staff photos.
 */
@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);
  private readonly profileReaders = new Map<AvatarKind, ProfileAvatarReader>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- read

  /** PD-17: the rule for `profile` links of one kind. Without one, every such link is refused. */
  registerProfileReader(kind: AvatarKind, reader: ProfileAvatarReader): void {
    this.profileReaders.set(kind, reader);
  }

  async authorizeAvatarRead(viewerId: string, mediaId: string): Promise<{ objectKey: string }> {
    const parts = String(mediaId).split('.');
    if (parts.length !== 3) throw absent();
    const [kind, targetId, context] = parts as [string, string, string];
    if (!AVATAR_KINDS.has(kind) || !UUID.test(targetId)) throw absent();
    if (context !== 'self' && context !== 'profile' && !UUID.test(context)) throw absent();

    const viewer = await this.conversations.requireActor(viewerId).catch(() => null);
    if (!viewer?.organizationId) throw absent();
    const target = await this.row(kind as AvatarKind, targetId);
    if (!target?.avatarObjectKey || target.organizationId !== viewer.organizationId) throw absent();
    if (!avatarKeyOf(kind as AvatarKind, targetId, target.avatarObjectKey)) throw absent();

    const allowed =
      context === 'self'
        ? this.isSelfOrOwnChild(viewer, kind as AvatarKind, target)
        : context === 'profile'
          ? await this.onProfile(viewer, kind as AvatarKind, targetId)
          : await this.isSeenIn(viewer, kind as AvatarKind, targetId, context);
    if (!allowed) throw absent();
    return { objectKey: target.avatarObjectKey };
  }

  private async onProfile(viewer: Actor, kind: AvatarKind, targetId: string): Promise<boolean> {
    const reader = this.profileReaders.get(kind);
    if (!reader) return false;
    return reader(viewer, targetId).catch(() => false);
  }

  private isSelfOrOwnChild(viewer: Actor, kind: AvatarKind, target: PhotoRow): boolean {
    if (kind === 'learner') return viewer.kind === 'contact' && !!viewer.familyId && viewer.familyId === target.familyId;
    return viewer.kind === kind && viewer.actorId === target.id;
  }

  private async isSeenIn(viewer: Actor, kind: AvatarKind, targetId: string, conversationId: string): Promise<boolean> {
    const conv = await this.conversations.requireConversation(conversationId).catch(() => null);
    if (!conv || conv.organizationId !== viewer.organizationId) return false;
    const membership = await this.conversations.membershipOf(conv.id, viewer.actorId);
    const readable = await this.conversations.canReadResolved(viewer, conv, membership);
    if (!readable.allowed) return false;

    if (kind === 'learner') {
      if (conv.learnerId === targetId) return true;
      const linked = await this.prisma.conversationLearner.findFirst({
        where: { conversationId: conv.id, learnerId: targetId },
        select: { learnerId: true },
      });
      return !!linked;
    }
    // A member now or before (history keeps their messages), or an author who
    // was never a member (a super admin stepping in).
    const member = await this.prisma.conversationMember.findFirst({
      where: { conversationId: conv.id, actorId: targetId, actorKind: kind },
      select: { actorId: true },
    });
    if (member) return true;
    const wrote = await this.prisma.message.findFirst({
      where: { conversationId: conv.id, authorId: targetId, authorType: kind },
      select: { id: true },
    });
    return !!wrote;
  }

  private async row(kind: AvatarKind, id: string): Promise<PhotoRow | null> {
    const select = { id: true, organizationId: true, avatarObjectKey: true } as const;
    switch (kind) {
      case 'staff': {
        const r = await this.prisma.staff.findUnique({ where: { id }, select });
        return r && { ...r, familyId: null };
      }
      case 'teacher': {
        const r = await this.prisma.teacher.findUnique({ where: { id }, select });
        return r && { ...r, familyId: null };
      }
      case 'contact':
        return this.prisma.contact.findUnique({ where: { id }, select: { ...select, familyId: true } });
      case 'learner':
        return this.prisma.learner.findUnique({ where: { id }, select: { ...select, familyId: true } });
    }
  }

  // --------------------------------------------------------------- write

  /** The photo this caller may change: their own, or their child's. */
  private async owned(actor: Actor, target: AvatarTarget): Promise<{ kind: AvatarKind; row: PhotoRow }> {
    if (!actor.isActive || !actor.organizationId) throw absent();
    if (target.kind === 'child') {
      if (actor.kind !== 'contact' || !actor.familyId || !UUID.test(target.learnerId)) throw absent();
      const row = await this.row('learner', target.learnerId);
      if (!row || row.familyId !== actor.familyId || row.organizationId !== actor.organizationId) throw absent();
      return { kind: 'learner', row };
    }
    if (actor.kind === 'staff') {
      throw new CommError(
        CommErrorCode.PROFILE_PHOTO_DENIED,
        'staff set their photo on their staff profile (POST /staff-profiles/me/avatar)',
        403,
      );
    }
    if (actor.kind !== 'contact' && actor.kind !== 'teacher') throw absent();
    const row = await this.row(actor.kind, actor.actorId);
    if (!row || row.organizationId !== actor.organizationId) throw absent();
    return { kind: actor.kind, row };
  }

  /** Step 1: a short-lived PUT URL bound to type and size, under the owner's own prefix. */
  async authorizeUpload(
    actorId: string,
    target: AvatarTarget,
    input: { mimeType?: unknown; byteSize?: unknown },
  ): Promise<UploadAuthorization> {
    const actor = await this.conversations.requireActor(actorId);
    const { kind, row } = await this.owned(actor, target);
    return this.uploadFor(kind, row, input);
  }

  private uploadFor(kind: AvatarKind, row: PhotoRow, input: { mimeType?: unknown; byteSize?: unknown }): Promise<UploadAuthorization> {
    if (!isAvatarMime(input.mimeType)) throw invalid('a profile photo must be a JPEG, PNG or WebP image');
    const byteSize = Number(input.byteSize);
    if (!Number.isInteger(byteSize) || byteSize <= 0 || byteSize > MAX_AVATAR_BYTES) {
      throw invalid(`a profile photo must be between 1 byte and ${MAX_AVATAR_BYTES} bytes`);
    }
    return this.storage.authorizeUpload({ prefix: avatarPrefixFor(kind, row.id), mimeType: input.mimeType, byteSize });
  }

  /**
   * Step 2: make an uploaded object the photo. Refused before anything is read
   * unless the key is under the owner's own prefix (a key lifted from someone
   * else's link cannot be worn); then the stored bytes are judged; a rejected
   * object is deleted, and the previous photo is deleted once the new one is
   * committed.
   */
  async commit(actorId: string, target: AvatarTarget, input: { objectKey?: unknown }): Promise<{ avatarUrl: string | null }> {
    const actor = await this.conversations.requireActor(actorId);
    const { kind, row } = await this.owned(actor, target);
    const reason = kind === 'learner' ? 'set by a parent of the family' : 'set by the account holder';
    return this.commitFor(actor, kind, row, input, reason, 'self');
  }

  private async commitFor(
    actor: Actor,
    kind: AvatarKind,
    row: PhotoRow,
    input: { objectKey?: unknown },
    reason: string,
    context: 'self' | 'profile',
  ): Promise<{ avatarUrl: string | null }> {
    const objectKey = typeof input.objectKey === 'string' ? input.objectKey : '';
    if (!avatarKeyOf(kind, row.id, objectKey)) throw invalid('that object is not an upload for this photo');
    // Captured before the write: the row is read once, and what replaces it must
    // never be mistaken for what it replaced.
    const previous = row.avatarObjectKey;
    if (objectKey !== previous) {
      const stored = await this.storage.readHead(objectKey, AVATAR_HEAD_BYTES);
      if (!stored) throw invalid('no uploaded photo was found for that key; upload it first');
      const verdict = judgeAvatar({ head: stored.head, byteSize: stored.byteSize, declaredMime: stored.contentType });
      if (!verdict.ok) {
        await this.discard(objectKey);
        throw invalid(AVATAR_REJECTION_MESSAGE[verdict.reason]);
      }
      try {
        await this.write(actor, kind, row, objectKey, { width: verdict.image.width, height: verdict.image.height }, reason);
      } catch (error) {
        await this.discard(objectKey); // the database refused: nothing references it
        throw error;
      }
      if (previous) await this.discard(previous);
    }
    return { avatarUrl: signAvatar(kind, row.id, context, actor.actorId, objectKey) };
  }

  async remove(actorId: string, target: AvatarTarget): Promise<{ avatarUrl: null }> {
    const actor = await this.conversations.requireActor(actorId);
    const { kind, row } = await this.owned(actor, target);
    const reason = kind === 'learner' ? 'set by a parent of the family' : 'set by the account holder';
    return this.removeFor(actor, kind, row, reason);
  }

  private async removeFor(actor: Actor, kind: AvatarKind, row: PhotoRow, reason: string): Promise<{ avatarUrl: null }> {
    const previous = row.avatarObjectKey;
    if (previous) {
      await this.write(actor, kind, row, null, null, reason);
      await this.discard(previous);
    }
    return { avatarUrl: null };
  }

  // ------------------------------------------- PD-17: a parent's photo, by the administration

  /**
   * The same three steps, for a parent's photo changed from their Parent
   * Profile. The CALLER has already decided the staff member may (the profile's
   * own rule, src/parent-profile); this only re-checks that the contact is in
   * the staff member's organization. The bytes are judged and the key bound to
   * the contact's own prefix exactly as when the parent sets it themself, and
   * the audit row says an administrator set it.
   */
  async authorizeUploadForContact(staff: Actor, contactId: string, input: { mimeType?: unknown; byteSize?: unknown }) {
    return this.uploadFor('contact', await this.contactRow(staff, contactId), input);
  }

  async commitForContact(staff: Actor, contactId: string, input: { objectKey?: unknown }) {
    return this.commitFor(staff, 'contact', await this.contactRow(staff, contactId), input, 'set by an administrator', 'profile');
  }

  async removeForContact(staff: Actor, contactId: string) {
    return this.removeFor(staff, 'contact', await this.contactRow(staff, contactId), 'removed by an administrator');
  }

  private async contactRow(staff: Actor, contactId: string): Promise<PhotoRow> {
    if (staff.kind !== 'staff' || !staff.isActive || !staff.organizationId || !UUID.test(contactId)) throw absent();
    const row = await this.row('contact', contactId);
    if (!row || row.organizationId !== staff.organizationId) throw absent();
    return row;
  }

  /** The caller's own photo (and, for a parent, each child's), as links for them. */
  async mine(actorId: string): Promise<{
    avatarUrl: string | null;
    children: Array<{ id: string; name: string; avatarUrl: string | null }>;
  }> {
    const actor = await this.conversations.requireActor(actorId);
    const self = actor.kind === 'staff' || actor.kind === 'contact' || actor.kind === 'teacher'
      ? await this.row(actor.kind, actor.actorId)
      : null;
    const children =
      actor.kind === 'contact' && actor.familyId
        ? await this.prisma.learner.findMany({
            where: { familyId: actor.familyId, organizationId: actor.organizationId },
            select: { id: true, name: true, avatarObjectKey: true },
            orderBy: { name: 'asc' },
          })
        : [];
    return {
      avatarUrl: self && actor.kind !== 'system' ? signAvatar(actor.kind as AvatarKind, actor.actorId, 'self', actor.actorId, self.avatarObjectKey) : null,
      children: children.map((c) => ({
        id: c.id,
        name: c.name,
        avatarUrl: signAvatar('learner', c.id, 'self', actor.actorId, c.avatarObjectKey),
      })),
    };
  }

  /** Only the avatar column changes; the row is matched on its own id (and family, for a child). */
  private async write(
    actor: Actor,
    kind: AvatarKind,
    row: PhotoRow,
    objectKey: string | null,
    image: { width: number; height: number } | null,
    reason: string,
  ): Promise<void> {
    const hadPhoto = row.avatarObjectKey !== null;
    await this.prisma.$transaction(async (tx) => {
      // PD-42 S3: a staff member's write names them, for the Sales-scope guard on chat.contact.
      if (actor.kind === 'staff') await tx.$executeRaw`SELECT set_config('chat.acting_staff_id', ${actor.actorId}, true)`;
      const data = { avatarObjectKey: objectKey };
      const updated =
        kind === 'contact'
          ? await tx.contact.updateMany({ where: { id: row.id, organizationId: row.organizationId }, data })
          : kind === 'teacher'
            ? await tx.teacher.updateMany({ where: { id: row.id, organizationId: row.organizationId }, data })
            : await tx.learner.updateMany({
                where: { id: row.id, organizationId: row.organizationId, familyId: row.familyId ?? '' },
                data,
              });
      if (updated.count !== 1) throw absent();
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: objectKey ? 'profile_photo.set' : 'profile_photo.removed',
        entity: kind,
        entityId: row.id,
        before: { hasPhoto: hadPhoto },
        after: objectKey ? { hasPhoto: true, ...image } : { hasPhoto: false },
        reason,
      });
    });
  }

  private async discard(objectKey: string): Promise<void> {
    try {
      await this.storage.delete(objectKey);
    } catch (error) {
      this.logger.warn(`could not delete unreferenced avatar object: ${(error as Error).message}`);
    }
  }
}
