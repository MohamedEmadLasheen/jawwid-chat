import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { TrialService } from './trial.service';

/**
 * PD-11 T4: trial lessons, prospects, the two trial facts, and the New
 * Students page. Behind the global bearer guard; who may do what is decided in
 * TrialService. POST for every change.
 */
@Controller('trials')
@UseFilters(CommErrorFilter)
export class TrialController {
  constructor(private readonly trials: TrialService) {}

  @Post('prospects')
  createProspect(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.trials.createProspect(actorId, body ?? {});
  }

  @Get('prospects')
  prospects(@ActorId() actorId: string) {
    return this.trials.prospects(actorId);
  }

  @Get('teachers')
  teachers(@ActorId() actorId: string) {
    return this.trials.teachers(actorId);
  }

  @Get('slots')
  slots(@ActorId() actorId: string, @Query('teacherId') teacherId: string, @Query('durationMinutes') durationMinutes?: string) {
    return this.trials.slots(actorId, teacherId, durationMinutes);
  }

  /** Open (create if needed) a teacher's trial group. Sales or the Teachers department. */
  @Post('teachers/:teacherId/group')
  openGroup(@ActorId() actorId: string, @Param('teacherId') teacherId: string) {
    return this.trials.openGroup(actorId, teacherId);
  }

  /** The calling teacher's own trial group. */
  @Post('my-group')
  openOwnGroup(@ActorId() actorId: string) {
    return this.trials.openOwnGroup(actorId);
  }

  @Get('new-students')
  newStudents(@ActorId() actorId: string) {
    return this.trials.newStudents(actorId);
  }

  @Get()
  list(@ActorId() actorId: string, @Query('from') from?: string, @Query('to') to?: string, @Query('teacherId') teacherId?: string) {
    return this.trials.list(actorId, { from, to, teacherId });
  }

  @Post()
  book(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.trials.book(actorId, body ?? {});
  }

  @Get(':id')
  get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.trials.get(actorId, id);
  }

  @Post(':id/attendance')
  attendance(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.trials.attendance(actorId, id, body ?? {});
  }

  @Post(':id/cancel')
  cancel(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.trials.cancel(actorId, id, body ?? {});
  }

  @Post(':id/outcome')
  outcome(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.trials.outcome(actorId, id, body ?? {});
  }
}

/** What "+" may offer the teacher in their trial group. Advisory. */
@Controller('conversations')
@UseFilters(CommErrorFilter)
export class TrialTicketsController {
  constructor(private readonly trials: TrialService) {}

  @Get(':id/trial-tickets')
  tickets(@ActorId() actorId: string, @Param('id') id: string) {
    return this.trials.ticketsFor(actorId, id);
  }
}
