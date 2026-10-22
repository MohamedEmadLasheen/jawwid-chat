/**
 * PD-19, second amendment (2026-10-22) -- calls in the staff-only groups around
 * one teacher: their TRIAL GROUP (PD-11 T4) and their TEACHER SUPERVISION
 * conversation (PD-11 / PD-12).
 *
 * THE DEFECT. Both seat the teacher with several staff, and the capability
 * endpoint offered the call button there, but CallService typed every call
 * outside the family-facing groups as DIRECT. chat.assert_call_br1 refuses a
 * direct call with more than two participants, so POST /calls failed with a raw
 * database error (a 500) every time: "a direct call may not have more than two
 * participants". Capability and start disagreed.
 *
 * THE DECISION (owner, 2026-10-22: "Allow + super admin"). These are GROUP
 * calls. Every member may start one; the super admin may start one without
 * being a member and gets a seat on the call, not in the chat (the PD-19
 * amendment's rule); anyone else who is not a member is refused (D1), and the
 * capability answers exactly as start does.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const cards = new CardPoster(g.conversations, g.outbox, audit);
const supervision = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const trialGroups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);

let s: Scenario;
/** A Teachers-department supervisor and the department's manager: permanent members of both chats. */
let tsupId: string;
let tmgrId: string;
/** A Sales supervisor: may write in the trial group without sitting in it. */
let salesId: string;

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
  salesId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active)
     values ($1::uuid, 'tsup_a', 'admin', true), ($2::uuid, 'tmgr_b', 'manager', true), ($3::uuid, 'sales_c', 'admin', true)`,
    tsupId,
    tmgrId,
    salesId,
  );
  const [{ id: teachers }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`,
    tmgrId,
  );
  const [{ id: sales }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ('sales', 'sales') returning id::text as id`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor'),
            ($3::uuid, chat.default_organization_id(), $4::uuid, 'supervisor')`,
    tsupId,
    teachers,
    salesId,
    sales,
  );
});

async function superAdmin(): Promise<string> {
  const id = randomUUID();
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ('${id}'::uuid, 'super_s', 'super_admin', true)`);
  });
  return id;
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const footprint = async () => ({
  calls: await g.prisma.call.count(),
  participants: await g.prisma.callParticipant.count(),
  outbox: await g.prisma.outboxEvent.count({ where: { type: 'call.incoming' } }),
});

const liveMemberIds = async (conversationId: string) =>
  (await g.prisma.conversationMember.findMany({ where: { conversationId, leftAt: null } })).map((m) => m.actorId).sort();

const CHATS: Array<[string, () => Promise<string>]> = [
  ['trial_group', async () => (await trialGroups.openOwn(s.teacherId)).conversationId],
  ['teacher_supervision', async () => (await supervision.ensureOwn(s.teacherId)).conversationId],
];

describe.each(CHATS)('%s', (type, open) => {
  let conversationId: string;
  beforeEach(async () => {
    conversationId = await open();
    expect((await g.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).type).toBe(type);
  });

  it('seats more than two people -- the case a direct call cannot hold', async () => {
    expect(await liveMemberIds(conversationId)).toEqual([s.teacherId, tsupId, tmgrId].sort());
  });

  it('the teacher is offered the call, starts it as a GROUP call, and every member is rung', async () => {
    expect(await g.calls.callCapability(conversationId, s.teacherId)).toEqual({ canCall: true, code: null });

    const { callId } = await g.calls.start(conversationId, s.teacherId);

    const call = await g.prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(call.type).toBe('group');
    const seats = (await g.prisma.callParticipant.findMany({ where: { callId } })).map((p) => p.actorId).sort();
    expect(seats).toEqual(await liveMemberIds(conversationId));
    const rung = await g.prisma.outboxEvent.findMany({ where: { type: 'call.incoming' } });
    expect(rung).toHaveLength(1);
    expect(rung[0]!.payload).toMatchObject({ callId, conversationId, type: 'group' });
  });

  it('a staff member starts one too, and another member answers it', async () => {
    expect(await g.calls.callCapability(conversationId, tsupId)).toEqual({ canCall: true, code: null });
    const { callId } = await g.calls.start(conversationId, tsupId);
    await g.calls.accept(callId, s.teacherId);
    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: callId } })).status).toBe('active');
    await expect(g.calls.issueToken(callId, s.teacherId)).resolves.toEqual(expect.objectContaining({ token: expect.any(String) }));
  });

  it('the super admin starts one without being a member: a seat on the call, never in the chat', async () => {
    const owner = await superAdmin();
    const membersBefore = await liveMemberIds(conversationId);
    expect(membersBefore).not.toContain(owner);

    expect(await g.calls.callCapability(conversationId, owner)).toEqual({ canCall: true, code: null });
    const { callId } = await g.calls.start(conversationId, owner);

    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: callId } })).type).toBe('group');
    const seats = (await g.prisma.callParticipant.findMany({ where: { callId } })).map((p) => p.actorId).sort();
    expect(seats).toEqual([...membersBefore, owner].sort());
    expect(await liveMemberIds(conversationId)).toEqual(membersBefore);
    await expect(g.calls.issueToken(callId, owner)).resolves.toEqual(expect.objectContaining({ token: expect.any(String) }));
  });
});

describe('trial_group -- a non-member who may write there still may not start a call (D1)', () => {
  it('the Sales supervisor reads and writes the group, but is refused a call, and the capability agrees', async () => {
    const conversationId = (await trialGroups.openOwn(s.teacherId)).conversationId;
    expect(await liveMemberIds(conversationId)).not.toContain(salesId);
    const sent = await g.messages.send({ conversationId, senderId: salesId, body: 'about the trial', clientMessageId: randomUUID() });
    expect(sent.moderation).toBe('published');

    const before = await footprint();
    expect(await refusal(g.calls.start(conversationId, salesId))).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
    expect(await footprint()).toEqual(before);
    expect(await g.calls.callCapability(conversationId, salesId)).toEqual({ canCall: false, code: CommErrorCode.NOT_CONVERSATION_MEMBER });

    // Joining the group is what makes the call theirs to start.
    const actor = await g.conversations.requireActor(salesId);
    await trialGroups.join(actor, conversationId);
    expect(await g.calls.callCapability(conversationId, salesId)).toEqual({ canCall: true, code: null });
    await expect(g.calls.start(conversationId, salesId)).resolves.toEqual(expect.objectContaining({ callId: expect.any(String) }));
  });
});
