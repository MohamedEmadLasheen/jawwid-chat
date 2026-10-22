/**
 * Starting a call is refused with a COMM.* 4xx, never a 500 -- and the
 * capability answer agrees with start() on the refusal.
 *
 * FOUND on the system-test stack (2026-10-22): in a teacher_supervision chat the
 * capability said canCall:true, then POST /calls failed inside the database --
 * chat.assert_call_br1, "a direct call may not have more than two
 * participants" -- and the raw error reached the client as a 500. PD-19's
 * second amendment makes those chats GROUP calls (call-staff-group-chats.spec).
 * This spec pins the two things that keep the next such gap from being a 500:
 *
 *   1. THE SAME RULE, ASKED FIRST. decideInitiate() decides the call type and
 *      refuses a DIRECT call with more than two seats itself, so the capability
 *      endpoint and start() both answer COMM.INVALID_PARTICIPANTS before
 *      anything is written. `official` is the remaining conversation type that
 *      is neither a group call nor two-seated by construction.
 *   2. THE DATABASE STILL HAS THE LAST WORD, AS A 4xx. If the application ever
 *      approves a set the BR-1 call triggers refuse, start() reports the
 *      refusal as a CommError and writes nothing -- forced here by stubbing the
 *      decision, since by construction the application no longer disagrees.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { CommError, CommErrorCode } from '@platform/errors';
import type { Actor } from '@platform/types';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

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
});
afterEach(() => {
  jest.restoreAllMocks();
});

async function refusal(p: Promise<unknown>): Promise<[string, number]> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return [e.code, e.status];
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const footprint = async () => ({
  calls: await g.prisma.call.count(),
  participants: await g.prisma.callParticipant.count(),
  outbox: await g.prisma.outboxEvent.count({ where: { type: 'call.incoming' } }),
});

/** An `official` conversation seating three staff: not a group call, and not two seats. */
async function officialWithThreeStaff(): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.conversation (type, title) values ('official', 'official_x') returning id::text as id`,
  );
  await g.prisma.conversationMember.createMany({
    data: [s.ownerId, s.otherAdminId, s.managerId].map((actorId) => ({
      conversationId: id,
      actorId,
      actorKind: 'staff',
      memberRole: 'admin',
    })),
  });
  return id;
}

describe('a direct call never has more than two seats -- refused before anything is written', () => {
  it('capability and start agree: COMM.INVALID_PARTICIPANTS, 403, nothing written', async () => {
    const conversationId = await officialWithThreeStaff();

    expect(await g.calls.callCapability(conversationId, s.ownerId)).toEqual({
      canCall: false,
      code: CommErrorCode.INVALID_PARTICIPANTS,
    });
    const before = await footprint();
    expect(await refusal(g.calls.start(conversationId, s.ownerId))).toEqual([CommErrorCode.INVALID_PARTICIPANTS, 403]);
    expect(await footprint()).toEqual(before);
  });
});

describe("the database's refusal of a call reaches the client as a 4xx", () => {
  /**
   * Stand in for an application decision that disagrees with the database:
   * approve `seats` in the conversation, typed as a direct call.
   */
  async function approveRegardless(seatIds: string[]): Promise<void> {
    const seats: Actor[] = [];
    for (const id of seatIds) seats.push((await g.conversations.requireActor(id))!);
    jest
      .spyOn(g.calls as unknown as { decideInitiate: () => Promise<unknown> }, 'decideInitiate')
      .mockResolvedValue({ decision: { allowed: true }, participantActors: seats, callType: 'direct' });
  }

  it('more than two seats on a direct call: COMM.INVALID_PARTICIPANTS, nothing written', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await approveRegardless([s.ownerId, s.parentId, s.otherAdminId]);

    const before = await footprint();
    expect(await refusal(g.calls.start(conv.id, s.ownerId))).toEqual([CommErrorCode.INVALID_PARTICIPANTS, 403]);
    expect(await footprint()).toEqual(before);
  });

  it('a teacher and a family contact on a direct call: COMM.BR1_TEACHER_PARENT_DIRECT, nothing written (BR-1)', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await approveRegardless([s.teacherId, s.parentId]);

    const before = await footprint();
    expect(await refusal(g.calls.start(conv.id, s.ownerId))).toEqual([CommErrorCode.BR1_TEACHER_PARENT_DIRECT, 403]);
    expect(await footprint()).toEqual(before);
  });
});
