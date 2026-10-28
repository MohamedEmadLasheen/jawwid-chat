import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { SupervisorCoverService } from './supervisor-cover.service';
import { Requires, SelfService } from '../platform/permissions/route-access';

/**
 * PD-33 "Hand over to backup". Behind the global bearer guard; who may do what
 * is decided in SupervisorCoverService -> AuthorizationService.canManageCover.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class SupervisorCoverController {
  constructor(private readonly covers: SupervisorCoverService) {}

  /** The confirm screen: eligible backups and what would move. */
  @Requires('org.covers')
  @Get('org/covers/preview')
  preview(@ActorId() actorId: string, @Query('supervisorId') supervisorId?: string, @Query('backupId') backupId?: string) {
    return this.covers.preview(actorId, { supervisorId, backupId });
  }

  @Requires('org.covers')
  @Get('org/covers')
  list(@ActorId() actorId: string, @Query('active') active?: string) {
    return this.covers.list(actorId, { active });
  }

  @Requires('org.covers')
  @Post('org/covers')
  start(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.covers.start(actorId, body ?? {});
  }

  @Requires('org.covers')
  @Post('org/covers/:id/extend')
  extend(@ActorId() actorId: string, @Param('id') id: string) {
    return this.covers.extend(actorId, id);
  }

  @Requires('org.covers')
  @Post('org/covers/:id/end')
  end(@ActorId() actorId: string, @Param('id') id: string) {
    return this.covers.end(actorId, id);
  }

  /** The signed-in staff member's own cover state ("I'm away", "Covering for ..."). */
  @SelfService()
  @Get('me/cover')
  mine(@ActorId() actorId: string) {
    return this.covers.mine(actorId);
  }
}
