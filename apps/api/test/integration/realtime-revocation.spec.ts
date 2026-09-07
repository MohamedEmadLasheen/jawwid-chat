/**
 * Realtime access revocation.
 *
 * The question the Phase 1 report left open: does an already-established socket
 * stop receiving a conversation's data when the actor loses access to it?
 *
 * The existing mechanisms cover part of it and not all of it:
 *
 *   token verification      catches a forged or expired token   -- at connect
 *   session revocation      catches logout and offboarding      -- at heartbeat
 *   subscribe authorization catches an unauthorized subscribe    -- at subscribe
 *
 * None of them catches a change of SCOPE, which is the thing that moves during
 * ordinary operation. A family is reassigned; the previous supervisor's socket
 * is still joined to the room. That is the gap this suite pins.
 *
 * The gateway is exercised directly with a fake socket rather than over a real
 * WebSocket: the security decision is in the handler, and a socket.io transport
 * in the test would prove the transport, not the rule.
 */
import { buildGraph, seed, truncate, Scenario } from './harness';
import { RealtimeGateway } from '@communication/realtime/realtime.gateway';
import { CommEvent } from '@communication/contracts/events';
import type { Actor } from '@platform/types';

const g = buildGraph();
let s: Scenario;
let conversationId: string;

/** Enough of a socket.io socket for the handlers under test. */
class FakeSocket {
  readonly id = 'socket-1';
  readonly rooms = new Set<string>();
  readonly emitted: Array<{ event: string; payload: unknown }> = [];
  disconnected = false;
  actor?: Actor;
  sessionId?: string;
  revalidatedAt?: number;
  handshake = { auth: {} as Record<string, unknown>, headers: {} as Record<string, unknown> };

  async join(room: string): Promise<void> {
    this.rooms.add(room);
  }
  async leave(room: string): Promise<void> {
    this.rooms.delete(room);
  }
  emit(event: string, payload: unknown): void {
    this.emitted.push({ event, payload });
  }
  disconnect(): void {
    this.disconnected = true;
  }
  to(): { emit: () => void } {
    return { emit: () => undefined };
  }
}

/** The gateway, with only the collaborators these handlers touch. */
function gateway(): RealtimeGateway {
  const presence = { online: async () => undefined, offline: async () => undefined, heartbeat: async () => undefined };
  const typing = { start: async () => false, stop: async () => false };
  return new RealtimeGateway(
    g.authz,
    g.conversations,
    typing as never,
    presence as never,
    g.messages,
    g.auth,
  );
}

beforeEach(async () => {
  g.coverage.onDutyId = null;
  await truncate(g.prisma);
  s = await seed(g.prisma);
  conversationId = (await g.conversations.getOrCreateDirect(s.ownerId, s.parentId)).id;
});

afterAll(async () => {
  await g.prisma.$disconnect();
});

async function subscribedSocket(actorId: string): Promise<{ socket: FakeSocket; gw: RealtimeGateway }> {
  const gw = gateway();
  const socket = new FakeSocket();
  socket.actor = (await g.identity.resolveActor(actorId))!;
  socket.revalidatedAt = Date.now();
  const result = await gw.subscribe(socket as never, { conversationId });
  expect(result.ok).toBe(true);
  expect(socket.rooms.has(`conversation:${conversationId}`)).toBe(true);
  return { socket, gw };
}

// -------------------------------------------------------------------------
describe('subscribing', () => {
  it('refuses a conversation the actor may not read', async () => {
    const gw = gateway();
    const socket = new FakeSocket();
    socket.actor = (await g.identity.resolveActor(s.otherAdminId))!;
    // Freshly validated: this test is about scope, not about staleness.
    socket.revalidatedAt = Date.now();

    const result = await gw.subscribe(socket as never, { conversationId });
    expect(result).toMatchObject({ ok: false, code: 'COMM.OUT_OF_SCOPE' });
    expect(socket.rooms.size).toBe(0);
  });

  it('refuses a socket with no actor at all', async () => {
    const gw = gateway();
    const socket = new FakeSocket();
    const result = await gw.subscribe(socket as never, { conversationId });
    expect(result).toMatchObject({ ok: false, code: 'COMM.UNKNOWN_ACTOR' });
  });

  it('refuses a conversation that does not exist, without saying so differently', async () => {
    const { gw, socket } = await subscribedSocket(s.ownerId);
    const result = await gw.subscribe(socket as never, {
      conversationId: '00000000-0000-0000-0000-0000000000ff',
    });
    expect(result.ok).toBe(false);
  });
});

// -------------------------------------------------------------------------
describe('a socket that loses SCOPE stops receiving the conversation', () => {
  it('is removed from the room on the next heartbeat, and told why', async () => {
    const { socket, gw } = await subscribedSocket(s.ownerId);

    // The family moves. The socket is still joined at this instant.
    const manager = (await g.identity.resolveActor(s.managerId))!;
    await g.families.assignSupervisor(manager, s.familyId, s.otherAdminId, 'the family moved');
    expect(socket.rooms.has(`conversation:${conversationId}`)).toBe(true);

    // Force the identity re-read the heartbeat would do on its own schedule.
    socket.revalidatedAt = 0;
    socket.handshake.auth = {};
    socket.actor = (await g.identity.resolveActor(s.ownerId))!;
    socket.revalidatedAt = Date.now();

    await gw.heartbeat(socket as never);

    expect(socket.rooms.has(`conversation:${conversationId}`)).toBe(false);
    expect(socket.emitted).toContainEqual({
      event: CommEvent.ACCESS_REVOKED,
      payload: { conversationId, reason: 'out_of_scope' },
    });
  });

  it('and cannot simply re-subscribe afterwards', async () => {
    const { socket, gw } = await subscribedSocket(s.ownerId);
    const manager = (await g.identity.resolveActor(s.managerId))!;
    await g.families.assignSupervisor(manager, s.familyId, s.otherAdminId, 'the family moved');

    socket.actor = (await g.identity.resolveActor(s.ownerId))!;
    socket.revalidatedAt = Date.now();
    await gw.heartbeat(socket as never);

    const again = await gw.subscribe(socket as never, { conversationId });
    expect(again).toMatchObject({ ok: false, code: 'COMM.OUT_OF_SCOPE' });
    expect(socket.rooms.has(`conversation:${conversationId}`)).toBe(false);
  });

  it('leaves a socket that still HAS access alone', async () => {
    const { socket, gw } = await subscribedSocket(s.ownerId);
    socket.revalidatedAt = Date.now();
    await gw.heartbeat(socket as never);

    expect(socket.rooms.has(`conversation:${conversationId}`)).toBe(true);
    expect(socket.emitted).toHaveLength(0);
  });

  it('removes a member who has left the conversation, for the right reason', async () => {
    const { socket, gw } = await subscribedSocket(s.parentId);

    await g.prisma.conversationMember.updateMany({
      where: { conversationId, actorId: s.parentId },
      data: { leftAt: new Date() },
    });

    socket.actor = (await g.identity.resolveActor(s.parentId))!;
    socket.revalidatedAt = Date.now();
    await gw.heartbeat(socket as never);

    expect(socket.rooms.has(`conversation:${conversationId}`)).toBe(false);
    expect(socket.emitted).toContainEqual({
      event: CommEvent.ACCESS_REVOKED,
      payload: { conversationId, reason: 'not_a_member' },
    });
  });
});

// -------------------------------------------------------------------------
describe('a socket whose SESSION ends is dropped entirely', () => {
  it('is disconnected on the next heartbeat once the session is revoked', async () => {
    const PASSWORD = 'a-sufficiently-long-password';
    await g.accounts.setPassword(s.accounts[s.ownerId], PASSWORD, {
      reason: 'test fixture',
      invalidateSessions: false,
    });
    const issued = await g.auth.login(`subject_${s.ownerId}`, PASSWORD, { clientKey: 'ws' });

    const gw = gateway();
    const socket = new FakeSocket();
    socket.handshake.auth = { token: issued.accessToken };
    await gw.handleConnection(socket as never);
    expect(socket.disconnected).toBe(false);
    expect(socket.actor?.actorId).toBe(s.ownerId);

    await g.sessions.revokeAll(s.accounts[s.ownerId], 'test: logout everywhere');

    // Stale enough to force the re-read.
    socket.revalidatedAt = 0;
    const result = await gw.heartbeat(socket as never);

    expect(result).toEqual({ ok: false });
    expect(socket.disconnected).toBe(true);
  });

  it('refuses the connection outright when the token is absent or forged', async () => {
    const gw = gateway();

    const noToken = new FakeSocket();
    await gw.handleConnection(noToken as never);
    expect(noToken.disconnected).toBe(true);

    const forged = new FakeSocket();
    forged.handshake.auth = { token: 'not.a.token' };
    await gw.handleConnection(forged as never);
    expect(forged.disconnected).toBe(true);
  });

  it('ignores a handshake that names an actor instead of presenting a token', async () => {
    // The Phase 0 seam. A socket that says "I am this actor" is nobody.
    const gw = gateway();
    const socket = new FakeSocket();
    socket.handshake.auth = { actorId: s.ownerId };
    await gw.handleConnection(socket as never);
    expect(socket.disconnected).toBe(true);
    expect(socket.actor).toBeUndefined();
  });
});
