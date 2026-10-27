import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { OrgStructureController } from './org-structure.controller';
import { OrgStructureService } from './org-structure.service';
import { SupervisorCoverController } from './supervisor-cover.controller';
import { SupervisorCoverService } from './supervisor-cover.service';
import { DepartmentRoomService } from './department-room.service';

/**
 * PD-8: departments, per-learner supervision and backup supervisors.
 * PlatformModule is @Global (Prisma, authorization, audit, revocation);
 * ConversationService comes from CommunicationModule because a reassignment
 * moves the child's groups in the same transaction.
 * PD-33: SupervisorCoverService -- hand over to a backup, automatic return.
 * PD-35 B6: DepartmentRoomService -- each department's staff-only room.
 */
@Module({
  imports: [CommunicationModule],
  controllers: [OrgStructureController, SupervisorCoverController],
  providers: [OrgStructureService, SupervisorCoverService, DepartmentRoomService],
  exports: [OrgStructureService, SupervisorCoverService, DepartmentRoomService],
})
export class OrgStructureModule {}
