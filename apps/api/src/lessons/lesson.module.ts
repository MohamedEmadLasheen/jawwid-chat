import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { LessonController } from './lesson.controller';
import { LessonService } from './lesson.service';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';

/**
 * PD-9 / PD-11: lessons, their one outcome, the tickets that record it, and
 * (T2) availability, regular times and make-ups.
 * PlatformModule is @Global (Prisma, authorization, audit, config);
 * ConversationService and OutboxService come from CommunicationModule because
 * every ticket posts its card in the same transaction as its record.
 */
@Module({
  imports: [CommunicationModule],
  controllers: [LessonController, SchedulingController],
  providers: [LessonService, SchedulingService],
  exports: [LessonService, SchedulingService],
})
export class LessonModule {}
