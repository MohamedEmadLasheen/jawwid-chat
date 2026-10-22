import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { DisciplineService } from './discipline.service';

/**
 * PD-12 S2: the discipline ladder. Behind the global bearer guard; only the
 * Teachers department and the super admin are answered (DisciplineService).
 * POST for every change: the shared admin-web client has no PUT.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class DisciplineController {
  constructor(private readonly discipline: DisciplineService) {}

  /** The "needs decision" queue (state=open, the default), or decided / all; by month, teacher, kind. */
  @Get('discipline/violations')
  list(
    @ActorId() actorId: string,
    @Query('state') state?: string,
    @Query('month') month?: string,
    @Query('teacherId') teacherId?: string,
    @Query('kind') kind?: string,
  ) {
    return this.discipline.list(actorId, { state, month, teacherId, kind });
  }

  @Post('discipline/violations/:id/decide')
  decide(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.discipline.decide(actorId, id, body ?? {});
  }

  /** A held lesson the teacher started late (from teacher.late_threshold_minutes). */
  @Post('lessons/:id/lateness')
  lateness(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.discipline.recordLateness(actorId, id, body ?? {});
  }

  /** PD-26: an absence with no lesson to close. With a lesson, close it as the teacher's absence instead. */
  @Post('teachers/:id/absences')
  absence(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.discipline.recordAbsence(actorId, id, body ?? {});
  }

  /** PD-26: an upheld complaint joins the monthly ladder as a violation. */
  @Post('discipline/complaints/:id/uphold')
  uphold(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.discipline.upholdComplaint(actorId, id, body ?? {});
  }

  /** One teacher's month: the count that sets the next step, the violations, the suspensions. */
  @Get('teachers/:id/discipline')
  teacherMonth(@ActorId() actorId: string, @Param('id') id: string, @Query('month') month?: string) {
    return this.discipline.teacherMonth(actorId, id, month);
  }
}
