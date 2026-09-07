import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { AuthorizationService } from '@platform/authorization.service';
import { AppConfigService } from '@platform/app-config.service';
import { PrismaIdentityService } from '@platform/identity.service';
import { ScopeService } from '@platform/scope.service';
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

  const scope = new ScopeService(prisma);

  const conversations = new ConversationService(prisma, authz, scope, outbox, identity, coverage, audit);
  const attachments = new AttachmentService(prisma, authz, conversations, storage);
  const messages = new MessageService(prisma, authz, conversations, outbox, config, attachments, audit);
  const approvals = new ApprovalService(prisma, authz, scope, conversations, outbox, audit);
  const templates = new TemplateService(prisma);
  const quietHours = new QuietHoursService(prisma);
  const notifications = new NotificationService(prisma, templates, quietHours, config, new LoggingPushProvider());
  const reminders = new ReminderService(prisma, notifications);
  const calls = new CallService(
    prisma, authz, conversations, outbox, config, identity, audit, new LiveKitTokenIssuer(),
  );

  return {
    prisma, coverage, identity, authz, scope, conversations, messages, approvals,
    attachments, notifications, reminders, templates, quietHours, calls,
  };
}

export interface Scenario {
  /** chat.account.id keyed by the actor id it belongs to. */
  accounts: Record<string, string>;
  ownerId: string;
  otherAdminId: string;
  managerId: string;
  familyId: string;
  parentId: string;
  otherParentId: string;
  teacherId: string;
  newTeacherId: string;
  learnerId: string;
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
  };

  // PHASE 1. Every principal now needs an ACCOUNT: permissions are resolved
  // from chat.account (role defaults plus that account's overrides), so a staff
  // row with no login holds nothing and can do nothing. That is deliberate --
  // a principal who cannot authenticate should not be exercisable -- and it is
  // why the fixtures provision accounts rather than bare domain rows.
  const accountOf: Record<string, string> = {};
  const account = async (actorId: string, kind: 'staff' | 'family' | 'teacher') => {
    const id = randomUUID();
    accountOf[actorId] = id;
    await prisma.$executeRawUnsafe(
      `insert into chat.account (id, subject, kind, status)
       values ('${id}'::uuid, 'subject_${actorId}', '${kind}', 'active')`,
    );
    return id;
  };

  for (const staffId of [ids.ownerId, ids.otherAdminId, ids.managerId]) await account(staffId, 'staff');
  for (const teacherId of [ids.teacherId, ids.newTeacherId]) await account(teacherId, 'teacher');
  for (const contactId of [ids.parentId, ids.otherParentId]) await account(contactId, 'family');

  await prisma.$executeRawUnsafe(
    `insert into chat.staff (id, account_id, name, role, is_active) values
       ('${ids.ownerId}'::uuid, '${accountOf[ids.ownerId]}'::uuid, 'admin_a', 'admin', true),
       ('${ids.otherAdminId}'::uuid, '${accountOf[ids.otherAdminId]}'::uuid, 'admin_b', 'admin', true),
       ('${ids.managerId}'::uuid, '${accountOf[ids.managerId]}'::uuid, 'manager_c', 'manager', true)`,
  );

  // Teachers are real rows now, not a uuid that happens to appear on a learner.
  await prisma.$executeRawUnsafe(
    `insert into chat.teacher (id, account_id, name, is_active) values
       ('${ids.teacherId}'::uuid, '${accountOf[ids.teacherId]}'::uuid, 'teacher_c', true),
       ('${ids.newTeacherId}'::uuid, '${accountOf[ids.newTeacherId]}'::uuid, 'teacher_d', true)`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${ids.familyId}'::uuid, 'family_x', '${ids.ownerId}'::uuid, 'ar')`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.contact (id, account_id, family_id, name, role_preset, can_message, is_active) values
       ('${ids.parentId}'::uuid, '${accountOf[ids.parentId]}'::uuid, '${ids.familyId}'::uuid, 'parent_p', 'primary_guardian', true, true),
       ('${ids.otherParentId}'::uuid, '${accountOf[ids.otherParentId]}'::uuid, '${ids.familyId}'::uuid, 'parent_q', 'authorized_contact', true, true)`,
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
  return { ...ids, accounts: accountOf };
}

/** Order matters: children before parents. */
export async function truncate(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    truncate chat.message_receipt, chat.message_reaction, chat.message_attachment,
             chat.message_hidden_for, chat.message_approval, chat.call_participant,
             chat.call, chat.notification, chat.outbox_event,
             chat.conversation_participant_state, chat.conversation_member,
             chat.message, chat.conversation, chat.learner,
             chat.family_assignment, chat.contact, chat.family, chat.teacher,
             chat.staff, chat.session, chat.device, chat.account_token,
             chat.account_credential, chat.account_permission_override,
             chat.account, chat.event_log, chat.audit_log
    restart identity cascade`);
}
