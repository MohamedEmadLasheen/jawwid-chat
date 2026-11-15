/**
 * RT-019: the legacy `message.delivered { messageIds }` frame is bounded.
 *
 * The array went straight into one SQL `IN`: any length, any element type, and
 * no per-actor budget (the newer cursor form already spends one). Now the frame
 * is refused unless it is a non-empty array of at most
 * MAX_DELIVERED_MESSAGE_IDS UUID strings, and each accepted frame spends the
 * SAME per-actor receipt budget as the cursor form
 * (`abuse.throttle.receipt_cursor_actor`).
 */
import { MAX_DELIVERED_MESSAGE_IDS, RealtimeGateway } from '@communication/realtime/realtime.gateway';
import { ReceiptState } from '@communication/contracts/vocab';
import { ActionScope, actionRateLimitKey } from '@platform/auth/action-throttle.guard';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const actor = { actorId: ACTOR_ID, kind: 'contact', isActive: true };

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function fakeClient() {
  return {
    id: 'sock-1',
    actor,
    accountId: 'acc-1',
    rooms: new Set<string>(['sock-1']),
    disconnect: jest.fn(),
  };
}

function build(opts: { exceeded?: number; liveActor?: unknown } = {}) {
  const messages = { markState: jest.fn(async (ids: string[]) => ids.length) };
  const auth = {
    revalidateRealtime: jest.fn(async (asked: unknown[]) =>
      asked.map(() => ('liveActor' in opts ? opts.liveActor : actor)),
    ),
  };
  const reserved: string[] = [];
  const rateLimits = {
    reserve: jest.fn(async (keys: string[]) => {
      reserved.push(...keys);
      return { exceeded: opts.exceeded ?? 0, retryAfterSeconds: 30 };
    }),
    drop: jest.fn(async () => undefined),
  };
  const gateway = new RealtimeGateway(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    messages as never,
    auth as never,
    undefined,
    undefined,
    undefined,
    undefined,
    rateLimits as never,
  );
  return { gateway, messages, auth, rateLimits, reserved };
}

const deliver = (g: RealtimeGateway, body: unknown, client = fakeClient()) =>
  g.delivered(client as never, body as never);

describe('RT-019: legacy message.delivered { messageIds } is bounded', () => {
  it('a normal small array still works, scoped to the caller', async () => {
    const { gateway, messages, reserved } = build();
    const r = await deliver(gateway, { messageIds: [id(1), id(2)] });
    expect(r).toEqual({ ok: true, updated: 2 });
    expect(messages.markState).toHaveBeenCalledWith([id(1), id(2)], ACTOR_ID, ReceiptState.DELIVERED);
    expect(reserved).toHaveLength(1);
  });

  it('exactly the cap is accepted', async () => {
    const { gateway, messages } = build();
    const ids = Array.from({ length: MAX_DELIVERED_MESSAGE_IDS }, (_, i) => id(i + 1));
    expect((await deliver(gateway, { messageIds: ids })).ok).toBe(true);
    expect(messages.markState).toHaveBeenCalledTimes(1);
  });

  it('one over the cap is refused before any database or budget work', async () => {
    const { gateway, messages, rateLimits, auth } = build();
    const ids = Array.from({ length: MAX_DELIVERED_MESSAGE_IDS + 1 }, (_, i) => id(i + 1));
    expect(await deliver(gateway, { messageIds: ids })).toEqual({ ok: false, updated: 0 });
    expect(messages.markState).not.toHaveBeenCalled();
    expect(rateLimits.reserve).not.toHaveBeenCalled();
    expect(auth.revalidateRealtime).not.toHaveBeenCalled();
  });

  it('a very large array is refused', async () => {
    const { gateway, messages } = build();
    const ids = Array.from({ length: 100_000 }, () => id(1));
    expect((await deliver(gateway, { messageIds: ids })).ok).toBe(false);
    expect(messages.markState).not.toHaveBeenCalled();
  });

  it.each([
    ['a number', [id(1), 42]],
    ['an object', [id(1), { $ne: null }]],
    ['null', [id(1), null]],
    ['a nested array', [[id(1)]]],
    ['a non-UUID string', [id(1), 'not-a-uuid']],
    ['an empty string', ['']],
  ])('an element that is %s is refused', async (_label, messageIds) => {
    const { gateway, messages, rateLimits } = build();
    expect(await deliver(gateway, { messageIds })).toEqual({ ok: false, updated: 0 });
    expect(messages.markState).not.toHaveBeenCalled();
    expect(rateLimits.reserve).not.toHaveBeenCalled();
  });

  it.each([
    ['a string', 'abc'],
    ['an object with a length', { length: 3, 0: id(1) }],
    ['an empty array', []],
  ])('messageIds that is %s is refused', async (_label, messageIds) => {
    const { gateway, messages } = build();
    expect(await deliver(gateway, { messageIds })).toEqual({ ok: false, updated: 0 });
    expect(messages.markState).not.toHaveBeenCalled();
  });

  it('spends the same per-actor receipt budget as the cursor form', async () => {
    const { gateway, reserved } = build();
    await deliver(gateway, { messageIds: [id(1)] });
    await deliver(gateway, { conversationId: id(9), upToSeq: '1' }).catch(() => undefined);
    expect(reserved).toHaveLength(2);
    expect(reserved[0]).toBe(reserved[1]);
    expect(reserved[0]).toBe(actionRateLimitKey(ActionScope.RECEIPT_CURSOR, ACTOR_ID));
  });

  it('over budget, the legacy form is refused and nothing is written', async () => {
    const { gateway, messages } = build({ exceeded: 1 });
    expect(await deliver(gateway, { messageIds: [id(1)] })).toEqual({ ok: false, updated: 0 });
    expect(messages.markState).not.toHaveBeenCalled();
  });

  it('duplicates are collapsed before the query', async () => {
    const { gateway, messages } = build();
    await deliver(gateway, { messageIds: [id(1), id(1), id(2)] });
    expect(messages.markState).toHaveBeenCalledWith([id(1), id(2)], ACTOR_ID, ReceiptState.DELIVERED);
  });

  it('an identity no longer entitled (RT-009) writes nothing', async () => {
    const { gateway, messages } = build({ liveActor: null });
    expect((await deliver(gateway, { messageIds: [id(1)] })).ok).toBe(false);
    expect(messages.markState).not.toHaveBeenCalled();
  });
});
