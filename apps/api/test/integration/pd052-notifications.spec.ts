/**
 * PD-52 PR-6 (plan §7) -- who is told about a complaint or a parent's praise.
 *
 *   complaint  (a parent's from the app, or a staff complaint naming a family)
 *              the teacher's supervisor -- here the Teachers manager, the
 *              fallback -- and the child's PD-8 supervisor: a 'task' entry that
 *              opens Attendance & Complaints, and a push
 *   praise     the teacher's supervisor: an entry only, never a push
 *   never      the teacher, the one who filed it, another family's
 *              supervisor, a suggestion; the parent's words in what is sent
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
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
let tmgr: string;

const items = (recipientId: string, eventType?: string) =>
  g.prisma.notificationItem.findMany({ where: { recipientId, ...(eventType ? { eventType } : {}) } });
const pushes = (recipientId: string, ruleKey: string) => g.prisma.notification.findMany({ where: { recipientId, ruleKey } });

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
  tmgr = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_r', 'manager', true)`, tmgr);
  await g.prisma.$executeRawUnsafe(`insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid)`, tmgr);
});

describe('PD-52 PR-6: who is told', () => {
  it('a parent\'s complaint: the teacher\'s supervisor and the child\'s supervisor -- an entry that opens the page, and a push; nobody else', async () => {
    const filed = await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'complaint', body: 'secret words of the parent' });
    await worker.drain(100);

    for (const who of [tmgr, s.ownerId]) {
      const [entry] = await items(who, 'teacher_complaint_received');
      expect(entry).toMatchObject({ category: 'task', subjectType: 'teacher_complaint' });
      expect(entry?.action).toEqual({ kind: 'open_teacher_records', teacherId: s.teacherId, page: 'attendance' });
      expect(await pushes(who, 'teacher_complaint_received')).toHaveLength(1);
    }
    // admin_b supervises no child of family_x; the teacher is never told.
    expect(await items(s.otherAdminId)).toEqual([]);
    expect(await items(s.teacherId)).toEqual([]);
    const sent = JSON.stringify({ entries: await g.prisma.notificationItem.findMany(), pushes: await g.prisma.notification.findMany() });
    expect(sent).not.toMatch(/secret/);
    expect(filed.id).toBeDefined();
  });

  it('a parent\'s praise: the teacher\'s supervisor, an entry only -- no push; a suggestion tells no one', async () => {
    await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'praise', body: 'Kind and patient.' });
    await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'suggestion', body: 'More homework.' });
    await worker.drain(100);

    const [entry] = await items(tmgr, 'teacher_praise_received');
    expect(entry).toMatchObject({ pushState: 'none' });
    expect(entry?.action).toEqual({ kind: 'open_teacher_records', teacherId: s.teacherId, page: 'grants' });
    expect(await pushes(tmgr, 'teacher_praise_received')).toEqual([]);
    expect(await items(s.ownerId)).toEqual([]);
    expect((await g.prisma.outboxEvent.findMany({ where: { type: { startsWith: 'teacher_records.' } } })).map((e) => e.type)).toEqual([
      'teacher_records.praise_received',
    ]);
  });

  it('a staff complaint naming a child: its follow-up people, never its author; a teacher-level one is not announced; once each', async () => {
    // admin_a (family_x's supervisor) files it: the Teachers manager is told, admin_a is not.
    await files.addEntry(s.ownerId, s.teacherId, { kind: 'complaint', body: 'Late again.', source: 'parent', learnerId: s.learnerId });
    // The Teachers manager files a management complaint about the teacher alone: no event.
    await files.addEntry(tmgr, s.teacherId, { kind: 'complaint', body: 'Missed the meeting.', source: 'management' });
    await worker.drain(100);
    await worker.drain(100);

    expect(await items(tmgr, 'teacher_complaint_received')).toHaveLength(1);
    expect(await items(s.ownerId)).toEqual([]);
    const events = await g.prisma.outboxEvent.findMany({ where: { type: 'teacher_records.complaint_received' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'published', attempts: 1, lastError: null });
  });
});
