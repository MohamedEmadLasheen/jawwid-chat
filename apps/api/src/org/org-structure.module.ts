import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { OrgStructureController } from './org-structure.controller';
import { OrgStructureService } from './org-structure.service';

/**
 * PD-8: departments, per-learner supervision and backup supervisors.
 * PlatformModule is @Global (Prisma, authorization, audit, revocation);
 * ConversationService comes from CommunicationModule because a reassignment
 * moves the child's groups in the same transaction.
 */
@Module({
  imports: [CommunicationModule],
  controllers: [OrgStructureController],
  providers: [OrgStructureService],
  exports: [OrgStructureService],
})
export class OrgStructureModule {}
