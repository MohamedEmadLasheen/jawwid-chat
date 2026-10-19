import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { LifecycleService } from './lifecycle.service';
import { SupervisionService } from './supervision.service';

/**
 * PD-11 T3: transfers, suspensions and the Teacher Supervision section. Behind
 * the global bearer guard; who may do what is decided in the services ->
 * AuthorizationService / chat.transfer_learner. POST for every change.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class LifecycleController {
  constructor(
    private readonly lifecycle: LifecycleService,
    private readonly supervision: SupervisionService,
  ) {}

  @Post('learners/:id/transfer')
  transfer(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lifecycle.transfer(actorId, id, body ?? {});
  }

  @Get('learners/:id/transfers')
  transfers(@ActorId() actorId: string, @Param('id') id: string) {
    return this.lifecycle.transfers(actorId, id);
  }

  @Post('learners/:id/suspensions')
  suspend(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lifecycle.suspend(actorId, id, body ?? {});
  }

  /** `?kind=temporary|permanent&status=active|ended` -- the paused and the stopped lists. */
  @Get('suspensions')
  suspensions(@ActorId() actorId: string, @Query('kind') kind?: string, @Query('status') status?: string) {
    return this.lifecycle.list(actorId, { kind, status });
  }

  @Post('suspensions/:id/extend')
  extend(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lifecycle.extend(actorId, id, body ?? {});
  }

  @Post('suspensions/:id/end')
  end(@ActorId() actorId: string, @Param('id') id: string) {
    return this.lifecycle.end(actorId, id);
  }

  @Get('teachers/:id/supervision')
  timeline(@ActorId() actorId: string, @Param('id') id: string) {
    return this.supervision.timeline(actorId, id);
  }

  @Post('teachers/:id/supervision')
  addEntry(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.supervision.addEntry(actorId, id, body ?? {});
  }

  @Post('teachers/:id/bonus')
  bonus(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.supervision.bonus(actorId, id, body ?? {});
  }

  @Get('teachers/:id/supervision-chat')
  supervisionChat(@ActorId() actorId: string, @Param('id') id: string) {
    return this.supervision.supervisionChat(actorId, id);
  }
}
