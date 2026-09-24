/**
 * PD-6 step 1: the teacher <-> parent relationship predicate, proven on its own
 * before anything is authorized differently.
 *
 * Two implementations answer the same question -- `PrismaRelationshipService`
 * (Prisma) and `chat.teacher_parent_authorized` (SQL) -- and the policy needs
 * the rule at both layers. Every case below runs through BOTH and asserts they
 * agree, so a divergence is a failing test rather than a latent disagreement
 * between the application and its backstop.
 *
 * These run against the real database because the predicate is a fact about
 * rows: which learner links which teacher to which family, and whether the
 * organization matches. A stub would prove the query was issued, not that it
 * decides correctly.
 *
 * BR-1 IS NOT TOUCHED BY THIS. Nothing here changes an authorization decision;
 * the predicate has no caller yet. `br1_invariants.sql`,
 * `schema-invariants.spec.ts` and `br1-conformance.spec.ts` remain the
 * authority on BR-1 and are unmodified.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { PrismaRelationshipService } from '@platform/relationship.service';
import { seed, truncate, withAssignmentGate, Scenario } from './harness';

jest.setTimeout(60_000);

const prisma = new PrismaService();
const relationships = new PrismaRelationshipService(prisma);

/** A second tenant, for the cross-organization cases. */
const OTHER_ORG = '00000000-0000-0000-0000-0000000000f6';

let s: Scenario;

beforeAll(async () => {
  await prisma.$connect();
  await prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name)
     values ('${OTHER_ORG}'::uuid, 'pd6-other-org', 'other tenant')
     on conflict (id) do nothing`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
});

/** The SQL half, asked directly. */
async function sqlSaysAuthorized(teacherId: string | null, contactId: string | null) {
  const rows = await prisma.$queryRawUnsafe<Array<{ authorized: boolean }>>(
    `select chat.teacher_parent_authorized(
       ${teacherId === null ? 'null' : `'${teacherId}'::uuid`},
       ${contactId === null ? 'null' : `'${contactId}'::uuid`}
     ) as authorized`,
  );
  return rows[0].authorized;
}

/**
 * Asks both halves and requires them to agree before returning the answer, so
 * every case in this file is also an equivalence assertion.
 */
async function authorized(teacherId: string, contactId: string): Promise<boolean> {
  const [app, db] = await Promise.all([
    relationships.teacherParentAuthorized(teacherId, contactId),
    sqlSaysAuthorized(teacherId, contactId),
  ]);
  expect({ layer: 'application', value: app }).toEqual({ layer: 'application', value: db });
  return app;
}

describe('an authorized pair', () => {
  it('a teacher who teaches a learner in the family, and a contact who may message', async () => {
    // seed() puts learner_l under teacherId, in parentId's family.
    expect(await authorized(s.teacherId, s.parentId)).toBe(true);
  });

  it('holds for every messaging contact in that family, not just the primary', async () => {
    expect(await authorized(s.teacherId, s.otherParentId)).toBe(true);
  });

  it('one qualifying learner is enough, among several', async () => {
    // learner_m is taught by newTeacherId in the same family; adding more
    // learners must not disturb the pair that already qualifies.
    expect(await authorized(s.teacherId, s.parentId)).toBe(true);
    expect(await authorized(s.newTeacherId, s.parentId)).toBe(true);
  });
});

describe('an unauthorized pair', () => {
  it('a teacher who teaches nobody in this family', async () => {
    const stranger = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.teacher (id, name, is_active) values ('${stranger}'::uuid, 'teacher_z', true)`,
    );
    expect(await authorized(stranger, s.parentId)).toBe(false);
  });

  it('a learner with no teacher assigned links nobody', async () => {
    await withAssignmentGate(prisma, `update chat.learner set teacher_id = null`);
    expect(await authorized(s.teacherId, s.parentId)).toBe(false);
  });

  it('a contact who may not message', async () => {
    await prisma.$executeRawUnsafe(
      `update chat.contact set can_message = false where id = '${s.parentId}'::uuid`,
    );
    expect(await authorized(s.teacherId, s.parentId)).toBe(false);
  });

  it('an inactive contact', async () => {
    await prisma.$executeRawUnsafe(
      `update chat.contact set is_active = false where id = '${s.parentId}'::uuid`,
    );
    expect(await authorized(s.teacherId, s.parentId)).toBe(false);
  });

  it('an inactive teacher', async () => {
    await prisma.$executeRawUnsafe(
      `update chat.teacher set is_active = false where id = '${s.teacherId}'::uuid`,
    );
    expect(await authorized(s.teacherId, s.parentId)).toBe(false);
  });

  it('ids that name nothing', async () => {
    expect(await authorized(randomUUID(), s.parentId)).toBe(false);
    expect(await authorized(s.teacherId, randomUUID())).toBe(false);
  });

  it('the two ids the wrong way round', async () => {
    // A contact id is not a teacher id. Nothing should resolve.
    expect(await authorized(s.parentId, s.teacherId)).toBe(false);
  });

  it('a malformed id fails closed rather than throwing', async () => {
    await expect(
      relationships.teacherParentAuthorized('not-a-uuid', s.parentId),
    ).resolves.toBe(false);
    await expect(
      relationships.teacherParentAuthorized(s.teacherId, ''),
    ).resolves.toBe(false);
  });

  it('a null id answers false in the database', async () => {
    expect(await sqlSaysAuthorized(null, s.parentId)).toBe(false);
    expect(await sqlSaysAuthorized(s.teacherId, null)).toBe(false);
    expect(await sqlSaysAuthorized(null, null)).toBe(false);
  });
});

describe('across organizations', () => {
  it('a teacher in another organization is not authorized, even with a learner row pointing at this family', async () => {
    const foreignTeacher = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.teacher (id, organization_id, name, is_active)
       values ('${foreignTeacher}'::uuid, '${OTHER_ORG}'::uuid, 'teacher_foreign', true)`,
    );
    // A learner in THIS organization taught by the foreign teacher: the
    // relationship exists on paper and must still be refused.
    await withAssignmentGate(
      prisma,
      `insert into chat.learner (id, family_id, name, teacher_id)
       values ('${randomUUID()}'::uuid, '${s.familyId}'::uuid, 'learner_x', '${foreignTeacher}'::uuid)`,
    );

    expect(await authorized(foreignTeacher, s.parentId)).toBe(false);
  });

  it('a contact in another organization is not authorized', async () => {
    const foreignFamily = randomUUID();
    const foreignContact = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.family (id, organization_id, display_name, owner_id, language)
       values ('${foreignFamily}'::uuid, '${OTHER_ORG}'::uuid, 'family_foreign', '${s.ownerId}'::uuid, 'ar')`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.contact (id, organization_id, family_id, name, role_preset, can_message, is_active)
       values ('${foreignContact}'::uuid, '${OTHER_ORG}'::uuid, '${foreignFamily}'::uuid,
               'parent_foreign', 'primary_guardian', true, true)`,
    );
    // A learner in the foreign family taught by OUR teacher.
    await withAssignmentGate(
      prisma,
      `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
       values ('${randomUUID()}'::uuid, '${OTHER_ORG}'::uuid, '${foreignFamily}'::uuid,
               'learner_foreign', '${s.teacherId}'::uuid)`,
    );

    expect(await authorized(s.teacherId, foreignContact)).toBe(false);
  });
});

describe('revocation takes effect immediately', () => {
  it('withdrawing can_message ends the authorization', async () => {
    expect(await authorized(s.teacherId, s.parentId)).toBe(true);

    await prisma.$executeRawUnsafe(
      `update chat.contact set can_message = false where id = '${s.parentId}'::uuid`,
    );

    expect(await authorized(s.teacherId, s.parentId)).toBe(false);
  });

  it('a teacher who leaves ends the authorization, even with is_active still true', async () => {
    expect(await authorized(s.teacherId, s.parentId)).toBe(true);

    // The case the flag alone would miss: left_at set, is_active untouched.
    await prisma.$executeRawUnsafe(
      `update chat.teacher set left_at = now() where id = '${s.teacherId}'::uuid`,
    );

    const stillFlaggedActive = await prisma.$queryRawUnsafe<Array<{ is_active: boolean }>>(
      `select is_active from chat.teacher where id = '${s.teacherId}'::uuid`,
    );
    expect(stillFlaggedActive[0].is_active).toBe(true);

    expect(await authorized(s.teacherId, s.parentId)).toBe(false);
  });

  it('deactivating the contact ends the authorization', async () => {
    expect(await authorized(s.teacherId, s.parentId)).toBe(true);

    await prisma.$executeRawUnsafe(
      `update chat.contact set is_active = false where id = '${s.parentId}'::uuid`,
    );

    expect(await authorized(s.teacherId, s.parentId)).toBe(false);
  });

  it('reassigning the learner to another teacher ends the authorization', async () => {
    expect(await authorized(s.teacherId, s.parentId)).toBe(true);

    await withAssignmentGate(
      prisma,
      `update chat.learner set teacher_id = '${s.newTeacherId}'::uuid
       where teacher_id = '${s.teacherId}'::uuid`,
    );

    expect(await authorized(s.teacherId, s.parentId)).toBe(false);
    // and the teacher it moved to is now authorized instead
    expect(await authorized(s.newTeacherId, s.parentId)).toBe(true);
  });
});
