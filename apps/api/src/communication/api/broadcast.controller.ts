import { Body, Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { BroadcastService } from '../broadcast/broadcast.service';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { RateLimited } from '../../platform/auth/action-throttle.guard';
import { ActionScope } from '../../platform/auth/throttle.service';
import { CommErrorFilter } from './http-exception.filter';
import type { AudienceClause } from '../audience/audience-resolver.service';

/**
 * Broadcast.
 *
 * Every route here returns in bounded time. Creating a broadcast resolves the
 * audience and writes the ledger; QUEUEING hands it to the workers and returns
 * immediately. No request in this controller waits for a delivery.
 */
@Controller('broadcasts')
@UseFilters(CommErrorFilter)
export class BroadcastController {
  constructor(private readonly broadcasts: BroadcastService) {}

  @Get()
  async list(@ActorId() actorId: string) {
    return { broadcasts: await this.broadcasts.list(actorId) };
  }

  /**
   * "How many people would this reach?" -- answered by the SAME resolver that
   * will do the delivery, so the preview cannot disagree with the send.
   */
  @Post('preview')
  async preview(@ActorId() actorId: string, @Body() body: { audiences: AudienceClause[] }) {
    return this.broadcasts.preview(actorId, body.audiences ?? []);
  }

  @Post()
  async create(
    @ActorId() actorId: string,
    @Body()
    body: { title?: string; body: string; audiences: AudienceClause[]; idempotencyKey?: string },
  ) {
    return this.broadcasts.create(actorId, {
      title: body.title,
      body: body.body,
      audiences: body.audiences ?? [],
      idempotencyKey: body.idempotencyKey,
    });
  }

  @RateLimited(ActionScope.BROADCAST_SEND)
  @Post(':id/queue')
  async queue(@ActorId() actorId: string, @Param('id') id: string) {
    return this.broadcasts.queue(id, actorId);
  }

  @Post(':id/cancel')
  async cancel(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.broadcasts.cancel(id, actorId, body?.reason ?? '');
  }

  @Get(':id')
  async status(@ActorId() actorId: string, @Param('id') id: string) {
    return this.broadcasts.status(id, actorId);
  }
}
