import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { SupervisionModule } from '../supervision/supervision.module';
import { NewStudentsModule } from '../new-students/new-students.module';
import { OrgStructureModule } from '../org/org-structure.module';
import { BillingModule } from '../billing/billing.module';
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
import { EnrollmentService } from './enrollment.service';
import { JourneyController } from './journey.controller';
import { LessonRecordService } from './lesson-record.service';
import { NewStudentEnrolmentService } from '../new-students/enrolment.service';
import { ReportMaterials } from '../materials/report-materials';

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
  // OrgStructureModule: PD-24, a new student's supervisor changes through the one transfer.
  // BillingModule: PD-27, a trial's payment links before Assign, attached at Assign.
  imports: [CommunicationModule, SupervisionModule, NewStudentsModule, OrgStructureModule, BillingModule],
  controllers: [StatsController, SchedulingController, LessonController, JourneyController, LifecycleController, TrialController, TrialTicketsController],
  providers: [
    LessonService, SchedulingService, LifecycleService, SupervisionService, StatsService, TrialService, TrialGroupService,
    // PD-15: corrections and report edits / deletes; enrolment details and courses.
    LessonRecordService, EnrollmentService,
    // PD-16: enrolling a new student. The file lives in src/new-students (it reads
    // the confined form); it is provided here, beside the scheduling it calls.
    NewStudentEnrolmentService,
    // PD-29: a report's practice and memorization marks, written in the
    // report's transaction. The file lives in src/materials.
    ReportMaterials,
  ],
  // PD-35: TrialGroupService re-seats a trial group when a teacher's supervisor changes.
  exports: [LessonService, SchedulingService, ReportMaterials, LifecycleService, SupervisionService, StatsService, TrialService, TrialGroupService],
})
export class LessonModule {}
