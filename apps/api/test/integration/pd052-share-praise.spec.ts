/**
 * PD-52 PR-8 · "Share with the teacher" (docs/product/pd052-teacher-records-pages-plan.md §11 c).
 *
 *   1. sharing a parent's praise posts one card in the teacher's supervision
 *      chat: the child's first name and the parent's words, never the parent's
 *      name; page B then shows it as shared
 *   2. a praise is shared once: a second share is 409, and two shares racing
 *      post one card
 *   3. only a praise the caller can see: another family's praise, a complaint,
 *      a suggestion and an unknown id are 404; without grants.record, 403
 *
 * The seed's PD-8 structure: admin_a (s.ownerId) supervises family_x;
 * admin_b (s.otherAdminId) does not. Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { PermissionService } from '@platform/permissions/permission.service';
import { CommError } from '@platform/errors';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { TeacherRecordsService } from '../../src/teacher-file/teacher-records.service';
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { LessonService } from '../../src/lessons/lesson.service';
import { SupervisionService } from '../../src/lessons/supervision.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit);
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const supervisionChats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const supervision = new SupervisionService(g.prisma, g.conversations, lessons, g.outbox, supervisionChats, audit);
const records = new TeacherRecordsService(g.prisma, g.conversations, files, feedback, new PermissionService(g.prisma), audit, supervision);

jest.setTimeout(120_000);

let s: Scenario;

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof CommError ? `${e.code}:${e.status}` : Promise.reject(e)),
  );

const cardsOf = () =>
  g.prisma.$queryRaw<Array<{ conversation_id: string; kind: string; body: string; payload: Record<string, unknown> }>>`
    SELECT m.conversation_id::text, c.kind, m.body, c.payload
      FROM chat.message_card c JOIN chat.message m ON m.id = c.message_id
     WHERE c.kind = 'teacher_praise_shared'`;

const file = (category: 'praise' | 'complaint' | 'suggestion', body = 'She is wonderful with my son.') =>
  feedback.file(s.parentId, { learnerId: s.learnerId, category, body });

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
});

describe('PD-52 PR-8: share a parent\'s praise with the teacher', () => {
  it('1. one card in the teacher\'s supervision chat: the child\'s first name and the words, never the parent\'s name', async () => {
    const praise = await file('praise');
    const out = await records.sharePraise(s.ownerId, praise.id);

    const cards = await cardsOf();
    expect(cards).toHaveLength(1);
    expect(cards[0].conversation_id).toBe(out.conversationId);
    expect(cards[0].payload).toEqual({ feedbackId: praise.id, childFirstName: 'learner_l', body: 'She is wonderful with my son.' });
    expect(cards[0].body).toContain('learner_l');
    expect(cards[0].body).toContain('She is wonderful with my son.');
    expect(JSON.stringify(cards[0])).not.toContain('parent_p');

    const [conv] = await g.prisma.$queryRaw<Array<{ kind: string }>>`
      SELECT type AS kind FROM chat.conversation WHERE id = ${out.conversationId}::uuid`;
    expect(conv.kind).toBe('teacher_supervision');
    const members = await g.prisma.$queryRaw<Array<{ actor_id: string }>>`
      SELECT actor_id::text FROM chat.conversation_member WHERE conversation_id = ${out.conversationId}::uuid AND left_at IS NULL`;
    expect(members.map((m) => m.actor_id)).toContain(s.teacherId);
    expect(members.map((m) => m.actor_id)).not.toContain(s.parentId);

    const listed = await records.testimonials(s.ownerId, { teacher: s.teacherId });
    expect(listed.testimonials).toEqual([expect.objectContaining({ id: praise.id, sharedAt: expect.any(Date) })]);
  });

  it('2. once: a second share is 409, and two racing shares post one card', async () => {
    const first = await file('praise');
    await records.sharePraise(s.ownerId, first.id);
    expect(await code(records.sharePraise(s.ownerId, first.id))).toBe('COMM.TEACHER_FILE_CONFLICT:409');

    const second = await file('praise', 'Thank you for your patience.');
    const raced = await Promise.all([0, 1, 2].map(() => code(records.sharePraise(s.ownerId, second.id))));
    expect(raced.filter((r) => r === 'ok')).toHaveLength(1);
    expect(raced.filter((r) => r === 'COMM.TEACHER_FILE_CONFLICT:409')).toHaveLength(2);
    expect((await cardsOf()).filter((c) => c.payload.feedbackId === second.id)).toHaveLength(1);
  });

  it('3. only a praise the caller can see; a complaint, a suggestion or an unknown id is not found', async () => {
    const praise = await file('praise');
    const complaint = await file('complaint', 'The lesson started late.');
    const suggestion = await file('suggestion', 'More homework, please.');
    // admin_b does not supervise family_x.
    expect(await code(records.sharePraise(s.otherAdminId, praise.id))).toBe('COMM.TEACHER_FILE_NOT_FOUND:404');
    expect(await code(records.sharePraise(s.ownerId, complaint.id))).toBe('COMM.TEACHER_FILE_NOT_FOUND:404');
    expect(await code(records.sharePraise(s.ownerId, suggestion.id))).toBe('COMM.TEACHER_FILE_NOT_FOUND:404');
    expect(await code(records.sharePraise(s.ownerId, randomUUID()))).toBe('COMM.TEACHER_FILE_NOT_FOUND:404');
    expect(await code(records.sharePraise(s.ownerId, 'not-a-uuid'))).toBe('COMM.TEACHER_FILE_NOT_FOUND:404');
    // A teacher holds no grants.record.
    expect(await code(records.sharePraise(s.teacherId, praise.id))).toMatch(/:40[34]$/);
    expect(await cardsOf()).toEqual([]);
  });
});
