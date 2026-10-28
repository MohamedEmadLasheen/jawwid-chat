import { Controller, Get, Param, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ActionLogService } from './action-log.service';
import { SelfService } from '../platform/permissions/route-access';

/** PD-35 B7: a staff member's action log. Behind the global bearer guard; who may read it is ActionLogService's. */
@Controller()
@UseFilters(CommErrorFilter)
export class ActionLogController {
  constructor(private readonly log: ActionLogService) {}

  /**
   * ?from&to (ISO) &cursor (opaque, the page before's nextCursor)
   *
   * PD-40: self-service, like /staff-profiles/:staffId -- every staff member
   * reads their own log; ActionLogService.list decides the rest (their
   * department's manager, the super admin) and answers anyone else not found.
   */
  @SelfService()
  @Get('staff/:id/action-log')
  list(
    @ActorId() actorId: string,
    @Param('id') staffId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.log.list(actorId, staffId, { from, to, cursor });
  }
}
