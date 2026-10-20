import { signActorAvatar } from '../profile/avatar-urls';
import { Inject, Injectable } from '@nestjs/common';
import { Conversation, Message, Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, IDENTITY_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import type {
  ActorRef,
  IdentityService,
  ResolvedActors,
} from '../../platform/identity.service';
import { actorRefKey } from '../../platform/identity.service';
import { Actor } from '../../platform/types';
import { ConversationService, isUuid } from '../conversations/conversation.service';
import { AttachmentService } from '../attachments/attachment.service';
import { objectKeyBelongsToConversation } from '../attachments/object-key';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import {
  MessageDto,
  MessageWithRelations,
  messageAuthorRef,
  toMessageDto,
  needsReply,
  conversationState,
} from '../contracts/dto';
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
  attachments?: AttachmentInput[];
  /** Only assist / escalation are honoured; owner vs coverage is derived. */
  requestedMode?: string;
  /**
   * SERVER-ONLY: set by forward() after it authorized the source. The send
   * route never passes it, so a client cannot claim a message is a forward.
   */
  forwardedFromMessageId?: string;
}

export interface ForwardInput {
  actorId: string;
  /** The conversation the messages are forwarded FROM (the route's). */
  conversationId: string;
  messageIds: unknown;
  toConversationIds: unknown;
  /** Optional idempotency, one per (target, message): `${target}:${messageId}` -> clientMessageId. */
  clientMessageIds?: unknown;
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
    private readonly attachments: AttachmentService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  /**
   * The authors of these messages, resolved in a bounded number of queries.
   *
   * This service does three things here and no more: collect the distinct
   * references, ask the identity service, hand the map to the mapper. Actor
   * resolution itself belongs to `IdentityService` and is not reimplemented —
   * there is one place that knows how a uuid becomes a person.
   *
   * BOUNDED BY KIND, NOT BY ROWS. `message.author_type` is the actor kind, so a
   * page of any size costs at most one query per kind present (3), and a page
   * whose authors are all contacts costs one. Deduplication is on
   * `(actorKind, actorId)`, so the same author appearing eighty times is one
   * lookup — and `STAFF:x` and `TEACHER:x` stay two, which an id-keyed map would
   * silently conflate.
   */
  private async authorsFor(
    rows: ReadonlyArray<Pick<Message, 'authorId' | 'authorType'>>,
  ): Promise<ResolvedActors> {
    const refs: ActorRef[] = [];
    for (const row of rows) {
      const ref = messageAuthorRef(row);
      if (ref) refs.push(ref);
    }
    return this.identity.resolveActors(refs);
  }

  // -------------------------------------------------------------------
  // Send
  // -------------------------------------------------------------------

  async send(input: SendMessageInput): Promise<MessageDto> {
    const now = new Date();
    const actor = await this.conversations.requireActor(input.senderId);
    const conv = await this.conversations.requireConversation(input.conversationId);
    // RT-030: the sender must belong to the conversation's organization, and
    // this must be the FIRST thing asked of a loaded conversation. Another
    // tenant's conversation is answered exactly as an unknown one; any check
    // placed before this one (attachment MIME, object-key namespace,
    // idempotency) would answer differently for a conversation that exists.
    const tenant = this.authz.canActInOrganization(actor, conv.organizationId);
    if (!tenant.allowed) throw new CommError(tenant.code, tenant.reason, 404);
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
    // post something that reads as coming from Jawwid itself. A CARD is
    // refused outright (PD-11): it is a ticket's record, written only by the
    // service that wrote the record, so one sent here would be a forgery.
    const requestedType = input.type ?? MessageType.TEXT;
    if (requestedType === MessageType.CARD) {
      throw new CommError(CommErrorCode.VALIDATION, 'a card is written by its ticket, never sent', 400);
    }
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
      this.attachments.validate(a.kind, a.mimeType, a.byteSize, a.durationMs);
    }

    // And the object keys must belong to THIS conversation. `conv.id` is the
    // conversation the server resolved and authorized `canSend` against, not
    // the id in the key -- a key names a namespace, and the namespace in a
    // client-supplied key is a claim. Without this, a member of one
    // conversation could attach another's object key and then be handed a
    // signed URL for it by the ordinary read path.
    //
    // The signing boundary re-checks this independently
    // (`AttachmentService.signUrlsForMessages`); doing it here as well means a
    // foreign key never reaches the database, and the caller gets a 403 rather
    // than a unique-constraint 500.
    this.attachments.assertAttachmentsBelongTo(conv.id, input.attachments ?? []);

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
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    this.validateContent(type, input);
    await this.validateReplyTarget(conv.id, input.replyToMessageId ?? null);

    const moderation = decision.moderation;
    const isPending = moderation === Moderation.PENDING;
    const stickyMinutes = await this.config.get('handoff.grace_minutes');
    // PD-8: the default approver of a held group message is the children's supervisor.
    const activeHandler = await this.conversations.responsibleSupervisor(conv);

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
        // The locked row is also the authority for the message's tenant
        // (RT-030): the column default is the seeded organization, and
        // message_same_organization refuses it for every other tenant.
        const locked = await tx.$queryRaw<Array<{ last_seq: bigint; organization_id: string }>>`
          SELECT last_seq, organization_id::text AS organization_id
            FROM chat.conversation WHERE id = ${conv.id}::uuid FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found', 404);
        }
        const seq = locked[0].last_seq + BigInt(1);
        const organizationId = locked[0].organization_id;
        // RT-032: the author is still live under lock, or this send is ordered
        // before their deactivation commits.
        await this.conversations.assertActorLive(tx, actor);

        const message = await tx.message.create({
          data: {
            organizationId,
            conversationId: conv.id,
            authorType: actor.kind,
            authorId: actor.kind === ActorKind.SYSTEM ? null : actor.actorId,
            onBehalfMode: decision.onBehalfMode,
            type,
            body: input.body ?? null,
            visibility,
            moderation,
            origin,
            seq,
            replyToMessageId: input.replyToMessageId ?? null,
            clientMessageId: input.clientMessageId ?? null,
            forwarded: !!input.forwardedFromMessageId,
            forwardedFromMessageId: input.forwardedFromMessageId ?? null,
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
          include: { attachments: true, reactions: true, receipts: true, card: true },
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
              // No trigger guards this column, so a default would be filed
              // under the wrong tenant silently rather than refused.
              organizationId,
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

      // Sign this message's attachment URLs too. Without it a sender's own
      // voice note comes back with url: null and is unplayable until the thread
      // is re-fetched -- the message is there, but it cannot be heard.
      return toMessageDto(
        created,
        await this.attachments.signUrlsForMessages([created.id], actor.actorId),
        await this.authorsFor([created]),
        (author) => signActorAvatar(author, conv.id, actor.actorId),
      );
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
      include: { attachments: true, reactions: true, receipts: true, card: true },
    });
    // The idempotent-replay path returns the original message, so it must carry
    // the same playable URLs a first send does.
    if (!found) return null;
    return toMessageDto(
      found,
      await this.attachments.signUrlsForMessages([found.id], authorId),
      await this.authorsFor([found]),
      (author) => signActorAvatar(author, conversationId, authorId),
    );
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

    const decision = await this.conversations.canReadResolved(actor, conv, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const maxLimit = await this.config.get('communication.page_size_max');
    const defaultLimit = await this.config.get('communication.page_size_default');
    const limit = Math.min(input.limit ?? defaultLimit, maxLimit);

    const ascending = input.after !== undefined;
    const rows = await this.prisma.message.findMany({
      where: this.visibilityFilter(actor, conv.id, input),
      include: { attachments: true, reactions: true, receipts: true, card: true },
      orderBy: { seq: ascending ? 'asc' : 'desc' },
      take: limit,
    });

    // Signed URLs are minted per read, scoped to messages this actor is already
    // permitted to see, and they expire.
    const signed = await this.attachments.signUrlsForMessages(rows.map((m) => m.id), actor.actorId);
    // ONE identity batch for the whole page, before the map. Resolving inside the
    // map would be one round trip per message -- the shape this whole change exists
    // to remove.
    const authors = await this.authorsFor(rows);
    // The viewer's own stars and the conversation's pins on this page: two
    // indexed lookups, then flags on each message.
    const ids = rows.map((m) => m.id);
    const [starRows, pinRows] = await Promise.all([
      this.prisma.messageStar.findMany({ where: { actorId: actor.actorId, messageId: { in: ids } }, select: { messageId: true } }),
      this.prisma.messagePin.findMany({ where: { conversationId: conv.id }, select: { messageId: true } }),
    ]);
    const starredIds = new Set(starRows.map((r) => r.messageId));
    const pinnedIds = new Set(pinRows.map((r) => r.messageId));
    // Photos are signed for this viewer in THIS conversation: pure HMAC, no I/O.
    const messages = rows.map((m) => ({
      ...toMessageDto(m, signed, authors, (author) => signActorAvatar(author, conv.id, actor.actorId)),
      starred: starredIds.has(m.id),
      pinned: pinnedIds.has(m.id),
    }));
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
    conversationId: string | { in: string[] },
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

  /**
   * The newest message THIS viewer may see in each conversation, for a chat
   * list row. THE CALLER AUTHORIZES THE IDS (the list route passes exactly what
   * listForActor returned); the per-message rule is `visibilityFilter`, the one
   * the message page uses, so a preview can never show a parent an internal
   * note, someone else's held message, or what they deleted for themselves.
   *
   * One indexed lookup per conversation (conversation_id, seq), run together;
   * the list is capped at 200 rows.
   */
  async lastVisibleMessages(conversationIds: readonly string[], actor: Actor): Promise<Map<string, Message>> {
    const out = new Map<string, Message>();
    const found = await Promise.all(
      conversationIds.map((id) =>
        this.prisma.message.findFirst({
          where: this.visibilityFilter(actor, id, {} as ListMessagesInput),
          orderBy: { seq: 'desc' },
        }),
      ),
    );
    for (const m of found) if (m?.conversationId) out.set(m.conversationId, m);
    return out;
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
    const decision = await this.conversations.canReadResolved(actor, conv, membership);
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

  /**
   * What counts as unread, in one place.
   *
   * Built on the receipt table, which is the existing read-state architecture
   * and already encodes most of the visibility rules by construction: a
   * recipient row is written only for live members other than the author, and
   * never for a message held for approval. So an actor's own messages, pending
   * messages and (for a contact) internal notes have no receipt and cannot be
   * counted.
   *
   * Two things receipts do NOT encode, and this adds:
   *
   * * **Hidden for me.** `message_hidden_for` is written by delete-for-me and
   *   leaves the receipt untouched. Without this clause a parent who deleted an
   *   unread message kept it in their badge forever, with no way to clear it --
   *   the message is not in their conversation to be read.
   * * **Retracted for everyone.** A message deleted for all is served with no
   *   body and no attachments; counting it asks the parent to go and read
   *   nothing.
   *
   * The same predicate serves the single-conversation endpoint and the batch
   * below, so the number on the chat list and the number from
   * `GET /conversations/:id/messages/unread` cannot disagree.
   */
  private unreadWhere(actorId: string): Prisma.MessageWhereInput {
    return {
      deletedForAll: false,
      hiddenFor: { none: { actorId } },
      receipts: {
        some: {
          actorId,
          state: { in: [ReceiptState.SENT, ReceiptState.DELIVERED] },
        },
      },
    };
  }

  async unreadCount(conversationId: string, actorId: string): Promise<number> {
    return this.prisma.message.count({
      where: { conversationId, ...this.unreadWhere(actorId) },
    });
  }

  /**
   * Unread counts for many conversations at once.
   *
   * **One query, whatever the list length.** The chat list is the only caller
   * and it renders every conversation an actor has; asking per row would be a
   * hundred round trips on the mobile connection this audience is on, which is
   * precisely why the count was left off the DTO in the first place (mobile
   * gap O1).
   *
   * The caller passes ids it has ALREADY authorized -- this method is not an
   * authorization boundary and must never be handed a raw id from a request.
   * Even so it is scoped to the actor's own receipts, so it can only ever count
   * messages that were addressed to them.
   *
   * Conversations with nothing unread are absent from the map rather than
   * present as zero; the caller defaults them.
   */
  async unreadCountsFor(
    conversationIds: string[],
    actorId: string,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (conversationIds.length === 0) return counts;

    const rows = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: conversationIds },
        ...this.unreadWhere(actorId),
      },
      _count: { _all: true },
    });

    for (const row of rows) {
      if (row.conversationId) counts.set(row.conversationId, row._count._all);
    }
    return counts;
  }

  // -------------------------------------------------------------------
  // Reactions
  // -------------------------------------------------------------------

  async react(messageId: string, actorId: string, emoji: string): Promise<void> {
    const { actor, message } = await this.loadForActor(messageId, actorId);
    // PD-7: a reaction is a signal from one side to the other; a direct
    // teacher<->parent conversation accepts none. (Removing one's own earlier
    // reaction, `unreact`, stays allowed: it sends nothing new.)
    if (await this.conversations.isDirectTeacherParent(message.conversationId!)) {
      throw new CommError(
        CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
        'BR-1: a teacher and a parent communicate only inside the Student Group, never directly',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor); // RT-032
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
  // Star (private) and pin (shared, at most three)
  // -------------------------------------------------------------------

  /** At most this many pins per conversation; a new one replaces the oldest (owner decision). */
  static readonly MAX_PINS = 3;

  /**
   * Whether this actor may WRITE in the conversation now: exactly the decision a
   * send takes (staff scope, BR-1, archived, silent members, internal notes).
   * "Anyone who can write may pin" (owner decision 2026-10-19) is this check.
   */
  private async mayWrite(actor: Actor, conv: Conversation, visibility: string) {
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const family = conv.familyId
      ? await this.prisma.family.findUnique({ where: { id: conv.familyId }, select: { ownerId: true } })
      : null;
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId: conv.id, leftAt: null },
      select: { actorKind: true },
    });
    return this.authz.canSend(
      actor,
      conv,
      membership,
      { visibility },
      new Date(),
      family?.ownerId ?? null,
      members.map((m) => m.actorKind),
      await this.conversations.liveMembersOf(conv.id),
    );
  }

  /** A private bookmark on a message the actor can read. Idempotent. */
  async star(messageId: string, actorId: string): Promise<void> {
    const { actor, message } = await this.loadForActor(messageId, actorId);
    if (message.deletedForAll) throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    await this.prisma.messageStar.upsert({
      where: { messageId_actorId: { messageId, actorId: actor.actorId } },
      create: { messageId, actorId: actor.actorId },
      update: {},
    });
  }

  async unstar(messageId: string, actorId: string): Promise<void> {
    const actor = await this.conversations.requireActor(actorId);
    if (!isUuid(messageId)) throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    // Removing one's own bookmark needs no read check: it reveals and changes nothing else.
    await this.prisma.messageStar.deleteMany({ where: { messageId, actorId: actor.actorId } });
  }

  /**
   * Pin a published message for everyone in its conversation. Anyone who may
   * write there may pin; a fourth pin replaces the oldest, in one transaction
   * under a lock on the conversation, so two pins at once cannot exceed three.
   */
  async pin(messageId: string, actorId: string): Promise<void> {
    const { actor, message, conv } = await this.loadForActor(messageId, actorId);
    if (message.deletedForAll || message.moderation !== Moderation.PUBLISHED || message.type === MessageType.SYSTEM) {
      throw new CommError(CommErrorCode.VALIDATION, 'only a published message can be pinned', 400);
    }
    const decision = await this.mayWrite(actor, conv, message.visibility);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor); // RT-032
      await tx.$queryRaw`select id from chat.conversation where id = ${conv.id}::uuid for update`;
      const pins = await tx.messagePin.findMany({
        where: { conversationId: conv.id },
        orderBy: { pinnedAt: 'asc' },
      });
      if (pins.some((p) => p.messageId === messageId)) return;
      const excess = pins.length - (MessageService.MAX_PINS - 1);
      if (excess > 0) {
        await tx.messagePin.deleteMany({
          where: { conversationId: conv.id, messageId: { in: pins.slice(0, excess).map((p) => p.messageId) } },
        });
      }
      await tx.messagePin.create({
        data: { conversationId: conv.id, messageId, pinnedBy: actor.actorId, pinnedByKind: actor.kind },
      });
      await this.announcePins(tx, conv, actor, 'message_pinned', messageId);
    });
  }

  /** Unpin: the same right as pinning -- anyone who may write there. */
  async unpin(messageId: string, actorId: string): Promise<void> {
    const { actor, message, conv } = await this.loadForActor(messageId, actorId);
    const decision = await this.mayWrite(actor, conv, message.visibility);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.messagePin.deleteMany({ where: { conversationId: conv.id, messageId } });
      if (removed.count > 0) await this.announcePins(tx, conv, actor, 'message_unpinned', messageId);
    });
  }

  /** Every client in the conversation re-reads it (pins are part of it); the audit log records who. */
  private async announcePins(tx: Prisma.TransactionClient, conv: Conversation, actor: Actor, type: string, messageId: string) {
    await this.outbox.enqueue(tx, CommEvent.CONVERSATION_UPDATED, {
      conversationId: conv.id,
      familyId: conv.familyId,
      state: conversationState(conv),
      needsReply: needsReply(conv),
      lastActivityAt: conv.lastActivityAt.toISOString(),
      handlerId: await this.conversations.responsibleSupervisor(conv),
    });
    await this.audit.audit(tx, {
      actorId: actor.actorId,
      action: type === 'message_pinned' ? 'message.pinned' : 'message.unpinned',
      entity: 'conversation',
      entityId: conv.id,
      after: { messageId },
      reason: 'changed by a member who may write in the conversation',
    });
  }

  /**
   * The conversation's pins as THIS viewer may see them, oldest first: the same
   * visibility rule as the message page, so a parent never sees a pinned
   * internal note and nobody sees what they deleted for themselves.
   */
  async pins(conversationId: string, actorId: string): Promise<{ pins: Array<{ pinnedAt: string; pinnedBy: string; message: MessageDto }> }> {
    const actor = await this.conversations.requireActor(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const decision = await this.conversations.canReadResolved(actor, conv, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const pins = await this.prisma.messagePin.findMany({ where: { conversationId: conv.id }, orderBy: { pinnedAt: 'asc' } });
    if (pins.length === 0) return { pins: [] };
    const rows = await this.prisma.message.findMany({
      where: { AND: [this.visibilityFilter(actor, conv.id, {} as ListMessagesInput), { id: { in: pins.map((p) => p.messageId) }, deletedForAll: false }] },
      include: { attachments: true, reactions: true, receipts: true, card: true },
    });
    const dtos = await this.dtosFor(rows, conv.id, actor);
    const byId = new Map(dtos.map((d) => [d.id, d]));
    return {
      pins: pins
        .filter((p) => byId.has(p.messageId))
        .map((p) => ({ pinnedAt: p.pinnedAt.toISOString(), pinnedBy: p.pinnedBy, message: { ...byId.get(p.messageId)!, pinned: true } })),
    };
  }

  /**
   * The actor's starred messages, newest star first, across every conversation
   * they may STILL read -- a star does not outlive access: a message from a
   * conversation they left, or one now hidden from them, is simply not listed.
   */
  async starred(
    actorId: string,
    page: { before?: string; limit?: number } = {},
  ): Promise<{ items: Array<{ starredAt: string; conversationId: string; message: MessageDto }>; nextBefore: string | null }> {
    const actor = await this.conversations.requireActor(actorId);
    const limit = Math.min(Math.max(Number(page.limit) || 30, 1), 100);
    const before = page.before ? new Date(page.before) : null;
    const stars = await this.prisma.messageStar.findMany({
      where: { actorId: actor.actorId, ...(before && !Number.isNaN(before.getTime()) ? { starredAt: { lt: before } } : {}) },
      orderBy: { starredAt: 'desc' },
      take: limit,
    });
    if (stars.length === 0) return { items: [], nextBefore: null };
    const candidates = await this.prisma.message.findMany({
      where: { id: { in: stars.map((s) => s.messageId) }, deletedForAll: false },
      select: { id: true, conversationId: true },
    });
    const items: Array<{ starredAt: string; conversationId: string; message: MessageDto }> = [];
    const byConv = new Map<string, string[]>();
    for (const c of candidates) if (c.conversationId) byConv.set(c.conversationId, [...(byConv.get(c.conversationId) ?? []), c.id]);
    const dtos = new Map<string, MessageDto>();
    for (const [convId, ids] of byConv) {
      const conv = await this.conversations.requireConversation(convId).catch(() => null);
      if (!conv) continue;
      const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
      if (!(await this.conversations.canReadResolved(actor, conv, membership)).allowed) continue;
      const rows = await this.prisma.message.findMany({
        where: { AND: [this.visibilityFilter(actor, conv.id, {} as ListMessagesInput), { id: { in: ids } }] },
        include: { attachments: true, reactions: true, receipts: true, card: true },
      });
      for (const d of await this.dtosFor(rows, conv.id, actor)) dtos.set(d.id, { ...d, starred: true });
    }
    for (const s of stars) {
      const m = dtos.get(s.messageId);
      if (m?.conversationId) items.push({ starredAt: s.starredAt.toISOString(), conversationId: m.conversationId, message: m });
    }
    return {
      items,
      nextBefore: stars.length === limit ? stars[stars.length - 1]!.starredAt.toISOString() : null,
    };
  }

  /** Message rows to DTOs for one viewer in one conversation: signed media, names, photos. */
  private async dtosFor(rows: MessageWithRelations[], conversationId: string, actor: Actor): Promise<MessageDto[]> {
    const signed = await this.attachments.signUrlsForMessages(rows.map((m) => m.id), actor.actorId);
    const authors = await this.authorsFor(rows);
    return rows.map((m) => toMessageDto(m, signed, authors, (author) => signActorAvatar(author, conversationId, actor.actorId)));
  }

  // -------------------------------------------------------------------
  // Search (owner decision 2026-10-20: inside a chat and across one's chats)
  // -------------------------------------------------------------------

  static readonly SEARCH_PAGE = 50;
  static readonly SEARCH_ACROSS_LIMIT = 40;
  /** Text candidates per round, before the visibility rule narrows them. */
  private static readonly SEARCH_WINDOW = 200;
  /**
   * Rounds of SEARCH_WINDOW candidates one request may read. The visibility
   * rule runs AFTER the text match, so a window can be mostly matches this
   * viewer may not see (internal notes, held messages, "deleted for me"); a
   * request keeps reading older windows until its page is full or this bound
   * is reached, rather than answering "no matches" over visible older ones.
   */
  private static readonly SEARCH_ROUNDS = 5;

  /**
   * Text search inside one conversation, newest first, paged by seq (`before`).
   * The caller must be able to read the conversation; every text candidate then
   * passes `visibilityFilter`, so a search can never surface a message the
   * message list would not show this viewer. Deleted messages, system messages
   * and cards are never matched.
   */
  async search(input: {
    actorId: string;
    conversationId: string;
    q: unknown;
    before?: string;
  }): Promise<{ hits: MessageDto[]; nextBefore: string | null }> {
    const q = searchQuery(input.q);
    const actor = await this.conversations.requireActor(input.actorId);
    const conv = await this.conversations.requireConversation(input.conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const decision = await this.conversations.canReadResolved(actor, conv, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const page = MessageService.SEARCH_PAGE;
    const window = MessageService.SEARCH_WINDOW;
    let cursor = input.before && /^\d{1,18}$/.test(input.before) ? input.before : null;
    const hits: MessageWithRelations[] = [];
    let exhausted = false;

    for (let round = 0; round < MessageService.SEARCH_ROUNDS && hits.length < page; round += 1) {
      const candidates = await this.prisma.$queryRaw<Array<{ id: string; seq: bigint | null }>>`
        SELECT id, seq FROM chat.message
        WHERE conversation_id = ${conv.id}::uuid
          AND deleted_for_all = false AND body IS NOT NULL
          AND type NOT IN ('system', 'card')
          AND (${cursor}::bigint IS NULL OR seq < ${cursor}::bigint)
          AND chat.search_fold(body) LIKE '%' || chat.search_fold(${likeEscape(q)}) || '%' ESCAPE '!'
        ORDER BY seq DESC NULLS LAST
        LIMIT ${window}`;
      if (candidates.length > 0) {
        const visible = await this.prisma.message.findMany({
          where: { AND: [this.visibilityFilter(actor, conv.id, {} as ListMessagesInput), { id: { in: candidates.map((c) => c.id) } }] },
          include: { attachments: true, reactions: true, receipts: true, card: true },
          orderBy: { seq: 'desc' },
          take: page - hits.length,
        });
        hits.push(...visible);
      }
      const last = candidates[candidates.length - 1]?.seq;
      if (candidates.length < window || last == null) {
        exhausted = true;
        break;
      }
      cursor = last.toString();
    }

    // A full page continues from its last hit (older visible matches may sit
    // in the same window); otherwise from the end of the windows read.
    const lastHit = hits.length >= page ? hits[hits.length - 1]?.seq : null;
    const nextBefore = lastHit != null ? lastHit.toString() : exhausted ? null : cursor;
    return { hits: await this.dtosFor(hits, conv.id, actor), nextBefore };
  }

  /**
   * Text search across every conversation in the caller's chat list, newest
   * first, at most SEARCH_ACROSS_LIMIT hits. `listForActor` IS the boundary --
   * exactly the chats this person's list shows (for staff, PD-8 scope; for a
   * family member or a teacher, live membership) -- and then the per-message
   * `visibilityFilter`, as in a single chat. Needs three meaningful
   * characters: a two-letter term cannot use the trigram index and would fold
   * every message of every listed chat.
   */
  async searchAll(input: { actorId: string; q: unknown }): Promise<{ hits: Array<{ conversationId: string; message: MessageDto }> }> {
    const q = searchQuery(input.q, MessageService.SEARCH_ACROSS_MIN);
    const actor = await this.conversations.requireActor(input.actorId);
    const ids = (await this.conversations.listForActor(actor.actorId)).map((c) => c.id);
    if (ids.length === 0) return { hits: [] };

    const limit = MessageService.SEARCH_ACROSS_LIMIT;
    const window = MessageService.SEARCH_WINDOW;
    let cursor: { at: Date; id: string } | null = null;
    const rows: MessageWithRelations[] = [];

    for (let round = 0; round < MessageService.SEARCH_ROUNDS && rows.length < limit; round += 1) {
      const after = cursor;
      const candidates: Array<{ id: string; created_at: Date }> = await this.prisma.$queryRaw`
        SELECT id, created_at FROM chat.message
        WHERE conversation_id = ANY(${ids}::uuid[])
          AND deleted_for_all = false AND body IS NOT NULL
          AND type NOT IN ('system', 'card')
          AND (${after?.at ?? null}::timestamptz IS NULL
               OR (created_at, id) < (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
          AND chat.search_fold(body) LIKE '%' || chat.search_fold(${likeEscape(q)}) || '%' ESCAPE '!'
        ORDER BY created_at DESC, id DESC
        LIMIT ${window}`;
      if (candidates.length > 0) {
        rows.push(
          ...(await this.prisma.message.findMany({
            where: { AND: [this.visibilityFilter(actor, { in: ids }, {} as ListMessagesInput), { id: { in: candidates.map((c) => c.id) } }] },
            include: { attachments: true, reactions: true, receipts: true, card: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit - rows.length,
          })),
        );
      }
      if (candidates.length < window) break;
      const last = candidates[candidates.length - 1]!;
      cursor = { at: last.created_at, id: last.id };
    }

    // Photos and names are signed per conversation, so map each chat's rows together.
    const byConv = new Map<string, MessageWithRelations[]>();
    for (const r of rows) if (r.conversationId) byConv.set(r.conversationId, [...(byConv.get(r.conversationId) ?? []), r]);
    const dtos = new Map<string, MessageDto>();
    for (const [convId, convRows] of byConv) for (const d of await this.dtosFor(convRows, convId, actor)) dtos.set(d.id, d);
    return {
      hits: rows.flatMap((r) => {
        const message = dtos.get(r.id);
        return message && r.conversationId ? [{ conversationId: r.conversationId, message }] : [];
      }),
    };
  }

  /** Cross-chat search needs this many meaningful characters (see searchAll). */
  static readonly SEARCH_ACROSS_MIN = 3;

  /**
   * Every message this actor may see in a conversation, oldest first, in
   * batches of stored rows with their authors' display names. For the super
   * admin's export: THE CALLER AUTHORIZES the conversation
   * (ConversationExportService); which messages appear is `visibilityFilter`,
   * the one rule. `upToSeq` freezes the set, so a count taken in one pass and
   * the archive written in the next describe the same messages. Nothing here is
   * signed: an export carries bytes, never links.
   */
  async *exportRows(
    actor: Actor,
    conversationId: string,
    upToSeq: bigint | null,
  ): AsyncGenerator<Array<{ row: MessageWithRelations; author: string | null }>> {
    const batch = 500;
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.message.findMany({
        where: {
          AND: [
            this.visibilityFilter(actor, conversationId, {} as ListMessagesInput),
            upToSeq === null ? {} : { seq: { lte: upToSeq } },
          ],
        },
        include: { attachments: true, reactions: true, receipts: true, card: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: batch,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) return;
      const authors = await this.authorsFor(rows);
      yield rows.map((row) => {
        const ref = messageAuthorRef(row);
        return { row, author: ref ? (authors.get(actorRefKey(ref))?.displayName ?? null) : null };
      });
      cursor = rows[rows.length - 1]!.id;
      if (rows.length < batch) return;
    }
  }

  // -------------------------------------------------------------------
  // Forward (owner decisions 2026-10-19: anyone, any message they can read,
  // text and media, up to ten conversations)
  // -------------------------------------------------------------------

  static readonly MAX_FORWARD_TARGETS = 10;
  static readonly MAX_FORWARD_MESSAGES = 30;

  /**
   * Copy messages into other conversations. TWO authorizations, neither
   * implying the other (ported from the phase-7 design, 6137735):
   *
   *   SOURCE       each message passes loadForActor -- the forwarder may read it
   *                where it lives -- and must be one that may leave: published,
   *                not deleted, not a system message or a ticket's card.
   *                Without this, forwarding would be a read primitive.
   *   DESTINATION  every target is checked up front with the send decision
   *                (mayWrite), then each copy goes through send() itself, so a
   *                forward reaches nowhere a message could not and inherits
   *                BR-1, scope, silencing and approval whole.
   *
   * A forward is a NEW message authored by the forwarder, flagged `forwarded`;
   * it carries no reactions, receipts or reply target of the original. An
   * internal note stays an internal note (only staff may write one), so it can
   * never reach a family. Media are COPIED into the destination's namespace.
   */
  async forward(input: ForwardInput): Promise<{ sent: MessageDto[] }> {
    const ids = [...new Set(Array.isArray(input.messageIds) ? input.messageIds.filter((x): x is string => typeof x === 'string') : [])];
    const targets = [...new Set(Array.isArray(input.toConversationIds) ? input.toConversationIds.filter((x): x is string => typeof x === 'string') : [])];
    if (ids.length === 0 || targets.length === 0) {
      throw new CommError(CommErrorCode.VALIDATION, 'a forward needs at least one message and one destination', 400);
    }
    if (targets.length > MessageService.MAX_FORWARD_TARGETS) {
      throw new CommError(CommErrorCode.VALIDATION, `a forward may reach at most ${MessageService.MAX_FORWARD_TARGETS} conversations`, 400);
    }
    if (ids.length > MessageService.MAX_FORWARD_MESSAGES) {
      throw new CommError(CommErrorCode.VALIDATION, `at most ${MessageService.MAX_FORWARD_MESSAGES} messages can be forwarded at once`, 400);
    }
    if (!targets.every(isUuid)) throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found', 404);

    // SOURCE: readable here, and allowed to leave.
    const sources: Message[] = [];
    let actor: Actor | null = null;
    for (const id of ids) {
      const loaded = await this.loadForActor(id, input.actorId);
      actor = loaded.actor;
      const m = loaded.message;
      if (m.conversationId !== input.conversationId) {
        throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
      }
      if (m.deletedForAll || m.moderation !== Moderation.PUBLISHED || m.type === MessageType.SYSTEM || m.type === MessageType.CARD) {
        throw new CommError(CommErrorCode.MESSAGE_NOT_FORWARDABLE, 'that message cannot be forwarded', 403);
      }
      sources.push(m);
    }
    sources.sort((a, b) => (a.seq ?? 0n) < (b.seq ?? 0n) ? -1 : 1);
    const forwarder = actor!;

    // DESTINATION: every target may be written in, for every visibility forwarded.
    const visibilities = [...new Set(sources.map((m) => m.visibility))];
    for (const target of targets) {
      const conv = await this.conversations.requireConversation(target);
      for (const visibility of visibilities) {
        const decision = await this.mayWrite(forwarder, conv, visibility);
        if (!decision.allowed) throw new CommError(decision.code, decision.reason);
      }
    }

    const attachments = await this.prisma.messageAttachment.findMany({
      where: { messageId: { in: sources.map((m) => m.id) } },
      orderBy: { createdAt: 'asc' },
    });
    const keys = (input.clientMessageIds && typeof input.clientMessageIds === 'object' ? input.clientMessageIds : {}) as Record<string, unknown>;

    const sent: MessageDto[] = [];
    for (const target of targets) {
      for (const m of sources) {
        const copies = await this.attachments.copyForForward(
          attachments.filter((a) => a.messageId === m.id),
          target,
        );
        try {
          const key = keys[`${target}:${m.id}`];
          sent.push(
            await this.send({
              conversationId: target,
              senderId: forwarder.actorId,
              type: m.type,
              body: m.body,
              visibility: m.visibility,
              clientMessageId: typeof key === 'string' ? key : undefined,
              attachments: copies,
              forwardedFromMessageId: m.id,
            }),
          );
        } catch (error) {
          await this.attachments.discardCopies(copies.map((c) => c.objectKey));
          throw error;
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await this.audit.audit(tx, {
        actorId: forwarder.actorId,
        action: 'message.forwarded',
        entity: 'conversation',
        entityId: input.conversationId,
        after: { messages: sources.map((m) => m.id), to: targets, created: sent.map((s) => s.id) },
        reason: 'forwarded by a reader who may write in each destination',
      });
    });
    return { sent };
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

  /**
   * RT-037 -- the access-time decision behind a media URL. A URL proves only
   * that it was minted for this actor and this attachment; whether the bytes
   * may be served is decided HERE, now, by the same rules that decide whether
   * the message itself is readable: the conversation (tenant, staff scope,
   * membership, activity), internal / pending / rejected visibility, "deleted
   * for me" (`visibilityFilter`, the single place that decides it), and
   * "deleted for everyone". Every refusal reads as absent.
   */
  async authorizeAttachmentRead(
    attachmentId: string,
    actorId: string,
    variant: 'o' | 't',
  ): Promise<{ objectKey: string }> {
    const absent = () => new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'attachment not found', 404);
    if (!isUuid(attachmentId)) throw absent();
    const attachment = await this.prisma.messageAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: { select: { id: true, conversationId: true, deletedForAll: true } } },
    });
    if (!attachment?.message?.conversationId || attachment.message.deletedForAll) throw absent();

    const { actor, conv } = await this.loadForActor(attachment.message.id, actorId);
    const visible = await this.prisma.message.count({
      where: { ...this.visibilityFilter(actor, conv.id, {} as ListMessagesInput), id: attachment.message.id },
    });
    if (visible === 0) throw absent();

    const objectKey = variant === 't' ? attachment.thumbnailObjectKey : attachment.objectKey;
    // The same namespace rule that decides signing: a key outside its own
    // conversation is never served, whatever row points at it.
    if (!objectKey || !objectKeyBelongsToConversation(conv.id, objectKey)) throw absent();
    return { objectKey };
  }

  private async loadForActor(messageId: string, actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (!isUuid(messageId)) throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || !message.conversationId) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    }
    const conv = await this.conversations.requireConversation(message.conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);

    const decision = await this.conversations.canReadResolved(actor, conv, membership);
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

  // -------------------------------------------------------------------
  // Edit
  // -------------------------------------------------------------------

  /**
   * The author rewrites their own text message, within the edit window.
   *
   * What may be edited: a published, never-moderated, undeleted TEXT message.
   * A message that went through approval stays exactly as it was approved, and
   * an author whose messages HERE would now be held for approval may not edit
   * either -- an edit is never a way round moderation. The author must still be
   * able to write in the conversation: the same `canSend` decision a send takes.
   *
   * The previous wording is kept in chat.message_revision, written in the same
   * transaction; the database refuses a body change without one
   * (chat.forbid_message_rewrite, 20261020130000). Neither body enters the
   * audit or event log -- contents never do.
   */
  async edit(
    messageId: string,
    actorId: string,
    rawBody: unknown,
    conversationId?: string,
  ): Promise<MessageDto> {
    const body = typeof rawBody === 'string' ? rawBody.trim() : '';
    if (!body) throw new CommError(CommErrorCode.EMPTY_MESSAGE, 'an edited message requires a body', 400);

    const { actor, message, conv } = await this.loadForActor(messageId, actorId);
    // The route names a conversation; a message of another one reads as absent.
    if (conversationId !== undefined && message.conversationId !== conversationId) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'message not found', 404);
    }
    if (actor.kind === ActorKind.SYSTEM || message.authorId !== actor.actorId) {
      throw new CommError(CommErrorCode.NOT_MESSAGE_AUTHOR, 'only the author may edit a message');
    }
    const notEditable = (why: string) => new CommError(CommErrorCode.MESSAGE_NOT_EDITABLE, why, 409);
    if (message.type !== MessageType.TEXT || message.deletedForAll || message.moderation !== Moderation.PUBLISHED) {
      throw notEditable('only a published text message can be edited');
    }
    if ((await this.prisma.messageApproval.count({ where: { messageId } })) > 0) {
      throw notEditable('a message that went through approval cannot be edited');
    }

    const now = new Date();
    const windowMinutes = await this.config.get('communication.edit_window_minutes');
    if (now.getTime() - message.createdAt.getTime() > windowMinutes * 60_000) {
      throw new CommError(
        CommErrorCode.EDIT_WINDOW_EXPIRED,
        `the edit window of ${windowMinutes} minutes has expired`,
      );
    }

    const decision = await this.mayWrite(actor, conv, message.visibility);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    if (decision.moderation !== Moderation.PUBLISHED) {
      throw notEditable('messages here are held for approval, so they cannot be edited');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor); // RT-032
      // The row, locked: two edits at once are ordered, and each revision holds
      // the wording it actually replaced.
      const current = await tx.$queryRaw<Array<{ body: string | null }>>`
        SELECT body FROM chat.message WHERE id = ${messageId}::uuid FOR UPDATE
      `;
      const previous = current[0]?.body ?? null;
      if (previous === null) throw notEditable('only a text message can be edited');
      if (previous === body) {
        return tx.message.findUniqueOrThrow({
          where: { id: messageId },
          include: { attachments: true, reactions: true, receipts: true, card: true },
        });
      }
      await tx.messageRevision.create({
        data: {
          messageId,
          previousBody: previous,
          editedBy: actor.actorId,
          editedByKind: actor.kind,
          editedAt: now,
        },
      });
      const row = await tx.message.update({
        where: { id: messageId },
        data: { body, editedAt: now },
        include: { attachments: true, reactions: true, receipts: true, card: true },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'message.edit',
        entity: 'message',
        entityId: messageId,
        after: { conversationId: conv.id, editedAt: now.toISOString() },
        reason: 'edited by author',
      });
      await this.outbox.enqueue(tx, CommEvent.MESSAGE_UPDATED, {
        conversationId: conv.id,
        messageId,
        visibility: message.visibility,
        editedAt: now.toISOString(),
      });
      return row;
    });

    return toMessageDto(
      updated,
      await this.attachments.signUrlsForMessages([updated.id], actor.actorId),
      await this.authorsFor([updated]),
      (author) => signActorAvatar(author, conv.id, actor.actorId),
    );
  }
}

// The marks search ignores, built from code points so the source carries no
// invisible characters: Arabic harakat U+064B-U+065F, superscript alef U+0670,
// tatweel U+0640. chat.search_fold (migration 20261020140000) removes the same.
const SEARCH_MARKS = new RegExp(
  `[${String.fromCharCode(0x64b)}-${String.fromCharCode(0x65f)}${String.fromCharCode(0x670)}${String.fromCharCode(0x640)}]`,
  'g',
);

/** A search term: `min` (default 2) to 100 meaningful characters, spaces collapsed. */
export function searchQuery(raw: unknown, min = 2): string {
  const q = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  const meaningful = [...q.replace(SEARCH_MARKS, '').replace(/\s/g, '')].length;
  if (meaningful < min || [...q].length > 100) {
    throw new CommError(CommErrorCode.VALIDATION, `search for ${min} to 100 characters`, 400);
  }
  return q;
}

/** LIKE wildcards in the user's text are literal: escape with '!' (ESCAPE '!'). */
function likeEscape(s: string): string {
  return s.replace(/[!%_]/g, (c) => `!${c}`);
}
