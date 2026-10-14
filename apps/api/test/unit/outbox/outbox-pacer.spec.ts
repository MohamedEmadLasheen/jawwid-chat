/**
 * The outbox worker's timing (OutboxPacer). The Redis wake hint is an
 * optimisation: these prove the loop still makes progress when hints are
 * missed, stays sane when they are duplicated, and copes with a hint that
 * arrives before the enqueuing transaction has committed.
 */
import { OutboxPacer, notifyOutboxWake } from '@communication/outbox/outbox-wake';

const TIMING = { pollMs: 1000, idleMs: 5000, wakePollMs: 50, wakeWindowMs: 2000 };

describe('OutboxPacer', () => {
  let now = 0;
  const clock = () => now;

  beforeEach(() => {
    jest.useFakeTimers();
    now = 0;
  });
  afterEach(() => jest.useRealTimers());

  it('MISSED hints: with no hint at all the loop still polls -- every pause ends', async () => {
    const pacer = new OutboxPacer(TIMING, clock);
    expect(pacer.delayAfter(0)).toBe(5000);
    expect(pacer.delayAfter(3)).toBe(1000);

    let resolved = false;
    void pacer.pause(pacer.delayAfter(0)).then(() => (resolved = true));
    await jest.advanceTimersByTimeAsync(4999);
    expect(resolved).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it('a hint cuts the current pause short', async () => {
    const pacer = new OutboxPacer(TIMING, clock);
    let resolved = false;
    void pacer.pause(5000).then(() => (resolved = true));
    await jest.advanceTimersByTimeAsync(10);
    pacer.wake();
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('DUPLICATE hints: a burst resolves one pause once and changes nothing else', async () => {
    const pacer = new OutboxPacer(TIMING, clock);
    let resolutions = 0;
    void pacer.pause(5000).then(() => resolutions++);
    for (let i = 0; i < 1000; i++) pacer.wake();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(resolutions).toBe(1);
    expect(pacer.delayAfter(0)).toBe(50); // still inside the window
  });

  it('EARLY hint (before the commit): a WINDOW of fast polls, then back to the idle backoff', () => {
    const pacer = new OutboxPacer(TIMING, clock);
    pacer.wake();
    // The first pass may find nothing (not committed yet): the next one is 50 ms away, not 5 s.
    expect(pacer.delayAfter(0)).toBe(50);
    now = 1999;
    expect(pacer.delayAfter(0)).toBe(50);
    now = 2000;
    expect(pacer.delayAfter(0)).toBe(5000);
  });

  it('a hint arriving while no pause is pending is not lost: it opens the window for the next delay', () => {
    const pacer = new OutboxPacer(TIMING, clock);
    pacer.wake(); // during a drain
    expect(pacer.delayAfter(7)).toBe(50);
  });

  it('a pause that already ended is not resolved again by a later hint', async () => {
    const pacer = new OutboxPacer(TIMING, clock);
    let resolutions = 0;
    void pacer.pause(10).then(() => resolutions++);
    await jest.advanceTimersByTimeAsync(10);
    pacer.wake();
    await Promise.resolve();
    expect(resolutions).toBe(1);
  });
});

describe('notifyOutboxWake', () => {
  it('without REDIS_URL it is a silent no-op: hints are never a precondition', () => {
    const saved = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      expect(() => notifyOutboxWake()).not.toThrow();
    } finally {
      if (saved !== undefined) process.env.REDIS_URL = saved;
    }
  });
});
