import { signActorAvatar } from '../profile/avatar-urls';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, IDENTITY_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import type { ActorRef, IdentityService } from '../../platform/identity.service';
import { ConversationService } from '../conversations/conversation.service';
import { AttachmentService } from '../attachments/attachment.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import { messageAuthorRef, toMessageDto, MessageDto } from '../contracts/dto';
import { ActorKind, ApprovalDecision, Moderation, ReceiptState, Visibility } from '../contracts/vocab';

export interface PendingApprovalDto {
  approvalId: string;
  conversationId: string;
  messageId: string;
  requestedBy: string;
  approverId: string | null;
  createdAt: string;
  message: MessageDto;
}

/**
 * Message approval.
 *
 * The approver decides; the approver never edits. There is no code path here
 * that writes chat.message.body, and the database refuses such an update
 * outright (chat.forbid_message_rewrite). If a message is unacceptable, it is
 * rejected with a reason and the approver sends their own separate message.
 *
 * There is no expiry in MVP: a pending message stays pending until a human acts.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly attachments: AttachmentService,
    private readonly outbox: OutboxService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  /** The approval queue, scoped to what this actor is allowed to decide. */
  async listPending(actorId: string, conversationId?: string): Promise<PendingApprovalDto[]> {
    const actor = await this.conversations.requireActor(actorId);
    const decision = this.authz.canApprove(actor);
    if (!decision.allowed) {
      // Non-staff never see the queue at all.
      throw new CommError(decision.code, decision.reason);
    }

    // PD-8: the queue is bounded to the conversations this actor may access
    // BEFORE the cap (the same SQL scope every read uses), so another
    // supervisor's backlog can neither appear here nor starve this one.
    const now = new Date();
    const visible = await this.authz.visibleConversationIds(actor, now);
    const scope = conversationId ? visible.filter((id) => id === conversationId) : visible;
    if (scope.length === 0) return [];

    const rows = await this.prisma.messageApproval.findMany({
      where: {
        decision: ApprovalDecision.PENDING,
        conversationId: { in: scope },
        organizationId: actor.organizationId,
      },
      include: { message: { include: { attachments: true, reactions: true, receipts: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    // Only what this actor may also DECIDE: reading a supervisor's group as a
    // department manager or backup is enough; reading a 1:1 as its member is not
    // a group with a queue at all.
    const decidable = new Map<string, boolean>();
    for (const id of new Set(rows.map((r) => r.conversationId))) {
      const conv = await this.prisma.conversation.findUnique({ where: { id } });
      const basis = conv ? await this.conversations.staffAccess(actor, conv, now) : null;
      decidable.set(id, this.authz.canApprove(actor, basis).allowed);
    }

    return this.withSignedAttachments(rows.filter((r) => decidable.get(r.conversationId)), actor.actorId);
  }

  /** What the sender sees: their own pending/rejected messages with status. */
  async listMine(actorId: string): Promise<PendingApprovalDto[]> {
    const actor = await this.conversations.requireActor(actorId);
    const rows = await this.prisma.messageApproval.findMany({
      where: { requestedBy: actor.actorId },
      include: { message: { include: { attachments: true, reactions: true, receipts: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return this.withSignedAttachments(rows, actor.actorId);
  }

  /**
   * A held message is reviewed before it is published, so its attachments have
   * to be playable here: an approver cannot judge a voice note they cannot
   * hear. URLs are minted per read and expire, exactly as on the list path.
   */
  private async withSignedAttachments(
    rows: Array<{
      id: string;
      conversationId: string;
      messageId: string;
      requestedBy: string;
      approverId: string | null;
      createdAt: Date;
      message: Parameters<typeof toMessageDto>[0];
    }>,
    viewerId: string,
  ): Promise<PendingApprovalDto[]> {
    const signed = await this.attachments.signUrlsForMessages(rows.map((r) => r.messageId), viewerId);

    // Authors, in one batch for the whole queue — the same shape as the signed
    // URLs above and for the same reason. An approver is deciding about a
    // person's message, so "approve this from Umm Yusuf" is the question they are
    // actually answering; a role label would make two pending messages from two
    // different parents indistinguishable.
    const refs: ActorRef[] = [];
    for (const r of rows) {
      const ref = messageAuthorRef(r.message);
      if (ref) refs.push(ref);
    }
    const authors = await this.identity.resolveActors(refs);

    return rows.map((r) => ({
      approvalId: r.id,
      conversationId: r.conversationId,
      messageId: r.messageId,
      requestedBy: r.requestedBy,
      approverId: r.approverId,
      createdAt: r.createdAt.toISOString(),
      message: toMessageDto(r.message, signed, authors, (author) =>
        signActorAvatar(author, r.conversationId, viewerId),
      ),
    }));
  }

  async approve(approvalId: string, actorId: string): Promise<void> {
    await this.decide(approvalId, actorId, ApprovalDecision.APPROVED, null);
  }

  async reject(approvalId: string, actorId: string, reason: string): Promise<void> {
    if (!reason || reason.trim().length === 0) {
      throw new CommError(
        CommErrorCode.APPROVAL_REASON_REQUIRED,
        'a rejection must state a reason',
        400,
      );
    }
    await this.decide(approvalId, actorId, ApprovalDecision.REJECTED, reason);
  }

  private async decide(
    approvalId: string,
    actorId: string,
    decisionValue: string,
    reason: string | null,
  ): Promise<void> {
    const actor = await this.conversations.requireActor(actorId);

    const approval = await this.prisma.messageApproval.findUnique({
      where: { id: approvalId },
      include: { message: true },
    });
    if (!approval) {
      throw new CommError(CommErrorCode.MESSAGE_NOT_FOUND, 'approval not found', 404);
    }
    if (approval.decision !== ApprovalDecision.PENDING) {
      throw new CommError(
        CommErrorCode.APPROVAL_ALREADY_DECIDED,
        'this approval has already been decided',
        409,
      );
    }

    const conv = await this.conversations.requireConversation(approval.conversationId);
    // Deciding is acting on the conversation, so it is never wider than READING
    // it: tenant, staff scope and activity all apply. Without this a manager of
    // another organization could decide an approval by its id.
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const readable = await this.conversations.canReadResolved(actor, conv, membership);
    if (!readable.allowed) throw new CommError(readable.code, readable.reason);

    // PD-8: the approver is whoever is in charge of the group -- its children's
    // supervisor, their active backup or department manager, the super admin.
    const permitted = this.authz.canApprove(actor, await this.conversations.staffAccess(actor, conv));
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);

    const now = new Date();
    const approved = decisionValue === ApprovalDecision.APPROVED;

    await this.prisma.$transaction(async (tx) => {
      // RT-032: the approver is still live under lock, or this decision is
      // ordered before their deactivation commits.
      await this.conversations.assertActorLive(tx, actor);
      // CLAIM, don't overwrite. The PENDING check above ran outside this
      // transaction, so two decisions made at once (approve + reject, or two
      // approvals) could both pass it and both write -- publishing a message
      // that ends up rejected, or announcing it twice. Only the decision that
      // flips the row from PENDING proceeds; the other is told it was decided.
      const claimed = await tx.messageApproval.updateMany({
        where: { id: approvalId, decision: ApprovalDecision.PENDING },
        data: {
          decision: decisionValue,
          approverId: actor.actorId,
          decidedAt: now,
          rejectionReason: reason,
        },
      });
      if (claimed.count === 0) {
        throw new CommError(
          CommErrorCode.APPROVAL_ALREADY_DECIDED,
          'this approval has already been decided',
          409,
        );
      }

      await tx.message.update({
        where: { id: approval.messageId },
        data: { moderation: approved ? Moderation.PUBLISHED : Moderation.REJECTED },
      });

      if (approved) {
        // Now, and only now, does the message become deliverable. Its seq was
        // fixed at send time, so it lands in its original position.
        const members = await tx.conversationMember.findMany({
          where: { conversationId: conv.id, leftAt: null },
        });
        const recipients = members.filter((m) => m.actorId !== approval.requestedBy);
        if (recipients.length > 0) {
          await tx.messageReceipt.createMany({
            data: recipients.map((r) => ({
              messageId: approval.messageId,
              actorId: r.actorId,
              state: ReceiptState.SENT,
            })),
            skipDuplicates: true,
          });
        }

        const patch: Prisma.ConversationUpdateInput = { lastActivityAt: now };
        if (
          approval.message.visibility === Visibility.CUSTOMER &&
          approval.message.authorType === ActorKind.CONTACT
        ) {
          patch.lastCustomerMessageAt = approval.message.createdAt;
          patch.resolvedAt = null;
        }
        await tx.conversation.update({ where: { id: conv.id }, data: patch });

        await this.outbox.enqueue(tx, CommEvent.MESSAGE_CREATED, {
          conversationId: conv.id,
          messageId: approval.messageId,
          seq: approval.message.seq?.toString() ?? '0',
          authorKind: approval.message.authorType,
          authorId: approval.message.authorId,
          type: approval.message.type,
          visibility: approval.message.visibility,
          moderation: Moderation.PUBLISHED,
          createdAt: approval.message.createdAt.toISOString(),
        });
      }

      await this.outbox.enqueue(tx, CommEvent.APPROVAL_DECIDED, {
        conversationId: conv.id,
        messageId: approval.messageId,
        approvalId,
        decision: decisionValue,
        rejectionReason: reason,
      });

      // Every decision is auditable, and a rejection always carries its reason.
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: `message.${decisionValue}`,
        entity: 'message',
        entityId: approval.messageId,
        after: { decision: decisionValue },
        reason: reason ?? 'approved by active handler',
      });
    });
  }

  /** Approval history for a conversation, for the admin audit view. */
  async history(conversationId: string, actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const readable = await this.conversations.canReadResolved(actor, conv, membership);
    if (!readable.allowed) throw new CommError(readable.code, readable.reason);
    if (!this.authz.canReadInternal(actor)) {
      throw new CommError(CommErrorCode.CANNOT_APPROVE, 'approval history is staff-only');
    }

    const rows = await this.prisma.messageApproval.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      approvalId: r.id,
      messageId: r.messageId,
      requestedBy: r.requestedBy,
      approverId: r.approverId,
      decision: r.decision,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    }));
  }
}
