/**
 * THE CLASS-SESSION PROJECTION, AND THE ATTENDANCE IT CARRIES.
 *
 * Jawwid Core is authoritative for both -- the integration contract is marked
 * authoritative and its section 8 says so -- and these tests hold Chat to being
 * a faithful projection rather than a second opinion.
 *
 * The properties under test are the ones a projection lives or dies on:
 * delivery is unordered and duplicated, dependencies arrive out of sequence,
 * and nothing may ever be deleted. Everything here drives the real boundary:
 * an event is recorded in chat.core_event and the processor drains it, exactly
 * as it will in production.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { NotificationType } from '@communication/contracts/notifications';
import { CommEvent } from '@communication/contracts/events';

const g = buildGraph();
let s: Scenario;

/** The learner as Core knows them: `core_child_id` is the join. */
let coreChildId: string;

const drainOutbox = () => g.outboxWorker.drain(200);

/** Record an event on the boundary exactly as chat.record_core_event does. */
async function coreEvent(
  eventType: string,
  payload: Record<string, unknown>,
  receivedAt = new Date(),
): Promise<void> {
  await g.prisma.$executeRaw`
    insert into chat.core_event (source, external_event_id, event_type, payload, received_at)
    values ('jawwid_core', ${randomUUID()}, ${eventType}, ${JSON.stringify(payload)}::jsonb,
            ${receivedAt}::timestamptz)`;
}

/** A class-session payload, as the contract's section 4 defines it. */
function sessionPayload(over: Record<string, unknown> = {}) {
  return {
    core_class_session_id: randomUUID(),
    core_child_id: coreChildId,
    core_teacher_id: null,
    starts_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
    ends_at: new Date(Date.now() + 48 * 3600_000 + 3600_000).toISOString(),
    join_url: 'https://core.invalid/room/abc',
    status: 'scheduled',
    ...over,
  };
}

/**
 * The same session, moved.
 *
 * `ends_at` travels with `starts_at`: the table's own check constraint refuses
 * a session that ends before it begins, which is worth having and is exactly
 * what a naive "change only starts_at" redelivery would trip over.
 */
function movedTo(payload: ReturnType<typeof sessionPayload>, startsAt: string) {
  return {
    ...payload,
    starts_at: startsAt,
    ends_at: new Date(new Date(startsAt).getTime() + 3600_000).toISOString(),
  };
}

async function sessionRow(coreId: string) {
  return g.prisma.classSession.findUnique({ where: { coreClassSessionId: coreId } });
}

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;

  // Give the seeded learner a Core identity, which is how every class session
  // finds its way to a family.
  coreChildId = randomUUID();
  await g.prisma.$executeRaw`
    update chat.learner set core_child_id = ${coreChildId}::uuid where id = ${s.learnerId}::uuid`;
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});

// =========================================================================
describe('a class session arriving from Core', () => {
  it('becomes a projection with a stable occurrence identity', async () => {
    const payload = sessionPayload();
    await coreEvent('class_session.upserted', payload);

    expect(await g.coreIngest.drain()).toBe(1);

    const row = (await sessionRow(payload.core_class_session_id))!;
    expect(row.learnerId).toBe(s.learnerId);
    expect(row.status).toBe('scheduled');
    expect(row.startsAt.toISOString()).toBe(payload.starts_at);
    expect(row.endsAt!.toISOString()).toBe(payload.ends_at);
    expect(row.joinUrl).toBe(payload.join_url);
    // The identity is Core's, and it is what everything else points at.
    expect(row.coreClassSessionId).toBe(payload.core_class_session_id);
  });

  it('is idempotent: the same event twice is one row', async () => {
    const payload = sessionPayload();
    await coreEvent('class_session.upserted', payload);
    await coreEvent('class_session.upserted', payload);

    await g.coreIngest.drain();

    expect(
      await g.prisma.classSession.count({
        where: { coreClassSessionId: payload.core_class_session_id },
      }),
    ).toBe(1);
  });

  it('a redelivery that moved the class updates in place', async () => {
    const payload = sessionPayload();
    await coreEvent('class_session.upserted', payload, new Date(Date.now() - 60_000));
    await g.coreIngest.drain();

    const moved = new Date(Date.now() + 72 * 3600_000).toISOString();
    await coreEvent(
      'class_session.upserted',
      { ...movedTo(payload, moved), status: 'rescheduled' },
      new Date(),
    );
    await g.coreIngest.drain();

    const row = (await sessionRow(payload.core_class_session_id))!;
    expect(row.startsAt.toISOString()).toBe(moved);
    expect(row.status).toBe('rescheduled');
    expect(
      await g.prisma.classSession.count({
        where: { coreClassSessionId: payload.core_class_session_id },
      }),
    ).toBe(1);
  });

  it('an OLDER event cannot regress a newer one', async () => {
    const payload = sessionPayload();
    const newer = new Date();
    const older = new Date(newer.getTime() - 3600_000);
    const newTime = new Date(Date.now() + 96 * 3600_000).toISOString();

    // The newer write lands first -- which is exactly what unordered delivery
    // looks like.
    await coreEvent('class_session.upserted', movedTo(payload, newTime), newer);
    await g.coreIngest.drain();

    await coreEvent('class_session.upserted', payload, older);
    await g.coreIngest.drain();

    const row = (await sessionRow(payload.core_class_session_id))!;
    // Last-writer-wins by SOURCE time, not by arrival.
    expect(row.startsAt.toISOString()).toBe(newTime);
  });

  it('a session for a learner Chat has never seen is not applicable, not an error',
    async () => {
      await coreEvent('class_session.upserted', sessionPayload({ core_child_id: randomUUID() }));

      // Consumed without writing: the class arrives with its student, or on the
      // next backfill. Core is told to stop retrying.
      expect(await g.coreIngest.drain()).toBe(0);
      expect(await g.prisma.classSession.count()).toBe(0);
      const row = await g.prisma.coreEventRow.findFirst();
      expect(row!.processedAt).not.toBeNull();
      expect(row!.error).toBeNull();
    });

  it('a malformed payload is refused and stays visible', async () => {
    await coreEvent('class_session.upserted', { core_child_id: coreChildId });

    expect(await g.coreIngest.drain()).toBe(0);

    const row = (await g.prisma.coreEventRow.findFirst())!;
    // Left unprocessed WITH its reason. A boundary disagreement is not
    // something to swallow: chat.sync_health counts it and a human sees it.
    expect(row.processedAt).toBeNull();
    expect(row.error).toContain('core_class_session_id is required');
    expect(await g.prisma.classSession.count()).toBe(0);
  });

  it('an unknown status is refused rather than coerced', async () => {
    await coreEvent('class_session.upserted', sessionPayload({ status: 'in_progress' }));
    await g.coreIngest.drain();

    const row = (await g.prisma.coreEventRow.findFirst())!;
    expect(row.error).toContain('unknown class session status');
    expect(await g.prisma.classSession.count()).toBe(0);
  });

  it('an event type this phase does not handle is left for whoever implements it',
    async () => {
      await coreEvent('enrollment.upserted', { core_enrollment_id: randomUUID() });

      await g.coreIngest.drain();

      // Not consumed, not errored: waiting.
      const row = (await g.prisma.coreEventRow.findFirst())!;
      expect(row.processedAt).toBeNull();
      expect(row.error).toBeNull();
    });
});

// =========================================================================
describe('cancellation', () => {
  it('retains the row and never deletes history', async () => {
    const payload = sessionPayload();
    await coreEvent('class_session.upserted', payload, new Date(Date.now() - 60_000));
    await g.coreIngest.drain();

    await coreEvent('class_session.cancelled', {
      core_class_session_id: payload.core_class_session_id,
    });
    await g.coreIngest.drain();

    const row = (await sessionRow(payload.core_class_session_id))!;
    // BR-5: nothing is ever deleted. The occurrence stays addressable, which is
    // what keeps any attendance already recorded against it meaningful.
    expect(row.status).toBe('cancelled');
    expect(row.startsAt.toISOString()).toBe(payload.starts_at);
    expect(await g.prisma.classSession.count()).toBe(1);
  });

  it('cancelling something Chat never mirrored is not an error', async () => {
    await coreEvent('class_session.cancelled', { core_class_session_id: randomUUID() });

    expect(await g.coreIngest.drain()).toBe(0);
    const row = (await g.prisma.coreEventRow.findFirst())!;
    expect(row.processedAt).not.toBeNull();
    expect(row.error).toBeNull();
  });
});

// =========================================================================
describe('attendance', () => {
  async function mirroredSession(startsAt?: string): Promise<string> {
    const payload = sessionPayload(
      startsAt ? { starts_at: startsAt, ends_at: null } : {},
    );
    await coreEvent('class_session.upserted', payload, new Date(Date.now() - 60_000));
    await g.coreIngest.drain();
    await drainOutbox();
    return payload.core_class_session_id;
  }

  it('class_attended is projected against the occurrence', async () => {
    const coreSession = await mirroredSession();
    await coreEvent('attendance.upserted', {
      core_class_session_id: coreSession,
      outcome: 'class_attended',
      recorded_at: new Date().toISOString(),
    });
    await g.coreIngest.drain();

    const row = (await g.prisma.classAttendance.findFirst())!;
    expect(row.outcome).toBe('class_attended');
    expect(row.learnerId).toBe(s.learnerId);
    // It points at the OCCURRENCE, not at a learner and a date.
    expect(row.classSessionId).toBe((await sessionRow(coreSession))!.id);
  });

  it('class_missed is projected the same way', async () => {
    const coreSession = await mirroredSession();
    await coreEvent('attendance.upserted', {
      core_class_session_id: coreSession,
      outcome: 'class_missed',
    });
    await g.coreIngest.drain();

    expect((await g.prisma.classAttendance.findFirst())!.outcome).toBe('class_missed');
  });

  it('a duplicate delivery is one fact, not two', async () => {
    const coreSession = await mirroredSession();
    const payload = { core_class_session_id: coreSession, outcome: 'class_missed' };
    await coreEvent('attendance.upserted', payload);
    await coreEvent('attendance.upserted', payload);
    await g.coreIngest.drain();

    expect(await g.prisma.classAttendance.count()).toBe(1);
  });

  it('a correction updates the outcome rather than adding a contradictory row',
    async () => {
      const coreSession = await mirroredSession();
      await coreEvent(
        'attendance.upserted',
        { core_class_session_id: coreSession, outcome: 'class_missed' },
        new Date(Date.now() - 60_000),
      );
      await g.coreIngest.drain();

      await coreEvent('attendance.upserted', {
        core_class_session_id: coreSession,
        outcome: 'class_attended',
      });
      await g.coreIngest.drain();

      const rows = await g.prisma.classAttendance.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].outcome).toBe('class_attended');
    });

  it('attendance for an occurrence Chat has not mirrored creates NO orphan', async () => {
    await coreEvent('attendance.upserted', {
      core_class_session_id: randomUUID(),
      outcome: 'class_missed',
    });

    expect(await g.coreIngest.drain()).toBe(0);
    // Held back rather than invented. Attaching this to a learner and a guessed
    // time would be a fact nobody asserted.
    expect(await g.prisma.classAttendance.count()).toBe(0);
    const row = (await g.prisma.coreEventRow.findFirst())!;
    expect(row.processedAt).not.toBeNull();
    expect(row.error).toBeNull();
  });

  it('an outcome outside the repository vocabulary is refused, not mapped', async () => {
    const coreSession = await mirroredSession();
    await coreEvent('attendance.upserted', {
      core_class_session_id: coreSession,
      outcome: 'late',
    });
    await g.coreIngest.drain();

    // `late` is not `class_attended` and not `class_missed`. Guessing which one
    // Core meant would write a fact nobody asserted, so it stops here, loudly.
    const row = (await g.prisma.coreEventRow.findFirst({ where: { error: { not: null } } }))!;
    expect(row.error).toContain('unmappable attendance outcome: late');
    expect(await g.prisma.classAttendance.count()).toBe(0);
  });
});

// =========================================================================
describe('the events the projection emits', () => {
  it('a first sighting is SCHEDULED, a move is RESCHEDULED', async () => {
    const payload = sessionPayload();
    await coreEvent('class_session.upserted', payload, new Date(Date.now() - 60_000));
    await g.coreIngest.drain();

    await coreEvent(
      'class_session.upserted',
      movedTo(payload, new Date(Date.now() + 96 * 3600_000).toISOString()),
    );
    await g.coreIngest.drain();

    const types = (await g.prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } }))
      .map((e) => e.type);
    expect(types).toEqual([
      CommEvent.CLASS_SESSION_SCHEDULED,
      CommEvent.CLASS_SESSION_RESCHEDULED,
    ]);
  });

  it('the projection and its event commit together', async () => {
    const payload = sessionPayload();
    await coreEvent('class_session.upserted', payload);
    await g.coreIngest.drain();

    // One transaction: a session Chat knows about always has the event that
    // would tell a parent about it, and an event never describes a session that
    // was never written.
    expect(await sessionRow(payload.core_class_session_id)).not.toBeNull();
    expect(await g.prisma.outboxEvent.count()).toBe(1);
  });

  it('a not-applicable event writes neither a projection nor an event', async () => {
    await coreEvent('class_session.upserted', sessionPayload({ core_child_id: randomUUID() }));
    await g.coreIngest.drain();

    expect(await g.prisma.classSession.count()).toBe(0);
    expect(await g.prisma.outboxEvent.count()).toBe(0);
  });

  it('a failed apply leaves no orphan event behind', async () => {
    await coreEvent('class_session.upserted', sessionPayload({ status: 'nonsense' }));
    await g.coreIngest.drain();

    // The transaction rolled back, so there is no outbox row promising a
    // notification about a class that was never projected.
    expect(await g.prisma.outboxEvent.count()).toBe(0);
    expect(await g.prisma.classSession.count()).toBe(0);
  });
});
