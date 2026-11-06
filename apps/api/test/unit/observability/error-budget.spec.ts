/**
 * The error-volume cap: an outage must not spend the month's Sentry quota.
 *
 * Two layers of assertion, like error-tracker.spec.ts: the budget on its own
 * (a fake clock, exact counts), and a real @sentry/node client on an in-memory
 * transport, so "1,000 failures put one event on the wire" is measured in the
 * bytes the SDK would send, not inferred from a mock.
 */
import * as Sentry from '@sentry/node';
import { performance } from 'node:perf_hooks';
import {
  DEFAULT_ERROR_BUDGET,
  ErrorBudget,
  errorKind,
  isCriticalReport,
} from '../../../src/infra/observability/error-budget';
import { scrubEvent, SentryErrorTracker } from '../../../src/infra/observability/sentry-error-tracker';
import {
  NoopErrorTracker,
  processErrorTracker,
  setProcessErrorTracker,
} from '../../../src/infra/observability/error-tracker';

const MIN = 60_000;

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('ErrorBudget — one kind', () => {
  it('sends the first failure of a kind at once', () => {
    const budget = new ErrorBudget({ now: clock().now });
    expect(budget.admit('k')).toEqual({ send: true, suppressed: 0 });
  });

  it('holds back the same kind inside the interval, then sends one carrying the count', () => {
    const c = clock();
    const budget = new ErrorBudget({ perKeyIntervalMs: 15 * MIN, now: c.now });
    expect(budget.admit('k').send).toBe(true);
    for (let i = 0; i < 999; i++) expect(budget.admit('k').send).toBe(false);
    c.advance(15 * MIN - 1);
    expect(budget.admit('k').send).toBe(false);
    c.advance(1);
    expect(budget.admit('k')).toEqual({ send: true, suppressed: 1000 });
    // The count starts again after it is reported.
    c.advance(15 * MIN);
    expect(budget.admit('k')).toEqual({ send: true, suppressed: 0 });
  });

  it('keeps kinds apart: a new fault on the same route is not hidden behind an old one', () => {
    const budget = new ErrorBudget({ now: clock().now });
    expect(budget.admit('a').send).toBe(true);
    expect(budget.admit('b').send).toBe(true);
    expect(budget.admit('a').send).toBe(false);
    expect(budget.admit('b').send).toBe(false);
  });
});

describe('ErrorBudget — across kinds', () => {
  it('caps a burst of DIFFERENT failures at the global limit per window', () => {
    const c = clock();
    const budget = new ErrorBudget({ globalLimit: 20, globalWindowMs: 60 * MIN, now: c.now });
    let sent = 0;
    for (let i = 0; i < 500; i++) if (budget.admit(`kind-${i}`).send) sent++;
    expect(sent).toBe(20);
    // A kind refused by the global limit was not marked sent: it goes as soon as there is room.
    c.advance(60 * MIN);
    expect(budget.admit('kind-499')).toEqual({ send: true, suppressed: 1 });
  });

  it('the window slides: room frees up as old sends age out', () => {
    const c = clock();
    const budget = new ErrorBudget({ globalLimit: 2, globalWindowMs: 10 * MIN, now: c.now });
    expect(budget.admit('a').send).toBe(true);
    c.advance(5 * MIN);
    expect(budget.admit('b').send).toBe(true);
    expect(budget.admit('c').send).toBe(false);
    c.advance(5 * MIN); // 'a' has aged out, 'b' has not
    expect(budget.admit('c').send).toBe(true);
    expect(budget.admit('d').send).toBe(false);
  });

  it('a critical report (the process is about to exit) skips both limits', () => {
    const budget = new ErrorBudget({ globalLimit: 1, now: clock().now });
    expect(budget.admit('a').send).toBe(true);
    expect(budget.admit('b').send).toBe(false); // global limit reached
    expect(budget.admit('crash', true).send).toBe(true);
    expect(budget.admit('crash', true).send).toBe(true); // per-kind interval does not apply either
    expect(budget.admit('a', true)).toEqual({ send: true, suppressed: 0 });
  });

  it('a critical report takes no room from ordinary ones', () => {
    const budget = new ErrorBudget({ globalLimit: 1, now: clock().now });
    expect(budget.admit('crash', true).send).toBe(true);
    expect(budget.admit('crash', true).send).toBe(true);
    expect(budget.admit('ordinary').send).toBe(true);
  });

  it('a clock that goes backwards never extends a suppression or fills the window', () => {
    const c = clock();
    const budget = new ErrorBudget({ globalLimit: 1, now: c.now });
    expect(budget.admit('k').send).toBe(true);
    c.advance(-60 * MIN); // the clock is corrected an hour back
    // The send dated "in the future" counts for nothing: the next report goes.
    expect(budget.admit('k')).toEqual({ send: true, suppressed: 0 });
  });

  it('by default the clock is monotonic, not the wall clock', () => {
    const wall = jest.spyOn(Date, 'now').mockReturnValue(0);
    try {
      const budget = new ErrorBudget({ perKeyIntervalMs: 1 });
      expect(budget.admit('k').send).toBe(true);
      // Date.now is frozen; only a monotonic clock can let the interval pass.
      const until = performance.now() + 5;
      while (performance.now() < until) { /* spin a few ms */ }
      expect(budget.admit('k').send).toBe(true);
    } finally {
      wall.mockRestore();
    }
  });

  it('remembers a bounded number of kinds, forgetting the least recently touched', () => {
    const c = clock();
    const budget = new ErrorBudget({ maxKeys: 3, globalLimit: 1000, now: c.now });
    for (const k of ['a', 'b', 'c']) budget.admit(k);
    budget.admit('a'); // touched: now most recent
    budget.admit('d'); // evicts 'b'
    expect(budget.admit('a').send).toBe(false);
    expect(budget.admit('b').send).toBe(true); // forgotten, so new again
  });

  it('the defaults keep a day-long outage of both processes far under a 5,000/month quota', () => {
    const perProcessPerDay = DEFAULT_ERROR_BUDGET.globalLimit * ((24 * 60 * MIN) / DEFAULT_ERROR_BUDGET.globalWindowMs);
    expect(perProcessPerDay * 2).toBeLessThan(1000);
    expect(DEFAULT_ERROR_BUDGET.perKeyIntervalMs).toBe(15 * MIN);
  });
});

describe('errorKind — labels only, never a message', () => {
  it('is built from component, route, status, class and Prisma code', () => {
    const e = Object.assign(new Error('x'), { name: 'PrismaClientKnownRequestError', code: 'P1001' });
    expect(errorKind(e, { component: 'worker', route: 'outbox.drain' })).toBe('worker|outbox.drain||PrismaClientKnownRequestError|P1001');
    expect(errorKind(new TypeError('y'), { component: 'api', route: 'GET /x', status: 500 })).toBe('api|GET /x|500|TypeError|');
  });

  it('two messages of the same class on the same route are one kind; the message never enters the key', () => {
    const a = errorKind(new Error('send to +201001234567 failed'), { route: 'r' });
    const b = errorKind(new Error('ابني مريض اليوم'), { route: 'r' });
    expect(a).toBe(b);
    expect(a).not.toContain('2010');
  });

  it('refuses a class name or code that is not a plain identifier', () => {
    const odd = Object.assign(new Error('x'), { name: 'Layla Example said hi', code: 'secret-code' });
    expect(errorKind(odd, {})).toBe('|||object|');
    expect(errorKind(odd, {})).not.toContain('Layla');
    expect(errorKind(odd, {})).not.toContain('secret');
    expect(errorKind('a string', {})).toBe('|||string|');
    expect(errorKind(null, {})).toBe('|||object|');
  });

  it('only the exit paths are critical', () => {
    expect(isCriticalReport({ route: 'process.uncaughtException' })).toBe(true);
    expect(isCriticalReport({ route: 'bootstrap' })).toBe(true);
    expect(isCriticalReport({ route: 'process.unhandledRejection' })).toBe(false);
    expect(isCriticalReport({ route: 'outbox.drain' })).toBe(false);
    expect(isCriticalReport({})).toBe(false);
  });
});

describe('scrubEvent keeps the suppressed count and nothing else new', () => {
  it('passes a positive integer, drops anything else under that name', () => {
    const base = { type: undefined, event_id: 'e' } as Sentry.ErrorEvent;
    expect(scrubEvent({ ...base, extra: { suppressed: 41 } }).extra).toEqual({ suppressed: 41 });
    for (const bad of ['41', 'ابني مريض اليوم', -1, 0, 1.5, { n: 1 }]) {
      expect(scrubEvent({ ...base, extra: { suppressed: bad } }).extra).toBeUndefined();
    }
  });
});

describe('the tracker applies the budget — measured on the wire', () => {
  const sent: string[] = [];
  const c = clock();
  let tracker: SentryErrorTracker;

  beforeAll(() => {
    tracker = new SentryErrorTracker(
      'https://publickey@sentry.example.test/1',
      'worker',
      { environment: 'test', commit: 'abc1234', version: '0.1.0' },
      {
        transport: (options) =>
          Sentry.createTransport(options, async (request) => {
            sent.push(typeof request.body === 'string' ? request.body : Buffer.from(request.body).toString('utf8'));
            return { statusCode: 200 };
          }),
      },
      new ErrorBudget({ now: c.now }),
    );
  });

  afterAll(async () => {
    await tracker.close(1000);
  });

  const events = () => sent.filter((body) => body.includes('"type":"event"'));

  it('a database outage hitting one subsystem 1,000 times sends one event', async () => {
    const outage = () => Object.assign(new Error('Can\'t reach database server'), { name: 'PrismaClientInitializationError' });
    for (let i = 0; i < 1000; i++) tracker.captureException(outage(), { component: 'worker', route: 'outbox.drain' });
    await Sentry.flush(2000);
    expect(events()).toHaveLength(1);
  });

  it('after the interval the next one goes, carrying how many were held back', async () => {
    c.advance(DEFAULT_ERROR_BUDGET.perKeyIntervalMs);
    tracker.captureException(Object.assign(new Error('x'), { name: 'PrismaClientInitializationError' }), {
      component: 'worker',
      route: 'outbox.drain',
    });
    await Sentry.flush(2000);
    expect(events()).toHaveLength(2);
    expect(events()[1]).toContain('"suppressed":999');
  });

  it('twenty subsystems failing on every loop turn for an hour stay inside the global limit', async () => {
    const before = events().length;
    c.advance(60 * MIN);
    for (let turn = 0; turn < 720; turn++) {
      // Distinct messages, as twenty real call sites would have: the SDK's
      // dedupe integration would otherwise drop the repeats on its own.
      for (let s = 0; s < 20; s++) tracker.captureException(new Error(`down ${s}`), { component: 'worker', route: `sub-${s}` });
      c.advance(5000);
    }
    await Sentry.flush(2000);
    // 720 turns x 20 subsystems = 14,400 failures in one hour.
    expect(events().length - before).toBe(DEFAULT_ERROR_BUDGET.globalLimit);
  });
});

describe('a failure inside reporting stays inside reporting', () => {
  it('a budget (or SDK) that throws never throws to the caller', async () => {
    const throwing = { admit: () => { throw new Error('exploded'); } } as unknown as ErrorBudget;
    const tracker = new SentryErrorTracker(
      'https://publickey@sentry.example.test/1',
      'api',
      { environment: 'test', commit: 'abc1234', version: '0.1.0' },
      { transport: (options) => Sentry.createTransport(options, async () => ({ statusCode: 200 })) },
      throwing,
    );
    expect(() => tracker.captureException(new Error('boom'), { route: 'r' })).not.toThrow();
    await tracker.close(500);
  });
});

describe('the process tracker registry', () => {
  afterEach(() => setProcessErrorTracker(new NoopErrorTracker()));

  it('is inert until an entrypoint sets it, so a harness reports nothing', () => {
    expect(processErrorTracker()).toBeInstanceOf(NoopErrorTracker);
  });

  it('returns what main.ts / worker.ts set', () => {
    const fake = new NoopErrorTracker();
    setProcessErrorTracker(fake);
    expect(processErrorTracker()).toBe(fake);
  });
});
