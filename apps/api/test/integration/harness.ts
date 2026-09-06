import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { AuthorizationService } from '@platform/authorization.service';
import { AppConfigService } from '@platform/app-config.service';
import { PrismaIdentityService } from '@platform/identity.service';
import { PrismaAuditService } from '@platform/audit.service';
import type { CoverageService } from '@platform/coverage.service';
import { ConversationService } from '@communication/conversations/conversation.service';
import { MessageService } from '@communication/messages/message.service';
import { ApprovalService } from '@communication/approvals/approval.service';
import { AttachmentService } from '@communication/attachments/attachment.service';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { OutboxService } from '@communication/outbox/outbox.service';
import { NotificationService } from '@communication/notifications/notification.service';
import { ReminderService } from '@communication/notifications/reminder.service';
import { TemplateService } from '@communication/notifications/template.service';
import { QuietHoursService } from '@communication/notifications/quiet-hours.service';
import { LoggingPushProvider } from '@communication/notifications/push.provider';
import { CallService } from '@communication/calls/call.service';
import { LiveKitTokenIssuer } from '@communication/calls/media-token';

process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:55433/jawwid_chat_int';

/** on_duty() is AI #1's engine; tests pin it so they assert OUR behaviour. */
export class PinnedCoverage implements CoverageService {
  constructor(public onDutyId: string | null = null) {}
  async onDuty(): Promise<string | null> {
    return this.onDutyId;
  }
}

export function buildGraph() {
  const prisma = new PrismaService();
  const coverage = new PinnedCoverage();
  const identity = new PrismaIdentityService(prisma);
  const audit = new PrismaAuditService();
  const authz = new AuthorizationService(coverage);
  const outbox = new OutboxService();
  const config = new AppConfigService(prisma);
  const storage = new SignedLocalObjectStorage();

  const conversations = new ConversationService(prisma, authz, outbox, identity, coverage, audit);
  const attachments = new AttachmentService(prisma, authz, conversations, storage);
  const messages = new MessageService(prisma, authz, conversations, outbox, config, attachments, audit);
  const approvals = new ApprovalService(prisma, authz, conversations, outbox, audit);
  const templates = new TemplateService(prisma);
  const quietHours = new QuietHoursService(prisma);
  const notifications = new NotificationService(prisma, templates, quietHours, config, new LoggingPushProvider());
  const reminders = new ReminderService(prisma, notifications);
  const calls = new CallService(
    prisma, authz, conversations, outbox, config, identity, audit, new LiveKitTokenIssuer(),
  );

  return {
    prisma, coverage, identity, authz, conversations, messages, approvals,
    attachments, notifications, reminders, templates, quietHours, calls,
  };
}

export interface Scenario {
  ownerId: string;
  otherAdminId: string;
  managerId: string;
  familyId: string;
  parentId: string;
  otherParentId: string;
  teacherId: string;
  newTeacherId: string;
  learnerId: string;
  threadId: string;
}

/**
 * Synthetic fixtures only. Real staff names and schedules must never enter test
 * data (QA gate G-16), so everyone here is admin_a / parent_b / teacher_c.
 */
export async function seed(prisma: PrismaService): Promise<Scenario> {
  const ids = {
    ownerId: randomUUID(),
    otherAdminId: randomUUID(),
    managerId: randomUUID(),
    familyId: randomUUID(),
    parentId: randomUUID(),
    otherParentId: randomUUID(),
    teacherId: randomUUID(),
    newTeacherId: randomUUID(),
    learnerId: randomUUID(),
    threadId: randomUUID(),
  };

  await prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ('${ids.ownerId}'::uuid, 'admin_a', 'admin', true),
       ('${ids.otherAdminId}'::uuid, 'admin_b', 'admin', true),
       ('${ids.managerId}'::uuid, 'manager_c', 'manager', true)`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${ids.familyId}'::uuid, 'family_x', '${ids.ownerId}'::uuid, 'ar')`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active) values
       ('${ids.parentId}'::uuid, '${ids.familyId}'::uuid, 'parent_p', 'primary_guardian', true, true),
       ('${ids.otherParentId}'::uuid, '${ids.familyId}'::uuid, 'parent_q', 'authorized_contact', true, true)`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${ids.learnerId}'::uuid, '${ids.familyId}'::uuid, 'learner_l', '${ids.teacherId}'::uuid)`,
  );
  // A second learner makes newTeacherId resolvable as a teacher actor.
  await prisma.$executeRawUnsafe(
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${randomUUID()}'::uuid, '${ids.familyId}'::uuid, 'learner_m', '${ids.newTeacherId}'::uuid)`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.thread (id, family_id) values ('${ids.threadId}'::uuid, '${ids.familyId}'::uuid)`,
  );

  return ids;
}

/** Order matters: children before parents. */
export async function truncate(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    truncate chat.message_receipt, chat.message_reaction, chat.message_attachment,
             chat.message_hidden_for, chat.message_approval, chat.call_participant,
             chat.call, chat.notification, chat.outbox_event,
             chat.conversation_participant_state, chat.conversation_member,
             chat.message, chat.conversation, chat.thread, chat.learner,
             chat.contact, chat.family, chat.staff, chat.event_log, chat.audit_log
    restart identity cascade`);
}
