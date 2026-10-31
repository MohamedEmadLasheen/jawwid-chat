import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { SupervisionCaseModule } from '../cases/supervision-case.module';
import { TaskModule } from '../tasks/task.module';
import { CalendarModule } from '../calendar/calendar.module';
import { LessonModule } from '../lessons/lesson.module';
import { BillingModule } from '../billing/billing.module';
import { ParentRecordModule } from '../parent-profile/parent-record.module';
import { DashboardController } from './dashboard.controller';

/**
 * PD-44: the manager Dashboard. A controller only: every count lives in the
 * service that owns the page it links to, imported from that page's module.
 * Nothing imports this module, so no cycle.
 */
@Module({
  imports: [CommunicationModule, SupervisionCaseModule, TaskModule, CalendarModule, LessonModule, BillingModule, ParentRecordModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
