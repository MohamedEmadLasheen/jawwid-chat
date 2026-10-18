import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { LessonController } from './lesson.controller';
import { LessonService } from './lesson.service';

/**
 * PD-9 / PD-11: lessons, their one outcome, and the tickets that record it.
 * PlatformModule is @Global (Prisma, authorization, audit, config);
 * ConversationService and OutboxService come from CommunicationModule because
 * every ticket posts its card in the same transaction as its record.
 */
@Module({
  imports: [CommunicationModule],
  controllers: [LessonController],
  providers: [LessonService],
  exports: [LessonService],
})
export class LessonModule {}
