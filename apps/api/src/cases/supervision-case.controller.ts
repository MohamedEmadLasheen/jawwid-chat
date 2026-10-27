import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { SupervisionCaseService } from './supervision-case.service';

/**
 * PD-35 B5: escalation cases. Behind the global bearer guard; who may open,
 * see and act is decided in SupervisionCaseService.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class SupervisionCaseController {
  constructor(private readonly cases: SupervisionCaseService) {}

  /** { subject: { kind, id }, target: 'teachers' | 'operations', title, body?, dueOn?, ownerId? } */
  @Post('cases')
  open(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.cases.open(actorId, body ?? {});
  }

  /** ?tab=mine|opened|department &status=open|closed|all */
  @Get('cases')
  list(@ActorId() actorId: string, @Query('tab') tab?: string, @Query('status') status?: string) {
    return this.cases.list(actorId, { tab, status });
  }

  @Get('cases/:id')
  get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.cases.get(actorId, id);
  }

  @Get('cases/:id/owners')
  owners(@ActorId() actorId: string, @Param('id') id: string) {
    return this.cases.owners(actorId, id);
  }

  /** { ownerId } */
  @Post('cases/:id/assign')
  assign(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.cases.assign(actorId, id, body ?? {});
  }

  /** { status: in_progress | resolved | cancelled, note? } */
  @Post('cases/:id/status')
  status(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.cases.setStatus(actorId, id, body ?? {});
  }

  /** { dueOn: YYYY-MM-DD | null } */
  @Post('cases/:id/due')
  due(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.cases.setDue(actorId, id, body ?? {});
  }

  /** { note } */
  @Post('cases/:id/notes')
  note(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.cases.note(actorId, id, body ?? {});
  }
}
