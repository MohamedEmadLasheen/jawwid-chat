import { Injectable } from '@nestjs/common';
import { AiFailure, aiFailed, type AiProvider, type AiRequest, type AiResult } from './ai-provider';

/**
 * The provider used when no credentials are configured.
 *
 * It reports DISABLED rather than throwing, and `isEnabled()` is false so most
 * callers never reach it at all. This is what makes Phase 7 28 true by
 * construction: a deployment with no ANTHROPIC_API_KEY runs the communication
 * engine exactly as it ran before Phase 7 -- managers write their own replies,
 * moderation still holds group messages, reminders still go out -- and the only
 * difference is that the assistant surfaces say they are unavailable.
 *
 * Compare DisabledCallRecorder, which THROWS. The difference is deliberate and
 * it is about what a silent failure would cost. A recording that silently does
 * not happen leaves participants believing they were recorded and the academy
 * believing it holds an artefact. A suggestion that does not appear costs a
 * manager one unwritten draft, and they were always going to be the one to
 * decide what gets sent.
 */
@Injectable()
export class DisabledAiProvider implements AiProvider {
  readonly name = 'disabled';

  isEnabled(): boolean {
    return false;
  }

  async complete<T>(_request: AiRequest<T>): Promise<AiResult<T>> {
    return aiFailed<T>(AiFailure.DISABLED, 'no AI provider is configured');
  }
}
