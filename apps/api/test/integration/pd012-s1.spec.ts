/**
 * PD-12 S1 -- the teacher supervision conversation, student certificates and
 * teacher leave.
 *
 *   1. the supervision conversation: one per teacher; the teacher and the
 *      Teachers department, nobody else -- in the API, the chat list and the
 *      database
 *   2. certificates: the teacher's ticket lands privately; the Teachers
 *      department issues the real file into the learner's group, where the
 *      parent reads it; refusals for the wrong person, file, group and state
 *   3. leave: allowance by the manager, the teacher's ticket, approval as day_off
 *      entries, the computed balance, colliding lessons, cancel and withdraw
 *   4. the database refuses what the services would never send (the backstop)
 *   5. the request role (chat_app) sees the supervision conversation exactly as
 *      the API does, and none of the new tables (needs DATABASE_APP_URL)
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { CertificateService } from '../../src/certificates/certificate.service';
import { LeaveService } from '../../src/leave/leave.service';
import { LocalFsBlobStore } from '../../src/communication/attachments/blob-store';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const supervision = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const certificates = new CertificateService(g.prisma, g.conversations, supervision, cards, g.storage, audit);
const leave = new LeaveService(g.prisma, g.conversations, supervision, cards, lessons, audit);
const blobs = new LocalFsBlobStore();

let s: Scenario;
let groupId: string;
/** A Teachers-department supervisor (member). */
let tsupId: string;
/** The Teachers department's manager. */
let tmgrId: string;
let teachersDept: string;

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x20)]);
const NEXT_YEAR = new Date().getUTCFullYear() + 1;
const day = (mmdd: string) => `${NEXT_YEAR}-${mmdd}`;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

async function sqlError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('expected the database to refuse');
}

async function cardsIn(conversationId: string) {
  return g.prisma.message.findMany({
    where: { conversationId, type: 'card' },
    include: { card: true, attachments: true },
    orderBy: { seq: 'asc' },
  });
}

async function newCertificate(learnerId = s.learnerId) {
  const out = await certificates.request(s.teacherId, {
    learnerId,
    title: 'Juz Amma',
    achievement: 'Memorized Juz Amma with tajweed',
    achievedOn: '2026-10-01',
    grade: 'Excellent',
    printedName: 'learner_l',
  });
  return out;
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
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  tsupId = randomUUID();
  tmgrId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_a', 'admin', true), ($2::uuid, 'tmgr_b', 'manager', true)`,
    tsupId,
    tmgrId,
  );
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`,
    tmgrId,
  );
  teachersDept = id;
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId,
    teachersDept,
  );
});

// ---------------------------------------------------------------------------

describe('1. the teacher supervision conversation', () => {
  it('is one per teacher, with the teacher and the Teachers department as members', async () => {
    const { conversationId } = await supervision.ensureOwn(s.teacherId);
    expect((await supervision.ensureOwn(s.teacherId)).conversationId).toBe(conversationId);
    expect((await supervision.ensureForTeacher(tsupId, s.teacherId)).conversationId).toBe(conversationId);

    const conv = await g.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conv.type).toBe('teacher_supervision');
    expect(conv.supervisedTeacherId).toBe(s.teacherId);
    expect(conv.familyId).toBeNull();
    expect(conv.title).toBe('teacher_c');

    const members = await g.prisma.conversationMember.findMany({ where: { conversationId, leftAt: null } });
    expect(members.map((m) => m.actorId).sort()).toEqual([s.teacherId, tsupId, tmgrId].sort());
  });

  it('reaches the teacher and the department -- and not Operations, a parent or another teacher', async () => {
    const { conversationId } = await supervision.ensureOwn(s.teacherId);
    await g.messages.send({ conversationId, senderId: s.teacherId, clientMessageId: randomUUID(), type: 'text', body: 'salam' } as never);

    for (const reader of [s.teacherId, tsupId, tmgrId]) {
      const page = await g.messages.list({ conversationId, actorId: reader });
      expect(page.messages.some((m) => m.body === 'salam')).toBe(true);
    }
    for (const outsider of [s.ownerId, s.managerId, s.parentId, s.unrelatedTeacherId]) {
      await expect(g.messages.list({ conversationId, actorId: outsider })).rejects.toBeInstanceOf(CommError);
    }

    const staffList = async (id: string) => (await g.conversations.listForActor(id)).map((c) => c.id);
    expect(await staffList(tsupId)).toContain(conversationId);
    expect(await staffList(tmgrId)).toContain(conversationId);
    expect(await staffList(s.ownerId)).not.toContain(conversationId);
    expect(await staffList(s.teacherId)).toContain(conversationId);
  });

  it('follows the department: a supervisor who leaves it loses the conversation at the next sync', async () => {
    const { conversationId } = await supervision.ensureOwn(s.teacherId);
    await g.prisma.$executeRawUnsafe(`delete from chat.department_member where staff_id = $1::uuid`, tsupId);
    await supervision.ensureOwn(s.teacherId);
    const live = await g.prisma.conversationMember.findMany({ where: { conversationId, leftAt: null } });
    expect(live.map((m) => m.actorId)).not.toContain(tsupId);
    await expect(g.messages.list({ conversationId, actorId: tsupId })).rejects.toBeInstanceOf(CommError);
  });

  it('offers the teacher Certificate and Leave under "+", and nobody else anything', async () => {
    const { conversationId } = await supervision.ensureOwn(s.teacherId);
    const mine = await supervision.ticketsFor(s.teacherId, conversationId);
    expect(mine.tickets.map((t) => t.ticket)).toEqual(['certificate', 'leave']);
    expect(mine.learners.map((l) => l.id)).toContain(s.learnerId);
    expect((await supervision.ticketsFor(tsupId, conversationId)).tickets).toEqual([]);
    expect((await supervision.ticketsFor(s.teacherId, groupId)).tickets).toEqual([]);
  });

  it('only the Teachers department opens another teacher\'s', async () => {
    expect(await code(supervision.ensureForTeacher(s.ownerId, s.teacherId))).toBe(CommErrorCode.SUPERVISION_DENIED);
    expect(await code(supervision.ensureForTeacher(s.teacherId, s.newTeacherId))).toBe(CommErrorCode.SUPERVISION_DENIED);
    expect(await code(supervision.ensureOwn(s.parentId))).toBe(CommErrorCode.SUPERVISION_DENIED);
    const all = await supervision.ensureAll(tmgrId);
    expect(all.ensured).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe('2. student certificates', () => {
  it('the request is private: its card lands in the supervision conversation, never the group', async () => {
    const { certificate, conversationId } = await newCertificate();
    expect(certificate.state).toBe('requested');
    expect(certificate.canDeliver).toBe(true);

    const privateCards = await cardsIn(conversationId);
    expect(privateCards.map((m) => m.card?.kind)).toEqual(['certificate_requested']);
    expect(privateCards[0].authorType).toBe('teacher');
    expect(privateCards[0].body).toContain('Juz Amma');
    expect(await cardsIn(groupId)).toEqual([]);
  });

  it('only the learner\'s own teacher requests one', async () => {
    const body = { learnerId: s.learnerId, title: 't', achievement: 'a', achievedOn: '2026-10-01', printedName: 'n' };
    expect(await code(certificates.request(s.unrelatedTeacherId, body))).toBe(CommErrorCode.CERTIFICATE_NOT_FOUND);
    expect(await code(certificates.request(s.ownerId, body))).toBe(CommErrorCode.CERTIFICATE_NOT_FOUND);
    expect(await code(certificates.request(s.teacherId, { ...body, achievedOn: '2026-02-30' }))).toBe(CommErrorCode.VALIDATION);
  });

  it('the Teachers department lists them; Operations, parents and other teachers do not see them', async () => {
    await newCertificate();
    expect((await certificates.list(tsupId, { state: 'requested' })).certificates).toHaveLength(1);
    expect((await certificates.list(s.teacherId, {})).certificates).toHaveLength(1);
    expect((await certificates.list(s.unrelatedTeacherId, {})).certificates).toHaveLength(0);
    expect(await code(certificates.list(s.ownerId, {}))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    expect(await code(certificates.list(s.parentId, {}))).toBe(CommErrorCode.CERTIFICATE_DENIED);
  });

  it('issuing delivers the real file into the group, where the parent reads it', async () => {
    const { certificate, conversationId } = await newCertificate();
    const { upload, conversationId: target } = await certificates.authorizeUpload(tsupId, certificate.id, {
      mimeType: 'application/pdf',
      byteSize: PDF.length,
    });
    expect(target).toBe(groupId);
    expect(upload.objectKey.startsWith(`conversations/${groupId}/`)).toBe(true);
    await blobs.put(upload.objectKey, 'application/pdf', PDF);

    const issued = await certificates.issue(tsupId, certificate.id, {
      objectKey: upload.objectKey,
      mimeType: 'application/pdf',
      byteSize: PDF.length,
      fileName: 'certificate.pdf',
    });
    expect(issued.certificate.state).toBe('issued');
    expect(issued.certificate.deliveredTo).toBe(groupId);

    const delivered = await cardsIn(groupId);
    expect(delivered.map((m) => m.card?.kind)).toEqual(['certificate_issued']);
    expect(delivered[0].moderation).toBe('published');
    expect(delivered[0].attachments.map((a) => a.objectKey)).toEqual([upload.objectKey]);

    const parentView = await g.messages.list({ conversationId: groupId, actorId: s.parentId });
    const seen = parentView.messages.find((m) => m.id === delivered[0].id);
    expect(seen?.card?.kind).toBe('certificate_issued');
    expect(seen?.attachments[0]?.url).toBeTruthy();

    // ...and the teacher's request is answered where it was asked.
    expect((await cardsIn(conversationId)).map((m) => m.card?.kind)).toEqual(['certificate_requested', 'certificate_issued']);

    expect(await code(certificates.decline(tsupId, certificate.id, { reason: 'late' }))).toBe(CommErrorCode.CERTIFICATE_STATE);
  });

  it('refuses a file that is not what it claims, or that was not uploaded for this group', async () => {
    const { certificate } = await newCertificate();
    const { upload } = await certificates.authorizeUpload(tsupId, certificate.id, { mimeType: 'image/png', byteSize: PDF.length });
    await blobs.put(upload.objectKey, 'image/png', PDF);
    expect(
      await code(certificates.issue(tsupId, certificate.id, { objectKey: upload.objectKey, mimeType: 'image/png', byteSize: PDF.length, fileName: 'c.png' })),
    ).toBe(CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED);

    const foreign = `conversations/${randomUUID()}/${randomUUID()}`;
    await blobs.put(foreign, 'application/pdf', PDF);
    expect(
      await code(certificates.issue(tsupId, certificate.id, { objectKey: foreign, mimeType: 'application/pdf', byteSize: PDF.length, fileName: 'c.pdf' })),
    ).toBe(CommErrorCode.ATTACHMENT_NOT_IN_CONVERSATION);

    const missing = `conversations/${groupId}/${randomUUID()}`;
    expect(
      await code(certificates.issue(tsupId, certificate.id, { objectKey: missing, mimeType: 'application/pdf', byteSize: PDF.length, fileName: 'c.pdf' })),
    ).toBe(CommErrorCode.CERTIFICATE_STATE);

    expect(await code(certificates.authorizeUpload(s.ownerId, certificate.id, { mimeType: 'application/pdf', byteSize: 10 }))).toBe(
      CommErrorCode.CERTIFICATE_DENIED,
    );
  });

  it('declining answers the teacher privately, and nothing reaches the family', async () => {
    const { certificate, conversationId } = await newCertificate();
    expect(await code(certificates.decline(tsupId, certificate.id, {}))).toBe(CommErrorCode.VALIDATION);
    const out = await certificates.decline(tsupId, certificate.id, { reason: 'the level is not finished yet' });
    expect(out.certificate.state).toBe('declined');
    expect((await cardsIn(conversationId)).map((m) => m.card?.kind)).toEqual(['certificate_requested', 'certificate_declined']);
    expect(await cardsIn(groupId)).toEqual([]);
  });

  it('cannot be issued while the learner has no live group', async () => {
    const { certificate } = await newCertificate();
    await g.prisma.conversation.update({ where: { id: groupId }, data: { archivedAt: new Date() } });
    expect(await code(certificates.authorizeUpload(tsupId, certificate.id, { mimeType: 'application/pdf', byteSize: 10 }))).toBe(
      CommErrorCode.CERTIFICATE_STATE,
    );
    expect((await certificates.list(tsupId, { state: 'requested' })).certificates[0].canDeliver).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('3. teacher leave', () => {
  async function allowance(days: number) {
    await leave.setAllowance(tmgrId, s.teacherId, { year: NEXT_YEAR, days });
  }

  it('the allowance is the manager\'s to set; a member, Operations and the teacher cannot', async () => {
    expect(await code(leave.setAllowance(tsupId, s.teacherId, { year: NEXT_YEAR, days: 21 }))).toBe(CommErrorCode.LEAVE_DENIED);
    expect(await code(leave.setAllowance(s.ownerId, s.teacherId, { year: NEXT_YEAR, days: 21 }))).toBe(CommErrorCode.LEAVE_DENIED);
    expect(await code(leave.setAllowance(s.teacherId, s.teacherId, { year: NEXT_YEAR, days: 21 }))).toBe(CommErrorCode.LEAVE_DENIED);
    await allowance(21);
    await allowance(20);
    const view = await leave.teacherLeave(tsupId, s.teacherId, String(NEXT_YEAR));
    expect(view.allowance).toBe(20);
    expect(view.allowanceHistory.map((h) => h.days)).toEqual([20, 21]);
  });

  it('request -> approve writes day_off entries, and the balance is computed from them', async () => {
    await allowance(10);
    const { request, conversationId } = await leave.request(s.teacherId, { firstDay: day('03-10'), lastDay: day('03-12'), reason: 'family wedding' });
    expect(request.state).toBe('requested');
    expect((await cardsIn(conversationId)).map((m) => m.card?.kind)).toEqual(['leave_requested']);

    // Untick the teacher's regular day off: it is not leave.
    const out = await leave.approve(tsupId, request.id, { days: [day('03-10'), day('03-12')] });
    expect(out.request.state).toBe('approved');

    const mine = await leave.ownLeave(s.teacherId, String(NEXT_YEAR));
    expect(mine).toMatchObject({ allowance: 10, used: 2, balance: 8 });
    // The days are PD-11's teacher_day_off rows -- the record the scheduler reads.
    const days = await g.prisma.teacherDayOff.findMany({ where: { leaveRequestId: request.id } });
    expect(days.map((e) => e.day.toISOString().slice(0, 10)).sort()).toEqual([day('03-10'), day('03-12')]);
    expect((await cardsIn(conversationId)).map((m) => m.card?.kind)).toEqual(['leave_requested', 'leave_approved']);
  });

  it('a day already recorded off (Teacher File, availability) counts once, not twice', async () => {
    await allowance(10);
    await g.prisma.teacherDayOff.create({
      data: {
        organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId,
        teacherId: s.teacherId,
        day: new Date(`${day('03-11')}T00:00:00Z`),
        reason: 'recorded directly',
        createdBy: tsupId,
      },
    });
    const { request } = await leave.request(s.teacherId, { firstDay: day('03-10'), lastDay: day('03-12'), reason: 'r' });
    await leave.approve(tsupId, request.id, {});
    expect(await leave.ownLeave(s.teacherId, String(NEXT_YEAR))).toMatchObject({ used: 3, balance: 7 });
  });

  it('open lessons inside the leave must be handled; approving with the flag cancels them for the family', async () => {
    await allowance(10);
    const lesson = await lessons.schedule(tsupId, {
      learnerId: s.learnerId,
      startsAt: `${day('03-11')}T08:00:00.000Z`,
      endsAt: `${day('03-11')}T08:30:00.000Z`,
    });
    const { request } = await leave.request(s.teacherId, { firstDay: day('03-10'), lastDay: day('03-12'), reason: 'r' });
    const listed = (await leave.list(tsupId, { state: 'requested' })).requests[0];
    expect(listed.collidingLessons?.map((l) => l.id)).toEqual([lesson.id]);

    expect(await code(leave.approve(tsupId, request.id, {}))).toBe(CommErrorCode.LEAVE_LESSONS_COLLIDE);
    expect((await g.prisma.teacherLeaveRequest.findUniqueOrThrow({ where: { id: request.id } })).state).toBe('requested');

    const out = await leave.approve(tsupId, request.id, { cancelCollidingLessons: true });
    expect(out).toMatchObject({ cancelledLessons: 1, notCancelled: [] });
    const closed = await g.prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
    expect(closed.outcome).toBe('admin_cancelled');
    expect((await cardsIn(groupId)).map((m) => m.card?.kind)).toEqual(['lesson_cancelled']);
  });

  it('cancelling an approved leave returns the days that have not passed', async () => {
    await allowance(10);
    const { request } = await leave.request(s.teacherId, { firstDay: day('03-10'), lastDay: day('03-12'), reason: 'r' });
    await leave.approve(tsupId, request.id, {});
    expect(await leave.ownLeave(s.teacherId, String(NEXT_YEAR))).toMatchObject({ balance: 7 });
    const out = await leave.cancel(tsupId, request.id, { note: 'plans changed' });
    expect(out.daysReturned).toBe(3);
    expect(await leave.ownLeave(s.teacherId, String(NEXT_YEAR))).toMatchObject({ used: 0, balance: 10 });
    expect(await code(leave.cancel(tsupId, request.id, { note: 'again' }))).toBe(CommErrorCode.LEAVE_STATE);
  });

  it('overlap, withdraw, decline and who may do each', async () => {
    const { request } = await leave.request(s.teacherId, { firstDay: day('04-01'), lastDay: day('04-03'), reason: 'r' });
    expect(await code(leave.request(s.teacherId, { firstDay: day('04-03'), lastDay: day('04-05'), reason: 'r' }))).toBe(CommErrorCode.LEAVE_STATE);
    expect(await code(leave.request(s.teacherId, { firstDay: '2020-01-01', lastDay: '2020-01-02', reason: 'r' }))).toBe(CommErrorCode.LEAVE_STATE);
    expect(await code(leave.request(s.teacherId, { firstDay: day('12-30'), lastDay: `${NEXT_YEAR + 1}-01-02`, reason: 'r' }))).toBe(CommErrorCode.LEAVE_STATE);

    expect(await code(leave.withdraw(s.newTeacherId, request.id))).toBe(CommErrorCode.LEAVE_NOT_FOUND);
    expect(await code(leave.approve(s.teacherId, request.id, {}))).toBe(CommErrorCode.LEAVE_DENIED);
    expect(await code(leave.approve(s.ownerId, request.id, {}))).toBe(CommErrorCode.LEAVE_DENIED);
    expect(await code(leave.list(s.ownerId, {}))).toBe(CommErrorCode.LEAVE_DENIED);
    expect(await code(leave.ownLeave(tsupId))).toBe(CommErrorCode.LEAVE_DENIED);

    expect((await leave.withdraw(s.teacherId, request.id)).request.state).toBe('withdrawn');
    // A withdrawn request no longer blocks the dates.
    const again = await leave.request(s.teacherId, { firstDay: day('04-03'), lastDay: day('04-05'), reason: 'r' });
    expect(await code(leave.decline(tsupId, again.request.id, {}))).toBe(CommErrorCode.VALIDATION);
    expect((await leave.decline(tsupId, again.request.id, { note: 'exam week' })).request.state).toBe('declined');
  });
});

// ---------------------------------------------------------------------------

describe('4. the database backstop', () => {
  it('a supervision conversation never admits a contact, or a teacher it is not about', async () => {
    const { conversationId } = await supervision.ensureOwn(s.teacherId);
    expect(
      await sqlError(
        g.prisma.conversationMember.create({ data: { conversationId, actorId: s.parentId, actorKind: 'contact', memberRole: 'parent' } }),
      ),
    ).toMatch(/never admits a family contact/);
    expect(
      await sqlError(
        g.prisma.conversationMember.create({ data: { conversationId, actorId: s.newTeacherId, actorKind: 'teacher', memberRole: 'teacher' } }),
      ),
    ).toMatch(/only the teacher it is about/);
    expect(
      await sqlError(
        g.prisma.conversationMember.create({ data: { conversationId, actorId: s.ownerId, actorKind: 'staff', memberRole: 'admin' } }),
      ),
    ).toMatch(/staff of the Teachers department/);
  });

  it('a certificate request is written once; an allowance is never edited', async () => {
    const { certificate } = await newCertificate();
    expect(
      await sqlError(g.prisma.learnerCertificate.update({ where: { id: certificate.id }, data: { title: 'changed' } })),
    ).toMatch(/written once/);
    expect(await sqlError(g.prisma.learnerCertificate.delete({ where: { id: certificate.id } }))).toMatch(/never deleted/);
    await leave.setAllowance(tmgrId, s.teacherId, { year: NEXT_YEAR, days: 5 });
    expect(
      await sqlError(g.prisma.$executeRawUnsafe(`update chat.teacher_leave_allowance set days = 50`)),
    ).toMatch(/never edited/);
  });

  it('a day off may name only an APPROVED leave of the same teacher, inside its dates', async () => {
    const { request } = await leave.request(s.teacherId, { firstDay: day('05-01'), lastDay: day('05-02'), reason: 'r' });
    const org = (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId;
    const entry = (d: string) =>
      g.prisma.teacherDayOff.create({
        data: { organizationId: org, teacherId: s.teacherId, day: new Date(`${d}T00:00:00Z`), createdBy: tsupId, leaveRequestId: request.id },
      });
    expect(await sqlError(entry(day('05-01')))).toMatch(/only an approved leave/);
    await leave.approve(tsupId, request.id, { days: [day('05-01')] });
    expect(await sqlError(entry(day('05-09')))).toMatch(/request's teacher and dates/);
  });

  it('a day of an approved leave is removed only by cancelling the leave', async () => {
    await leave.setAllowance(tmgrId, s.teacherId, { year: NEXT_YEAR, days: 10 });
    const { request } = await leave.request(s.teacherId, { firstDay: day('06-01'), lastDay: day('06-02'), reason: 'r' });
    await leave.approve(tsupId, request.id, {});
    // Any other writer -- the Schedules tab, the Teacher File, raw SQL -- is refused.
    expect(
      await sqlError(g.prisma.teacherDayOff.deleteMany({ where: { leaveRequestId: request.id } })),
    ).toMatch(/belongs to an approved leave; cancel the leave instead/);
    expect(await g.prisma.teacherDayOff.count({ where: { leaveRequestId: request.id } })).toBe(2);
    // The cancel path marks the leave cancelled first, then removes its days.
    expect((await leave.cancel(tsupId, request.id, { note: 'plans changed' })).daysReturned).toBe(2);
    expect(await g.prisma.teacherDayOff.count({ where: { leaveRequestId: request.id } })).toBe(0);
  });

  it('a learner reassigned away is no longer the teacher\'s to request a certificate for', async () => {
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${s.newTeacherId}'::uuid where id = '${s.learnerId}'::uuid`);
    const body = { learnerId: s.learnerId, title: 't', achievement: 'a', achievedOn: '2026-10-01', printedName: 'n' };
    expect(await code(certificates.request(s.teacherId, body))).toBe(CommErrorCode.CERTIFICATE_NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------

const appUrl = process.env.DATABASE_APP_URL;
(appUrl ? describe : describe.skip)('5. the request role (chat_app) agrees with the API', () => {
  let app: PrismaClient;
  beforeAll(() => {
    app = new PrismaClient({ datasourceUrl: appUrl });
  });
  afterAll(async () => {
    await app.$disconnect();
  });

  /** Give a staff row a login, and return its subject. */
  async function login(staffId: string): Promise<string> {
    const account = randomUUID();
    const subject = `pd012-${account.slice(0, 8)}@pd012.test`;
    await g.prisma.$executeRawUnsafe(
      `insert into chat.account (id, subject, kind, organization_id, status, is_active)
       values ($1::uuid, $2, 'staff', chat.default_organization_id(), 'active', true)`,
      account,
      subject,
    );
    await g.prisma.$executeRawUnsafe(`update chat.staff set account_id = $1::uuid where id = $2::uuid`, account, staffId);
    return subject;
  }

  const asStaff = <T>(subject: string, fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>) =>
    app.$transaction(async (tx) => {
      const [{ org }] = await g.prisma.$queryRaw<Array<{ org: string }>>`select chat.default_organization_id()::text as org`;
      await tx.$executeRaw`select set_config('chat.actor_subject', ${subject}, true),
                                  set_config('chat.actor_organization', ${org}, true)`;
      return fn(tx);
    });

  it('the Teachers department reads the supervision conversation; Operations reads nothing of it', async () => {
    const { conversationId } = await supervision.ensureOwn(s.teacherId);
    await g.messages.send({ conversationId, senderId: s.teacherId, clientMessageId: randomUUID(), type: 'text', body: 'rls' } as never);
    const read = (subject: string) =>
      asStaff(subject, async (tx) => ({
        n: (await tx.$queryRaw<Array<{ n: number }>>`select count(*)::int as n from chat.message where conversation_id = ${conversationId}::uuid`)[0].n,
        basis: (await tx.$queryRaw<Array<{ b: string | null }>>`select chat.current_staff_conversation_access(${conversationId}::uuid) as b`)[0].b,
      }));
    expect(await read(await login(tsupId))).toEqual({ n: 1, basis: 'member' });
    expect(await read(await login(tmgrId))).toEqual({ n: 1, basis: 'member' });
    expect(await read(await login(s.ownerId))).toEqual({ n: 0, basis: null });
  });

  it('no new PD-12 table is readable by a request role at all', async () => {
    const subject = await login(tsupId);
    for (const sql of [
      'select count(*) from chat.learner_certificate',
      'select count(*) from chat.teacher_leave_request',
      'select count(*) from chat.teacher_leave_allowance',
      'select count(*) from chat.message_card_kind',
      `select chat.teachers_department_role('${tsupId}'::uuid)`,
    ]) {
      await expect(asStaff(subject, (tx) => tx.$queryRawUnsafe(sql))).rejects.toThrow(/permission denied/i);
    }
  });
});
