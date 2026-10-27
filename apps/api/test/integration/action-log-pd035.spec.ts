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

// ---------------------------------------------------------------------------
// Review of #160
// ---------------------------------------------------------------------------

describe('P2-1. paging never loses or repeats a line, even when many share one instant', () => {
  it('250 acts written in one transaction come back whole, across pages, once each', async () => {
    await g.prisma.$executeRaw`
      INSERT INTO chat.audit_log (actor_id, action, entity, entity_id, reason)
      SELECT ${tsupA}::uuid, 'learner.supervisor_assigned', 'learner', ${s.learnerId}::uuid, 'bulk ' || n
        FROM generate_series(1, 250) AS n`;
    const first = await log.list(tsupA, tsupA, {});
    expect(first.entries).toHaveLength(200);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await log.list(tsupA, tsupA, { cursor: first.nextCursor as string });
    expect(second.entries).toHaveLength(50);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.entries, ...second.entries].map((e) => e.id);
    expect(new Set(ids).size).toBe(250);
    const reasons = new Set([...first.entries, ...second.entries].map((e) => e.reason));
    for (let n = 1; n <= 250; n += 1) expect(reasons.has(`bulk ${n}`)).toBe(true);
    expect(await code(log.list(tsupA, tsupA, { cursor: 'not-a-cursor' }))).toBe(CommErrorCode.VALIDATION);
  });
});

describe('P2-2. a manager reads the reasons of the time the member was theirs', () => {
  it('a reason written before they joined the manager\'s department is withheld from the manager, never from themselves', async () => {
    await g.prisma.$executeRaw`
      INSERT INTO chat.audit_log (actor_id, action, entity, entity_id, reason, at)
      VALUES (${tsupA}::uuid, 'payment.voided', 'family', ${s.familyId}::uuid, 'ops-era reason', now() - interval '5 days')`;
    // They (re)joined the Teachers department yesterday.
    await g.prisma.$executeRaw`UPDATE chat.department_member SET assigned_at = now() - interval '1 day' WHERE staff_id = ${tsupA}::uuid`;
    await g.prisma.$executeRaw`
      INSERT INTO chat.audit_log (actor_id, action, entity, entity_id, reason)
      VALUES (${tsupA}::uuid, 'teacher.lateness_recorded', 'teacher', ${s.teacherId}::uuid, 'teachers-era reason')`;
    const byManager = (await log.list(tmgr, tsupA, {})).entries;
    expect(byManager.find((e) => e.action === 'payment.voided')?.reason).toBeNull();
    expect(byManager.find((e) => e.action === 'teacher.lateness_recorded')?.reason).toBe('teachers-era reason');
    expect((await log.list(tsupA, tsupA, {})).entries.find((e) => e.action === 'payment.voided')?.reason).toBe('ops-era reason');
    expect((await log.list(sa, tsupA, {})).entries.find((e) => e.action === 'payment.voided')?.reason).toBe('ops-era reason');
  });
});

describe('the edges of a request', () => {
  it('a time needs its zone; at most 366 days; an id that is not a uuid; an inactive reader', async () => {
    expect(await code(log.list(tsupA, tsupA, { from: '2026-10-20T10:00:00' }))).toBe(CommErrorCode.VALIDATION);
    expect((await log.list(tsupA, tsupA, { from: '2026-10-20T10:00:00Z' })).entries).toBeDefined();
    const now = Date.now();
    expect(await code(log.list(tsupA, tsupA, { from: new Date(now - 400 * 86_400_000).toISOString(), to: new Date(now).toISOString() })))
      .toBe(CommErrorCode.VALIDATION);
    expect(await code(log.list(tsupA, 'not-a-uuid', {}))).toBe(CommErrorCode.ACTION_LOG_NOT_FOUND);
    await g.prisma.$executeRaw`UPDATE chat.staff SET is_active = false, left_at = now() WHERE id = ${tmgr}::uuid`;
    expect(await code(log.list(tmgr, tsupA, {}))).toBe(CommErrorCode.ACTION_LOG_NOT_FOUND);
  });

  it('a super admin of another organization reads it as not found', async () => {
    const [org2, sa2] = [randomUUID(), randomUUID()];
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'org_two')`, org2, `org-two-${org2.slice(0, 8)}`);
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
      g.prisma.$executeRawUnsafe(
        `insert into chat.staff (id, name, role, is_active, organization_id) values ($1::uuid, 'sa_two', 'super_admin', true, $2::uuid)`, sa2, org2,
      ),
    ]);
    expect(await code(log.list(sa2, tsupA, {}))).toBe(CommErrorCode.ACTION_LOG_NOT_FOUND);
  });
});

