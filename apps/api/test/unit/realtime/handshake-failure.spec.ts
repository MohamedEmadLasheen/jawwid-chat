/**
 * A failed handshake must cost one socket, never the process.
 *
 * Nest does not await `handleConnection`, so a rejection there was an
 * unhandled rejection -- which terminates Node. Found on a live stack: one
 * transient database error (Prisma P1001) inside `AuthService.authenticate`
 * during a burst of logins took the whole API down.
 */
import { RealtimeGateway } from '@communication/realtime/realtime.gateway';

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
    const auth = { authenticate: jest.fn(async () => ({ actor, accountId: 'acc', sessionId: 'ses' })) };
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
