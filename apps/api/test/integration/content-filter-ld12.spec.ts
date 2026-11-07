/**
 * LD-12 / MG-3 (Apple guideline 1.2: "a method for filtering objectionable
 * material from being posted"). Text a parent or a teacher writes for other
 * people is checked against a word list before it is stored:
 *
 *   1. a chat message: a text, a caption, an edit (and so a forward, which is a send)
 *   2. parent feedback about a teacher
 *   3. a parent's and a child's name and About; a teacher's name and profile
 *
 * On a match: COMM.CONTENT_NOT_ALLOWED (400), nothing is written, and the
 * listed word is not in the error, the outbox or the audit log. Staff are not
 * filtered. `moderation.content_filter.enabled` = false in chat.config turns
 * it off without a deploy.
 *
 * The list is neutral and injected: these tests never depend on the draft list.
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { PrismaAuditService } from '@platform/audit.service';
import { PrismaIdentityService } from '@platform/identity.service';
import { ContentFilterService, CONTENT_FILTER_ENABLED_KEY } from '@platform/content-filter/content-filter.service';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { ParentProfileService } from '@communication/profile/parent-profile.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const NEUTRAL = { ar: ['برتقالة'], en: ['pineapple'] };
const TERM = /pineapple|برتقال/i;

const g = buildGraph(undefined, undefined, { contentWords: NEUTRAL });
const audit = new PrismaAuditService();
const filter = new ContentFilterService(g.config, NEUTRAL);
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit);
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit, undefined, filter);
const profiles = new ParentProfileService(g.prisma, new PrismaIdentityService(g.prisma), audit, filter);

let s: Scenario;
let groupId: string;

const say = (body: string, senderId = s.parentId) =>
  g.messages.send({ conversationId: groupId, senderId, body, clientMessageId: randomUUID() });

async function refusal(p: Promise<unknown>): Promise<CommError | 'allowed'> {
  try {
    await p;
    return 'allowed';
  } catch (e) {
    if (e instanceof CommError) return e;
    throw e;
  }
}

async function expectFiltered(p: Promise<unknown>) {
  const e = await refusal(p);
  expect(e).toBeInstanceOf(CommError);
  const err = e as CommError;
  expect({ code: err.code, status: err.status }).toEqual({ code: CommErrorCode.CONTENT_NOT_ALLOWED, status: 400 });
  expect(err.message).not.toMatch(TERM);
}

/** Nothing the system keeps -- outbox, audit, event log -- holds the listed word. */
async function expectNoTrace() {
  const [{ hits }] = await g.prisma.$queryRawUnsafe<Array<{ hits: number }>>(
    `select (
       (select count(*) from chat.outbox_event where payload::text ~* $1) +
       (select count(*) from chat.audit_log where coalesce(before::text, '') || coalesce(after::text, '') || coalesce(reason, '') ~* $1)
     )::int as hits`,
    'pineapple|برتقال',
  );
  expect(hits).toBe(0);
}

async function setSwitch(value: unknown) {
  await g.prisma.config.upsert({
    where: { key: CONTENT_FILTER_ENABLED_KEY },
    create: { key: CONTENT_FILTER_ENABLED_KEY, value: value as never, scope: 'moderation' },
    update: { value: value as never },
  });
  g.config.invalidate();
}

beforeAll(async () => { await g.prisma.$connect(); });
afterAll(async () => {
  await g.prisma.config.deleteMany({ where: { key: CONTENT_FILTER_ENABLED_KEY } });
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await g.prisma.config.deleteMany({ where: { key: CONTENT_FILTER_ENABLED_KEY } });
  g.config.invalidate();
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
});

describe('1. chat messages', () => {
  it('a parent\'s and a teacher\'s text holding a listed word is refused, and nothing is stored', async () => {
    const before = await g.prisma.message.count({ where: { conversationId: groupId } });
    await expectFiltered(say('we bought a PINEAPPLE'));
    await expectFiltered(say('اشترينا بُرتُقَالَةً', s.parentId));
    await expectFiltered(say('p1ne4pple', s.teacherId));
    expect(await g.prisma.message.count({ where: { conversationId: groupId } })).toBe(before);
    await expectNoTrace();
  });

  it('whole words only: a longer word that contains it is sent', async () => {
    expect((await say('pineapples and برتقالات')).body).toBe('pineapples and برتقالات');
  });

  it('a caption is refused like a text, and no image message is stored', async () => {
    const bytes = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 7 + 1) % 256));
    const auth = await g.attachments.authorizeUpload({
      conversationId: groupId, actorId: s.parentId, kind: 'image', mimeType: 'image/png', byteSize: bytes.length,
    });
    await new LocalFsBlobStore().put(auth.objectKey, 'image/png', bytes);
    const attachments = [{ kind: 'image', objectKey: auth.objectKey, mimeType: 'image/png', byteSize: bytes.length }];
    await expectFiltered(g.messages.send({
      conversationId: groupId, senderId: s.parentId, type: 'image', body: 'look, a pineapple', clientMessageId: randomUUID(), attachments,
    }));
    expect(await g.prisma.message.count({ where: { conversationId: groupId, type: 'image' } })).toBe(0);
    const sent = await g.messages.send({
      conversationId: groupId, senderId: s.parentId, type: 'image', body: 'look, a mango', clientMessageId: randomUUID(), attachments,
    });
    expect(sent.body).toBe('look, a mango');
  });

  it('an edit to a listed word is refused; the message keeps its wording and gains no revision', async () => {
    const m = await say('hello teacher');
    await expectFiltered(g.messages.edit(m.id, s.parentId, 'hello pineapple', groupId));
    const row = await g.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect([row.body, row.editedAt]).toEqual(['hello teacher', null]);
    expect(await g.prisma.messageRevision.count({ where: { messageId: m.id } })).toBe(0);
    await expectNoTrace();
  });

  it('staff are not filtered (a moderator may quote what was reported)', async () => {
    expect((await say('the parent wrote pineapple', s.ownerId)).body).toBe('the parent wrote pineapple');
  });

  it('chat.config moderation.content_filter.enabled = false turns it off, without a deploy; true turns it back on', async () => {
    await setSwitch(false);
    expect((await say('pineapple')).body).toBe('pineapple');
    await setSwitch(true);
    await expectFiltered(say('pineapple'));
  });
});

describe('2. parent feedback', () => {
  it('feedback holding a listed word is refused and not filed', async () => {
    await expectFiltered(feedback.file(s.parentId, { learnerId: s.learnerId, category: 'complaint', body: 'the teacher said pineapple' }));
    expect(await g.prisma.parentFeedback.count()).toBe(0);
    expect(await g.prisma.teacherSupervisionEntry.count()).toBe(0);
    await expectNoTrace();
    const filed = await feedback.file(s.parentId, { learnerId: s.learnerId, category: 'praise', body: 'Very patient.' });
    expect(filed).toMatchObject({ category: 'praise' });
  });
});

describe('3. profiles others read', () => {
  it('a parent\'s name and About, and a child\'s, are refused and left as they were', async () => {
    await expectFiltered(profiles.updateMe(s.parentId, { about: 'I love pineapple' }));
    await expectFiltered(profiles.updateMe(s.parentId, { name: 'Pineapple' }));
    await expectFiltered(profiles.updateChild(s.parentId, s.learnerId, { about: 'برتقالة' }));
    await expectFiltered(profiles.updateChild(s.parentId, s.learnerId, { name: 'pineapple' }));
    const me = await profiles.me(s.parentId);
    expect(me.displayName).toBe('parent_p');
    expect(me.about).toBeNull();
    expect(me.children.every((c) => c.about === null && !TERM.test(c.displayName))).toBe(true);
    await expectNoTrace();
  });

  it('a teacher\'s profile text and name are refused and left as they were', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'first' });
    for (const field of ['bio', 'specialization', 'qualifications', 'experience'] as const) {
      await expectFiltered(g.teacherProfiles.saveProfile(s.teacherId, { bio: 'first', [field]: 'pineapple' }));
    }
    await expectFiltered(g.teacherProfiles.updateName(s.teacherId, 'Pineapple'));
    const row = await g.prisma.teacherProfessionalProfile.findUniqueOrThrow({ where: { teacherId: s.teacherId } });
    expect([row.bio, row.specialization, row.qualifications, row.experience]).toEqual(['first', null, null, null]);
    const teacher = await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } });
    expect(teacher.name).not.toMatch(TERM);
    await expectNoTrace();
  });
});
