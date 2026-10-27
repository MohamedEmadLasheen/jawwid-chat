/**
 * PD-35 B7 -- a staff member's action log (GET staff/:id/action-log).
 *
 *   what    no new logging: what chat.audit_log records them doing (actor_id),
 *           plus the case history that is not audited (a due date set, a note
 *           added -- chat.supervision_case_event). Newest first, with the
 *           entity it was about, never the before/after payloads.
 *   cases   a case entry shows the act and the case's id only -- never its
 *           title or a note's text, which B5 shows only to those who may see
 *           the case
 *   who     the person themselves, the manager of the department they are in,
 *           the super admin. Anyone else: not found.
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { TeacherScopeService } from '@platform/teacher-scope';
import { LessonService } from '../../src/lessons/lesson.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { SupervisionCaseService } from '../../src/cases/supervision-case.service';
import { ActionLogService } from '../../src/action-log/action-log.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const scope = new TeacherScopeService(g.prisma);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit, undefined, undefined, scope);
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit, scope);
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit);
const cases = new SupervisionCaseService(g.prisma, g.conversations, lessons, g.authz, g.outbox, audit, feedback);
const log = new ActionLogService(g.prisma, g.conversations);

jest.setTimeout(120_000);

let s: Scenario;
let sa: string;
let tmgr: string;
let tsupA: string;

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
  [sa, tmgr, tsupA] = [randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_l', 'super_admin', true)`, sa),
  ]);
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tmgr_l', 'manager', true), ($2::uuid, 'tsup_la', 'admin', true)`,
    tmgr, tsupA,
  );
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupA, dept,
  );
});

async function someWork() {
  const c = await cases.open(tsupA, { subject: { kind: 'teacher', id: s.teacherId }, target: 'teachers', title: 'secret title' });
  await cases.assign(tmgr, c.id, { ownerId: tsupA });
  const [{ d }] = await g.prisma.$queryRaw<Array<{ d: string }>>`SELECT (chat.academy_today() + 3)::text AS d`;
  await cases.setDue(tsupA, c.id, { dueOn: d });
  await cases.note(tsupA, c.id, { note: 'secret note' });
  return c.id;
}

describe('what the log holds', () => {
  it('their audited acts and their unaudited case history, newest first, without payloads or case content', async () => {
    const caseId = await someWork();
    const { entries } = await log.list(tsupA, tsupA, {});
    expect(entries.map((e) => e.action)).toEqual(['supervision_case.note', 'supervision_case.due', 'supervision_case.opened']);
    for (const e of entries) {
      expect(e).toMatchObject({ entity: 'supervision_case', entityId: caseId, reason: null });
      expect(e).not.toHaveProperty('before');
      expect(e).not.toHaveProperty('after');
    }
    expect(JSON.stringify(entries)).not.toMatch(/secret/);
    // The manager's assignment is the manager's, not theirs.
    expect((await log.list(tmgr, tmgr, {})).entries.map((e) => e.action)).toEqual(['supervision_case.assigned']);
  });

  it('keeps an audited reason, and filters by time', async () => {
    await g.prisma.$executeRaw`
      INSERT INTO chat.audit_log (actor_id, action, entity, entity_id, reason, at)
      VALUES (${tsupA}::uuid, 'teacher.lateness_recorded', 'teacher', ${s.teacherId}::uuid, 'ten minutes late', now() - interval '40 days')`;
    expect((await log.list(tsupA, tsupA, {})).entries).toEqual([]); // the last 30 days by default
    const old = await log.list(tsupA, tsupA, { from: new Date(Date.now() - 50 * 86_400_000).toISOString() });
    expect(old.entries).toEqual([
      expect.objectContaining({ action: 'teacher.lateness_recorded', entity: 'teacher', entityId: s.teacherId, reason: 'ten minutes late' }),
    ]);
    expect(await code(log.list(tsupA, tsupA, { from: 'yesterday' }))).toBe(CommErrorCode.VALIDATION);
  });
});

describe('who may read it', () => {
  it('the person, their department\'s manager and the super admin; anyone else reads it as not found', async () => {
    await someWork();
    for (const who of [tsupA, tmgr, sa]) expect((await log.list(who, tsupA, {})).entries.length).toBe(3);
    for (const who of [s.managerId, s.ownerId, s.otherAdminId]) {
      expect(await code(log.list(who, tsupA, {}))).toBe(CommErrorCode.ACTION_LOG_NOT_FOUND);
    }
    expect(await code(log.list(tsupA, randomUUID(), {}))).toBe(CommErrorCode.ACTION_LOG_NOT_FOUND);
    // A manager's own log is theirs and the super admin's.
    expect(await code(log.list(tsupA, tmgr, {}))).toBe(CommErrorCode.ACTION_LOG_NOT_FOUND);
  });
});
