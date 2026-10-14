import { Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthorizationService } from '../../platform/authorization.service';
import { Actor } from '../../platform/types';
import {
  CommEvent,
  CommEventName,
  CommEventPayloads,
  CONVERSATION_ACCESS_REVOKED,
  room,
} from '../contracts/events';
import { RealtimePublisher } from './realtime.publisher';
import { TypingService } from './typing.service';
import { PresenceService } from './presence.service';
import { MessageService } from '../messages/message.service';
import { ConversationService } from '../conversations/conversation.service';
import { ReceiptState } from '../contracts/vocab';
import { AuthService } from '../../platform/auth/auth.service';
import { bearerToken } from '../../platform/auth/auth.guard';
import {
  RealtimeRevocationHub,
  RevocationUnconfirmedError,
  type RealtimeRevocation,
} from '../../platform/realtime-revocation';

/**
 * RT-009: how often every open socket is re-validated. Bounds how long a change
 * no API call announces (a deactivation, a `can_message` withdrawal, a role
 * change, a removal made by sync) can keep a socket connected or in a room.
 */
export const REALTIME_REVALIDATE_INTERVAL_MS = 15_000;

/** Server-to-server events: "deliver this to YOUR sockets, after YOUR check". */
const NODE_THREAD = 'rt009:deliver-thread';
const NODE_USERS = 'rt009:deliver-users';

/**
 * RT-009 COMPLETION BARRIER -- why the row locks are not enough on their own.
 *
 * A delivery decides under row locks and proves they are still held
 * (`stillHeld`) just before it emits. But the database can only vouch for the
 * moment it answered: if the connection is lost, or Prisma's timer rolls the
 * transaction back, AFTER that answer, the locks are released, a revocation
 * commits without waiting, and the decision is still in hand. Emits cannot be
 * part of a transaction, so no database lock can close that window.
 *
 * The node's own event loop can. Every node keeps a FENCE GENERATION. A
 * delivery takes it before reading anything and, after its last await, emits
 * only if it is unchanged -- synchronously, with no await until the last emit.
 * A revoking operation, after it commits, bumps the generation on every node
 * (`confirmRevoked`) and returns success only when each one has acknowledged.
 * A node acknowledges from a handler that bumps first and acks second, on the
 * same single thread as its deliveries: so either a delivery's emits completed
 * before that node acknowledged -- before the revocation could return -- or
 * the acknowledgement came first and the delivery's check refuses to emit. A
 * refused delivery is re-decided from scratch against the committed state.
 *
 * Which nodes must acknowledge comes from a registry of LEASES in Redis, not
 * from who happens to be subscribed: a node partitioned from Redis is still in
 * the registry until its lease runs out, so it cannot be silently skipped. A
 * node delivers only while it holds its own lease, with a margin, and a gap in
 * its lease voids every decision made before it.
 *
 * An EXPIRED lease is not proof that a node has stopped: a node suspended
 * between its final check and its emits (GC, SIGSTOP, a frozen container)
 * renews nothing, yet resumes mid-emit. So a revoker leaves an expired node
 * out only when that node's own Redis connection (named per node) is gone
 * too -- a suspended process keeps its TCP connections; a dead one does not.
 * This also makes an early expiry (a Redis clock jump) harmless for every
 * connected node. And a registry Redis has LOST (restart without persistence,
 * flush, eviction, failover) cannot vouch for who is missing from it, so a
 * registry younger than one lease is not trusted at all.
 */
const NODE_FENCE = 'rt009:fence';

/** A node's registration lives this long in Redis unless renewed. */
export const NODE_LEASE_MS = 30_000;
/**
 * A node stops delivering this long BEFORE its registration can expire, so a
 * revoker that no longer sees the node is never racing a node that still
 * thinks it may deliver. See the report's assumptions for what this bounds.
 */
export const NODE_LEASE_MARGIN_MS = 10_000;
export const NODE_LEASE_RENEW_MS = 5_000;
/** Each step of a confirmation; on expiry the revocation is NOT confirmed. */
const FENCE_STEP_TIMEOUT_MS = 6_000;
/** A delivery superseded this many times in a row is dropped (fail closed). */
const DELIVERY_ATTEMPTS = 3;

/** The registry's own field: when Redis (re)created it, on Redis's clock. Never a node uid. */
const REGISTRY_CREATED = '@created';
/** Each node names its Redis command connection after itself, so a revoker can see it is alive. */
const NODE_CONNECTION_PREFIX = 'rt009-node:';

/** Renew this node's lease, on Redis's clock. KEYS[1] registry; ARGV uid, ttl ms. */
const RENEW_LEASE = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('HSETNX', KEYS[1], '${REGISTRY_CREATED}', now)
redis.call('HSET', KEYS[1], ARGV[1], now + tonumber(ARGV[2]))
return 1`;
/** Redis's time and the whole registry, in one atomic read. */
const READ_REGISTRY = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
return { now, redis.call('HGETALL', KEYS[1]) }`;
/** Drop a node's entry only if it is STILL expired -- never one renewed meanwhile. ARGV uid. */
const PRUNE_IF_EXPIRED = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local v = redis.call('HGET', KEYS[1], ARGV[1])
if v and tonumber(v) <= now then redis.call('HDEL', KEYS[1], ARGV[1]) return 1 end
return 0`;

/** What the barrier needs from the Redis adapter (present on @socket.io/redis-adapter). */
interface ClusterAdapter {
  readonly uid: string;
  readonly channel: string;
  readonly pubClient: {
    eval(script: string, keys: number, ...args: string[]): Promise<unknown>;
    hdel(key: string, field: string): Promise<unknown>;
    client(subcommand: string, ...args: string[]): Promise<unknown>;
  };
}

/** Scoped like the adapter's own channels: exactly the nodes that can fence each other. */
const registryKey = (c: ClusterAdapter) => `${c.channel}rt009-nodes`;

/** `p`, or a rejection once `ms` have passed -- never a silent success. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no answer within ${ms} ms`)), ms);
  });
  return Promise.race([p, expiry]).finally(() => clearTimeout(timer));
}

/**
 * One delivery at a time per node: each holds a short row-locking transaction
 * (see ConversationService.withDeliveryLocks), and a single queue bounds that to
 * one connection and preserves event order.
 */
const DELIVERY_QUEUE = 'delivery';

/** The rows a revocation of any of these sockets' recipients would UPDATE. */
function lockScopeOf(sockets: readonly AuthedSocket[], conversationId?: string) {
  const known = sockets.filter((s) => s.actor && s.accountId);
  const byKind = (kind: string) => known.filter((s) => s.actor?.kind === kind).map((s) => s.actor!.actorId);
  return {
    conversationId,
    actorIds: known.map((s) => s.actor!.actorId),
    sessionIds: known.flatMap((s) => sessionIdsOf(s)),
    accountIds: known.map((s) => s.accountId!),
    contactIds: byKind('contact'),
    staffIds: byKind('staff'),
    teacherIds: byKind('teacher'),
  };
}

/** The sessions a socket answers to: the one it connected with, plus rotated successors. */
function sessionIdsOf(client: { rooms: Iterable<string> }): string[] {
  const prefix = room.session('');
  return [...client.rooms].filter((r) => r.startsWith(prefix)).map((r) => r.slice(prefix.length));
}

interface AuthedSocket extends Socket {
  /** Written ONLY by handleConnection, ONLY from a verified token. */
  actor?: Actor;
  accountId?: string;
  sessionId?: string;
}

/**
 * The token, from the handshake.
 *
 * `auth: { token }` is the contracted position (API-CONTRACT section 1,
 * "WebSocket: socket.io handshake auth: { token } on the default namespace").
 * The Authorization header is accepted as well because some socket.io clients
 * cannot set `auth` on a reconnect, and a client that falls back to the header
 * should not silently become unauthenticated.
 *
 * Everything else in the handshake is data, not identity. In particular
 * `auth.actorId` -- the old seam -- is not read here or anywhere else.
 */
function handshakeToken(client: Socket): string | null {
  const fromAuth = (client.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0 && fromAuth === fromAuth.trim()) {
    return fromAuth;
  }
  return bearerToken(client.handshake.headers?.authorization);
}

/**
 * Socket.IO gateway. Horizontal scaling uses the Redis adapter (wired in main.ts),
 * so a message sent on one node reaches sockets held by every other node.
 *
 * AUTHENTICATION: the handshake carries a bearer token and nothing else that
 * matters. It is verified by AuthService.authenticate() -- the same method the
 * HTTP guard uses -- and the resolved Actor is the socket's identity for its
 * lifetime. `handshake.auth.actorId`, the pre-PR-B seam, is not read.
 *
 * AUTHORIZATION: a client never joins a room by naming it. It asks to subscribe
 * to a conversationId, the server runs the same AuthorizationService the REST
 * path uses, and only then joins. Guessing or forging a room name gains nothing.
 */
@WebSocketGateway({ cors: { origin: false } })
export class RealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy,
    RealtimePublisher,
    RealtimeRevocation
{
  private readonly log = new Logger(RealtimeGateway.name);
  private sweep?: ReturnType<typeof setInterval>;
  private sweeping = false;
  private readonly queues = new Map<string, Promise<void>>();

  // RT-009 completion barrier (see NODE_FENCE).
  private fenceGeneration = 0;
  /** performance.now() until which this node may deliver (cluster only). */
  private leaseValidUntil = 0;
  private leaseTimer?: ReturnType<typeof setInterval>;
  private renewing = false;
  private closed = false;
  private lastNoLeaseLog = 0;
  /** Lease timings; a test may shorten them. */
  leaseMs = NODE_LEASE_MS;
  leaseMarginMs = NODE_LEASE_MARGIN_MS;

  /**
   * TEST SEAM ONLY -- undefined in production. Awaited after a delivery has
   * DECIDED its recipients and before it EMITS, so a test can hold a delivery
   * at exactly that point and race a revocation against it.
   */
  deliveryBarrier?: () => Promise<void>;

  /**
   * TEST SEAM ONLY -- undefined in production, and then not even awaited.
   * Runs AFTER the final transaction-liveness check, so a test can hold a
   * delivery inside the window a lost connection or a transaction timeout can
   * open once the database can no longer vouch for the decision.
   */
  afterLivenessCheck?: () => Promise<void>;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly typing: TypingService,
    private readonly presence: PresenceService,
    private readonly messages: MessageService,
    // IDENTITY_SERVICE is deliberately NOT injected any more. It was here only
    // to resolve the actor the client named; AuthService now resolves the actor
    // from the token, and leaving a second way to obtain an Actor in this class
    // is how the old path would find its way back.
    private readonly auth: AuthService,
    // RT-009. Optional only so a test can build the gateway without the module;
    // in the application PlatformModule always provides it.
    @Optional() private readonly revocationHub?: RealtimeRevocationHub,
  ) {}

  /**
   * RT-009. Once Socket.IO has a server, revocations decided elsewhere are
   * carried out here, and every open socket is re-validated on an interval.
   */
  afterInit(): void {
    this.revocationHub?.attach(this);
    // Deliveries forwarded by another node are authorized HERE, against this
    // node's sockets -- never trusted because a peer already checked its own.
    const server = this.server as unknown as { on(event: string, fn: (...a: never[]) => void): void };
    server.on(NODE_THREAD, (conversationId: string, event: string, payload: unknown, except?: string) =>
      void this.deliverToConversationLocally(conversationId, event, payload, except));
    server.on(NODE_USERS, (actorIds: string[], event: string, payload: unknown) =>
      void this.deliverToActorsLocally(actorIds, event, payload));
    // The completion barrier's acknowledgement: fence FIRST, then answer --
    // synchronously, so no delivery of this node can sit between the two.
    server.on(NODE_FENCE, (ack: (uid: string) => void) => {
      this.fenceGeneration++;
      ack(this.cluster()?.uid ?? '');
    });
    this.startRevalidation(REALTIME_REVALIDATE_INTERVAL_MS);
    this.startLease(NODE_LEASE_RENEW_MS);
  }

  /** RT-009. (Re)starts the periodic re-validation; a test may shorten it. */
  startRevalidation(intervalMs: number): void {
    if (this.sweep) clearInterval(this.sweep);
    this.sweep = setInterval(() => void this.revalidateConnections(), intervalMs);
    this.sweep.unref?.();
  }

  /** RT-009. (Re)starts lease renewal -- a cluster node delivers only while it holds one. */
  startLease(intervalMs: number): void {
    this.stopLease();
    if (!this.cluster()) return;
    void this.renewLease();
    this.leaseTimer = setInterval(() => void this.renewLease(), intervalMs);
    this.leaseTimer.unref?.();
  }

  /** Stops renewing; the lease then runs out and this node stops delivering. */
  stopLease(): void {
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    this.leaseTimer = undefined;
  }

  /** Whether this node may deliver at this moment (it holds its lease, or is the only node). */
  canDeliver(): boolean {
    return this.deliveryPermit() !== null;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweep) clearInterval(this.sweep);
    // Fence first, then leave the registry: nothing decided before this line
    // is emitted, so a revoker that no longer counts this node is right not to.
    this.closed = true;
    this.fenceGeneration++;
    this.stopLease();
    const cluster = this.cluster();
    if (cluster) await this.deregister(cluster);
  }

  private cluster(): ClusterAdapter | null {
    const adapter = this.server?.of('/').adapter as unknown as
      | (ClusterAdapter & { constructor?: { name?: string } })
      | undefined;
    // The in-memory `Adapter` is one node: nothing else can deliver.
    if (!adapter || adapter.constructor?.name === 'Adapter') return null;
    return adapter;
  }

  private async renewLease(): Promise<void> {
    const cluster = this.cluster();
    if (!cluster || this.renewing || this.closed) return;
    this.renewing = true;
    const sentAt = performance.now();
    try {
      await within(
        (async () => {
          // Named on every renewal (a reconnect drops the name): this is what a
          // revoker looks for before it may leave this node out.
          await cluster.pubClient.client('SETNAME', `${NODE_CONNECTION_PREFIX}${cluster.uid}`);
          await cluster.pubClient.eval(RENEW_LEASE, 1, registryKey(cluster), cluster.uid, String(this.leaseMs));
        })(),
        FENCE_STEP_TIMEOUT_MS,
        'lease renewal',
      );
    } catch (e) {
      this.log.warn(`realtime lease not renewed; this node stops delivering when it runs out: ${(e as Error).message}`);
      return;
    } finally {
      this.renewing = false;
    }
    if (this.closed) {
      await this.deregister(cluster);
      return;
    }
    // Answered after the previous lease ran out: the registration may have
    // lapsed in between, and a revoker that read the registry then did not ask
    // this node. Void every decision made before now.
    if (performance.now() >= this.leaseValidUntil) this.fenceGeneration++;
    this.leaseValidUntil = sentAt + this.leaseMs - this.leaseMarginMs;
  }

  private async deregister(cluster: ClusterAdapter): Promise<void> {
    try {
      await within(cluster.pubClient.hdel(registryKey(cluster), cluster.uid), FENCE_STEP_TIMEOUT_MS, 'deregistration');
    } catch {
      /* the registration expires with its lease */
    }
  }

  /** The generation a delivery decides under, or null when this node may not deliver at all. */
  private deliveryPermit(): number | null {
    if (this.closed) return null;
    if (this.cluster() && performance.now() >= this.leaseValidUntil) return null;
    return this.fenceGeneration;
  }

  /**
   * RT-009 completion barrier, delivery side. `attempt` runs under a permit
   * taken BEFORE it reads anything, and must call `permitted()` after its
   * last await and emit only if it returns true. A fence since then -- a
   * revocation anywhere, a gap in this node's lease -- makes it false: the
   * attempt emits nothing and is re-decided from scratch, against the state
   * the revocation committed. Bounded; past the bound the event is dropped.
   */
  private async fenced(attempt: (permitted: () => boolean) => Promise<void>): Promise<void> {
    for (let i = 0; i < DELIVERY_ATTEMPTS; i++) {
      const permit = this.deliveryPermit();
      if (permit === null) {
        if (performance.now() - this.lastNoLeaseLog > 10_000) {
          this.lastNoLeaseLog = performance.now();
          this.log.warn('this node holds no realtime lease; deliveries are refused until it does');
        }
        return;
      }
      let superseded = false;
      const permitted = () => {
        superseded = this.deliveryPermit() !== permit;
        return !superseded;
      };
      try {
        await attempt(permitted);
      } catch (e) {
        // Superseded, and then its transaction failed to commit -- typically
        // the lost connection that let the revocation through. Nothing was
        // emitted; re-decide.
        if (!superseded) throw e;
      }
      if (!superseded) return;
    }
    this.log.error('a delivery was superseded on every attempt and was dropped (fail closed)');
  }

  /**
   * RT-001 CLOSED (2026-09-23). Identity comes from a verified token and from
   * nothing else.
   *
   * This used to read `handshake.auth.actorId` and resolve it verbatim, so any
   * caller who could reach the socket could name any active actor and receive
   * that actor's conversation traffic, call events and presence. PR-B closed
   * the HTTP half of that seam; this closes the WebSocket half, and with it the
   * boot restriction that kept such a build out of production.
   *
   * ONE IMPLEMENTATION, NOT TWO. `AuthService.authenticate()` is the same
   * method the global AuthenticatedGuard calls for every HTTP request: same
   * signature verification, same session lookup, same revocation check, same
   * account-status check, same token-claims-versus-database reconciliation. A
   * second verifier written for sockets is a second thing to get wrong, and the
   * two would drift the first time either changed.
   *
   * WHO, NOT WHAT. This method answers "who is this actor?" and stops there.
   * What the actor may do stays with AuthorizationService, which `subscribe`
   * below consults with the same rules the REST path uses.
   */
  async handleConnection(client: AuthedSocket): Promise<void> {
    const token = handshakeToken(client);
    if (!token) {
      // No credential is a refusal, not an anonymous connection. A socket that
      // connects without identity has no room it could legitimately join.
      client.disconnect(true);
      return;
    }

    const authenticated = await this.auth.authenticate(token);
    if (!authenticated || !authenticated.actor.isActive) {
      client.disconnect(true);
      return;
    }

    client.actor = authenticated.actor;
    client.accountId = authenticated.accountId;
    client.sessionId = authenticated.sessionId;

    // Every socket joins its own actor room, so multi-device fan-out is free.
    // The room is named from the RESOLVED actor, never from anything the client
    // sent, so a forged handshake field cannot place a socket in another
    // actor's room.
    await client.join(room.actor(authenticated.actor.actorId));
    // RT-009: addressable for revocation -- by session (logout) and by account
    // (refresh-token reuse revokes every session).
    await client.join(room.session(authenticated.sessionId));
    await client.join(room.account(authenticated.accountId));
    await this.presence.online(authenticated.actor.actorId, client.id);
  }

  async handleDisconnect(client: AuthedSocket): Promise<void> {
    if (!client.actor) return;
    await this.presence.offline(client.actor.actorId, client.id);
  }

  @SubscribeMessage('conversation.subscribe')
  async subscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean; code?: string }> {
    if (!body?.conversationId) return { ok: false, code: 'COMM.UNKNOWN_ACTOR' };
    // RT-009: decided on the actor as it is NOW, never on the one cached at
    // connect time. An identity that is no longer entitled is disconnected.
    const actor = await this.currentActor(client);
    if (!actor) return { ok: false, code: 'COMM.UNKNOWN_ACTOR' };

    const check = await this.authorize(actor, body.conversationId);
    if (!check.ok) return check;

    const name = room.conversation(body.conversationId);
    await client.join(name);
    // RT-009: re-check AFTER joining, so a revocation that committed between
    // the first check and the join does not leave a stale room entry. Room
    // hygiene only: delivery is authorized per recipient at delivery time
    // (deliverToConversationLocally), so a stale entry would receive nothing.
    const recheck = await this.authorize(actor, body.conversationId);
    if (!recheck.ok) {
      await client.leave(name);
      return recheck;
    }
    return { ok: true };
  }

  @SubscribeMessage('conversation.unsubscribe')
  async unsubscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.conversationId) return { ok: false };
    await client.leave(room.conversation(body.conversationId));
    return { ok: true };
  }

  @SubscribeMessage('typing.start')
  async typingStart(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.conversationId) return { ok: false };
    const actor = await this.currentActor(client);
    if (!actor) return { ok: false };
    if (!(await this.authorize(actor, body.conversationId)).ok) return { ok: false };

    // Server-side debounce: a repeat ping inside the TTL only refreshes the key,
    // so a chatty client cannot amplify fan-out.
    if (await this.typing.start(body.conversationId, actor.actorId)) {
      // RT-009: authorized per recipient at delivery, like every thread event.
      await this.deliverToConversation(
        body.conversationId,
        CommEvent.TYPING_STARTED,
        { conversationId: body.conversationId, actorId: actor.actorId, displayName: actor.displayName },
        client.id,
      );
    }
    return { ok: true };
  }

  @SubscribeMessage('typing.stop')
  async typingStop(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.conversationId) return { ok: false };
    // RT-009: `client.to(room)` reaches the room whether or not the sender is
    // in it, so this was a broadcast with no authorization at all.
    const actor = await this.currentActor(client);
    if (!actor) return { ok: false };
    if (!(await this.authorize(actor, body.conversationId)).ok) return { ok: false };
    if (await this.typing.stop(body.conversationId, actor.actorId)) {
      // RT-009: authorized per recipient at delivery, like every thread event.
      await this.deliverToConversation(
        body.conversationId,
        CommEvent.TYPING_STOPPED,
        { conversationId: body.conversationId, actorId: actor.actorId, displayName: actor.displayName },
        client.id,
      );
    }
    return { ok: true };
  }

  @SubscribeMessage('presence.heartbeat')
  async heartbeat(@ConnectedSocket() client: AuthedSocket): Promise<{ ok: boolean }> {
    if (!client.actor) return { ok: false };
    await this.presence.heartbeat(client.actor.actorId, client.id);
    return { ok: true };
  }

  /** The client confirms it has the message on device. */
  @SubscribeMessage('message.delivered')
  async delivered(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { messageIds?: string[] },
  ): Promise<{ ok: boolean; updated: number }> {
    const actor = client.actor;
    if (!actor || !body?.messageIds?.length) return { ok: false, updated: 0 };
    // Scoped to this actor's own receipt rows; a client cannot acknowledge for
    // somebody else.
    const updated = await this.messages.markState(
      body.messageIds,
      actor.actorId,
      ReceiptState.DELIVERED,
    );
    return { ok: true, updated };
  }

  /**
   * RT-009. The socket's identity as it stands NOW, re-read through
   * AuthService's gates (session-precise); the cached actor is refreshed with
   * it. An identity no longer entitled to a connection is disconnected and null
   * is returned. Fails closed: an error is a disconnect.
   */
  private async currentActor(client: AuthedSocket): Promise<Actor | null> {
    // Not authenticated YET: a client sees `connect` before handleConnection
    // has finished, and may subscribe in that window. Refuse the frame as
    // before, without disconnecting -- a mobile client treats a server
    // disconnect as "unauthorized" and would churn.
    if (!client.actor || !client.accountId) return null;
    const [fresh] = await this.liveIdentities([client]);
    if (!fresh) {
      client.disconnect(true);
      return null;
    }
    client.actor = fresh;
    return fresh;
  }

  /** The current actor for each socket (session-precise), or null. Fails closed. */
  private async liveIdentities(sockets: readonly AuthedSocket[]): Promise<Array<Actor | null>> {
    const asked = sockets.map((s) =>
      s.actor && s.accountId
        ? { accountId: s.accountId, sessionIds: sessionIdsOf(s), actorId: s.actor.actorId, kind: s.actor.kind }
        : null,
    );
    const known = asked.filter((a): a is NonNullable<typeof a> => a !== null);
    let answers: Array<Actor | null> = [];
    try {
      answers = known.length ? await this.auth.revalidateRealtime(known) : [];
    } catch (e) {
      this.log.error(`realtime re-validation failed; refusing delivery: ${(e as Error).name}`);
      return sockets.map(() => null);
    }
    let i = 0;
    return asked.map((a) => (a ? (answers[i++] ?? null) : null));
  }

  /** Sockets on THIS node in any of these rooms. */
  private localSocketsIn(rooms: readonly string[]): AuthedSocket[] {
    if (!this.server) return [];
    const nsp = this.server.of('/');
    const ids = new Set<string>();
    for (const r of rooms) for (const id of nsp.adapter.rooms.get(r) ?? []) ids.add(id);
    return [...ids].map((id) => nsp.sockets.get(id)).filter((x): x is AuthedSocket => !!x);
  }

  /**
   * One delivery at a time per key on this node, so the per-check awaits below
   * can never reorder two events of the same conversation.
   */
  private serialize(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(task).catch((e) => {
      this.log.error(`realtime delivery failed (${key}): ${(e as Error).name}`);
    });
    this.queues.set(key, next);
    void next.then(() => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    });
    return next;
  }

  /**
   * RT-009 -- THE delivery control. Every protected conversation event this
   * node hands to a socket passes here, and is decided per recipient at the
   * moment of delivery, against the database:
   *   - the conversation's LIVE membership, read now;
   *   - the recipient's identity, re-read session-precisely (AuthService);
   *   - AuthorizationService.canRead on that fresh actor.
   * A recipient that fails receives nothing: it leaves the room and is told,
   * or, if its identity is gone, is disconnected. So once a revocation has
   * COMMITTED, no node delivers to the revoked socket -- whether or not any
   * eviction message ever reached that node. Room membership is an index of
   * who to ASK, never the authorization itself.
   */
  async deliverToConversationLocally(
    conversationId: string,
    event: string,
    payload: unknown,
    exceptSocketId?: string,
  ): Promise<void> {
    const name = room.conversation(conversationId);
    await this.serialize(DELIVERY_QUEUE, () => this.fenced(async (permitted) => {
      const sockets = this.localSocketsIn([name]).filter((x) => x.id !== exceptSocketId);
      if (sockets.length === 0) return;
      await this.conversations.withDeliveryLocks(lockScopeOf(sockets, conversationId), async (stillHeld) => {
        let conv: Awaited<ReturnType<ConversationService['requireConversation']>>;
        try {
          conv = await this.conversations.requireConversation(conversationId);
        } catch {
          return; // no conversation, no delivery
        }
        const actors = await this.liveIdentities(sockets);
        const members = await this.conversations.liveMembershipsOf(
          conv.id,
          actors.filter((a): a is Actor => !!a).map((a) => a.actorId),
        );
        const allowed = sockets.map((socket, i) => {
          const actor = actors[i];
          return !!actor && this.authz.canRead(actor, conv, members.get(actor.actorId) ?? null).allowed;
        });
        await this.deliveryBarrier?.();
        // Must be the last await before the emits: proves the locks are still
        // held, so no revocation of these rows can have completed.
        await stillHeld();
        if (this.afterLivenessCheck) await this.afterLivenessCheck();
        // The completion barrier. No await from here to the last emit: this
        // node acknowledges a revocation only between turns of its event loop,
        // so either these emits finish first, or the fence already voided them.
        if (!permitted()) return;
        sockets.forEach((socket, i) => {
          const actor = actors[i];
          if (!actor) {
            socket.disconnect(true);
            return;
          }
          socket.actor = actor;
          if (allowed[i]) {
            socket.emit(event, payload);
            return;
          }
          void socket.leave(name);
          socket.emit(CONVERSATION_ACCESS_REVOKED, { conversationId });
        });
      });
    }));
  }

  /**
   * RT-009. Actor-addressed events (calls, approvals, stories) go only to
   * sockets whose identity is still live, session-precisely. WHICH actors is
   * decided by the caller (call participants, story recipients) and is not
   * re-decided here.
   */
  async deliverToActorsLocally(actorIds: readonly string[], event: string, payload: unknown): Promise<void> {
    await this.serialize(DELIVERY_QUEUE, () => this.fenced(async (permitted) => {
      const sockets = this.localSocketsIn(actorIds.map(room.actor));
      if (sockets.length === 0) return;
      await this.conversations.withDeliveryLocks(lockScopeOf(sockets), async (stillHeld) => {
        const actors = await this.liveIdentities(sockets);
        await this.deliveryBarrier?.();
        await stillHeld(); // the last await before the emits (see above)
        if (this.afterLivenessCheck) await this.afterLivenessCheck();
        if (!permitted()) return; // the completion barrier (see above)
        sockets.forEach((socket, i) => {
          const actor = actors[i];
          if (!actor || !actorIds.includes(actor.actorId)) {
            socket.disconnect(true);
            return;
          }
          socket.actor = actor;
          socket.emit(event, payload);
        });
      });
    }));
  }

  /** Local, then every other node -- each authorizing its own sockets. */
  private async deliverToConversation(
    conversationId: string,
    event: string,
    payload: unknown,
    exceptSocketId?: string,
  ): Promise<void> {
    await this.deliverToConversationLocally(conversationId, event, payload, exceptSocketId);
    this.toOtherNodes(NODE_THREAD, conversationId, event, payload, exceptSocketId);
  }

  /**
   * Only a cluster adapter has other nodes; the in-memory adapter (one node)
   * does not support server-side emits at all, and needs none.
   */
  private toOtherNodes(event: string, ...args: unknown[]): void {
    // The base in-memory `Adapter` (one node) throws on serverSideEmit -- and,
    // like every adapter, it HAS serverCount(), so that is not the test.
    const adapter = this.server?.of('/').adapter as unknown as { constructor?: { name?: string } } | undefined;
    if (!this.server || !adapter || adapter.constructor?.name === 'Adapter') return;
    try {
      (this.server as unknown as { serverSideEmit(e: string, ...a: unknown[]): void }).serverSideEmit(event, ...args);
    } catch (e) {
      this.log.error(`could not forward a delivery to other nodes: ${(e as Error).name}`);
    }
  }

  /**
   * RT-009. Re-validate every socket THIS node holds: disconnect identities no
   * longer entitled to a connection, and remove every socket from each
   * conversation room it may no longer read. Hygiene and a bound on how long a
   * dead identity HOLDS a connection -- delivery itself is already decided per
   * event above. Runs on an interval; a test may also call it. Never overlaps.
   */
  async revalidateConnections(): Promise<void> {
    if (this.sweeping || !this.server) return;
    this.sweeping = true;
    try {
      const sockets = [...this.server.of('/').sockets.values()] as AuthedSocket[];
      const actors = await this.liveIdentities(sockets);
      for (let i = 0; i < sockets.length; i++) {
        const client = sockets[i];
        const actor = actors[i];
        if (!client.actor) continue; // still authenticating
        if (!actor) {
          client.disconnect(true);
          continue;
        }
        client.actor = actor;
        const prefix = room.conversation('');
        for (const joined of [...client.rooms]) {
          if (!joined.startsWith(prefix)) continue;
          const conversationId = joined.slice(prefix.length);
          if ((await this.authorize(actor, conversationId)).ok) continue;
          await client.leave(joined);
          client.emit(CONVERSATION_ACCESS_REVOKED, { conversationId });
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  // --- RealtimeRevocation (RT-009) ---
  // Cleanup and prompt client notice. Through `this.server`, so the Redis
  // adapter carries each to every node -- but NONE of these is what denies
  // delivery: `deliverToConversationLocally` decides that, per event.

  leaveConversation(actorIds: readonly string[], conversationId: string): void {
    if (!this.server || actorIds.length === 0) return;
    const actorRooms = actorIds.map(room.actor);
    this.server.in(actorRooms).socketsLeave(room.conversation(conversationId));
    this.server.to(actorRooms).emit(CONVERSATION_ACCESS_REVOKED, { conversationId });
  }

  disconnectSessions(sessionIds: readonly string[]): void {
    if (!this.server || sessionIds.length === 0) return;
    this.server.in(sessionIds.map(room.session)).disconnectSockets(true);
  }

  disconnectAccount(accountId: string): void {
    this.server?.in(room.account(accountId)).disconnectSockets(true);
  }

  /**
   * A refresh rotated a session: its sockets also answer to the successor, so
   * session-precise checks keep accepting them and a later logout of the
   * successor reaches them. If this does not reach a node, that node's checks
   * see only the retired session and refuse -- fail closed (the client
   * reconnects with its new token).
   */
  sessionRotated(from: string, to: string): void {
    this.server?.in(room.session(from)).socketsJoin(room.session(to));
  }

  /**
   * Every node that may still be able to emit: each live lease, and each
   * EXPIRED lease whose node still holds its Redis connection (it may be
   * suspended mid-emit). Only a node that is both expired and disconnected is
   * left out -- and its entry pruned, unless it renewed meanwhile.
   */
  private async nodesThatMustAcknowledge(cluster: ClusterAdapter): Promise<string[]> {
    const key = registryKey(cluster);
    const [now, flat] = (await cluster.pubClient.eval(READ_REGISTRY, 1, key)) as [number, string[]];
    const entries = new Map<string, number>();
    for (let i = 0; i + 1 < flat.length; i += 2) entries.set(flat[i], Number(flat[i + 1]));
    const created = entries.get(REGISTRY_CREATED);
    entries.delete(REGISTRY_CREATED);
    // Redis lost the registry (or never had it long enough): it cannot tell
    // who is missing, until every node that could still deliver has renewed.
    if (created === undefined || Number(now) - created < this.leaseMs - this.leaseMarginMs) {
      throw new RevocationUnconfirmedError('the server registry was recently created');
    }
    const expected: string[] = [];
    const expired: string[] = [];
    for (const [uid, expiry] of entries) (expiry > Number(now) ? expected : expired).push(uid);
    if (expired.length === 0) return expected;
    const listing = String(await cluster.pubClient.client('LIST'));
    const connected = new Set(
      [...listing.matchAll(new RegExp(` name=${NODE_CONNECTION_PREFIX}(\\S+)`, 'g'))].map((m) => m[1]),
    );
    for (const uid of expired) {
      if (connected.has(uid)) expected.push(uid); // expired, but alive: it may be suspended mid-emit
      else await cluster.pubClient.eval(PRUNE_IF_EXPIRED, 1, key, uid);
    }
    return expected;
  }

  /**
   * THE COMPLETION BARRIER (see NODE_FENCE). Called by a revoking operation
   * after it commits. Resolves only when every node holding a live lease --
   * every node that could still emit on a decision made before the commit --
   * has fenced itself and acknowledged. Anything less throws; a wait that runs
   * out is a failure, never a success.
   */
  async confirmRevoked(): Promise<void> {
    if (!this.server) throw new RevocationUnconfirmedError('realtime server not started');
    // This node, synchronously: from this line, no decision taken before it
    // can pass its final check -- and none is between that check and its emits.
    this.fenceGeneration++;
    const cluster = this.cluster();
    if (!cluster) return; // the only node
    let expected: string[];
    let acked: string[];
    try {
      // Read AFTER the commit: a node registering later decides later too.
      expected = await within(this.nodesThatMustAcknowledge(cluster), FENCE_STEP_TIMEOUT_MS, 'node registry');
      acked = (await within(
        (this.server as unknown as { serverSideEmitWithAck(e: string): Promise<string[]> }).serverSideEmitWithAck(NODE_FENCE),
        FENCE_STEP_TIMEOUT_MS,
        'node acknowledgements',
      )) as string[];
    } catch (e) {
      if (e instanceof RevocationUnconfirmedError) throw e;
      throw new RevocationUnconfirmedError('a server did not answer in time');
    }
    const missing = expected.filter((uid) => uid !== cluster.uid && !acked.includes(uid));
    if (missing.length > 0) {
      this.log.error(`revocation not confirmed: ${missing.length} live node(s) did not acknowledge the fence`);
      throw new RevocationUnconfirmedError(`${missing.length} server(s) did not acknowledge`);
    }
  }

  private async authorize(
    actor: Actor,
    conversationId: string,
  ): Promise<{ ok: boolean; code?: string }> {
    try {
      const conv = await this.conversations.requireConversation(conversationId);
      const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
      const decision = this.authz.canRead(actor, conv, membership);
      return decision.allowed ? { ok: true } : { ok: false, code: decision.code };
    } catch {
      return { ok: false, code: 'COMM.CONVERSATION_NOT_FOUND' };
    }
  }

  // --- RealtimePublisher ---

  // RT-009: never a raw room broadcast. Each node authorizes its own sockets.

  async toThread<E extends CommEventName>(
    conversationId: string,
    event: E,
    payload: CommEventPayloads[E],
  ): Promise<void> {
    await this.deliverToConversation(conversationId, event, payload);
  }

  async toUsers<E extends CommEventName>(
    actorIds: string[],
    event: E,
    payload: CommEventPayloads[E],
  ): Promise<void> {
    if (actorIds.length === 0) return;
    await this.deliverToActorsLocally(actorIds, event, payload);
    this.toOtherNodes(NODE_USERS, actorIds, event, payload);
  }
}
