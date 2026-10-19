import { Inject, Injectable } from '@nestjs/common';
import { Conversation, Prisma } from '@prisma/client';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ConversationService } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import { conversationState, needsReply } from '../communication/contracts/dto';
import {
  ActorKind,
  MessageType,
  Moderation,
  OnBehalfMode,
  Origin,
  ReceiptState,
  Visibility,
} from '../communication/contracts/vocab';

type Tx = Prisma.TransactionClient;

/** A file the card carries, already uploaded into the conversation's namespace. */
export interface CardAttachment {
  kind: 'file' | 'image';
  objectKey: string;
  mimeType: string;
  byteSize: number;
  originalName: string;
}

/**
 * PD-11 / PD-12: post ONE card message, inside the caller's transaction.
 *
 * The same shape as LessonService's lesson cards: a `card` message carrying a
 * plain-text body (for a client that predates cards) and a chat.message_card row
 * (for one that draws it). A card is a record, not free speech, so it is never
 * held for approval. Its author is the person who recorded it when they are a
 * live member of the conversation, and Jawwid otherwise.
 *
 * An attachment rides on the ordinary message_attachment row, so the certificate
 * file is signed and served by the existing read path: to that conversation's
 * readers, and to nobody else (RT-037).
 */
@Injectable()
export class CardPoster {
  constructor(
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async post(
    tx: Tx,
    conv: Conversation,
    recorder: Actor | null,
    card: { kind: string; payload: Record<string, unknown>; body: string },
    attachment: CardAttachment | null = null,
  ): Promise<string> {
    const locked = await tx.$queryRaw<Array<{ last_seq: bigint }>>`
      SELECT last_seq FROM chat.conversation WHERE id = ${conv.id}::uuid FOR UPDATE`;
    const seq = locked[0].last_seq + BigInt(1);
    const members = await tx.conversationMember.findMany({ where: { conversationId: conv.id, leftAt: null } });
    const asMember = recorder !== null && members.some((m) => m.actorId === recorder.actorId);
    const author = asMember ? recorder : null;
    if (author) await this.conversations.assertActorLive(tx, author);

    const now = new Date();
    const message = await tx.message.create({
      data: {
        organizationId: conv.organizationId,
        conversationId: conv.id,
        authorType: author ? author.kind : ActorKind.SYSTEM,
        authorId: author ? author.actorId : null,
        // Staff here are parties to the conversation (the Teachers department
        // in a supervision conversation), never stepping in for someone else.
        onBehalfMode: author?.kind === ActorKind.STAFF ? OnBehalfMode.OWNER : null,
        type: MessageType.CARD,
        body: card.body,
        visibility: Visibility.CUSTOMER,
        moderation: Moderation.PUBLISHED,
        origin: author ? Origin.USER : Origin.AUTOMATION,
        seq,
        attachmentsJson: [],
      },
    });
    await tx.messageCard.create({
      data: {
        messageId: message.id,
        organizationId: conv.organizationId,
        kind: card.kind,
        lessonId: null,
        payload: card.payload as Prisma.InputJsonValue,
      },
    });
    if (attachment) {
      await tx.messageAttachment.create({
        data: {
          messageId: message.id,
          kind: attachment.kind,
          objectKey: attachment.objectKey,
          mimeType: attachment.mimeType,
          byteSize: attachment.byteSize,
          originalName: attachment.originalName,
        },
      });
    }
    const recipients = members.filter((m) => m.actorId !== author?.actorId);
    if (recipients.length > 0) {
      await tx.messageReceipt.createMany({
        data: recipients.map((r) => ({ messageId: message.id, actorId: r.actorId, state: ReceiptState.SENT })),
        skipDuplicates: true,
      });
    }
    const updated = await tx.conversation.update({ where: { id: conv.id }, data: { lastSeq: seq, lastActivityAt: now } });
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
    await this.outbox.enqueue(tx, CommEvent.CONVERSATION_UPDATED, {
      conversationId: updated.id,
      familyId: updated.familyId,
      state: conversationState(updated),
      needsReply: needsReply(updated),
      lastActivityAt: updated.lastActivityAt.toISOString(),
      handlerId: await this.conversations.responsibleSupervisor(conv),
    });
    await this.audit.event(tx, {
      familyId: conv.familyId,
      actorKind: author ? author.kind : ActorKind.SYSTEM,
      actorId: author ? author.actorId : null,
      type: 'message_sent',
      payload: { conversationId: conv.id, messageId: message.id, type: MessageType.CARD, card: card.kind },
    });
    return message.id;
  }
}
