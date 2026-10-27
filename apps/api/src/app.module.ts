import { Module } from '@nestjs/common';
import { PlatformModule } from './platform/platform.module';
import { AuthModule } from './platform/auth/auth.module';
import { CommunicationModule } from './communication/communication.module';
import { HealthModule } from './infra/health/health.module';
import { AdminModule } from './admin/admin.module';
import { StaffProfileModule } from './staff-profile/staff-profile.module';
import { OrgStructureModule } from './org/org-structure.module';
import { LessonModule } from './lessons/lesson.module';
import { TeacherFileModule } from './teacher-file/teacher-file.module';
import { SupervisionModule } from './supervision/supervision.module';
import { CertificateModule } from './certificates/certificate.module';
import { LeaveModule } from './leave/leave.module';
import { DisciplineModule } from './discipline/discipline.module';
import { BillingModule } from './billing/billing.module';
import { ParentRecordModule } from './parent-profile/parent-record.module';
import { CoreBoundaryModule } from './core-boundary/core-boundary.module';
import { ScheduledCallModule } from './scheduled-calls/scheduled-call.module';
import { AccountAdminModule } from './account-admin/account-admin.module';
import { AccountRecoveryModule } from './account-recovery/account-recovery.module';
import { MaterialsModule } from './materials/materials.module';
import { SubscriptionModule } from './subscriptions/subscription.module';
import { TeacherSupervisorModule } from './teacher-supervisors/teacher-supervisor.module';
import { CalendarModule } from './calendar/calendar.module';
import { SupervisionCaseModule } from './cases/supervision-case.module';

/**
 * The root module. Composition only -- it declares no provider and no
 * controller of its own.
 *
 * PlatformModule (AI #1) is @Global and supplies identity, authorization,
 * coverage, audit and Prisma. CommunicationModule (AI #2) owns every HTTP
 * controller, the realtime gateway and the outbox worker. HealthModule (AI #7)
 * adds the probes the runtime needs. AdminModule is the Admin Portal's
 * read-only `/admin` inspection surface (super admin only).
 * StaffProfileModule serves `/staff-profiles` (profiles, responsibilities,
 * teams, the super admin's organization overview).
 *
 * AuthModule (PR-B) registers the global AuthenticatedGuard, so importing it
 * here protects EVERY route in every other module at once. That is deliberate:
 * a guard opted into per-controller leaves the next controller unauthenticated
 * until somebody remembers.
 *
 * Adding a feature means adding its module here, not adding code here.
 */
@Module({
  imports: [
    PlatformModule,
    AuthModule,
    CommunicationModule,
    HealthModule,
    AdminModule,
    StaffProfileModule,
    OrgStructureModule,
    LessonModule,
    TeacherFileModule,
    SupervisionModule,
    CertificateModule,
    LeaveModule,
    DisciplineModule,
    BillingModule,
    ParentRecordModule,
    CoreBoundaryModule,
    ScheduledCallModule,
    AccountAdminModule,
    // PD-25: parents recover their own account from the sign-in screen.
    AccountRecoveryModule,
    // PD-29: the Materials library, practice this week and the memorization map.
    MaterialsModule,
    // PD-30: subscription locks -- cards, pushes, lesson holds, renewal requests.
    SubscriptionModule,
    // PD-35: teacher supervisors (assignment, the 'supervision' seat).
    TeacherSupervisorModule,
    // PD-38: the academy scheduling calendar, shifts and supervisor colors.
    CalendarModule,
    // PD-35 B5: escalation cases to the Teachers or Operations department.
    SupervisionCaseModule,
  ],
})
export class AppModule {}
