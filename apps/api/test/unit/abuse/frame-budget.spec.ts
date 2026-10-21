/**
 * The per-socket frame budget (Phase 8, docs/security/ABUSE-LIMITS.md).
 *
 * The one abuse control that is not shared across nodes, because it cannot be:
 * a typing indicator fires per keystroke and a round trip per keystroke would be
 * a worse denial of service than the abuse it defends against. So the behaviour
 * is proven here rather than assumed, and the clock is injected so no assertion
 * depends on how long the test took to run.
 */
import { Logger } from '@nestjs/common';
import { FrameBudget } from '@communication/realtime/frame-budget';
import { RealtimeGateway } from '@communication/realtime/realtime.gateway';
import { realtimeMetrics } from '@platform/realtime-metrics';
import { COMMUNICATION_CONFIG_DEFAULTS } from '@platform/app-config.service';

describe('FrameBudget', () => {
  it('admits exactly the limit and refuses the one after it', () => {
    const budget = new FrameBudget(3, 60_000, 0);
    expect(budget.admit(0)).toBe(true);
    expect(budget.admit(1)).toBe(true);
    expect(budget.admit(2)).toBe(true);
    // The limit is the number ALLOWED. "Limit 3" meaning two frames is the
    // off-by-one that gets discovered during an incident.
    expect(budget.admit(3)).toBe(false);
  });

  it('keeps refusing for the rest of the window', () => {
    const budget = new FrameBudget(1, 60_000, 0);
    expect(budget.admit(0)).toBe(true);
    expect(budget.admit(1)).toBe(false);
    expect(budget.admit(59_999)).toBe(false);
  });

  it('starts a fresh window once the old one has elapsed', () => {
    const budget = new FrameBudget(2, 60_000, 0);
    expect(budget.admit(0)).toBe(true);
    expect(budget.admit(1)).toBe(true);
    expect(budget.admit(2)).toBe(false);
    expect(budget.admit(60_000)).toBe(true);
    expect(budget.used).toBe(1);
  });

  it('does not reset early: 59_999ms into a window is still that window', () => {
    const budget = new FrameBudget(1, 60_000, 0);
    expect(budget.admit(0)).toBe(true);
    expect(budget.admit(59_999)).toBe(false);
    expect(budget.admit(60_000)).toBe(true);
  });

  it('a zero limit refuses everything rather than admitting everything', () => {
    // A misconfigured `0` that meant "unlimited" would turn the control off
    // precisely when somebody was trying to tighten it.
    const budget = new FrameBudget(0, 60_000, 0);
    expect(budget.admit(0)).toBe(false);
  });

  it('counts frames, not distinct events -- a loop on one event is the attack', () => {
    const budget = new FrameBudget(600, 60_000, 0);
    let refusedAt: number | null = null;
    for (let i = 0; i < 700; i += 1) {
      if (!budget.admit(i) && refusedAt === null) refusedAt = i;
    }
    expect(refusedAt).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// The gateway installs it, after authentication, as socket middleware.
// ---------------------------------------------------------------------------

type Middleware = (packet: unknown[], next: (err?: Error) => void) => void;

function fakeClient() {
  const middleware: Middleware[] = [];
  return {
    id: 'sock-1',
    handshake: { auth: { token: 'a-token' }, headers: {} },
    conn: { close: jest.fn() },
    disconnect: jest.fn(),
    join: jest.fn(async () => undefined),
    use: jest.fn((fn: Middleware) => middleware.push(fn)),
    middleware,
  };
}

const actor = { actorId: 'a1', kind: 'contact', isActive: true };
const authOk = { authenticate: jest.fn(async () => ({ actor, accountId: 'acc', sessionId: 'ses' })) };
const presence = { online: jest.fn(async () => undefined) };

function gateway(auth: unknown, config?: unknown) {
  return new RealtimeGateway(
    {} as never,
    {} as never,
    {} as never,
    presence as never,
    {} as never,
    auth as never,
    undefined,
    undefined,
    config as never,
  );
}

/** Push `n` frames through the installed middleware; how many reached `next`. */
function send(client: ReturnType<typeof fakeClient>, n: number): number {
  let passed = 0;
  for (let i = 0; i < n; i++) client.middleware[0](['typing.start', {}], () => passed++);
  return passed;
}

describe('RealtimeGateway — frame budget wiring', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('installs the budget only after authentication succeeds', async () => {
    const refused = fakeClient();
    await gateway({ authenticate: jest.fn(async () => null) }).handleConnection(refused as never);
    expect(refused.use).not.toHaveBeenCalled();

    const client = fakeClient();
    await gateway(authOk).handleConnection(client as never);
    expect(client.use).toHaveBeenCalledTimes(1);
  });

  it('passes frames within the configured budget, then refuses the frame AND disconnects', async () => {
    const config = { get: jest.fn(async () => 3) };
    const client = fakeClient();
    await gateway(authOk, config).handleConnection(client as never);
    expect(config.get).toHaveBeenCalledWith('abuse.realtime.frames_per_socket_per_minute');

    const before = realtimeMetrics.framesOverBudget;
    expect(send(client, 3)).toBe(3);
    expect(client.disconnect).not.toHaveBeenCalled();

    // The fourth frame never reaches a handler, and the socket is ended with a
    // SERVER disconnect -- not a transport close a runaway client would retry.
    expect(send(client, 5)).toBe(0);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.conn.close).not.toHaveBeenCalled();
    expect(realtimeMetrics.framesOverBudget).toBe(before + 1);
  });

  it('without config (or with an unreadable one) the default applies, never "no limit"', async () => {
    const limit = COMMUNICATION_CONFIG_DEFAULTS['abuse.realtime.frames_per_socket_per_minute'];
    for (const config of [undefined, { get: jest.fn(async () => { throw new Error('db down'); }) }, { get: jest.fn(async () => null) }]) {
      const client = fakeClient();
      await gateway(authOk, config).handleConnection(client as never);
      expect(send(client, limit)).toBe(limit);
      expect(send(client, 1)).toBe(0);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    }
  });
});
