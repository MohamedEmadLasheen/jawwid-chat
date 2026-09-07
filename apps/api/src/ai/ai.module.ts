import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { CommunicationModule } from '../communication/communication.module';
import { AI_PROVIDER } from './ai.tokens';
import { AiInvocationService } from './ai-invocation.service';
import { AnthropicAiProvider } from './provider/anthropic.provider';
import { DisabledAiProvider } from './provider/disabled.provider';
import { KnowledgeService } from './knowledge/knowledge.service';
import { FaqService } from './knowledge/faq.service';
import { FaqController, KnowledgeController } from './api/knowledge.controller';
import { SuggestionService } from './suggestions/suggestion.service';
import { SuggestionController, SummaryController } from './api/suggestion.controller';
import { SummaryService } from './summaries/summary.service';
import { RiskDetectionService } from './risk/risk-detection.service';
import { AttentionService } from './risk/attention.service';
import { RiskSweeper } from './risk/risk.sweeper';
import { AttentionController } from './api/attention.controller';

/**
 * The AI intelligence layer.
 *
 * It depends on PlatformModule -- authorization, scope, config, audit -- and
 * PlatformModule depends on nothing here. That direction is the whole point of
 * Phase 7: governance does not consult the assistant, the assistant is subject
 * to governance.
 */
@Module({
  // CommunicationModule, and never the other way round. The assistant reaches
  // the send pipeline; the send pipeline knows nothing about the assistant.
  imports: [PlatformModule, CommunicationModule],
  controllers: [KnowledgeController, FaqController, SuggestionController, SummaryController, AttentionController],
  providers: [
    // The real provider when the environment supplies a key, an honestly
    // disabled one otherwise -- the same pattern as OBJECT_STORAGE and
    // PUSH_PROVIDER, so a developer with no Anthropic account still gets a
    // working process (§28).
    {
      provide: AI_PROVIDER,
      useClass: AnthropicAiProvider.isConfigured() ? AnthropicAiProvider : DisabledAiProvider,
    },
    AiInvocationService,
    KnowledgeService,
    FaqService,
    SuggestionService,
    SummaryService,
    RiskDetectionService,
    AttentionService,
    RiskSweeper,
  ],
  exports: [AI_PROVIDER, AiInvocationService, KnowledgeService, FaqService, SuggestionService, SummaryService, RiskDetectionService, AttentionService, RiskSweeper],
})
export class AiModule {}
