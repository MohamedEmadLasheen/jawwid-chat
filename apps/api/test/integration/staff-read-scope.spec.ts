/**
 * C1 -- ConversationService.canReadResolved / requireReadable against real rows
 * in TWO organizations.
 *
 * The facts the central read policy depends on are resolved here, from the
 * database: the family owner (chat.family.owner_id) and the active handler
 * (ConversationService.activeHandler -- live sticky handler first, otherwise
 * on duty for the family; the harness pins on_duty(), the engine AI #1 owns).
 * Nothing comes from a request but the conversation id.
 *
 * C1 switches NO endpoint: the last block pins that an un-migrated path
 * (readWithMembers) still answers exactly as before. C2 changes that block.
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import type { Actor } from '@platform/types';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
const ORG_SLUG_PREFIX = 'advr-';

let x: {
  adminX: string; // org A admin: owns nothing, member of nothing
  coverageId: string; // org A coverage role
  coverageOwnerId: string; // org A coverage role recorded as a family owner (U2)
  superAdminId: string;
  covFamilyId: string;
  covContactId: string;
};
let b: { orgId: string; managerId: string; adminId: string };
let c: { direct: string; group: string; teacherAdmin: string; teacherParent: string; covDirect: string };

async function refusal(p: Promise<unknown>): Promise<CommError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e;
    throw e;
  }
  throw new Error('expected a refusal, but the operation succeeded');
}

/** Read through the service exactly as a migrated caller will, counting the fact queries. */
async function read(actorId: string, conversationId: string) {
  const familyQuery = jest.spyOn(g.prisma.family, 'findUnique');
  const onDuty = jest.spyOn(g.coverage, 'onDuty');
  try {
    const actor: Actor = await g.conversations.requireActor(actorId);
    const conv = await g.conversations.requireConversation(conversationId);
    const membership = await g.conversations.membershipOf(conv.id, actor.actorId);
    familyQuery.mockClear();
    onDuty.mockClear();
    const decision = await g.conversations.canReadResolved(actor, conv, membership);
    return { decision, familyQueries: familyQuery.mock.calls.length, onDutyCalls: onDuty.mock.calls.length };
  } finally {
    familyQuery.mockRestore();
    onDuty.mockRestore();
  }
}

async function requireReadable(actorId: string, conversationId: string) {
  const actor = await g.conversations.requireActor(actorId);
  const conv = await g.conversations.requireConversation(conversationId);
  return g.conversations.requireReadable(actor, conv, await g.conversations.membershipOf(conv.id, actor.actorId));
}

/** What the client actually receives: the real CommErrorFilter writing an HTTP response. */
function http(e: CommError): { status: number; body: unknown } {
  const out: { status: number; body: unknown } = { status: 0, body: undefined };
  const res = {
    status(code: number) {
      out.status = code;
      return { json: (body: unknown) => { out.body = body; } };
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) };
  new CommErrorFilter().catch(e, host as never);
  return out;
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

  x = {
    adminX: randomUUID(),
    coverageId: randomUUID(),
    coverageOwnerId: randomUUID(),
    superAdminId: randomUUID(),
    covFamilyId: randomUUID(),
    covContactId: randomUUID(),
  };
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ('${x.adminX}'::uuid, 'admin_x', 'admin', true),
       ('${x.coverageId}'::uuid, 'coverage_k', 'coverage', true),
       ('${x.coverageOwnerId}'::uuid, 'coverage_o', 'coverage', true)`,
  );
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active) values ('${x.superAdminId}'::uuid, 'super_s', 'super_admin', true)`,
    ),
  ]);
  // U2: a family whose recorded owner holds the COVERAGE role.
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${x.covFamilyId}'::uuid, 'family_cov', '${x.coverageOwnerId}'::uuid, 'ar')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ('${x.covContactId}'::uuid, '${x.covFamilyId}'::uuid, 'parent_cov', 'primary_guardian', true, true)`,
  );

  b = { orgId: randomUUID(), managerId: randomUUID(), adminId: randomUUID() };
  const o = `'${b.orgId}'::uuid`;
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values (${o}, '${ORG_SLUG_PREFIX}${b.orgId.slice(0, 8)}', 'org_b')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, organization_id) values
       ('${b.managerId}'::uuid, 'manager_b1', 'manager', true, ${o}),
       ('${b.adminId}'::uuid, 'admin_b1', 'admin', true, ${o})`,
  );

  c = {
    // Parent <-> otherAdmin: family-scoped; the family OWNER (ownerId) is not a member.
    direct: (await g.conversations.getOrCreateDirect(s.parentId, s.otherAdminId)).id,
    group: (await g.conversations.ensureStudentGroup(s.learnerId)).id,
    // Teacher <-> Admin: no family.
    teacherAdmin: (await g.conversations.getOrCreateDirect(s.teacherId, s.otherAdminId)).id,
    // PD-6: the learner's teacher and the family's parent.
    teacherParent: (await g.conversations.getOrCreateDirect(s.teacherId, s.parentId)).id,
    covDirect: (await g.conversations.getOrCreateDirect(x.covContactId, s.otherAdminId)).id,
  };
});

// ===========================================================================
describe('organization first: another organization reads exactly like a missing conversation', () => {
  it('a manager of organization B is refused with the 404 a nonexistent id gets', async () => {
    const foreign = await refusal(requireReadable(b.managerId, c.direct));
    const missing = await refusal(g.conversations.requireConversation(randomUUID()));
    expect({ code: foreign.code, message: foreign.message, status: foreign.status }).toEqual({
      code: missing.code,
      message: missing.message,
      status: missing.status,
    });
    expect(foreign.status).toBe(404);
  });

  it('it costs no fact query', async () => {
    const r = await read(b.adminId, c.direct);
    expect(r.decision).toMatchObject({ allowed: false, code: CommErrorCode.CONVERSATION_NOT_FOUND, status: 404 });
    expect(r).toMatchObject({ familyQueries: 0, onDutyCalls: 0 });
  });

  it('an INACTIVE foreign staff member is answered "not found", not "inactive"', async () => {
    await g.prisma.$executeRawUnsafe(
      `update chat.staff set is_active = false, left_at = now() where id = '${b.adminId}'::uuid`,
    );
    const r = await read(b.adminId, c.direct);
    expect(r.decision).toMatchObject({ allowed: false, code: CommErrorCode.CONVERSATION_NOT_FOUND, status: 404 });
  });

  it('an inactive actor of the SAME organization is refused as inactive (403)', async () => {
    await g.prisma.$executeRawUnsafe(
      `update chat.staff set is_active = false, left_at = now() where id = '${x.adminX}'::uuid`,
    );
    const e = await refusal(requireReadable(x.adminX, c.direct));
    expect([e.code, e.status]).toEqual([CommErrorCode.ACTOR_INACTIVE, 403]);
  });
});

// ===========================================================================
describe('staff scope from real rows', () => {
  it('a manager reads any conversation of the organization, with no fact query', async () => {
    for (const id of Object.values(c)) {
      const r = await read(s.managerId, id);
      expect(r.decision.allowed).toBe(true);
      expect(r).toMatchObject({ familyQueries: 0, onDutyCalls: 0 });
    }
  });

  it('a live member reads, with no fact query', async () => {
    const r = await read(s.otherAdminId, c.direct);
    expect(r.decision.allowed).toBe(true);
    expect(r).toMatchObject({ familyQueries: 0, onDutyCalls: 0 });
  });

  it('the family OWNER (admin, not a member) reads: one owner query, no on-duty call', async () => {
    const r = await read(s.ownerId, c.direct);
    expect(r.decision.allowed).toBe(true);
    expect(r).toMatchObject({ familyQueries: 1, onDutyCalls: 0 });
  });

  it('an unrelated admin is refused NOT_CONVERSATION_MEMBER (403): owner query + on-duty call, then no', async () => {
    g.coverage.onDutyId = s.ownerId;
    const r = await read(x.adminX, c.direct);
    expect(r.decision).toMatchObject({ allowed: false, code: CommErrorCode.NOT_CONVERSATION_MEMBER });
    expect(r).toMatchObject({ familyQueries: 1, onDutyCalls: 1 });
    const e = await refusal(requireReadable(x.adminX, c.direct));
    expect(e.status).toBe(403);
  });

  it('interim: on-duty fallback -- the coverage admin on duty for the family reads (no owner query)', async () => {
    g.coverage.onDutyId = x.coverageId;
    const r = await read(x.coverageId, c.direct);
    expect(r.decision.allowed).toBe(true);
    expect(r).toMatchObject({ familyQueries: 0, onDutyCalls: 1 });
  });

  it('interim: a LIVE sticky handler takes precedence over the on-duty staff member', async () => {
    g.coverage.onDutyId = x.coverageId;
    await g.prisma.$executeRawUnsafe(
      `update chat.conversation set sticky_handler_id = '${x.adminX}'::uuid, sticky_until = now() + interval '1 hour'
       where id = '${c.direct}'::uuid`,
    );
    const handler = await read(x.adminX, c.direct);
    expect(handler.decision.allowed).toBe(true);
    expect(handler.onDutyCalls).toBe(0); // the sticky handler answers without consulting on_duty()
    const onDuty = await read(x.coverageId, c.direct);
    expect(onDuty.decision).toMatchObject({ allowed: false, code: CommErrorCode.NOT_CONVERSATION_MEMBER });
  });

  it('interim: an EXPIRED sticky handler falls back to on duty', async () => {
    g.coverage.onDutyId = x.coverageId;
    await g.prisma.$executeRawUnsafe(
      `update chat.conversation set sticky_handler_id = '${x.adminX}'::uuid, sticky_until = now() - interval '1 minute'
       where id = '${c.direct}'::uuid`,
    );
    expect((await read(x.coverageId, c.direct)).decision.allowed).toBe(true);
    expect((await read(x.adminX, c.direct)).decision.allowed).toBe(false);
  });

  it('on duty for ANOTHER family grants nothing here', async () => {
    g.coverage.onDutyId = x.coverageId; // pinned for every family, so use a family-less one
    const r = await read(x.coverageId, c.teacherAdmin);
    expect(r.decision).toMatchObject({ allowed: false, code: CommErrorCode.NOT_CONVERSATION_MEMBER });
    expect(r.onDutyCalls).toBe(0); // no family: on_duty() is never consulted
  });

  it('family-less: membership decides; the owner of some family and the on-duty staff get nothing', async () => {
    g.coverage.onDutyId = s.ownerId;
    expect((await read(s.otherAdminId, c.teacherAdmin)).decision.allowed).toBe(true);
    expect((await read(s.ownerId, c.teacherAdmin)).decision).toMatchObject({
      allowed: false,
      code: CommErrorCode.NOT_CONVERSATION_MEMBER,
    });
  });

  it('U2: a COVERAGE actor recorded as the family owner gains nothing from ownership', async () => {
    const r = await read(x.coverageOwnerId, c.covDirect);
    expect(r.decision).toMatchObject({ allowed: false, code: CommErrorCode.NOT_CONVERSATION_MEMBER });
    expect(r.familyQueries).toBe(0); // ownership is not even looked up for coverage
  });

  it('super_admin reads no family conversation by role, and costs no fact query', async () => {
    const r = await read(x.superAdminId, c.direct);
    expect(r.decision).toMatchObject({ allowed: false, code: CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY });
    expect(r).toMatchObject({ familyQueries: 0, onDutyCalls: 0 });
  });
});

// ===========================================================================
describe('parents and teachers: live membership (PD-6 unchanged)', () => {
  it('members read, with no fact query; a non-member parent of the same family does not', async () => {
    for (const [actor, conv] of [
      [s.parentId, c.direct],
      [s.parentId, c.group],
      [s.teacherId, c.group],
      [s.teacherId, c.teacherParent],
      [s.parentId, c.teacherParent],
    ] as const) {
      const r = await read(actor, conv);
      expect(r.decision.allowed).toBe(true);
      expect(r).toMatchObject({ familyQueries: 0, onDutyCalls: 0 });
    }
    expect((await read(s.otherParentId, c.direct)).decision).toMatchObject({
      allowed: false,
      code: CommErrorCode.NOT_CONVERSATION_MEMBER,
    });
    expect((await read(s.unrelatedTeacherId, c.teacherParent)).decision.allowed).toBe(false);
  });
});

// ===========================================================================
describe('what the client receives (the real exception filter)', () => {
  it('another organization: byte-identical to a conversation that does not exist (404)', async () => {
    const foreign = http(await refusal(requireReadable(b.managerId, c.direct)));
    const missing = http(await refusal(g.conversations.requireConversation(randomUUID())));
    expect(foreign).toEqual(missing);
    expect(foreign).toEqual({
      status: 404,
      body: { error: { code: CommErrorCode.CONVERSATION_NOT_FOUND, message: 'conversation not found' } },
    });
  });

  it('an inactive actor of another organization: the same 404, nothing about the account', async () => {
    await g.prisma.$executeRawUnsafe(
      `update chat.staff set is_active = false, left_at = now() where id = '${b.adminId}'::uuid`,
    );
    const foreign = http(await refusal(requireReadable(b.adminId, c.direct)));
    const missing = http(await refusal(g.conversations.requireConversation(randomUUID())));
    expect(foreign).toEqual(missing);
  });

  it('same organization, out of scope: 403 NOT_CONVERSATION_MEMBER', async () => {
    const r = http(await refusal(requireReadable(x.adminX, c.direct)));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: { code: CommErrorCode.NOT_CONVERSATION_MEMBER } });
  });

  it('same organization, inactive: 403 ACTOR_INACTIVE (the established refusal)', async () => {
    await g.prisma.$executeRawUnsafe(
      `update chat.staff set is_active = false, left_at = now() where id = '${x.adminX}'::uuid`,
    );
    const r = http(await refusal(requireReadable(x.adminX, c.direct)));
    expect(r).toEqual({ status: 403, body: { error: { code: CommErrorCode.ACTOR_INACTIVE, message: 'actor is inactive' } } });
  });
});

// ===========================================================================
describe('no fallback on a resolution failure', () => {
  it('a database error while reading the owner is an error, never a decision', async () => {
    const actor = await g.conversations.requireActor(s.ownerId);
    const conv = await g.conversations.requireConversation(c.direct);
    const spy = jest.spyOn(g.prisma.family, 'findUnique').mockRejectedValueOnce(new Error('db down'));
    try {
      await expect(g.conversations.canReadResolved(actor, conv, null)).rejects.toThrow('db down');
      await expect(g.conversations.requireReadable(actor, conv, null)).resolves.toBeUndefined(); // next call: real DB, owner reads
    } finally {
      spy.mockRestore();
    }
  });

  it('an on_duty() failure is an error, never a decision', async () => {
    const actor = await g.conversations.requireActor(x.coverageId);
    const conv = await g.conversations.requireConversation(c.direct);
    const spy = jest.spyOn(g.coverage, 'onDuty').mockRejectedValueOnce(new Error('on_duty failed'));
    try {
      await expect(g.conversations.requireReadable(actor, conv, null)).rejects.toThrow('on_duty failed');
    } finally {
      spy.mockRestore();
    }
  });
});

// ===========================================================================
describe('read is not send, not call', () => {
  it('U1: an OFF-DUTY owner reads, but cannot reply or start a call, and nothing is written', async () => {
    g.coverage.onDutyId = x.coverageId;
    expect((await read(s.ownerId, c.direct)).decision.allowed).toBe(true);

    const before = await Promise.all([g.prisma.message.count(), g.prisma.call.count()]);
    const send = await refusal(g.messages.send({ conversationId: c.direct, senderId: s.ownerId, body: 'hello' }));
    expect(send.code).toBe(CommErrorCode.NOT_ON_DUTY);
    const call = await refusal(g.calls.start(c.direct, s.ownerId));
    expect(call.code).toBe(CommErrorCode.NOT_ON_DUTY);
    expect(await Promise.all([g.prisma.message.count(), g.prisma.call.count()])).toEqual(before);
  });

  it('the ACTIVE HANDLER reads, but cannot answer or take media for a call that rang others', async () => {
    g.coverage.onDutyId = x.coverageId;
    expect((await read(x.coverageId, c.direct)).decision.allowed).toBe(true);
    const { callId } = await g.calls.start(c.direct, s.parentId);
    expect((await refusal(g.calls.accept(callId, x.coverageId))).code).toBe(CommErrorCode.CALL_NOT_A_PARTICIPANT);
    expect((await refusal(g.calls.issueToken(callId, x.coverageId))).code).toBe(CommErrorCode.CALL_NOT_A_PARTICIPANT);
  });
});

// ===========================================================================
describe('C1 changes no endpoint (transitional, flipped by C2)', () => {
  it('an un-migrated path still answers as before: an unrelated admin reads conversation detail', async () => {
    const { conversation } = await g.conversations.readWithMembers(c.direct, x.adminX);
    expect(conversation.id).toBe(c.direct);
  });
});
