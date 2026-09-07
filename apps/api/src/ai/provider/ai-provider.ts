import type { ZodType } from 'zod';
import type { UntrustedBlock } from './untrusted';

/**
 * The AI features. Every invocation names one, so cost, latency, failure rate
 * and rate limits are all attributable to a feature rather than to "AI".
 */
export const AiFeature = {
  FAQ: 'faq',
  SUGGESTED_REPLY: 'suggested_reply',
  SUMMARY: 'summary',
  RISK_DETECTION: 'risk_detection',
} as const;
export type AiFeature = (typeof AiFeature)[keyof typeof AiFeature];

/**
 * Why an invocation did not produce a value.
 *
 * These are RESULTS, not exceptions. Phase 7 28: AI is an enhancement, and an
 * enhancement that throws into the communication engine is a single point of
 * failure wearing a different hat. Every caller gets a value it can branch on
 * and degrade from.
 */
export const AiFailure = {
  /** No provider is configured. The ordinary state of a dev machine. */
  DISABLED: 'disabled',
  TIMEOUT: 'timeout',
  RATE_LIMITED: 'rate_limited',
  /** The model answered, but the answer did not satisfy the schema (43). */
  INVALID_OUTPUT: 'invalid_output',
  /** The request exceeded the input budget before it was sent (29). */
  INPUT_TOO_LARGE: 'input_too_large',
  /** The provider declined. Not an error in this system. */
  REFUSED: 'refused',
  ERROR: 'error',
} as const;
export type AiFailure = (typeof AiFailure)[keyof typeof AiFailure];

export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type AiResult<T> =
  | { readonly ok: true; readonly value: T; readonly model: string; readonly usage: AiUsage }
  | { readonly ok: false; readonly failure: AiFailure; readonly detail: string };

export const aiFailed = <T>(failure: AiFailure, detail: string): AiResult<T> => ({
  ok: false,
  failure,
  detail,
});

/**
 * One request.
 *
 * Note the shape: `system` and `instruction` are OURS, `untrusted` is
 * everybody else's, and the two never arrive through the same field. A caller
 * cannot accidentally interpolate a parent's message into the system prompt,
 * because there is no string concatenation at the call site to do it in.
 */
export interface AiRequest<T> {
  readonly feature: AiFeature;
  /** Trusted. Written by us, in this repository. */
  readonly system: string;
  /** Trusted. The task, stated after the untrusted content has been presented. */
  readonly instruction: string;
  /** Untrusted. Conversation text, knowledge bodies, names. */
  readonly untrusted: readonly UntrustedBlock[];
  /** The shape the answer must take. Enforced twice: at generation, and on the way back. */
  readonly schema: ZodType<T>;
  readonly maxOutputTokens?: number;
}

/**
 * THE seam.
 *
 * Everything above the provider -- FAQ, suggestions, summaries, risk detection
 * -- depends on this interface and on nothing from any vendor SDK. Swapping
 * provider is a change to one `useClass` in AiModule.
 */
export interface AiProvider {
  readonly name: string;
  /** False when nothing is configured, so callers can skip the work entirely. */
  isEnabled(): boolean;
  complete<T>(request: AiRequest<T>): Promise<AiResult<T>>;
}
