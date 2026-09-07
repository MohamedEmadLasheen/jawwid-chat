import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { AppConfigService } from '../../platform/app-config.service';
import { Permission } from '../../platform/rbac/permissions';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import { Actor, isFamilyFacingStaff } from '../../platform/types';
import { ConversationService } from '../conversations/conversation.service';
import { AttachmentService } from '../attachments/attachment.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import {
  MessageDto,
  type MessageViewer,
  type ReplyPreviewDto,
  toMessageDto,
  needsReply,
  conversationState,
  excerptOf,
  unavailableReply,
} from '../contracts/dto';
import {
  ActorKind,
  ALLOWED_REACTIONS,
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
  attachments?: AttachmentInput[];
  /** Only assist / escalation are honoured; owner vs coverage is derived. */
  requestedMode?: string;
  /**
   * Forwarding provenance. INTERNAL: set by forward() after it has authorized
   * the source, and never mapped from a request body -- MessageController
   * enumerates the fields it forwards, so a client cannot claim a provenance it
   * did not earn.
   */
  forwardedFrom?: { messageId: string; conversationId: string };
}

export interface ListMessagesInput {
  conversationId: string;
  actorId: string;
  before?: string;
  after?: string;
  limit?: number;
}

export interface EditMessageInput {
  messageId: string;
  actorId: string;
  body: string;
  /** From the route path. A mismatch is reported as NOT FOUND. */
  conversationId?: string;
}

export interface ForwardMessageInput {
  messageId: string;
  actorId: string;
  /** The SOURCE conversation, from the route path. */
  conversationId?: string;
  /** Destination conversations. Each is authorized independently. */
  toConversationIds: string[];
  /** One per destination, so a retried forward is not a second copy. */
  clientMessageIds?: Record<string, string>;
}

export interface SearchMessagesInput {
  actorId: string;
  query: string;
  /** Restrict to one conversation. Authorized like any other read of it. */
  conversationId?: string;
  /** Restrict to one author. */
  authorId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  /** Opaque cursor from a previous page: the last row's created_at + id. */
  cursor?: string;
}

export interface MessageSearchHit {
  message: MessageDto;
  conversationId: string;
  conversationType: string;
  conversationTitle: string | null;
}

@Injectable()
export class MessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    private readonly attachments: AttachmentService,
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
    // A client may never author a SYSTEM message or claim a non-user origin:
    // those are how the backend speaks, and impersonating them would let a user
    // post something that reads as coming from Jawwid itself.
    const requestedType = input.type ?? MessageType.TEXT;
    const type =
      actor.kind === ActorKind.SYSTEM
        ? requestedType
        : requestedType === MessageType.SYSTEM
          ? MessageType.TEXT
          : requestedType;
    const origin =
      actor.kind === ActorKind.SYSTEM ? (input.origin ?? Origin.AUTOMATION) : Origin.USER;

    // Size and MIME limits are enforced here, on the path every caller takes,
    // not only on the upload-authorization endpoint.
    for (const a of input.attachments ?? []) {
      this.attachments.validate(a.kind, a.mimeType, a.byteSize);
    }

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
      { visibility, requestedMode: input.requestedMode },
      now,
      family?.ownerId ?? null,
      members.map((m) => m.actorKind),
      // C-4: admin presence is evaluated at post time, not only as committed
      // membership state.
      await this.conversations.liveMembersOf(conv.id),
      await this.conversations.scopeFor(actor, conv, now),
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const body = await this.normalizeBody(type, input.body ?? null, input.attachments?.length ?? 0);
    await this.validateReplyTarget(actor, conv.id, input.replyToMessageId ?? null);

    const moderation = decision.moderation;
    const isPending = moderation === Moderation.PENDING;
    const stickyMinutes = await this.config.get('handoff.grace_minutes');
    const activeHandler = await this.conversations.activeHandler(conv, now);

    // Recipients: live members other than the author. Internal notes never
    // reach a contact or a teacher.
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
            authorType: actor.kind,
            authorId: actor.kind === ActorKind.SYSTEM ? null : actor.actorId,
            onBehalfMode: decision.onBehalfMode,
            type,
            body,
            visibility,
            moderation,
            origin,
            seq,
            replyToMessageId: input.replyToMessageId ?? null,
            clientMessageId: input.clientMessageId ?? null,
            forwardedFromMessageId: input.forwardedFrom?.messageId ?? null,
            forwardedFromConversationId: input.forwardedFrom?.conversationId ?? null,
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
          type: 'message_sent',
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

      return toMessageDto(created, undefined, this.viewerOf(actor));
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
          this.viewerOf(actor),
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
    viewer?: MessageViewer,
  ): Promise<MessageDto | null> {
    const found = await this.prisma.message.findFirst({
      where: { conversationId, authorId, clientMessageId },
      include: { attachments: true, reactions: true, receipts: true },
    });
    return found ? toMessageDto(found, undefined, viewer) : null;
  }

  /**
   * Who is being served a message, for the receipt roster (RT-012 / A-7).
   *
   * Only family-facing staff see who else read a message and when. Everybody
   * else sees their own receipt and nothing more.
   */
  private viewerOf(actor: Actor): MessageViewer {
    return { actorId: actor.actorId, seesFullRoster: isFamilyFacingStaff(actor) };
  }

  /**
   * Validate and normalize a body. Returns what will actually be stored.
   *
   * Normalization is deliberately conservative: surrounding whitespace is
   * trimmed, and nothing else is touched. Collapsing runs of spaces or newlines
   * would rewrite what the sender wrote -- and in Arabic, "harmless" whitespace
   * fiddling can change how a line renders. Trimming the ends is enough to stop
   * a space-only message; the rest is the sender's.
   */
  private async normalizeBody(
    type: string,
    raw: string | null,
    attachmentCount: number,
  ): Promise<string | null> {
    const body = raw === null ? null : raw.trim();
    const hasBody = body !== null && body.length > 0;

    if (type === MessageType.TEXT && !hasBody) {
      throw new CommError(CommErrorCode.EMPTY_MESSAGE, 'a text message requires a body', 400);
    }
    if (type !== MessageType.TEXT && type !== MessageType.SYSTEM && attachmentCount === 0) {
      throw new CommError(
        CommErrorCode.EMPTY_MESSAGE,
        `a ${type} message requires at least one attachment`,
        400,
      );
    }

    if (hasBody) {
      // Counted in code points, not UTF-16 units: an emoji is one character to
      // the person who typed it, and `String.length` would call it two.
      const maxLength = await this.config.get('communication.message_max_length');
      const length = [...body].length;
      if (length > maxLength) {
        throw new CommError(
          CommErrorCode.MESSAGE_TOO_LONG,
          `a message may be at most ${maxLength} characters; this one is ${length}`,
          400,
        );
      }
    }

    return hasBody ? body : null;
  }

  /**
   * A reply may only target a message THIS ACTOR CAN SEE, in the SAME
   * conversation.
   *
   * Both halves matter. Same-conversation stops a reply being used to pull a
   * quote across a conversation boundary. Visibility stops the subtler version
   * of the same attack inside one conversation: a contact who learns the id of
   * an internal note could otherwise reply to it and have the engine render the
   * note's text as a quote above their own message. The target is reported as
   * NOT FOUND in both cases, so neither is an existence oracle.
   */
  private async validateReplyTarget(
    actor: Actor,
    conversationId: string,
    replyToMessageId: string | null,
  ): Promise<void> {
    if (!replyToMessageId) return;
    const target = await this.prisma.message.findUnique({
      where: { id: replyToMessageId },
      select: { conversationId: true, visibility: true, moderation: true, authorId: true },
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
    if (!this.maySeeMessage(actor, target)) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'reply target not found', 404);
    }
  }

  /**
   * The visibility rule, as a predicate over one already-loaded message.
   *
   * The same rule visibilityFilter() expresses as a WHERE clause. Two forms of
   * one rule is a drift risk, so this is the only other place it exists and
   * both are asserted against each other by the message-visibility tests.
   */
  private maySeeMessage(
    actor: Actor,
    m: Pick<{ visibility: string; moderation: string; authorId: string | null }, 'visibility' | 'moderation' | 'authorId'>,
  ): boolean {
    const internalOk = this.authz.canReadInternal(actor);
    if (m.visibility === Visibility.INTERNAL && !internalOk) return false;
    if (m.moderation === Moderation.PUBLISHED) return true;
    if (m.authorId !== null && m.authorId === actor.actorId) return true;
    // A pending message is visible to family-facing staff, who moderate it. A
    // rejected one is visible only to its author, handled above.
    return m.moderation === Moderation.PENDING && internalOk;
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

    const decision = this.authz.canRead(
      actor,
      conv,
      membership,
      await this.conversations.scopeFor(actor, conv),
    );
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

    // Signed URLs are minted per read, scoped to messages this actor is already
    // permitted to see, and they expire. The conversation id is passed so the
    // signer itself cannot mint a URL for an attachment outside the set this
    // read authorized (RT-006 / A-8).
    const signed = await this.attachments.signUrlsForMessages(
      rows.map((m) => m.id),
      conv.id,
    );
    // ONE extra query for the whole page, not one per reply. Loading the quoted
    // message inside the map would be an N+1 on exactly the pattern that
    // produces one (a run of replies in a busy thread).
    const previews = await this.replyPreviewsFor(actor, rows);
    const messages = rows.map((m) =>
      toMessageDto(
        m,
        signed,
        this.viewerOf(actor),
        m.replyToMessageId ? (previews.get(m.replyToMessageId) ?? null) : null,
      ),
    );
    const nextBefore =
      !ascending && rows.length === limit ? (rows[rows.length - 1].seq?.toString() ?? null) : null;

    return { messages, nextBefore };
  }

  /**
   * Resolve the quoted message for every reply on a page, in one query.
   *
   * A quote is content, so it is subject to every rule the message itself is.
   * A target that is deleted for everyone, hidden by this viewer, held for
   * approval, or an internal note this viewer may not read comes back as an
   * UNAVAILABLE preview rather than as text -- the reply still renders, and the
   * client says the quoted message is no longer available. That is the whole of
   * requirement "degrade gracefully without leaking restricted content".
   */
  private async replyPreviewsFor(
    actor: Actor,
    rows: Array<{ replyToMessageId: string | null }>,
  ): Promise<Map<string, ReplyPreviewDto>> {
    const wanted = [...new Set(rows.map((r) => r.replyToMessageId).filter((id): id is string => !!id))];
    const previews = new Map<string, ReplyPreviewDto>();
    if (wanted.length === 0) return previews;

    const targets = await this.prisma.message.findMany({
      where: { id: { in: wanted } },
      select: {
        id: true,
        authorType: true,
        authorId: true,
        type: true,
        body: true,
        visibility: true,
        moderation: true,
        deletedForAll: true,
        hiddenFor: { where: { actorId: actor.actorId }, select: { actorId: true } },
      },
    });
    const found = new Map(targets.map((t) => [t.id, t]));

    for (const id of wanted) {
      const t = found.get(id);
      if (!t) {
        previews.set(id, unavailableReply(id, 'missing'));
        continue;
      }
      if (t.deletedForAll) {
        previews.set(id, unavailableReply(id, 'deleted'));
        continue;
      }
      // Hidden for this viewer only. "restricted" rather than "deleted",
      // because for everyone else the message is still there.
      if (t.hiddenFor.length > 0 || !this.maySeeMessage(actor, t)) {
        previews.set(id, unavailableReply(id, 'restricted'));
        continue;
      }
      previews.set(id, {
        messageId: id,
        available: true,
        unavailableReason: null,
        authorKind: t.authorType,
        authorId: t.authorId,
        type: t.type,
        excerpt: excerptOf(t.body),
      });
    }
    return previews;
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
   *
   * The transition is also BROADCAST, which it was not before Phase 2: the
   * rows moved and nobody was told, so a sender's ticks only ever advanced when
   * they happened to refetch the page. The state change and the outbox row are
   * written in one transaction, so a committed receipt can never lose its
   * event.
   *
   * Only rows that ACTUALLY MOVED are announced. `updateMany` filters to states
   * strictly below the target, so a replayed acknowledgement updates nothing
   * and emits nothing -- the idempotency the realtime layer needs comes from
   * the same clause that makes the transition monotonic.
   */
  async markState(messageIds: string[], actorId: string, state: string): Promise<number> {
    if (messageIds.length === 0) return 0;
    const target = RECEIPT_RANK[state];
    if (target === undefined) {
      throw new CommError(CommErrorCode.EMPTY_MESSAGE, `unknown receipt state ${state}`, 400);
    }
    const lower = Object.keys(RECEIPT_RANK).filter((s) => RECEIPT_RANK[s] < target);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Read the rows that are about to move, so the events name exactly them.
      const moving = await tx.messageReceipt.findMany({
        where: { messageId: { in: messageIds }, actorId, state: { in: lower } },
        select: { messageId: true, message: { select: { conversationId: true } } },
      });
      if (moving.length === 0) return 0;

      const result = await tx.messageReceipt.updateMany({
        where: { messageId: { in: moving.map((r) => r.messageId) }, actorId, state: { in: lower } },
        data: {
          state,
          ...(state === ReceiptState.DELIVERED ? { deliveredAt: now } : {}),
          ...(state === ReceiptState.READ ? { readAt: now, deliveredAt: now } : {}),
        },
      });

      for (const row of moving) {
        if (!row.message.conversationId) continue;
        await this.outbox.enqueue(tx, CommEvent.MESSAGE_RECEIPT_UPDATED, {
          conversationId: row.message.conversationId,
          messageId: row.messageId,
          actorId,
          state,
          at: now.toISOString(),
        });
      }
      return result.count;
    });
  }

  /** Advance the read cursor; used for unread reconciliation after reconnect. */
  async markReadUpTo(conversationId: string, actorId: string, seq: string): Promise<void> {
    const actor = await this.conversations.requireActor(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const decision = this.authz.canRead(
      actor,
      conv,
      membership,
      await this.conversations.scopeFor(actor, conv),
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const target = BigInt(seq);
    // Only messages this actor actually has a receipt for -- which is to say,
    // messages addressed to them. Reading the whole conversation and letting
    // markState filter would work, but it walks the entire history on every
    // "I have read up to here" from a long-lived conversation.
    const receipts = await this.prisma.messageReceipt.findMany({
      where: {
        actorId: actor.actorId,
        state: { in: [ReceiptState.SENT, ReceiptState.DELIVERED] },
        message: { conversationId, seq: { lte: target } },
      },
      select: { messageId: true },
    });
    await this.markState(receipts.map((r) => r.messageId), actor.actorId, ReceiptState.READ);

    // The cursor is monotonic too. A client that reconnects and replays an old
    // "read up to 40" must not drag the divider back above messages the user
    // has since read.
    const existing = await this.prisma.conversationParticipantState.findUnique({
      where: { conversationId_actorId: { conversationId, actorId: actor.actorId } },
      select: { lastReadSeq: true },
    });
    const highest = existing && existing.lastReadSeq > target ? existing.lastReadSeq : target;

    await this.prisma.conversationParticipantState.upsert({
      where: { conversationId_actorId: { conversationId, actorId: actor.actorId } },
      create: { conversationId, actorId: actor.actorId, lastReadSeq: highest },
      update: { lastReadSeq: highest },
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

  /**
   * Add or replace this actor's reaction.
   *
   * One reaction per actor per message -- the unique index says so and the
   * upsert honours it, so reacting twice REPLACES rather than accumulating.
   * That is the intended product model, and it is also what makes "remove my
   * reaction" a single unambiguous operation.
   */
  async react(
    messageId: string,
    actorId: string,
    emoji: string,
    conversationId?: string,
  ): Promise<void> {
    if (!ALLOWED_REACTIONS.has(emoji)) {
      throw new CommError(
        CommErrorCode.REACTION_NOT_ALLOWED,
        'that reaction is not one of the supported ones',
        400,
      );
    }
    const { actor, message } = await this.loadForActor(messageId, actorId, conversationId);
    // Reacting is participating in the conversation, so it needs the same
    // permission speaking does -- otherwise somebody silenced with a DENY on
    // messages.send could still make themselves heard, one emoji at a time.
    if (!this.authz.hasPermission(actor, Permission.MESSAGES_SEND)) {
      throw new CommError(
        CommErrorCode.PERMISSION_DENIED,
        `this actor does not hold ${Permission.MESSAGES_SEND}`,
      );
    }
    // Nothing may be attached to a message that has been withdrawn.
    if (message.deletedForAll) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    }
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

  async unreact(messageId: string, actorId: string, conversationId?: string): Promise<void> {
    const { actor, message } = await this.loadForActor(messageId, actorId, conversationId);
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
  // Edit
  // -------------------------------------------------------------------

  /**
   * Replace the body of a message, preserving what it used to say.
   *
   * Who may: the AUTHOR, inside communication.edit_window_minutes. Nobody else
   * -- not a manager. Editing is not a moderation action: putting different
   * words in somebody's mouth under their name is a different and worse thing
   * than deleting what they said, which is what messages.delete is for. A
   * manager who needs a message gone deletes it for everyone, under their own
   * id, with a reason.
   *
   * What may be edited: a published text message that has not been deleted. A
   * pending one is still in the approval queue and editing it would change what
   * the approver is deciding on after they opened it; a rejected one is a
   * record of what was refused; a media message's content is its attachment,
   * not its caption.
   *
   * What survives: everything. The superseded body is appended to
   * chat.message_revision, which is append-only at the database level, so an
   * edit never destroys evidence. seq and created_at are untouched -- an edit
   * does not reorder a conversation or change when the message was sent.
   */
  async edit(input: EditMessageInput): Promise<MessageDto> {
    const { actor, message, conv } = await this.loadForActor(
      input.messageId,
      input.actorId,
      input.conversationId,
    );

    if (conv.archivedAt) {
      throw new CommError(CommErrorCode.CONVERSATION_ARCHIVED, 'conversation is archived');
    }

    const windowMinutes = await this.config.get('communication.edit_window_minutes');
    const decision = this.authz.canEditMessage(
      actor,
      message,
      Date.now() - message.createdAt.getTime(),
      windowMinutes * 60_000,
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const body = await this.normalizeBody(MessageType.TEXT, input.body, 0);
    // A no-op edit is not an error, but it must not consume a revision or
    // stamp the message as edited: a double-tap on "save" is not an edit.
    if (body === message.body) {
      return this.byIdForViewer(message.id, actor);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Revision 1 is the body it was SENT with, written lazily on the first
      // edit so an unedited message costs nothing.
      if (message.editCount === 0) {
        await tx.messageRevision.create({
          data: {
            messageId: message.id,
            revision: 1,
            body: message.body,
            replacedBy: actor.actorId,
            replacedAt: now,
          },
        });
      } else {
        await tx.messageRevision.create({
          data: {
            messageId: message.id,
            revision: message.editCount + 1,
            body: message.body,
            replacedBy: actor.actorId,
            replacedAt: now,
          },
        });
      }

      const updated = await tx.message.update({
        where: { id: message.id },
        data: {
          body,
          editedAt: now,
          editedBy: actor.actorId,
          editCount: { increment: 1 },
        },
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'message.edited',
        entity: 'message',
        entityId: message.id,
        // The bodies are in chat.message_revision; the audit row records that
        // it happened and by whom, without duplicating message content into a
        // second store.
        after: { editCount: updated.editCount, editedAt: now.toISOString() },
        reason: 'edited by author',
      });

      await this.outbox.enqueue(tx, CommEvent.MESSAGE_UPDATED, {
        conversationId: conv.id,
        messageId: message.id,
        seq: updated.seq?.toString() ?? null,
        body: updated.body,
        editedAt: now.toISOString(),
        editCount: updated.editCount,
      });
    });

    return this.byIdForViewer(message.id, actor);
  }

  /**
   * The edit history, for moderation and audit.
   *
   * Gated on messages.moderate, not on membership: reading what a message USED
   * to say is a moderation capability, and a participant who can read the
   * conversation has no claim on the words that were withdrawn from it.
   */
  async revisions(
    messageId: string,
    actorId: string,
    conversationId?: string,
  ): Promise<Array<{ revision: number; body: string | null; replacedBy: string; replacedAt: string }>> {
    const { actor } = await this.loadForActor(messageId, actorId, conversationId);
    if (!this.authz.hasPermission(actor, Permission.MESSAGES_MODERATE)) {
      throw new CommError(
        CommErrorCode.PERMISSION_DENIED,
        `this actor does not hold ${Permission.MESSAGES_MODERATE}`,
      );
    }
    const rows = await this.prisma.messageRevision.findMany({
      where: { messageId },
      orderBy: { revision: 'asc' },
    });
    return rows.map((r) => ({
      revision: r.revision,
      body: r.body,
      replacedBy: r.replacedBy,
      replacedAt: r.replacedAt.toISOString(),
    }));
  }

  // -------------------------------------------------------------------
  // Forward
  // -------------------------------------------------------------------

  /**
   * Copy a message into other conversations.
   *
   * TWO authorizations, both mandatory and neither implying the other:
   *
   *   SOURCE       loadForActor() proves this actor may read the message where
   *                it lives. Without it, forwarding is a read primitive: name
   *                any message id, receive its text in a conversation you do
   *                control.
   *   DESTINATION  each target goes through the ordinary send path, which runs
   *                canSend() against that conversation. Forwarding therefore
   *                cannot reach a conversation an ordinary message could not,
   *                and it inherits BR-1, scope, silencing and approval whole.
   *
   * A forwarded message is a NEW message authored by the forwarder. It is not
   * attributed to the original author, and it does not carry the original's
   * receipts, reactions or reply target. Provenance is recorded for audit and
   * surfaced to clients as a boolean; see the migration for why not as ids.
   */
  async forward(input: ForwardMessageInput): Promise<MessageDto[]> {
    const { actor, message } = await this.loadForActor(
      input.messageId,
      input.actorId,
      input.conversationId,
    );

    const maxTargets = await this.config.get('communication.forward_max_targets');
    const targets = [...new Set(input.toConversationIds)];
    if (targets.length === 0) {
      throw new CommError(
        CommErrorCode.INVALID_PARTICIPANTS,
        'a forward needs at least one destination',
        400,
      );
    }
    if (targets.length > maxTargets) {
      throw new CommError(
        CommErrorCode.INVALID_PARTICIPANTS,
        `a forward may target at most ${maxTargets} conversations`,
        400,
      );
    }

    // What may leave a conversation at all. A withdrawn message, one still
    // awaiting approval, and an internal note are all things whose content the
    // engine has undertaken not to spread; forwarding is exactly spreading.
    if (message.deletedForAll) {
      throw new CommError(
        CommErrorCode.MESSAGE_NOT_FORWARDABLE,
        'a deleted message cannot be forwarded',
      );
    }
    if (message.moderation !== Moderation.PUBLISHED) {
      throw new CommError(
        CommErrorCode.MESSAGE_NOT_FORWARDABLE,
        `a ${message.moderation} message cannot be forwarded`,
      );
    }
    if (message.visibility === Visibility.INTERNAL) {
      throw new CommError(
        CommErrorCode.MESSAGE_NOT_FORWARDABLE,
        'an internal note cannot be forwarded into a family conversation',
      );
    }
    if (message.type !== MessageType.TEXT) {
      // Attachments are objects in storage with their own signed-URL scoping;
      // copying the row would create a second message pointing at an object the
      // destination's members were never authorized for. Media forwarding waits
      // for the attachment work rather than shipping that.
      throw new CommError(
        CommErrorCode.MESSAGE_NOT_FORWARDABLE,
        'only text messages can be forwarded',
      );
    }

    const sent: MessageDto[] = [];
    for (const conversationId of targets) {
      // Forwarding into the conversation the message already lives in is a
      // no-op the user did not mean; refuse it rather than duplicate.
      if (conversationId === message.conversationId) {
        throw new CommError(
          CommErrorCode.INVALID_PARTICIPANTS,
          'a message cannot be forwarded into its own conversation',
          400,
        );
      }
      sent.push(
        await this.send({
          conversationId,
          senderId: actor.actorId,
          type: MessageType.TEXT,
          body: message.body,
          visibility: Visibility.CUSTOMER,
          clientMessageId: input.clientMessageIds?.[conversationId],
          forwardedFrom: {
            messageId: message.id,
            conversationId: message.conversationId!,
          },
        }),
      );
    }

    await this.audit.audit(this.prisma, {
      actorId: actor.actorId,
      action: 'message.forwarded',
      entity: 'message',
      entityId: message.id,
      after: { to: targets, created: sent.map((m) => m.id) },
      reason: 'forwarded by an authorized reader',
    });

    return sent;
  }

  // -------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------

  /**
   * Full-text search over the messages this actor may read.
   *
   * AUTHORIZATION IS IN THE QUERY, not applied to its results. The candidate
   * set is built from ScopeService's conversation predicate -- the same one the
   * chat list is built on -- so a message outside this actor's scope is not
   * filtered out late, it is never a row. A search that filtered afterwards
   * would leak through its own result count, and through timing.
   *
   * On top of scope, the same message-level rules the read path applies:
   * internal notes only for those who may read them, no pending or rejected
   * messages, nothing deleted for everyone, and nothing this actor hid for
   * themselves. `to_tsvector('simple', ...)` matches the partial index in
   * 20260907110000, so this is an index scan and not a walk of chat.message.
   */
  async search(input: SearchMessagesInput): Promise<{ hits: MessageSearchHit[]; nextCursor: string | null }> {
    const actor = await this.conversations.requireActor(input.actorId);
    const query = input.query.trim();
    if (query.length < 2) {
      throw new CommError(
        CommErrorCode.SEARCH_QUERY_TOO_SHORT,
        'a search needs at least two characters',
        400,
      );
    }

    const maxLimit = await this.config.get('communication.search_page_size_max');
    const limit = Math.min(input.limit ?? 20, maxLimit);

    // Scoping a search to one conversation is reading that conversation: it is
    // authorized exactly as opening it would be, and reports NOT FOUND rather
    // than FORBIDDEN so a search cannot enumerate conversation ids.
    if (input.conversationId) {
      await this.conversations.requireForActor(input.conversationId, actor.actorId);
    }

    const where: Prisma.MessageWhereInput = {
      // Scope, by construction.
      conversation: input.conversationId
        ? { id: input.conversationId }
        : await this.conversations.scopedConversationWhere(actor),
      deletedForAll: false,
      moderation: Moderation.PUBLISHED,
      // A system message is machinery, not conversation; matching one would
      // surface a JSON blob as a search result.
      type: { not: MessageType.SYSTEM },
      hiddenFor: { none: { actorId: actor.actorId } },
      ...(this.authz.canReadInternal(actor) ? {} : { visibility: Visibility.CUSTOMER }),
      ...(input.authorId ? { authorId: input.authorId } : {}),
      ...(input.from || input.to
        ? {
            createdAt: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lte: input.to } : {}),
            },
          }
        : {}),
    };

    // Prisma has no tsquery operator, so the text predicate is raw. It is
    // parameterised -- `query` never reaches SQL as text -- and
    // websearch_to_tsquery is total: it parses any user input into a valid
    // tsquery rather than raising, which matters because this string is
    // whatever the user typed into a search box.
    const matching = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM chat.message
       WHERE deleted_for_all = false
         AND moderation = 'published'
         AND body IS NOT NULL
         AND to_tsvector('simple', body) @@ websearch_to_tsquery('simple', ${query})
       ORDER BY created_at DESC
       LIMIT ${limit * 20}
    `;
    if (matching.length === 0) return { hits: [], nextCursor: null };

    const rows = await this.prisma.message.findMany({
      where: { AND: [where, { id: { in: matching.map((m) => m.id) } }] },
      include: {
        attachments: true,
        reactions: true,
        receipts: true,
        conversation: { select: { id: true, type: true, title: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });

    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? page[page.length - 1].id : null;

    return {
      hits: page.map((m) => ({
        message: toMessageDto(m, undefined, this.viewerOf(actor)),
        conversationId: m.conversation!.id,
        conversationType: m.conversation!.type,
        conversationTitle: m.conversation!.title,
      })),
      nextCursor,
    };
  }

  /** Re-read one message as a DTO for the viewer who just changed it. */
  private async byIdForViewer(messageId: string, actor: Actor): Promise<MessageDto> {
    const row = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { attachments: true, reactions: true, receipts: true },
    });
    if (!row) throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    const previews = await this.replyPreviewsFor(actor, [row]);
    return toMessageDto(
      row,
      undefined,
      this.viewerOf(actor),
      row.replyToMessageId ? (previews.get(row.replyToMessageId) ?? null) : null,
    );
  }

  // -------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------

  /**
   * Per-user hiding. Never affects another participant's copy.
   *
   * A row in chat.message_hidden_for, NOT a write to deleted_at: those two mean
   * different things, and using the global column for a personal action would
   * delete the message for the whole conversation. The list query excludes
   * hidden rows for the requesting actor and for nobody else.
   *
   * No realtime event: nothing changed for anyone but the caller, and the
   * caller already knows.
   */
  async deleteForMe(messageId: string, actorId: string, conversationId?: string): Promise<void> {
    const { actor } = await this.loadForActor(messageId, actorId, conversationId);
    const decision = this.authz.canDeleteForMe(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    await this.prisma.messageHiddenFor.upsert({
      where: { messageId_actorId: { messageId, actorId: actor.actorId } },
      create: { messageId, actorId: actor.actorId },
      update: {},
    });
  }

  /** Undo a "delete for me". The message was never gone, only hidden. */
  async restoreForMe(messageId: string, actorId: string, conversationId?: string): Promise<void> {
    const { actor } = await this.loadForActor(messageId, actorId, conversationId);
    await this.prisma.messageHiddenFor.deleteMany({
      where: { messageId, actorId: actor.actorId },
    });
  }

  /**
   * Author within the configured window, or a manager at any time. The row is
   * never hard-deleted, so operational history stays auditable.
   */
  async deleteForEveryone(
    messageId: string,
    actorId: string,
    reason: string,
    conversationId?: string,
  ): Promise<void> {
    const { actor, message } = await this.loadForActor(messageId, actorId, conversationId);
    const windowMinutes = await this.config.get(
      'communication.delete_for_everyone_window_minutes',
    );
    // The decision lives in AuthorizationService with every other one, so
    // "who may delete for everyone" has exactly one definition and the
    // client-side hiding of the action cannot drift from what the server does.
    const decision = this.authz.canDeleteForEveryone(
      actor,
      message,
      Date.now() - message.createdAt.getTime(),
      windowMinutes * 60_000,
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    // Already withdrawn. Idempotent rather than an error: a retried delete
    // after a dropped response must not surface as a failure.
    if (message.deletedForAll) return;

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

  /**
   * Load a message this actor is allowed to act on.
   *
   * `expectedConversationId` is supplied by every route whose path names a
   * conversation, and a mismatch is reported as NOT FOUND. Without it the path
   * would be decoration: `/conversations/A/messages/<id-from-B>` would act on
   * B's message, correctly authorized against B but audited against A, and a
   * caller could use a conversation they can read as a wrapper for operations
   * on messages elsewhere.
   */
  private async loadForActor(
    messageId: string,
    actorId: string,
    expectedConversationId?: string,
  ) {
    const actor = await this.conversations.requireActor(actorId);
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || !message.conversationId) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    }
    if (expectedConversationId && message.conversationId !== expectedConversationId) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    }
    const conv = await this.conversations.requireConversation(message.conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);

    const decision = this.authz.canRead(
      actor,
      conv,
      membership,
      await this.conversations.scopeFor(actor, conv),
    );
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
