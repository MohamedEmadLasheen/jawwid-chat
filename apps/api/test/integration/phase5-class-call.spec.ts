/**
 * PHASE 5 -- the class call.
 *
 * "Teacher is waiting. Please join the class."
 *
 * The properties under test: the call carries its own TYPE, the invitation
 * reaches the thread as well as the lock screen, the sentence is never hard
 * coded, the reminders are idempotent and cancellable, and a class nobody joins
 * is handled by the server.
 */
import { PrismaService } from '@platform/prisma.service';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { CallOutcome, CallStatus, CallType, NotificationStatus } from '@communication/contracts/vocab';

const prisma = new PrismaService();
const g = buildGraph();
let s: Scenario;

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
  g.coverage.onDutyId = s.ownerId;
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'test-secret-at-least-32-characters-long';
});
afterAll(async () => {
  await truncate(prisma);
  await prisma.$disconnect();
});

/** The learner's Student Group -- teacher, parent and the family's admin. */
async function studentGroup(): Promise<string> {
  const conv = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
  return conv.id;
}

describe('starting a class call', () => {
  it('is its own call type, distinguishable from an ordinary group call', async () => {
    const conversationId = await studentGroup();
    const started = await g.calls.startClassCall(conversationId, s.teacherId);

    const call = await prisma.call.findUniqueOrThrow({ where: { id: started.callId } });
    expect(call.type).toBe(CallType.CLASS);
    expect(call.status).toBe(CallStatus.RINGING);
    expect(call.ringExpiresAt).not.toBeNull();
  });

  it('posts the invitation into the thread, so the class survives a failed push', async () => {
    const conversationId = await studentGroup();
    const started = await g.calls.startClassCall(conversationId, s.teacherId);

    const messages = await prisma.message.findMany({
      where: { conversationId, type: 'system' },
      orderBy: { seq: 'desc' },
    });
    const invitation = messages.find((m) => (m.body ?? '').includes('class_call_started'));
    expect(invitation).toBeDefined();

    const payload = JSON.parse(invitation!.body!);
    expect(payload.callId).toBe(started.callId);
    expect(payload.kind).toBe('class_call_started');
  });

  it('carries NO English sentence -- the words live in a bilingual template', async () => {
    // The regression this guards: a literal "Teacher is waiting. Please join
    // the class." anywhere in the message body, the event payload or the call
    // row would freeze the academy's primary language out of its own product.
    const conversationId = await studentGroup();
    await g.calls.startClassCall(conversationId, s.teacherId);

    const bodies = (
      await prisma.message.findMany({ where: { conversationId }, select: { body: true } })
    ).map((m) => m.body ?? '');
    const events = (
      await prisma.outboxEvent.findMany({ select: { payload: true } })
    ).map((e) => JSON.stringify(e.payload));

    for (const text of [...bodies, ...events]) {
      expect(text).not.toContain('is waiting');
      expect(text).not.toContain('Please join');
    }

    // ...and the sentence really does exist, in both languages, as content.
    const ar = await g.templates.render('class_call_invitation', 'ar', {
      teacher_name: 'teacher_c',
      group_name: 'class',
    });
    const en = await g.templates.render('class_call_invitation', 'en', {
      teacher_name: 'teacher_c',
      group_name: 'class',
    });
    expect(ar!.body).toContain('teacher_c');
    expect(en!.body).toContain('is waiting');
  });

  it('refuses a class call outside a group conversation', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await expect(g.calls.startClassCall(direct.id, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.CLASS_CALL_REQUIRES_GROUP,
    });
  });

  it('refuses a parent trying to open the class (PD-2)', async () => {
    const conversationId = await studentGroup();
    await expect(g.calls.startClassCall(conversationId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.PARENT_CANNOT_START_GROUP_CALL,
    });
  });
});

describe('the reminder', () => {
  const scheduledFor = (callId: string, actorId: string) =>
    prisma.notification.findMany({
      where: {
        dedupeKey: { contains: `:${callId}:${actorId}` },
        status: NotificationStatus.SCHEDULED,
      },
    });

  it('schedules the configured reminders for everyone who has not joined', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.startClassCall(conversationId, s.teacherId);

    const parentReminders = await scheduledFor(callId, s.parentId);
    // Two rules in chat.notification_rule for 'class_call_started'. The
    // schedule is DATA -- changing it is an UPDATE, not a deploy.
    expect(parentReminders.length).toBe(2);
    expect(parentReminders.every((n) => n.templateKey === 'class_call_reminder')).toBe(true);
  });

  it('is idempotent -- re-running the schedule does not double the reminders', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.startClassCall(conversationId, s.teacherId);
    const before = await scheduledFor(callId, s.parentId);

    await g.reminders.scheduleForEvent('class_call_started', {
      subjectId: callId,
      anchorAt: new Date(),
      recipients: [{ actorId: s.parentId, locale: 'ar', role: 'participant' }],
      conversationId,
    });

    const after = await scheduledFor(callId, s.parentId);
    // The dedupe key is (rule, subject, recipient), so a replay converges.
    expect(after.length).toBe(before.length);
  });

  it('joining cancels THAT student’s reminders and nobody else’s', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.startClassCall(conversationId, s.teacherId);

    // A second recipient who has not joined.
    await g.reminders.scheduleForEvent('class_call_started', {
      subjectId: callId,
      anchorAt: new Date(),
      recipients: [{ actorId: s.otherParentId, locale: 'ar', role: 'participant' }],
      conversationId,
    });

    await g.calls.accept(callId, s.parentId);

    expect(await scheduledFor(callId, s.parentId)).toHaveLength(0);
    // The whole point of the per-recipient cancel: the student who has NOT
    // joined is still reminded that the teacher is waiting.
    expect((await scheduledFor(callId, s.otherParentId)).length).toBeGreaterThan(0);
  });

  it('ending the class cancels every outstanding reminder', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.startClassCall(conversationId, s.teacherId);
    await g.calls.accept(callId, s.parentId);

    await g.calls.end(callId, s.teacherId);

    expect(await scheduledFor(callId, s.parentId)).toHaveLength(0);
    expect(await scheduledFor(callId, s.otherParentId)).toHaveLength(0);
  });

  it('a class nobody joins is expired by the server and stops reminding', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.startClassCall(conversationId, s.teacherId);
    await prisma.call.updateMany({
      where: { id: callId },
      data: { ringExpiresAt: new Date(Date.now() - 1000) },
    });

    expect(await g.calls.expireRingingCalls()).toBe(1);

    const call = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(call.status).toBe(CallStatus.ENDED);
    expect(call.outcome).toBe(CallOutcome.MISSED);
    expect(await scheduledFor(callId, s.parentId)).toHaveLength(0);
  });
});
