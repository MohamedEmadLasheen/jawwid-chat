/**
 * A failed handshake must cost one socket, never the process.
 *
 * Nest does not await `handleConnection`, so a rejection there was an
 * unhandled rejection -- which terminates Node. Found on a live stack: one
 * transient database error (Prisma P1001) inside `AuthService.authenticate`
 * during a burst of logins took the whole API down.
 */
import { RealtimeGateway } from '@communication/realtime/realtime.gateway';
import {
  NoopErrorTracker,
  setProcessErrorTracker,
  type ErrorContext,
} from '../../../src/infra/observability/error-tracker';

function fakeClient() {
  return {
    id: 'sock-1',
    handshake: { auth: { token: 'a-token' }, headers: {} },
    conn: { close: jest.fn() },
    disconnect: jest.fn(),
    join: jest.fn(async () => undefined),
    use: jest.fn(),
  };
}

function gateway(auth: unknown, presence: unknown) {
  return new RealtimeGateway(
    {} as never,
    {} as never,
    {} as never,
    presence as never,
    {} as never,
    auth as never,
  );
}

describe('RealtimeGateway.handleConnection — failure is contained', () => {
  it('an infrastructure error during authentication resolves, and closes only that transport', async () => {
    const auth = { authenticate: jest.fn(async () => { throw Object.assign(new Error('db down'), { name: 'PrismaClientKnownRequestError' }); }) };
    const client = fakeClient();

    await expect(gateway(auth, {}).handleConnection(client as never)).resolves.toBeUndefined();

    // A transport close (the client retries with backoff), NOT a server
    // disconnect (which clients read as "your credential was refused").
    expect(client.conn.close).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it('a refused token is still a server disconnect, exactly as before', async () => {
    const auth = { authenticate: jest.fn(async () => null) };
    const client = fakeClient();

    await gateway(auth, {}).handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.conn.close).not.toHaveBeenCalled();
  });

  it('a presence write failing does not refuse an authenticated socket', async () => {
    const actor = { actorId: 'a1', kind: 'contact', isActive: true };
    const auth = {
      authenticate: jest.fn(async () => ({ actor, accountId: 'acc', sessionId: 'ses' })),
      // The handshake re-checks the session last: still live, still this actor.
      revalidateRealtime: jest.fn(async (asked: unknown[]) => asked.map(() => actor)),
    };
    const presence = { online: jest.fn(async () => { throw new Error('redis down'); }) };
    const client = fakeClient();

    await expect(gateway(auth, presence).handleConnection(client as never)).resolves.toBeUndefined();

    expect(client.join).toHaveBeenCalledWith('actor:a1');
    expect(client.conn.close).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('handleDisconnect swallows a presence failure too', async () => {
    const presence = { offline: jest.fn(async () => { throw new Error('redis down'); }) };
    const client = { ...fakeClient(), actor: { actorId: 'a1' } };
    await expect(gateway({}, presence).handleDisconnect(client as never)).resolves.toBeUndefined();
  });
});

describe('RealtimeGateway.handleConnection — a failed handshake reaches the error tracker', () => {
  const captured: Array<{ error: unknown; context?: ErrorContext }> = [];
  beforeEach(() => {
    captured.length = 0;
    setProcessErrorTracker({
      name: 'fake',
      isEnabled: () => true,
      captureException: (error, context) => captured.push({ error, context }),
      close: async () => undefined,
    });
  });
  afterEach(() => setProcessErrorTracker(new NoopErrorTracker()));

  it('reports an infrastructure failure once, with two labels and nothing from the socket', async () => {
    const failure = Object.assign(new Error('db down'), { name: 'PrismaClientKnownRequestError' });
    const auth = { authenticate: jest.fn(async () => { throw failure; }) };
    const client = fakeClient();

    await gateway(auth, {}).handleConnection(client as never);

    expect(captured).toHaveLength(1);
    expect(captured[0].error).toBe(failure);
    expect(captured[0].context).toEqual({ route: 'WS handshake', component: 'api' });
    expect(JSON.stringify(captured[0].context)).not.toContain('a-token');
    // Behaviour unchanged: still only that transport closed.
    expect(client.conn.close).toHaveBeenCalledTimes(1);
  });

  it('a tracker that throws does not change what happens to the socket or the process', async () => {
    setProcessErrorTracker({
      name: 'broken',
      isEnabled: () => true,
      captureException: () => { throw new Error('tracker exploded'); },
      close: async () => undefined,
    });
    const auth = { authenticate: jest.fn(async () => { throw new Error('db down'); }) };
    const client = fakeClient();
    await expect(gateway(auth, {}).handleConnection(client as never)).resolves.toBeUndefined();
    expect(client.conn.close).toHaveBeenCalledTimes(1);
  });

  it('does NOT report a refused token — that is authentication working', async () => {
    const auth = { authenticate: jest.fn(async () => null) };
    await gateway(auth, {}).handleConnection(fakeClient() as never);
    expect(captured).toHaveLength(0);
  });

  it('does NOT report a presence write failing — the socket is still accepted', async () => {
    const actor = { actorId: 'a1', kind: 'contact', isActive: true };
    const auth = {
      authenticate: jest.fn(async () => ({ actor, accountId: 'acc', sessionId: 'ses' })),
      revalidateRealtime: jest.fn(async (asked: unknown[]) => asked.map(() => actor)),
    };
    const presence = { online: jest.fn(async () => { throw new Error('redis down'); }) };
    await gateway(auth, presence).handleConnection(fakeClient() as never);
    expect(captured).toHaveLength(0);
  });
});
