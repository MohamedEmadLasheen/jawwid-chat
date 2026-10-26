/**
 * PD-32 (amends PD-26) -- a parent's feedback about their child's teacher.
 *
 *   1. the parent files praise, a suggestion or a complaint about a child of
 *      their own family; reads back status and the one reply -- nothing internal
 *   2. a complaint is a PD-26 complaint (source parent_app): the Teachers
 *      department takes it (handler, once), follows up, resolves; upholding it
 *      joins the monthly ladder; the parent's status follows
 *   3. praise and suggestions: reply and resolve; a complaint cannot be resolved
 *      around its PD-26 resolution
 *   4. the teacher never reaches any of it; staff outside the department read
 *      only as the children's supervisor
 *   5. per child and per family per day
 *   6. the database: an app complaint names its feedback, is the parent's own
 *      text, and changes only by having its handler set once
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { DisciplineService } from '../../src/discipline/discipline.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialService } from '../../src/lessons/trial.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { ParentFeedbackService } from '../../src/teacher-file/parent-feedback.service';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const supervision = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, new NewStudentsService(g.prisma));
const discipline = new DisciplineService(g.prisma, g.conversations, supervision, cards, lessons, g.outbox, g.config, audit, trials);
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit);
const feedback = new ParentFeedbackService(g.prisma, g.conversations, files, audit);

jest.setTimeout(120_000);

let s: Scenario;
let tsupId: string;
let tmgrId: string;
let superId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.status;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const file = (category: string, body = 'Lessons often start ten minutes late.', learnerId = s.learnerId) =>
  feedback.file(s.parentId, { learnerId, category, body });

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
  tmgrId = randomUUID();
  superId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_f', 'admin', true), ($2::uuid, 'tmgr_f', 'manager', true)`,
    tsupId,
    tmgrId,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root_f', 'super_admin', true)`, superId);
  });
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

describe('1. the parent files feedback and reads back only what is theirs', () => {
  it('praise and a complaint; children with their teacher; status and reply, never internal notes', async () => {
    const praise = await file('praise', 'Very patient with my son.');
    expect(praise).toMatchObject({ category: 'praise', status: 'received', response: null, childName: 'learner_l', learnerId: s.learnerId });
    const complaint = await file('complaint');
    expect(complaint.status).toBe('received');

    const mine = await feedback.mine(s.parentId);
    expect(mine.children.map((c) => c.learnerId).sort()).toEqual([s.learnerId, s.secondLearnerId].sort());
    expect(mine.children.every((c) => typeof c.teacherName === 'string')).toBe(true);
    expect(mine.feedback.map((f) => f.id)).toEqual([complaint.id, praise.id]);
    // Exactly these keys: no handler, no follow-ups, no decision, no staff names.
    expect(Object.keys(mine.feedback[0]).sort()).toEqual(
      ['body', 'category', 'childName', 'createdAt', 'id', 'learnerId', 'respondedAt', 'response', 'status', 'teacherName'].sort(),
    );

    // The family's other parent reads the same family's feedback.
    expect((await feedback.mine(s.otherParentId)).feedback).toHaveLength(2);
    // The text stays out of the audit trail.
    const trail = await g.prisma.auditLog.findMany({ where: { action: 'parent_feedback.filed' } });
    expect(trail).toHaveLength(2);
    expect(JSON.stringify(trail.map((t) => [t.after, t.reason]))).not.toContain('ten minutes late');
  });

  it('refuses a child outside the family, a child without a teacher, and bad input', async () => {
    expect(await code(file('praise', 'x', randomUUID()))).toBe(CommErrorCode.FEEDBACK_NOT_FOUND);
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = null where id = '${s.secondLearnerId}'::uuid`);
    expect(await code(file('praise', 'x', s.secondLearnerId))).toBe(CommErrorCode.FEEDBACK_NOT_FOUND);
    expect(await code(file('rant'))).toBe(CommErrorCode.VALIDATION);
    expect(await code(file('praise', '   '))).toBe(CommErrorCode.VALIDATION);
    expect(await code(file('praise', 'x'.repeat(2001)))).toBe(CommErrorCode.VALIDATION);
    expect(await g.prisma.parentFeedback.count()).toBe(0);
  });
});

describe('2. a complaint is a PD-26 complaint', () => {
  it('lands in the queue as parent_app; taken, followed up, upheld onto the ladder, resolved; the parent sees the status only', async () => {
    const filed = await file('complaint');
    const entry = await g.prisma.teacherSupervisionEntry.findUniqueOrThrow({ where: { parentFeedbackId: filed.id } });
    expect(entry).toMatchObject({ kind: 'complaint', teacherId: s.teacherId, complaintSource: 'parent_app', createdBy: null, handledBy: null });

    const queue = await files.complaints(tsupId, { from: 'parent_app' });
    expect(queue.complaints).toHaveLength(1);
    expect(queue.complaints[0]).toMatchObject({
      id: entry.id,
      from: 'parent_app',
      author: null,
      handledBy: null,
      status: 'open',
      parentFeedback: { id: filed.id, child: { id: s.learnerId, name: 'learner_l' }, parent: { id: s.parentId }, status: 'received' },
    });

    // Taking it names the handler once, and the parent reads "in review".
    await feedback.take(tsupId, filed.id);
    await feedback.take(tmgrId, filed.id);
    expect((await g.prisma.teacherSupervisionEntry.findUniqueOrThrow({ where: { id: entry.id } })).handledBy).toBe(tsupId);
    expect((await feedback.mine(s.parentId)).feedback[0].status).toBe('in_review');

    await files.addEntry(tsupId, s.teacherId, { kind: 'complaint_followup', body: 'Internal: spoke to the teacher.', refersTo: entry.id });
    const upheld = await discipline.upholdComplaint(tmgrId, entry.id, { note: 'confirmed' });
    expect(upheld.violation).toMatchObject({ kind: 'complaint', complaint: { id: entry.id, from: 'parent_app' } });
    await files.addEntry(tmgrId, s.teacherId, { kind: 'complaint_resolution', body: 'Internal: warned.', refersTo: entry.id });

    const parent = (await feedback.mine(s.parentId)).feedback[0];
    expect(parent.status).toBe('resolved');
    expect(JSON.stringify(parent)).not.toMatch(/Internal|warned|confirmed|tsup_f|tmgr_f/);
    // A follow-up after the resolution never moves it back.
    await files.addEntry(tsupId, s.teacherId, { kind: 'complaint_followup', body: 'Checked again.', refersTo: entry.id });
    expect((await feedback.mine(s.parentId)).feedback[0].status).toBe('resolved');
    // On the Teacher File too.
    const tf = await files.detail(tsupId, s.teacherId);
    expect(tf.supervision.complaints[0]).toMatchObject({ id: entry.id, from: 'parent_app', status: 'resolved' });
  });

  it('praise and suggestions are not complaints', async () => {
    await file('praise');
    await file('suggestion');
    expect(await g.prisma.teacherSupervisionEntry.count()).toBe(0);
    expect((await feedback.list(tsupId, {})).feedback.map((f) => f.category).sort()).toEqual(['praise', 'suggestion']);
  });
});

describe('3. the reply the parent reads', () => {
  it('a reply moves it to in review; resolve closes praise; a complaint resolves only through PD-26', async () => {
    const praise = await file('praise');
    const replied = await feedback.reply(tsupId, praise.id, { response: 'Thank you, we told the teacher.' });
    expect(replied).toMatchObject({ status: 'in_review', response: 'Thank you, we told the teacher.', respondedBy: { id: tsupId } });
    await feedback.reply(tmgrId, praise.id, { response: 'Thank you!', resolve: true });
    expect((await feedback.mine(s.parentId)).feedback[0]).toMatchObject({ status: 'resolved', response: 'Thank you!' });

    const complaint = await file('complaint');
    expect(await status(feedback.reply(tsupId, complaint.id, { response: 'Sorry.', resolve: true }))).toBe(409);
    await feedback.reply(tsupId, complaint.id, { response: 'We are looking into it.' });
    expect((await feedback.mine(s.parentId)).feedback[0]).toMatchObject({ status: 'in_review', response: 'We are looking into it.' });
    expect(await code(feedback.reply(tsupId, complaint.id, { response: '  ' }))).toBe(CommErrorCode.VALIDATION);
  });
});

describe('4. who reaches it', () => {
  it('the teacher reaches nothing: not as a parent, not as staff', async () => {
    const f = await file('complaint');
    expect(await code(feedback.mine(s.teacherId))).toBe(CommErrorCode.FEEDBACK_DENIED);
    expect(await code(feedback.file(s.teacherId, { learnerId: s.learnerId, category: 'praise', body: 'x' }))).toBe(CommErrorCode.FEEDBACK_DENIED);
    expect(await code(feedback.list(s.teacherId, {}))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(feedback.take(s.teacherId, f.id))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(feedback.reply(s.teacherId, f.id, { response: 'x' }))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(feedback.forFamily(s.teacherId, s.familyId))).toBe(CommErrorCode.FEEDBACK_DENIED);
    expect(await code(files.complaints(s.teacherId, {}))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
  });

  it('staff: the department and the super admin read all; the children\'s supervisor reads theirs; others nothing', async () => {
    await file('praise');
    await file('suggestion', 'More homework please.', s.secondLearnerId);
    expect((await feedback.list(superId, {})).feedback).toHaveLength(2);
    expect((await feedback.list(tsupId, { category: 'praise' })).feedback).toHaveLength(1);
    // Parents never read the staff list.
    expect(await code(feedback.list(s.parentId, {}))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    // ownerId supervises both children (seed).
    expect((await feedback.forFamily(s.ownerId, s.familyId)).feedback).toHaveLength(2);
    // A supervisor of only the second child reads only its feedback.
    await g.prisma.$executeRawUnsafe(
      `update chat.learner_supervision set supervisor_id = $2::uuid where learner_id = $1::uuid`,
      s.secondLearnerId,
      s.otherAdminId,
    );
    expect((await feedback.forFamily(s.otherAdminId, s.familyId)).feedback.map((f) => f.category)).toEqual(['suggestion']);
    // Staff who supervise none of the family: the same 404 as no such family (no
    // existence oracle); the list route is the department's.
    expect(await code(feedback.forFamily(s.managerId, s.familyId))).toBe(CommErrorCode.FEEDBACK_NOT_FOUND);
    expect(await code(feedback.list(s.ownerId, {}))).toBe(CommErrorCode.TEACHER_FILE_DENIED);
    expect(await code(feedback.forFamily(tsupId, randomUUID()))).toBe(CommErrorCode.FEEDBACK_NOT_FOUND);
  });
});

describe('4b. a transfer racing the filing', () => {
  it('a teacher change between the read and the insert is a clean 409, never filed against the wrong teacher', async () => {
    // The pre-read sees the old teacher; the transfer has already happened in the database.
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${s.unrelatedTeacherId}'::uuid where id = '${s.learnerId}'::uuid`);
    const stale = jest.spyOn(g.prisma.learner, 'findFirst').mockResolvedValueOnce({ id: s.learnerId, teacherId: s.teacherId } as never);
    try {
      expect(await status(file('complaint'))).toBe(409);
    } finally {
      stale.mockRestore();
    }
    expect(await g.prisma.parentFeedback.count()).toBe(0);
    expect(await g.prisma.teacherSupervisionEntry.count()).toBe(0);
    // Retried, it goes to the child's teacher now.
    const filed = await file('complaint');
    expect((await g.prisma.parentFeedback.findUniqueOrThrow({ where: { id: filed.id } })).teacherId).toBe(s.unrelatedTeacherId);
  });

  it('a child left without a teacher mid-filing is the same 409', async () => {
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = null where id = '${s.learnerId}'::uuid`);
    const stale = jest.spyOn(g.prisma.learner, 'findFirst').mockResolvedValueOnce({ id: s.learnerId, teacherId: s.teacherId } as never);
    try {
      expect(await code(file('praise'))).toBe(CommErrorCode.FEEDBACK_STATE);
    } finally {
      stale.mockRestore();
    }
  });
});

describe('5. rate limits', () => {
  it('three per child and ten per family in 24 hours, from chat.config', async () => {
    for (let i = 0; i < 3; i++) await file('praise', `thanks ${i}`);
    expect(await status(file('praise', 'one more'))).toBe(429);
    expect(await code(file('praise', 'one more'))).toBe(CommErrorCode.FEEDBACK_LIMIT);
    // Another child still has room; the family cap is the config value.
    await g.prisma.config.update({ where: { key: 'feedback.limit.per_family_day' }, data: { value: 4 } });
    await file('praise', 'second child', s.secondLearnerId);
    expect(await code(file('praise', 'second child again', s.secondLearnerId))).toBe(CommErrorCode.FEEDBACK_LIMIT);
    await g.prisma.config.update({ where: { key: 'feedback.limit.per_family_day' }, data: { value: 10 } });
  });
});

describe('6. the database keeps the rules', () => {
  it('an app complaint is the feedback\'s own; only its handler may be set, once, by the department', async () => {
    const filed = await file('complaint');
    const entry = await g.prisma.teacherSupervisionEntry.findUniqueOrThrow({ where: { parentFeedbackId: filed.id } });
    const refused = async (sql: string, ...args: unknown[]) => {
      await expect(g.prisma.$executeRawUnsafe(sql, ...args)).rejects.toThrow();
    };
    // No author without a feedback; not someone else's text; not another teacher.
    await refused(
      `insert into chat.teacher_supervision_entry (organization_id, teacher_id, kind, body, complaint_source)
       values (chat.default_organization_id(), $1::uuid, 'complaint', 'x', 'parent_app')`,
      s.teacherId,
    );
    await refused(
      `insert into chat.teacher_supervision_entry (organization_id, teacher_id, kind, body, complaint_source, parent_feedback_id)
       values (chat.default_organization_id(), $1::uuid, 'complaint', 'other words', 'parent_app', $2::uuid)`,
      s.newTeacherId,
      filed.id,
    );
    // The handler: not a non-member, then once; nothing else changes.
    await refused(`update chat.teacher_supervision_entry set handled_by = $2::uuid where id = $1::uuid`, entry.id, s.otherAdminId);
    await g.prisma.$executeRawUnsafe(`update chat.teacher_supervision_entry set handled_by = $2::uuid where id = $1::uuid`, entry.id, tsupId);
    await refused(`update chat.teacher_supervision_entry set handled_by = $2::uuid where id = $1::uuid`, entry.id, tmgrId);
    await refused(`update chat.teacher_supervision_entry set body = 'changed' where id = $1::uuid`, entry.id);
    await refused(`delete from chat.teacher_supervision_entry where id = $1::uuid`, entry.id);
    // What the parent wrote never changes, the status never goes back, nothing is deleted.
    await refused(`update chat.parent_feedback set body = 'changed' where id = $1::uuid`, filed.id);
    await g.prisma.$executeRawUnsafe(`update chat.parent_feedback set status = 'resolved' where id = $1::uuid`, filed.id);
    await refused(`update chat.parent_feedback set status = 'received' where id = $1::uuid`, filed.id);
    await refused(`delete from chat.parent_feedback where id = $1::uuid`, filed.id);
    // A management complaint still needs a staff author from the department.
    await refused(
      `insert into chat.teacher_supervision_entry (organization_id, teacher_id, kind, body, complaint_source, created_by)
       values (chat.default_organization_id(), $1::uuid, 'complaint', 'x', 'management', $2::uuid)`,
      s.teacherId,
      s.otherAdminId,
    );
  });

  it('no request role can read the feedback table', async () => {
    const grants = await g.prisma.$queryRawUnsafe<Array<{ grantee: string }>>(
      `select grantee from information_schema.role_table_grants
        where table_schema = 'chat' and table_name in ('parent_feedback', 'parent_signup_failure')`,
    );
    expect(grants.map((r) => r.grantee).filter((x) => x !== 'postgres')).toEqual([]);
  });
});
