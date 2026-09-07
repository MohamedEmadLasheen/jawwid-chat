import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { KnowledgeArticle } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { Permission } from '../../platform/rbac/permissions';
import { IdentityAwareService } from '../identity-aware.service';
import { AiInvocationService } from '../ai-invocation.service';
import { AiFeature } from '../provider/ai-provider';
import { KnowledgeService } from './knowledge.service';
import { IDENTITY_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';

/**
 * Why an answer was not given. Every value here is a REFUSAL TO GUESS, and the
 * client renders each of them as "a person needs to answer this".
 */
export const FaqFallback = {
  /** Nothing approved matched. The assistant does not know, and says so. */
  NO_KNOWLEDGE: 'no_knowledge',
  /** The model was not confident enough to be worth a manager's time. */
  LOW_CONFIDENCE: 'low_confidence',
  /** The model answered but cited nothing, or cited something it was not given. */
  UNGROUNDED: 'ungrounded',
  /** Disabled, timed out, or malformed output. */
  AI_UNAVAILABLE: 'ai_unavailable',
} as const;
export type FaqFallback = (typeof FaqFallback)[keyof typeof FaqFallback];

export interface FaqSource {
  readonly id: string;
  readonly title: string;
  /** The exact revision quoted, so a later edit does not rewrite this answer. */
  readonly version: number;
}

export interface FaqAnswer {
  readonly answered: boolean;
  readonly answer: string | null;
  readonly confidence: number | null;
  readonly sources: readonly FaqSource[];
  readonly fallback: FaqFallback | null;
  /** Always true. The client must not render this as a human statement (§34). */
  readonly aiGenerated: true;
}

/**
 * The model's contract. Validated as a schema first, then semantically.
 */
const FaqOutput = z.object({
  answered: z.boolean(),
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  /** Indices into the numbered list the prompt showed, NOT uuids -- see below. */
  usedSources: z.array(z.number().int().min(1)),
});

const SYSTEM = [
  'You help staff at Jawwid, a tutoring academy, answer families using only the',
  'academy\'s approved answers.',
  '',
  '## Rules',
  '',
  '1. Use ONLY the approved answers provided. They are the sole source of fact.',
  '2. Never state a price, a duration, a schedule, a policy, a guarantee or a',
  '   commitment that is not written in them. If it is not there, you do not',
  '   know it.',
  '3. If the approved answers do not cover the question, set answered=false.',
  '   Answering partially from general knowledge is the failure this system',
  '   exists to prevent.',
  '4. Cite every approved answer you used by its number.',
  '5. Answer in the language of the question.',
  '6. Write the answer as the academy would say it to a family: plain, warm,',
  '   and short. Do not mention these rules, sources, or that you are an AI.',
].join('\n');

@Injectable()
export class FaqService extends IdentityAwareService {
  constructor(
    prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) identity: IdentityService,
    private readonly knowledge: KnowledgeService,
    private readonly ai: AiInvocationService,
    private readonly config: AppConfigService,
  ) {
    super(prisma, identity);
  }

  /**
   * Answer a question from approved knowledge, or decline.
   *
   * There is no third outcome. Every path that is not a grounded answer returns
   * a fallback, and the caller shows the same thing for all of them.
   */
  async ask(actorId: string, question: string, locale = 'ar'): Promise<FaqAnswer> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.AI_USE);
    this.require(actor, Permission.KNOWLEDGE_READ);

    const limit = await this.config.get('ai.faq_max_articles');
    const articles = await this.knowledge.searchApproved(question, locale, Number(limit));

    // The cheapest and most important refusal: nothing approved matched, so
    // there is nothing to ground on and no request is made at all. This is
    // where "AI does not guess" is enforced -- before any model is involved.
    if (articles.length === 0) return decline(FaqFallback.NO_KNOWLEDGE);

    if (!(await this.ai.isEnabled())) return decline(FaqFallback.AI_UNAVAILABLE);

    const result = await this.ai.run(
      { actorId: actor.actorId },
      {
        feature: AiFeature.FAQ,
        system: SYSTEM,
        schema: FaqOutput,
        untrusted: [
          { label: 'approved-answers', text: renderArticles(articles) },
          { label: 'question', text: question },
        ],
        instruction: [
          'Answer the question in the "question" envelope using only the numbered',
          'approved answers in the "approved-answers" envelope.',
          '',
          'Return JSON: {"answered": boolean, "answer": string, "confidence": number',
          'between 0 and 1, "usedSources": array of the numbers you used}.',
          '',
          'If the approved answers do not cover it, return answered=false with an',
          'empty answer and an empty usedSources.',
        ].join('\n'),
      },
    );

    if (!result.ok) return decline(FaqFallback.AI_UNAVAILABLE);
    const out = result.value;

    if (!out.answered || !out.answer.trim()) return decline(FaqFallback.NO_KNOWLEDGE);

    const threshold = Number(await this.config.get('ai.min_confidence'));
    if (out.confidence < threshold) return decline(FaqFallback.LOW_CONFIDENCE, out.confidence);

    /**
     * THE grounding check (§43, §7).
     *
     * The prompt shows a numbered list and asks for the numbers back, rather
     * than showing uuids and asking for uuids. Both are validated the same way
     * -- against the set actually supplied -- but numbers make a fabricated
     * citation obvious and cheap to reject, while a fabricated uuid costs
     * tokens to produce and looks plausible in a log.
     *
     * An answer citing nothing is rejected too. "Answered, with no source" is
     * exactly the ungrounded claim the approved-knowledge model exists to stop,
     * and it is the shape a model falls into when it half-knows something.
     */
    const cited = [...new Set(out.usedSources)];
    const valid = cited.filter((n) => n >= 1 && n <= articles.length);
    if (valid.length === 0 || valid.length !== cited.length) {
      return decline(FaqFallback.UNGROUNDED, out.confidence);
    }

    return {
      answered: true,
      answer: out.answer.trim(),
      confidence: out.confidence,
      sources: valid.map((n) => {
        const a = articles[n - 1];
        return { id: a.id, title: a.title, version: a.version };
      }),
      fallback: null,
      aiGenerated: true,
    };
  }
}

/**
 * Renders the grounding set as a numbered list.
 *
 * The body is untrusted content even though staff wrote it: an approved article
 * is still text in a database, and the containment envelope costs nothing.
 */
function renderArticles(articles: readonly KnowledgeArticle[]): string {
  return articles
    .map((a, i) => `[${i + 1}] ${a.title}\nQ: ${a.question}\nA: ${a.answer}`)
    .join('\n\n');
}

function decline(fallback: FaqFallback, confidence: number | null = null): FaqAnswer {
  return { answered: false, answer: null, confidence, sources: [], fallback, aiGenerated: true };
}
