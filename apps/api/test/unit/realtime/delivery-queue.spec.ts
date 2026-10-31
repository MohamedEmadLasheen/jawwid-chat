/**
 * The realtime delivery queue: order per conversation, parallel across them,
 * bounded per node. Before, one queue for the whole node meant a delivery
 * waiting on a row lock (up to its 5 s lock_timeout) held up every
 * conversation on that node.
 */
import { DeliveryQueue } from '@communication/realtime/delivery-queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setImmediate(r));

describe('DeliveryQueue', () => {
  const errors: unknown[] = [];
  const queue = (n = 2) => new DeliveryQueue(n, (_k, e) => errors.push(e));
  beforeEach(() => (errors.length = 0));

  it('one conversation: strictly in order, even when an earlier task is the slow one', async () => {
    const q = queue(4);
    const done: number[] = [];
    const slow = deferred();
    const runs = [
      q.run('conversation:a', async () => { await slow.promise; done.push(1); }),
      q.run('conversation:a', async () => { done.push(2); }),
      q.run('conversation:a', async () => { await tick(); done.push(3); }),
    ];
    await tick();
    expect(done).toEqual([]); // 2 and 3 wait behind 1, though slots are free
    slow.resolve();
    await Promise.all(runs);
    expect(done).toEqual([1, 2, 3]);
  });

  it('another conversation is not held up behind a stalled one', async () => {
    const q = queue(2);
    const stalled = deferred();
    let bDelivered = false;
    const a = q.run('conversation:a', () => stalled.promise);
    await q.run('conversation:b', async () => { bDelivered = true; });
    expect(bDelivered).toBe(true);
    stalled.resolve();
    await a;
  });

  it('never more than `concurrency` at once across keys, and every task still runs', async () => {
    const q = queue(2);
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 6 }, deferred);
    const runs = gates.map((g, i) =>
      q.run(`conversation:${i}`, async () => {
        running++;
        peak = Math.max(peak, running);
        await g.promise;
        running--;
      }),
    );
    await tick();
    expect(running).toBe(2);
    // Release in an order that lets newcomers race the hand-over.
    for (const g of gates) {
      g.resolve();
      q.run('conversation:late', async () => { running++; peak = Math.max(peak, running); running--; });
      await tick();
    }
    await Promise.all(runs);
    expect(peak).toBe(2);
    expect(running).toBe(0);
  });

  it('a freed slot goes to the oldest waiter: a newcomer arriving at any moment of the hand-over cannot exceed the bound', async () => {
    for (let hops = 0; hops < 12; hops++) {
      const q = queue(1);
      let running = 0;
      let peak = 0;
      const counted = (gate?: Promise<void>) => async () => {
        running++;
        peak = Math.max(peak, running);
        await gate;
        running--;
      };
      const holder = deferred();
      const first = q.run('conversation:a', counted(holder.promise));
      const waiter = q.run('conversation:b', counted());
      await tick();
      holder.resolve();
      for (let i = 0; i < hops; i++) await Promise.resolve();
      const newcomer = q.run('conversation:c', counted());
      await Promise.all([first, waiter, newcomer]);
      expect([hops, peak]).toEqual([hops, 1]);
    }
  });

  it('a failing task is reported and does not block the next one of its conversation', async () => {
    const q = queue(1);
    const done: string[] = [];
    await Promise.all([
      q.run('conversation:a', async () => { throw new Error('lock timeout'); }),
      q.run('conversation:a', async () => { done.push('next'); }),
    ]);
    expect(done).toEqual(['next']);
    expect(errors).toHaveLength(1);
  });

  it('forgets a key once its queue is empty', async () => {
    const q = queue(2);
    await q.run('conversation:a', async () => {});
    await tick();
    expect(q.pendingKeys).toBe(0);
  });

  it('refuses a zero or fractional bound', () => {
    expect(() => new DeliveryQueue(0, () => {})).toThrow();
    expect(() => new DeliveryQueue(1.5, () => {})).toThrow();
  });
});
