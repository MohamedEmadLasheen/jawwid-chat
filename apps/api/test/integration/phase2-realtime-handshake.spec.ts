/**
 * The socket handshake race, and the frames that arrive during it.
 *
 * THE DEFECT this pins, found by driving a real socket rather than by a failing
 * test: `handleConnection` was `async`, and Socket.IO does NOT await a
 * connection handler before delivering frames. A client that subscribes the
 * instant it sees `connect` -- which is what a correct client does, because
 * rooms do not survive a reconnect and it must re-subscribe immediately -- could
 * therefore arrive before `client.actor` was set and be refused with
 * COMM.UNKNOWN_ACTOR.
 *
 * That refusal is the worst possible shape for a timing bug. It is
 * indistinguishable from an authorization failure, and a well-written client
 * STOPS RETRYING on one, because a policy refusal will be answered the same way
 * forever. The conversation then never subscribes and simply goes quiet.
 *
 * The gateway is exercised directly with a fake socket: the fix is in the
 * handler's ordering, and a real transport in the test would prove the
 * transport rather than the rule.
 */
import { buildGraph, seed, truncate, Scenario } from './harness';
import { RealtimeGateway } from '@communication/realtime/realtime.gateway';
import type { Actor } from '@platform/types';

const g = buildGraph();
let s: Scenario;
let conversationId: string;

class FakeSocket {
  readonly id = 'socket-1';
  readonly rooms = new Set<string>();
  readonly emitted: Array<{ event: string; payload: unknown }> = [];
  disconnected = false;
  actor?: Actor;
  sessionId?: string;
  revalidatedAt?: number;
  authenticated?: Promise<void>;
  handshake = { auth: {} as Record<string, unknown>, headers: {} as Record<string, unknown> };


  /**
   * Socket.IO middleware, captured rather than discarded so a test can drive
   * frames through it. The gateway installs the per-socket frame budget here
   * (Phase 8); a double that silently swallowed `use` would let that control be
   * deleted with every realtime test still green.
   */
  readonly middleware: Array<(packet: unknown[], next: (err?: Error) => void) => void> = [];
  use(fn: (packet: unknown[], next: (err?: Error) => void) => void): void {
    this.middleware.push(fn);
  }

  /** Send one frame through the installed middleware. Returns its refusal, if any. */
  frame(): Error | undefined {
    let refusal: Error | undefined;
    for (const fn of this.middleware) fn([], (err?: Error) => { refusal = err; });
    return refusal;
  }

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

function gateway(): RealtimeGateway {
  const presence = {
    online: async () => undefined,
    offline: async () => undefined,
    heartbeat: async () => undefined,
  };
  const typing = {
    start: async () => true,
    stop: async () => true,
    whoIsTyping: async () => [] as string[],
  };
  return new RealtimeGateway(
    g.authz,
    g.conversations,
    typing as never,
    presence as never,
    g.messages,
    g.auth,
    g.config,
  );
}

/** A real access token for an actor, issued the way a login issues one. */
async function tokenFor(actorId: string): Promise<string> {
  const accountId = s.accounts[actorId];
  const subject = `subject_${actorId}`;
  await g.accounts.setPassword(accountId, 'a-long-enough-test-password', {
    reason: 'test fixture',
  });
  const result = await g.auth.login(subject, 'a-long-enough-test-password');
  return result.accessToken;
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

describe('a frame that races the handshake', () => {
  it('SUBSCRIBES rather than being refused as an unknown actor', async () => {
    const gw = gateway();
    const socket = new FakeSocket();
    socket.handshake.auth = { token: await tokenFor(s.parentId) };

    // Exactly the race: the connection handler is started and NOT awaited, and
    // the subscribe frame is delivered immediately afterwards.
    gw.handleConnection(socket as never);
    const result = await gw.subscribe(socket as never, { conversationId });

    expect(result.ok).toBe(true);
    expect(result.code).toBeUndefined();
    expect(socket.rooms.has(`conversation:${conversationId}`)).toBe(true);
  });

  it('still refuses a conversation the actor may not read', async () => {
    const other = await g.conversations.getOrCreateDirect(s.otherAdminId, s.teacherId);

    const gw = gateway();
    const socket = new FakeSocket();
    socket.handshake.auth = { token: await tokenFor(s.parentId) };

    gw.handleConnection(socket as never);
    const result = await gw.subscribe(socket as never, { conversationId: other.id });

    // Closing the race must not have turned the authorization check off.
    expect(result.ok).toBe(false);
    expect(socket.rooms.has(`conversation:${other.id}`)).toBe(false);
  });

  it('refuses, and disconnects, a socket presenting no usable token', async () => {
    const gw = gateway();
    const socket = new FakeSocket();
    socket.handshake.auth = { token: 'not-a-real-token' };

    gw.handleConnection(socket as never);
    const result = await gw.subscribe(socket as never, { conversationId });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('COMM.UNKNOWN_ACTOR');
    expect(socket.disconnected).toBe(true);
  });

  it('reports who is already typing, so an indicator mid-flight is not invisible', async () => {
    const typingActors = [s.ownerId];
    const gw = new RealtimeGateway(
      g.authz,
      g.conversations,
      {
        start: async () => true,
        stop: async () => true,
        whoIsTyping: async () => typingActors,
      } as never,
      {
        online: async () => undefined,
        offline: async () => undefined,
        heartbeat: async () => undefined,
      } as never,
      g.messages,
      g.auth,
      g.config,
    );

    const socket = new FakeSocket();
    socket.handshake.auth = { token: await tokenFor(s.parentId) };
    gw.handleConnection(socket as never);

    const result = await gw.subscribe(socket as never, { conversationId });
    expect(result.typing).toEqual([s.ownerId]);
  });

  it('does not report the subscriber to themselves as typing', async () => {
    const gw = new RealtimeGateway(
      g.authz,
      g.conversations,
      {
        start: async () => true,
        stop: async () => true,
        whoIsTyping: async () => [s.parentId, s.ownerId],
      } as never,
      {
        online: async () => undefined,
        offline: async () => undefined,
        heartbeat: async () => undefined,
      } as never,
      g.messages,
      g.auth,
      g.config,
    );

    const socket = new FakeSocket();
    socket.handshake.auth = { token: await tokenFor(s.parentId) };
    gw.handleConnection(socket as never);

    const result = await gw.subscribe(socket as never, { conversationId });
    expect(result.typing).toEqual([s.ownerId]);
  });

  it('a disconnect during the handshake leaves no typing key behind', async () => {
    const stopped: string[] = [];
    const gw = new RealtimeGateway(
      g.authz,
      g.conversations,
      {
        start: async () => true,
        stop: async (conv: string) => {
          stopped.push(conv);
          return true;
        },
        whoIsTyping: async () => [] as string[],
      } as never,
      {
        online: async () => undefined,
        offline: async () => undefined,
        heartbeat: async () => undefined,
      } as never,
      g.messages,
      g.auth,
      g.config,
    );

    const socket = new FakeSocket();
    socket.handshake.auth = { token: await tokenFor(s.parentId) };
    gw.handleConnection(socket as never);
    await gw.subscribe(socket as never, { conversationId });

    // The disconnect handler awaits the same authentication promise, so a
    // connection that came and went inside that window still cleans up.
    await gw.handleDisconnect(socket as never);
    expect(stopped).toContain(conversationId);
  });
});
