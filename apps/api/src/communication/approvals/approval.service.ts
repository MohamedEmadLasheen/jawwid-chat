import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { Permission } from '../../platform/rbac/permissions';
import { AUDIT_SERVICE, IDENTITY_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import type { IdentityService } from '../../platform/identity.service';
import { ConversationService } from '../conversations/conversation.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import { toMessageDto, type MessageViewer, MessageDto } from '../contracts/dto';
import {
  ActorKind,
  ApprovalDecision,
  MessageType,
  Moderation,
  ORGANIZATION_WIDE_STAFF_ROLES,
  ReceiptState,
  ScanStatus,
  Visibility,
} from '../contracts/vocab';
import { ModerationService, type ModerationFlagDto } from '../moderation/moderation.service';
import { ScopeService } from '../../platform/scope.service';
import { actorHasPermission, isFamilyFacingStaff } from '../../platform/types';
import type { Actor } from '../../platform/types';

export interface PendingApprovalDto {
  approvalId: string;
  conversationId: string;
  messageId: string;
  requestedBy: string;
  approverId: string | null;
  createdAt: string;
  message: MessageDto;

  // --- Phase 6: everything the queue card needs, in one round trip --------
  /** Who wrote it, by name. A queue that shows an opaque id is unreadable. */
  requestedByName: string | null;
  /** Which group or conversation, so the card can say where this happened. */
  conversationType: string;
  conversationTitle: string | null;
  familyId: string | null;
  /** policy = everything from this role is held here. scan = a rule matched. */
  trigger: string;
  highestSeverity: string | null;
  /** WHY, one entry per matched rule. Empty for a policy hold. */
  flags: ModerationFlagDto[];
  /** How long it has been waiting -- the queue's only meaningful ordering. */
  pendingForMs: number;
  escalatedAt: string | null;
  escalatedTo: string | null;
  /**
   * THE ORIGINAL SUBMITTED CONTENT, always.
   *
   * For an untouched message this is its body. For one an approver edited it
   * is chat.message_revision revision 1 -- the body it was SENT with. The
   * moderator therefore always sees what the sender actually wrote, whatever
   * happened to it afterwards, which is the whole of Phase 6 rule 5.
   */
  originalBody: string | null;
  /** Set only when an approver used EDIT THEN SEND. */
  editedAt: string | null;
  editedBy: string | null;
}

/**
 * Message moderation: the queue, and the four decisions that empty it.
 *
 * ## PHASE 6 SUPERSEDES THIS FILE'S ORIGINAL RULE, DELIBERATELY
 *
 * Until now this file said: "The approver decides; the approver never edits.
 * There is no code path here that writes chat.message.body, and the database
 * refuses such an update outright (chat.forbid_message_rewrite). If a message
 * is unacceptable, it is rejected with a reason and the approver sends their
 * own separate message."
 *
 * That was the MVP policy and it was a reasonable one. Phase 6 adds EDIT THEN
 * SEND, which is the operationally cheaper answer to the common case: a
 * teacher's message is fine except for the phone number in it, and rejecting
 * it costs the teacher a rewrite and the family a delay to remove eleven
 * digits.
 *
 * WHAT DID NOT CHANGE, AND THIS IS THE IMPORTANT PART. No backstop was
 * weakened to allow it. `chat.forbid_message_rewrite` still refuses any body
 * change that is not a STAMPED edit, because Phase 2 had already narrowed it
 * to admit exactly one -- and built `chat.message_revision`, whose revision 1
 * is "the body the message was SENT with", append-only, protected by its own
 * trigger. An approver's edit uses that same mechanism: the original is
 * written to revision 1 before the body is replaced, so it survives, and the
 * queue serves it as `originalBody` forever after.
 *
 * The four decisions, and what each preserves:
 *
 *   APPROVE        publishes the message unchanged.
 *   EDIT THEN SEND writes the original to revision 1, replaces the body,
 *                  publishes. Original, edited text, moderator and timestamp
 *                  all survive.
 *   REJECT         never sends it. The body is untouched, so the original is
 *                  the message row itself.
 *   DELETE         rejects AND soft-deletes through the existing deletion
 *                  architecture, which stamps rather than erases -- so the
 *                  approval row, the flags and the body all remain for audit.
 *
 * There is still no EXPIRY: a pending message stays pending until a human
 * acts. Past `moderation.escalation_hours` it is ESCALATED to a manager
 * (ModerationService.escalateOverdue), which changes who is accountable for it
 * and nothing else.
 */
/** The queue's filters. Each narrows the SAME scoped query, never a new one. */
export interface QueueFilter {
  /** A manager's view of what the ordinary queue already failed to clear. */
  escalatedOnly?: boolean;
  severity?: string;
  /** policy | scan. */
  trigger?: string;
}

type ApprovalRow = Prisma.MessageApprovalGetPayload<{
  include: {
    message: { include: { attachments: true; reactions: true; receipts: true } };
    conversation: { select: { type: true; title: true; familyId: true } };
  };
}>;

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly scope: ScopeService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    private readonly moderation: ModerationService,
    private readonly config: AppConfigService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /**
   * The approval queue, scoped BY CONSTRUCTION.
   *
   * What this used to do (red-team A-2): with no `conversationId` it returned
   * every pending approval IN THE SYSTEM -- held messages from families the
   * caller does not supervise, with their full body, to any family-facing
   * staff member. Moderation was the one queue nobody had scoped.
   *
   * It now filters on the same conversation predicate every list uses, so a
   * held message can only appear to somebody who could have read it anyway.
   */
  async listPending(
    actorId: string,
    conversationId?: string,
    options: QueueFilter = {},
  ): Promise<PendingApprovalDto[]> {
    const actor = await this.conversations.requireActor(actorId);
    // Non-staff never see the queue at all. The scope argument is omitted
    // deliberately: this is the ROLE gate, and the records are narrowed below.
    const decision = this.authz.canApprove(actor, actor.actorId);
    if (!decision.allowed && !ORGANIZATION_WIDE_STAFF_ROLES.has(actor.staffRole ?? '')) {
      throw new CommError(decision.code, decision.reason);
    }

    const visible = await this.scope.conversationWhere(actor);
    const take = await this.config.get('moderation.queue_page_size');

    const rows = await this.prisma.messageApproval.findMany({
      where: {
        decision: ApprovalDecision.PENDING,
        conversation: visible,
        ...(conversationId ? { conversationId } : {}),
        // ESCALATED-ONLY is a manager's filter on the same queue rather than a
        // second endpoint: one query, one set of scope rules, no chance of the
        // two drifting apart on who may see what.
        ...(options.escalatedOnly ? { escalatedAt: { not: null } } : {}),
        ...(options.severity ? { highestSeverity: options.severity } : {}),
        ...(options.trigger ? { triggerSource: options.trigger } : {}),
      },
      include: {
        message: { include: { attachments: true, reactions: true, receipts: true } },
        conversation: { select: { type: true, title: true, familyId: true } },
      },
      // ESCALATED FIRST, THEN OLDEST FIRST.
      //
      // NOT by severity. The approvals design is explicit that "time pending is
      // the only ordering that matters, because a teacher is waiting on every
      // one of them", and sorting a queue by severity buries the low-severity
      // item that has been waiting since this morning under every new critical
      // one. Severity is on the card, and it is a FILTER above; it is not the
      // order. Escalation is the single exception, because an escalated item is
      // by definition one the ordering already failed.
      orderBy: [{ escalatedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
      take,
    });

    return this.enrich(rows, actor);
  }

  /**
   * What the SENDER sees: their own held and rejected messages.
   *
   * Deliberately not enriched with flags. A teacher learns the outcome of
   * moderation -- waiting, or not sent and why -- and not which detection
   * patterns the academy runs: publishing those to the people being detected
   * would be telling them exactly how to word their way past them. The
   * rejection reason, which a human wrote for them, is what they get.
   */
  async listMine(actorId: string): Promise<PendingApprovalDto[]> {
    const actor = await this.conversations.requireActor(actorId);
    const rows = await this.prisma.messageApproval.findMany({
      where: { requestedBy: actor.actorId },
      include: {
        message: { include: { attachments: true, reactions: true, receipts: true } },
        conversation: { select: { type: true, title: true, familyId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return this.enrich(rows, actor, { withFlags: false });
  }

  /**
   * Assemble the queue DTOs.
   *
   * Three lookups for the whole page, never one per row: the flags, the
   * original bodies, and the sender names. A queue of 200 held messages that
   * issued 600 queries would be a page nobody opens twice.
   */
  private async enrich(
    rows: ApprovalRow[],
    actor: Actor,
    opts: { withFlags?: boolean } = {},
  ): Promise<PendingApprovalDto[]> {
    if (rows.length === 0) return [];
    const withFlags = opts.withFlags ?? true;
    const now = Date.now();
    const messageIds = rows.map((r) => r.messageId);

    const flags = withFlags
      ? await this.moderation.flagsFor(messageIds)
      : new Map<string, ModerationFlagDto[]>();

    // Revision 1 is "the body the message was SENT with", written lazily on the
    // first edit. Its ABSENCE therefore means the message was never edited, and
    // the body on the row still is the original.
    const originals = await this.prisma.messageRevision.findMany({
      where: { messageId: { in: messageIds }, revision: 1 },
      select: { messageId: true, body: true },
    });
    const originalBody = new Map(originals.map((r) => [r.messageId, r.body]));

    const names = await this.resolveNames([
      ...new Set(rows.map((r) => r.requestedBy)),
    ]);

    return rows.map((r) => ({
      approvalId: r.id,
      conversationId: r.conversationId,
      messageId: r.messageId,
      requestedBy: r.requestedBy,
      approverId: r.approverId,
      createdAt: r.createdAt.toISOString(),
      message: toMessageDto(r.message, undefined, viewerOf(actor)),

      requestedByName: names.get(r.requestedBy) ?? null,
      conversationType: r.conversation.type,
      conversationTitle: r.conversation.title,
      familyId: r.conversation.familyId,
      trigger: r.triggerSource,
      highestSeverity: r.highestSeverity,
      flags: flags.get(r.messageId) ?? [],
      pendingForMs: Math.max(0, now - r.createdAt.getTime()),
      escalatedAt: r.escalatedAt?.toISOString() ?? null,
      escalatedTo: r.escalatedTo,
      originalBody: originalBody.get(r.messageId) ?? r.message.body,
      editedAt: r.editedAt?.toISOString() ?? null,
      editedBy: r.editedBy,
    }));
  }

  private async resolveNames(actorIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    await Promise.all(
      actorIds.map(async (id) => {
        const resolved = await this.identity.resolveActor(id);
        if (resolved) names.set(id, resolved.displayName);
      }),
    );
    return names;
  }

  async approve(approvalId: string, actorId: string): Promise<void> {
    await this.decide(approvalId, actorId, ApprovalDecision.APPROVED, null);
  }

  /**
   * EDIT THEN SEND -- fix the message and release it, in one act.
   *
   * The common case this exists for: a teacher's message is entirely fine
   * except for the phone number in it. Rejecting costs the teacher a rewrite
   * and the family a delay, to remove eleven digits that the approver is
   * already looking at.
   *
   * ## What is preserved, and how
   *
   *   THE ORIGINAL   written to chat.message_revision revision 1 before the
   *                  body is replaced -- the same append-only mechanism
   *                  Phase 2 built for an author's own edit, whose trigger
   *                  refuses UPDATE and DELETE outright. The queue serves it
   *                  as `originalBody` from then on.
   *   THE EDIT       the body on the message, plus edited_at / edited_by on
   *                  BOTH the message (who last changed it) and the approval
   *                  (that this decision was an edit).
   *   THE DECISION   the approval row: approver, decision, timestamp.
   *   THE REASON     the flags, untouched. Why it was held survives the fix.
   *
   * ## The edited body is scanned again
   *
   * An approver who removes one of two phone numbers has not fixed the
   * message. Re-scanning is what stops the edit path from being the single
   * route by which unscanned content reaches a family -- and a moderator being
   * told "this still contains a phone number" is a better outcome than the
   * family receiving it. The rescan is refused, not held: this approver is
   * present and can fix it now.
   */
  async editThenSend(
    approvalId: string,
    actorId: string,
    body: string,
    reason?: string,
  ): Promise<void> {
    const edited = (body ?? '').trim();
    if (edited === '') {
      throw new CommError(
        CommErrorCode.EMPTY_MESSAGE,
        'an edited message needs a body; use reject to refuse it instead',
        400,
      );
    }
    const maxLength = await this.config.get('communication.message_max_length');
    if (edited.length > maxLength) {
      throw new CommError(
        CommErrorCode.MESSAGE_TOO_LONG,
        `a message may be at most ${maxLength} characters`,
        400,
      );
    }
    await this.decide(approvalId, actorId, ApprovalDecision.APPROVED, reason ?? null, edited);
  }

  /**
   * DELETE a held message.
   *
   * Two things, in one transaction, and neither is a new deletion mechanism:
   *
   *   1. the approval is REJECTED, so the message reaches a terminal state and
   *      can never be sent by a later approve;
   *   2. the message is soft-deleted through the columns
   *      MessageService.deleteForEveryone writes -- deleted_at, deleted_by,
   *      deleted_for_all, redacted_reason.
   *
   * The body is NOT erased, because the existing deletion architecture does not
   * erase it: it stamps the row and the read path stops serving it. That is
   * what makes this safe to offer on a moderation queue at all -- the approval,
   * the flags and the original text all survive, so "what did the teacher write
   * that was deleted, and who deleted it" stays answerable.
   *
   * Gated on `messages.delete`, which manager and super_admin hold and an admin
   * does not. Deciding a message is an admin's job; destroying its delivery
   * entirely is not, and the permission key already drew that line.
   */
  async deleteHeld(approvalId: string, actorId: string, reason: string): Promise<void> {
    if (!reason || reason.trim().length === 0) {
      throw new CommError(
        CommErrorCode.APPROVAL_REASON_REQUIRED,
        'deleting a held message must state a reason',
        400,
      );
    }
    await this.decide(
      approvalId,
      actorId,
      ApprovalDecision.REJECTED,
      reason.trim(),
      undefined,
      true,
    );
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

  /**
   * THE one place a moderation decision is made. Every action routes here, so
   * the authorization, the audit and the realtime fan-out cannot be right for
   * approve and wrong for edit-then-send.
   *
   * @param editedBody set only by editThenSend
   * @param alsoDelete set only by deleteHeld
   */
  private async decide(
    approvalId: string,
    actorId: string,
    decisionValue: string,
    reason: string | null,
    editedBody?: string,
    alsoDelete = false,
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
    // The approver is the family's active handler, resolved through AI #1's
    // coverage engine - coverage logic is never duplicated here.
    const activeHandler = await this.conversations.activeHandler(conv);

    const permitted = this.authz.canApprove(
      actor,
      activeHandler,
      await this.conversations.scopeFor(actor, conv),
    );
    if (!permitted.allowed) throw new CommError(permitted.code, permitted.reason);

    // Deleting is a strictly stronger act than deciding, and the permission
    // model already drew that line: `messages.delete` is manager and above.
    // Checked HERE, on the server, and not merely by hiding the control.
    if (alsoDelete && !actorHasPermission(actor, Permission.MESSAGES_DELETE)) {
      throw new CommError(
        CommErrorCode.PERMISSION_DENIED,
        `deleting a held message requires ${Permission.MESSAGES_DELETE}`,
      );
    }

    // A non-text message has no body to edit. Refused rather than silently
    // dropping the attachment and sending the caption.
    if (editedBody !== undefined && approval.message.type !== MessageType.TEXT) {
      throw new CommError(
        CommErrorCode.MESSAGE_NOT_EDITABLE,
        `a ${approval.message.type} message has no editable body; approve or reject it`,
        400,
      );
    }

    // THE EDITED BODY IS SCANNED AGAIN, before anything is written. An approver
    // who removed one of two phone numbers has not fixed the message, and this
    // is the one path that could otherwise put unscanned text in front of a
    // family.
    if (editedBody !== undefined) {
      const rescan = await this.moderation.scanBody(actor, editedBody);
      if (rescan.status === ScanStatus.FLAGGED) {
        throw new CommError(
          CommErrorCode.MODERATION_EDIT_STILL_FLAGGED,
          `the edited message still matches ${rescan.reasons.join(', ')}; ` +
            'edit it again or reject the message',
          409,
        );
      }
    }

    const now = new Date();
    const approved = decisionValue === ApprovalDecision.APPROVED;

    await this.prisma.$transaction(async (tx) => {
      await tx.messageApproval.update({
        where: { id: approvalId },
        data: {
          decision: decisionValue,
          approverId: actor.actorId,
          decidedAt: now,
          rejectionReason: reason,
          ...(editedBody !== undefined ? { editedAt: now, editedBy: actor.actorId } : {}),
        },
      });

      if (editedBody !== undefined) {
        // Revision 1 is THE BODY THE MESSAGE WAS SENT WITH -- written here,
        // before the body is replaced, exactly as MessageService.edit does it.
        // chat.message_revision refuses UPDATE and DELETE, so once this row
        // exists the teacher's original words cannot be removed by anyone.
        //
        // `editCount === 0` cannot be assumed: a message held for approval was
        // never editable by its author (canEditMessage refuses a pending one),
        // but writing the revision number from the row rather than from that
        // assumption costs nothing and survives the assumption changing.
        await tx.messageRevision.create({
          data: {
            messageId: approval.messageId,
            revision: approval.message.editCount + 1,
            body: approval.message.body,
            replacedBy: actor.actorId,
            replacedAt: now,
          },
        });
      }

      await tx.message.update({
        where: { id: approval.messageId },
        data: {
          moderation: approved ? Moderation.PUBLISHED : Moderation.REJECTED,
          // A body change MUST advance edited_at and carry edited_by, or
          // chat.forbid_message_rewrite refuses the whole statement. The
          // backstop is not being worked around here -- it is being satisfied,
          // which is the only way this file is allowed to change a body at all.
          ...(editedBody !== undefined
            ? {
                body: editedBody,
                editedAt: now,
                editedBy: actor.actorId,
                editCount: { increment: 1 },
              }
            : {}),
          // The existing deletion architecture, unchanged: stamp, never erase.
          // The body stays on the row and the read path stops serving it, so
          // the moderation record remains complete.
          ...(alsoDelete
            ? {
                deletedAt: now,
                deletedBy: actor.actorId,
                deletedForAll: true,
                redactedReason: reason,
              }
            : {}),
        },
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
        // message.created carries no body, so an edited message would reach a
        // client that then fetched it and got the edited text anyway. The
        // update event is emitted so a client holding the thread open sees the
        // edit stamp and the count, exactly as it would for an author's edit.
        if (editedBody !== undefined) {
          await this.outbox.enqueue(tx, CommEvent.MESSAGE_UPDATED, {
            conversationId: conv.id,
            messageId: approval.messageId,
            seq: approval.message.seq?.toString() ?? null,
            body: editedBody,
            editedAt: now.toISOString(),
            editCount: approval.message.editCount + 1,
          });
        }
      }

      if (alsoDelete) {
        await this.outbox.enqueue(tx, CommEvent.MESSAGE_DELETED, {
          conversationId: conv.id,
          messageId: approval.messageId,
          deletedForAll: true,
        });
      }

      await this.outbox.enqueue(tx, CommEvent.APPROVAL_DECIDED, {
        conversationId: conv.id,
        messageId: approval.messageId,
        approvalId,
        decision: decisionValue,
        rejectionReason: reason,
        edited: editedBody !== undefined,
      });

      // Every decision is auditable, and a rejection always carries its reason.
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: alsoDelete ? 'message.moderation_deleted' : `message.${decisionValue}`,
        entity: 'message',
        entityId: approval.messageId,
        after: {
          decision: decisionValue,
          edited: editedBody !== undefined,
          deleted: alsoDelete,
          trigger: approval.triggerSource,
          highestSeverity: approval.highestSeverity,
          // Whether it had been escalated is part of the decision's story: a
          // manager clearing an escalated backlog is a different fact from a
          // supervisor clearing their own queue.
          wasEscalated: approval.escalatedAt !== null,
        },
        reason: reason ?? 'approved by active handler',
      });

      if (editedBody !== undefined) {
        // A SEPARATE audit row for the edit itself, mirroring
        // MessageService.edit's `message.edited`. The bodies are in
        // chat.message_revision; this records that a MODERATOR replaced one,
        // which `message.approved` alone would not say.
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'message.moderation_edited',
          entity: 'message',
          entityId: approval.messageId,
          after: { revision: approval.message.editCount + 1, approvalId },
          reason: reason ?? 'edited by the approver before sending',
        });
        await this.audit.event(tx, {
          familyId: conv.familyId,
          actorKind: actor.kind,
          actorId: actor.actorId,
          type: 'message_moderation_edited',
          // Deliberately no body: message contents never enter the event log.
          payload: { messageId: approval.messageId, approvalId },
        });
      }
    });
  }

  /** Approval history for a conversation, for the admin audit view. */
  async history(conversationId: string, actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const readable = this.authz.canRead(
      actor,
      conv,
      membership,
      await this.conversations.scopeFor(actor, conv),
    );
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

/**
 * RT-012 / A-7. A held message carries the same receipt roster as any other,
 * and the sender of a held message is usually a teacher or a parent -- exactly
 * the people who must not be handed Jawwid's internal actor ids.
 */
function viewerOf(actor: Actor): MessageViewer {
  return { actorId: actor.actorId, seesFullRoster: isFamilyFacingStaff(actor) };
}
