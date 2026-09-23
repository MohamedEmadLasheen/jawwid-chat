import { Body, Controller, Post, UseFilters } from '@nestjs/common';
import { ClassScheduleService } from '../schedule/class-schedule.service';
import { CurrentActor } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';
import type { Actor } from '../../platform/types';

/**
 * The class schedule write path.
 *
 * This route exists so that "the class moved" is an EVENT rather than a value
 * someone changed in a spreadsheet. Every call captures the old time, writes an
 * audit row in the same transaction, cancels the reminders that are now wrong,
 * notifies the parents with both times, and schedules the new reminders.
 */
@Controller('learners')
@UseFilters(CommErrorFilter)
export class ClassScheduleController {
  constructor(private readonly schedule: ClassScheduleService) {}

  @Post(':id/schedule')
  async reschedule(
    @CurrentActor() actor: Actor,
    @Body() body: { learnerId: string; nextClassAt: string | null; reason: string },
  ) {
    return this.schedule.reschedule(actor, {
      learnerId: body.learnerId,
      nextClassAt: body.nextClassAt ? new Date(body.nextClassAt) : null,
      reason: body.reason,
    });
  }
}
