import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { OBJECT_STORAGE } from '../../platform/tokens';
import type { ObjectStorage, UploadAuthorization } from './object-storage';
import { ConversationService } from '../conversations/conversation.service';
import { Visibility } from '../contracts/vocab';

/** Configurable limits. Read from env so ops can tune without a deploy. */
const MAX_BYTES: Record<string, number> = {
  image: Number(process.env.ATTACHMENT_MAX_BYTES_IMAGE ?? 10 * 1024 * 1024),
  video: Number(process.env.ATTACHMENT_MAX_BYTES_VIDEO ?? 100 * 1024 * 1024),
  voice: Number(process.env.ATTACHMENT_MAX_BYTES_VOICE ?? 16 * 1024 * 1024),
  file: Number(process.env.ATTACHMENT_MAX_BYTES_FILE ?? 25 * 1024 * 1024),
};

/**
 * Voice notes are the one kind whose duration is meaningful to the UI: it is
 * rendered before a byte is fetched. It is also entirely client-asserted, so it
 * is bounded here rather than trusted.
 */
const MAX_VOICE_DURATION_MS = Number(process.env.ATTACHMENT_MAX_VOICE_DURATION_MS ?? 10 * 60 * 1000);

const ALLOWED_MIME: Record<string, RegExp> = {
  image: /^image\/(jpeg|png|webp|heic|gif)$/,
  video: /^video\/(mp4|quicktime|webm)$/,
  voice: /^audio\/(mpeg|mp4|aac|ogg|webm|wav)$/,
  file: /^application\/(pdf|zip|msword|vnd\..+)$|^text\/plain$/,
};

@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Upload authorization is granted only to an actor who may write to the
   * thread, so an object key can never be minted for a conversation the caller
   * has no access to.
   *
   * SEND AUTHORITY, NOT READ AUTHORITY. This gate used to be `canRead`, which
   * admits anyone who may *open* the thread -- a member of an archived
   * conversation, a silenced member, a contact whose can_message is false. Those
   * actors cannot post the resulting message, but with a working
   * `PUT /storage/:objectKey` they could still write bytes into storage, over
   * and over, for a message that would never exist. The gate is the same
   * `canSend` the send path uses, evaluated over the same facts, so there is one
   * source of truth for who may write to a conversation rather than a second
   * authorization model owned by attachments.
   *
   * `MessageService.send` still re-runs `canSend` with the real visibility and
   * re-validates every attachment, so this is a gate on spending storage, never
   * a substitute for the decision made at send time.
   */
  async authorizeUpload(params: {
    conversationId: string;
    actorId: string;
    kind: string;
    mimeType: string;
    byteSize: number;
    /** The visibility the attachment is destined for. Staff may write internal
     *  notes off duty, so an upload for one must be judged as an internal send.
     *  A contact or teacher asking for INTERNAL is denied by canSend, exactly as
     *  their message would be. */
    visibility?: string;
  }): Promise<UploadAuthorization> {
    const now = new Date();
    const actor = await this.conversations.requireActor(params.actorId);
    const conv = await this.conversations.requireConversation(params.conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);

    // The same inputs MessageService.send gathers. canSend derives owner and
    // coverage from these; none of them is taken from the request.
    const family = conv.familyId
      ? await this.prisma.family.findUnique({
          where: { id: conv.familyId },
          select: { ownerId: true },
        })
      : null;
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId: conv.id, leftAt: null },
    });

    const decision = await this.authz.canSend(
      actor,
      conv,
      membership,
      { visibility: params.visibility ?? Visibility.CUSTOMER },
      now,
      family?.ownerId ?? null,
      members.map((m) => m.actorKind),
      await this.conversations.liveMembersOf(conv.id),
      // PD-6: uploading into a channel is sending into it. Authorizing the
      // upload without the relationship check would leave a way to put content
      // in a conversation whose relationship has been revoked.
      await this.conversations.pairingAuthorizedAmong(members),
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    this.validate(params.kind, params.mimeType, params.byteSize);

    return this.storage.authorizeUpload({
      prefix: `conversations/${params.conversationId}`,
      mimeType: params.mimeType,
      byteSize: params.byteSize,
    });
  }

  validate(kind: string, mimeType: string, byteSize: number, durationMs?: number | null): void {
    const key = kind as string;
    const max = MAX_BYTES[key];
    const allowed = ALLOWED_MIME[key];
    if (!max || !allowed) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        `${kind} cannot carry an attachment`,
        400,
      );
    }
    if (!allowed.test(mimeType)) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        `mime type ${mimeType} is not allowed for ${kind}`,
        400,
      );
    }
    if (byteSize <= 0 || byteSize > max) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TOO_LARGE,
        `attachment exceeds the ${max} byte limit for ${kind}`,
        400,
      );
    }
    this.validateDuration(kind, durationMs);
  }

  /**
   * A duration is a display value the client asserts, and the server never
   * decodes the audio to check it. Bounding it stops a sender from writing a
   * negative, non-finite or absurd length that every recipient's player then
   * has to render.
   */
  private validateDuration(kind: string, durationMs?: number | null): void {
    if (durationMs === undefined || durationMs === null) return;
    const invalid =
      !Number.isFinite(durationMs) ||
      !Number.isInteger(durationMs) ||
      durationMs < 0 ||
      (kind === 'voice' && durationMs > MAX_VOICE_DURATION_MS);
    if (invalid) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        `durationMs ${durationMs} is not a valid duration for ${kind}`,
        400,
      );
    }
  }

  /** Signed URLs are minted per read and expire; they are never stored. */
  async signUrlsForMessages(
    messageIds: string[],
  ): Promise<Map<string, { url: string; thumbnailUrl: string | null }>> {
    const out = new Map<string, { url: string; thumbnailUrl: string | null }>();
    if (messageIds.length === 0) return out;
    const attachments = await this.prisma.messageAttachment.findMany({
      where: { messageId: { in: messageIds } },
    });
    const ttl = Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? 300);
    for (const a of attachments) {
      out.set(a.id, {
        url: await this.storage.signedReadUrl(a.objectKey, ttl),
        thumbnailUrl: a.thumbnailObjectKey
          ? await this.storage.signedReadUrl(a.thumbnailObjectKey, ttl)
          : null,
      });
    }
    return out;
  }
}
