/**
 * PD-32 amendment (owner, 2026-11-03) -- the parent is told when the
 * administration answers their feedback.
 *
 *   1. the FIRST reply to praise, a suggestion or a complaint tells the parent
 *      who filed it: a Center entry that opens that one item, and a push.
 *      Changing a reply already sent tells no one.
 *   2. an app complaint going received -> in review (taken, replied to, or
 *      followed up) tells the parent once; its resolution tells them once. The
 *      complaint lifecycle itself is unchanged.
 *   3. the parent's push switch and quiet hours are kept; a push that cannot be
 *      sent never undoes the reply.
 *   4. a reply is unread per parent account until that account opens it.
 *   5. what is sent is generic: never the parent's words, the reply, the
 *      teacher or the child. The teacher and the family's other parent are not
 *      told.
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { TeacherFileService, advanceParentFeedback } from '../../src/teacher-file/teacher-file.service';
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit);
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit);
const realtime = { toThread: async () => undefined, toThreadAudience: async () => undefined, toUsers: async () => undefined };
const worker = new OutboxWorker(g.prisma, g.notifications, realtime as never, g.identity, g.pipeline);

jest.setTimeout(120_000);

let s: Scenario;
let tsupId: string;

const file = (category: string, body = 'secret words of the parent') =>
  feedback.file(s.parentId, { learnerId: s.learnerId, category, body });
const items = (recipientId: string, eventType?: string) =>
  g.prisma.notificationItem.findMany({ where: { recipientId, ...(eventType ? { eventType } : {}) }, orderBy: { createdAt: 'asc' } });
const pushes = (recipientId: string, ruleKey?: string) =>
  g.prisma.notification.findMany({ where: { recipientId, ...(ruleKey ? { ruleKey } : {}) } });
const notices = () => g.prisma.outboxEvent.findMany({ where: { type: 'family_feedback.notice' }, orderBy: { createdAt: 'asc' } });
const unread = async (parentId: string, id: string) =>
  (await feedback.mine(parentId)).feedback.find((f) => f.id === id)?.replyUnread;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  tsupId = randomUUID();
  const tmgrId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_n', 'admin', true), ($2::uuid, 'tmgr_n', 'manager', true)`,
    tsupId,
    tmgrId,
  );
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`,
    tmgrId,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId,
    dept,
  );
});

describe('1. the first reply tells the parent who filed it', () => {
  it.each(['praise', 'suggestion', 'complaint'])('%s: an entry that opens the item, and one push; changing the reply tells no one', async (category) => {
    const filed = await file(category);
    await feedback.reply(tsupId, filed.id, { response: 'Thank you, we are on it.' });
    await feedback.reply(tsupId, filed.id, { response: 'Thank you, we are on it (edited).' });
    await worker.drain(100);
    await worker.drain(100);

    const [entry, ...rest] = await items(s.parentId, 'feedback_replied');
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ category: 'conversation', subjectType: 'feedback', subjectId: filed.id, templateKey: 'inbox.feedback_replied' });
    expect(entry?.action).toEqual({ kind: 'open_feedback', feedbackId: filed.id });
    expect(entry?.refs).toEqual({ feedbackId: filed.id });
    const sent = await pushes(s.parentId, 'feedback_replied');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ templateKey: 'feedback_replied', channel: 'push' });
    // The reply itself is the edited one.
    expect((await feedback.mine(s.parentId)).feedback[0].response).toBe('Thank you, we are on it (edited).');
  });

  it('the family\'s other parent and the teacher are not told; nothing sent carries the words, the reply, the teacher or the child', async () => {
    const filed = await file('praise');
    await feedback.reply(tsupId, filed.id, { response: 'private reply text', resolve: true });
    await worker.drain(100);

    expect(await items(s.otherParentId)).toEqual([]);
    expect(await items(s.teacherId)).toEqual([]);
    const all = JSON.stringify({
      entries: await g.prisma.notificationItem.findMany({ where: { recipientId: s.parentId } }),
      pushes: await pushes(s.parentId),
      events: await notices(),
    });
    expect(all).not.toMatch(/secret|private reply|learner_l|teacher_t/);
  });

  it.each(['ar', 'en'])('the parent is told in their family\'s language (%s), as every parent notification is', async (lang) => {
    await g.prisma.$executeRawUnsafe(`update chat.family set language = $1 where id = $2::uuid`, lang, s.familyId);
    const filed = await file('suggestion');
    await feedback.reply(tsupId, filed.id, { response: 'Noted.' });
    await worker.drain(100);
    const [push] = await pushes(s.parentId, 'feedback_replied');
    expect(push?.locale).toBe(lang);
    const [entry] = await items(s.parentId, 'feedback_replied');
    expect(entry?.locale).toBe(lang);
  });
});

describe('2. a parent\'s app complaint: in review, then resolved -- once each', () => {
  it('taken -> "in review"; replied -> "replied"; resolved on the Teacher File -> "resolved"; never twice', async () => {
    const filed = await file('complaint');
    const entry = await g.prisma.teacherSupervisionEntry.findUniqueOrThrow({ where: { parentFeedbackId: filed.id } });

    await feedback.take(tsupId, filed.id);
    await feedback.take(tsupId, filed.id);
    await feedback.reply(tsupId, filed.id, { response: 'We are looking into it.' });
    await files.addEntry(tsupId, s.teacherId, { kind: 'complaint_followup', body: 'Internal: spoke to the teacher.', refersTo: entry.id });
    await files.addEntry(tsupId, s.teacherId, { kind: 'complaint_resolution', body: 'Internal: warned.', refersTo: entry.id });
    // A follow-up after the resolution leaves it resolved and tells no one.
    await files.addEntry(tsupId, s.teacherId, { kind: 'complaint_followup', body: 'Checked again.', refersTo: entry.id });
    await worker.drain(100);
    await worker.drain(100);

    expect((await notices()).map((e) => (e.payload as { notice: string }).notice)).toEqual(['complaint_in_review', 'replied', 'complaint_resolved']);
    for (const kind of ['feedback_complaint_in_review', 'feedback_replied', 'feedback_complaint_resolved']) {
      expect(await items(s.parentId, kind)).toHaveLength(1);
      expect(await pushes(s.parentId, kind)).toHaveLength(1);
    }
    expect((await feedback.mine(s.parentId)).feedback[0].status).toBe('resolved');
    expect(JSON.stringify(await g.prisma.notificationItem.findMany())).not.toMatch(/Internal|warned|looking into/);
  });

  it('a reply racing the complaint\'s resolution waits for it: the status stays resolved, and "in review" is never said after "resolved"', async () => {
    const filed = await file('complaint');
    const entry = await g.prisma.teacherSupervisionEntry.findUniqueOrThrow({ where: { parentFeedbackId: filed.id } });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let resolvedInTx!: () => void;
    const resolving = new Promise<void>((r) => (resolvedInTx = r));
    // The resolution is written but not committed while the reply starts.
    const resolution = g.prisma.$transaction(
      async (tx) => {
        await advanceParentFeedback(tx, entry.id, 'resolved');
        resolvedInTx();
        await held;
      },
      { timeout: 30_000 },
    );
    await resolving;
    const reply = feedback.reply(tsupId, filed.id, { response: 'We are looking into it.' });
    await new Promise((r) => setTimeout(r, 300));
    release();
    await resolution;
    await reply;
    await worker.drain(100);

    expect((await feedback.mine(s.parentId)).feedback[0].status).toBe('resolved');
    expect((await notices()).map((e) => (e.payload as { notice: string }).notice)).toEqual(['complaint_resolved', 'replied']);
  });

  it('a first reply to a received complaint also moves it into review, and says both', async () => {
    const filed = await file('complaint');
    await feedback.reply(tsupId, filed.id, { response: 'Sorry to hear this.' });
    await worker.drain(100);
    expect((await notices()).map((e) => (e.payload as { notice: string }).notice)).toEqual(['complaint_in_review', 'replied']);
  });

  it('a follow-up is what moves it into review when nobody took it first', async () => {
    const filed = await file('complaint');
    const entry = await g.prisma.teacherSupervisionEntry.findUniqueOrThrow({ where: { parentFeedbackId: filed.id } });
    await files.addEntry(tsupId, s.teacherId, { kind: 'complaint_followup', body: 'Internal.', refersTo: entry.id });
    await worker.drain(100);
    expect(await items(s.parentId, 'feedback_complaint_in_review')).toHaveLength(1);
  });

  it('taking praise or a suggestion tells no one; a complaint still cannot be resolved by a reply', async () => {
    const praise = await file('praise');
    const complaint = await file('complaint');
    await feedback.take(tsupId, praise.id);
    expect(await code(feedback.reply(tsupId, complaint.id, { response: 'Done.', resolve: true }))).toBe(CommErrorCode.FEEDBACK_STATE);
    await worker.drain(100);
    expect(await items(s.parentId)).toEqual([]);
  });
});

describe('3. the parent\'s preferences and quiet hours; a failed push never undoes the reply', () => {
  it('push switched off for "conversation": the entry, no push', async () => {
    await g.prisma.notificationPreference.create({
      data: { actorId: s.parentId, organizationId: (await g.prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } })).organizationId, category: 'conversation', channel: 'push', enabled: false },
    });
    const filed = await file('praise');
    await feedback.reply(tsupId, filed.id, { response: 'Thanks.' });
    await worker.drain(100);
    const [entry] = await items(s.parentId, 'feedback_replied');
    expect(entry?.pushState).toBe('opted_out');
    expect(await pushes(s.parentId, 'feedback_replied')).toEqual([]);
  });

  it('inside the parent\'s quiet hours: the entry now, the push at the end of the window', async () => {
    const orgId = (await g.prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } })).organizationId;
    // A window covering the whole day except one minute, in UTC: now is inside it.
    const nowMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
    const end = (nowMin + 120) % 1440;
    const start = (nowMin + 121) % 1440;
    await g.prisma.quietHours.create({ data: { actorId: s.parentId, organizationId: orgId, enabled: true, startMinute: start, endMinute: end, timezone: 'UTC' } });
    const filed = await file('praise');
    const before = Date.now();
    await feedback.reply(tsupId, filed.id, { response: 'Thanks.' });
    await worker.drain(100);
    expect(await items(s.parentId, 'feedback_replied')).toHaveLength(1);
    const [push] = await pushes(s.parentId, 'feedback_replied');
    expect(push!.scheduledAt.getTime()).toBeGreaterThan(before + 60 * 60_000);
  });

  it('the pipeline failing: the reply is saved, the notice is retried rather than lost', async () => {
    const filed = await file('suggestion');
    const spy = jest.spyOn(g.pipeline, 'emit').mockRejectedValueOnce(new Error('push transport down'));
    try {
      await feedback.reply(tsupId, filed.id, { response: 'Saved regardless.' });
      await worker.drain(100);
    } finally {
      spy.mockRestore();
    }
    expect((await feedback.mine(s.parentId)).feedback[0].response).toBe('Saved regardless.');
    const [event] = await notices();
    expect(event?.status).not.toBe('published');
    expect(event?.attempts).toBe(1);
    expect(await items(s.parentId)).toEqual([]);

    // Its retry, once the backoff has passed, delivers it -- once.
    await worker.drain(100, new Date(Date.now() + 60_000));
    await worker.drain(100, new Date(Date.now() + 60_000));
    expect(await items(s.parentId, 'feedback_replied')).toHaveLength(1);
    expect(await pushes(s.parentId, 'feedback_replied')).toHaveLength(1);
  });
});

describe('4. unread per parent account, until that account opens the reply', () => {
  it('no reply: not unread; a reply: unread for each parent until they open it; changing it does not bring the dot back', async () => {
    const filed = await file('praise');
    expect(await unread(s.parentId, filed.id)).toBe(false);
    await feedback.reply(tsupId, filed.id, { response: 'Thank you.' });
    expect(await unread(s.parentId, filed.id)).toBe(true);
    expect(await unread(s.otherParentId, filed.id)).toBe(true);

    await feedback.replySeen(s.parentId, filed.id);
    await feedback.replySeen(s.parentId, filed.id);
    expect(await unread(s.parentId, filed.id)).toBe(false);
    expect(await unread(s.otherParentId, filed.id)).toBe(true);

    await feedback.reply(tsupId, filed.id, { response: 'Thank you (edited).' });
    expect(await unread(s.parentId, filed.id)).toBe(false);
  });

  it('opening a reply that is not there yet records nothing; only a parent of the family may', async () => {
    const filed = await file('praise');
    await feedback.replySeen(s.parentId, filed.id);
    await feedback.reply(tsupId, filed.id, { response: 'Thank you.' });
    expect(await unread(s.parentId, filed.id)).toBe(true);

    expect(await code(feedback.replySeen(s.teacherId, filed.id))).toBe(CommErrorCode.FEEDBACK_DENIED);
    expect(await code(feedback.replySeen(tsupId, filed.id))).toBe(CommErrorCode.FEEDBACK_DENIED);
    expect(await code(feedback.replySeen(s.parentId, randomUUID()))).toBe(CommErrorCode.FEEDBACK_NOT_FOUND);
    expect(await code(feedback.replySeen(s.parentId, 'not-a-uuid'))).toBe(CommErrorCode.FEEDBACK_NOT_FOUND);

    // A parent of another family: the same answer as no such item, and nothing recorded.
    const strangerFamily = randomUUID();
    const stranger = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family (id, display_name, owner_id, language) values ($1::uuid, 'family_z', $2::uuid, 'ar')`,
      strangerFamily,
      s.ownerId,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active) values ($1::uuid, $2::uuid, 'parent_z', 'primary_guardian', true, true)`,
      stranger,
      strangerFamily,
    );
    expect(await code(feedback.replySeen(stranger, filed.id))).toBe(CommErrorCode.FEEDBACK_NOT_FOUND);
    expect(await g.prisma.parentFeedbackReplySeen.count({ where: { feedbackId: filed.id } })).toBe(0);
  });
});
