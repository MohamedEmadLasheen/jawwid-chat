import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { SupervisionModule } from '../supervision/supervision.module';
import { NewStudentsModule } from '../new-students/new-students.module';
import { LessonController } from './lesson.controller';
import { LessonService } from './lesson.service';
import { LifecycleController } from './lifecycle.controller';
import { LifecycleService } from './lifecycle.service';
import { SchedulingController } from './scheduling.controller';
import { SupervisionService } from './supervision.service';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { TrialController, TrialTicketsController } from './trial.controller';
import { TrialGroupService } from './trial-group.service';
import { TrialService } from './trial.service';
import { SchedulingService } from './scheduling.service';

/**
 * PD-9 / PD-11: lessons, their one outcome, the tickets that record it, and
 * (T2) availability, regular times and make-ups.
 * PlatformModule is @Global (Prisma, authorization, audit, config);
 * ConversationService and OutboxService come from CommunicationModule because
 * every ticket posts its card in the same transaction as its record.
 */
@Module({
  // SupervisionModule: the teacher's supervision conversation (PD-12), where
  // the bonus and handover cards are posted. It depends on nothing here.
  // NewStudentsModule: the confined subscription form (G-07), written in the
  // outcome's own transaction.
  imports: [CommunicationModule, SupervisionModule, NewStudentsModule],
  controllers: [StatsController, SchedulingController, LessonController, LifecycleController, TrialController, TrialTicketsController],
  providers: [LessonService, SchedulingService, LifecycleService, SupervisionService, StatsService, TrialService, TrialGroupService],
  exports: [LessonService, SchedulingService, LifecycleService, SupervisionService, StatsService, TrialService],
})
export class LessonModule {}
