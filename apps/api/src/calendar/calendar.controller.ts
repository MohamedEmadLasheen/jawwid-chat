import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { CalendarService } from './calendar.service';
import { WorkPatternService } from './work-pattern.service';
import { Requires, SelfService } from '../platform/permissions/route-access';

type Q = Record<string, string | string[] | undefined>;

/**
 * PD-38: the academy scheduling calendar. Read-only views behind the global
 * bearer guard; who may read or change what is decided in the services.
 *
 * Every read takes `from` / `to` (days in the academy's zone, `to` exclusive,
 * at most 42 days) and the filters of calendar-filters.ts.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly patterns: WorkPatternService,
  ) {}

  /** The filter panel's choices, the legend's supervisors and what the viewer may edit. */
  @SelfService()
  @Get('calendar/options')
  options(@ActorId() actorId: string) {
    return this.calendar.options(actorId);
  }

  /** Day and week views: teachers, their shift / working hours / leave / empty time per day, lessons. */
  @Requires('schedule.view')
  @Get('calendar')
  window(@ActorId() actorId: string, @Query() query: Q) {
    return this.calendar.calendar(actorId, query);
  }

  /** Month view: per teacher and day, minutes and counts only. */
  @Requires('schedule.view')
  @Get('calendar/summary')
  summary(@ActorId() actorId: string, @Query() query: Q) {
    return this.calendar.summary(actorId, query);
  }

  /** The stats bar, from the same query as the calendar. */
  @Requires('schedule.view')
  @Get('calendar/stats')
  stats(@ActorId() actorId: string, @Query() query: Q) {
    return this.calendar.stats(actorId, query);
  }

  /** PD-38 P2: a teacher's own schedule (`from` / `to` only; the teacher is the caller). */
  @SelfService()
  @Get('me/calendar')
  mine(@ActorId() actorId: string, @Query() query: Q) {
    return this.calendar.mine(actorId, query);
  }

  @Requires('schedule.view')
  @Get('teachers/:id/work-pattern')
  pattern(@ActorId() actorId: string, @Param('id') id: string) {
    return this.patterns.pattern(actorId, id);
  }

  @Requires('schedule.manage')
  @Post('teachers/:id/work-pattern')
  setPattern(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.patterns.setPattern(actorId, id, body ?? {});
  }

  @Requires('schedule.manage')
  @Post('org/staff/:id/calendar-color')
  setColor(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.patterns.setColor(actorId, id, body ?? {});
  }
}
