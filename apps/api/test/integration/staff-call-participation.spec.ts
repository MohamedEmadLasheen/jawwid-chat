/**
 * Staff calls on the PD-8 line -- ported from the parallel branch's 33a347a.
 *
 *   D1 (PD-A)  Whoever starts a call must be ON it. Since PD-8 a department
 *              manager, an ACTIVE backup or the super admin may send into a
 *              conversation they are not a member of; without D1 they could
 *              start a call that rings the family while holding no seat in it
 *              (a "phantom call"). Starting a call needs membership; reading and
 *              sending are unchanged. PD-19 amendment: the super admin may
 *              start a GROUP call anyway, because the server gives them a seat
 *              on the call itself; a 1:1 between two others stays refused.
 *   D3         Every call operation establishes the organization first: another
 *              organization's conversation or call is answered exactly like an
 *              unknown id (404), before membership or call state can be read.
 *
 * Real database, real services. Synthetic people only.
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { activateBackup, buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let direct: string;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'scp-%'`);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'scp-%'`);
  s = await seed(g.prisma);
  direct = (await g.conversations.getOrCreateDirect(s.parentId, s.ownerId)).id;
});

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return { code: e.code, status: e.status };
    throw e;
  }
  throw new Error('expected a refusal');
}

const footprint = async () => ({
  calls: await g.prisma.call.count(),
  participants: await g.prisma.callParticipant.count(),
  outbox: await g.prisma.outboxEvent.count(),
});

async function superAdmin(): Promise<string> {
  const id = randomUUID();
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ('${id}'::uuid, 'super_s', 'super_admin', true)`);
  });
  return id;
}

describe('D1 -- whoever starts a call must be on it (no phantom calls)', () => {
  it('the department manager, an ACTIVE backup and the super admin may read and send in the 1:1, but not start a call in it', async () => {
    await activateBackup(g.prisma, s.ownerId, s.otherAdminId);
    const owner = await superAdmin();
    for (const staff of [s.managerId, s.otherAdminId, owner]) {
      // In scope: they may read and write...
      const sent = await g.messages.send({ conversationId: direct, senderId: staff, body: `from ${staff}`, clientMessageId: randomUUID() });
      expect(sent.moderation).toBe('published');
      // ...but a call they are not on is refused, and nothing is created or rung.
      const before = await footprint();
      expect(await refusal(g.calls.start(direct, staff))).toEqual({ code: CommErrorCode.NOT_CONVERSATION_MEMBER, status: 403 });
      expect(await footprint()).toEqual(before);
      // The advisory answers the same, so no client offers the button.
      expect(await g.calls.callCapability(direct, staff)).toEqual({ canCall: false, code: CommErrorCode.NOT_CONVERSATION_MEMBER });
    }
  });

  it('the supervisor who IS a member still starts the call, and is a participant of it', async () => {
    const { callId } = await g.calls.start(direct, s.ownerId);
    const participants = await g.prisma.callParticipant.findMany({ where: { callId } });
    expect(participants.map((p) => p.actorId).sort()).toEqual([s.ownerId, s.parentId].sort());
    expect(await g.calls.callCapability(direct, s.ownerId)).toEqual({ canCall: true, code: null });
  });

  it('in a Student Group the teacher starts a call, and since PD-19 the parent may too', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await expect(g.calls.start(group.id, s.teacherId)).resolves.toEqual(expect.objectContaining({ callId: expect.any(String) }));
    await expect(g.calls.start(group.id, s.parentId)).resolves.toEqual(expect.objectContaining({ callId: expect.any(String) }));
  });
});

describe('PD-19 amendment -- the super admin may start a GROUP call without being a member', () => {
  it('starts it, holds a seat on the call (not in the chat), rings the members, and can join it', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const owner = await superAdmin();
    const membersBefore = await g.prisma.conversationMember.count({ where: { conversationId: group.id } });

    expect(await g.calls.callCapability(group.id, owner)).toEqual({ canCall: true, code: null });
    const { callId } = await g.calls.start(group.id, owner);

    const seats = (await g.prisma.callParticipant.findMany({ where: { callId } })).map((p) => p.actorId);
    expect(seats).toContain(owner);
    expect(seats).toEqual(expect.arrayContaining([s.teacherId, s.parentId, s.ownerId]));
    // A seat on the call, never chat membership.
    expect(await g.prisma.conversationMember.count({ where: { conversationId: group.id } })).toBe(membersBefore);
    expect(await g.prisma.conversationMember.count({ where: { conversationId: group.id, actorId: owner } })).toBe(0);
    // The members are rung.
    expect(await g.prisma.outboxEvent.count({ where: { type: 'call.incoming' } })).toBe(1);

    // The caller can enter their own call, and a member can answer it.
    await expect(g.calls.issueToken(callId, owner)).resolves.toEqual(expect.objectContaining({ token: expect.any(String) }));
    await g.calls.accept(callId, s.parentId);
    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: callId } })).status).toBe('active');
  });

  it('a 1:1 between two other people stays refused for the super admin -- a direct call has two seats', async () => {
    const owner = await superAdmin();
    expect(await refusal(g.calls.start(direct, owner))).toEqual({ code: CommErrorCode.NOT_CONVERSATION_MEMBER, status: 403 });
    expect(await g.calls.callCapability(direct, owner)).toEqual({ canCall: false, code: CommErrorCode.NOT_CONVERSATION_MEMBER });
  });

  it('the department manager and an ACTIVE backup are unchanged: no seat, no call, nothing written', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await activateBackup(g.prisma, s.ownerId, s.otherAdminId);
    for (const staff of [s.managerId, s.otherAdminId]) {
      const before = await footprint();
      expect(await refusal(g.calls.start(group.id, staff))).toEqual({ code: CommErrorCode.NOT_CONVERSATION_MEMBER, status: 403 });
      expect(await footprint()).toEqual(before);
      expect(await g.calls.callCapability(group.id, staff)).toEqual({ canCall: false, code: CommErrorCode.NOT_CONVERSATION_MEMBER });
    }
  });
});

describe('D3 -- another organization reads exactly like an unknown id, on every call operation', () => {
  async function foreignParent(): Promise<string> {
    const org = randomUUID();
    const admin = randomUUID();
    const family = randomUUID();
    const contact = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${org}'::uuid, 'scp-${org.slice(0, 8)}', 'org_b')`);
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active, organization_id) values ('${admin}'::uuid, 'admin_b1', 'admin', true, '${org}'::uuid)`);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family (id, display_name, owner_id, language, organization_id) values ('${family}'::uuid, 'family_b', '${admin}'::uuid, 'ar', '${org}'::uuid)`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active, organization_id)
       values ('${contact}'::uuid, '${family}'::uuid, 'parent_b1', 'primary_guardian', true, true, '${org}'::uuid)`,
    );
    return contact;
  }

  it('start, capability and history on a foreign conversation answer as for an unknown one', async () => {
    const outsider = await foreignParent();
    const unknown = randomUUID();
    const before = await footprint();
    for (const op of [
      (id: string) => g.calls.start(id, outsider),
      (id: string) => g.calls.callCapability(id, outsider),
      (id: string) => g.calls.history(id, outsider),
    ]) {
      const foreign = await refusal(op(direct));
      expect(foreign).toEqual(await refusal(op(unknown)));
      expect(foreign).toEqual({ code: CommErrorCode.CONVERSATION_NOT_FOUND, status: 404 });
    }
    expect(await footprint()).toEqual(before);
  });

  it('join, accept, decline and end of a foreign call answer as for an unknown call', async () => {
    const outsider = await foreignParent();
    const { callId } = await g.calls.start(direct, s.ownerId);
    const unknown = randomUUID();
    for (const op of [
      (id: string) => g.calls.issueToken(id, outsider),
      (id: string) => g.calls.accept(id, outsider),
      (id: string) => g.calls.decline(id, outsider),
      (id: string) => g.calls.end(id, outsider),
    ]) {
      const foreign = await refusal(op(callId));
      expect(foreign).toEqual(await refusal(op(unknown)));
      expect(foreign).toEqual({ code: CommErrorCode.CALL_NOT_FOUND, status: 404 });
    }
    // The call itself is untouched by the probes.
    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: callId } })).status).toBe('ringing');
  });
});
