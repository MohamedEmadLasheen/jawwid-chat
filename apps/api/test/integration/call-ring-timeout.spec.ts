/**
 * A call that nobody answers must still end.
 *
 * Before this, `call.ring_timeout_seconds` was seeded at 45 in chat.config and
 * read by nothing: an unanswered call stayed `ringing` in the database forever,
 * the caller's screen never left "Calling…", and no missed-call history row
 * ever appeared.
 *
 * WHAT IS REAL HERE. The database, the migration chain, the real
 * `CallService.expireRingingCalls()`, real transactions, real row locks, and
 * the configured timeout read from `chat.config` — not a constant this file
 * invented. The concurrency tests race genuine transactions against genuine
 * Postgres; none of them is a mock, because a mock cannot demonstrate database
 * atomicity, which is the entire property under test.
 *
 * HOW A DEADLINE IS REACHED WITHOUT WAITING 45 SECONDS. The deadline is
 * `started_at + timeout`, so a test ages the call by moving `started_at` into
 * the past. That is the same arithmetic the sweep performs, evaluated by the
 * same database clock — no fake timers, and no test-only timeout constant that
 * could drift from the configured one.
 */
import { randomUUID } from 'node:crypto';
import { CommErrorCode } from '@platform/errors';
import { CommEvent } from '@communication/contracts/events';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

/** The configured timeout — read, never assumed. */
let ringTimeoutSeconds: number;

async function snapshot(callId: string) {
  const call = await g.prisma.call.findUnique({ where: { id: callId } });
  const participants = await g.prisma.callParticipant.findMany({
    where: { callId },
    orderBy: { actorId: 'asc' },
  });
  return {
    status: call?.status,
    outcome: call?.outcome ?? null,
    answeredAt: call?.answeredAt ?? null,
    endedAt: call?.endedAt ?? null,
    durationSeconds: call?.durationSeconds ?? null,
    joinedAts: participants.map((p) => p.joinedAt ?? null),
  };
}

const terminalEvents = async (callId: string) => {
  const rows = await g.prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.filter(
    (r) =>
      r.type === CommEvent.CALL_ENDED &&
      (r.payload as { callId?: string })?.callId === callId,
  );
};

async function directCall() {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.teacherId);
  const { callId } = await g.calls.start(conv.id, s.teacherId);
  return { conversationId: conv.id, callId };
}

/** Move a call's start time back by `seconds`, using the database's own clock. */
async function ageCall(callId: string, seconds: number): Promise<void> {
  await g.prisma.$executeRawUnsafe(
    `update chat.call
        set started_at = now() - make_interval(secs => ${seconds})
      where id = '${callId}'::uuid`,
  );
}

/** Just past the deadline. */
const pastDeadline = (callId: string) => ageCall(callId, ringTimeoutSeconds + 5);

beforeAll(async () => {
  await g.prisma.$connect();
  ringTimeoutSeconds = await g.config.get('call.ring_timeout_seconds');
});
afterAll(async () => { await g.prisma.$disconnect(); });
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  g.config.invalidate();
});

// -------------------------------------------------------------------------
describe('the configured timeout is the only timeout', () => {
  it('comes from chat.config, and the seeded value is what the sweep uses', async () => {
    const row = await g.prisma.config.findUnique({
      where: { key: 'call.ring_timeout_seconds' },
    });
    // The database row is authoritative; the TypeScript table is only a
    // fallback. If these ever disagree the sweep follows the row, so this
    // asserts the row exists rather than trusting the constant.
    expect(row?.value).toBe(ringTimeoutSeconds);
    expect(ringTimeoutSeconds).toBeGreaterThan(0);
  });

  it('changing the configured value changes the deadline, with no second constant to update', async () => {
    const { callId } = await directCall();
    await ageCall(callId, 20);

    // 20s old, 45s timeout: not yet due.
    expect(await g.calls.expireRingingCalls()).toBe(0);

    await g.prisma.config.update({
      where: { key: 'call.ring_timeout_seconds' },
      data: { value: 10 },
    });
    g.config.invalidate();
    try {
      // Same call, same age, shorter timeout: now due.
      expect(await g.calls.expireRingingCalls()).toBe(1);
      expect((await snapshot(callId)).outcome).toBe('missed');
    } finally {
      await g.prisma.config.update({
        where: { key: 'call.ring_timeout_seconds' },
        data: { value: ringTimeoutSeconds },
      });
      g.config.invalidate();
    }
  });
});

// -------------------------------------------------------------------------
describe('A/B/C — the deadline', () => {
  it('A. a call ringing BEFORE its deadline is left alone', async () => {
    const { callId } = await directCall();
    const before = await snapshot(callId);

    expect(await g.calls.expireRingingCalls()).toBe(0);
    expect(await snapshot(callId)).toEqual(before);
    expect(await terminalEvents(callId)).toHaveLength(0);
  });

  it('A2. one second short of the deadline is still before it', async () => {
    const { callId } = await directCall();
    await ageCall(callId, ringTimeoutSeconds - 1);

    expect(await g.calls.expireRingingCalls()).toBe(0);
    expect((await snapshot(callId)).status).toBe('ringing');
  });

  it('B/C. a call ringing past its deadline expires', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);

    expect(await g.calls.expireRingingCalls()).toBe(1);

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    expect(after.outcome).toBe('missed');
    expect(after.endedAt).toBeInstanceOf(Date);
  });

  it('expires several overdue calls in one pass, and leaves the fresh one ringing', async () => {
    const overdue = [await directCall(), await directCall()];
    const fresh = await directCall();
    for (const c of overdue) await pastDeadline(c.callId);

    expect(await g.calls.expireRingingCalls()).toBe(2);

    for (const c of overdue) expect((await snapshot(c.callId)).status).toBe('ended');
    expect((await snapshot(fresh.callId)).status).toBe('ringing');
  });
});

// -------------------------------------------------------------------------
describe('D/E/F/G — a call that already reached a terminal state', () => {
  it('D. an accepted call is never expired, however long it has been up', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await pastDeadline(callId); // age it well past the ring deadline
    const answered = await snapshot(callId);

    expect(await g.calls.expireRingingCalls()).toBe(0);
    expect(await snapshot(callId)).toEqual(answered);
    expect(answered.status).toBe('active');
  });

  it('E. a declined call: the participant left, but the call itself is still ringing and does expire', async () => {
    // Declining marks the participant, not the call -- there is no
    // caller-cancelled/declined CALL STATUS in this schema, and Phase 11 did
    // not invent one. The sweep is what gives that call its terminal state.
    const { callId } = await directCall();
    await g.calls.decline(callId, s.parentId);
    expect((await snapshot(callId)).status).toBe('ringing');

    await pastDeadline(callId);
    expect(await g.calls.expireRingingCalls()).toBe(1);
    expect((await snapshot(callId)).outcome).toBe('missed');
  });

  it('F. an ended call is not touched, and its outcome is not rewritten', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);
    const ended = await snapshot(callId);
    expect(ended.outcome).toBe('answered');

    await pastDeadline(callId);
    expect(await g.calls.expireRingingCalls()).toBe(0);
    // Crucially: still `answered`, not overwritten with `missed`.
    expect(await snapshot(callId)).toEqual(ended);
  });

  it('G. reconciliation is idempotent: a second pass over an expired call does nothing', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);

    expect(await g.calls.expireRingingCalls()).toBe(1);
    const afterFirst = await snapshot(callId);

    for (let i = 0; i < 5; i += 1) {
      expect(await g.calls.expireRingingCalls()).toBe(0);
    }

    expect(await snapshot(callId)).toEqual(afterFirst);
    expect(await terminalEvents(callId)).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------
describe('H/I/J/K — races, against the real database', () => {
  it('H. accept vs timeout: exactly one wins, and the record agrees with itself', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);

    const [acceptResult, expired] = await Promise.allSettled([
      g.calls.accept(callId, s.parentId),
      g.calls.expireRingingCalls(),
    ]);

    const after = await snapshot(callId);
    const events = await terminalEvents(callId);

    if (acceptResult.status === 'fulfilled' && after.status === 'active') {
      // Accept won: the sweep re-checked under the lock and did not match.
      expect(after.answeredAt).toBeInstanceOf(Date);
      expect(expired.status === 'fulfilled' ? expired.value : -1).toBe(0);
      expect(events).toHaveLength(0);
    } else {
      // The sweep won: the call is missed and accept was refused.
      expect(after.status).toBe('ended');
      expect(after.outcome).toBe('missed');
      expect(after.answeredAt).toBeNull();
      expect(events).toHaveLength(1);
    }
  });

  it('I. decline vs timeout: one terminal outcome, never two', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);

    await Promise.allSettled([
      g.calls.decline(callId, s.parentId),
      g.calls.expireRingingCalls(),
    ]);

    const after = await snapshot(callId);
    // Whatever the order, the call is in exactly one state and carries at most
    // one terminal event.
    expect(['ringing', 'ended']).toContain(after.status);
    expect((await terminalEvents(callId)).length).toBeLessThanOrEqual(1);
    if (after.status === 'ended') expect(after.outcome).toBe('missed');
  });

  it('J. end vs timeout: the outcome is never both answered and missed', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await pastDeadline(callId);

    await Promise.allSettled([
      g.calls.end(callId, s.teacherId),
      g.calls.expireRingingCalls(),
    ]);

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    // It was answered, so it ended answered. The sweep could not have claimed
    // it: it was no longer ringing.
    expect(after.outcome).toBe('answered');
    expect(await terminalEvents(callId)).toHaveLength(1);
  });

  it('K. two workers sweeping at once expire each call exactly once', async () => {
    const calls = [await directCall(), await directCall(), await directCall()];
    for (const c of calls) await pastDeadline(c.callId);

    // Four concurrent sweeps, as four worker replicas would.
    const counts = await Promise.all([
      g.calls.expireRingingCalls(),
      g.calls.expireRingingCalls(),
      g.calls.expireRingingCalls(),
      g.calls.expireRingingCalls(),
    ]);

    // Between them they expired every call, and no call twice.
    expect(counts.reduce((a, b) => a + b, 0)).toBe(calls.length);
    for (const c of calls) {
      expect((await snapshot(c.callId)).outcome).toBe('missed');
      expect(await terminalEvents(c.callId)).toHaveLength(1);
    }
  });

  it('K2. a sweep running while another holds the row does not block forever or double-expire', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => g.calls.expireRingingCalls()),
    );
    expect(results.filter((n) => n === 1)).toHaveLength(1);
    expect(await terminalEvents(callId)).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------
describe('L/M/N — transactional guarantees', () => {
  it('M. a committed expiry leaves exactly one terminal event for the outbox', async () => {
    const { conversationId, callId } = await directCall();
    await pastDeadline(callId);

    await g.calls.expireRingingCalls();

    const events = await terminalEvents(callId);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('pending');
    expect(events[0].payload).toEqual({
      callId,
      conversationId,
      outcome: 'missed',
      durationSeconds: 0,
    });
  });

  it('L. a rolled-back expiry leaves neither the terminal state nor the event', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);
    const before = await snapshot(callId);
    const eventsBefore = await g.prisma.outboxEvent.count();

    // The same work the sweep does, inside a transaction that then fails.
    await expect(
      g.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `update chat.call set status='ended', ended_at=now(), outcome='missed', duration_seconds=0
            where id = '${callId}'::uuid and status='ringing'`,
        );
        await g.outbox.enqueue(tx, CommEvent.CALL_ENDED, {
          callId,
          conversationId: randomUUID(),
          outcome: 'missed',
          durationSeconds: 0,
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await snapshot(callId)).toEqual(before);
    expect(await g.prisma.outboxEvent.count()).toBe(eventsBefore);
    // And the call is still ringing, so the next sweep still finds it.
    expect(await g.calls.expireRingingCalls()).toBe(1);
  });

  it('N. repeated reconciliation never produces a second terminal event', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);

    for (let i = 0; i < 4; i += 1) await g.calls.expireRingingCalls();

    expect(await terminalEvents(callId)).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------
describe('O/P — history tells the truth about an unanswered call', () => {
  it('answered_at stays null and no participant is marked as having joined', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);
    await g.calls.expireRingingCalls();

    const after = await snapshot(callId);
    expect(after.answeredAt).toBeNull();                    // O
    expect(after.joinedAts).toEqual([null, null]);          // P
    expect(after.outcome).toBe('missed');
    expect(after.durationSeconds).toBe(0);
  });

  it('participants stop being on the call, without being marked as having answered', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);
    await g.calls.expireRingingCalls();

    const participants = await g.prisma.callParticipant.findMany({ where: { callId } });
    expect(participants.every((p) => p.leftAt !== null)).toBe(true);
    expect(participants.every((p) => p.joinedAt === null)).toBe(true);
  });

  it('the expired call is still readable as history, by the existing rules', async () => {
    const { conversationId, callId } = await directCall();
    await pastDeadline(callId);
    await g.calls.expireRingingCalls();

    const history = await g.calls.history(conversationId, s.parentId);
    const entry = history.find((h) => h.id === callId);
    expect(entry).toMatchObject({ status: 'ended', outcome: 'missed', durationSeconds: 0 });

    // And an unrelated actor still cannot read it.
    await expect(g.calls.history(conversationId, s.unrelatedTeacherId)).rejects.toMatchObject({
      code: CommErrorCode.NOT_CONVERSATION_MEMBER,
    });
  });
});

// -------------------------------------------------------------------------
describe('Q/R/S/T — security and isolation', () => {
  it('R. an expired call cannot issue a media token', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);
    await g.calls.expireRingingCalls();

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });
  });

  it('Q. an expired call cannot be accepted or declined afterwards', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);
    await g.calls.expireRingingCalls();
    const expired = await snapshot(callId);

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });
    await expect(g.calls.decline(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });

    // The Phase 9 chain is intact and the record did not move.
    expect(await snapshot(callId)).toEqual(expired);
  });

  it('Q2. the sweep takes no actor and cannot be aimed by one', async () => {
    // A server-owned lifecycle operation: its only inputs are the configured
    // timeout and the database clock. There is no call id, actor id, status or
    // timestamp a caller could supply to influence which calls it touches.
    // Zero REQUIRED parameters: there is nothing a caller must supply, and
    // therefore nothing a caller can supply that selects a call. The one
    // optional parameter is a batch size.
    expect(g.calls.expireRingingCalls).toHaveLength(0);

    const { callId } = await directCall();
    await pastDeadline(callId);
    expect(await g.calls.expireRingingCalls()).toBe(1);

    // And the source takes its deadline from the database clock, not from an
    // argument or an application timestamp.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const source = readFileSync(
      `${__dirname}/../../src/communication/calls/call.service.ts`,
      'utf8',
    );
    const sweep = source.slice(source.indexOf('async expireRingingCalls'));
    const body = sweep.slice(0, sweep.indexOf('\n  }'));
    expect(body).toMatch(/now\(\) - make_interval/);
    expect(body).not.toMatch(/new Date\(\)\.getTime|Date\.now\(\)/);
  });

  it('S. cross-conversation: expiring one call leaves another conversation\'s call ringing', async () => {
    const overdue = await directCall();
    const otherConv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const { callId: otherCall } = await g.calls.start(otherConv.id, s.ownerId);

    await pastDeadline(overdue.callId);
    expect(await g.calls.expireRingingCalls()).toBe(1);

    expect((await snapshot(overdue.callId)).status).toBe('ended');
    expect((await snapshot(otherCall)).status).toBe('ringing');
    expect(await terminalEvents(otherCall)).toHaveLength(0);
  });

  it('T. tenant isolation is not exercisable here, and this records why', async () => {
    // The sweep is deliberately organization-agnostic: it is a system operation
    // over every tenant's overdue calls, and adding a tenant filter would mean
    // deciding WHOSE clock it runs on.
    //
    // A cross-tenant test cannot be written today regardless: RT-030 --
    // getOrCreateDirect never sets organization_id, so every conversation lands
    // in the default organization and a second tenant's call cannot be created
    // through the service at all. Asserted rather than left as a silent gap.
    const conversations = await g.prisma.conversation.findMany({
      select: { organizationId: true },
    });
    const organizations = new Set(conversations.map((c) => c.organizationId));
    expect(organizations.size).toBeLessThanOrEqual(1);
  });
});
