/**
 * How many frames one socket may send before it has stopped being a client and
 * started being a load generator. Phase 8.
 *
 * WHY THIS IS NOT THE DATABASE THROTTLE. Authenticated HTTP actions are counted
 * in chat.auth_throttle, which is durable and survives a restart. Frames cannot
 * be: `typing.start` fires per keystroke, and a database write per keystroke
 * would be a self-inflicted denial of service far worse than the abuse it
 * defends against.
 *
 * That trade is honest about what it buys. The resource being protected here is
 * ONE NODE'S CPU and event loop, and a socket lives on exactly one node for its
 * whole life -- so a per-process counter is not an approximation of the right
 * answer, it IS the right answer for this resource. What it does not do is
 * bound an attacker who opens a thousand sockets across a fleet; that is
 * connection-count defence, and it belongs at the edge.
 *
 * A fixed window, not a sliding one, and deliberately: a sliding window means
 * retaining a timestamp per frame, which is per-keystroke allocation on the
 * exact path this exists to keep cheap. The cost is that a client can send up
 * to 2x the limit across a window boundary. At 600/minute that is a burst of
 * 1200 in two seconds, which is still two orders of magnitude below what a
 * runaway loop produces and far above what a person can type.
 */
export class FrameBudget {
  private count = 0;
  private windowStartedAt: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    now: number = Date.now(),
  ) {
    this.windowStartedAt = now;
  }

  /**
   * Record one inbound frame. Returns false when the socket has exceeded its
   * budget and should be disconnected.
   *
   * The clock is a parameter so the behaviour is testable without waiting a
   * minute, and so a test cannot pass by accident of timing.
   */
  admit(now: number = Date.now()): boolean {
    if (now - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = now;
      this.count = 0;
    }
    this.count += 1;
    // `<=`: the limit is the number of frames ALLOWED, and the one after it is
    // refused -- the same way round as chat.record_auth_attempt reads p_limit.
    return this.count <= this.limit;
  }

  /** Frames recorded in the current window. Exposed for logging and tests. */
  get used(): number {
    return this.count;
  }
}
