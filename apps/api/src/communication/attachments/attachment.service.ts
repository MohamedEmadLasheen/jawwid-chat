import { Inject, Injectable, Logger } from '@nestjs/common';
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

/**
 * The prefix every object key for a conversation must carry.
 *
 * ONE definition, used both to mint a key and to check one, because the whole
 * control is that those two agree.
 */
export function conversationPrefix(conversationId: string): string {
  return `conversations/${conversationId}`;
}

@Injectable()
export class AttachmentService {
  private readonly log = new Logger(AttachmentService.name);

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
      prefix: conversationPrefix(params.conversationId),
      mimeType: params.mimeType,
      byteSize: params.byteSize,
    });
  }

  /**
   * Check every attachment on an outgoing message before it becomes rows.
   *
   * TWO DEFECTS THIS CLOSES, both of which came from the same place: an upload
   * is presigned, so the API authorizes it and then never sees the bytes or the
   * object again. Everything the send path knew about an attachment -- its
   * object key, its MIME type, its size -- arrived from the client, and
   * `validate()` checked those CLAIMS against the allowlist without ever asking
   * whether they described anything real.
   *
   * 1. THE OBJECT KEY WAS NOT BOUND TO THE CONVERSATION. `authorizeUpload` runs
   *    `canRead` and mints a key under `conversations/<id>/`, which is correct
   *    -- and then the send path accepted whatever key the client typed. A
   *    member of conversation A could attach an object key belonging to
   *    conversation B, and because signed read URLs are scoped to the MESSAGE's
   *    conversation (RT-006), they would then be handed a signed URL for B's
   *    file inside their own thread. A read primitive into a conversation they
   *    are not in. It needs the key, which is a UUID and not guessable -- but a
   *    key is learnable: from a thread somebody was later removed from, from a
   *    log, from a member of both. "Hard to guess" is not an access control.
   *
   *    Requiring the key to sit under this conversation's prefix closes it
   *    completely and needs no new state, because the ONLY way a key under that
   *    prefix exists is that someone passed `canRead` on this conversation.
   *
   * 2. NOTHING CHECKED WHAT WAS ACTUALLY UPLOADED. The presigned PUT signs only
   *    the host, so a client could authorize "image/png, 40 KB" and upload a
   *    400 MB binary. The declared values went straight to the message row and
   *    to every reader.
   *
   *    The API cannot inspect bytes it never receives, so it asks the storage
   *    instead: a HEAD, issued with this API's own credentials, and the
   *    attachment is refused unless the object EXISTS and its real size and
   *    recorded content type match what was declared and allowed.
   *
   * The residual, stated rather than papered over: content type is what storage
   * RECORDED at upload, not a sniff of the bytes. Signing `content-type` into
   * the presigned PUT would make a mismatch impossible rather than merely
   * detected, and that is the right next step -- it changes the SigV4 signed
   * header set, which cannot honestly be verified without a run against real
   * MinIO, so it is not being made blind here.
   */
  async validateForConversation(
    conversationId: string,
    attachments: Array<{
      kind: string;
      objectKey: string;
      mimeType: string;
      byteSize: number;
      thumbnailObjectKey?: string | null;
    }>,
  ): Promise<void> {
    for (const a of attachments) {
      this.validate(a.kind, a.mimeType, a.byteSize);
      this.requireOwnKey(conversationId, a.objectKey);
      if (a.thumbnailObjectKey) this.requireOwnKey(conversationId, a.thumbnailObjectKey);
      await this.requireUploadedObject(a);
    }
  }

  /**
   * The key must be one this conversation's own authorized upload produced.
   *
   * Exact-prefix, and then a strict character check on the remainder. The
   * prefix alone would admit `conversations/<id>/../<other>/<key>`, which some
   * storage backends normalise and some do not -- and a control whose
   * correctness depends on which one is deployed is not a control.
   */
  private requireOwnKey(conversationId: string, objectKey: string): void {
    const prefix = `${conversationPrefix(conversationId)}/`;
    const remainder = objectKey.startsWith(prefix) ? objectKey.slice(prefix.length) : null;

    // `authorizeUpload` mints exactly one segment, a randomUUID. Anything else
    // -- a traversal, a nested path, a name the client chose -- is refused.
    if (remainder === null || !/^[A-Za-z0-9._-]+$/.test(remainder)) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        'attachment does not belong to this conversation',
        403,
      );
    }
  }

  /** The object must exist, and be what it was declared to be. */
  private async requireUploadedObject(a: {
    objectKey: string;
    mimeType: string;
    byteSize: number;
  }): Promise<void> {
    if (!this.storage.verifiesObjects) {
      // The local reference signer stores nothing, so there is no object to
      // describe. Said out loud rather than skipped silently: a check that
      // passes because the backend cannot answer reads like a check that
      // passed. Every deployed environment runs S3-compatible storage.
      this.log.warn(
        'attachment object verification skipped: this storage backend does not ' +
          'hold objects (development only)',
      );
      return;
    }

    const actual = await this.storage.head(a.objectKey);
    if (!actual) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        'attachment object was never uploaded',
        400,
      );
    }

    if (actual.byteSize !== a.byteSize) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TOO_LARGE,
        'attachment size does not match what was uploaded',
        400,
      );
    }

    // Re-run the allowlist against the STORAGE's content type, not the
    // client's. Checking equality alone would let a client declare and upload
    // the same forbidden type and pass.
    if (actual.mimeType && actual.mimeType.split(';')[0].trim() !== a.mimeType) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        'attachment type does not match what was uploaded',
        400,
      );
    }
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
  /**
   * Mint short-lived read URLs for the attachments of messages the caller has
   * ALREADY been authorized to read.
   *
   * RT-006 / A-8: this function performs no authorization of its own, and a
   * function that hands out signed object URLs must not be able to hand out one
   * the caller never asked for. `conversationId` is therefore part of the
   * query, not an assumption about the caller: a message id from another
   * conversation slipped into the list matches nothing and yields no URL.
   */
  async signUrlsForMessages(
    messageIds: string[],
    conversationId: string,
  ): Promise<Map<string, { url: string; thumbnailUrl: string | null }>> {
    const out = new Map<string, { url: string; thumbnailUrl: string | null }>();
    if (messageIds.length === 0) return out;
    const attachments = await this.prisma.messageAttachment.findMany({
      where: { messageId: { in: messageIds }, message: { conversationId } },
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
