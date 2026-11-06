import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { CommunicationModule } from '../communication/communication.module';
import { AccountAdminModule } from '../account-admin/account-admin.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { ReportEscalationService } from './report-escalation.service';
import { ModerationMediaController } from './moderation-media.controller';
import { OBJECT_STORAGE } from '../platform/tokens';
import { selectObjectStorage } from '../communication/attachments/storage.provider';

/**
 * PD-57 WP-1 (roadmap 2026-11-03 §5.4): Report. The reporter's routes
 * (POST /reports, GET /me/reports) and the staff queue (/moderation/reports).
 * CommunicationModule gives the read rules and the moderation deletion
 * (MessageService), AuthModule the permission profile (PD-40), and
 * AccountAdminModule the PD-21 suspension behind `account_suspended`.
 * ModerationMediaController serves an evidence attachment's bytes (closure
 * plan §4) from the object storage, behind the moderation scope.
 */
@Module({
  imports: [AuthModule, CommunicationModule, AccountAdminModule],
  controllers: [ReportsController, ModerationController, ModerationMediaController],
  providers: [ReportsService, ModerationService, ReportEscalationService, { provide: OBJECT_STORAGE, useFactory: () => selectObjectStorage().storage }],
  exports: [ReportsService, ModerationService],
})
export class ModerationModule {}
