import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { AI_PROVIDER } from './ai.tokens';
import {
  AiFailure,
  aiFailed,
  type AiProvider,
  type AiRequest,
  type AiResult,
} from './provider/ai-provider';

export interface AiInvocationContext {
  /** The person who asked. Null for background work, which asks on nobody's behalf. */
  readonly actorId?: string | null;
  readonly conversationId?: string | null;
}

/**
 * The ONE way the rest of the system reaches a model.
 *
 * No Phase 7 service injects AiProvider directly. They inject this, which means
 * three properties hold by construction rather than by everybody remembering:
 *
 *  1. every consultation is written to chat.ai_invocation (§27, §44);
 *  2. the `ai.enabled` kill switch is honoured on every path, including the
 *     ones added after the switch was written; and
 *  3. a disabled or failing provider produces a RESULT, never an exception
 *     escaping into the communication engine (§28).
 */
@Injectable()
export class AiInvocationService {
  private readonly log = new Logger(AiInvocationService.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Whether it is worth building a request at all.
   *
   * Callers check this before assembling context, so a disabled deployment does
   * not pay for reading a hundred messages it will not send anywhere.
   */
  async isEnabled(): Promise<boolean> {
    if (!this.provider.isEnabled()) return false;
    return (await this.config.get('ai.enabled')) === true;
  }

  async run<T>(ctx: AiInvocationContext, request: AiRequest<T>): Promise<AiResult<T>> {
    if (!(await this.isEnabled())) {
      const off = aiFailed<T>(AiFailure.DISABLED, 'AI is disabled');
      await this.record(ctx, request, off, 0);
      return off;
    }

    const started = Date.now();
    let result: AiResult<T>;
    try {
      result = await this.provider.complete(request);
    } catch (error) {
      // The provider contract says it returns failures rather than throwing.
      // This exists because a contract that is only documented is a contract
      // one future adapter breaks, and the thing it would break is the
      // communication engine.
      this.log.error(
        `provider threw for ${request.feature}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      result = aiFailed<T>(AiFailure.ERROR, 'provider threw');
    }
    await this.record(ctx, request, result, Date.now() - started);
    return result;
  }

  /**
   * Writes the audit row.
   *
   * Failing to record must not fail the operation: the alternative is that a
   * full disk or a lock timeout takes down the assistant, and an assistant that
   * is down because its own logging is down helps nobody. The failure is logged
   * loudly instead, because a silently unaudited AI layer is its own problem.
   */
  private async record<T>(
    ctx: AiInvocationContext,
    request: AiRequest<T>,
    result: AiResult<T>,
    latencyMs: number,
  ): Promise<void> {
    try {
      await this.prisma.aiInvocation.create({
        data: {
          feature: request.feature,
          actorId: ctx.actorId ?? null,
          conversationId: ctx.conversationId ?? null,
          provider: this.provider.name,
          model: result.ok ? result.model : null,
          status: result.ok ? 'ok' : result.failure,
          inputTokens: result.ok ? result.usage.inputTokens : null,
          outputTokens: result.ok ? result.usage.outputTokens : null,
          latencyMs,
        },
      });
    } catch (error) {
      this.log.error(
        `failed to record AI invocation: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
