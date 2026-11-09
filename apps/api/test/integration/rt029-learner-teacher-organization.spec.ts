/**
 * RT-029: a learner's teacher is in the learner's organization
 * (20261109130000_chat_learner_same_org).
 *
 * chat.enforce_same_organization() guarded chat.learner.family_id but not
 * chat.learner.teacher_id, so a learner in organization A could be written
 * pointing at a teacher in organization B. The new trigger
 * learner_teacher_same_organization refuses that on INSERT and on an UPDATE of
 * teacher_id or organization_id, on every connection (the owner's included).
 *
 * The assignment gate (chat.guard_learner_assignment_change,
 * learner_assignment_is_guarded) still runs FIRST: a write that is not
 * ingestion is refused for authority (23001) before tenancy is considered;
 * ingestion that names another organization's teacher is refused for tenancy
 * (23514). The two cases below prove both orders.
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
  teacherA: randomUUID(),
  teacherA2: randomUUID(),
  teacherB: randomUUID(),
  familyA: randomUUID(),
  familyB: randomUUID(),
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
const gated = (sql: string) => () => withAssignmentGate(db, sql);
const teacherOf = async (learnerId: string) =>
  (await db.$queryRawUnsafe<Array<{ t: string | null }>>(`select teacher_id::text as t from chat.learner where id = '${learnerId}'::uuid`))[0]?.t ?? null;
const insertLearner = (id: string, org: string, family: string, teacher: string | null) =>
  `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
   values ('${id}'::uuid, '${org}'::uuid, '${family}'::uuid, 'rt029_learner', ${teacher ? `'${teacher}'::uuid` : 'null'})`;

beforeAll(async () => {
  for (const [org, slug] of [[ORG_A, 'a'], [ORG_B, 'b']] as const) {
    await db.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name) values ('${org}'::uuid, 'rt029-${slug}-${org.slice(0, 8)}', 'RT-029 ${slug}')`,
    );
  }
  await db.$executeRawUnsafe(
    `insert into chat.staff (id, organization_id, name, role) values
       ('${ids.staffA}'::uuid, '${ORG_A}'::uuid, 'rt029_admin_a', 'admin'),
       ('${ids.staffB}'::uuid, '${ORG_B}'::uuid, 'rt029_admin_b', 'admin')`,
  );
  await db.$executeRawUnsafe(
    `insert into chat.teacher (id, organization_id, name, is_active) values
       ('${ids.teacherA}'::uuid,  '${ORG_A}'::uuid, 'rt029_teacher_a',  true),
       ('${ids.teacherA2}'::uuid, '${ORG_A}'::uuid, 'rt029_teacher_a2', true),
       ('${ids.teacherB}'::uuid,  '${ORG_B}'::uuid, 'rt029_teacher_b',  true)`,
  );
  await db.$executeRawUnsafe(
    `insert into chat.family (id, organization_id, display_name, owner_id, language) values
       ('${ids.familyA}'::uuid, '${ORG_A}'::uuid, 'rt029_family_a', '${ids.staffA}'::uuid, 'ar'),
       ('${ids.familyB}'::uuid, '${ORG_B}'::uuid, 'rt029_family_b', '${ids.staffB}'::uuid, 'ar')`,
  );
  // Same organization: the positive control the rest of the file leans on.
  await withAssignmentGate(db, insertLearner(ids.learnerA, ORG_A, ids.familyA, ids.teacherA));
});

afterAll(async () => {
  await withAssignmentGate(db, `delete from chat.learner where organization_id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$executeRawUnsafe(`delete from chat.family where organization_id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$executeRawUnsafe(`delete from chat.teacher where organization_id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$executeRawUnsafe(`delete from chat.staff where organization_id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$executeRawUnsafe(`delete from chat.organization where id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$disconnect();
});

describe('the guard is installed, after the assignment gate', () => {
  it('chat.learner carries learner_teacher_same_organization on INSERT and UPDATE OF teacher_id, organization_id', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ tgname: string; def: string }>>(
      `select tgname::text, pg_get_triggerdef(oid) as def from pg_trigger
        where tgrelid = 'chat.learner'::regclass and not tgisinternal
        order by tgname`,
    );
    const names = rows.map((r) => r.tgname);
    expect(names).toEqual(expect.arrayContaining(['learner_assignment_is_guarded', 'learner_same_organization', 'learner_teacher_same_organization']));
    const def = rows.find((r) => r.tgname === 'learner_teacher_same_organization')!.def;
    expect(def).toMatch(/BEFORE INSERT OR UPDATE OF (organization_id, teacher_id|teacher_id, organization_id) ON chat\.learner/);
    expect(def).toMatch(/FOR EACH ROW EXECUTE FUNCTION chat\.enforce_same_organization\('teacher', 'teacher_id'\)/);
    // BEFORE row triggers fire in name order: authority, then tenancy.
    expect(names.indexOf('learner_assignment_is_guarded')).toBeLessThan(names.indexOf('learner_teacher_same_organization'));
  });
});

describe('a learner cannot name another organization\'s teacher', () => {
  it('INSERT through assignment ingestion is refused with check_violation, and nothing is written', async () => {
    const id = randomUUID();
    const out = await refusal(gated(insertLearner(id, ORG_A, ids.familyA, ids.teacherB)));
    expect(out?.code).toBe('23514');
    expect(out?.message).toMatch(/cross-organization reference: chat\.learner row belongs to organization .*parent chat\.teacher/);
    expect(await db.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int as n from chat.learner where id = '${id}'::uuid`)).toEqual([{ n: 0 }]);
  });

  it('the other direction too: an organization B learner cannot name an organization A teacher', async () => {
    const out = await refusal(gated(insertLearner(randomUUID(), ORG_B, ids.familyB, ids.teacherA)));
    expect(out?.code).toBe('23514');
    expect(out?.message).toMatch(/parent chat\.teacher/);
  });

  it('UPDATE through assignment ingestion is refused, and the assignment is unchanged', async () => {
    const out = await refusal(gated(`update chat.learner set teacher_id = '${ids.teacherB}'::uuid where id = '${ids.learnerA}'::uuid`));
    expect(out?.code).toBe('23514');
    expect(out?.message).toMatch(/parent chat\.teacher/);
    expect(await teacherOf(ids.learnerA)).toBe(ids.teacherA);
  });

  it('outside ingestion, the assignment gate refuses first (restrict_violation), not the tenancy guard', async () => {
    const out = await refusal(() =>
      db.$executeRawUnsafe(`update chat.learner set teacher_id = '${ids.teacherB}'::uuid where id = '${ids.learnerA}'::uuid`),
    );
    expect(out?.code).toBe('23001');
    expect(out?.message).toMatch(/owned by the academy assignment system/);
    expect(await teacherOf(ids.learnerA)).toBe(ids.teacherA);
  });
});

describe('same-organization writes keep working', () => {
  it('an INSERT with a same-organization teacher, and one with no teacher, are accepted', async () => {
    expect(await refusal(gated(insertLearner(randomUUID(), ORG_A, ids.familyA, ids.teacherA2)))).toBeNull();
    expect(await refusal(() => db.$executeRawUnsafe(insertLearner(randomUUID(), ORG_B, ids.familyB, null)))).toBeNull();
  });

  it('re-pointing to a same-organization teacher, and clearing the teacher, are accepted', async () => {
    expect(await refusal(gated(`update chat.learner set teacher_id = '${ids.teacherA2}'::uuid where id = '${ids.learnerA}'::uuid`))).toBeNull();
    expect(await teacherOf(ids.learnerA)).toBe(ids.teacherA2);
    expect(await refusal(gated(`update chat.learner set teacher_id = null where id = '${ids.learnerA}'::uuid`))).toBeNull();
    expect(await teacherOf(ids.learnerA)).toBeNull();
    expect(await refusal(gated(`update chat.learner set teacher_id = '${ids.teacherA}'::uuid where id = '${ids.learnerA}'::uuid`))).toBeNull();
    expect(await teacherOf(ids.learnerA)).toBe(ids.teacherA);
  });

  it('an update that does not touch teacher_id or organization_id is untouched by the guard', async () => {
    expect(await refusal(() => db.$executeRawUnsafe(`update chat.learner set level = 'B1' where id = '${ids.learnerA}'::uuid`))).toBeNull();
  });

  it('an unknown teacher is still refused by the foreign key, not silently accepted', async () => {
    const out = await refusal(gated(insertLearner(randomUUID(), ORG_A, ids.familyA, randomUUID())));
    expect(out?.code).toBe('23503');
  });
});
