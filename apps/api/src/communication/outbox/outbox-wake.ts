import Redis from 'ioredis';

/**
 * A HINT that the outbox has work, so the worker does not sit out its idle
 * backoff while a message waits.
 *
 * WHY. The worker polls the outbox and, when it finds nothing, sleeps
 * `OUTBOX_IDLE_BACKOFF_MS` (5 s by default) so an idle deployment does not
 * query the database continuously. A message sent into a quiet system therefore
 * reached the other side up to five seconds late -- measured on a live stack at
 * 4.7-5.0 s for the first message after a lull. That is not real time.
 *
 * WHAT IT IS NOT. Not a queue and not a second record of anything: the outbox
 * row, written in the same transaction as the change, stays the only source of
 * truth, and polling still finds every row. A lost or early hint costs latency,
 * never an event. That is why `notify()` swallows every error and why the hint
 * may be published before the enqueuing transaction commits -- the worker
 * answers a hint with a short burst of fast polls, not a single read.
 *
 * Redis is already the realtime relay's transport; no new infrastructure.
 * Without REDIS_URL both ends are no-ops and the worker simply polls.
 */
export const outboxWakeChannel = (env: NodeJS.ProcessEnv = process.env): string =>
  `${env.QUEUE_PREFIX ?? 'jawwid'}:outbox:wake:v1`;

let publisher: Redis | null | undefined;

function publisherConnection(): Redis | null {
  if (publisher !== undefined) return publisher;
  const url = process.env.REDIS_URL;
  if (!url) return (publisher = null);
  publisher = new Redis(url, { maxRetriesPerRequest: 1 });
  publisher.on('error', () => undefined); // a hint; the poll is the guarantee
  // Never the reason a process stays alive: the API is kept up by its HTTP
  // server, and a test run or a CLI must be able to exit with this open.
  publisher.on('connect', () => (publisher as unknown as { stream?: { unref?: () => void } } | null)?.stream?.unref?.());
  return publisher;
}

/** Tell the worker there is (or is about to be) an outbox row. Never throws. */
export function notifyOutboxWake(): void {
  const conn = publisherConnection();
  if (!conn) return;
  conn.publish(outboxWakeChannel(), '1').catch(() => undefined);
}

/** For tests and shutdown: drop the shared publisher connection. */
export async function closeOutboxWake(): Promise<void> {
  const conn = publisher;
  publisher = undefined;
  if (conn) await conn.quit().catch(() => undefined);
}

/**
 * The worker's side: call `onWake` whenever a hint arrives. Returns a closer.
 * Null when there is no Redis to listen on.
 */
export async function listenForOutboxWake(onWake: () => void): Promise<(() => Promise<void>) | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const sub = new Redis(url, { maxRetriesPerRequest: null });
  sub.on('error', () => undefined);
  sub.on('message', (channel) => {
    if (channel === outboxWakeChannel()) onWake();
  });
  await sub.subscribe(outboxWakeChannel());
  return async () => {
    await sub.quit().catch(() => undefined);
  };
}

/**
 * The worker loop's timing, as a unit that can be tested without a process.
 *
 * Correctness never depends on a hint: every pass ends in `pause`, and every
 * pause ends -- after POLL when the last pass published something, after IDLE
 * when it did not. A hint only makes the next pass come sooner:
 *
 *   missed hint     -> the row is found by the next ordinary poll (<= IDLE).
 *   duplicate hints -> one early pass; extra hints in the window are no-ops.
 *   early/late hint -> a hint can arrive before the enqueuing transaction
 *                      commits, so it opens a short WINDOW of fast polls
 *                      rather than triggering a single read.
 */
export class OutboxPacer {
  private fastUntil = 0;
  private interrupt: (() => void) | null = null;

  constructor(
    private readonly timing: { pollMs: number; idleMs: number; wakePollMs: number; wakeWindowMs: number },
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** A hint arrived: poll fast for a while, and cut the current pause short. */
  wake(): void {
    this.fastUntil = this.clock() + this.timing.wakeWindowMs;
    this.interrupt?.();
  }

  /** How long to wait after a pass that published `published` rows. */
  delayAfter(published: number): number {
    if (this.clock() < this.fastUntil) return this.timing.wakePollMs;
    return published > 0 ? this.timing.pollMs : this.timing.idleMs;
  }

  /** Wait `ms`, or until the next hint, whichever comes first. */
  pause(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (this.interrupt === finish) this.interrupt = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.interrupt = finish;
    });
  }
}
