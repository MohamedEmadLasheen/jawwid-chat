import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ConversationSummary } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { Permission } from '../../platform/rbac/permissions';
import { IDENTITY_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import { ConversationService } from '../../communication/conversations/conversation.service';
import { IdentityAwareService } from '../identity-aware.service';
import { AiInvocationService } from '../ai-invocation.service';
import { AiFeature } from '../provider/ai-provider';
import { buildTranscript } from '../context/transcript';

const SummaryOutput = z.object({
  problem: z.string(),
  whatWasDone: z.string(),
  pendingAction: z.string(),
  importantHistory: z.string(),
  /** Phase 7 §13, structurally separate from the four sections. */
  inferences: z.array(z.string()),
});

const SYSTEM = [
  'You summarise a conversation between a family and staff at Jawwid, a',
  'tutoring academy, for the member of staff who is about to handle it.',
  '',
  '## Sections',
  '',
  'Problem            what the family originally needed or complained about.',
  'What was done      what staff actually did, in order.',
  'Pending action     what is still owed, and by whom. Say "nothing outstanding"',
  '                   if that is true. Do not invent a next step to fill it.',
  'Important history  earlier promises, repeated issues, anything a new handler',
  '                   would be wrong not to know.',
  '',
  '## Facts and inferences',
  '',
  'The four sections contain ONLY what the conversation states. If you conclude',
  'something the conversation does not say -- that the family sounds ready to',
  'leave, that a teacher probably forgot -- it goes in `inferences`, phrased as',
  'your reading, and NOT in the sections. A reader must be able to trust the',
  'sections as the record.',
  '',
  'If a section cannot be filled from the conversation, say so plainly rather',
  'than guessing. "The conversation does not say" is a useful summary line.',
  '',
  'If the transcript is marked as having earlier messages not shown, do not',
  'describe the start of the story with confidence you do not have.',
  '',
  'Be brief. Write in the language the conversation is mostly in.',
].join('\n');

export interface SummaryResult {
  readonly summary: ConversationSummary | null;
  /** True when this came from cache rather than a fresh consultation. */
  readonly cached: boolean;
  readonly aiGenerated: true;
}

/**
 * Conversation summaries.
 *
 * Authorization is delegated, not re-derived: `requireForActor` is the same
 * call the thread view makes, so there is no way to summarise a conversation
 * you could not open, and no second definition of "may read" to drift from the
 * first (§14, §32).
 */
@Injectable()
export class SummaryService extends IdentityAwareService {
  constructor(
    prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) identity: IdentityService,
    private readonly conversations: ConversationService,
    private readonly ai: AiInvocationService,
    private readonly config: AppConfigService,
  ) {
    super(prisma, identity);
  }

  async summarize(
    actorId: string,
    conversationId: string,
    options: { refresh?: boolean } = {},
  ): Promise<SummaryResult> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.AI_USE);
    const conv = await this.conversations.requireForActor(conversationId, actor.actorId);

    const currentSeq = conv.lastSeq ?? BigInt(0);

    // The cache. A summary is reusable exactly while the conversation has not
    // advanced past the message it was built from -- a comparison, not a
    // guess about elapsed time. A summary of a thread that has since moved on
    // is worse than none, because it reads as current.
    if (!options.refresh) {
      const cached = await this.prisma.conversationSummary.findFirst({
        where: { conversationId: conv.id, upToSeq: currentSeq },
        orderBy: { createdAt: 'desc' },
      });
      if (cached) return { summary: cached, cached: true, aiGenerated: true };
    }

    if (!(await this.ai.isEnabled())) return unavailable();

    const limit = Number(await this.config.get('ai.summary_context_messages'));
    // Internal notes INCLUDED: a summary is read only by staff, and one that
    // omitted what colleagues recorded would answer "what was done" with half
    // the story. The read authorization above already established this actor
    // may see this conversation.
    const transcript = await buildTranscript(this.prisma, conv.id, limit, {
      includeInternal: true,
    });
    if (transcript.messages.length === 0) return unavailable();

    const result = await this.ai.run(
      { actorId: actor.actorId, conversationId: conv.id },
      {
        feature: AiFeature.SUMMARY,
        system: SYSTEM,
        schema: SummaryOutput,
        untrusted: [{ label: 'conversation', text: transcript.text }],
        instruction: [
          'Summarise the conversation above.',
          '',
          'Return JSON: {"problem": string, "whatWasDone": string,',
          '"pendingAction": string, "importantHistory": string,',
          '"inferences": array of strings}.',
          '',
          'All four sections are required. Use "The conversation does not say"',
          'rather than leaving one empty or inventing content for it.',
        ].join('\n'),
        maxOutputTokens: 1_500,
      },
    );

    if (!result.ok) return unavailable();
    const out = result.value;

    // A section the model left blank is not a summary section. Rejecting here
    // rather than storing an empty string keeps "pendingAction" -- the line a
    // manager acts on -- from silently becoming absent.
    if (
      !out.problem.trim() ||
      !out.whatWasDone.trim() ||
      !out.pendingAction.trim() ||
      !out.importantHistory.trim()
    ) {
      return unavailable();
    }

    const summary = await this.prisma.conversationSummary.create({
      data: {
        conversationId: conv.id,
        generatedBy: actor.actorId,
        problem: out.problem.trim(),
        whatWasDone: out.whatWasDone.trim(),
        pendingAction: out.pendingAction.trim(),
        importantHistory: out.importantHistory.trim(),
        inferences: out.inferences.map((i) => i.trim()).filter(Boolean),
        upToSeq: currentSeq,
        model: result.model,
      },
    });

    return { summary, cached: false, aiGenerated: true };
  }
}

const unavailable = (): SummaryResult => ({ summary: null, cached: false, aiGenerated: true });
