/**
 * How a node runs its realtime deliveries (RealtimeGateway).
 *
 * Each delivery holds a short row-locking transaction on its own database
 * connection (ConversationService.withDeliveryLocks) and decides per recipient
 * across several awaits. Two guarantees, and only these:
 *
 *   - ORDER per key: tasks with the same key run one after another, in the
 *     order they were queued, so two events of one conversation can never
 *     overtake each other across those awaits.
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

  /** Runs `task` after every earlier task of `key`, in a free slot. Never rejects: failures go to onError. */
  run(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous
      .then(() => this.inSlot(task))
      .catch((e) => this.onError(key, e));
    this.tails.set(key, next);
    void next.then(() => {
      if (this.tails.get(key) === next) this.tails.delete(key);
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
