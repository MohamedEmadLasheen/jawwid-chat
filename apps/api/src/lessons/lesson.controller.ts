import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { LessonService } from './lesson.service';
import { SchedulingService } from './scheduling.service';
import { Requires } from '../platform/permissions/route-access';

/**
 * PD-9 / PD-11 lessons and their tickets. Every route is behind the global
 * bearer guard; who may do what is decided in LessonService ->
 * AuthorizationService, never here. POST for every change: the shared
 * admin-web client has no PUT.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class LessonController {
  constructor(
    private readonly lessons: LessonService,
    private readonly scheduling: SchedulingService,
  ) {}

  @Requires('lessons.view')
  @Get('lessons')
  list(
    @ActorId() actorId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('teacherId') teacherId?: string,
    @Query('learnerId') learnerId?: string,
  ) {
    return this.lessons.list(actorId, { from, to, teacherId, learnerId });
  }

  /** The Teachers department's queue: overdue lessons and open rulings. */
  @Requires('lessons.view')
  @Get('lessons/needs-action')
  async needsAction(@ActorId() actorId: string) {
    // PD-31: requests re-checked against the teacher's time now, and the
    // weekly lessons the materializer could not create.
    return this.scheduling.enrichNeedsAction(actorId, await this.lessons.needsAction(actorId));
  }

  @Requires('lessons.view')
  @Get('lessons/:id')
  get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.lessons.get(actorId, id);
  }

  @Requires('lessons.manage')
  @Post('lessons')
  schedule(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.lessons.schedule(actorId, body ?? {});
  }

  /** What the caller may open under "+" in this conversation now. Advisory. */
  @Requires('chat.use')
  @Get('conversations/:id/lesson-tickets')
  tickets(@ActorId() actorId: string, @Param('id') id: string) {
    return this.lessons.ticketsFor(actorId, id);
  }

  @Requires('lessons.manage')
  @Post('lessons/:id/report')
  report(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lessons.report(actorId, id, body ?? {});
  }

  @Requires('lessons.manage')
  @Post('lessons/:id/absence')
  absence(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lessons.absence(actorId, id, body ?? {});
  }

  @Requires('lessons.manage')
  @Post('lessons/:id/apology')
  apology(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lessons.apology(actorId, id, body ?? {});
  }

  @Requires('lessons.manage')
  @Post('lessons/:id/teacher-apology')
  teacherApology(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lessons.teacherApology(actorId, id, body ?? {});
  }

  @Requires('lessons.manage')
  @Post('lessons/:id/cancel')
  cancel(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lessons.cancel(actorId, id, body ?? {});
  }

  @Requires('lessons.manage')
  @Post('lessons/:id/teacher-no-show')
  teacherNoShow(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lessons.teacherNoShow(actorId, id, body ?? {});
  }

  @Requires('lessons.manage')
  @Post('lessons/:id/late-apology')
  lateApology(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lessons.lateApology(actorId, id, body ?? {});
  }

  @Requires('lessons.manage')
  @Post('lesson-rulings/:id/decide')
  decide(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lessons.decideRuling(actorId, id, body ?? {});
  }
}
