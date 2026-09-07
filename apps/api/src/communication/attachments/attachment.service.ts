import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { OBJECT_STORAGE } from '../../platform/tokens';
import type { ObjectStorage, UploadAuthorization } from './object-storage';
import { ConversationService } from '../conversations/conversation.service';

/** Configurable limits. Read from env so ops can tune without a deploy. */
const MAX_BYTES: Record<string, number> = {
  image: Number(process.env.ATTACHMENT_MAX_BYTES_IMAGE ?? 10 * 1024 * 1024),
  video: Number(process.env.ATTACHMENT_MAX_BYTES_VIDEO ?? 100 * 1024 * 1024),
  voice: Number(process.env.ATTACHMENT_MAX_BYTES_VOICE ?? 16 * 1024 * 1024),
  file: Number(process.env.ATTACHMENT_MAX_BYTES_FILE ?? 25 * 1024 * 1024),
};

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
   */
  async authorizeUpload(params: {
    conversationId: string;
    actorId: string;
    kind: string;
    mimeType: string;
    byteSize: number;
  }): Promise<UploadAuthorization> {
    const actor = await this.conversations.requireActor(params.actorId);
    const conv = await this.conversations.requireConversation(params.conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);

    const decision = this.authz.canRead(
      actor,
      conv,
      membership,
      await this.conversations.scopeFor(actor, conv),
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    this.validate(params.kind, params.mimeType, params.byteSize);

    return this.storage.authorizeUpload({
      prefix: `conversations/${params.conversationId}`,
      mimeType: params.mimeType,
      byteSize: params.byteSize,
    });
  }

  validate(kind: string, mimeType: string, byteSize: number): void {
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
