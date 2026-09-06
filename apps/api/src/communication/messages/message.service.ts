import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import { Actor } from '../../platform/types';
import { ConversationService } from '../conversations/conversation.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import { MessageDto, toMessageDto, needsReply, conversationState } from '../contracts/dto';
import {
  ActorKind,
  ApprovalDecision,
  MessageType,
  Moderation,
  OnBehalfMode,
  Origin,
  RECEIPT_RANK,
  ReceiptState,
  Visibility,
} from '../contracts/vocab';

export interface AttachmentInput {
  kind: string;
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
  conversationId: string;
  senderId: string;
  type?: string;
  body?: string | null;
  visibility?: string;
  origin?: string;
  /** Client-generated idempotency key. Strongly recommended on mobile. */
  clientMessageId?: string | null;
  replyToMessageId?: string | null;
  caseId?: string | null;
  attachments?: AttachmentInput[];
  /** Only assist / escalation are honoured; owner vs coverage is derived. */
  requestedMode?: string;
}

export interface ListMessagesInput {
  conversationId: string;
  actorId: string;
  before?: string;
  after?: string;
  limit?: number;
}

@Injectable()
export class MessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------
  // Send
  // -------------------------------------------------------------------

  async send(input: SendMessageInput): Promise<MessageDto> {
    const now = new Date();
    const actor = await this.conversations.requireActor(input.senderId);
    const conv = await this.conversations.requireConversation(input.conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);

    // Idempotency fast path. The unique index is the real guarantee; this only
    // avoids repeating the work in the common retry case.
    if (input.clientMessageId) {
      const existing = await this.findByClientMessageId(
        conv.id,
        actor.actorId,
        input.clientMessageId,
      );
      if (existing) return existing;
    }

    const visibility = input.visibility ?? Visibility.CUSTOMER;
    const type = input.type ?? MessageType.TEXT;

    const decision = await this.authz.canSend(
      actor,
      conv,
      membership,
      { visibility, requestedMode: input.requestedMode },
      now,
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    this.validateContent(type, input);
    await this.validateReplyTarget(conv.id, input.replyToMessageId ?? null);

    const moderation = decision.moderation;
    const isPending = moderation === Moderation.PENDING;
    const stickyMinutes = await this.config.get('handoff.grace_minutes');
    const activeHandler = await this.conversations.activeHandler(conv, now);

    // Recipients: live members other than the author. Internal notes never
    // reach a contact or a teacher.
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId: conv.id, leftAt: null },
    });
    const recipients = members.filter(
      (m) =>
        m.actorId !== actor.actorId &&
        (visibility === Visibility.CUSTOMER || m.actorKind === ActorKind.STAFF),
    );

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Serialize sequence assignment. Ordering is decided by the server,
        // never by a device clock.
        const locked = await tx.$queryRaw<Array<{ last_seq: bigint }>>`
          SELECT last_seq FROM chat.conversation WHERE id = ${conv.id}::uuid FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found', 404);
        }
        const seq = locked[0].last_seq + BigInt(1);

        const message = await tx.message.create({
          data: {
            conversationId: conv.id,
            threadId: conv.threadId,
            caseId: input.caseId ?? null,
            authorType: actor.kind,
            authorId: actor.kind === ActorKind.SYSTEM ? null : actor.actorId,
            onBehalfMode: decision.onBehalfMode,
            type,
            body: input.body ?? null,
            visibility,
            moderation,
            origin: input.origin ?? Origin.USER,
            seq,
            replyToMessageId: input.replyToMessageId ?? null,
            clientMessageId: input.clientMessageId ?? null,
            attachmentsJson: [],
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

        // Advance the conversation. A pending message must not make the
        // conversation look answered, so only published messages move the
        // customer/staff clocks.
        const patch: Prisma.ConversationUpdateInput = {
          lastSeq: seq,
          lastActivityAt: now,
        };
        if (!isPending && visibility === Visibility.CUSTOMER) {
          if (actor.kind === ActorKind.CONTACT) {
            patch.lastCustomerMessageAt = now;
            // A customer message reopens a resolved conversation.
            patch.resolvedAt = null;
          } else if (actor.kind === ActorKind.STAFF) {
            patch.lastStaffMessageAt = now;
            // Stickiness: whoever just replied keeps it for the grace window.
            patch.stickyHandler = { connect: { id: actor.actorId } };
            patch.stickyUntil = new Date(now.getTime() + stickyMinutes * 60_000);
          }
        }
        const updated = await tx.conversation.update({ where: { id: conv.id }, data: patch });

        if (isPending) {
          // Held for approval. No receipts are created and no message.created
          // event is broadcast, so the message cannot leak to the group.
          const approval = await tx.messageApproval.create({
            data: {
              messageId: message.id,
              conversationId: conv.id,
              requestedBy: actor.actorId,
              approverId: activeHandler,
              decision: ApprovalDecision.PENDING,
            },
          });
          await this.outbox.enqueue(tx, CommEvent.APPROVAL_REQUESTED, {
            conversationId: conv.id,
            messageId: message.id,
            approvalId: approval.id,
            requestedBy: actor.actorId,
          });
        } else {
          if (recipients.length > 0) {
            await tx.messageReceipt.createMany({
              data: recipients.map((r) => ({
                messageId: message.id,
                actorId: r.actorId,
                state: ReceiptState.SENT,
              })),
              skipDuplicates: true,
            });
          }
          await this.outbox.enqueue(tx, CommEvent.MESSAGE_CREATED, {
            conversationId: conv.id,
            messageId: message.id,
            seq: seq.toString(),
            authorKind: message.authorType,
            authorId: message.authorId,
            type: message.type,
            visibility: message.visibility,
            moderation: message.moderation,
            createdAt: message.createdAt.toISOString(),
          });
        }

        await this.outbox.enqueue(tx, CommEvent.CONVERSATION_UPDATED, {
          conversationId: updated.id,
          familyId: updated.familyId,
          state: conversationState(updated),
          needsReply: needsReply(updated),
          lastActivityAt: updated.lastActivityAt.toISOString(),
          handlerId: activeHandler,
        });

        await this.audit.event(tx, {
          familyId: conv.familyId,
          actorKind: actor.kind,
          actorId: actor.kind === ActorKind.SYSTEM ? null : actor.actorId,
          type: 'message.sent',
          // Deliberately no body: message contents never enter the event log.
          payload: { conversationId: conv.id, messageId: message.id, type, visibility, moderation },
        });

        if (
          decision.onBehalfMode === OnBehalfMode.ASSIST ||
          decision.onBehalfMode === OnBehalfMode.ESCALATION
        ) {
          await this.audit.audit(tx, {
            actorId: actor.actorId,
            action: `message.${decision.onBehalfMode}`,
            entity: 'conversation',
            entityId: conv.id,
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
          conv.id,
          actor.actorId,
          input.clientMessageId,
        );
        if (existing) return existing;
      }
      throw e;
    }
  }

  private async findByClientMessageId(
    conversationId: string,
    authorId: string,
    clientMessageId: string,
  ): Promise<MessageDto | null> {
    const found = await this.prisma.message.findFirst({
      where: { conversationId, authorId, clientMessageId },
      include: { attachments: true, reactions: true, receipts: true },
    });
    return found ? toMessageDto(found) : null;
  }

  private validateContent(type: string, input: SendMessageInput): void {
    const hasBody = typeof input.body === 'string' && input.body.trim().length > 0;
    const hasAttachments = (input.attachments?.length ?? 0) > 0;
    if (type === MessageType.TEXT && !hasBody) {
      throw new CommError(CommErrorCode.EMPTY_MESSAGE, 'a text message requires a body', 400);
    }
    if (type !== MessageType.TEXT && type !== MessageType.SYSTEM && !hasAttachments) {
      throw new CommError(
        CommErrorCode.EMPTY_MESSAGE,
        `a ${type} message requires at least one attachment`,
        400,
      );
    }
  }

  /** A reply may only target a message in the same conversation. */
  private async validateReplyTarget(conversationId: string, replyToMessageId: string | null) {
    if (!replyToMessageId) return;
    const target = await this.prisma.message.findUnique({
      where: { id: replyToMessageId },
      select: { conversationId: true },
    });
    if (!target) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'reply target not found', 404);
    }
    if (target.conversationId !== conversationId) {
      throw new CommError(
        CommErrorCode.REPLY_TARGET_CROSS_CONVERSATION,
        'cannot reply to a message in another conversation',
      );
    }
  }

  // -------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------

  async list(
    input: ListMessagesInput,
  ): Promise<{ messages: MessageDto[]; nextBefore: string | null }> {
    const actor = await this.conversations.requireActor(input.actorId);
    const conv = await this.conversations.requireConversation(input.conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);

    const decision = this.authz.canRead(actor, conv, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const maxLimit = await this.config.get('communication.page_size_max');
    const defaultLimit = await this.config.get('communication.page_size_default');
    const limit = Math.min(input.limit ?? defaultLimit, maxLimit);

    const ascending = input.after !== undefined;
    const rows = await this.prisma.message.findMany({
      where: this.visibilityFilter(actor, conv.id, input),
      include: { attachments: true, reactions: true, receipts: true },
      orderBy: { seq: ascending ? 'asc' : 'desc' },
      take: limit,
    });

    const messages = rows.map((m) => toMessageDto(m));
    const nextBefore =
      !ascending && rows.length === limit ? (rows[rows.length - 1].seq?.toString() ?? null) : null;

    return { messages, nextBefore };
  }

  /**
   * The single place that decides which messages an actor may see.
   *
   * - contacts and teachers never see INTERNAL notes
   * - nobody sees another user's "deleted for me" messages
   * - a PENDING message is visible only to its author and to family-facing
   *   staff; it is never visible to the rest of the group
   * - a REJECTED message is visible only to its author
   */
  private visibilityFilter(
    actor: Actor,
    conversationId: string,
    input: ListMessagesInput,
  ): Prisma.MessageWhereInput {
    const where: Prisma.MessageWhereInput = { conversationId };

    if (input.before) where.seq = { lt: BigInt(input.before) };
    if (input.after) where.seq = { gt: BigInt(input.after) };

    if (!this.authz.canReadInternal(actor)) {
      where.visibility = Visibility.CUSTOMER;
    }

    where.hiddenFor = { none: { actorId: actor.actorId } };

    where.OR = this.authz.canReadInternal(actor)
      ? [
          { moderation: Moderation.PUBLISHED },
          { moderation: Moderation.PENDING },
          { authorId: actor.actorId },
        ]
      : [{ moderation: Moderation.PUBLISHED }, { authorId: actor.actorId }];

    return where;
  }

  // -------------------------------------------------------------------
  // Receipts
  // -------------------------------------------------------------------

  /**
   * Monotonic receipt transition. A replayed DELIVERED after a reconnect can
   * never downgrade a READ, which is what makes offline replay safe.
   */
  async markState(messageIds: string[], actorId: string, state: string): Promise<number> {
    if (messageIds.length === 0) return 0;
    const target = RECEIPT_RANK[state];
    const lower = Object.keys(RECEIPT_RANK).filter((s) => RECEIPT_RANK[s] < target);
    const now = new Date();

    const result = await this.prisma.messageReceipt.updateMany({
      where: { messageId: { in: messageIds }, actorId, state: { in: lower } },
      data: {
        state,
        ...(state === ReceiptState.DELIVERED ? { deliveredAt: now } : {}),
        ...(state === ReceiptState.READ ? { readAt: now, deliveredAt: now } : {}),
      },
    });
    return result.count;
  }

  /** Advance the read cursor; used for unread reconciliation after reconnect. */
  async markReadUpTo(conversationId: string, actorId: string, seq: string): Promise<void> {
    const actor = await this.conversations.requireActor(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const decision = this.authz.canRead(actor, conv, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const target = BigInt(seq);
    const ids = await this.prisma.message.findMany({
      where: { conversationId, seq: { lte: target } },
      select: { id: true },
    });
    await this.markState(ids.map((m) => m.id), actor.actorId, ReceiptState.READ);

    await this.prisma.conversationParticipantState.upsert({
      where: { conversationId_actorId: { conversationId, actorId: actor.actorId } },
      create: { conversationId, actorId: actor.actorId, lastReadSeq: target },
      update: { lastReadSeq: target },
    });
  }

  async unreadCount(conversationId: string, actorId: string): Promise<number> {
    return this.prisma.messageReceipt.count({
      where: {
        actorId,
        state: { in: [ReceiptState.SENT, ReceiptState.DELIVERED] },
        message: { conversationId },
      },
    });
  }

  // -------------------------------------------------------------------
  // Reactions
  // -------------------------------------------------------------------

  async react(messageId: string, actorId: string, emoji: string): Promise<void> {
    const { actor, message } = await this.loadForActor(messageId, actorId);
    await this.prisma.$transaction(async (tx) => {
      await tx.messageReaction.upsert({
        where: { messageId_actorId: { messageId, actorId: actor.actorId } },
        create: { messageId, actorId: actor.actorId, emoji },
        update: { emoji },
      });
      await this.outbox.enqueue(tx, CommEvent.REACTION_ADDED, {
        conversationId: message.conversationId!,
        messageId,
        actorId: actor.actorId,
        emoji,
      });
    });
  }

  async unreact(messageId: string, actorId: string): Promise<void> {
    const { actor, message } = await this.loadForActor(messageId, actorId);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.messageReaction.findUnique({
        where: { messageId_actorId: { messageId, actorId: actor.actorId } },
      });
      if (!existing) return;
      await tx.messageReaction.delete({
        where: { messageId_actorId: { messageId, actorId: actor.actorId } },
      });
      await this.outbox.enqueue(tx, CommEvent.REACTION_REMOVED, {
        conversationId: message.conversationId!,
        messageId,
        actorId: actor.actorId,
        emoji: existing.emoji,
      });
    });
  }

  // -------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------

  /** Per-user hiding. Never affects another participant's copy. */
  async deleteForMe(messageId: string, actorId: string): Promise<void> {
    const { actor } = await this.loadForActor(messageId, actorId);
    await this.prisma.messageHiddenFor.upsert({
      where: { messageId_actorId: { messageId, actorId: actor.actorId } },
      create: { messageId, actorId: actor.actorId },
      update: {},
    });
  }

  /**
   * Author within the configured window, or a manager at any time. The row is
   * never hard-deleted, so operational history stays auditable.
   */
  async deleteForEveryone(messageId: string, actorId: string, reason: string): Promise<void> {
    const { actor, message } = await this.loadForActor(messageId, actorId);
    const windowMinutes = await this.config.get(
      'communication.delete_for_everyone_window_minutes',
    );
    const isManager = actor.kind === ActorKind.STAFF && actor.staffRole === 'manager';
    const isAuthor = message.authorId === actor.actorId;

    if (!isAuthor && !isManager) {
      throw new CommError(CommErrorCode.NOT_MESSAGE_AUTHOR, 'not the author of this message');
    }
    if (isAuthor && !isManager) {
      const ageMs = Date.now() - message.createdAt.getTime();
      if (ageMs > windowMinutes * 60_000) {
        throw new CommError(
          CommErrorCode.DELETE_WINDOW_EXPIRED,
          `the delete-for-everyone window of ${windowMinutes} minutes has expired`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: messageId },
        data: {
          deletedAt: new Date(),
          deletedBy: actor.actorId,
          deletedForAll: true,
          redactedReason: reason,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'message.delete_for_everyone',
        entity: 'message',
        entityId: messageId,
        reason,
      });
      await this.outbox.enqueue(tx, CommEvent.MESSAGE_DELETED, {
        conversationId: message.conversationId!,
        messageId,
        deletedForAll: true,
      });
    });
  }

  private async loadForActor(messageId: string, actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || !message.conversationId) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    }
    const conv = await this.conversations.requireConversation(message.conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);

    const decision = this.authz.canRead(actor, conv, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    // A message the actor may not see must look absent, not forbidden.
    if (message.visibility === Visibility.INTERNAL && !this.authz.canReadInternal(actor)) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    }
    if (
      message.moderation === Moderation.PENDING &&
      message.authorId !== actor.actorId &&
      !this.authz.canReadInternal(actor)
    ) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    }

    return { actor, message, conv };
  }
}
