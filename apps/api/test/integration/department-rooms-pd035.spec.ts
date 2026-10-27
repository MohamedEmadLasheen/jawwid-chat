/**
 * PD-35 B6 -- department rooms (work groups).
 *
 *   one room per department   type 'department_room', staff-only: the
 *                             department's manager and its members, kept in
 *                             line whenever the structure changes (and healed
 *                             by a sweep)
 *   access                    its own branch in the PD-8 decision: 'member'
 *                             while you are in that department -- live, so a
 *                             removal ends access before any sync
 *   never                     a contact, a teacher, or staff of another
 *                             department (the database refuses the row)
 *   B5's card                 an escalation case opened to a department posts
 *                             case_escalated in its room: ids and names only,
 *                             never the case's title, body or subject
 *
 * Staff-to-staff 1:1s stay disabled (owner Q2): the room is the place.
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { TeacherScopeService } from '@platform/teacher-scope';
import { OrgStructureService } from '../../src/org/org-structure.service';
import { DepartmentRoomService } from '../../src/org/department-room.service';
import { LessonService } from '../../src/lessons/lesson.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { SupervisionCaseService } from '../../src/cases/supervision-case.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const scope = new TeacherScopeService(g.prisma);
const rooms = new DepartmentRoomService(g.prisma, g.conversations, g.outbox);
const org = new OrgStructureService(g.prisma, g.authz, g.conversations, audit, undefined, undefined, rooms);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit, undefined, undefined, scope);
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit, scope);
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const cases = new SupervisionCaseService(g.prisma, g.conversations, lessons, g.authz, g.outbox, audit, feedback, rooms, cards);

jest.setTimeout(120_000);

let s: Scenario;
let sa: string;
let tmgr: string;
let tsupA: string;
let teachersDept: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const roomOf = async (departmentId: string) =>
  (await g.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM chat.conversation WHERE type = 'department_room' AND department_id = ${departmentId}::uuid AND archived_at IS NULL`)[0]?.id ?? null;
const members = async (conversationId: string) =>
  (await g.prisma.conversationMember.findMany({ where: { conversationId, leftAt: null } })).map((m) => m.actorId).sort();
const access = async (staffId: string, conversationId: string) =>
  (await g.prisma.$queryRaw<Array<{ basis: string | null }>>`
    SELECT chat.staff_conversation_access(${staffId}::uuid, ${conversationId}::uuid, now()) AS basis`)[0].basis;
const visible = async (staffId: string) =>
  (await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM chat.staff_visible_conversation_ids(${staffId}::uuid, now()) AS id`).map((r) => r.id);

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma); // Operations: managerId manages; ownerId and otherAdminId are its supervisors
  g.coverage.onDutyId = s.ownerId;
  [sa, tmgr, tsupA] = [randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_r', 'super_admin', true)`, sa),
  ]);
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_r', 'manager', true), ($2::uuid, 'tsup_ra', 'admin', true)`,
    tmgr, tsupA,
  );
  teachersDept = (await org.upsertDepartment(sa, { kind: 'teachers', displayName: 'Teachers', managerId: tmgr, reason: 'set up' })).id;
  await rooms.syncAll(); // the seed wrote Operations directly
});

// ---------------------------------------------------------------------------

describe('a department has one room', () => {
  it('opens with its manager, and follows its members as they are set, moved and removed', async () => {
    const room = await roomOf(teachersDept);
    expect(room).not.toBeNull();
    expect(await members(room as string)).toEqual([tmgr]);

    await org.setDepartmentMember(sa, teachersDept, { staffId: tsupA, position: 'supervisor', reason: 'joins' });
    expect(await members(room as string)).toEqual([tmgr, tsupA].sort());
    expect(await access(tsupA, room as string)).toBe('member');
    expect(await visible(tsupA)).toContain(room);

    // Moved to Operations: out of the Teachers room, into the Operations one.
    await org.setDepartmentMember(sa, s.departmentId, { staffId: tsupA, position: 'supervisor', reason: 'moves' });
    expect(await members(room as string)).toEqual([tmgr]);
    expect(await members((await roomOf(s.departmentId)) as string)).toContain(tsupA);

    await org.removeDepartmentMember(sa, tsupA, { reason: 'leaves' });
    expect(await members((await roomOf(s.departmentId)) as string)).not.toContain(tsupA);
  });

  it('follows a change of manager', async () => {
    const room = (await roomOf(teachersDept)) as string;
    const next = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_r2', 'manager', true)`, next);
    await org.upsertDepartment(sa, { kind: 'teachers', displayName: 'Teachers', managerId: next, reason: 'new manager' });
    expect(await members(room)).toEqual([next]);
    expect(await access(tmgr, room)).toBeNull();
  });

  it('a sweep heals what changed outside the service: a member added directly, a member deactivated', async () => {
    const room = (await roomOf(teachersDept)) as string;
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
      tsupA, teachersDept,
    );
    await rooms.syncAll();
    expect(await members(room)).toEqual([tmgr, tsupA].sort());
    await g.prisma.$executeRaw`UPDATE chat.staff SET is_active = false, left_at = now() WHERE id = ${tsupA}::uuid`;
    expect(await access(tsupA, room)).toBeNull(); // live, before any sync
    await rooms.syncAll();
    expect(await members(room)).toEqual([tmgr]);
  });
});

describe('who may be in a room, and speak there', () => {
  it('only its department\'s staff: never a contact, a teacher, or another department\'s staff', async () => {
    const room = (await roomOf(teachersDept)) as string;
    for (const [actorId, kind, role] of [
      [s.parentId, 'contact', 'parent'],
      [s.teacherId, 'teacher', 'teacher'],
      [s.ownerId, 'staff', 'admin'],
    ] as const) {
      await expect(
        g.prisma.conversationMember.create({ data: { conversationId: room, actorId, actorKind: kind, memberRole: role } }),
      ).rejects.toThrow(/department room/);
    }
    expect(await access(s.ownerId, room)).toBeNull();
    expect(await access(sa, room)).toBe('super_admin');
  });

  it('a member writes; another department reads it as not found', async () => {
    const room = (await roomOf(s.departmentId)) as string;
    expect(await members(room)).toEqual([s.managerId, s.otherAdminId, s.ownerId].sort());
    const sent = await g.messages.send({ conversationId: room, senderId: s.ownerId, body: 'handover at 5', clientMessageId: randomUUID() });
    expect(sent.body).toBe('handover at 5');
    expect(await code(g.messages.send({ conversationId: room, senderId: tmgr, body: 'x', clientMessageId: randomUUID() })))
      .toBe(CommErrorCode.CONVERSATION_NOT_FOUND);
  });
});

describe('B5: the case card', () => {
  it('a case opened to a department posts case_escalated in its room, without the case\'s content', async () => {
    await org.setDepartmentMember(sa, teachersDept, { staffId: tsupA, position: 'supervisor', reason: 'joins' });
    const c = await cases.open(tsupA, {
      subject: { kind: 'teacher', id: s.teacherId }, target: 'teachers', title: 'late reports again', body: 'three this week',
    });
    const room = (await roomOf(teachersDept)) as string;
    const message = await g.prisma.message.findFirst({ where: { conversationId: room, type: 'card' }, orderBy: { seq: 'desc' } });
    const card = await g.prisma.messageCard.findUnique({ where: { messageId: message?.id ?? '' } });
    expect(card?.kind).toBe('case_escalated');
    expect(card?.payload).toMatchObject({ caseId: c.id, ownerId: tmgr, openedBy: tsupA });
    const text = JSON.stringify({ message, card });
    for (const secret of ['late reports again', 'three this week', s.teacherId]) expect(text).not.toContain(secret);
  });
});
