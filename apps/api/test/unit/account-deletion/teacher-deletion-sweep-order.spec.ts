import { Logger } from '@nestjs/common';
import { TeacherDeletionRequestService } from '../../../src/account-deletion/teacher-deletion-request.service';
import { ActorKind } from '../../../src/communication/contracts/vocab';

/**
 * PD-56 O-3, the worker's sweep: erasures run before reminders, and each
 * reminder is isolated. A reminder that throws (the notification store down,
 * a request cancelled between the select and the insert) must never hold a
 * deletion past its 30 days, must not stop the other reminders in the batch,
 * and is not marked, so the next sweep sends it again.
 *
 * The database is an in-memory fake that answers the sweep's queries by their
 * SQL text. Fixed instants (AGENTS.md: no today + N).
 */
const DAY_MS = 86_400_000;
const ORG = '00000000-0000-4000-8000-0000000000aa';
const DUE = '00000000-0000-4000-8000-00000000000a';
const FAILS = '00000000-0000-4000-8000-00000000000b';
const OK = '00000000-0000-4000-8000-00000000000c';
/** The two reminder requests were made 21 days before NOW: day 21 has come. */
const REQUESTED = new Date('2026-01-05T09:00:00Z');
const NOW = new Date(REQUESTED.getTime() + 21 * DAY_MS);

interface Req { id: string; state: 'pending' | 'completed'; requestedAt: Date; deadlineAt: Date }

function harness() {
  const order: string[] = [];
  const requests: Req[] = [
    // Requested 30 days before a deadline already past at NOW.
    { id: DUE, state: 'pending', requestedAt: new Date('2025-12-01T09:00:00Z'), deadlineAt: new Date('2025-12-31T09:00:00Z') },
    { id: FAILS, state: 'pending', requestedAt: REQUESTED, deadlineAt: new Date(REQUESTED.getTime() + 30 * DAY_MS) },
    { id: OK, state: 'pending', requestedAt: REQUESTED, deadlineAt: new Date(REQUESTED.getTime() + 30 * DAY_MS) },
  ];
  const marks = new Set<string>();
  const dayAt = (r: Req, now: Date) => (now.getTime() >= r.requestedAt.getTime() + 28 * DAY_MS ? 28 : 21);

  const prisma = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('$');
      if (sql.includes('NOT (id = ANY')) {
        // The due batch: pending, past the deadline, not failed in this sweep.
        const [now, failed, limit] = values as [Date, string[], number];
        return requests
          .filter((r) => r.state === 'pending' && r.deadlineAt <= now && !failed.includes(r.id))
          .slice(0, limit)
          .map((r) => ({ id: r.id }));
      }
      if (sql.includes('FROM chat.account_deletion_request r')) {
        // The reminder rows: pending, day 21 has come, before the deadline, today's day not marked.
        const now = values[0] as Date;
        return requests
          .filter((r) => r.state === 'pending'
            && r.requestedAt.getTime() + 21 * DAY_MS <= now.getTime()
            && r.deadlineAt > now
            && !marks.has(`${r.id}:${dayAt(r, now)}`))
          .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime() || a.id.localeCompare(b.id))
          .map((r) => ({ id: r.id, organization_id: ORG, teacher_id: `teacher-${r.id}`, requested_at: r.requestedAt, deadline_at: r.deadlineAt }));
      }
      if (sql.includes('FROM chat.work_task t')) {
        // The recipients: one Teachers manager, the same for every request.
        return [{ id: 'staff-manager' }];
      }
      if (sql.includes('FROM chat.work_task')) return [];
      if (sql.includes('erased_teacher_sweep')) return [{ r: {} }];
      throw new Error(`unexpected query: ${sql}`);
    }),
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('$');
      if (!sql.includes('INSERT INTO chat.account_deletion_reminder')) throw new Error(`unexpected statement: ${sql}`);
      const [id, days] = values as [string, number[]];
      let inserted = 0;
      for (const d of days) {
        if (!marks.has(`${id}:${d}`)) { marks.add(`${id}:${d}`); inserted += 1; }
      }
      order.push(`mark:${id}`);
      return inserted;
    }),
  };
  const deletion = {
    completeRequest: jest.fn(async (id: string) => {
      order.push(`erase:${id}`);
      requests.find((r) => r.id === id)!.state = 'completed';
      return { requestId: id, leftOpen: [] };
    }),
  };
  let failing = true;
  const pipeline = {
    emit: jest.fn(async (input: { dedupeKey: string }) => {
      const id = input.dedupeKey.split(':')[1];
      order.push(`emit:${id}`);
      if (id === FAILS && failing) throw new Error('notification store unavailable');
      return 'n-1';
    }),
  };
  const identity = {
    resolveActor: jest.fn(async (actorId: string) => ({
      actorId, kind: ActorKind.STAFF, isActive: true, organizationId: ORG, locale: 'ar',
    })),
  };
  const svc = new TeacherDeletionRequestService(prisma as never, deletion as never, pipeline as never, identity as never);
  return { svc, order, marks, deletion, pipeline, heal: () => { failing = false; } };
}

describe('O-3 sweep: erasures first, each reminder isolated', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('(a) a reminder that throws does not stop the sweep from erasing a due request', async () => {
    const h = harness();
    const out = await h.svc.sweep(NOW);
    expect(h.deletion.completeRequest).toHaveBeenCalledWith(DUE, null);
    expect(out).toMatchObject({ erased: 1, failed: 0 });
    // The failure is logged by name only, never the message.
    expect(warn).toHaveBeenCalledWith(`deletion request ${FAILS}: reminder not sent: Error`);
  });

  it('(b) erasures happen before any reminder is sent', async () => {
    const h = harness();
    await h.svc.sweep(NOW);
    const firstEmit = h.order.findIndex((x) => x.startsWith('emit:'));
    expect(h.order.indexOf(`erase:${DUE}`)).toBeGreaterThanOrEqual(0);
    expect(firstEmit).toBeGreaterThan(h.order.indexOf(`erase:${DUE}`));
  });

  it('(c) a failed reminder is not marked, and the next sweep sends it again', async () => {
    const h = harness();
    await h.svc.sweep(NOW);
    expect(h.marks.has(`${FAILS}:21`)).toBe(false);
    expect(h.order).not.toContain(`mark:${FAILS}`);

    h.heal();
    h.order.length = 0;
    const out = await h.svc.sweep(NOW);
    expect(out).toMatchObject({ reminded: 1, erased: 0 });
    expect(h.order).toEqual([`emit:${FAILS}`, `mark:${FAILS}`]);
    expect(h.marks.has(`${FAILS}:21`)).toBe(true);

    // And then it is done: a third sweep sends nothing.
    h.order.length = 0;
    expect(await h.svc.sweep(NOW)).toMatchObject({ reminded: 0, erased: 0 });
    expect(h.order).toEqual([]);
  });

  it('(d) the other reminders in the batch are still sent and counted', async () => {
    const h = harness();
    const out = await h.svc.sweep(NOW);
    // FAILS comes first in the batch (same instant, lower id); OK after it is still sent and marked.
    expect(h.order).toEqual([`erase:${DUE}`, `emit:${FAILS}`, `emit:${OK}`, `mark:${OK}`]);
    expect(h.marks.has(`${OK}:21`)).toBe(true);
    expect(out.reminded).toBe(1);
  });
});
