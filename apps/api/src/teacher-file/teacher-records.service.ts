import { Injectable } from '@nestjs/common';
import { ConversationService } from '../communication/conversations/conversation.service';
import { PermissionService } from '../platform/permissions/permission.service';
import { decideTeacherRecordsAccess, type TeacherRecordsAccess } from '../platform/teacher-records-policy';
import { TeacherFileService } from './teacher-file.service';

/**
 * PD-52: the two teacher-records pages (Attendance & Complaints, Grants &
 * Testimonials). They read the records the PD-26 page already reads; this
 * service answers what the Admin Web may offer. Lives under src/teacher-file:
 * the pages read supervision entries and parent feedback, which only this
 * module may read.
 */
@Injectable()
export class TeacherRecordsService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly files: TeacherFileService,
    private readonly permissions: PermissionService,
  ) {}

  /** Which pages and which actions, per basis and key. Advisory: every route decides again. */
  async access(actorId: string): Promise<TeacherRecordsAccess> {
    const actor = await this.conversations.requireActor(actorId);
    const [inputs, profile] = await Promise.all([this.files.recordsInputs(actor), this.permissions.profileOf(actor)]);
    return decideTeacherRecordsAccess({ ...inputs, keys: profile.permissions });
  }
}
