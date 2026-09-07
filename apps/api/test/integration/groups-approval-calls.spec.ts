/**
 * Student groups, the approval workflow, the notification/reminder engine and
 * calling — against the real migrated database.
 */
import { CommErrorCode } from '@platform/errors';
import { QuietHoursService } from '@communication/notifications/quiet-hours.service';
import { TemplateService } from '@communication/notifications/template.service';
import { ReminderService } from '@communication/notifications/reminder.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

beforeAll(async () => { await g.prisma.$connect(); });
afterAll(async () => { await g.prisma.$disconnect(); });
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
});

// -------------------------------------------------------------------------
describe('student groups', () => {
  it('is built from Core relationships: parents, the teacher, and the family owner', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);

    const members = await g.prisma.conversationMember.findMany({
      where: { conversationId: group.id, leftAt: null },
    });
    const ids = members.map((m) => m.actorId).sort();
    expect(ids).toEqual([s.parentId, s.otherParentId, s.teacherId, s.ownerId].sort());
    expect(group.title).toContain('learner_l');
    expect(group.type).toBe('student_group');
  });

  it('is created once per learner, however many times it is requested', async () => {
    const a = await g.conversations.ensureStudentGroup(s.learnerId);
    const b = await g.conversations.ensureStudentGroup(s.learnerId);
    expect(b.id).toBe(a.id);
    expect(await g.prisma.conversation.count({ where: { type: 'student_group' } })).toBe(1);
  });

  it('the database refuses a second live group for the same learner', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.conversation (type, family_id, learner_id, title)
         values ('student_group', '${s.familyId}'::uuid, '${s.learnerId}'::uuid, 'duplicate')`,
      ),
    ).rejects.toThrow();
    expect(group.learnerId).toBe(s.learnerId);
  });

  it('a teacher change removes the old teacher, adds the new one, and says so', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    await g.prisma.$executeRawUnsafe(
      `update chat.learner set teacher_id = '${s.newTeacherId}'::uuid where id = '${s.learnerId}'::uuid`,
    );

    await g.conversations.syncStudentGroup(s.learnerId);

    const live = await g.prisma.conversationMember.findMany({
      where: { conversationId: group.id, leftAt: null },
    });
    expect(live.map((m) => m.actorId)).toContain(s.newTeacherId);
    expect(live.map((m) => m.actorId)).not.toContain(s.teacherId);

    // The departure is recorded, not erased.
    const departed = await g.prisma.conversationMember.findFirst({
      where: { conversationId: group.id, actorId: s.teacherId },
    });
    expect(departed!.leftAt).not.toBeNull();

    const system = await g.prisma.message.findMany({
      where: { conversationId: group.id, type: 'system' },
    });
    expect(system.length).toBeGreaterThanOrEqual(2); // created + membership changed
  });

  it('archiving keeps the history rather than deleting it', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    await g.messages.send({ conversationId: group.id, senderId: s.ownerId, body: 'welcome' });

    await g.conversations.archiveStudentGroup(s.learnerId, 'student left Jawwid', s.managerId);

    const after = await g.prisma.conversation.findUnique({ where: { id: group.id } });
    expect(after!.archivedAt).not.toBeNull();
    expect(await g.prisma.message.count({ where: { conversationId: group.id } })).toBeGreaterThan(0);

    // Archived conversations accept no new messages.
    await expect(
      g.messages.send({ conversationId: group.id, senderId: s.ownerId, body: 'after archive' }),
    ).rejects.toMatchObject({ code: CommErrorCode.CONVERSATION_ARCHIVED });
  });

  it('a teacher cannot add or remove a member', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    await expect(
      g.conversations.setMembership(
        group.id, s.teacherId,
        { actorId: s.otherParentId, actorKind: 'contact', memberRole: 'parent' },
        'add', 'because I want to',
      ),
    ).rejects.toMatchObject({ code: CommErrorCode.CANNOT_MANAGE_MEMBERSHIP });
  });

  it('a parent cannot remove the admin to be alone with the teacher', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    await expect(
      g.conversations.setMembership(
        group.id, s.parentId,
        { actorId: s.ownerId, actorKind: 'staff', memberRole: 'admin' },
        'remove', 'no reason',
      ),
    ).rejects.toMatchObject({ code: CommErrorCode.CANNOT_MANAGE_MEMBERSHIP });
  });
});

// -------------------------------------------------------------------------
describe('message approval', () => {
  async function groupWithPendingTeacherMessage() {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const msg = await g.messages.send({
      conversationId: group.id, senderId: s.teacherId, body: 'homework for tomorrow',
    });
    return { group, msg };
  }

  it('holds a teacher message when the group requires approval', async () => {
    const { msg } = await groupWithPendingTeacherMessage();
    expect(msg.moderation).toBe('pending');

    const approval = await g.prisma.messageApproval.findUnique({ where: { messageId: msg.id } });
    expect(approval!.decision).toBe('pending');
    expect(approval!.approverId).toBe(s.ownerId); // the family's active handler
  });

  it('a pending message is NOT delivered: no receipts exist for it', async () => {
    const { msg } = await groupWithPendingTeacherMessage();
    expect(await g.prisma.messageReceipt.count({ where: { messageId: msg.id } })).toBe(0);
  });

  it('the other group members cannot see a pending message', async () => {
    const { group } = await groupWithPendingTeacherMessage();

    const parentView = await g.messages.list({ conversationId: group.id, actorId: s.parentId });
    const bodies = parentView.messages.map((m) => m.body);
    expect(bodies).not.toContain('homework for tomorrow');
  });

  it('the sender sees their own message with its pending status', async () => {
    const { group } = await groupWithPendingTeacherMessage();
    const own = await g.messages.list({ conversationId: group.id, actorId: s.teacherId });
    const mine = own.messages.find((m) => m.body === 'homework for tomorrow');
    expect(mine).toBeDefined();
    expect(mine!.moderation).toBe('pending');
  });

  it('the approver sees it in the queue', async () => {
    const { msg } = await groupWithPendingTeacherMessage();
    const queue = await g.approvals.listPending(s.ownerId);
    expect(queue.map((a) => a.messageId)).toContain(msg.id);
  });

  it('approving publishes it and delivers it to the group', async () => {
    const { group, msg } = await groupWithPendingTeacherMessage();
    const approval = await g.prisma.messageApproval.findUnique({ where: { messageId: msg.id } });

    await g.approvals.approve(approval!.id, s.ownerId);

    const after = await g.prisma.message.findUnique({ where: { id: msg.id } });
    expect(after!.moderation).toBe('published');

    const parentView = await g.messages.list({ conversationId: group.id, actorId: s.parentId });
    expect(parentView.messages.map((m) => m.body)).toContain('homework for tomorrow');

    // Delivery only begins once it is approved.
    expect(await g.prisma.messageReceipt.count({ where: { messageId: msg.id } })).toBeGreaterThan(0);
  });

  it('rejecting requires a reason and stores it', async () => {
    const { msg } = await groupWithPendingTeacherMessage();
    const approval = await g.prisma.messageApproval.findUnique({ where: { messageId: msg.id } });

    await expect(g.approvals.reject(approval!.id, s.ownerId, '   ')).rejects.toMatchObject({
      code: CommErrorCode.APPROVAL_REASON_REQUIRED,
    });

    await g.approvals.reject(approval!.id, s.ownerId, 'please avoid sharing personal contact details');

    const decided = await g.prisma.messageApproval.findUnique({ where: { messageId: msg.id } });
    expect(decided!.decision).toBe('rejected');
    expect(decided!.rejectionReason).toMatch(/personal contact details/);

    const after = await g.prisma.message.findUnique({ where: { id: msg.id } });
    expect(after!.moderation).toBe('rejected');
  });

  it('a rejected message never becomes visible to the group', async () => {
    const { group, msg } = await groupWithPendingTeacherMessage();
    const approval = await g.prisma.messageApproval.findUnique({ where: { messageId: msg.id } });
    await g.approvals.reject(approval!.id, s.ownerId, 'not appropriate');

    const parentView = await g.messages.list({ conversationId: group.id, actorId: s.parentId });
    expect(parentView.messages.map((m) => m.body)).not.toContain('homework for tomorrow');
  });

  it('the approver cannot edit the message: the database refuses', async () => {
    const { msg } = await groupWithPendingTeacherMessage();
    await expect(
      g.prisma.$executeRawUnsafe(
        `update chat.message set body = 'edited by admin' where id = '${msg.id}'::uuid`,
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('a teacher cannot approve their own message', async () => {
    const { msg } = await groupWithPendingTeacherMessage();
    const approval = await g.prisma.messageApproval.findUnique({ where: { messageId: msg.id } });
    await expect(g.approvals.approve(approval!.id, s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.CANNOT_APPROVE,
    });
  });

  it('a parent cannot approve', async () => {
    const { msg } = await groupWithPendingTeacherMessage();
    const approval = await g.prisma.messageApproval.findUnique({ where: { messageId: msg.id } });
    await expect(g.approvals.approve(approval!.id, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CANNOT_APPROVE,
    });
  });

  /**
   * PHASE 1: two separate reasons an admin cannot decide, and they are checked
   * in this order on purpose.
   *
   * Scope comes first -- an admin who does not supervise the family never
   * reaches the handler question at all -- so the test asserts both: the
   * out-of-scope admin is refused for scope, and an admin who IS in scope but
   * is not the handler is still refused for the original reason. Asserting only
   * the first would let the handler rule rot behind the scope rule.
   */
  it('an admin outside the family\'s scope cannot decide', async () => {
    const { msg } = await groupWithPendingTeacherMessage();
    const approval = await g.prisma.messageApproval.findUnique({ where: { messageId: msg.id } });
    await expect(g.approvals.approve(approval!.id, s.otherAdminId)).rejects.toMatchObject({
      code: CommErrorCode.OUT_OF_SCOPE,
    });
  });

  it('an admin who is in scope but is not the active handler cannot decide', async () => {
    const { msg } = await groupWithPendingTeacherMessage();
    const approval = await g.prisma.messageApproval.findUnique({ where: { messageId: msg.id } });
    // Temporary cover puts the other admin inside the family's scope without
    // making them its handler.
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family_assignment (family_id, staff_id, kind, ends_at, reason)
       values ('${s.familyId}'::uuid, '${s.otherAdminId}'::uuid, 'temporary',
               now() + interval '1 day', 'test: cover')`,
    );
    await expect(g.approvals.approve(approval!.id, s.otherAdminId)).rejects.toMatchObject({
      code: CommErrorCode.CANNOT_APPROVE,
    });
  });

  it('a manager can always decide', async () => {
    const { msg } = await groupWithPendingTeacherMessage();
    const approval = await g.prisma.messageApproval.findUnique({ where: { messageId: msg.id } });
    await g.approvals.approve(approval!.id, s.managerId);
    const after = await g.prisma.message.findUnique({ where: { id: msg.id } });
    expect(after!.moderation).toBe('published');
  });

  it('a decision cannot be made twice', async () => {
    const { msg } = await groupWithPendingTeacherMessage();
    const approval = await g.prisma.messageApproval.findUnique({ where: { messageId: msg.id } });
    await g.approvals.approve(approval!.id, s.ownerId);
    await expect(g.approvals.approve(approval!.id, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.APPROVAL_ALREADY_DECIDED,
    });
  });

  it('an admin message in the group is published immediately', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const msg = await g.messages.send({
      conversationId: group.id, senderId: s.ownerId, body: 'admin announcement',
    });
    expect(msg.moderation).toBe('published');
    expect(await g.prisma.messageApproval.count({ where: { messageId: msg.id } })).toBe(0);
  });

  it('a pending message does not make the conversation look answered', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    await g.messages.send({ conversationId: group.id, senderId: s.parentId, body: 'question' });
    const conv = await g.prisma.conversation.findUnique({ where: { id: group.id } });
    // Held for approval, so the customer clock has not started.
    expect(conv!.lastCustomerMessageAt).toBeNull();
  });
});

// -------------------------------------------------------------------------
describe('notification and reminder engine', () => {
  it('the same dedupe key never produces two notifications', async () => {
    const key = 'class_reminder_t30m:session_1:parent_1';
    const first = await g.notifications.schedule({
      dedupeKey: key, templateKey: 'class_reminder', eventType: 'class_scheduled',
      recipientId: s.parentId, scheduledAt: new Date(),
    });
    const second = await g.notifications.schedule({
      dedupeKey: key, templateKey: 'class_reminder', eventType: 'class_scheduled',
      recipientId: s.parentId, scheduledAt: new Date(),
    });

    expect(second).toBe(first);
    expect(await g.prisma.notification.count({ where: { dedupeKey: key } })).toBe(1);
  });

  it('survives a concurrent burst of the same key', async () => {
    const key = 'renewal_d7:sub_9:parent_1';
    const ids = await Promise.all(
      Array.from({ length: 6 }, () =>
        g.notifications.schedule({
          dedupeKey: key, templateKey: 'renewal_reminder', eventType: 'renewal_due',
          recipientId: s.parentId, scheduledAt: new Date(),
        }),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await g.prisma.notification.count({ where: { dedupeKey: key } })).toBe(1);
  });

  it('re-running a reminder sweep does not double-schedule', async () => {
    const ctx = {
      subjectId: 'session_42',
      anchorAt: new Date('2026-09-10T09:00:00Z'),
      recipients: [{ actorId: s.parentId, locale: 'ar', role: 'parent' }],
      familyId: s.familyId,
      variables: { student_name: 'learner_l' },
    };
    await g.reminders.scheduleForEvent('class_scheduled', ctx);
    await g.reminders.scheduleForEvent('class_scheduled', ctx);

    const rows = await g.prisma.notification.findMany({ where: { eventType: 'class_scheduled' } });
    // Two rules (T-24h and T-30m), one recipient, scheduled twice -> still two rows.
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(2);
  });

  it('schedules each rule at its configured offset', async () => {
    const anchor = new Date('2026-09-10T09:00:00Z');
    await g.reminders.scheduleForEvent('class_scheduled', {
      subjectId: 'session_43', anchorAt: anchor,
      recipients: [{ actorId: s.parentId, locale: 'ar', role: 'parent' }],
    });

    const rows = await g.prisma.notification.findMany({
      where: { eventType: 'class_scheduled' }, orderBy: { scheduledAt: 'asc' },
    });
    expect(rows[0].scheduledAt.toISOString()).toBe('2026-09-09T09:00:00.000Z'); // T-24h
    expect(rows[1].scheduledAt.toISOString()).toBe('2026-09-10T08:30:00.000Z'); // T-30m
  });

  it('cancelling a subject leaves already-sent history alone', async () => {
    await g.reminders.scheduleForEvent('class_scheduled', {
      subjectId: 'session_44', anchorAt: new Date('2026-09-10T09:00:00Z'),
      recipients: [{ actorId: s.parentId, locale: 'ar', role: 'parent' }],
    });
    const cancelled = await g.reminders.cancelForSubject('session_44');
    expect(cancelled).toBe(2);

    const rows = await g.prisma.notification.findMany({ where: { eventType: 'class_scheduled' } });
    expect(rows.every((r) => r.status === 'cancelled')).toBe(true);
  });

  it('renders Arabic and English from the seeded templates', async () => {
    const ar = await g.templates.render('class_reminder', 'ar', {
      parent_name: 'أم أحمد', student_name: 'أحمد', class_time: '5:00', class_date: 'الأحد',
    });
    expect(ar!.body).toContain('أحمد');
    expect(ar!.title).toBe('جوّيد');

    const en = await g.templates.render('class_reminder', 'en', {
      parent_name: 'Umm Ahmed', student_name: 'Ahmed', class_time: '5:00pm', class_date: 'Sunday',
    });
    expect(en!.body).toContain('Ahmed');
    expect(en!.title).toBe('Jawwid');
  });

  it('falls back to Arabic when a locale has no template', async () => {
    const rendered = await g.templates.render('class_reminder', 'fr' as never, { student_name: 'X' });
    expect(rendered!.title).toBe('جوّيد');
  });

  it('leaves an unknown placeholder visible instead of rendering "undefined"', () => {
    expect(TemplateService.interpolate('hello {who}, {missing}', { who: 'Ahmed' }))
      .toBe('hello Ahmed, {missing}');
  });

  it('defers a notification out of quiet hours instead of dropping it', async () => {
    await g.prisma.quietHours.create({
      data: { actorId: s.parentId, timezone: 'UTC', startMinute: 1320, endMinute: 480 },
    });

    const atNight = new Date('2026-09-10T23:00:00Z'); // inside 22:00-08:00
    await g.notifications.schedule({
      dedupeKey: 'quiet:1', templateKey: 'renewal_reminder', eventType: 'renewal_due',
      recipientId: s.parentId, scheduledAt: atNight, respectQuietHours: true,
    });

    const row = await g.prisma.notification.findFirst({ where: { dedupeKey: 'quiet:1' } });
    expect(row!.scheduledAt.toISOString()).toBe('2026-09-11T08:00:00.000Z');
  });

  it('a rule marked exempt breaks through quiet hours', async () => {
    await g.prisma.quietHours.create({
      data: { actorId: s.parentId, timezone: 'UTC', startMinute: 1320, endMinute: 480 },
    });
    const atNight = new Date('2026-09-10T23:00:00Z');
    await g.notifications.schedule({
      dedupeKey: 'quiet:2', templateKey: 'incoming_call', eventType: 'call_started',
      recipientId: s.parentId, scheduledAt: atNight, respectQuietHours: false,
    });
    const row = await g.prisma.notification.findFirst({ where: { dedupeKey: 'quiet:2' } });
    expect(row!.scheduledAt.toISOString()).toBe(atNight.toISOString());
  });

  it('handles a quiet window that wraps past midnight', () => {
    expect(QuietHoursService.isQuiet(23 * 60, 1320, 480)).toBe(true);
    expect(QuietHoursService.isQuiet(2 * 60, 1320, 480)).toBe(true);
    expect(QuietHoursService.isQuiet(12 * 60, 1320, 480)).toBe(false);
  });

  it('does not claim DELIVERED when no platform acknowledged it', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'device-token-1', platform: 'android',
    });
    await g.notifications.schedule({
      dedupeKey: 'dispatch:1', templateKey: 'renewal_reminder', eventType: 'renewal_due',
      recipientId: s.parentId, scheduledAt: new Date(Date.now() - 1000),
    });

    await g.notifications.dispatchDue(new Date());

    const row = await g.prisma.notification.findFirst({ where: { dedupeKey: 'dispatch:1' } });
    expect(row!.status).toBe('sent');
    expect(row!.deliveredAt).toBeNull();
  });

  it('one actor may hold several device tokens', async () => {
    await g.notifications.registerDevice({ actorId: s.parentId, token: 'phone', platform: 'android' });
    await g.notifications.registerDevice({ actorId: s.parentId, token: 'tablet', platform: 'ios' });
    await g.notifications.registerDevice({ actorId: s.parentId, token: 'voip', platform: 'ios', isVoip: true });

    const active = await g.prisma.deviceToken.count({ where: { actorId: s.parentId, isActive: true } });
    expect(active).toBe(3);
  });

  it('builds a stable, readable dedupe key', () => {
    expect(ReminderService.dedupeKey('class_reminder_t30m', 'session_123', 'parent_45'))
      .toBe('class_reminder_t30m:session_123:parent_45');
  });
});

// -------------------------------------------------------------------------
describe('calling', () => {
  it('a group call includes the group members and mints a server-owned room', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const { callId, roomName } = await g.calls.start(group.id, s.ownerId);

    expect(roomName).toContain(group.id);
    const participants = await g.prisma.callParticipant.findMany({ where: { callId } });
    expect(participants.map((p) => p.actorId).sort())
      .toEqual([s.parentId, s.otherParentId, s.teacherId, s.ownerId].sort());
  });

  it('issues a short-lived token scoped to the one room', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const { callId, roomName } = await g.calls.start(group.id, s.ownerId);

    const token = await g.calls.issueToken(callId, s.teacherId);
    const claims = JSON.parse(Buffer.from(token.token.split('.')[1], 'base64').toString());

    expect(claims.video.room).toBe(roomName);
    expect(claims.sub).toBe(s.teacherId);
    expect(claims.video.roomCreate).toBe(false);
    expect(claims.exp - claims.nbf).toBeLessThanOrEqual(180);
    // The identity is an opaque uuid and a display name; never a phone number.
    //
    // A bare /\d{7,}/ scan is NOT a valid check here: uuid hex segments can be
    // all digits (e.g. "206f67036934"), which made this assertion flaky while
    // the behaviour was always correct. Assert the structure instead.
    expect(claims.sub).toMatch(/^[0-9a-f-]{36}$/);
    // PHASE 1: a real name from chat.teacher. It used to be the literal string
    // 'Teacher' for every teacher alive, because teacher identity did not
    // exist -- the name was synthesised beside a uuid taken off a learner row.
    expect(claims.name).toBe('teacher_c');
    expect(Object.keys(claims)).not.toContain(
      expect.stringMatching(/phone|tel|msisdn|email|mobile/i),
    );
    // Nothing anywhere in the token looks like a dialable number.
    expect(JSON.stringify(claims)).not.toMatch(/\+\d[\d\s()-]{6,}/);
  });

  it('refuses a token to someone who is not a participant', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const { callId } = await g.calls.start(group.id, s.ownerId);

    await expect(g.calls.issueToken(callId, s.otherAdminId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_A_PARTICIPANT,
    });
  });

  it('refuses a token for a call that has ended', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const { callId } = await g.calls.start(group.id, s.ownerId);
    await g.calls.end(callId, s.ownerId);

    await expect(g.calls.issueToken(callId, s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });
  });

  it('records the outcome and duration', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const { callId } = await g.calls.start(conv.id, s.ownerId);

    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.ownerId);

    const call = await g.prisma.call.findUnique({ where: { id: callId } });
    expect(call!.status).toBe('ended');
    expect(call!.outcome).toBe('answered');
    expect(call!.durationSeconds).not.toBeNull();
  });

  it('an unanswered call is recorded as missed', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const { callId } = await g.calls.start(conv.id, s.ownerId);
    await g.calls.end(callId, s.ownerId);

    const call = await g.prisma.call.findUnique({ where: { id: callId } });
    expect(call!.outcome).toBe('missed');
  });

  it('call history exposes no phone number', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await g.calls.start(conv.id, s.ownerId);

    const history = await g.calls.history(conv.id, s.parentId);
    expect(history).toHaveLength(1);
    expect(JSON.stringify(history)).not.toMatch(/phone|msisdn|\+\d{7,}/i);
  });

  it('a stranger cannot read another conversation’s call history', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await g.calls.start(conv.id, s.ownerId);

    await expect(g.calls.history(conv.id, s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.NOT_CONVERSATION_MEMBER,
    });
  });
});
