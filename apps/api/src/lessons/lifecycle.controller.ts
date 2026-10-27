import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { LifecycleService } from './lifecycle.service';
import { SupervisionService } from './supervision.service';
import { Requires } from '../platform/permissions/route-access';

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

  @Requires('students.manage')
  @Post('learners/:id/transfer')
  transfer(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lifecycle.transfer(actorId, id, body ?? {});
  }

  /** PD-31: what a change of teacher would do -- free weekly times, lessons that cannot follow. */
  @Requires('students.view')
  @Get('learners/:id/transfer-preview')
  transferPreview(@ActorId() actorId: string, @Param('id') id: string, @Query('toTeacherId') toTeacherId?: string) {
    return this.lifecycle.transferPreview(actorId, id, toTeacherId);
  }

  /** PD-31: change the teacher of a group (every child the old teacher teaches there). */
  @Requires('students.manage')
  @Post('conversations/:id/teacher')
  transferGroup(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lifecycle.transferGroup(actorId, id, body ?? {});
  }

  @Requires('students.view')
  @Get('conversations/:id/teacher-preview')
  groupPreview(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Query('toTeacherId') toTeacherId?: string,
    @Query('fromTeacherId') fromTeacherId?: string,
  ) {
    return this.lifecycle.groupPreview(actorId, id, toTeacherId, fromTeacherId);
  }

  /** PD-31: the teachers a learner may move to, with who is away (PD-26). */
  @Requires('lessons.view')
  @Get('teachers/candidates')
  candidates(@ActorId() actorId: string) {
    return this.lifecycle.candidates(actorId);
  }

  @Requires('students.view')
  @Get('learners/:id/transfers')
  transfers(@ActorId() actorId: string, @Param('id') id: string) {
    return this.lifecycle.transfers(actorId, id);
  }

  @Requires('students.manage')
  @Post('learners/:id/suspensions')
  suspend(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lifecycle.suspend(actorId, id, body ?? {});
  }

  /** `?kind=temporary|permanent&status=active|ended` -- the paused and the stopped lists. */
  @Requires('students.view')
  @Get('suspensions')
  suspensions(@ActorId() actorId: string, @Query('kind') kind?: string, @Query('status') status?: string) {
    return this.lifecycle.list(actorId, { kind, status });
  }

  @Requires('students.manage')
  @Post('suspensions/:id/extend')
  extend(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lifecycle.extend(actorId, id, body ?? {});
  }

  @Requires('students.manage')
  @Post('suspensions/:id/end')
  end(@ActorId() actorId: string, @Param('id') id: string) {
    return this.lifecycle.end(actorId, id);
  }

  @Requires('teacher_files.view')
  @Get('teachers/:id/supervision')
  timeline(@ActorId() actorId: string, @Param('id') id: string) {
    return this.supervision.timeline(actorId, id);
  }

  @Requires('teacher_files.supervise')
  @Post('teachers/:id/supervision')
  addEntry(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.supervision.addEntry(actorId, id, body ?? {});
  }

  @Requires('teacher_supervision.record')
  @Post('teachers/:id/bonus')
  bonus(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.supervision.bonus(actorId, id, body ?? {});
  }

  @Requires('supervision.chats')
  @Get('teachers/:id/supervision-chat')
  supervisionChat(@ActorId() actorId: string, @Param('id') id: string) {
    return this.supervision.supervisionChat(actorId, id);
  }
}
