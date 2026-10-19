import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { LeaveService } from './leave.service';

/**
 * PD-12 teacher leave. Behind the global bearer guard; who may do what is
 * decided in LeaveService (pd012-policy), never here. POST for every change:
 * the shared admin-web client has no PUT.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  // --- the teacher ---

  /** The teacher's own balance and requests: the one teacher-app surface PD-12 reopens. */
  @Get('me/leave')
  own(@ActorId() actorId: string, @Query('year') year?: string) {
    return this.leave.ownLeave(actorId, year);
  }

  /** The teacher's Leave ticket. */
  @Post('me/leave-requests')
  request(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.leave.request(actorId, body ?? {});
  }

  @Post('me/leave-requests/:id/withdraw')
  withdraw(@ActorId() actorId: string, @Param('id') id: string) {
    return this.leave.withdraw(actorId, id);
  }

  // --- the Teachers department ---

  @Get('teacher-leave-requests')
  list(@ActorId() actorId: string, @Query('state') state?: string) {
    return this.leave.list(actorId, { state });
  }

  @Post('teacher-leave-requests/:id/approve')
  approve(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.leave.approve(actorId, id, body ?? {});
  }

  @Post('teacher-leave-requests/:id/decline')
  decline(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.leave.decline(actorId, id, body ?? {});
  }

  @Post('teacher-leave-requests/:id/cancel')
  cancel(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.leave.cancel(actorId, id, body ?? {});
  }

  @Get('teacher-files/:teacherId/leave')
  teacherLeave(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Query('year') year?: string) {
    return this.leave.teacherLeave(actorId, teacherId, year);
  }

  @Post('teacher-files/:teacherId/leave-allowance')
  setAllowance(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.leave.setAllowance(actorId, teacherId, body ?? {});
  }
}
