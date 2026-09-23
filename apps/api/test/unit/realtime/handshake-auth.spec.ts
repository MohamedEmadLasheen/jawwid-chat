/**
 * RT-001 CLOSED: the WebSocket handshake, behaviourally.
 *
 * `test/unit/auth/identity-seam.spec.ts` proves the SHAPE of the fix by reading
 * the source — that nothing reads `handshake.auth.actorId`, that the gateway
 * calls the shared verifier, that there is one writer of `client.actor`. That
 * is a structural guard and it cannot tell you whether the code actually
 * refuses a forged connection.
 *
 * This suite does. It drives `handleConnection` with real tokens minted by the
 * real AuthService against the same in-memory database the HTTP auth tests use,
 * and asserts what happens to the socket.
 *
 * The property under test throughout: a socket joins an actor's room only when
 * a verified token says it is that actor. Before this, any caller who could
 * reach the port could name any active actor and receive that family's
 * notifications.
 */
import { RealtimeGateway } from '@communication/realtime/realtime.gateway';
import type { AuthService } from '@platform/auth/auth.service';
import type { Actor } from '@platform/types';
import { room } from '@communication/contracts/events';
import {
  buildAuth,
  contactActor,
  FakeDb,
  FakeIdentity,
  staffActor,
  withAuthEnv,
} from '../auth/support/fake-db';

jest.setTimeout(60_000);

const PASSWORD = 'a-correct-password-1';

/** A socket, recording what the gateway did to it. */
interface FakeSocket {
  id: string;
  handshake: { auth?: Record<string, unknown>; headers?: Record<string, string> };
  actor?: Actor;
  sessionId?: string;
  joined: string[];
  disconnected: boolean;
  join(name: string): Promise<void>;
  disconnect(close: boolean): void;
}

function socket(
  handshake: { auth?: Record<string, unknown>; headers?: Record<string, string> } = {},
): FakeSocket {
  return {
    id: `socket-${Math.random().toString(36).slice(2)}`,
    handshake,
    joined: [],
    disconnected: false,
    async join(name: string) {
      this.joined.push(name);
    },
    disconnect() {
      this.disconnected = true;
    },
  };
}

describe('the handshake', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;
  let gateway: RealtimeGateway;
  let parent: Actor;
  let presenceCalls: Array<{ actorId: string; connectionId: string }>;

  beforeEach(async () => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);

    const account = await db.addAccount({ subject: 'parent-socket' }, PASSWORD);
    parent = identity.give(account.id, contactActor({ displayName: 'أم أحمد' }));

    presenceCalls = [];
    const presence = {
      online: async (actorId: string, connectionId: string) => {
        presenceCalls.push({ actorId, connectionId });
      },
      offline: async () => {},
      leaveConversation: async () => {},
    };

    gateway = new RealtimeGateway(
      {} as never, // authz — not reached on the connection path
      {} as never, // conversations
      {} as never, // typing
      presence as never,
      {} as never, // messages
      auth,
    );
  });

  async function connect(
    handshake: Parameters<typeof socket>[0],
  ): Promise<FakeSocket> {
    const client = socket(handshake);
    await gateway.handleConnection(client as never);
    return client;
  }

  // -- accepted -------------------------------------------------------------

  it('a valid token is accepted, and joins exactly that actor’s room', async () => {
    const pair = await auth.login('parent-socket', PASSWORD);
    const client = await connect({ auth: { token: pair.accessToken } });

    expect(client.disconnected).toBe(false);
    expect(client.actor?.actorId).toBe(parent.actorId);
    // One room, and it is theirs. Multi-device fan-out rides on this.
    expect(client.joined).toEqual([room.actor(parent.actorId)]);
  });

  it('records the session behind the socket, so a revocation can find it', async () => {
    const pair = await auth.login('parent-socket', PASSWORD);
    const client = await connect({ auth: { token: pair.accessToken } });

    expect(client.sessionId).toBe(pair.sessionId);
  });

  it('marks the actor present, keyed to this connection', async () => {
    const pair = await auth.login('parent-socket', PASSWORD);
    const client = await connect({ auth: { token: pair.accessToken } });

    expect(presenceCalls).toEqual([
      { actorId: parent.actorId, connectionId: client.id },
    ]);
  });

  it('accepts the credential from an Authorization header too', async () => {
    // A browser cannot set headers on a WebSocket upgrade but CAN on the
    // Socket.IO polling transport, and a client that falls back to polling must
    // not silently lose its identity.
    const pair = await auth.login('parent-socket', PASSWORD);
    const client = await connect({
      headers: { authorization: `Bearer ${pair.accessToken}` },
    });

    expect(client.disconnected).toBe(false);
    expect(client.actor?.actorId).toBe(parent.actorId);
  });

  // -- refused --------------------------------------------------------------

  /** Every refusal must look identical from outside: disconnected, no room, no actor. */
  function expectRefused(client: FakeSocket): void {
    expect(client.disconnected).toBe(true);
    expect(client.actor).toBeUndefined();
    expect(client.joined).toEqual([]);
    expect(presenceCalls).toEqual([]);
  }

  it('refuses a handshake with no credential at all', async () => {
    expectRefused(await connect({}));
  });

  it('refuses an empty token', async () => {
    expectRefused(await connect({ auth: { token: '' } }));
  });

  it('refuses a token that is not a token', async () => {
    expectRefused(await connect({ auth: { token: 'not-a-jwt' } }));
  });

  it('refuses a token signed with the wrong key', async () => {
    const pair = await auth.login('parent-socket', PASSWORD);
    // Flip one character of the signature.
    const [header, claims, signature] = pair.accessToken.split('.');
    const forged = `${header}.${claims}.${signature.slice(0, -1)}${
      signature.endsWith('A') ? 'B' : 'A'
    }`;

    expectRefused(await connect({ auth: { token: forged } }));
  });

  it('refuses a token whose session was revoked', async () => {
    const pair = await auth.login('parent-socket', PASSWORD);
    await auth.revoke(pair.sessionId, 'signed_out');

    // Signing out on one device must not leave that device's socket alive.
    expectRefused(await connect({ auth: { token: pair.accessToken } }));
  });

  it('refuses a token for an account that was deactivated', async () => {
    const pair = await auth.login('parent-socket', PASSWORD);
    identity.mutate(parent.actorId, { isActive: false });

    expectRefused(await connect({ auth: { token: pair.accessToken } }));
  });

  it('refuses an expired token', async () => {
    withAuthEnv({ JWT_ACCESS_TTL: '1s' });
    const shortLived = buildAuth(db, identity);
    const pair = await shortLived.login('parent-socket', PASSWORD);

    // Two seconds later, by the clock the verifier reads.
    const realNow = Date.now;
    Date.now = () => realNow() + 2000;
    try {
      const rejecting = new RealtimeGateway(
        {} as never, {} as never, {} as never,
        { online: async () => {}, offline: async () => {}, leaveConversation: async () => {} } as never,
        {} as never,
        shortLived,
      );
      const client = socket({ auth: { token: pair.accessToken } });
      await rejecting.handleConnection(client as never);
      expect(client.disconnected).toBe(true);
      expect(client.joined).toEqual([]);
    } finally {
      Date.now = realNow;
      withAuthEnv();
    }
  });

  // -- impersonation --------------------------------------------------------

  it('a client-supplied actorId is ignored entirely', async () => {
    const other = await db.addAccount({ subject: 'other-parent' }, PASSWORD);
    const victim = identity.give(other.id, contactActor({ displayName: 'أم عمر' }));

    const pair = await auth.login('parent-socket', PASSWORD);
    const client = await connect({
      // The old seam, presented alongside a valid token for somebody else.
      auth: { token: pair.accessToken, actorId: victim.actorId },
    });

    // The token decides. The room is the token's actor, not the one named.
    expect(client.actor?.actorId).toBe(parent.actorId);
    expect(client.joined).toEqual([room.actor(parent.actorId)]);
    expect(client.joined).not.toContain(room.actor(victim.actorId));
  });

  it('an actorId with NO token is refused, not honoured', async () => {
    const victim = identity.give(
      (await db.addAccount({ subject: 'victim' }, PASSWORD)).id,
      contactActor(),
    );

    // This is exactly the RT-001 attack: name the actor you wish to be.
    expectRefused(await connect({ auth: { actorId: victim.actorId } }));
  });

  it('a staff token reaches the staff actor’s room and no family’s', async () => {
    const account = await db.addAccount({ subject: 'admin-socket', kind: 'staff' }, PASSWORD);
    const admin = identity.give(account.id, staffActor());

    const pair = await auth.login('admin-socket', PASSWORD);
    const client = await connect({ auth: { token: pair.accessToken } });

    expect(client.joined).toEqual([room.actor(admin.actorId)]);
    expect(client.joined).not.toContain(room.actor(parent.actorId));
  });

  // -- the credential must not travel in a logged place ---------------------

  it('never reads a credential from the query string', async () => {
    const pair = await auth.login('parent-socket', PASSWORD);
    const client = socket({});
    // A token in a query string lands in access logs and proxy logs, where it
    // outlives the session it belongs to.
    (client.handshake as Record<string, unknown>).query = { token: pair.accessToken };

    await gateway.handleConnection(client as never);
    expect(client.disconnected).toBe(true);
  });

  it('extracts the token from auth first, then the header, and nowhere else', () => {
    expect(
      RealtimeGateway.handshakeToken({ handshake: { auth: { token: 'A' } } } as never),
    ).toBe('A');
    expect(
      RealtimeGateway.handshakeToken({
        handshake: { auth: {}, headers: { authorization: 'Bearer B' } },
      } as never),
    ).toBe('B');
    expect(
      RealtimeGateway.handshakeToken({
        handshake: { auth: {}, headers: { authorization: 'Token C' } },
      } as never),
    ).toBeNull();
    expect(RealtimeGateway.handshakeToken({ handshake: {} } as never)).toBeNull();
  });
});

/**
 * A client never names a room. It asks to subscribe to a conversation, the
 * server runs the SAME AuthorizationService the REST path uses, and only then
 * joins. Guessing or forging a room name gains nothing, because the name is
 * never what is trusted.
 */
describe('joining a conversation room', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;
  let parent: Actor;

  /** Whatever the authorization layer is told to answer for this test. */
  let allowed: boolean;
  let seenActor: string | null;

  async function connectedSocket(): Promise<FakeSocket> {
    const gateway = new RealtimeGateway(
      {
        canRead: (actor: Actor) => {
          seenActor = actor.actorId;
          return allowed
            ? { allowed: true }
            : { allowed: false, code: 'COMM.NOT_CONVERSATION_MEMBER', reason: 'no' };
        },
      } as never,
      {
        requireConversation: async (id: string) => ({ id }),
        membershipOf: async () => null,
      } as never,
      {} as never,
      {
        online: async () => {},
        offline: async () => {},
        enterConversation: async () => {},
        leaveConversation: async () => {},
      } as never,
      {} as never,
      auth,
    );

    const pair = await auth.login('parent-rooms', PASSWORD);
    const client = socket({ auth: { token: pair.accessToken } });
    await gateway.handleConnection(client as never);
    (client as unknown as { gateway: RealtimeGateway }).gateway = gateway;
    return client;
  }

  beforeEach(async () => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
    const account = await db.addAccount({ subject: 'parent-rooms' }, PASSWORD);
    parent = identity.give(account.id, contactActor());
    allowed = true;
    seenActor = null;
  });

  it('joins when the server authorizes it', async () => {
    const client = await connectedSocket();
    const gateway = (client as unknown as { gateway: RealtimeGateway }).gateway;

    const result = await gateway.subscribe(client as never, { conversationId: 'c-1' });

    expect(result.ok).toBe(true);
    expect(client.joined).toContain('conversation:c-1');
    // The check ran against the TOKEN's actor, not anything the client sent.
    expect(seenActor).toBe(parent.actorId);
  });

  it('refuses, and does not join, when the server says no', async () => {
    allowed = false;
    const client = await connectedSocket();
    const gateway = (client as unknown as { gateway: RealtimeGateway }).gateway;

    const result = await gateway.subscribe(client as never, { conversationId: 'c-2' });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('COMM.NOT_CONVERSATION_MEMBER');
    // The refusal is the absence of a join, not a flag the client could ignore.
    expect(client.joined).not.toContain('conversation:c-2');
  });

  it('refuses a subscribe from a socket that never authenticated', async () => {
    const gateway = new RealtimeGateway(
      { canRead: () => ({ allowed: true }) } as never,
      { requireConversation: async (id: string) => ({ id }), membershipOf: async () => null } as never,
      {} as never,
      { online: async () => {}, offline: async () => {}, enterConversation: async () => {} } as never,
      {} as never,
      auth,
    );
    const client = socket({});

    const result = await gateway.subscribe(client as never, { conversationId: 'c-3' });

    expect(result.ok).toBe(false);
    expect(client.joined).toEqual([]);
  });

  it('refuses a subscribe with no conversation named', async () => {
    const client = await connectedSocket();
    const gateway = (client as unknown as { gateway: RealtimeGateway }).gateway;

    expect((await gateway.subscribe(client as never, {})).ok).toBe(false);
  });
});
