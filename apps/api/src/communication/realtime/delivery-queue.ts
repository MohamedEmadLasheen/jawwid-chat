/**
 * How a node runs its realtime deliveries (RealtimeGateway).
 *
 * Each delivery holds a short row-locking transaction on its own database
 * connection (ConversationService.withDeliveryLocks) and decides per recipient
 * across several awaits. Two guarantees, and only these:
 *
 *   - ORDER per key: tasks with the same key run one after another, in the
 *     order they were queued, so two events of one conversation (or for one
 *     actor) can never overtake each other across those awaits. A task may
 *     name several keys -- one delivery to several actors -- and is then
 *     ordered within each of them.
 *   - A BOUND per node: at most `concurrency` tasks run at once, whatever their
 *     keys, so deliveries take at most that many pool connections.
 *
 * Different keys run side by side. One queue for the whole node used to make a
 * delivery waiting on a lock (up to its 5 s lock_timeout) stall every other
 * conversation behind it.
 *
 * Correctness against revocation does not come from here: every attempt runs
 * under the RT-009 fence (`fenced`) and its own row locks, which hold for any
 * number of concurrent deliveries, exactly as they do across nodes.
 */
export class DeliveryQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    readonly concurrency: number,
    private readonly onError: (key: string, error: unknown) => void,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('DeliveryQueue: concurrency must be a positive integer');
  }

  /**
   * Runs `task` after every earlier task of each of its keys, in a free slot,
   * and before every later one. One delivery to several actors names all of
   * them: it waits for each actor's earlier deliveries, and each actor's later
   * ones wait for it. (Tasks only ever wait on earlier tasks, so there is no
   * cycle to deadlock on.) Never rejects: failures go to onError.
   */
  run(keys: string | readonly string[], task: () => Promise<void>): Promise<void> {
    const named = [...new Set(typeof keys === 'string' ? [keys] : keys)];
    const label = named[0] ?? '';
    const earlier = named.map((k) => this.tails.get(k)).filter((p): p is Promise<void> => p !== undefined);
    const next = Promise.all(earlier)
      .then(() => this.inSlot(task))
      .catch((e) => {
        // Reporting must never break the chain: a throw here would reject
        // `next`, and every later task of these keys would be skipped for good.
        try {
          this.onError(label, e);
        } catch {
          /* the failure is already lost; the keys keep moving */
        }
      });
    for (const k of named) this.tails.set(k, next);
    void next.then(() => {
      for (const k of named) if (this.tails.get(k) === next) this.tails.delete(k);
    });
    return next;
  }

  /** Keys with queued or running work (for tests and diagnostics). */
  get pendingKeys(): number {
    return this.tails.size;
  }

  private async inSlot(task: () => Promise<void>): Promise<void> {
    // A freed slot is handed straight to the oldest waiter (still counted in
    // `running`), so a newcomer can never slip in between and exceed the bound.
    if (this.running < this.concurrency) this.running++;
    else await new Promise<void>((r) => this.waiting.push(r));
    try {
      await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}

/**
 * How many deliveries a node runs at once. Each holds one pool connection for
 * its transaction, so it is a share of the API's pool: a third of
 * DATABASE_POOL_MAX (7 -> 2), at least 1, leaving the rest to HTTP requests.
 * REALTIME_DELIVERY_CONCURRENCY overrides it (1..16); with neither set (a
 * laptop, CI) it is 2.
 */
export function deliveryConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const explicit = (env.REALTIME_DELIVERY_CONCURRENCY ?? '').trim();
  if (explicit) {
    const n = Number(explicit);
    if (!Number.isInteger(n) || n < 1 || n > 16) throw new Error('REALTIME_DELIVERY_CONCURRENCY must be an integer from 1 to 16');
    return n;
  }
  const pool = Number((env.DATABASE_POOL_MAX ?? '').trim());
  if (Number.isInteger(pool) && pool > 0) return Math.max(1, Math.floor(pool / 3));
  return 2;
}
