import { Body, Controller, Get, Param, Patch, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { CommErrorFilter } from '../../communication/api/http-exception.filter';
import { RateLimited } from '../../platform/auth/action-throttle.guard';
import { ActionScope } from '../../platform/auth/throttle.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { FaqService } from '../knowledge/faq.service';

/**
 * Approved knowledge management (§36) and the grounded FAQ (§6).
 *
 * Every route resolves the actor from the session and checks the permission in
 * the SERVICE. Nothing here trusts a field on the request to say who is asking
 * or what they may do (§32).
 */
@Controller('ai/knowledge')
@UseFilters(CommErrorFilter)
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly faq: FaqService,
  ) {}

  @Get()
  async list(
    @ActorId() actorId: string,
    @Query('status') status?: string,
    @Query('locale') locale?: string,
    @Query('category') category?: string,
  ) {
    return { articles: await this.knowledge.list(actorId, { status, locale, category }) };
  }

  @Get(':id')
  async get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.knowledge.get(actorId, id);
  }

  @Get(':id/revisions')
  async revisions(@ActorId() actorId: string, @Param('id') id: string) {
    return { revisions: await this.knowledge.revisions(actorId, id) };
  }

  @Post()
  async create(
    @ActorId() actorId: string,
    @Body()
    body: {
      title: string;
      question: string;
      answer: string;
      category?: string;
      locale?: string;
      reason: string;
    },
  ) {
    return this.knowledge.create(actorId, body, body.reason);
  }

  @Patch(':id')
  async update(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      question?: string;
      answer?: string;
      category?: string;
      locale?: string;
      reason: string;
    },
  ) {
    return this.knowledge.update(actorId, id, body, body.reason);
  }

  /** Publish. knowledge.approve, which an admin does not hold. */
  @Post(':id/approve')
  async approve(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.knowledge.approve(actorId, id, body.reason);
  }

  /** Retire without deleting, so answers that cited it still resolve. */
  @Post(':id/retire')
  async retire(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.knowledge.retire(actorId, id, body.reason);
  }
}

@Controller('ai/faq')
@UseFilters(CommErrorFilter)
export class FaqController {
  constructor(private readonly faq: FaqService) {}

  /**
   * Ask the assistant.
   *
   * Always 200, even when the assistant declines: "a person needs to answer
   * this" is a successful outcome of this endpoint, not an error, and a client
   * that had to distinguish an HTTP failure from a refusal to guess would get
   * it wrong in the direction of showing nothing.
   */
  @RateLimited(ActionScope.AI_GENERATE)
  @Post()
  async ask(
    @ActorId() actorId: string,
    @Body() body: { question: string; locale?: string },
  ) {
    return this.faq.ask(actorId, body.question ?? '', body.locale ?? 'ar');
  }
}
