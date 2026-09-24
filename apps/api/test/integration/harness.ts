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
import { PrismaRelationshipService } from '@platform/relationship.service';

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
  // PD-6. The real implementation, against the same database: the harness must
  // not be able to authorize a relationship the running system would refuse.
  const relationships = new PrismaRelationshipService(prisma);

  const conversations = new ConversationService(
    prisma, authz, outbox, identity, coverage, audit, relationships,
  );
  const attachments = new AttachmentService(prisma, authz, conversations, storage);
  const messages = new MessageService(prisma, authz, conversations, outbox, config, attachments, audit);
  const approvals = new ApprovalService(prisma, authz, conversations, attachments, outbox, audit);
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
    relationships,
    // Exposed so a suite can drive the outbox itself: config for a worker it
    // builds, outbox to enqueue inside its own transaction.
    config, outbox,
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
  /** PD-6: a real, active teacher who teaches NOBODY in this family, so the
   *  pair (unrelatedTeacherId, parentId) has no authorized relationship. The
   *  negative half of every PD-6 assertion needs a teacher that exists --
   *  a nonexistent id would prove only that unknown ids are denied. */
  unrelatedTeacherId: string;
  learnerId: string;
}

/**
 * Write a teacher <-> learner assignment the way ingestion will.
 *
 * `chat.learner.teacher_id` is the academy's fact and is trigger-guarded
 * (`learner_assignment_is_guarded`, PD-6/OD-04): Chat-side edits are refused.
 * Fixtures are not a Chat-side edit -- they stand in for assignment state that
 * arrives from the academy -- so they open the same gate the future ingestion
 * opens. The setting is transaction-local, which is why the gate and the write
 * have to travel together in one `$transaction`.
 */
export async function withAssignmentGate(
  prisma: PrismaService,
  sql: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`select set_config('chat.syncing_assignment', 'on', true)`),
    prisma.$executeRawUnsafe(sql),
  ]);
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
    unrelatedTeacherId: randomUUID(),
    learnerId: randomUUID(),
  };

  await prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ('${ids.ownerId}'::uuid, 'admin_a', 'admin', true),
       ('${ids.otherAdminId}'::uuid, 'admin_b', 'admin', true),
       ('${ids.managerId}'::uuid, 'manager_c', 'manager', true)`,
  );
  // chat.learner.teacher_id is a foreign key to chat.teacher since the PR-A
  // identity foundation, so the teachers must exist before the learners do.
  // Active, because these two stand in for provisioned teachers.
  await prisma.$executeRawUnsafe(
    `insert into chat.teacher (id, name, is_active) values
       ('${ids.teacherId}'::uuid, 'teacher_c', true),
       ('${ids.newTeacherId}'::uuid, 'teacher_d', true),
       ('${ids.unrelatedTeacherId}'::uuid, 'teacher_e', true)`,
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
  await withAssignmentGate(
    prisma,
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${ids.learnerId}'::uuid, '${ids.familyId}'::uuid, 'learner_l', '${ids.teacherId}'::uuid)`,
  );
  // A second learner for the reassignment cases. Since PR-A both teachers are
  // resolvable from chat.teacher in their own right, not by appearing here.
  await withAssignmentGate(
    prisma,
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${randomUUID()}'::uuid, '${ids.familyId}'::uuid, 'learner_m', '${ids.newTeacherId}'::uuid)`,
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
             chat.message, chat.conversation, chat.learner,
             chat.contact, chat.family, chat.staff, chat.teacher,
             chat.event_log, chat.audit_log
    restart identity cascade`);
}
