import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { AuthorizationService } from '@platform/authorization.service';
import { AppConfigService } from '@platform/app-config.service';
import { PrismaIdentityService } from '@platform/identity.service';
import type { IdentityService } from '@platform/identity.service';
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
import { StoryService } from '@communication/stories/story.service';
import { StoryAudienceResolver } from '@communication/stories/story-audience.resolver';
import { StorySweeper } from '@communication/stories/story-sweeper.service';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
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

/**
 * @param wrapIdentity Wraps the real identity service before the graph is built,
 *   so a suite can OBSERVE identity resolution without stubbing its answers. Used
 *   by `message-author-identity.spec.ts` to assert that a page costs one batch
 *   rather than one lookup per row — a property no assertion on the response
 *   shape can see. Default is identity, so every existing caller is unaffected.
 */
export function buildGraph(
  wrapIdentity: (inner: IdentityService) => IdentityService = (inner) => inner,
) {
  const prisma = new PrismaService();
  const coverage = new PinnedCoverage();
  const identity = wrapIdentity(new PrismaIdentityService(prisma));
  const audit = new PrismaAuditService();
  const authz = new AuthorizationService(coverage);
  const outbox = new OutboxService();
  const config = new AppConfigService(prisma);
  const storage = new SignedLocalObjectStorage();
  // The real relationship implementation, against the same database. Since
  // PD-7 it opens no channel, but it is still wired as production wires it.
  const relationships = new PrismaRelationshipService(prisma);

  const conversations = new ConversationService(
    prisma, authz, outbox, identity, coverage, audit, relationships,
  );
  const attachments = new AttachmentService(prisma, authz, conversations, storage);
  const messages = new MessageService(
    prisma, authz, conversations, outbox, config, attachments, audit, identity,
  );
  const approvals = new ApprovalService(
    prisma, authz, conversations, attachments, outbox, audit, identity,
  );
  const templates = new TemplateService(prisma);
  const quietHours = new QuietHoursService(prisma);
  const notifications = new NotificationService(prisma, templates, quietHours, config, new LoggingPushProvider());
  const reminders = new ReminderService(prisma, notifications);
  const calls = new CallService(
    prisma, authz, conversations, outbox, config, identity, audit, new LiveKitTokenIssuer(),
  );
  const storyAudience = new StoryAudienceResolver(prisma);
  const stories = new StoryService(
    prisma, authz, storyAudience, outbox, config, identity, storage, audit,
  );
  const storySweeper = new StorySweeper(prisma, config, outbox, storage);

  // A worker whose realtime publisher is a no-op: these suites assert on what
  // reaches the DATABASE (notifications, outbox status), and a socket server in
  // a jest process would be a second thing to tear down.
  const silentRealtime = { toThread: async () => undefined, toUsers: async () => undefined };
  const outboxWorker = new OutboxWorker(prisma, notifications, silentRealtime as never, identity);

  return {
    prisma, coverage, identity, authz, conversations, messages, approvals,
    attachments, notifications, reminders, templates, quietHours, calls,
    stories, storyAudience, storySweeper, storage, outboxWorker,
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
  /** A real, active teacher who teaches NOBODY in this family, so the pair
   *  (unrelatedTeacherId, parentId) has no authorized relationship, and who is
   *  a member of nothing -- the outsider every isolation case needs. Under
   *  PD-7 the relationship no longer opens a direct channel, but it is still
   *  the academy's fact (chat.teacher_parent_authorized) and is still asserted
   *  on its own. A nonexistent id would prove only that unknown ids are denied. */
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

/**
 * A direct teacher <-> parent conversation as the PD-6 window left it.
 *
 * PD-7 (2026-10-14) restored BR-1: neither the API nor the database will
 * create this conversation any more (canOpenDirect refuses, and
 * chat.enforce_direct_conversation_rules raises check_violation on the member
 * INSERT). But the rows PD-6 created still exist in a real database, and the
 * rule for them -- readable history, nothing new accepted -- can only be
 * proven against such a row. So the fixture writes it the one way that
 * bypasses every trigger: `session_replication_role = replica`, LOCAL to one
 * transaction so it cannot leak into a pooled connection. Exactly what the
 * PD-6 code wrote: a direct conversation keyed like getOrCreateDirect, filed
 * under the parent's family, with a parent and a teacher member.
 */
export async function legacyTeacherParentDirect(
  prisma: PrismaService,
  teacherId: string,
  parentId: string,
  familyId: string,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    const conv = await tx.conversation.create({
      data: {
        type: 'direct',
        directKey: ConversationService.directKey(teacherId, parentId),
        familyId,
        title: null,
      },
    });
    await tx.conversationMember.createMany({
      data: [
        { conversationId: conv.id, actorId: parentId, actorKind: 'contact', memberRole: 'parent' },
        { conversationId: conv.id, actorId: teacherId, actorKind: 'teacher', memberRole: 'teacher' },
      ],
    });
    return conv.id;
  });
}

/**
 * A direct call still RINGING in a PD-6-era teacher <-> parent conversation
 * (see legacyTeacherParentDirect). chat.enforce_call_participant_rules refuses
 * the participant INSERT under PD-7, so it is written with triggers bypassed
 * for the same reason and in the same transaction-local way. What it proves
 * is the PD-7 rule for a call that was already ringing when the policy
 * changed: it can be ended, never answered.
 */
export async function legacyTeacherParentCall(
  prisma: PrismaService,
  conversationId: string,
  initiatorId: string,
  participants: { teacherId: string; parentId: string },
  familyId: string,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    const call = await tx.call.create({
      data: {
        conversationId,
        familyId,
        initiatorId,
        type: 'direct',
        roomName: `jawwid-${conversationId}-${randomUUID()}`,
        status: 'ringing',
      },
    });
    await tx.callParticipant.createMany({
      data: [
        { callId: call.id, actorId: participants.parentId, actorKind: 'contact' },
        { callId: call.id, actorId: participants.teacherId, actorKind: 'teacher' },
      ],
    });
    return call.id;
  });
}

/** Order matters: children before parents. */
export async function truncate(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    truncate chat.story_view, chat.story_recipient, chat.story_audience, chat.story,
             chat.message_receipt, chat.message_reaction, chat.message_attachment,
             chat.message_hidden_for, chat.message_approval, chat.call_participant,
             chat.call, chat.notification, chat.outbox_event,
             chat.conversation_participant_state, chat.conversation_member,
             chat.message, chat.conversation, chat.learner,
             chat.contact, chat.family, chat.staff, chat.teacher,
             chat.event_log, chat.audit_log, chat.principal_revocation
    restart identity cascade`);
}
