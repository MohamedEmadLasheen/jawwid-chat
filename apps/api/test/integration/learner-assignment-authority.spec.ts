/**
 * The teacher <-> learner assignment is the academy's fact, not Chat's.
 *
 * PD-6 closed OD-04 that way: the academy's assignment system owns the
 * relationship, Chat consumes it, and `chat.learner.teacher_id` is a read model
 * rather than the business source of truth. Until this guard existed the
 * opposite was true in practice -- `20260905091200_chat_rls.sql` grants UPDATE
 * on chat.learner to `authenticated` and `learner_edited_by_admins` is `for
 * all`, so any admin, coverage admin or manager could set teacher_id, and an
 * INSERT could establish one outright.
 *
 * That is not a display bug waiting to happen. PD-6's predicate reads exactly
 * this column, so once the authorization switch lands, an in-Chat edit would
 * hand a teacher the right to message and call a family privately -- Chat
 * deciding an academic fact it does not own.
 *
 * These tests pin the boundary BEFORE that switch. They assert the refusal, and
 * they assert its limits in both directions: the rest of the learner row is
 * still editable, and the ingestion path that PD-6 depends on is still open.
 *
 * Nothing here authorizes anything. No Core feed exists, PD-6 is not active,
 * BR-1 is unchanged, and `chat.teacher_parent_authorized` has no caller.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { seed, truncate, withAssignmentGate, Scenario } from './harness';

jest.setTimeout(60_000);

const prisma = new PrismaService();
let s: Scenario;

/** The refusal the guard raises, whatever the caller's role. */
const REFUSAL = /owned by the academy assignment system/;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
});

/**
 * Run a statement with a given staff member set as the session actor.
 *
 * The helper sets `chat.actor_staff_id`, the session variable
 * `chat.current_staff_id()` actually reads. Be precise about what that does and
 * does not buy here: the integration harness connects as `postgres`, a
 * superuser, so RLS is bypassed in these tests and no policy is consulted. The
 * staff id is session context, not an RLS role path.
 *
 * That is not a gap in what is being proven. The guard is a trigger, and
 * triggers are not subject to RLS, so it refuses an unauthorized teacher_id
 * write whatever the connection -- deliberately role-blind, because an academic
 * fact is not a permission any Chat role can hold. Refusing even a superuser is
 * the stronger result.
 *
 * So read these tests as proof of the database write guard itself, under three
 * plausible staff identities, and NOT as three distinct RLS role paths. RLS
 * role coverage is a separate concern and is not exercised here.
 */
async function asRole(staffId: string, sql: string): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`select set_config('chat.actor_staff_id', '${staffId}', true)`),
    prisma.$executeRawUnsafe(sql),
  ]);
}

describe('a Chat-side edit cannot move a learner between teachers', () => {
  it('an admin cannot change teacher_id', async () => {
    await expect(
      asRole(
        s.ownerId,
        `update chat.learner set teacher_id = '${s.newTeacherId}'::uuid
          where id = '${s.learnerId}'::uuid`,
      ),
    ).rejects.toThrow(REFUSAL);
  });

  it('a coverage admin cannot change teacher_id', async () => {
    const coverageId = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active)
       values ('${coverageId}'::uuid, 'admin_cov', 'coverage', true)`,
    );

    await expect(
      asRole(
        coverageId,
        `update chat.learner set teacher_id = '${s.newTeacherId}'::uuid
          where id = '${s.learnerId}'::uuid`,
      ),
    ).rejects.toThrow(REFUSAL);
  });

  it('a manager cannot change teacher_id', async () => {
    await expect(
      asRole(
        s.managerId,
        `update chat.learner set teacher_id = '${s.newTeacherId}'::uuid
          where id = '${s.learnerId}'::uuid`,
      ),
    ).rejects.toThrow(REFUSAL);
  });

  it('nor clear it, which would revoke an assignment Chat does not own', async () => {
    await expect(
      asRole(
        s.ownerId,
        `update chat.learner set teacher_id = null where id = '${s.learnerId}'::uuid`,
      ),
    ).rejects.toThrow(REFUSAL);
  });

  it('nor create a learner that arrives pre-assigned', async () => {
    // The hole an UPDATE-only guard would leave: establish the assignment at
    // insert instead of changing it afterwards.
    await expect(
      asRole(
        s.ownerId,
        `insert into chat.learner (id, family_id, name, teacher_id)
         values ('${randomUUID()}'::uuid, '${s.familyId}'::uuid, 'learner_new',
                 '${s.teacherId}'::uuid)`,
      ),
    ).rejects.toThrow(REFUSAL);
  });

  it('and the assignment is still what it was', async () => {
    await expect(
      asRole(
        s.ownerId,
        `update chat.learner set teacher_id = '${s.newTeacherId}'::uuid
          where id = '${s.learnerId}'::uuid`,
      ),
    ).rejects.toThrow(REFUSAL);

    const rows = await prisma.$queryRawUnsafe<Array<{ teacher_id: string }>>(
      `select teacher_id from chat.learner where id = '${s.learnerId}'::uuid`,
    );
    expect(rows[0].teacher_id).toBe(s.teacherId);
  });
});

describe('the rest of the learner row is untouched by this', () => {
  it('an admin still edits the fields they legitimately own', async () => {
    await asRole(
      s.ownerId,
      `update chat.learner
          set name = 'learner_renamed', level = 'B2', consecutive_absences = 3
        where id = '${s.learnerId}'::uuid`,
    );

    const rows = await prisma.$queryRawUnsafe<
      Array<{ name: string; level: string; consecutive_absences: number }>
    >(
      `select name, level, consecutive_absences
         from chat.learner where id = '${s.learnerId}'::uuid`,
    );
    expect(rows[0].name).toBe('learner_renamed');
    expect(rows[0].level).toBe('B2');
    expect(Number(rows[0].consecutive_absences)).toBe(3);
  });

  it('a learner may still be created without an assignment', async () => {
    const id = randomUUID();
    await asRole(
      s.ownerId,
      `insert into chat.learner (id, family_id, name)
       values ('${id}'::uuid, '${s.familyId}'::uuid, 'learner_unassigned')`,
    );

    const rows = await prisma.$queryRawUnsafe<Array<{ teacher_id: string | null }>>(
      `select teacher_id from chat.learner where id = '${id}'::uuid`,
    );
    expect(rows[0].teacher_id).toBeNull();
    // This is the shape ingest_core_learner() already writes: the learner
    // arrives, the assignment follows separately.
  });

  it('writing the same teacher_id back is not a change and is allowed', async () => {
    await asRole(
      s.ownerId,
      `update chat.learner set teacher_id = '${s.teacherId}'::uuid
        where id = '${s.learnerId}'::uuid`,
    );
  });
});

describe('the ingestion path PD-6 depends on stays open', () => {
  it('a caller that opens the gate may reassign', async () => {
    await withAssignmentGate(
      prisma,
      `update chat.learner set teacher_id = '${s.newTeacherId}'::uuid
        where id = '${s.learnerId}'::uuid`,
    );

    const rows = await prisma.$queryRawUnsafe<Array<{ teacher_id: string }>>(
      `select teacher_id from chat.learner where id = '${s.learnerId}'::uuid`,
    );
    expect(rows[0].teacher_id).toBe(s.newTeacherId);
  });

  it('and may end an assignment', async () => {
    await withAssignmentGate(
      prisma,
      `update chat.learner set teacher_id = null where id = '${s.learnerId}'::uuid`,
    );

    const rows = await prisma.$queryRawUnsafe<Array<{ teacher_id: string | null }>>(
      `select teacher_id from chat.learner where id = '${s.learnerId}'::uuid`,
    );
    expect(rows[0].teacher_id).toBeNull();
  });

  it('the gate closes with its transaction and does not leak to the next write', async () => {
    // Why the helper puts the gate and the write in one transaction: the
    // setting is transaction-local, so a gate opened once cannot leave
    // teacher_id writable for the rest of the session.
    await withAssignmentGate(
      prisma,
      `update chat.learner set teacher_id = '${s.newTeacherId}'::uuid
        where id = '${s.learnerId}'::uuid`,
    );

    await expect(
      prisma.$executeRawUnsafe(
        `update chat.learner set teacher_id = '${s.teacherId}'::uuid
          where id = '${s.learnerId}'::uuid`,
      ),
    ).rejects.toThrow(REFUSAL);
  });
});
