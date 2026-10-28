import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { SupervisionCaseModule } from '../cases/supervision-case.module';
import { TaskModule } from '../tasks/task.module';
import { DashboardController } from './dashboard.controller';

/**
 * PD-44: the manager Dashboard. A controller only: every count lives in the
 * service that owns the page it links to, imported from that page's module.
 * Nothing imports this module, so no cycle.
 */
@Module({
  imports: [CommunicationModule, SupervisionCaseModule, TaskModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
