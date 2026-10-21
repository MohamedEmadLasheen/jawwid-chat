import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { TrialService } from './trial.service';
import { NewStudentEnrolmentService } from '../new-students/enrolment.service';

/**
 * PD-11 T4 and the trial journey: trial lessons, prospects, each trial's one
 * outcome, the trial group's membership, and the New Students page. Behind the global bearer guard; who may do what is decided in
 * TrialService. POST for every change.
 */
@Controller('trials')
@UseFilters(CommErrorFilter)
export class TrialController {
  constructor(
    private readonly trials: TrialService,
    private readonly enrolment: NewStudentEnrolmentService,
  ) {}

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

  /** The "+ -> Trial" card's context in one trial group: membership, permissions, trials. */
  @Get('groups/:conversationId')
  groupContext(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return this.trials.groupContext(actorId, conversationId);
  }

  /** A Sales supervisor joins a teacher's trial group. */
  @Post('groups/:conversationId/join')
  joinGroup(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return this.trials.joinGroup(actorId, conversationId);
  }

  /** A Sales supervisor leaves a teacher's trial group. */
  @Post('groups/:conversationId/leave')
  leaveGroup(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return this.trials.leaveGroup(actorId, conversationId);
  }

  /** PD-16: the page, filtered for the viewer, each entry with its setup state. */
  @Get('new-students')
  newStudents(@ActorId() actorId: string) {
    return this.enrolment.page(actorId);
  }

  /** PD-16: the Operations manager assigns the supervisor; Chat creates the family. */
  @Post('new-students/:trialId/assign')
  assignNewStudent(@ActorId() actorId: string, @Param('trialId') trialId: string, @Body() body: Record<string, unknown>) {
    return this.enrolment.assign(actorId, trialId, body ?? {});
  }

  /** PD-16: the responsible supervisor opens the family's group. */
  @Post('new-students/:trialId/group')
  createNewStudentGroup(@ActorId() actorId: string, @Param('trialId') trialId: string) {
    return this.enrolment.createGroup(actorId, trialId);
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

  /** The trial's one outcome: no_show, subscribed (with the form) or not_subscribed (with a reason). */
  @Post(':id/outcome')
  outcome(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.trials.outcome(actorId, id, body ?? {});
  }

  /** Sales corrects the outcome, saying why. */
  @Post(':id/correction')
  correct(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.trials.correct(actorId, id, body ?? {});
  }

  /** Sales changes a subscribed trial's form. */
  @Post(':id/subscription')
  updateSubscription(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.trials.updateSubscription(actorId, id, body ?? {});
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
