import { Module } from '@nestjs/common';
import { FamilyService } from './families/family.service';
import { FamilyController } from './families/family.controller';
import { LearnerService } from './learners/learner.service';
import { LearnerController } from './learners/learner.controller';
import { GroupService } from './groups/group.service';
import { GroupController } from './groups/group.controller';
import { LabelService } from './labels/label.service';
import { LabelController } from './labels/label.controller';
import { UserAdminService } from './users/user-admin.service';
import { UserAdminController } from './users/user-admin.controller';
import { CommunicationModule } from '../communication/communication.module';

/**
 * The administrative surface Phase 1 requires: families and who supervises
 * them, and accounts and what they may do.
 *
 * It is a separate module from PlatformModule because PlatformModule is
 * @Global and declares no controller -- composition stays explicit, and this
 * module can be omitted from a deployment that does not serve the admin web
 * application without touching the engine.
 */
@Module({
  // Phase 3 relationship changes have messaging consequences -- a teacher
  // transfer and a supervisor transfer both re-sync the student group -- so
  // this module consumes the EXPORTED ConversationService rather than
  // reimplementing membership reconciliation. CommunicationModule imports only
  // PlatformModule, so there is no cycle.
  imports: [CommunicationModule],
  controllers: [
    FamilyController,
    LearnerController,
    GroupController,
    LabelController,
    UserAdminController,
  ],
  providers: [FamilyService, LearnerService, GroupService, LabelService, UserAdminService],
  exports: [FamilyService, LearnerService, GroupService, LabelService, UserAdminService],
})
export class AdminModule {}
