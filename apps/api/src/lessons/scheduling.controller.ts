import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { SchedulingService } from './scheduling.service';
import { Requires } from '../platform/permissions/route-access';

/**
 * PD-11 T2: availability, regular times, make-ups and regular-time change
 * requests. Behind the global bearer guard; who may do what is decided in
 * SchedulingService -> AuthorizationService. POST for every change.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  /** The Teachers department's teachers and learners, for the Admin Web's Schedules tab. */
  @Requires('lessons.view')
  @Get('lessons/roster')
  roster(@ActorId() actorId: string) {
    return this.scheduling.roster(actorId);
  }

  /** `:id` may be `me` for a teacher reading their own. */
  @Requires('schedule.view')
  @Get('teachers/:id/availability')
  availability(@ActorId() actorId: string, @Param('id') id: string) {
    return this.scheduling.availability(actorId, id);
  }

  @Requires('schedule.manage')
  @Post('teachers/:id/availability')
  setAvailability(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.scheduling.setAvailability(actorId, id, body ?? {});
  }

  @Requires('schedule.manage')
  @Post('teachers/:id/days-off')
  addDayOff(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.scheduling.addDayOff(actorId, id, body ?? {});
  }

  @Requires('schedule.manage')
  @Post('teachers/:id/days-off/:date/remove')
  removeDayOff(@ActorId() actorId: string, @Param('id') id: string, @Param('date') date: string) {
    return this.scheduling.removeDayOff(actorId, id, date);
  }

  @Requires('schedule.view')
  @Get('learners/:id/schedule')
  schedule(@ActorId() actorId: string, @Param('id') id: string) {
    return this.scheduling.schedule(actorId, id);
  }

  @Requires('schedule.manage')
  @Post('learners/:id/schedule')
  setSchedule(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.scheduling.setSchedule(actorId, id, body ?? {});
  }

  /** PD-31: `teacherId` -- another teacher's options, for staff changing the teacher. */
  @Requires('schedule.view')
  @Get('learners/:id/schedule-options')
  scheduleOptions(@ActorId() actorId: string, @Param('id') id: string, @Query('teacherId') teacherId?: string) {
    return this.scheduling.scheduleOptions(actorId, id, teacherId);
  }

  /** PD-31: the child's teacher's free one-off starts, for staff adding a lesson. */
  @Requires('schedule.view')
  @Get('learners/:id/free-slots')
  learnerFreeSlots(@ActorId() actorId: string, @Param('id') id: string, @Query('durationMinutes') durationMinutes?: string) {
    return this.scheduling.learnerFreeSlots(actorId, id, durationMinutes);
  }

  @Requires('schedule.manage')
  @Post('learners/:id/schedule-change-requests')
  requestChange(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.scheduling.requestScheduleChange(actorId, id, body ?? {});
  }

  @Requires('schedule.manage')
  @Post('schedule-change-requests/:id/decide')
  decideChange(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.scheduling.decideScheduleChange(actorId, id, body ?? {});
  }

  @Requires('schedule.view')
  @Get('lessons/:id/makeup-slots')
  makeupSlots(@ActorId() actorId: string, @Param('id') id: string) {
    return this.scheduling.makeupSlots(actorId, id);
  }

  @Requires('schedule.manage')
  @Post('lessons/:id/makeup')
  bookMakeup(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.scheduling.bookMakeup(actorId, id, body ?? {});
  }

  /** PD-31: moving ONE lesson to another time. */
  @Requires('schedule.view')
  @Get('lessons/:id/move-slots')
  moveSlots(@ActorId() actorId: string, @Param('id') id: string) {
    return this.scheduling.moveSlots(actorId, id);
  }

  @Requires('schedule.manage')
  @Post('lessons/:id/move')
  move(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.scheduling.moveLesson(actorId, id, body ?? {});
  }

  /** PD-31: a weekly lesson the teacher's other lessons blocked (Needs action). */
  @Requires('schedule.view')
  @Get('lessons/blocked/:id/slots')
  blockedSlots(@ActorId() actorId: string, @Param('id') id: string) {
    return this.scheduling.blockedSlots(actorId, id);
  }

  @Requires('schedule.manage')
  @Post('lessons/blocked/:id/schedule')
  scheduleBlocked(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.scheduling.scheduleBlocked(actorId, id, body ?? {});
  }

  @Requires('schedule.manage')
  @Post('lessons/blocked/:id/dismiss')
  dismissBlocked(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.scheduling.dismissBlocked(actorId, id, body ?? {});
  }

  @Requires('schedule.manage')
  @Post('lessons/:id/makeup-resolution')
  resolveMakeup(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.scheduling.resolveMakeup(actorId, id, body ?? {});
  }
}
