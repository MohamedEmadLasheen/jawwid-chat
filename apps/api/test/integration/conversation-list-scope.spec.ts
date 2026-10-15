/**
 * C2 -- the conversation LIST equals the C1 read policy.
 *
 * ConversationService.listForActor must return exactly the conversations
 * ConversationService.canReadResolved (committed in C1) allows, for every actor,
 * with authorization in the query before the 200-row cap. This file proves it
 * by comparing IDs: for each actor, the list against canReadResolved applied to
 * EVERY conversation in the database, at one fixed instant.
 *
 * Part 1 verifies the on-duty facts the list depends on --
 * CoverageService.familiesOnDutyFor -- against the real chat.on_duty(), family
 * by family, and the pinned harness double separately.
 */
import { randomUUID } from 'node:crypto';
import { AuthorizationService } from '@platform/authorization.service';
import { SqlCoverageService } from '@platform/coverage.service';
import { PrismaAuditService } from '@platform/audit.service';
import { ConversationService } from '@communication/conversations/conversation.service';
import {
  buildGraph,
  existingDirect,
  legacyTeacherParentCall,
  legacyTeacherParentDirect,
  seed,
  truncate,
  Scenario,
  PinnedCoverage,
} from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const sqlCoverage = new SqlCoverageService(g.prisma);
/** The same service with the REAL coverage engine behind activeHandler() and the list. */
const realConversations = new ConversationService(
  g.prisma,
  new AuthorizationService(sqlCoverage),
  g.outbox,
  g.identity,
  sqlCoverage,
  new PrismaAuditService(),
  g.relationships,
);

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_SLUG_PREFIX = 'advl-';
let s: Scenario;

/** Staff and families beyond the shared seed. */
let w: {
  orgB: string;
  owner2: string; // admin, owns family 2, never in shift
  owner3: string; // admin, owns family 3, never in shift, no specific rule
  covering: string; // coverage, always in shift, covers owner2 by rule
  foreignCovering: string; // coverage in organization B, covers EVERY owner (global rule)
  adminB: string; // admin in organization B, owns family B, always in shift
  family2: string;
  family3: string;
  familyB: string;
};

async function alwaysOnShift(staffId: string, organizationId = ORG_A) {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.shift (staff_id, days, starts, ends, valid_from, organization_id)
     values ('${staffId}'::uuid, '{0,1,2,3,4,5,6}', '00:00', '00:00', current_date - 2, '${organizationId}'::uuid)`,
  );
}

/** chat.on_duty() for every family of one organization, straight from the database. */
async function onDutyByFamily(organizationId: string, at: Date): Promise<Map<string, string | null>> {
  const rows = await g.prisma.$queryRaw<Array<{ id: string; d: string | null }>>`
    SELECT id::text AS id, chat.on_duty(id, ${at}::timestamptz)::text AS d
      FROM chat.family WHERE organization_id = ${organizationId}::uuid`;
  return new Map(rows.map((r) => [r.id, r.d]));
}

async function seedCoverageWorld() {
  w = {
    orgB: randomUUID(),
    owner2: randomUUID(),
    owner3: randomUUID(),
    covering: randomUUID(),
    foreignCovering: randomUUID(),
    adminB: randomUUID(),
    family2: randomUUID(),
    family3: randomUUID(),
    familyB: randomUUID(),
  };
  const o = `'${w.orgB}'::uuid`;
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values (${o}, '${ORG_SLUG_PREFIX}${w.orgB.slice(0, 8)}', 'org_b')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ('${w.owner2}'::uuid, 'owner_two', 'admin', true),
       ('${w.owner3}'::uuid, 'owner_three', 'admin', true),
       ('${w.covering}'::uuid, 'covering_k', 'coverage', true)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, organization_id) values
       ('${w.foreignCovering}'::uuid, 'covering_b', 'coverage', true, ${o}),
       ('${w.adminB}'::uuid, 'admin_b1', 'admin', true, ${o})`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language) values
       ('${w.family2}'::uuid, 'family_two', '${w.owner2}'::uuid, 'ar'),
       ('${w.family3}'::uuid, 'family_three', '${w.owner3}'::uuid, 'ar')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language, organization_id)
     values ('${w.familyB}'::uuid, 'family_b', '${w.adminB}'::uuid, 'ar', ${o})`,
  );
  await alwaysOnShift(s.ownerId); // family 1 -> its owner
  await alwaysOnShift(w.covering);
  await alwaysOnShift(w.foreignCovering, w.orgB);
  await alwaysOnShift(w.adminB, w.orgB); // family B -> its owner
  // family 2 -> covering (specific rule, priority 1)
  await g.prisma.$executeRawUnsafe(
    `insert into chat.coverage_rule (covering_id, covered_id, days, window_mode, valid_from, priority)
     values ('${w.covering}'::uuid, '${w.owner2}'::uuid, '{0,1,2,3,4,5,6}', 'all_day', current_date - 2, 1)`,
  );
  // family 3 -> foreignCovering (GLOBAL rule from another organization, priority 2):
  // chat.on_duty() is organization-blind -- the open finding this must survive.
  await g.prisma.$executeRawUnsafe(
    `insert into chat.coverage_rule (covering_id, covered_id, days, window_mode, valid_from, priority, organization_id)
     values ('${w.foreignCovering}'::uuid, null, '{0,1,2,3,4,5,6}', 'all_day', current_date - 2, 2, ${o})`,
  );
}

beforeAll(async () => {
  await g.prisma.$connect();
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${ORG_SLUG_PREFIX}%'`);
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${ORG_SLUG_PREFIX}%'`);
  s = await seed(g.prisma);
  g.coverage.onDutyId = null;
  await seedCoverageWorld();
});

// ===========================================================================
describe('Part 1 -- familiesOnDutyFor against the real chat.on_duty()', () => {
  it('sanity: the database routes each family as the fixtures intend', async () => {
    const at = new Date();
    const a = await onDutyByFamily(ORG_A, at);
    expect(a.get(s.familyId)).toBe(s.ownerId);
    expect(a.get(w.family2)).toBe(w.covering);
    expect(a.get(w.family3)).toBe(w.foreignCovering); // a FOREIGN staff member, by the global rule
    expect((await onDutyByFamily(w.orgB, at)).get(w.familyB)).toBe(w.adminB);
  });

  it('for every staff member and every organization: exactly { f in organization : on_duty(f) = staff }', async () => {
    const at = new Date();
    const staff = [s.ownerId, s.otherAdminId, s.managerId, w.owner2, w.owner3, w.covering, w.foreignCovering, w.adminB];
    for (const org of [ORG_A, w.orgB]) {
      const truth = await onDutyByFamily(org, at);
      for (const id of staff) {
        const expected = [...truth].filter(([, d]) => d === id).map(([f]) => f).sort();
        const actual = (await sqlCoverage.familiesOnDutyFor(id, org, at)).sort();
        expect({ org, id, families: actual }).toEqual({ org, id, families: expected });
      }
    }
  });

  it('organization-bounded: the foreign staff member chat.on_duty() names gets nothing in their OWN organization', async () => {
    const at = new Date();
    // The function is parameterized by organization; the list always passes the
    // actor's own. In organization B the foreign coverage staff is on duty for nothing.
    expect(await sqlCoverage.familiesOnDutyFor(w.foreignCovering, w.orgB, at)).toEqual([]);
    // Asked about organization A it would name family 3 -- which is why the list
    // never asks about any organization but the actor's.
    expect(await sqlCoverage.familiesOnDutyFor(w.foreignCovering, ORG_A, at)).toEqual([w.family3]);
  });
});

describe('Part 1a -- the custom and outside_owner_shift windows: routing really changes, and the list still equals the read', () => {
  // familiesOnDutyFor evaluates the SAME chat.on_duty() per family that the
  // per-conversation read asks, so the two agree by construction whatever the
  // window mode. These cases prove it on the two modes the all-day fixtures
  // never reach -- and that each window actually decides the answer, so the
  // agreement is not vacuous.
  const STAFF = () => [s.ownerId, s.otherAdminId, s.managerId, w.owner2, w.owner3, w.covering, w.foreignCovering];
  async function listEqualsRead(at: Date) {
    const truth = await onDutyByFamily(ORG_A, at);
    for (const id of STAFF()) {
      const expected = [...truth].filter(([, d]) => d === id).map(([f]) => f).sort();
      expect({ id, families: (await sqlCoverage.familiesOnDutyFor(id, ORG_A, at)).sort() }).toEqual({ id, families: expected });
    }
    return truth;
  }
  const customRule = (covering: string, covered: string, fromOffset: string, toOffset: string) =>
    g.prisma.$executeRawUnsafe(
      `insert into chat.coverage_rule (covering_id, covered_id, days, window_mode, custom_from, custom_to, valid_from, priority)
       values ('${covering}'::uuid, '${covered}'::uuid, '{0,1,2,3,4,5,6}', 'custom',
               (chat.local_at(now()) + interval '${fromOffset}')::time,
               (chat.local_at(now()) + interval '${toOffset}')::time,
               current_date - 2, 0)`,
    );

  it('custom: a window that excludes now changes nothing; one that contains now hands the family over', async () => {
    await alwaysOnShift(s.otherAdminId);
    await customRule(s.otherAdminId, w.owner2, '2 hours', '3 hours');
    let truth = await listEqualsRead(new Date());
    expect(truth.get(w.family2)).toBe(w.covering); // the out-of-window rule did not apply

    await g.prisma.$executeRawUnsafe(`delete from chat.coverage_rule where window_mode = 'custom'`);
    await customRule(s.otherAdminId, w.owner2, '-1 hour', '1 hour');
    truth = await listEqualsRead(new Date());
    expect(truth.get(w.family2)).toBe(s.otherAdminId); // the in-window rule did
  });

  it('outside_owner_shift: applies while the owner is off shift, and stops when they are on it', async () => {
    await alwaysOnShift(s.otherAdminId);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.coverage_rule (covering_id, covered_id, days, window_mode, valid_from, priority)
       values ('${s.otherAdminId}'::uuid, '${w.owner3}'::uuid, '{0,1,2,3,4,5,6}', 'outside_owner_shift', current_date - 2, 0)`,
    );
    let truth = await listEqualsRead(new Date());
    expect(truth.get(w.family3)).toBe(s.otherAdminId); // owner 3 has no shift

    await alwaysOnShift(w.owner3);
    truth = await listEqualsRead(new Date());
    expect(truth.get(w.family3)).toBe(w.owner3); // on shift: their own family again
  });
});

describe('Part 1b -- the pinned harness double stays consistent with its onDuty()', () => {
  it('the pinned staff member is on duty for every family of the organization; anyone else for none', async () => {
    const pinned = new PinnedCoverage(w.covering, g.prisma);
    const families = (await g.prisma.family.findMany({ where: { organizationId: ORG_A }, select: { id: true } }))
      .map((f) => f.id)
      .sort();
    expect((await pinned.familiesOnDutyFor(w.covering, ORG_A)).sort()).toEqual(families);
    expect(await pinned.familiesOnDutyFor(w.owner2, ORG_A)).toEqual([]);
    for (const f of families) expect(await pinned.onDuty()).toBe(w.covering); // every family, as listed
    expect(await new PinnedCoverage(null, g.prisma).familiesOnDutyFor(w.covering, ORG_A)).toEqual([]);
  });
});

describe('Part 1c -- a mis-bound engine is refused loudly, never read as "on duty for nothing"', () => {
  it('a coverage object that cannot list makes a staff list THROW; scopes that do not need it are unaffected', async () => {
    // Nest injection tokens are not type-checked. This simulates an untyped
    // mis-binding -- the cast is the point of the test, not a way to compile
    // production code.
    const misBound = new ConversationService(
      g.prisma,
      new AuthorizationService(sqlCoverage),
      g.outbox,
      g.identity,
      { onDuty: async () => null } as never,
      new PrismaAuditService(),
      g.relationships,
    );
    // Under Nest the application refuses to start (onModuleInit)...
    expect(() => misBound.onModuleInit()).toThrow('cannot list on-duty families');
    expect(() => realConversations.onModuleInit()).not.toThrow();
    expect(() => g.conversations.onModuleInit()).not.toThrow();
    // ...and a graph built by hand without that hook still refuses every staff list.
    await expect(misBound.listForActor(w.covering)).rejects.toThrow('cannot list on-duty families');
    await expect(misBound.listForActor(s.ownerId)).rejects.toThrow('cannot list on-duty families');
    // a manager and a member need no on-duty facts
    expect(await misBound.listForActor(s.managerId)).toEqual(expect.any(Array));
    expect(await misBound.listForActor(s.parentId)).toEqual(expect.any(Array));
  });
});

// ===========================================================================
// Part 2 -- the list equals canReadResolved, actor by actor, under both engines.
// ===========================================================================

/** Actors and conversations beyond the coverage world. */
let x: Record<string, string>;
let cv: Record<string, string>;

async function contactIn(familyId: string, name: string): Promise<string> {
  const id = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ('${id}'::uuid, '${familyId}'::uuid, '${name}', 'primary_guardian', true, true)`,
  );
  return id;
}

async function setSticky(conversationId: string, handlerId: string, until: string) {
  await g.prisma.$executeRawUnsafe(
    `update chat.conversation set sticky_handler_id = '${handlerId}'::uuid, sticky_until = now() + interval '${until}'
      where id = '${conversationId}'::uuid`,
  );
}

async function seedListWorld() {
  x = {
    adminX: randomUUID(), // unrelated admin
    coverageIdle: randomUUID(), // coverage, on duty for nothing
    stickyX: randomUUID(), // admin, a live sticky handler of one conversation
    superAdmin: randomUUID(),
    finance: randomUUID(),
    technical: randomUUID(),
    academic: randomUUID(),
    managerB: randomUUID(),
    inactiveParent: randomUUID(),
  };
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ('${x.adminX}'::uuid, 'admin_x', 'admin', true),
       ('${x.coverageIdle}'::uuid, 'coverage_i', 'coverage', true),
       ('${x.stickyX}'::uuid, 'sticky_s', 'admin', true),
       ('${x.finance}'::uuid, 'finance_f', 'finance', true),
       ('${x.technical}'::uuid, 'technical_t', 'technical', true),
       ('${x.academic}'::uuid, 'academic_a', 'academic', true)`,
  );
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active) values ('${x.superAdmin}'::uuid, 'super_s', 'super_admin', true)`,
    ),
  ]);
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, organization_id)
     values ('${x.managerB}'::uuid, 'manager_b1', 'manager', true, '${w.orgB}'::uuid)`,
  );
  x.inactiveParent = await contactIn(s.familyId, 'parent_r');

  const c2a = await contactIn(w.family2, 'parent_2a');
  const c2b = await contactIn(w.family2, 'parent_2b');
  const c2c = await contactIn(w.family2, 'parent_2c');
  const c3 = await contactIn(w.family3, 'parent_3');

  // Pre-existing directs (harness existingDirect): most pair a parent with an
  // admin who is NOT in the family's charge, which C0 Decision 5 would not let
  // that admin open today. This suite is about who may LIST them once they exist.
  const direct = (a: string, b: string) => existingDirect(g, a, b);
  cv = {
    f1Direct: await direct(s.parentId, s.otherAdminId), // family 1; its owner is not a member
    f1Group: (await g.conversations.ensureStudentGroup(s.learnerId)).id, // owner is a member
    familyLess: await direct(s.teacherId, s.otherAdminId),
    // A PD-6-era direct: PD-7 refuses to open one; the rows stay readable history.
    teacherParent: await legacyTeacherParentDirect(g.prisma, s.teacherId, s.parentId, s.familyId),
    f1Inactive: await direct(x.inactiveParent, s.otherAdminId),
    f2Plain: await direct(c2a, s.otherAdminId), // on duty: covering
    f2StickyLive: await direct(c2b, s.otherAdminId), // live sticky: stickyX
    f2StickyExpired: await direct(c2c, s.otherAdminId), // expired sticky: stickyX
    f3: await direct(c3, s.otherAdminId), // on duty: a FOREIGN staff member
  };
  await setSticky(cv.f2StickyLive, x.stickyX, '1 hour');
  await setSticky(cv.f2StickyExpired, x.stickyX, '-1 minute');
  // (A sticky handler without sticky_until cannot be stored: CHECK
  // conversation_sticky_is_complete. The list predicate is null-safe anyway.)

  // Organization B: a family conversation of its own.
  cv.bDirect = randomUUID();
  const contactB = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active, organization_id)
     values ('${contactB}'::uuid, '${w.familyB}'::uuid, 'parent_b1', 'primary_guardian', true, true, '${w.orgB}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation (id, type, family_id, direct_key, organization_id)
     values ('${cv.bDirect}'::uuid, 'direct', '${w.familyB}'::uuid, '${[contactB, w.adminB].sort().join(':')}', '${w.orgB}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role) values
       ('${cv.bDirect}'::uuid, 'contact', '${contactB}'::uuid, 'parent'),
       ('${cv.bDirect}'::uuid, 'staff', '${w.adminB}'::uuid, 'admin')`,
  );
  // Defence in depth: a cross-organization membership row (no API path writes
  // one) -- organization A's TEACHER planted in a family-less organization-B
  // group (the database refuses a contact in a family-less conversation). C1
  // refuses it; the list must too.
  cv.bGroup = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation (id, type, state, family_id, organization_id)
     values ('${cv.bGroup}'::uuid, 'class_group', 'open', null, '${w.orgB}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role) values
       ('${cv.bGroup}'::uuid, 'staff', '${w.adminB}'::uuid, 'admin'),
       ('${cv.bGroup}'::uuid, 'teacher', '${s.teacherId}'::uuid, 'teacher')`,
  );
  await g.prisma.$executeRawUnsafe(`update chat.contact set is_active = false where id = '${x.inactiveParent}'::uuid`);
}

type Engine = { name: string; conversations: ConversationService; pin: (id: string | null) => void };
const ENGINES: Engine[] = [
  { name: 'real chat.on_duty()', conversations: realConversations, pin: () => undefined },
  { name: 'pinned harness', conversations: g.conversations, pin: (id) => { g.coverage.onDutyId = id; } },
];

/** For one actor: the list's IDs, and the IDs canReadResolved allows over EVERY conversation. */
async function compare(conversations: ConversationService, actorId: string, now: Date) {
  const actor = await conversations.requireActor(actorId);
  const all = await g.prisma.conversation.findMany({ select: { id: true } });
  const allowed: string[] = [];
  const refusals = new Set<string>();
  for (const { id } of all) {
    const conv = await conversations.requireConversation(id);
    const membership = await conversations.membershipOf(conv.id, actor.actorId);
    const d = await conversations.canReadResolved(actor, conv, membership, now);
    if (d.allowed) allowed.push(id);
    else if (conv.organizationId === actor.organizationId) refusals.add(d.code);
  }
  let listed: string[] | null = null;
  let listError: string | null = null;
  try {
    listed = (await conversations.listForActor(actorId, now)).map((c) => c.id);
  } catch (e) {
    listError = (e as { code?: string }).code ?? String(e);
  }
  return { allowed: allowed.sort(), listed: listed?.sort() ?? null, listError, refusals };
}

describe('Part 2 -- listForActor == canReadResolved, for every actor', () => {
  beforeEach(seedListWorld);

  const ACTORS: Array<[string, () => string]> = [
    ['manager', () => s.managerId],
    ['owner admin (family 1)', () => s.ownerId],
    ['member admin', () => s.otherAdminId],
    ['unrelated admin', () => x.adminX],
    ['admin owning family 2, never on duty', () => w.owner2],
    ['coverage on duty (family 2; family 3 is foreign-routed)', () => w.covering],
    ['coverage on duty for nothing', () => x.coverageIdle],
    ['live sticky handler', () => x.stickyX],
    ['parent', () => s.parentId],
    ['teacher (PD-6 direct)', () => s.teacherId],
    ['super_admin', () => x.superAdmin],
    ['finance', () => x.finance],
    ['technical', () => x.technical],
    ['academic', () => x.academic],
    ['foreign-organization manager', () => x.managerB],
    ['foreign coverage named on duty by a global rule', () => w.foreignCovering],
    ['inactive parent', () => x.inactiveParent],
  ];

  for (const engine of ENGINES) {
    describe(engine.name, () => {
      it.each(ACTORS)('%s', async (_name, actorOf) => {
        // Under the pinned engine, pin the coverage staff member so the
        // on-duty branch is exercised there too.
        engine.pin(w.covering);
        const now = new Date();
        const r = await compare(engine.conversations, actorOf(), now);
        if (r.listError !== null) {
          // Refused outright: nothing is readable, and the refusal is the one
          // canRead gives this actor on its own organization's conversations.
          expect(r.allowed).toEqual([]);
          expect([...r.refusals]).toEqual([r.listError]);
        } else {
          expect(r.listed).toEqual(r.allowed);
        }
      });
    });
  }

  it('the matrix is not vacuous: key expectations hold (real engine)', async () => {
    const now = new Date();
    const ids = async (actorId: string) => (await realConversations.listForActor(actorId, now)).map((c) => c.id).sort();
    const sorted = (xs: string[]) => [...xs].sort();
    const orgA = Object.entries(cv).filter(([k]) => !k.startsWith('b')).map(([, v]) => v);

    expect(await ids(s.managerId)).toEqual(sorted(orgA));
    expect(await ids(x.managerB)).toEqual(sorted([cv.bDirect, cv.bGroup]));
    // the family-1 owner: family-1 conversations, by ownership (not the family-less one)
    expect(await ids(s.ownerId)).toEqual(sorted([cv.f1Direct, cv.f1Group, cv.teacherParent, cv.f1Inactive]));
    expect(await ids(x.adminX)).toEqual([]);
    // covering is on duty for family 2: not where stickyX's handling is live
    expect(await ids(w.covering)).toEqual(sorted([cv.f2Plain, cv.f2StickyExpired]));
    expect(await ids(x.stickyX)).toEqual([cv.f2StickyLive]);
    // the parent and the teacher: memberships in organization A only -- the
    // teacher's planted organization-B membership is not listed
    expect(await ids(s.parentId)).toEqual(sorted([cv.f1Direct, cv.f1Group, cv.teacherParent]));
    expect(await ids(s.teacherId)).toEqual(sorted([cv.f1Group, cv.familyLess, cv.teacherParent]));
    // routed to them by on_duty(), but foreign: nothing in A, nothing of A in B
    expect(await ids(w.foreignCovering)).toEqual([]);
  });
});

// ===========================================================================
describe('Part 3 -- the 200-row cap, ordering, and the response contract', () => {
  beforeEach(seedListWorld);

  async function flood(count: number) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.conversation (type, state, family_id, last_activity_at)
       select 'class_group', 'open', null, now() + interval '1 hour' + (n || ' seconds')::interval
         from generate_series(1, ${count}) n`,
    );
  }

  it('newer out-of-scope conversations cannot push an actor\'s own out of the cap', async () => {
    const before = (await g.conversations.listForActor(s.ownerId)).map((c) => c.id).sort();
    await flood(205);
    expect((await g.conversations.listForActor(s.ownerId)).map((c) => c.id).sort()).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });

  it('the cap is still 200, and the order still lastActivityAt descending', async () => {
    await flood(205);
    const rows = await g.conversations.listForActor(s.managerId);
    expect(rows).toHaveLength(200);
    const times = rows.map((r) => r.lastActivityAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('GET /conversations: only listed conversations are serialized and counted, with the DTO unchanged', async () => {
    const { ConversationController } = await import('@communication/api/conversation.controller');
    const controller = new ConversationController(g.conversations, g.messages, g.calls);
    const counted: string[][] = [];
    const spy = jest.spyOn(g.messages, 'unreadCountsFor').mockImplementation(async (ids) => {
      counted.push([...ids]);
      return new Map();
    });
    try {
      g.coverage.onDutyId = null;
      const listed = (await g.conversations.listForActor(s.ownerId)).map((c) => c.id).sort();
      const body = await controller.list(s.ownerId);
      expect(body.conversations.map((c) => c.id).sort()).toEqual(listed);
      expect(counted.at(-1)!.sort()).toEqual(listed);
      expect(Object.keys(body.conversations[0]).sort()).toEqual(
        [
          'archivedAt', 'familyId', 'id', 'lastActivityAt', 'lastSeq', 'learner', 'learnerId', 'members',
          'needsReply', 'parentRequiresApproval', 'state', 'teacherRequiresApproval', 'title', 'type', 'unreadCount',
        ].sort(),
      );
      // the unrelated admin's response carries nothing at all
      expect((await controller.list(x.adminX)).conversations).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

// ===========================================================================
describe('Part 4 -- GET /calls/history follows the scoped list', () => {
  beforeEach(seedListWorld);

  it('an out-of-scope conversation exposes no call records; in-scope actors keep theirs', async () => {
    g.coverage.onDutyId = s.ownerId;
    // A PD-6-era teacher<->parent call (PD-7 refuses to start one; the record
    // stays readable history) and a parent's call to an out-of-charge admin.
    const teacherCall = {
      callId: await legacyTeacherParentCall(
        g.prisma, cv.teacherParent, s.teacherId,
        { teacherId: s.teacherId, parentId: s.parentId }, s.familyId,
      ),
    };
    const parentCall = await g.calls.start(cv.f1Direct, s.parentId);
    const history = async (actorId: string) => (await g.calls.historyForActor(actorId)).items;

    expect(await history(x.adminX)).toEqual([]);
    expect(await history(x.managerB)).toEqual([]);
    for (const actorId of [s.ownerId, s.managerId]) {
      const ids = (await history(actorId)).map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([teacherCall.callId, parentCall.callId]));
    }
    // and nothing of those calls -- ids, participants, times, outcomes -- reaches the unrelated admin
    const serialized = JSON.stringify(await g.calls.historyForActor(x.adminX));
    for (const leak of [teacherCall.callId, parentCall.callId, s.teacherId, s.parentId]) {
      expect(serialized).not.toContain(leak);
    }
  });
});
