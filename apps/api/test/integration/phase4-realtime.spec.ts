/**
 * Phase 4A — realtime: room authorization, presence, typing.
 *
 * TWO THINGS ARE UNDER TEST, and they fail differently.
 *
 * The GATEWAY decides who may be in a room. Its failures are security failures,
 * so every rule is asserted from both sides: the authorized case succeeding is
 * not evidence that the unauthorized case is refused, and only the pair is.
 *
 * The PRESENCE and TYPING services decide what a Redis keyspace holds. Their
 * failures are operational: the previous implementations were correct and used
 * `KEYS`, a full keyspace scan on a single-threaded server, on paths that run
 * whenever anybody opens a conversation. That fails by getting slow, which no
 * assertion catches -- so what is asserted here is the BEHAVIOUR the new data
 * structures had to preserve while the shape changed underneath them: expiry,
 * multi-device union, per-conversation scoping, and duplicate tolerance.
 *
 * Requires the migrated database (DATABASE_URL) and Redis.
 */
import Redis from 'ioredis';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { RealtimeGateway } from '@communication/realtime/realtime.gateway';
import { PresenceService } from '@communication/realtime/presence.service';
import { TypingService } from '@communication/realtime/typing.service';
import { CommEvent } from '@communication/contracts/events';
import type { Actor } from '@platform/types';

const REDIS_URL = process.env.REALTIME_TEST_REDIS_URL ?? 'redis://localhost:6410';

const g = buildGraph();
let s: Scenario;
let conversationId: string;

class FakeSocket {
  constructor(readonly id = `socket-${Math.random().toString(36).slice(2)}`) {}
  readonly rooms = new Set<string>();
  readonly emitted: Array<{ event: string; payload: unknown }> = [];
  /** What was broadcast to the room rather than to this socket. */
  readonly broadcast: Array<{ room: string; event: string; payload: unknown }> = [];
  disconnected = false;
  actor?: Actor;
  sessionId?: string;
  revalidatedAt?: number;
  authenticated?: Promise<void>;
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
  to(room: string) {
    return {
      emit: (event: string, payload: unknown) => this.broadcast.push({ room, event, payload }),
    };
  }
}

/** The gateway with transient state stubbed, for the authorization rules. */
function gateway(overrides: { typing?: unknown; presence?: unknown } = {}): RealtimeGateway {
  return new RealtimeGateway(
    g.authz,
    g.conversations,
    (overrides.typing ?? {
      start: async () => true,
      stop: async () => true,
      whoIsTyping: async () => [] as string[],
    }) as never,
    (overrides.presence ?? {
      online: async () => false,
      offline: async () => false,
      heartbeat: async () => undefined,
      lastSeen: async () => null,
    }) as never,
    g.messages,
    g.auth,
  );
}

async function tokenFor(actorId: string): Promise<string> {
  const accountId = s.accounts[actorId];
  await g.accounts.setPassword(accountId, 'a-long-enough-test-password', {
    reason: 'test fixture',
  });
  const result = await g.auth.login(`subject_${actorId}`, 'a-long-enough-test-password');
  return result.accessToken;
}

async function connected(gw: RealtimeGateway, actorId: string): Promise<FakeSocket> {
  const socket = new FakeSocket();
  socket.handshake.auth = { token: await tokenFor(actorId) };
  await gw.handleConnection(socket as never);
  return socket;
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

// ---------------------------------------------------------------------------
// Room authorization
// ---------------------------------------------------------------------------

describe('a client never joins a room by naming it', () => {
  it('an authorized member joins', async () => {
    const gw = gateway();
    const socket = await connected(gw, s.parentId);

    const result = await gw.subscribe(socket as never, { conversationId });

    expect(result.ok).toBe(true);
    expect(socket.rooms.has(`conversation:${conversationId}`)).toBe(true);
  });

  it('a non-member is refused, and is not in the room', async () => {
    const gw = gateway();
    // A parent of a DIFFERENT family. Authenticated perfectly well; entitled to
    // nothing here.
    const socket = await connected(gw, s.otherParentId);

    const result = await gw.subscribe(socket as never, { conversationId });

    expect(result.ok).toBe(false);
    expect(socket.rooms.has(`conversation:${conversationId}`)).toBe(false);
  });

  it('an unauthenticated socket is refused and disconnected', async () => {
    const gw = gateway();
    const socket = new FakeSocket();
    socket.handshake.auth = { token: '' };
    await gw.handleConnection(socket as never);

    const result = await gw.subscribe(socket as never, { conversationId });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('COMM.UNKNOWN_ACTOR');
    expect(socket.disconnected).toBe(true);
    expect(socket.rooms.size).toBe(0);
  });

  it('a forged conversation id gains nothing', async () => {
    const gw = gateway();
    const socket = await connected(gw, s.parentId);

    const result = await gw.subscribe(socket as never, {
      conversationId: '00000000-0000-0000-0000-000000000000',
    });

    expect(result.ok).toBe(false);
    expect(socket.rooms.size).toBe(1); // only its own actor room
  });

  it('a member whose access is REVOKED is removed from the room it already holds', async () => {
    const gw = gateway();
    const socket = await connected(gw, s.parentId);
    expect((await gw.subscribe(socket as never, { conversationId })).ok).toBe(true);

    // Access does not only change at connect time. A membership ends, a family
    // is reassigned, a cover window closes -- and the socket is still joined.
    await g.prisma.conversationMember.updateMany({
      where: { conversationId, actorId: s.parentId },
      data: { leftAt: new Date() },
    });

    // The heartbeat is where it is noticed, so exposure is bounded by the
    // heartbeat interval rather than by the lifetime of the connection.
    await gw.heartbeat(socket as never);

    expect(socket.rooms.has(`conversation:${conversationId}`)).toBe(false);
    expect(socket.emitted.map((e) => e.event)).toContain(CommEvent.ACCESS_REVOKED);
  });

  it('a non-member cannot announce themselves as typing into the room', async () => {
    const started: string[] = [];
    const gw = gateway({
      typing: {
        start: async (c: string) => {
          started.push(c);
          return true;
        },
        stop: async () => true,
        whoIsTyping: async () => [] as string[],
      },
    });
    const socket = await connected(gw, s.otherParentId);

    const result = await gw.typingStart(socket as never, { conversationId });

    expect(result.ok).toBe(false);
    // Refused BEFORE any state was written: a typing indicator is a broadcast
    // into a conversation, and the check has to precede the write rather than
    // filter the fan-out afterwards.
    expect(started).toEqual([]);
    expect(socket.broadcast).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

describe('presence', () => {
  let redis: Redis;
  let presence: PresenceService;

  beforeAll(() => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
    presence = new PresenceService(redis, g.config);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.del(`presence:${s.parentId}`, `lastseen:${s.parentId}`);
  });

  it('is the UNION of a person\'s devices, and only the edges are transitions', async () => {
    // First device: the 0 -> 1 transition. This is the one worth announcing.
    expect(await presence.online(s.parentId, 'phone')).toBe(true);
    expect(await presence.isOnline(s.parentId)).toBe(true);

    // Second device: still online, NOT a transition. Announcing this would fan
    // an event out to every conversation on every reconnect of every device.
    expect(await presence.online(s.parentId, 'tablet')).toBe(false);
    expect(await presence.connectionCount(s.parentId)).toBe(2);

    // Closing one is not going offline. This is the case that made a naive
    // implementation announce somebody as away while they were reading on the
    // other device.
    expect(await presence.offline(s.parentId, 'phone')).toBe(false);
    expect(await presence.isOnline(s.parentId)).toBe(true);

    // Closing the last one is.
    expect(await presence.offline(s.parentId, 'tablet')).toBe(true);
    expect(await presence.isOnline(s.parentId)).toBe(false);
  });

  it('a heartbeat refreshes rather than re-announcing', async () => {
    expect(await presence.online(s.parentId, 'phone')).toBe(true);
    await presence.heartbeat(s.parentId, 'phone');
    expect(await presence.connectionCount(s.parentId)).toBe(1);
    expect(await presence.online(s.parentId, 'phone')).toBe(false);
  });

  it('an abandoned connection expires instead of leaving somebody online forever', async () => {
    await presence.online(s.parentId, 'ghost');
    expect(await presence.isOnline(s.parentId)).toBe(true);

    // The connection that never sent a disconnect: the process was killed, the
    // phone went into a tunnel, the container was evicted. Its entry's expiry
    // is reached -- expressed here by moving the score into the past rather
    // than by sleeping through the TTL.
    await redis.zadd(`presence:${s.parentId}`, Date.now() - 1000, 'ghost');

    expect(await presence.isOnline(s.parentId)).toBe(false);
    expect(await presence.connectionCount(s.parentId)).toBe(0);
  });

  it('records a last-seen time even for somebody who is offline', async () => {
    await presence.online(s.parentId, 'phone');
    await presence.offline(s.parentId, 'phone');

    const seen = await presence.lastSeen(s.parentId);
    expect(seen).toBeInstanceOf(Date);
    expect(Date.now() - (seen as Date).getTime()).toBeLessThan(10_000);
  });

  it('the gateway announces the transition to the conversations the actor is IN', async () => {
    const gw = gateway({
      presence: {
        online: async () => true,
        offline: async () => true,
        heartbeat: async () => undefined,
        lastSeen: async () => new Date(),
      },
    });
    const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
    // The server-side broadcast surface, which is what a room emit goes through.
    (gw as unknown as { server: unknown }).server = {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => emitted.push({ room, event, payload }),
      }),
    };

    await connected(gw, s.parentId);

    const presenceEvents = emitted.filter((e) => e.event === CommEvent.PRESENCE_CHANGED);
    expect(presenceEvents.length).toBeGreaterThan(0);
    expect(presenceEvents.map((e) => e.room)).toContain(`conversation:${conversationId}`);
    expect(presenceEvents[0].payload).toMatchObject({ actorId: s.parentId, state: 'online' });
  });
});

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

describe('typing', () => {
  let redis: Redis;
  let typing: TypingService;
  let otherConversationId: string;

  beforeAll(() => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
    typing = new TypingService(redis, g.config);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    otherConversationId = (await g.conversations.getOrCreateDirect(s.otherAdminId, s.teacherId)).id;
    await redis.del(`typing:${conversationId}`, `typing:${otherConversationId}`);
  });

  it('debounces: a repeat ping inside the window only refreshes', async () => {
    // The first is worth broadcasting; the next forty keystrokes are not.
    expect(await typing.start(conversationId, s.parentId)).toBe(true);
    expect(await typing.start(conversationId, s.parentId)).toBe(false);
    expect(await typing.start(conversationId, s.parentId)).toBe(false);
    expect(await typing.whoIsTyping(conversationId)).toEqual([s.parentId]);
  });

  it('does not leak across conversations', async () => {
    await typing.start(conversationId, s.parentId);
    await typing.start(otherConversationId, s.teacherId);

    expect(await typing.whoIsTyping(conversationId)).toEqual([s.parentId]);
    expect(await typing.whoIsTyping(otherConversationId)).toEqual([s.teacherId]);
  });

  it('has no permanent typing state: an entry that lapses is gone from the next read', async () => {
    await typing.start(conversationId, s.parentId);
    // The client that vanished mid-word. No stop frame will ever arrive.
    await redis.zadd(`typing:${conversationId}`, Date.now() - 1000, s.parentId);

    expect(await typing.whoIsTyping(conversationId)).toEqual([]);
    // And starting again after a lapse reads as NEW, or the indicator would
    // never reappear for somebody who paused longer than the window.
    expect(await typing.start(conversationId, s.parentId)).toBe(true);
  });

  it('tolerates a duplicate stop', async () => {
    await typing.start(conversationId, s.parentId);
    expect(await typing.stop(conversationId, s.parentId)).toBe(true);
    // The second is silent rather than a second TYPING_STOPPED broadcast.
    expect(await typing.stop(conversationId, s.parentId)).toBe(false);
    expect(await typing.whoIsTyping(conversationId)).toEqual([]);
  });

  it('leaving a conversation clears the indicator rather than waiting for it to lapse', async () => {
    const stopped: Array<[string, string]> = [];
    const gw = gateway({
      typing: {
        start: async () => true,
        stop: async (c: string, a: string) => {
          stopped.push([c, a]);
          return true;
        },
        whoIsTyping: async () => [] as string[],
      },
    });
    const socket = await connected(gw, s.parentId);
    await gw.subscribe(socket as never, { conversationId });

    await gw.unsubscribe(socket as never, { conversationId });

    expect(stopped).toEqual([[conversationId, s.parentId]]);
    expect(socket.broadcast.map((b) => b.event)).toContain(CommEvent.TYPING_STOPPED);
    expect(socket.rooms.has(`conversation:${conversationId}`)).toBe(false);
  });
});
