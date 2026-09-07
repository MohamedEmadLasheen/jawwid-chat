import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import {
  AiFailure,
  aiFailed,
  type AiProvider,
  type AiRequest,
  type AiResult,
} from './ai-provider';
import { containmentClause, newNonce, renderBlocks } from './untrusted';

/** Phase 7 29. Every one of these is a ceiling, and every ceiling has a default. */
const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_000;
/**
 * The input ceiling, in characters rather than tokens, checked BEFORE the
 * request leaves this process. Characters because it costs nothing to measure
 * and the point is a cheap backstop against an unbounded conversation, not an
 * accurate token count. Callers do the real context selection (30); this only
 * guarantees that a caller which gets that wrong fails locally instead of
 * sending a megabyte of somebody's family history to a third party.
 */
const DEFAULT_MAX_INPUT_CHARS = 60_000;

/**
 * The Anthropic adapter.
 *
 * ## Why this asks for JSON rather than using structured outputs
 *
 * The SDK exposes schema-constrained generation on its beta surface. This uses
 * the GA endpoint and validates the answer here instead, for two reasons.
 * First, Phase 7 43 requires this code to validate and reject model output
 * whatever the provider promised -- so the validator exists either way, and a
 * second mechanism upstream would only decide how often it fires, never
 * whether it is needed. Second, the seam is supposed to survive a provider
 * swap; a beta parameter shape is the least portable thing available.
 *
 * Malformed output is therefore an ordinary, tested outcome (INVALID_OUTPUT)
 * rather than an exception, and every caller already has a fallback for it.
 */
@Injectable()
export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly log = new Logger(AnthropicAiProvider.name);
  private readonly client: Anthropic;
  private readonly model = process.env.AI_MODEL || DEFAULT_MODEL;
  private readonly maxInputChars = Number(process.env.AI_MAX_INPUT_CHARS ?? DEFAULT_MAX_INPUT_CHARS);
  private readonly maxOutputTokens = Number(
    process.env.AI_MAX_OUTPUT_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS,
  );

  static isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: Number(process.env.AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
      // Bounded, and bounded HERE rather than in a loop of our own. Phase 7 29
      // forbids uncontrolled recursive retries; the SDK retries 408/409/429/5xx
      // this many times and then gives up, which is the whole retry policy.
      maxRetries: Number(process.env.AI_MAX_RETRIES ?? DEFAULT_MAX_RETRIES),
    });
  }

  isEnabled(): boolean {
    return true;
  }

  async complete<T>(request: AiRequest<T>): Promise<AiResult<T>> {
    const nonce = newNonce();
    const untrusted = renderBlocks(request.untrusted, nonce);

    if (untrusted.length > this.maxInputChars) {
      return aiFailed<T>(
        AiFailure.INPUT_TOO_LARGE,
        `context of ${untrusted.length} chars exceeds the ${this.maxInputChars} limit`,
      );
    }

    // The order matters. System prompt, then the containment clause, then the
    // data, then the instruction LAST -- so the final thing the model reads is
    // ours, not a parent's.
    const system = `${request.system}\n\n${containmentClause(nonce)}`;
    const userContent = [
      untrusted,
      '',
      request.instruction,
      '',
      'Reply with a single JSON object and nothing else. No prose, no markdown fences.',
    ].join('\n');

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: Math.min(request.maxOutputTokens ?? this.maxOutputTokens, this.maxOutputTokens),
        system,
        messages: [{ role: 'user', content: userContent }],
      });
    } catch (error) {
      return aiFailed<T>(this.classify(error), this.describe(error));
    }

    if (response.stop_reason === 'refusal') {
      return aiFailed<T>(AiFailure.REFUSED, 'the provider declined this request');
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const parsed = extractJson(text);
    if (parsed === undefined) {
      // Deliberately does not log `text`: it is a function of somebody's
      // conversation, and 27/31 keep that out of the logs.
      this.log.warn(`[${request.feature}] output was not JSON`);
      return aiFailed<T>(AiFailure.INVALID_OUTPUT, 'response was not a JSON object');
    }

    const validated = request.schema.safeParse(parsed);
    if (!validated.success) {
      this.log.warn(`[${request.feature}] output failed schema: ${validated.error.issues[0]?.path.join('.')}`);
      return aiFailed<T>(AiFailure.INVALID_OUTPUT, 'response did not match the required schema');
    }

    return {
      ok: true,
      value: validated.data,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  private classify(error: unknown): AiFailure {
    if (error instanceof Anthropic.APIConnectionTimeoutError) return AiFailure.TIMEOUT;
    if (error instanceof Anthropic.RateLimitError) return AiFailure.RATE_LIMITED;
    if (error instanceof Anthropic.AuthenticationError) return AiFailure.DISABLED;
    return AiFailure.ERROR;
  }

  /** Never includes the request body, which contains conversation content. */
  private describe(error: unknown): string {
    if (error instanceof Anthropic.APIError) return `provider error ${error.status ?? ''}`.trim();
    return 'provider call failed';
  }
}

/**
 * Pulls the JSON object out of a text response.
 *
 * Tolerates the two things a model does even when told not to: wrapping the
 * object in ```json fences, and adding a sentence before it. Anything else is
 * rejected, which is the point -- this is a lenient READER, not a repair shop.
 */
export function extractJson(text: string): unknown {
  const withoutFences = text.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
