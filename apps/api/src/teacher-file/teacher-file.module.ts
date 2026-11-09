import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { LessonModule } from '../lessons/lesson.module';
import { TeacherFileController } from './teacher-file.controller';
import { TeacherSupervisionController } from './teacher-supervision.controller';
import { TeacherFileService } from './teacher-file.service';
import { TeacherPayrollService } from './teacher-payroll.service';
import { TeacherLessonReportsService } from './teacher-lesson-reports.service';
import { ParentFeedbackController } from './parent-feedback.controller';
import { ParentFeedbackService } from './parent-feedback.service';
import { SupervisionModule } from '../supervision/supervision.module';
import { TeacherEvaluationController } from './teacher-evaluation.controller';
import { TeacherEvaluationService } from './teacher-evaluation.service';
import { AuthModule } from '../platform/auth/auth.module';
import { FIRST_LOGIN_MAILER, selectMailSender } from '../account-recovery/recovery-delivery';
import { TeacherOnboardingController } from './teacher-onboarding.controller';
import { TeacherOnboardingService } from './teacher-onboarding.service';
import { TeacherRecordsController } from './teacher-records.controller';
import { TeacherRecordsService } from './teacher-records.service';
import { AccountDeletionModule } from '../account-deletion/account-deletion.module';
import { TeacherDeletionRequestController } from './teacher-deletion-request.controller';

/**
 * PD-10: the administration-only Teacher File. The only module that may read
 * chat.teacher_file or chat.teacher_supervision_entry. ConversationService
 * comes from CommunicationModule for actor resolution and the read check on a
 * complaint's source conversation; nothing flows the other way. PD-18 payroll
 * (TeacherPayrollService) lives here too, behind the same confinement, and so
 * does PD-32 parent feedback (ParentFeedbackService): a parent's complaint is a
 * supervision entry. PD-35's evaluations and improvement plans live here too;
 * SupervisionModule posts their cards in the teacher's supervision conversation.
 * PD-43 adds teachers here (TeacherOnboardingService): the duplicate check
 * reads the Teacher File, and AuthModule's PasswordResetService writes the
 * first sign-in code in the same transaction.
 */
@Module({
  // LessonModule: PD-11's bonus ticket, which a reward with its amount extends
  // (PD-26). Nothing under LessonModule or SupervisionModule imports this
  // module, so no cycle.
  // AccountDeletionModule (PD-56 O-3): the Teacher File's "Close and delete account".
  imports: [CommunicationModule, SupervisionModule, LessonModule, AuthModule, AccountDeletionModule],
  controllers: [TeacherFileController, TeacherSupervisionController, ParentFeedbackController, TeacherEvaluationController, TeacherOnboardingController, TeacherRecordsController, TeacherDeletionRequestController],
  providers: [
    TeacherFileService,
    TeacherPayrollService,
    TeacherLessonReportsService,
    ParentFeedbackService,
    TeacherEvaluationService,
    TeacherOnboardingService,
    // PD-52: the teacher-records pages' access answer.
    TeacherRecordsService,
    { provide: FIRST_LOGIN_MAILER, useFactory: () => selectMailSender() },
  ],
  // PD-35 B5: escalation cases ask who a piece of feedback is about (ids only).
  exports: [ParentFeedbackService],
})
export class TeacherFileModule {}
