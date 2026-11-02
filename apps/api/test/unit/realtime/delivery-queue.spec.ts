/**
 * The realtime delivery queue: order per conversation, parallel across them,
 * bounded per node. Before, one queue for the whole node meant a delivery
 * waiting on a row lock (up to its 5 s lock_timeout) held up every
 * conversation on that node.
 */
import { DeliveryQueue, deliveryConcurrency } from '@communication/realtime/delivery-queue';

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

  it('a reporter that throws cannot poison the key: the next task still runs', async () => {
    const q = new DeliveryQueue(1, () => {
      throw new TypeError("Cannot read properties of undefined (reading 'name')");
    });
    const done: string[] = [];
    await expect(q.run('conversation:a', async () => { throw undefined; })).resolves.toBeUndefined();
    await q.run('conversation:a', async () => { done.push('next'); });
    expect(done).toEqual(['next']);
  });

  describe('a task addressed to several keys (one delivery to several actors)', () => {
    it('waits for the earlier tasks of EVERY key it names, and later tasks of each key wait for it', async () => {
      const q = queue(4);
      const done: string[] = [];
      const a = deferred();
      const b = deferred();
      const runs = [
        q.run('actor:a', async () => { await a.promise; done.push('a1'); }),
        q.run('actor:b', async () => { await b.promise; done.push('b1'); }),
        q.run(['actor:a', 'actor:b'], async () => { done.push('ab'); }),
        q.run('actor:a', async () => { done.push('a2'); }),
        q.run('actor:b', async () => { done.push('b2'); }),
      ];
      await tick();
      a.resolve();
      await tick();
      expect(done).toEqual(['a1']); // 'ab' still waits for b1; a2 waits for 'ab'
      b.resolve();
      await Promise.all(runs);
      expect(done.indexOf('ab')).toBeGreaterThan(done.indexOf('a1'));
      expect(done.indexOf('ab')).toBeGreaterThan(done.indexOf('b1'));
      expect(done.indexOf('a2')).toBeGreaterThan(done.indexOf('ab'));
      expect(done.indexOf('b2')).toBeGreaterThan(done.indexOf('ab'));
    });

    it('two actors run side by side: a stalled one does not hold up the other', async () => {
      const q = queue(2);
      const stalled = deferred();
      let bDelivered = false;
      const a = q.run(['actor:a'], () => stalled.promise);
      await q.run(['actor:b'], async () => { bDelivered = true; });
      expect(bDelivered).toBe(true);
      stalled.resolve();
      await a;
    });

    it('one actor stays strictly in order across single- and multi-actor deliveries', async () => {
      const q = queue(4);
      const seen: number[] = [];
      const slow = deferred();
      const runs = [
        q.run(['actor:a', 'actor:c'], async () => { await slow.promise; seen.push(1); }),
        q.run(['actor:a'], async () => { seen.push(2); }),
        q.run(['actor:b', 'actor:a'], async () => { await tick(); seen.push(3); }),
        q.run('actor:a', async () => { seen.push(4); }),
      ];
      await tick();
      expect(seen).toEqual([]);
      slow.resolve();
      await Promise.all(runs);
      expect(seen).toEqual([1, 2, 3, 4]);
    });

    it('a duplicate key or an empty list is harmless; every key is forgotten afterwards', async () => {
      const q = queue(2);
      await q.run(['actor:a', 'actor:a'], async () => {});
      await q.run([], async () => {});
      await tick();
      expect(q.pendingKeys).toBe(0);
    });

    it('a failure (and a throwing reporter) does not block any of its keys', async () => {
      const q = new DeliveryQueue(2, () => { throw new Error('reporter broke'); });
      const done: string[] = [];
      await q.run(['actor:a', 'actor:b'], async () => { throw new Error('lock timeout'); });
      await Promise.all([
        q.run('actor:a', async () => { done.push('a'); }),
        q.run('actor:b', async () => { done.push('b'); }),
      ]);
      expect(done.sort()).toEqual(['a', 'b']);
    });
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

describe('deliveryConcurrency', () => {
  it('a third of the API pool, at least 1: 7 -> 2 (the deploy value), 3 -> 1, 1 -> 1, 12 -> 4', () => {
    expect(deliveryConcurrency({ DATABASE_POOL_MAX: '7' })).toBe(2);
    expect(deliveryConcurrency({ DATABASE_POOL_MAX: '3' })).toBe(1);
    expect(deliveryConcurrency({ DATABASE_POOL_MAX: '1' })).toBe(1);
    expect(deliveryConcurrency({ DATABASE_POOL_MAX: '12' })).toBe(4);
  });

  it('never more than the pool can spare: for every pool size, at most a third', () => {
    for (let pool = 1; pool <= 50; pool++) {
      const n = deliveryConcurrency({ DATABASE_POOL_MAX: String(pool) });
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n <= Math.max(1, pool / 3)).toBe(true);
    }
  });

  it('REALTIME_DELIVERY_CONCURRENCY overrides it; nothing set means 2', () => {
    expect(deliveryConcurrency({ DATABASE_POOL_MAX: '7', REALTIME_DELIVERY_CONCURRENCY: '1' })).toBe(1);
    expect(deliveryConcurrency({})).toBe(2);
    for (const bad of ['0', '17', '1.5', 'many']) {
      expect(() => deliveryConcurrency({ REALTIME_DELIVERY_CONCURRENCY: bad })).toThrow('REALTIME_DELIVERY_CONCURRENCY');
    }
  });

  it('the bound it returns is the bound a DeliveryQueue keeps', async () => {
    const q = new DeliveryQueue(deliveryConcurrency({ DATABASE_POOL_MAX: '7' }), () => {});
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, deferred);
    const runs = gates.map((g, i) => q.run(`conversation:${i}`, async () => {
      running++;
      peak = Math.max(peak, running);
      await g.promise;
      running--;
    }));
    await tick();
    gates.forEach((g) => g.resolve());
    await Promise.all(runs);
    expect(peak).toBe(2);
  });
});
