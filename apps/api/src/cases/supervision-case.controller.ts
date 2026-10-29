import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { SupervisionCaseService } from './supervision-case.service';
import { Requires } from '../platform/permissions/route-access';

/**
 * PD-35 B5: escalation cases. Behind the global bearer guard; who may open,
 * see and act is decided in SupervisionCaseService.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class SupervisionCaseController {
  constructor(private readonly cases: SupervisionCaseService) {}

  /** { subject: { kind, id }, target: 'teachers' | 'operations', title, body?, dueOn?, ownerId? } */
  @Requires('cases.manage')
  @Post('cases')
  open(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.cases.open(actorId, body ?? {});
  }

  /** ?tab=mine|opened|department &status=open|closed|all */
  @Requires('cases.view')
  @Get('cases')
  list(@ActorId() actorId: string, @Query('tab') tab?: string, @Query('status') status?: string) {
    return this.cases.list(actorId, { tab, status });
  }

  @Requires('cases.view')
  @Get('cases/:id')
  get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.cases.get(actorId, id);
  }

  @Requires('cases.view')
  @Get('cases/:id/owners')
  owners(@ActorId() actorId: string, @Param('id') id: string) {
    return this.cases.owners(actorId, id);
  }

  /** { ownerId } */
  @Requires('cases.manage')
  @Post('cases/:id/assign')
  assign(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.cases.assign(actorId, id, body ?? {});
  }

  /** { status: in_progress | resolved | cancelled, note? } */
  @Requires('cases.manage')
  @Post('cases/:id/status')
  status(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.cases.setStatus(actorId, id, body ?? {});
  }

  /** { dueOn: YYYY-MM-DD | null } */
  @Requires('cases.manage')
  @Post('cases/:id/due')
  due(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.cases.setDue(actorId, id, body ?? {});
  }

  /** { note } */
  @Requires('cases.manage')
  @Post('cases/:id/notes')
  note(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.cases.note(actorId, id, body ?? {});
  }
}
