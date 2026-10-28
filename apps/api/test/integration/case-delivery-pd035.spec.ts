/**
 * PD-35 B5 follow-up -- case.opened / case.assigned / case.due_soon are
 * delivered (found by the PD-47 Tasks audit: they carried no conversationId,
 * so the outbox worker's default branch dropped them and nobody was told).
 *
 *   who       opened -> the owner and the target department's manager;
 *             assigned -> the new owner; due soon -> the owner (the manager
 *             when there is none). Never the person who did it. Read LIVE: an
 *             owner who no longer fits the case (B5 R2) is not told.
 *   how       a PD-34 Notification Center entry in the 'task' category, whose
 *             action opens the case, with a generic push; and a realtime
 *             signal on each recipient's actor room so a list refreshes.
 *   never     the case's title, body or subject in what is sent.
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { TeacherScopeService } from '@platform/teacher-scope';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { LessonService } from '../../src/lessons/lesson.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { SupervisionCaseService } from '../../src/cases/supervision-case.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const scope = new TeacherScopeService(g.prisma);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit, undefined, undefined, scope);
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit, scope);
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit);
const cases = new SupervisionCaseService(g.prisma, g.conversations, lessons, g.authz, g.outbox, audit, feedback);

const signals: Array<{ to: string[]; type: string; payload: Record<string, unknown> }> = [];
const recorder = {
  toThread: async () => undefined,
  toThreadAudience: async () => undefined,
  toUsers: async (to: string[], type: string, payload: Record<string, unknown>) => {
    signals.push({ to: [...to], type, payload });
  },
};
const worker = new OutboxWorker(g.prisma, g.notifications, recorder as never, g.identity, g.pipeline);

jest.setTimeout(120_000);

let s: Scenario;
let tmgr: string;
let tsupA: string;
let tsupB: string;

const items = async (recipientId: string) =>
  g.prisma.notificationItem.findMany({ where: { recipientId }, orderBy: { createdAt: 'asc' } });
const signalled = (type: string) => signals.filter((x) => x.type === type);

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  signals.length = 0;
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  [tmgr, tsupA, tsupB] = [randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ($1::uuid, 'tmgr_d', 'manager', true), ($2::uuid, 'tsup_da', 'admin', true), ($3::uuid, 'tsup_db', 'admin', true)`,
    tmgr, tsupA, tsupB,
  );
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values
       ($1::uuid, chat.default_organization_id(), $3::uuid, 'supervisor'), ($2::uuid, chat.default_organization_id(), $3::uuid, 'supervisor')`,
    tsupA, tsupB, dept,
  );
});

describe('a case reaches the people it is for', () => {
  it('opened: the owner (the manager) is told -- a task entry that opens the case, and a signal; the opener is not', async () => {
    const c = await cases.open(tsupA, { subject: { kind: 'teacher', id: s.teacherId }, target: 'teachers', title: 'secret title', body: 'secret body' });
    await worker.drain(100);
    const [entry] = await items(tmgr);
    expect(entry).toMatchObject({ eventType: 'case_opened', category: 'task', subjectType: 'supervision_case', subjectId: c.id });
    expect(entry?.action).toEqual({ kind: 'open_case', caseId: c.id });
    expect(await items(tsupA)).toEqual([]);
    expect(signalled('case.opened')).toEqual([expect.objectContaining({ to: [tmgr] })]);
    const sent = JSON.stringify({ entries: await g.prisma.notificationItem.findMany(), pushes: await g.prisma.notification.findMany() });
    expect(sent).not.toMatch(/secret/);
  });

  it('assigned: the new owner is told, not the manager who assigned it; the old owner\'s list is signalled', async () => {
    const c = await cases.open(tsupA, { subject: { kind: 'teacher', id: s.teacherId }, target: 'teachers', title: 'x' });
    await worker.drain(100);
    signals.length = 0;
    await cases.assign(tmgr, c.id, { ownerId: tsupB });
    await worker.drain(100);
    expect((await items(tsupB)).map((i) => i.eventType)).toEqual(['case_assigned']);
    expect((await items(tmgr)).map((i) => i.eventType)).toEqual(['case_opened']);
    const [signal] = signalled('case.assigned');
    expect(signal?.to.sort()).toEqual([tmgr, tsupB].sort());
    // Assigned back and forth: each assignment is its own entry.
    await cases.assign(tmgr, c.id, { ownerId: tmgr });
    await cases.assign(tmgr, c.id, { ownerId: tsupB });
    await worker.drain(100);
    expect((await items(tsupB)).map((i) => i.eventType)).toEqual(['case_assigned', 'case_assigned']);
  });

  it('due soon: the owner is told once; a closed case tells no one', async () => {
    const c = await cases.open(tsupA, { subject: { kind: 'teacher', id: s.teacherId }, target: 'teachers', title: 'x' });
    await cases.assign(tmgr, c.id, { ownerId: tsupB });
    const [{ d }] = await g.prisma.$queryRaw<Array<{ d: string }>>`SELECT (chat.academy_today() + 1)::text AS d`;
    await cases.setDue(tsupB, c.id, { dueOn: d });
    await cases.sweepDueSoon();
    await worker.drain(100);
    expect((await items(tsupB)).filter((i) => i.eventType === 'case_due_soon')).toHaveLength(1);

    const other = await cases.open(tsupA, { subject: { kind: 'teacher', id: s.teacherId }, target: 'teachers', title: 'y', dueOn: d });
    await cases.setStatus(tmgr, other.id, { status: 'cancelled', note: 'duplicate' });
    await cases.sweepDueSoon();
    await worker.drain(100);
    expect((await items(tmgr)).filter((i) => i.eventType === 'case_due_soon')).toHaveLength(0);
  });

  it('an owner who left the department is not told; the manager is', async () => {
    const c = await cases.open(tsupA, { subject: { kind: 'teacher', id: s.teacherId }, target: 'teachers', title: 'x' });
    await cases.assign(tmgr, c.id, { ownerId: tsupB });
    await worker.drain(100);
    await g.prisma.$executeRaw`DELETE FROM chat.department_member WHERE staff_id = ${tsupB}::uuid`;
    const [{ d }] = await g.prisma.$queryRaw<Array<{ d: string }>>`SELECT (chat.academy_today() + 1)::text AS d`;
    await cases.setDue(tmgr, c.id, { dueOn: d });
    await cases.sweepDueSoon();
    await worker.drain(100);
    expect((await items(tsupB)).filter((i) => i.eventType === 'case_due_soon')).toHaveLength(0);
    expect((await items(tmgr)).filter((i) => i.eventType === 'case_due_soon')).toHaveLength(1);
  });
});
