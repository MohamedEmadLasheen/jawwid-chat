import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { CommErrorFilter } from '../../communication/api/http-exception.filter';
import { AttentionService } from '../risk/attention.service';

/**
 * The attention queue.
 *
 * Every route here reads or resolves a FLAG. None of them cancels a
 * subscription, suspends a learner or changes an account -- there is no such
 * route, and the service holds no dependency that could reach one (§18). A
 * manager who decides to act does so through the existing surfaces that already
 * authorize, audit and reason about those actions.
 */
@Controller('ai/attention')
@UseFilters(CommErrorFilter)
export class AttentionController {
  constructor(private readonly attention: AttentionService) {}

  @Get()
  async queue(
    @ActorId() actorId: string,
    @Query('riskType') riskType?: string,
    @Query('severity') severity?: string,
  ) {
    return { flags: await this.attention.queue(actorId, { riskType, severity }) };
  }

  /** "I have seen this and I am on it." Keeps it in the queue, off the unseen list. */
  @Post(':id/acknowledge')
  async acknowledge(@ActorId() actorId: string, @Param('id') id: string) {
    return this.attention.acknowledge(actorId, id);
  }

  @Post(':id/resolve')
  async resolve(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { note: string },
  ) {
    return this.attention.resolve(actorId, id, body?.note ?? 'handled');
  }

  /**
   * "This was not a real risk." Distinct from resolve because the dismissal
   * rate per risk type is what says whether the classifier earns its keep.
   */
  @Post(':id/dismiss')
  async dismiss(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { note: string },
  ) {
    return this.attention.dismiss(actorId, id, body?.note ?? 'not a real risk');
  }
}
