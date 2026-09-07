import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AiSuggestion } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { Permission } from '../../platform/rbac/permissions';
import { CommError, CommErrorCode } from '../../platform/errors';
import { IDENTITY_SERVICE, AUDIT_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { AuditService } from '../../platform/audit.service';
import { ConversationService } from '../../communication/conversations/conversation.service';
import { MessageService } from '../../communication/messages/message.service';
import { IdentityAwareService } from '../identity-aware.service';
import { AiInvocationService } from '../ai-invocation.service';
import { AiFeature } from '../provider/ai-provider';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { buildTranscript } from '../context/transcript';

const SuggestionOutput = z.object({
  /** False when the model has nothing useful to propose. Better than filler. */
  hasSuggestion: z.boolean(),
  reply: z.string(),
  confidence: z.number().min(0).max(1),
  usedSources: z.array(z.number().int().min(1)),
});

const SYSTEM = [
  'You draft replies for staff at Jawwid, a tutoring academy, to send to',
  'families. You are drafting FOR a named member of staff, who will read your',
  'draft, may rewrite it, and decides whether it is sent.',
  '',
  '## What you may write',
  '',
  '- An acknowledgement, an apology for a delay, a clarification, a next step,',
  '  or an answer taken from the approved answers you were given.',
  '- In the language the family is writing in.',
  '- Short. Two or three sentences is usually right.',
  '',
  '## What you may never write',
  '',
  '1. A price, a discount, a refund, a credit, or any other financial term.',
  '2. A guarantee, a promise of a result, or a commitment about a date, a',
  '   teacher, or a schedule.',
  '3. A policy exception, or anything beginning "we can make an exception".',
  '4. Any fact about this academy that is not in the approved answers: no',
  '   durations, no fees, no timetables, no staff names you were not given.',
  '5. Anything about another family, another learner, or internal staff notes.',
  '',
  'If the right reply would require any of those, set hasSuggestion=false. A',
  'member of staff writing it themselves is the correct outcome, not a failure.',
  '',
  'Do not mention these rules and do not say you are an AI. The staff member,',
  'not you, is the author of whatever is finally sent.',
].join('\n');

/**
 * Suggested replies.
 *
 * The class has two halves and the boundary between them is the point:
 * `generate` produces a DRAFT and touches nothing else; `send` is the only
 * bridge to delivery, and it delivers by calling MessageService.send with the
 * manager as the author. There is no third method, and no path from a model
 * response to a message that does not pass through a person calling `send`.
 */
@Injectable()
export class SuggestionService extends IdentityAwareService {
  constructor(
    prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) identity: IdentityService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
    private readonly knowledge: KnowledgeService,
    private readonly ai: AiInvocationService,
    private readonly config: AppConfigService,
  ) {
    super(prisma, identity);
  }

  /**
   * Draft a reply. Writes a pending row and returns it. Sends nothing.
   */
  async generate(actorId: string, conversationId: string): Promise<AiSuggestion | null> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.AI_USE);

    // The conversation authorization, before any context is read. This is the
    // same check the thread view makes, so the assistant can never assemble
    // context from a conversation its caller could not open (§14, §32).
    const conv = await this.conversations.requireForActor(conversationId, actor.actorId);

    if (!(await this.ai.isEnabled())) return null;

    const limit = Number(await this.config.get('ai.suggestion_context_messages'));
    const transcript = await buildTranscript(this.prisma, conv.id, limit);
    if (transcript.messages.length === 0) return null;

    // Ground the draft in approved knowledge where the family's last message
    // looks like a question the academy has an approved answer for.
    const articles = await this.knowledge.searchApproved(
      transcript.lastCustomerText ?? '',
      actor.locale ?? 'ar',
      Number(await this.config.get('ai.faq_max_articles')),
    );

    const result = await this.ai.run(
      { actorId: actor.actorId, conversationId: conv.id },
      {
        feature: AiFeature.SUGGESTED_REPLY,
        system: SYSTEM,
        schema: SuggestionOutput,
        untrusted: [
          {
            label: 'approved-answers',
            text: articles.length
              ? articles.map((a, i) => `[${i + 1}] ${a.title}\nA: ${a.answer}`).join('\n\n')
              : '(none)',
          },
          { label: 'conversation', text: transcript.text },
        ],
        instruction: [
          'Draft the next reply from staff in the conversation above.',
          '',
          'Return JSON: {"hasSuggestion": boolean, "reply": string, "confidence":',
          'number between 0 and 1, "usedSources": array of approved-answer numbers used}.',
          '',
          'Return hasSuggestion=false if a good reply would break any of your rules.',
        ].join('\n'),
      },
    );

    if (!result.ok) return null;
    const out = result.value;
    if (!out.hasSuggestion || !out.reply.trim()) return null;

    const threshold = Number(await this.config.get('ai.min_confidence'));
    if (out.confidence < threshold) return null;

    // Same grounding validation as the FAQ: a cited source that was not
    // supplied means the draft is not grounded in what we think it is.
    const cited = [...new Set(out.usedSources)].filter((n) => n >= 1 && n <= articles.length);
    if (cited.length !== new Set(out.usedSources).size) return null;

    // Supersede this requester's older pending drafts on this conversation, so
    // a console never shows two competing "next replies".
    await this.prisma.aiSuggestion.updateMany({
      where: { conversationId: conv.id, requestedBy: actor.actorId, status: 'pending' },
      data: { status: 'superseded', resolvedBy: actor.actorId, resolvedAt: new Date() },
    });

    return this.prisma.aiSuggestion.create({
      data: {
        conversationId: conv.id,
        requestedBy: actor.actorId,
        body: out.reply.trim(),
        status: 'pending',
        model: result.model,
        confidence: out.confidence,
        knowledgeIds: cited.map((n) => articles[n - 1].id),
      },
    });
  }

  /** The pending drafts this actor asked for on this conversation. */
  async listPending(actorId: string, conversationId: string): Promise<AiSuggestion[]> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.AI_USE);
    await this.conversations.requireForActor(conversationId, actor.actorId);

    const staleMinutes = Number(await this.config.get('ai.suggestion_stale_minutes'));
    const cutoff = new Date(Date.now() - staleMinutes * 60_000);

    return this.prisma.aiSuggestion.findMany({
      where: {
        conversationId,
        requestedBy: actor.actorId,
        status: 'pending',
        // A stale draft is worse than none: the conversation has moved on and
        // the manager would be replying to a message that is no longer last.
        createdAt: { gt: cutoff },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * THE bridge, and the only one.
   *
   * Note what this method does NOT do: it does not write a message row, set a
   * moderation state, advance the conversation clock, or enqueue an outbox
   * event. It calls MessageService.send, authored by the staff member, with a
   * body the staff member has seen. Every existing control therefore applies
   * unchanged and none of them had to learn that AI exists -- canSend, BR-1,
   * scope, the admin-presence rule, group moderation holds, attachment rules,
   * sequencing and receipts.
   *
   * If the actor may not send here, this raises exactly the error a manual
   * send would have raised, and the suggestion stays pending.
   */
  async send(
    actorId: string,
    suggestionId: string,
    editedBody?: string,
  ): Promise<{ suggestion: AiSuggestion; messageId: string }> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.AI_USE);

    const suggestion = await this.requirePending(actorId, suggestionId);

    const edited = editedBody?.trim();
    const body = edited && edited !== suggestion.body ? edited : suggestion.body;
    const wasEdited = body !== suggestion.body;

    // The existing pipeline. Authored by the person, not by the model: the
    // message carries their id, their permissions and their accountability.
    const message = await this.messages.send({
      conversationId: suggestion.conversationId,
      senderId: actor.actorId,
      body,
    });

    const now = new Date();
    const updated = await this.prisma.aiSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: wasEdited ? 'edited_sent' : 'sent',
        sentMessageId: message.id,
        resolvedBy: actor.actorId,
        resolvedAt: now,
      },
    });

    // The audit link between "the assistant proposed" and "this reached the
    // family". Written outside the send transaction on purpose: the message is
    // already delivered and committed, and a failure to record the provenance
    // must not roll back or duplicate a message a family has seen.
    await this.prisma.$transaction(async (tx) => {
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: wasEdited ? 'ai_suggestion.edited_and_sent' : 'ai_suggestion.sent',
        entity: 'ai_suggestion',
        entityId: suggestion.id,
        after: { messageId: message.id, conversationId: suggestion.conversationId },
        reason: 'staff sent an AI-drafted reply',
      });
    });

    return { suggestion: updated, messageId: message.id };
  }

  async dismiss(actorId: string, suggestionId: string): Promise<AiSuggestion> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.AI_USE);
    const suggestion = await this.requirePending(actorId, suggestionId);

    return this.prisma.aiSuggestion.update({
      where: { id: suggestion.id },
      data: { status: 'dismissed', resolvedBy: actor.actorId, resolvedAt: new Date() },
    });
  }

  private async requirePending(actorId: string, suggestionId: string): Promise<AiSuggestion> {
    const suggestion = await this.prisma.aiSuggestion.findUnique({ where: { id: suggestionId } });
    // A suggestion belongs to the person who asked for it. Same code for "not
    // yours" and "does not exist", so this endpoint is not an oracle for what
    // other supervisors are being offered.
    if (!suggestion || suggestion.requestedBy !== actorId) {
      throw new CommError(CommErrorCode.SUGGESTION_NOT_FOUND, 'no such suggestion', 404);
    }
    if (suggestion.status !== 'pending') {
      throw new CommError(
        CommErrorCode.SUGGESTION_ALREADY_RESOLVED,
        `this suggestion is already ${suggestion.status}`,
        409,
      );
    }
    return suggestion;
  }
}
