import { extractJson } from '../../../src/ai/provider/anthropic.provider';
import { DisabledAiProvider } from '../../../src/ai/provider/disabled.provider';
import { AiFailure, AiFeature } from '../../../src/ai/provider/ai-provider';
import { z } from 'zod';

describe('AI provider contract', () => {
  describe('the disabled provider', () => {
    const provider = new DisabledAiProvider();

    it('reports itself disabled rather than pretending to work', () => {
      expect(provider.isEnabled()).toBe(false);
    });

    it('RESOLVES with a failure instead of throwing (§28)', async () => {
      // The whole graceful-degradation guarantee rests on this one property:
      // no AI path can throw into the communication engine.
      const result = await provider.complete({
        feature: AiFeature.SUMMARY,
        system: 's',
        instruction: 'i',
        untrusted: [],
        schema: z.object({}),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure).toBe(AiFailure.DISABLED);
    });
  });

  describe('extractJson', () => {
    it('reads a bare object', () => {
      expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    });

    it('reads an object the model wrapped in fences or prose', () => {
      expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
      expect(extractJson('Here you go:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
    });

    it('returns undefined for output that is not an object', () => {
      // Each of these becomes AiFailure.INVALID_OUTPUT and a controlled
      // fallback (§43) rather than a crash or a half-parsed value.
      for (const bad of ['', 'I cannot help with that.', '{"a":', '[1,2,3]', '}{']) {
        expect(extractJson(bad)).toBeUndefined();
      }
    });
  });
});
