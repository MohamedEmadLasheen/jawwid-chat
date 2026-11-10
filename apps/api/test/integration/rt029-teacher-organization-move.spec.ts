/**
 * RT-029 follow-up: a teacher cannot move to another organization while a
 * learner still names them (20261109140000_chat_teacher_org_move_guard).
 *
 * 20261109130000 guards the CHILD side: chat.learner.teacher_id must name a
 * teacher in the learner's organization. The PARENT side stayed open: an
 * UPDATE of chat.teacher.organization_id left every learner that names the
 * teacher pointing across the boundary. The new trigger
 * teacher_org_move_keeps_learners refuses that with check_violation (23514),
 * in chat.enforce_same_organization's "cross-organization reference" wording.
 *
 * Its own two organizations and rows, removed by id afterwards. Synthetic data
 * only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { withAssignmentGate } from './harness';

jest.setTimeout(60_000);

const db = new PrismaService();
const ORG_A = randomUUID();
const ORG_B = randomUUID();
const ids = {
  staffA: randomUUID(),
  staffB: randomUUID(),
  teacherWithLearner: randomUUID(),
  teacherWithoutLearner: randomUUID(),
  familyA: randomUUID(),
  learnerA: randomUUID(),
};

/** SQLSTATE and message of a refused statement; null when it succeeded. */
async function refusal(run: () => Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await run();
    return null;
  } catch (e) {
    const message = String((e as Error).message);
    const code = (e as { meta?: { code?: string } }).meta?.code ?? (message.match(/Code: `(\w+)`/)?.[1] ?? '');
    return { code: String(code), message };
  }
}
const exec = (sql: string) => () => db.$executeRawUnsafe(sql);
const orgOf = async (teacherId: string) =>
  (await db.$queryRawUnsafe<Array<{ o: string }>>(`select organization_id::text as o from chat.teacher where id = '${teacherId}'::uuid`))[0]?.o ?? null;
const moveTeacher = (teacherId: string, org: string) =>
  `update chat.teacher set organization_id = '${org}'::uuid where id = '${teacherId}'::uuid`;

beforeAll(async () => {
  for (const [org, slug] of [[ORG_A, 'a'], [ORG_B, 'b']] as const) {
    await db.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name) values ('${org}'::uuid, 'rt029m-${slug}-${org.slice(0, 8)}', 'RT-029 move ${slug}')`,
    );
  }
  await db.$executeRawUnsafe(
    `insert into chat.staff (id, organization_id, name, role) values
       ('${ids.staffA}'::uuid, '${ORG_A}'::uuid, 'rt029m_admin_a', 'admin'),
       ('${ids.staffB}'::uuid, '${ORG_B}'::uuid, 'rt029m_admin_b', 'admin')`,
  );
  await db.$executeRawUnsafe(
    `insert into chat.teacher (id, organization_id, name, is_active) values
       ('${ids.teacherWithLearner}'::uuid,    '${ORG_A}'::uuid, 'rt029m_teacher_l', true),
       ('${ids.teacherWithoutLearner}'::uuid, '${ORG_A}'::uuid, 'rt029m_teacher_n', true)`,
  );
  await db.$executeRawUnsafe(
    `insert into chat.family (id, organization_id, display_name, owner_id, language) values
       ('${ids.familyA}'::uuid, '${ORG_A}'::uuid, 'rt029m_family_a', '${ids.staffA}'::uuid, 'ar')`,
  );
  await withAssignmentGate(
    db,
    `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
     values ('${ids.learnerA}'::uuid, '${ORG_A}'::uuid, '${ids.familyA}'::uuid, 'rt029m_learner', '${ids.teacherWithLearner}'::uuid)`,
  );
});

afterAll(async () => {
  await withAssignmentGate(db, `delete from chat.learner where organization_id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$executeRawUnsafe(`delete from chat.family where organization_id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$executeRawUnsafe(`delete from chat.teacher where organization_id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$executeRawUnsafe(`delete from chat.staff where organization_id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$executeRawUnsafe(`delete from chat.organization where id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$disconnect();
});

describe('the guard is installed', () => {
  it('chat.teacher carries teacher_org_move_keeps_learners on UPDATE OF organization_id only', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ def: string }>>(
      `select pg_get_triggerdef(oid) as def from pg_trigger
        where tgrelid = 'chat.teacher'::regclass and not tgisinternal
          and tgname = 'teacher_org_move_keeps_learners'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/BEFORE UPDATE OF organization_id ON chat\.teacher FOR EACH ROW/);
    expect(rows[0].def).toMatch(/EXECUTE FUNCTION chat\.guard_teacher_organization_move\(\)/);
  });
});

describe('a teacher with learners cannot move to another organization', () => {
  it('is refused with check_violation, and the teacher stays in their organization', async () => {
    const out = await refusal(exec(moveTeacher(ids.teacherWithLearner, ORG_B)));
    expect(out?.code).toBe('23514');
    expect(out?.message).toMatch(/cross-organization reference: chat\.teacher .* would move to organization .*chat\.learner/);
    expect(await orgOf(ids.teacherWithLearner)).toBe(ORG_A);
  });

  it('is refused on the assignment-ingestion path too (the gate opens assignment, not tenancy)', async () => {
    const out = await refusal(() => withAssignmentGate(db, moveTeacher(ids.teacherWithLearner, ORG_B)));
    expect(out?.code).toBe('23514');
    expect(await orgOf(ids.teacherWithLearner)).toBe(ORG_A);
  });
});

describe('moves and updates that leave no learner across the boundary keep working', () => {
  it('a teacher with no learners moves to another organization', async () => {
    expect(await refusal(exec(moveTeacher(ids.teacherWithoutLearner, ORG_B)))).toBeNull();
    expect(await orgOf(ids.teacherWithoutLearner)).toBe(ORG_B);
    // And back again.
    expect(await refusal(exec(moveTeacher(ids.teacherWithoutLearner, ORG_A)))).toBeNull();
    expect(await orgOf(ids.teacherWithoutLearner)).toBe(ORG_A);
  });

  it('naming the same organization in an UPDATE of organization_id is accepted', async () => {
    expect(await refusal(exec(moveTeacher(ids.teacherWithLearner, ORG_A)))).toBeNull();
    expect(await refusal(exec(`update chat.teacher set organization_id = organization_id where id = '${ids.teacherWithLearner}'::uuid`))).toBeNull();
    expect(await orgOf(ids.teacherWithLearner)).toBe(ORG_A);
  });

  it('an update that does not touch organization_id is untouched by the guard', async () => {
    expect(await refusal(exec(`update chat.teacher set name = 'rt029m_teacher_l2' where id = '${ids.teacherWithLearner}'::uuid`))).toBeNull();
  });

  it('once the learner no longer names the teacher, the teacher may move', async () => {
    expect(await refusal(() => withAssignmentGate(db, `update chat.learner set teacher_id = null where id = '${ids.learnerA}'::uuid`))).toBeNull();
    expect(await refusal(exec(moveTeacher(ids.teacherWithLearner, ORG_B)))).toBeNull();
    expect(await orgOf(ids.teacherWithLearner)).toBe(ORG_B);
  });
});
