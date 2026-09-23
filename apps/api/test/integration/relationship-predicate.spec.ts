/**
 * PD-6 — the authorized teacher<->parent relationship predicate, at BOTH
 * layers, against the real migrated database.
 *
 * Two enforcement points answer this question independently:
 *
 *   PrismaRelationshipService.teacherParentAuthorized()  the application's answer
 *   chat.teacher_parent_authorized(uuid, uuid)           the database's answer
 *
 * Independent is the point. If the service simply called the SQL function there
 * would be one implementation wearing two hats, and a bug in it would be a bug
 * in both. So every case below is asserted against BOTH, and a third assertion
 * requires them to agree. A divergence is a failure even when both answers look
 * individually defensible — the two layers disagreeing about who may speak to
 * whom is exactly the state this design exists to prevent.
 *
 * The database's own structural suite is db/tests/relationship_predicate.sql,
 * which proves the SQL half with this process out of the picture entirely.
 *
 * SCOPE. This phase adds the predicate and does not consume it. The old BR-1
 * denials are still in force in canOpenDirect / canSend / canCall, and the last
 * describe block in this file asserts that they are. The authorization switch
 * is the next phase.
 */
import { randomUUID } from 'node:crypto';
import { PrismaRelationshipService } from '@platform/relationship.service';
import { CommErrorCode } from '@platform/errors';
import { buildGraph } from './harness';
import { parent as parentActor, teacher as teacherActor } from '../support/fixtures';

jest.setTimeout(60_000);

const g = buildGraph();
const relationships = new PrismaRelationshipService(g.prisma);

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_B = randomUUID();

interface World {
  adminA: string;
  familyOne: string;
  familyTwo: string;
  teacherAssigned: string;
  teacherSecond: string;
  teacherUnrelated: string;
  teacherInactive: string;
  teacherLeft: string;
  parentOk: string;
  parentInactive: string;
  parentNoMessage: string;
  parentOtherFamily: string;
  learnerOne: string;
  teacherB: string;
  parentB: string;
}

let w: World;

/** The database's own answer, reached directly. */
async function sqlSays(teacherId: string | null, contactId: string | null): Promise<boolean> {
  const rows = await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
    'select chat.teacher_parent_authorized($1::uuid, $2::uuid) as ok',
    teacherId,
    contactId,
  );
  return rows[0].ok;
}

/**
 * Asserts both layers, and that they agree.
 *
 * Takes the expectation explicitly rather than comparing the two answers alone:
 * two layers that are wrong in the same way still agree.
 */
async function expectBothLayers(
  teacherId: string | null,
  contactId: string | null,
  expected: boolean,
): Promise<void> {
  const app = teacherId && contactId
    ? await relationships.teacherParentAuthorized(teacherId, contactId)
    : await relationships.teacherParentAuthorized(teacherId as string, contactId as string);
  const db = await sqlSays(teacherId, contactId);

  expect({ layer: 'application', authorized: app }).toEqual({ layer: 'application', authorized: expected });
  expect({ layer: 'database', authorized: db }).toEqual({ layer: 'database', authorized: expected });
  expect({ application: app, database: db }).toEqual({ application: expected, database: expected });
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  // This spec builds its own world rather than using harness seed(): PD-6 needs
  // shapes the shared fixture has no reason to carry (a second organization, a
  // contact without can_message, an offboarded teacher).
  await g.prisma.$executeRawUnsafe(`
    truncate chat.message_receipt, chat.message_reaction, chat.message_attachment,
             chat.message_hidden_for, chat.message_approval, chat.call_participant,
             chat.call, chat.notification, chat.outbox_event,
             chat.conversation_participant_state, chat.conversation_member,
             chat.message, chat.conversation, chat.learner,
             chat.contact, chat.family, chat.staff, chat.teacher,
             chat.event_log, chat.audit_log
    restart identity cascade`);

  w = {
    adminA: randomUUID(),
    familyOne: randomUUID(),
    familyTwo: randomUUID(),
    teacherAssigned: randomUUID(),
    teacherSecond: randomUUID(),
    teacherUnrelated: randomUUID(),
    teacherInactive: randomUUID(),
    teacherLeft: randomUUID(),
    parentOk: randomUUID(),
    parentInactive: randomUUID(),
    parentNoMessage: randomUUID(),
    parentOtherFamily: randomUUID(),
    learnerOne: randomUUID(),
    teacherB: randomUUID(),
    parentB: randomUUID(),
  };

  const adminB = randomUUID();
  const familyB = randomUUID();

  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name)
     values ('${ORG_B}'::uuid, 'other-academy-${ORG_B.slice(0, 8)}', 'Other Academy')
     on conflict (id) do nothing`,
  );

  // Synthetic names only (QA gate G-16).
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, organization_id, name, role) values
       ('${w.adminA}'::uuid, '${ORG_A}'::uuid, 'admin_a', 'admin'),
       ('${adminB}'::uuid,   '${ORG_B}'::uuid, 'admin_b', 'admin')`,
  );

  await g.prisma.$executeRawUnsafe(
    `insert into chat.teacher (id, organization_id, name, is_active, left_at) values
       ('${w.teacherAssigned}'::uuid,  '${ORG_A}'::uuid, 'teacher_assigned',  true,  null),
       ('${w.teacherSecond}'::uuid,    '${ORG_A}'::uuid, 'teacher_second',    true,  null),
       ('${w.teacherUnrelated}'::uuid, '${ORG_A}'::uuid, 'teacher_unrelated', true,  null),
       ('${w.teacherInactive}'::uuid,  '${ORG_A}'::uuid, 'teacher_inactive',  false, null),
       ('${w.teacherLeft}'::uuid,      '${ORG_A}'::uuid, 'teacher_left',      true,  now()),
       ('${w.teacherB}'::uuid,         '${ORG_B}'::uuid, 'teacher_b',         true,  null)`,
  );

  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, organization_id, display_name, owner_id) values
       ('${w.familyOne}'::uuid, '${ORG_A}'::uuid, 'family_one', '${w.adminA}'::uuid),
       ('${w.familyTwo}'::uuid, '${ORG_A}'::uuid, 'family_two', '${w.adminA}'::uuid),
       ('${familyB}'::uuid,     '${ORG_B}'::uuid, 'family_b',   '${adminB}'::uuid)`,
  );

  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, organization_id, family_id, name, role_preset,
                               can_message, can_view_progress, can_manage_schedule,
                               can_manage_billing, can_manage_contacts, can_cancel,
                               is_active) values
       ('${w.parentOk}'::uuid,          '${ORG_A}'::uuid, '${w.familyOne}'::uuid, 'parent_ok',
        'primary_guardian',   true,  true, true, true, true, true, true),
       ('${w.parentInactive}'::uuid,    '${ORG_A}'::uuid, '${w.familyOne}'::uuid, 'parent_inactive',
        'authorized_contact', true,  true, true, true, true, true, false),
       ('${w.parentNoMessage}'::uuid,   '${ORG_A}'::uuid, '${w.familyOne}'::uuid, 'parent_no_message',
        'authorized_contact', false, true, true, true, true, true, true),
       ('${w.parentOtherFamily}'::uuid, '${ORG_A}'::uuid, '${w.familyTwo}'::uuid, 'parent_other_family',
        'primary_guardian',   true,  true, true, true, true, true, true),
       ('${w.parentB}'::uuid,           '${ORG_B}'::uuid, '${familyB}'::uuid,     'parent_b',
        'primary_guardian',   true,  true, true, true, true, true, true)`,
  );

  await g.prisma.$executeRawUnsafe(
    `insert into chat.learner (id, organization_id, family_id, name, teacher_id) values
       ('${w.learnerOne}'::uuid, '${ORG_A}'::uuid, '${w.familyOne}'::uuid, 'learner_one',   '${w.teacherAssigned}'::uuid),
       ('${randomUUID()}'::uuid, '${ORG_A}'::uuid, '${w.familyOne}'::uuid, 'learner_two',   '${w.teacherSecond}'::uuid),
       ('${randomUUID()}'::uuid, '${ORG_A}'::uuid, '${w.familyOne}'::uuid, 'learner_three', null),
       ('${randomUUID()}'::uuid, '${ORG_A}'::uuid, '${w.familyTwo}'::uuid, 'learner_four',  '${w.teacherInactive}'::uuid),
       ('${randomUUID()}'::uuid, '${ORG_A}'::uuid, '${w.familyTwo}'::uuid, 'learner_five',  '${w.teacherLeft}'::uuid),
       ('${randomUUID()}'::uuid, '${ORG_B}'::uuid, '${familyB}'::uuid,     'learner_b',     '${w.teacherB}'::uuid)`,
  );
});

// -------------------------------------------------------------------------
describe('PD-6 predicate — the authorized relationship', () => {
  it('1. authorized parent + assigned teacher → TRUE', async () => {
    await expectBothLayers(w.teacherAssigned, w.parentOk, true);
  });

  it('2. authorized teacher + assigned parent → TRUE (the same fact, asked from the teacher side)', async () => {
    // Direction is not a property of the relationship. pairingAuthorized()
    // exists so a call site never has to work out which actor is the teacher,
    // and it must answer identically whichever order it receives them in.
    const t = teacherActor(w.teacherAssigned);
    const p = parentActor(w.parentOk, w.familyOne);

    await expect(relationships.pairingAuthorized(t, p)).resolves.toBe(true);
    await expect(relationships.pairingAuthorized(p, t)).resolves.toBe(true);
  });

  it('10. a family with several learners, the teacher assigned to only one of them → TRUE', async () => {
    await expectBothLayers(w.teacherSecond, w.parentOk, true);
  });

  it('duplicate relationships do not change the answer: a second learner with the same teacher is still one TRUE', async () => {
    const before = await relationships.teacherParentAuthorized(w.teacherAssigned, w.parentOk);

    await g.prisma.$executeRawUnsafe(
      `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
       values ('${randomUUID()}'::uuid, '${ORG_A}'::uuid, '${w.familyOne}'::uuid,
               'learner_duplicate', '${w.teacherAssigned}'::uuid)`,
    );

    const after = await relationships.teacherParentAuthorized(w.teacherAssigned, w.parentOk);
    expect({ before, after }).toEqual({ before: true, after: true });
    await expectBothLayers(w.teacherAssigned, w.parentOk, true);
  });
});

// -------------------------------------------------------------------------
describe('PD-6 predicate — no relationship', () => {
  it('3. parent + unrelated teacher → FALSE', async () => {
    await expectBothLayers(w.teacherUnrelated, w.parentOk, false);
  });

  it('4. teacher + unrelated parent → FALSE', async () => {
    await expectBothLayers(w.teacherAssigned, w.parentOtherFamily, false);
  });

  it('11. the family has learners, but none assigned to this teacher → FALSE', async () => {
    // Stated separately from case 3 because the failure it guards is different:
    // "this family has children" must never be read as "this family is
    // connected to the teaching staff".
    const learners = await g.prisma.learner.count({ where: { familyId: w.familyOne } });
    expect(learners).toBeGreaterThan(1);
    await expectBothLayers(w.teacherUnrelated, w.parentOk, false);
  });

  it('a learner with no teacher assigned authorizes nobody', async () => {
    const orphan = await g.prisma.learner.findFirst({
      where: { familyId: w.familyOne, teacherId: null },
    });
    expect(orphan).not.toBeNull();
    await expectBothLayers(w.teacherUnrelated, w.parentOk, false);
  });

  it('a pairing that is not one teacher and one contact is not a teacher/parent pairing', async () => {
    const t1 = teacherActor(w.teacherAssigned);
    const t2 = teacherActor(w.teacherSecond);
    const p1 = parentActor(w.parentOk, w.familyOne);
    const p2 = parentActor(w.parentNoMessage, w.familyOne);

    await expect(relationships.pairingAuthorized(t1, t2)).resolves.toBe(false);
    await expect(relationships.pairingAuthorized(p1, p2)).resolves.toBe(false);
  });
});

// -------------------------------------------------------------------------
describe('PD-6 predicate — each party must be live', () => {
  it('5. inactive contact → FALSE', async () => {
    await expectBothLayers(w.teacherAssigned, w.parentInactive, false);
  });

  it('6. contact.can_message = false → FALSE', async () => {
    await expectBothLayers(w.teacherAssigned, w.parentNoMessage, false);
  });

  it('7. inactive teacher → FALSE, even though genuinely assigned to that family', async () => {
    const link = await g.prisma.learner.findFirst({
      where: { familyId: w.familyTwo, teacherId: w.teacherInactive },
    });
    expect(link).not.toBeNull(); // the relationship exists; only liveness fails
    await expectBothLayers(w.teacherInactive, w.parentOtherFamily, false);
  });

  it('8. teacher with left_at populated → FALSE, even with is_active still true', async () => {
    const t = await g.prisma.teacher.findUnique({ where: { id: w.teacherLeft } });
    expect({ isActive: t?.isActive, hasLeft: t?.leftAt !== null }).toEqual({
      isActive: true,
      hasLeft: true,
    });
    await expectBothLayers(w.teacherLeft, w.parentOtherFamily, false);
  });
});

// -------------------------------------------------------------------------
describe('PD-6 predicate — tenant isolation', () => {
  it('control: organization B\'s own chain is authorized within B', async () => {
    await expectBothLayers(w.teacherB, w.parentB, true);
  });

  it('9. cross-organization: org A teacher + org B parent → FALSE', async () => {
    await expectBothLayers(w.teacherAssigned, w.parentB, false);
  });

  it('9b. cross-organization, the other direction: org B teacher + org A parent → FALSE', async () => {
    await expectBothLayers(w.teacherB, w.parentOk, false);
  });

  it('cross-tenant data cannot satisfy the predicate even through a learner row', async () => {
    // Attempt to bridge the tenants with a learner in org A pointing at org B's
    // teacher. chat.enforce_same_organization() may refuse the row outright; if
    // it does not, the predicate must still refuse the relationship.
    let bridged = true;
    try {
      await g.prisma.$executeRawUnsafe(
        `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
         values ('${randomUUID()}'::uuid, '${ORG_A}'::uuid, '${w.familyOne}'::uuid,
                 'learner_bridge', '${w.teacherB}'::uuid)`,
      );
    } catch {
      bridged = false; // the database refused the row itself
    }

    await expectBothLayers(w.teacherB, w.parentOk, false);
    // Recorded rather than asserted either way: both outcomes are safe, and
    // which one happens is a property of the tenancy triggers, not of PD-6.
    expect(typeof bridged).toBe('boolean');
  });
});

// -------------------------------------------------------------------------
describe('PD-6 predicate — revocation is immediate', () => {
  it('12. reassigning learner.teacher_id revokes on the NEXT evaluation', async () => {
    await expectBothLayers(w.teacherAssigned, w.parentOk, true);

    await g.prisma.learner.update({
      where: { id: w.learnerOne },
      data: { teacherId: w.teacherUnrelated },
    });

    await expectBothLayers(w.teacherAssigned, w.parentOk, false);
    // And the teacher it moved to is authorized from that moment, with no other
    // change: nothing is cached in either direction.
    await expectBothLayers(w.teacherUnrelated, w.parentOk, true);
  });

  it('deactivating the contact revokes on the next evaluation', async () => {
    await expectBothLayers(w.teacherAssigned, w.parentOk, true);
    await g.prisma.contact.update({ where: { id: w.parentOk }, data: { isActive: false } });
    await expectBothLayers(w.teacherAssigned, w.parentOk, false);
  });

  it('withdrawing can_message revokes on the next evaluation', async () => {
    await expectBothLayers(w.teacherAssigned, w.parentOk, true);
    await g.prisma.contact.update({ where: { id: w.parentOk }, data: { canMessage: false } });
    await expectBothLayers(w.teacherAssigned, w.parentOk, false);
  });

  it('offboarding the teacher revokes on the next evaluation', async () => {
    await expectBothLayers(w.teacherAssigned, w.parentOk, true);
    await g.prisma.teacher.update({ where: { id: w.teacherAssigned }, data: { leftAt: new Date() } });
    await expectBothLayers(w.teacherAssigned, w.parentOk, false);
  });
});

// -------------------------------------------------------------------------
describe('PD-6 predicate — client-supplied ids are never evidence', () => {
  it('an id that matches no row authorizes nothing', async () => {
    await expectBothLayers(randomUUID(), randomUUID(), false);
    await expectBothLayers(randomUUID(), w.parentOk, false);
    await expectBothLayers(w.teacherAssigned, randomUUID(), false);
  });

  it('transposing the arguments does not manufacture a relationship', async () => {
    // The parameters are ids, not roles. A caller who puts a contact id in the
    // teacher position is not thereby describing a teacher.
    await expectBothLayers(w.parentOk, w.teacherAssigned, false);
  });

  it('a staff id in the teacher position is not a teacher', async () => {
    await expectBothLayers(w.adminA, w.parentOk, false);
  });

  it('malformed ids are denied, not raised: a denial must look like a denial', async () => {
    // Prisma raises on a non-uuid where the column is uuid. A 500 where a 403
    // belongs would leak the difference between "no such row" and "bad input",
    // and would turn a policy decision into an error page.
    await expect(relationships.teacherParentAuthorized('', '')).resolves.toBe(false);
    await expect(relationships.teacherParentAuthorized('not-a-uuid', w.parentOk)).resolves.toBe(false);
    await expect(relationships.teacherParentAuthorized(w.teacherAssigned, 'not-a-uuid')).resolves.toBe(false);
    await expect(
      relationships.teacherParentAuthorized(`${w.teacherAssigned}' or '1'='1`, w.parentOk),
    ).resolves.toBe(false);
  });

  it('null and undefined ids are denied rather than raised', async () => {
    await expect(
      relationships.teacherParentAuthorized(null as unknown as string, w.parentOk),
    ).resolves.toBe(false);
    await expect(
      relationships.teacherParentAuthorized(w.teacherAssigned, undefined as unknown as string),
    ).resolves.toBe(false);
  });

  it('the database agrees: NULL arguments are false, never NULL', async () => {
    await expect(sqlSays(null, w.parentOk)).resolves.toBe(false);
    await expect(sqlSays(w.teacherAssigned, null)).resolves.toBe(false);
    await expect(sqlSays(null, null)).resolves.toBe(false);
  });
});

// -------------------------------------------------------------------------
describe('this phase changed NO authorization behaviour', () => {
  /**
   * The predicate is additive. Until the next phase switches the decisions that
   * consume it, an authorized teacher and parent must STILL be refused a direct
   * channel — by the policy and by the database alike.
   *
   * These assertions are expected to be inverted in the next phase, deliberately
   * and with PD-6 cited. Failing here today means the switch was made early.
   */
  it('canOpenDirect still refuses an authorized teacher/parent pair', async () => {
    const authorized = await relationships.teacherParentAuthorized(w.teacherAssigned, w.parentOk);
    expect(authorized).toBe(true); // the relationship is real…

    const decision = g.authz.canOpenDirect(
      teacherActor(w.teacherAssigned),
      parentActor(w.parentOk, w.familyOne),
    );

    // …and the old rule still refuses it, because nothing consumes the predicate yet.
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
    }
  });

  it('the database still refuses a direct teacher/parent conversation for an authorized pair', async () => {
    const conversationId = randomUUID();
    await expect(
      g.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `insert into chat.conversation (id, organization_id, type, direct_key, family_id)
           values ('${conversationId}'::uuid, '${ORG_A}'::uuid, 'direct',
                   'pd6-probe-${conversationId}', '${w.familyOne}'::uuid)`,
        );
        await tx.$executeRawUnsafe(
          `insert into chat.conversation_member (conversation_id, actor_id, actor_kind, member_role) values
             ('${conversationId}'::uuid, '${w.teacherAssigned}'::uuid, 'teacher', 'teacher'),
             ('${conversationId}'::uuid, '${w.parentOk}'::uuid, 'contact', 'parent')`,
        );
      }),
    ).rejects.toThrow(/BR-1 violation/);
  });

  it('the predicate is registered but consumed by nobody: no call site reads it yet', () => {
    // A grep-shaped assertion, deliberately. The guarantee this phase offers is
    // "nothing changed", and the cheapest honest proof is that the only files
    // naming the service are its own definition, the DI wiring, and this test.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const hits = execSync(
      "grep -rl 'RelationshipService\\|teacherParentAuthorized\\|pairingAuthorized' src test || true",
      { cwd: `${__dirname}/../..`, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .sort();

    expect(hits).toEqual([
      'src/platform/platform.module.ts', // DI registration
      'src/platform/relationship.service.ts', // the definition
      'src/platform/tokens.ts', // the DI symbol
      'test/integration/relationship-predicate.spec.ts', // this file
    ]);
    // In particular: NOT authorization.service.ts, NOT conversation.service.ts,
    // NOT call.service.ts. When the next phase adds those three, this list
    // changes in the same commit that inverts the two assertions above.
  });
});
