import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { AuthorizationService } from '@platform/authorization.service';
import { AppConfigService } from '@platform/app-config.service';
import { PrismaIdentityService } from '@platform/identity.service';
import { ScopeService } from '@platform/scope.service';
import { AuthService } from '@platform/auth/auth.service';
import { AccountService } from '@platform/auth/account.service';
import { SessionService } from '@platform/auth/session.service';
import { ThrottleService } from '@platform/auth/throttle.service';
import { FamilyService } from '@platform/families/family.service';
import { LearnerService } from '@platform/learners/learner.service';
import { GroupService } from '@platform/groups/group.service';
import { LabelService } from '@platform/labels/label.service';
import { UserAdminService } from '@platform/users/user-admin.service';
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

// Test-only signing secrets. Distinct and long enough, exactly as the startup
// check demands in a real environment -- a harness that relaxed the rule would
// stop the tests from exercising the code paths that depend on it.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

/** on_duty() is AI #1's engine; tests pin it so they assert OUR behaviour. */
export class PinnedCoverage implements CoverageService {
  constructor(public onDutyId: string | null = null) {}
  async onDuty(): Promise<string | null> {
    return this.onDutyId;
  }
}

/**
 * The connection string for the least-privileged runtime role.
 *
 * scripts/db/integration-db.sh gives chat_app a LOGIN and a throwaway local
 * password, exactly as a deployment's secret store does -- migrations create it
 * NOLOGIN because a migration must never carry a credential.
 */
export function appDatabaseUrl(): string {
  return (
    process.env.DATABASE_APP_URL ??
    'postgres://chat_app:chat_app@localhost:55433/jawwid_chat_int'
  );
}

export function buildGraph() {
  return buildGraphOn(new PrismaService());
}

/**
 * The same object graph, on a caller-supplied connection.
 *
 * test/integration/runtime-rls.spec.ts uses it to run the REAL services against
 * the chat_app role, which is the only way to prove that least privilege does
 * not take the product down.
 */
export function buildGraphOn(prisma: PrismaService) {
  const coverage = new PinnedCoverage();
  const identity = new PrismaIdentityService(prisma);
  const audit = new PrismaAuditService();
  const authz = new AuthorizationService(coverage);
  const outbox = new OutboxService();
  const config = new AppConfigService(prisma);
  const storage = new SignedLocalObjectStorage();

  const scope = new ScopeService(prisma);
  const sessions = new SessionService(prisma, config, audit);
  const accounts = new AccountService(prisma, config, sessions, audit);
  const throttle = new ThrottleService(prisma, config);
  const auth = new AuthService(prisma, config, sessions, accounts, throttle, identity, audit);
  const userAdmin = new UserAdminService(prisma, authz, accounts, sessions, audit);

  const conversations = new ConversationService(prisma, authz, scope, outbox, identity, coverage, audit);
  // Phase 3: FamilyService re-syncs student groups after a supervisor transfer
  // (defect P3-1), so it is constructed after the conversation engine it uses.
  const families = new FamilyService(prisma, authz, scope, conversations, audit);
  const learners = new LearnerService(prisma, authz, scope, conversations, audit);
  const groups = new GroupService(prisma, authz, scope, audit);
  const labels = new LabelService(prisma, authz, scope, audit);
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
    config, sessions, accounts, auth, throttle, families, userAdmin, learners,
    groups, labels,
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
             chat.message_hidden_for, chat.message_revision,
             chat.message_approval, chat.call_participant,
             chat.call, chat.notification, chat.outbox_event,
             chat.conversation_participant_state, chat.conversation_member,
             chat.message, chat.conversation,
             chat.group_member, chat.group_teacher, chat.group,
             chat.family_label, chat.label,
             chat.learner_teacher_assignment, chat.learner,
             chat.family_assignment, chat.contact, chat.family, chat.teacher,
             chat.staff, chat.session, chat.device, chat.account_token,
             chat.account_credential, chat.account_permission_override,
             chat.account, chat.event_log, chat.audit_log
    restart identity cascade`);
}
