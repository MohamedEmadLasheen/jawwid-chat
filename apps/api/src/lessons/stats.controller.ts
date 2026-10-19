import { Controller, Get, Param, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { StatsService } from './stats.service';

/**
 * PD-11 T5: statistics. Read-only; behind the global bearer guard; who may read
 * what is decided in StatsService. `?month=YYYY-MM` (default: this month, in
 * the academy's zone).
 */
@Controller()
@UseFilters(CommErrorFilter)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** What the Admin Web may offer: { lessonManager }. Advisory. */
  @Get('lessons/access')
  access(@ActorId() actorId: string) {
    return this.stats.access(actorId);
  }

  @Get('stats/teachers')
  teachers(@ActorId() actorId: string, @Query('month') month?: string) {
    return this.stats.teachers(actorId, month);
  }

  @Get('stats/teachers/:id')
  teacher(@ActorId() actorId: string, @Param('id') id: string, @Query('month') month?: string) {
    return this.stats.teacher(actorId, id, month);
  }

  @Get('stats/me')
  mine(@ActorId() actorId: string, @Query('month') month?: string) {
    return this.stats.mine(actorId, month);
  }

  @Get('learners/:id/progress')
  progress(@ActorId() actorId: string, @Param('id') id: string, @Query('month') month?: string) {
    return this.stats.progress(actorId, id, month);
  }
}
