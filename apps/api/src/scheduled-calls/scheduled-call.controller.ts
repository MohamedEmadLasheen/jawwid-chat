import { Body, Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { ActionScope, RateLimited } from '../platform/auth/action-throttle.guard';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ScheduledCallService } from './scheduled-call.service';
import { Requires } from '../platform/permissions/route-access';

/** PD-13: scheduled calls and members-only call links. */
@Controller('scheduled-calls')
@UseFilters(CommErrorFilter)
export class ScheduledCallController {
  constructor(private readonly scheduled: ScheduledCallService) {}

  /** `{ conversationId, kind?: 'scheduled' | 'link', startsAt?, title? }` -- posts its card. */
  @Requires('calls.use')
  @Post()
  create(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.scheduled.create(actorId, body ?? {});
  }

  /** The caller's open and coming calls, soonest first. */
  @Requires('calls.use')
  @Get()
  upcoming(@ActorId() actorId: string) {
    return this.scheduled.upcoming(actorId);
  }

  @Requires('calls.use')
  @Get(':id')
  get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.scheduled.get(actorId, id);
  }

  @Requires('calls.use')
  @Post(':id/cancel')
  cancel(@ActorId() actorId: string, @Param('id') id: string) {
    return this.scheduled.cancel(actorId, id);
  }

  /** `{ callId, conversationId, mode: 'started' | 'joined' }`. */
  @Requires('calls.use')
  @Post(':id/join')
  // Starts the call when nobody is in it yet, so it shares the call-start
  // budget with POST /calls rather than being a second way around it.
  @RateLimited(ActionScope.CALL_START)
  join(@ActorId() actorId: string, @Param('id') id: string) {
    return this.scheduled.join(actorId, id);
  }
}
