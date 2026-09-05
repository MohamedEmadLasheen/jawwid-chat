import { Inject, Injectable } from '@nestjs/common';
import {
  AuthorType,
  MessageOrigin,
  MessageType,
  MessageVisibility,
  ModerationStatus,
  OnBehalfMode,
  Prisma,
  ReceiptState,
  Thread,
} from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, IDENTITY_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { AuditService } from '../../platform/audit.service';
import { Actor } from '../../platform/types';
import { ThreadService } from '../threads/thread.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import { MessageDto, toMessageDto, needsReply, conversationState } from '../contracts/dto';

export interface AttachmentInput {
  kind: MessageType;
  objectKey: string;
  mimeType: string;
  byteSize: number;
  checksumSha256?: string | null;
  originalName?: string | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  thumbnailObjectKey?: string | null;
}

export interface SendMessageInput {
  threadId: string;
  senderId: string;
  type?: MessageType;
  body?: string | null;
  visibility?: MessageVisibility;
  origin?: MessageOrigin;
  /** Client-generated idempotency key. Strongly recommended for mobile. */
  clientMessageId?: string | null;
  replyToMessageId?: string | null;
  caseId?: string | null;
  attachments?: AttachmentInput[];
  /** Only ASSIST / ESCALATION are honoured; OWNER vs COVERAGE is derived. */
  requestedMode?: OnBehalfMode;
}

export interface ListMessagesInput {
  threadId: string;
  userId: string;
  /** Return messages with seq < before (descending page). */
  before?: string;
  /** Return messages with seq > after (reconnect / catch-up). */
  after?: string;
  limit?: number;
}

@Injectable()
export class MessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly threads: ThreadService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------
  // Send
  // -------------------------------------------------------------------

  async send(input: SendMessageInput): Promise<MessageDto> {
    const now = new Date();
    const actor = await this.threads.requireActor(input.senderId);

    const thread = await this.prisma.thread.findUnique({ where: { id: input.threadId } });
    if (!thread) throw new CommError(CommErrorCode.THREAD_NOT_FOUND, 'thread not found', 404);

    const family = await this.prisma.family.findUnique({ where: { id: thread.familyId } });
    if (!family) throw new CommError(CommErrorCode.THREAD_NOT_FOUND, 'family not found', 404);

    // Idempotency fast path. The unique constraint below is the real guarantee;
    // this only avoids doing the work twice in the common retry case.
    if (input.clientMessageId) {
      const existing = await this.findByClientMessageId(
        input.threadId,
        actor.userId,
        input.clientMessageId,
      );
      if (existing) return existing;
    }

    const visibility = input.visibility ?? MessageVisibility.CUSTOMER;
    const type = input.type ?? MessageType.TEXT;

    const decision = await this.authz.canSendMessage(
      actor,
      thread,
      family.ownerId,
      { visibility, requestedMode: input.requestedMode },
      now,
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    this.validateContent(type, input);
    await this.validateReplyTarget(input.threadId, input.replyToMessageId ?? null);

    const authorType =
      actor.kind === 'STAFF'
        ? AuthorType.STAFF
        : actor.kind === 'CONTACT'
          ? AuthorType.CONTACT
          : AuthorType.SYSTEM;

    // Brief section 12 non-negotiable: every staff message carries on_behalf_mode.
    if (authorType === AuthorType.STAFF && !decision.onBehalfMode) {
      throw new CommError(
        CommErrorCode.MISSING_ON_BEHALF_MODE,
        'staff message requires an on_behalf_mode',
        500,
      );
    }

    const stickyMinutes = await this.config.get('handoff.grace_minutes');
    const audience = await this.identity.familyThreadAudience(thread.familyId);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Serialize sequence assignment for this thread. Ordering is decided by
        // the server, never by a device clock.
        const locked = await tx.$queryRaw<Array<{ lastSeq: bigint }>>`
          SELECT "lastSeq" FROM "thread" WHERE id = ${input.threadId}::uuid FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new CommError(CommErrorCode.THREAD_NOT_FOUND, 'thread not found', 404);
        }
        const seq = locked[0].lastSeq + BigInt(1);

        const message = await tx.message.create({
          data: {
            threadId: input.threadId,
            caseId: input.caseId ?? null,
            authorType,
            authorId: actor.kind === 'SYSTEM' ? null : actor.userId,
            onBehalfMode: decision.onBehalfMode,
            type,
            body: input.body ?? null,
            visibility,
            moderation: ModerationStatus.PUBLISHED,
            origin: input.origin ?? MessageOrigin.USER,
            seq,
            replyToMessageId: input.replyToMessageId ?? null,
            clientMessageId: input.clientMessageId ?? null,
            attachments: input.attachments?.length
              ? {
                  create: input.attachments.map((a) => ({
                    kind: a.kind,
                    objectKey: a.objectKey,
                    mimeType: a.mimeType,
                    byteSize: a.byteSize,
                    checksumSha256: a.checksumSha256 ?? null,
                    originalName: a.originalName ?? null,
                    durationMs: a.durationMs ?? null,
                    width: a.width ?? null,
                    height: a.height ?? null,
                    thumbnailObjectKey: a.thumbnailObjectKey ?? null,
                  })),
                }
              : undefined,
          },
          include: { attachments: true, reactions: true, receipts: true },
        });

        const isCustomerFacing = visibility === MessageVisibility.CUSTOMER;
        const threadPatch: Prisma.ThreadUpdateInput = {
          lastSeq: seq,
          lastActivityAt: now,
        };

        if (isCustomerFacing) {
          if (authorType === AuthorType.CONTACT) {
            threadPatch.lastCustomerMessageAt = now;
            // A customer message reopens a resolved conversation.
            threadPatch.resolvedAt = null;
          } else if (authorType === AuthorType.STAFF) {
            threadPatch.lastStaffMessageAt = now;
            threadPatch.lastStaff = { connect: { id: actor.userId } };
            // Stickiness: the staff member who just replied keeps the thread for
            // the configured grace window (brief section 4).
            threadPatch.stickyHandler = { connect: { id: actor.userId } };
            threadPatch.stickyUntil = new Date(now.getTime() + stickyMinutes * 60_000);
          }
        }

        const updatedThread = await tx.thread.update({
          where: { id: input.threadId },
          data: threadPatch,
        });

        // Per-recipient delivery rows. Internal notes are never delivered to
        // customer contacts.
        const recipients = audience.filter(
          (a) =>
            a.userId !== actor.userId &&
            (isCustomerFacing || a.kind === 'STAFF'),
        );
        if (recipients.length > 0) {
          await tx.messageReceipt.createMany({
            data: recipients.map((r) => ({
              messageId: message.id,
              userId: r.userId,
              state: ReceiptState.SENT,
            })),
            skipDuplicates: true,
          });
        }

        await this.outbox.enqueue(tx, CommEvent.MESSAGE_CREATED, {
          threadId: message.threadId,
          messageId: message.id,
          seq: message.seq.toString(),
          authorType: message.authorType,
          authorId: message.authorId,
          type: message.type,
          visibility: message.visibility,
          createdAt: message.createdAt.toISOString(),
        });

        await this.outbox.enqueue(tx, CommEvent.THREAD_UPDATED, {
          threadId: updatedThread.id,
          familyId: updatedThread.familyId,
          needsReply: needsReply(updatedThread),
          state: conversationState(updatedThread),
          lastActivityAt: updatedThread.lastActivityAt.toISOString(),
          handlerId: updatedThread.stickyHandlerId,
        });

        await this.audit.event(tx, {
          familyId: thread.familyId,
          actorType: authorType,
          actorId: actor.kind === 'SYSTEM' ? null : actor.userId,
          type: 'message.sent',
          // Deliberately no body: message contents are not written to the event log.
          payload: { threadId: thread.id, messageId: message.id, type, visibility },
        });

        // "Reply as assist" and escalation are sensitive: audited with a reason.
        if (
          decision.onBehalfMode === OnBehalfMode.ASSIST ||
          decision.onBehalfMode === OnBehalfMode.ESCALATION
        ) {
          await this.audit.audit(tx, {
            actorId: actor.userId,
            action: `message.${decision.onBehalfMode.toLowerCase()}`,
            entity: 'thread',
            entityId: thread.id,
            after: { messageId: message.id },
            reason: `staff replied with on_behalf_mode=${decision.onBehalfMode}`,
          });
        }

        return message;
      });

      return toMessageDto(created);
    } catch (e) {
      // Concurrent duplicate submission of the same client_message_id.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        input.clientMessageId
      ) {
        const existing = await this.findByClientMessageId(
          input.threadId,
          actor.userId,
          input.clientMessageId,
        );
        if (existing) return existing;
      }
      throw e;
    }
  }

  private async findByClientMessageId(
    threadId: string,
    authorId: string,
    clientMessageId: string,
  ): Promise<MessageDto | null> {
    const found = await this.prisma.message.findFirst({
      where: { threadId, authorId, clientMessageId },
      include: { attachments: true, reactions: true, receipts: true },
    });
    return found ? toMessageDto(found) : null;
  }

  private validateContent(type: MessageType, input: SendMessageInput): void {
    const hasBody = typeof input.body === 'string' && input.body.trim().length > 0;
    const hasAttachments = (input.attachments?.length ?? 0) > 0;
    if (type === MessageType.TEXT && !hasBody) {
      throw new CommError(CommErrorCode.EMPTY_MESSAGE, 'text message requires a body', 400);
    }
    if (type !== MessageType.TEXT && type !== MessageType.SYSTEM && !hasAttachments) {
      throw new CommError(
        CommErrorCode.EMPTY_MESSAGE,
        `${type} message requires at least one attachment`,
        400,
      );
    }
  }

  /** A reply may only target a message in the same thread. */
  private async validateReplyTarget(threadId: string, replyToMessageId: string | null) {
    if (!replyToMessageId) return;
    const target = await this.prisma.message.findUnique({
      where: { id: replyToMessageId },
      select: { threadId: true, deletedForAll: true },
    });
    if (!target) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'reply target not found', 404);
    }
    if (target.threadId !== threadId) {
      throw new CommError(
        CommErrorCode.REPLY_TARGET_CROSS_THREAD,
        'cannot reply to a message in another thread',
      );
    }
  }

  // -------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------

  async list(input: ListMessagesInput): Promise<{ messages: MessageDto[]; nextBefore: string | null }> {
    const actor = await this.threads.requireActor(input.userId);
    const thread = await this.prisma.thread.findUnique({ where: { id: input.threadId } });
    if (!thread) throw new CommError(CommErrorCode.THREAD_NOT_FOUND, 'thread not found', 404);

    const decision = this.authz.canReadThread(actor, thread);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const maxLimit = await this.config.get('communication.page_size_max');
    const defaultLimit = await this.config.get('communication.page_size_default');
    const limit = Math.min(input.limit ?? defaultLimit, maxLimit);

    const where = this.visibilityFilter(actor, input);

    const ascending = input.after !== undefined;
    const rows = await this.prisma.message.findMany({
      where,
      include: { attachments: true, reactions: true, receipts: true },
      orderBy: { seq: ascending ? 'asc' : 'desc' },
      take: limit,
    });

    const messages = rows.map((m) => toMessageDto(m));
    const nextBefore =
      !ascending && rows.length === limit ? rows[rows.length - 1].seq.toString() : null;

    return { messages, nextBefore };
  }

  /**
   * The single place that decides which messages an actor may see.
   * - contacts never see INTERNAL notes
   * - nobody sees another user's "deleted for me" messages
   * - non-PUBLISHED messages are visible only to their author
   */
  private visibilityFilter(actor: Actor, input: ListMessagesInput): Prisma.MessageWhereInput {
    const where: Prisma.MessageWhereInput = { threadId: input.threadId };

    if (input.before) where.seq = { lt: BigInt(input.before) };
    if (input.after) where.seq = { gt: BigInt(input.after) };

    if (!this.authz.canReadInternal(actor)) {
      where.visibility = MessageVisibility.CUSTOMER;
    }

    where.hiddenFor = { none: { userId: actor.userId } };

    where.OR = [
      { moderation: ModerationStatus.PUBLISHED },
      { authorId: actor.userId },
    ];

    return where;
  }

  // -------------------------------------------------------------------
  // Receipts
  // -------------------------------------------------------------------

  /**
   * Monotonic receipt transition. SENT -> DELIVERED -> READ only; a late
   * DELIVERED can never downgrade a READ, which makes reconnect replay safe.
   */
  async markState(
    messageIds: string[],
    userId: string,
    state: ReceiptState,
  ): Promise<number> {
    if (messageIds.length === 0) return 0;
    const rank: Record<ReceiptState, number> = {
      [ReceiptState.SENT]: 0,
      [ReceiptState.DELIVERED]: 1,
      [ReceiptState.READ]: 2,
    };
    const now = new Date();
    const lower = (Object.keys(rank) as ReceiptState[]).filter((s) => rank[s] < rank[state]);

    const result = await this.prisma.messageReceipt.updateMany({
      where: { messageId: { in: messageIds }, userId, state: { in: lower } },
      data: {
        state,
        ...(state === ReceiptState.DELIVERED ? { deliveredAt: now } : {}),
        ...(state === ReceiptState.READ ? { readAt: now, deliveredAt: now } : {}),
      },
    });
    return result.count;
  }

  /** Advance the read cursor; used for unread reconciliation after reconnect. */
  async markReadUpTo(threadId: string, userId: string, seq: string): Promise<void> {
    const actor = await this.threads.requireActor(userId);
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread) throw new CommError(CommErrorCode.THREAD_NOT_FOUND, 'thread not found', 404);
    const decision = this.authz.canReadThread(actor, thread);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const target = BigInt(seq);
    const ids = await this.prisma.message.findMany({
      where: { threadId, seq: { lte: target } },
      select: { id: true },
    });
    await this.markState(ids.map((m) => m.id), userId, ReceiptState.READ);

    await this.prisma.threadParticipantState.upsert({
      where: { threadId_userId: { threadId, userId } },
      create: { threadId, userId, lastReadSeq: target },
      update: {
        lastReadSeq: target,
      },
    });
  }

  async unreadCount(threadId: string, userId: string): Promise<number> {
    return this.prisma.messageReceipt.count({
      where: {
        userId,
        state: { in: [ReceiptState.SENT, ReceiptState.DELIVERED] },
        message: { threadId },
      },
    });
  }

  // -------------------------------------------------------------------
  // Reactions
  // -------------------------------------------------------------------

  async react(messageId: string, userId: string, emoji: string): Promise<void> {
    const { actor, message } = await this.loadForActor(messageId, userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.messageReaction.upsert({
        where: { messageId_userId: { messageId, userId: actor.userId } },
        create: { messageId, userId: actor.userId, emoji },
        update: { emoji },
      });
      await this.outbox.enqueue(tx, CommEvent.REACTION_ADDED, {
        threadId: message.threadId,
        messageId,
        userId: actor.userId,
        emoji,
      });
    });
  }

  async unreact(messageId: string, userId: string): Promise<void> {
    const { actor, message } = await this.loadForActor(messageId, userId);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.messageReaction.findUnique({
        where: { messageId_userId: { messageId, userId: actor.userId } },
      });
      if (!existing) return;
      await tx.messageReaction.delete({
        where: { messageId_userId: { messageId, userId: actor.userId } },
      });
      await this.outbox.enqueue(tx, CommEvent.REACTION_REMOVED, {
        threadId: message.threadId,
        messageId,
        userId: actor.userId,
        emoji: existing.emoji,
      });
    });
  }

  // -------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------

  /**
   * Delete for me: per-user hiding, always allowed for a message you can see.
   * Delete for everyone: author within the configured window, or a manager.
   * Rows are never hard-deleted - operational history stays auditable.
   */
  async deleteForMe(messageId: string, userId: string): Promise<void> {
    const { actor, message } = await this.loadForActor(messageId, userId);
    await this.prisma.messageHiddenFor.upsert({
      where: { messageId_userId: { messageId, userId: actor.userId } },
      create: { messageId, userId: actor.userId },
      update: {},
    });
    void message;
  }

  async deleteForEveryone(messageId: string, userId: string, reason: string): Promise<void> {
    const { actor, message } = await this.loadForActor(messageId, userId);
    const windowMinutes = await this.config.get(
      'communication.delete_for_everyone_window_minutes',
    );
    const isManager = actor.kind === 'STAFF' && actor.staffRole === 'MANAGER';
    const isAuthor = message.authorId === actor.userId;

    if (!isAuthor && !isManager) {
      throw new CommError(CommErrorCode.NOT_MESSAGE_AUTHOR, 'not the author of this message');
    }
    if (isAuthor && !isManager) {
      const ageMs = Date.now() - message.createdAt.getTime();
      if (ageMs > windowMinutes * 60_000) {
        throw new CommError(
          CommErrorCode.DELETE_WINDOW_EXPIRED,
          `delete-for-everyone window of ${windowMinutes} minutes has expired`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: messageId },
        data: {
          deletedAt: new Date(),
          deletedBy: actor.userId,
          deletedForAll: true,
          redactedReason: reason,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.userId,
        action: 'message.delete_for_everyone',
        entity: 'message',
        entityId: messageId,
        reason,
      });
      await this.outbox.enqueue(tx, CommEvent.MESSAGE_DELETED, {
        threadId: message.threadId,
        messageId,
        deletedForAll: true,
      });
    });
  }

  private async loadForActor(messageId: string, userId: string) {
    const actor = await this.threads.requireActor(userId);
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    const thread = await this.prisma.thread.findUnique({ where: { id: message.threadId } });
    if (!thread) throw new CommError(CommErrorCode.THREAD_NOT_FOUND, 'thread not found', 404);

    const decision = this.authz.canReadThread(actor, thread);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    if (message.visibility === MessageVisibility.INTERNAL && !this.authz.canReadInternal(actor)) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    }
    return { actor, message, thread: thread as Thread };
  }
}
