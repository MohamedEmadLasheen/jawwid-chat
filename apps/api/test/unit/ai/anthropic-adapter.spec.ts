import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AnthropicAiProvider } from '../../../src/ai/provider/anthropic.provider';
import { AiFailure, AiFeature } from '../../../src/ai/provider/ai-provider';

/**
 * The Anthropic adapter, exercised without a live provider.
 *
 * No ANTHROPIC_API_KEY exists in this environment and none is invented, so a
 * real call is not made and is not claimed. What CAN be verified locally is
 * everything between the SDK boundary and this system: how a response is
 * parsed, and how each failure the SDK raises is classified. Those are the
 * parts a live call would exercise incidentally and that a wrong mapping would
 * break silently -- a rate limit reported as ERROR looks like a bug rather than
 * a budget, and an auth failure reported as ERROR hides a missing key.
 *
 * The client is replaced rather than the network mocked: the seam under test is
 * `complete()`, not the SDK's transport.
 */
function providerWith(clientBehaviour: () => unknown) {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-credential';
  const provider = new AnthropicAiProvider();
  (provider as unknown as { client: unknown }).client = {
    messages: { create: async () => clientBehaviour() },
  };
  return provider;
}

const REQUEST = {
  feature: AiFeature.SUMMARY,
  system: 'system',
  instruction: 'instruction',
  untrusted: [{ label: 'conversation', text: 'hello' }],
  schema: z.object({ answer: z.string() }),
};

/** instanceof works without knowing each SDK error's constructor signature. */
const asError = <T>(ctor: new (...args: never[]) => T): T => Object.create(ctor.prototype) as T;

afterAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('the Anthropic adapter', () => {
  it('is configured only when a key is present', () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(AnthropicAiProvider.isConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'k';
    expect(AnthropicAiProvider.isConfigured()).toBe(true);
    process.env.ANTHROPIC_API_KEY = previous;
  });

  it('parses a well-formed response into a validated value with usage', async () => {
    const provider = providerWith(() => ({
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"answer":"ok"}' }],
      usage: { input_tokens: 11, output_tokens: 22 },
    }));

    const result = await provider.complete(REQUEST);

    expect(result).toEqual({
      ok: true,
      value: { answer: 'ok' },
      model: 'claude-opus-5',
      usage: { inputTokens: 11, outputTokens: 22 },
    });
  });

  it('joins multiple text blocks and ignores non-text ones', async () => {
    const provider = providerWith(() => ({
      model: 'm',
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text: '{"answer":' },
        { type: 'text', text: '"split"}' },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const result = await provider.complete(REQUEST);
    expect(result.ok && result.value).toEqual({ answer: 'split' });
  });

  it('rejects a response that does not satisfy the schema', async () => {
    const provider = providerWith(() => ({
      model: 'm',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"answer": 42}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const result = await provider.complete(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe(AiFailure.INVALID_OUTPUT);
  });

  it('treats a provider refusal as REFUSED, not as an error', async () => {
    const provider = providerWith(() => ({
      model: 'm',
      stop_reason: 'refusal',
      content: [],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const result = await provider.complete(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe(AiFailure.REFUSED);
  });

  it('classifies each SDK failure as the thing an operator would act on', async () => {
    const cases: Array<[unknown, AiFailure]> = [
      [asError(Anthropic.APIConnectionTimeoutError), AiFailure.TIMEOUT],
      [asError(Anthropic.RateLimitError), AiFailure.RATE_LIMITED],
      // A bad or missing key is DISABLED, not ERROR: the operator action is to
      // supply a credential, and every caller already degrades on DISABLED.
      [asError(Anthropic.AuthenticationError), AiFailure.DISABLED],
      [new Error('socket hang up'), AiFailure.ERROR],
    ];

    for (const [thrown, expected] of cases) {
      const provider = providerWith(() => {
        throw thrown;
      });
      const result = await provider.complete(REQUEST);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure).toBe(expected);
    }
  });

  it('never puts request content into the failure detail', async () => {
    const provider = providerWith(() => {
      throw asError(Anthropic.RateLimitError);
    });
    const result = await provider.complete(REQUEST);
    // The detail is surfaced and logged; a conversation must not travel with it.
    if (!result.ok) expect(result.detail).not.toContain('hello');
  });

  it('refuses oversized context BEFORE anything leaves the process', async () => {
    let called = false;
    process.env.AI_MAX_INPUT_CHARS = '50';
    const provider = providerWith(() => {
      called = true;
      return {};
    });
    const result = await provider.complete({
      ...REQUEST,
      untrusted: [{ label: 'conversation', text: 'x'.repeat(5_000) }],
    });
    delete process.env.AI_MAX_INPUT_CHARS;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe(AiFailure.INPUT_TOO_LARGE);
    // The point of a local ceiling: a caller that got context selection wrong
    // fails here rather than sending a megabyte of family history to a vendor.
    expect(called).toBe(false);
  });
});
