import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { LessonModule } from '../lessons/lesson.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { WorkPatternService } from './work-pattern.service';

/**
 * PD-38: the academy scheduling calendar, teachers' work patterns and
 * supervisors' calendar colors. It reads the lessons system (LessonModule) and
 * writes availability through SchedulingService, never around it.
 */
@Module({
  imports: [CommunicationModule, LessonModule],
  controllers: [CalendarController],
  providers: [CalendarService, WorkPatternService],
})
export class CalendarModule {}
