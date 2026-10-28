import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { TrialService } from './trial.service';
import { NewStudentEnrolmentService } from '../new-students/enrolment.service';
import { NewStudentsService } from '../new-students/new-students.service';
import { PaymentsService } from '../billing/payments.service';
import { Requires } from '../platform/permissions/route-access';

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
    private readonly payments: PaymentsService,
    private readonly forms: NewStudentsService,
  ) {}

  @Requires('trials.manage')
  @Post('prospects')
  createProspect(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.trials.createProspect(actorId, body ?? {});
  }

  @Requires('trials.view')
  @Get('prospects')
  prospects(@ActorId() actorId: string) {
    return this.trials.prospects(actorId);
  }

  @Requires('trials.view')
  @Get('teachers')
  teachers(@ActorId() actorId: string) {
    return this.trials.teachers(actorId);
  }

  @Requires('trials.view')
  @Get('slots')
  slots(@ActorId() actorId: string, @Query('teacherId') teacherId: string, @Query('durationMinutes') durationMinutes?: string) {
    return this.trials.slots(actorId, teacherId, durationMinutes);
  }

  /** Open (create if needed) a teacher's trial group. Sales or the Teachers department. */
  @Requires('trials.manage')
  @Post('teachers/:teacherId/group')
  openGroup(@ActorId() actorId: string, @Param('teacherId') teacherId: string) {
    return this.trials.openGroup(actorId, teacherId);
  }

  /** The calling teacher's own trial group. */
  @Requires('trials.manage')
  @Post('my-group')
  openOwnGroup(@ActorId() actorId: string) {
    return this.trials.openOwnGroup(actorId);
  }

  /** The "+ -> Trial" card's context in one trial group: membership, permissions, trials. */
  @Requires('trials.view')
  @Get('groups/:conversationId')
  groupContext(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return this.trials.groupContext(actorId, conversationId);
  }

  /** A Sales supervisor joins a teacher's trial group. */
  @Requires('trials.manage')
  @Post('groups/:conversationId/join')
  joinGroup(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return this.trials.joinGroup(actorId, conversationId);
  }

  /** A Sales supervisor leaves a teacher's trial group. */
  @Requires('trials.manage')
  @Post('groups/:conversationId/leave')
  leaveGroup(@ActorId() actorId: string, @Param('conversationId') conversationId: string) {
    return this.trials.leaveGroup(actorId, conversationId);
  }

  /** PD-16: the page, filtered for the viewer, each entry with its setup state. */
  @Requires('new_students.view')
  @Get('new-students')
  newStudents(@ActorId() actorId: string) {
    return this.enrolment.page(actorId);
  }

  /** PD-16: the Operations manager assigns the supervisor; Chat creates the family. */
  @Requires('new_students.manage')
  @Post('new-students/:trialId/assign')
  assignNewStudent(@ActorId() actorId: string, @Param('trialId') trialId: string, @Body() body: Record<string, unknown>) {
    return this.enrolment.assign(actorId, trialId, body ?? {});
  }

  /** PD-24: the Operations manager changes the supervisor; everything moves with the children. */
  @Requires('new_students.manage')
  @Post('new-students/:trialId/supervisor')
  changeNewStudentSupervisor(@ActorId() actorId: string, @Param('trialId') trialId: string, @Body() body: Record<string, unknown>) {
    return this.enrolment.changeSupervisor(actorId, trialId, body ?? {});
  }

  /** PD-27: a trial's payment links and payments before Assign. */
  @Requires('new_students.view')
  @Get('new-students/:trialId/payment-requests')
  async trialPaymentRequests(@ActorId() actorId: string, @Param('trialId') trialId: string) {
    const payer = await this.payments.trialPayer(actorId, trialId, (org, id) => this.forms.payerFor(org, id));
    return this.payments.trialRequests(actorId, payer);
  }

  /** PD-27: { label, amountMinor, purpose?, currency?, planMonths?, periodStart?, periodEnd?, expiresInDays? } */
  @Requires('new_students.manage')
  @Post('new-students/:trialId/payment-requests')
  async createTrialPaymentRequest(@ActorId() actorId: string, @Param('trialId') trialId: string, @Body() body: Record<string, unknown>) {
    const payer = await this.payments.trialPayer(actorId, trialId, (org, id) => this.forms.payerFor(org, id));
    return this.payments.createTrialRequest(actorId, payer, body ?? {});
  }

  /** PD-16: the responsible supervisor opens the family's group. */
  @Requires('new_students.manage')
  @Post('new-students/:trialId/group')
  createNewStudentGroup(@ActorId() actorId: string, @Param('trialId') trialId: string) {
    return this.enrolment.createGroup(actorId, trialId);
  }

  /** PD-32: end the parent's live sign-up code. */
  @Requires('new_students.manage')
  @Post('new-students/:trialId/signup-code/invalidate')
  invalidateSignupCode(@ActorId() actorId: string, @Param('trialId') trialId: string) {
    return this.enrolment.invalidateSignupCode(actorId, trialId);
  }

  /** PD-32: clear the parent's wrong-code count (audited). */
  @Requires('new_students.manage')
  @Post('new-students/:trialId/signup-attempts/reset')
  resetSignupAttempts(@ActorId() actorId: string, @Param('trialId') trialId: string) {
    return this.enrolment.resetSignupAttempts(actorId, trialId);
  }

  @Requires('trials.view')
  @Get()
  list(@ActorId() actorId: string, @Query('from') from?: string, @Query('to') to?: string, @Query('teacherId') teacherId?: string) {
    return this.trials.list(actorId, { from, to, teacherId });
  }

  @Requires('trials.manage')
  @Post()
  book(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.trials.book(actorId, body ?? {});
  }

  @Requires('trials.view')
  @Get(':id')
  get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.trials.get(actorId, id);
  }

  @Requires('trials.manage')
  @Post(':id/attendance')
  attendance(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.trials.attendance(actorId, id, body ?? {});
  }

  /** Move a booked trial that has not started: time, length or teacher. */
  @Requires('trials.manage')
  @Post(':id/reschedule')
  reschedule(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.trials.reschedule(actorId, id, body ?? {});
  }

  @Requires('trials.manage')
  @Post(':id/cancel')
  cancel(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.trials.cancel(actorId, id, body ?? {});
  }

  /** The trial's one outcome: no_show, subscribed (with the form) or not_subscribed (with a reason). */
  @Requires('trials.manage')
  @Post(':id/outcome')
  outcome(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.trials.outcome(actorId, id, body ?? {});
  }

  /** Sales corrects the outcome, saying why. */
  @Requires('trials.manage')
  @Post(':id/correction')
  correct(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.trials.correct(actorId, id, body ?? {});
  }

  /** Sales changes a subscribed trial's form. */
  @Requires('trials.manage')
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

  @Requires('chat.use')
  @Get(':id/trial-tickets')
  tickets(@ActorId() actorId: string, @Param('id') id: string) {
    return this.trials.ticketsFor(actorId, id);
  }
}
