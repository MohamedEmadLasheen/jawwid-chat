/**
 * RT-009 -- the revocation hub's completion barrier fails CLOSED.
 *
 * The four pushes are best-effort cleanup and never throw. `confirmRevoked` is
 * the completion barrier: a revoking operation reports success only if it
 * resolves. So a process with no realtime server attached (the worker, or an
 * API process before Socket.IO started) must refuse -- it cannot fence the
 * cluster -- and a refusal from the gateway must reach the caller, not be
 * swallowed the way a failed push is.
 */
import { CommErrorCode } from '@platform/errors';
import {
  NO_REALTIME_REVOCATION,
  RealtimeRevocationHub,
  RevocationUnconfirmedError,
  type RealtimeRevocation,
} from '@platform/realtime-revocation';
import { InfraIoAdapter } from '../../../src/infra/realtime/io-adapter';

const target = (over: Partial<RealtimeRevocation> = {}): RealtimeRevocation => ({
  ...NO_REALTIME_REVOCATION,
  ...over,
});

describe('RealtimeRevocationHub.confirmRevoked', () => {
  it('refuses when no realtime server is attached: 503 COMM.REVOCATION_UNCONFIRMED, never a silent success', async () => {
    const hub = new RealtimeRevocationHub();
    const error = await hub.confirmRevoked().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RevocationUnconfirmedError);
    expect(error).toMatchObject({ code: CommErrorCode.REVOCATION_UNCONFIRMED, status: 503 });
  });

  it("propagates the gateway's refusal, unlike a push", async () => {
    const hub = new RealtimeRevocationHub();
    hub.attach(
      target({
        confirmRevoked: async () => {
          throw new RevocationUnconfirmedError('1 server(s) did not acknowledge');
        },
        disconnectSessions: () => {
          throw new Error('a push that fails');
        },
      }),
    );
    expect(() => hub.disconnectSessions(['s'])).not.toThrow(); // cleanup: swallowed
    await expect(hub.confirmRevoked()).rejects.toMatchObject({ code: CommErrorCode.REVOCATION_UNCONFIRMED });
  });

  it('resolves exactly when the attached gateway confirms', async () => {
    const hub = new RealtimeRevocationHub();
    const confirm = jest.fn(async () => undefined);
    hub.attach(target({ confirmRevoked: confirm }));
    await expect(hub.confirmRevoked()).resolves.toBeUndefined();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('pushes before attachment are no-ops, not errors', () => {
    const hub = new RealtimeRevocationHub();
    expect(() => hub.disconnectAccount('a')).not.toThrow();
    expect(() => hub.leaveConversation(['x'], 'c')).not.toThrow();
  });
});

describe('the realtime Redis adapter is mandatory outside local (RT-009)', () => {
  // Without it a replica believes it is the only node: it confirms revocations
  // alone and no other node's barrier can reach it.
  it.each(['staging', 'production'])('APP_ENV=%s without REDIS_URL refuses to boot', async (environment) => {
    const adapter = new InfraIoAdapter(undefined as never);
    await expect(adapter.connectToRedis(undefined, environment)).rejects.toThrow(/REDIS_URL is required/);
  });

  it('local without REDIS_URL still runs single-node (and says so)', async () => {
    const adapter = new InfraIoAdapter(undefined as never);
    await expect(adapter.connectToRedis(undefined, 'local')).resolves.toBeUndefined();
  });
});
