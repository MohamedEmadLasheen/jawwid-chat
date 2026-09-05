import { Inject, Injectable } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { OBJECT_STORAGE } from '../../platform/tokens';
import type { ObjectStorage, UploadAuthorization } from './object-storage';
import { ThreadService } from '../threads/thread.service';

/** Configurable limits. Read from env so ops can tune without a deploy. */
const MAX_BYTES: Record<string, number> = {
  IMAGE: Number(process.env.ATTACHMENT_MAX_BYTES_IMAGE ?? 10 * 1024 * 1024),
  VIDEO: Number(process.env.ATTACHMENT_MAX_BYTES_VIDEO ?? 100 * 1024 * 1024),
  VOICE: Number(process.env.ATTACHMENT_MAX_BYTES_VOICE ?? 16 * 1024 * 1024),
  FILE: Number(process.env.ATTACHMENT_MAX_BYTES_FILE ?? 25 * 1024 * 1024),
};

const ALLOWED_MIME: Record<string, RegExp> = {
  IMAGE: /^image\/(jpeg|png|webp|heic|gif)$/,
  VIDEO: /^video\/(mp4|quicktime|webm)$/,
  VOICE: /^audio\/(mpeg|mp4|aac|ogg|webm|wav)$/,
  FILE: /^application\/(pdf|zip|msword|vnd\..+)$|^text\/plain$/,
};

@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly threads: ThreadService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Upload authorization is granted only to an actor who may write to the
   * thread, so an object key can never be minted for a conversation the caller
   * has no access to.
   */
  async authorizeUpload(params: {
    threadId: string;
    userId: string;
    kind: MessageType;
    mimeType: string;
    byteSize: number;
  }): Promise<UploadAuthorization> {
    const actor = await this.threads.requireActor(params.userId);
    const thread = await this.prisma.thread.findUnique({ where: { id: params.threadId } });
    if (!thread) throw new CommError(CommErrorCode.THREAD_NOT_FOUND, 'thread not found', 404);

    const decision = this.authz.canReadThread(actor, thread);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    this.validate(params.kind, params.mimeType, params.byteSize);

    return this.storage.authorizeUpload({
      prefix: `threads/${params.threadId}`,
      mimeType: params.mimeType,
      byteSize: params.byteSize,
    });
  }

  validate(kind: MessageType, mimeType: string, byteSize: number): void {
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
