/**
 * THE WIRE, END TO END.
 *
 * A signed HTTP delivery from Jawwid Core, through authentication, the
 * envelope, the `chat.core_event` ledger and the existing processor, into the
 * class-session and attendance projections that were built and frozen in the
 * previous phase.
 *
 * Nothing downstream is re-tested here -- it has its own suites. What is tested
 * is that the wire delivers to it faithfully, and in particular that
 * `occurred_at` survives the whole way: the envelope's SOURCE time is what
 * orders entities, and the moment the HTTP request happened to arrive orders
 * nothing.
 *
 * The controller is driven directly with a fake request and response. The
 * cryptography has its own exhaustive unit suite; what needs a database is
 * everything after it.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { CoreWebhookController } from '@communication/core/core-webhook.controller';
import { expectedSignature } from '@communication/core/core-webhook.verifier';
import { MAX_BODY_BYTES } from '@communication/core/core-webhook.config';

const g = buildGraph();
let s: Scenario;
let coreChildId: string;

const KEY_ID = 'core-2026-09';
const SECRET = 'a-shared-secret-from-the-core-team';

/** What the controller writes back, captured rather than sent. */
interface Captured {
  status: number;
  body: Record<string, unknown>;
}

function fakeResponse(): { res: never; captured: Captured } {
  const captured: Captured = { status: 0, body: {} };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      return this;
    },
  };
  return { res: res as never, captured };
}

/** Build the controller against whatever secrets this test wants configured. */
function controllerWith(secrets: string | undefined): CoreWebhookController {
  const previous = process.env.CORE_WEBHOOK_SECRETS;
  if (secrets === undefined) delete process.env.CORE_WEBHOOK_SECRETS;
  else process.env.CORE_WEBHOOK_SECRETS = secrets;
  // Config is read at construction, so the controller is built after the
  // environment is set -- the same order a deployment has.
  const controller = new CoreWebhookController(g.coreIngest, g.prisma, g.audit);
  if (previous === undefined) delete process.env.CORE_WEBHOOK_SECRETS;
  else process.env.CORE_WEBHOOK_SECRETS = previous;
  return controller;
}

const configured = () => controllerWith(`${KEY_ID}:${SECRET}`);

/**
 * Deliver one envelope, signed the way Core would sign it.
 *
 * `raw` may be supplied directly so a test can send bytes that are not what
 * `JSON.stringify` would produce.
 */
async function deliver(
  controller: CoreWebhookController,
  envelope: unknown,
  options: {
    raw?: Buffer;
    keyId?: string;
    timestamp?: string;
    signature?: string;
  } = {},
): Promise<Captured> {
  const raw = options.raw ?? Buffer.from(JSON.stringify(envelope), 'utf8');
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = options.signature ?? expectedSignature(SECRET, timestamp, raw);
  const { res, captured } = fakeResponse();

  await controller.receive(
    { rawBody: raw } as never,
    res,
    options.keyId ?? KEY_ID,
    timestamp,
    signature,
  );
  return captured;
}

/** A class-session envelope, as the contract's section 4 defines the payload. */
function sessionEnvelope(over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return {
    event_id: randomUUID(),
    event_type: 'class_session.upserted',
    occurred_at: new Date().toISOString(),
    data: {
      core_class_session_id: randomUUID(),
      core_child_id: coreChildId,
      starts_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
      status: 'scheduled',
      ...data,
    },
    ...over,
  };
}

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  coreChildId = randomUUID();
  await g.prisma.$executeRaw`
    update chat.learner set core_child_id = ${coreChildId}::uuid where id = ${s.learnerId}::uuid`;
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});

// =========================================================================
describe('a signed delivery reaches the projection', () => {
  it('applies a class session and answers 200 applied', async () => {
    const envelope = sessionEnvelope();
    const result = await deliver(configured(), envelope);

    expect(result).toEqual({ status: 200, body: { status: 'applied' } });

    const row = (await g.prisma.classSession.findUnique({
      where: { coreClassSessionId: (envelope.data as never as { core_class_session_id: string }).core_class_session_id },
    }))!;
    expect(row.learnerId).toBe(s.learnerId);
    expect(row.status).toBe('scheduled');
  });

  it('cancels one, retaining the row', async () => {
    const created = sessionEnvelope();
    const coreSessionId = (created.data as never as { core_class_session_id: string })
      .core_class_session_id;
    await deliver(configured(), created);

    const cancelled = await deliver(configured(), {
      event_id: randomUUID(),
      event_type: 'class_session.cancelled',
      occurred_at: new Date().toISOString(),
      data: { core_class_session_id: coreSessionId },
    });

    expect(cancelled.body).toEqual({ status: 'applied' });
    expect(
      (await g.prisma.classSession.findUnique({ where: { coreClassSessionId: coreSessionId } }))!
        .status,
    ).toBe('cancelled');
  });

  it('applies attendance, and a missed class notifies the parent', async () => {
    const created = sessionEnvelope();
    const coreSessionId = (created.data as never as { core_class_session_id: string })
      .core_class_session_id;
    await deliver(configured(), created);
    await g.outboxWorker.drain(200);

    const attendance = await deliver(configured(), {
      event_id: randomUUID(),
      event_type: 'attendance.upserted',
      occurred_at: new Date().toISOString(),
      data: { core_class_session_id: coreSessionId, outcome: 'class_missed' },
    });
    expect(attendance.body).toEqual({ status: 'applied' });
    await g.outboxWorker.drain(200);

    // The existing notification platform, reached through the existing outbox
    // and the existing registry. Nothing about it changed in this phase.
    const told = await g.prisma.notification.findMany({ where: { type: 'CLASS_MISSED' } });
    expect(told.map((n) => n.recipientId)).toContain(s.parentId);
  });

  it('an allowlisted type with no processor yet is accepted and left waiting', async () => {
    const result = await deliver(configured(), {
      event_id: randomUUID(),
      event_type: 'payment.upserted',
      occurred_at: new Date().toISOString(),
      data: { core_payment_id: randomUUID() },
    });

    // `not_applicable` tells Core to stop retrying, and the delivery stays
    // unprocessed in the ledger so whoever implements payments finds it.
    expect(result).toEqual({ status: 200, body: { status: 'not_applicable' } });
    const row = (await g.prisma.coreEventRow.findFirst())!;
    expect(row.processedAt).toBeNull();
    expect(row.occurredAt).not.toBeNull();
  });
});

// =========================================================================
describe('occurred_at survives the whole pipeline', () => {
  it('the ledger stores it separately from received_at', async () => {
    const happenedAt = new Date('2026-09-20T08:30:00.000Z');
    await deliver(configured(), sessionEnvelope({ occurred_at: happenedAt.toISOString() }));

    const row = (await g.prisma.coreEventRow.findFirst())!;
    expect(row.occurredAt!.toISOString()).toBe(happenedAt.toISOString());
    // Two different concepts, two different columns. received_at is when the
    // request arrived -- minutes ago, not four days ago.
    expect(row.receivedAt.getTime()).toBeGreaterThan(happenedAt.getTime());
  });

  it('it becomes the projection’s core_synced_at', async () => {
    const happenedAt = new Date('2026-09-20T08:30:00.000Z');
    const envelope = sessionEnvelope({ occurred_at: happenedAt.toISOString() });
    await deliver(configured(), envelope);

    const session = (await g.prisma.classSession.findFirst())!;
    expect(session.coreSyncedAt.toISOString()).toBe(happenedAt.toISOString());
  });

  it('a BACKFILL is accepted: an old event with a fresh HTTP timestamp', async () => {
    const lastMonth = new Date(Date.now() - 30 * 24 * 3600_000);

    // The HTTP timestamp is now -- the delivery is fresh. The business time is
    // a month old, which is what a backfill IS. Refusing it for that would make
    // catching up impossible.
    const result = await deliver(
      configured(),
      sessionEnvelope({ occurred_at: lastMonth.toISOString() }),
    );

    expect(result.body).toEqual({ status: 'applied' });
    expect((await g.prisma.classSession.findFirst())!.coreSyncedAt.toISOString()).toBe(
      lastMonth.toISOString(),
    );
  });

  it('but a backfill cannot overwrite newer state', async () => {
    const coreSessionId = randomUUID();
    const newTime = new Date(Date.now() + 96 * 3600_000);

    // Today's truth lands first.
    await deliver(
      configured(),
      sessionEnvelope(
        { occurred_at: new Date().toISOString() },
        { core_class_session_id: coreSessionId, starts_at: newTime.toISOString() },
      ),
    );

    // Then a month-old backfill arrives describing the same session.
    await deliver(
      configured(),
      sessionEnvelope(
        { occurred_at: new Date(Date.now() - 30 * 24 * 3600_000).toISOString() },
        {
          core_class_session_id: coreSessionId,
          starts_at: new Date(Date.now() + 12 * 3600_000).toISOString(),
        },
      ),
    );

    // Last-writer-wins by SOURCE time. Ordering by arrival would have let the
    // older fact win, which is the exact failure occurred_at exists to prevent.
    const session = (await g.prisma.classSession.findUnique({
      where: { coreClassSessionId: coreSessionId },
    }))!;
    expect(session.startsAt.toISOString()).toBe(newTime.toISOString());
  });

  it('an equal occurred_at applies, so a corrected redelivery lands', async () => {
    const coreSessionId = randomUUID();
    const at = new Date('2026-09-21T09:00:00.000Z').toISOString();
    const first = new Date(Date.now() + 48 * 3600_000).toISOString();
    const corrected = new Date(Date.now() + 72 * 3600_000).toISOString();

    await deliver(
      configured(),
      sessionEnvelope({ occurred_at: at }, { core_class_session_id: coreSessionId, starts_at: first }),
    );
    await deliver(
      configured(),
      sessionEnvelope(
        { occurred_at: at },
        { core_class_session_id: coreSessionId, starts_at: corrected },
      ),
    );

    expect(
      (await g.prisma.classSession.findUnique({ where: { coreClassSessionId: coreSessionId } }))!
        .startsAt.toISOString(),
    ).toBe(corrected);
  });
});

// =========================================================================
describe('idempotency', () => {
  it('the same event_id twice is applied then duplicate', async () => {
    const envelope = sessionEnvelope();

    expect((await deliver(configured(), envelope)).body).toEqual({ status: 'applied' });
    expect((await deliver(configured(), envelope)).body).toEqual({ status: 'duplicate' });

    expect(await g.prisma.classSession.count()).toBe(1);
    expect(await g.prisma.coreEventRow.count()).toBe(1);
  });

  it('a RECORDED BUT FAILED delivery is retryable, not a duplicate', async () => {
    const envelope = sessionEnvelope();

    // The apply fails after the ledger row exists -- a crash mid-apply.
    const spy = jest
      .spyOn(g.coreIngest as never as { apply: () => Promise<never> }, 'apply')
      .mockRejectedValueOnce(new Error('database went away'));
    const failed = await deliver(configured(), envelope);
    spy.mockRestore();

    expect(failed.status).toBe(500);
    const recorded = (await g.prisma.coreEventRow.findFirst())!;
    expect(recorded.processedAt).toBeNull();
    expect(recorded.error).toContain('database went away');

    // Core retries. This must NOT come back as a duplicate: reporting one
    // would tell Core to stop retrying something that never landed.
    const retried = await deliver(configured(), envelope);
    expect(retried.body).toEqual({ status: 'applied' });
    expect(await g.prisma.classSession.count()).toBe(1);
  });

  it('concurrent deliveries of the same event converge on one row', async () => {
    const envelope = sessionEnvelope();
    const controller = configured();

    const results = await Promise.allSettled([
      deliver(controller, envelope),
      deliver(controller, envelope),
      deliver(controller, envelope),
    ]);

    // Whatever the interleaving, the fact exists once and the ledger holds one
    // delivery. The unique (source, external_event_id) is the arbiter.
    expect(await g.prisma.classSession.count()).toBe(1);
    expect(await g.prisma.coreEventRow.count()).toBe(1);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });
});

// =========================================================================
describe('the envelope', () => {
  const badEnvelopes: [string, unknown][] = [
    ['no event_id', { event_type: 'class_session.upserted', occurred_at: new Date().toISOString(), data: {} }],
    ['empty event_id', { event_id: '  ', event_type: 'class_session.upserted', occurred_at: new Date().toISOString(), data: {} }],
    ['no event_type', { event_id: 'e1', occurred_at: new Date().toISOString(), data: {} }],
    ['no occurred_at', { event_id: 'e1', event_type: 'class_session.upserted', data: {} }],
    ['unparsable occurred_at', { event_id: 'e1', event_type: 'class_session.upserted', occurred_at: 'the day before yesterday', data: {} }],
    ['no data', { event_id: 'e1', event_type: 'class_session.upserted', occurred_at: new Date().toISOString() }],
    ['data is not an object', { event_id: 'e1', event_type: 'class_session.upserted', occurred_at: new Date().toISOString(), data: 'nope' }],
    ['an unknown event type', { event_id: 'e1', event_type: 'learner.abducted', occurred_at: new Date().toISOString(), data: {} }],
  ];

  it.each(badEnvelopes)('refuses %s with 400', async (_name, envelope) => {
    const result = await deliver(configured(), envelope);
    expect(result.status).toBe(400);
    expect(await g.prisma.coreEventRow.count()).toBe(0);
  });

  it('refuses malformed JSON with 400, even correctly signed', async () => {
    const raw = Buffer.from('{"event_id": "e1",', 'utf8');
    const result = await deliver(configured(), null, { raw });

    expect(result).toEqual({ status: 400, body: { error: 'malformed_json' } });
  });

  it('refuses a top-level array', async () => {
    const result = await deliver(configured(), [{ event_id: 'e1' }]);
    expect(result.status).toBe(400);
  });
});

// =========================================================================
describe('authentication at the boundary', () => {
  it('an unconfigured boundary answers 503 and writes nothing', async () => {
    const result = await deliver(controllerWith(undefined), sessionEnvelope());

    // 503 is the only retryable refusal: the boundary may simply not be
    // configured yet. And it accepted nothing.
    expect(result).toEqual({ status: 503, body: { error: 'not_configured' } });
    expect(await g.prisma.coreEventRow.count()).toBe(0);
    expect(await g.prisma.classSession.count()).toBe(0);
  });

  it('a bad signature answers 401 and writes nothing', async () => {
    const result = await deliver(configured(), sessionEnvelope(), {
      signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
    });

    expect(result).toEqual({ status: 401, body: { error: 'invalid_signature' } });
    expect(await g.prisma.coreEventRow.count()).toBe(0);
  });

  it('a body tampered with after signing answers 401', async () => {
    const envelope = sessionEnvelope();
    const honest = Buffer.from(JSON.stringify(envelope), 'utf8');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = expectedSignature(SECRET, timestamp, honest);
    const tampered = Buffer.from(
      JSON.stringify({ ...envelope, event_type: 'attendance.upserted' }),
      'utf8',
    );

    const result = await deliver(configured(), null, { raw: tampered, timestamp, signature });
    expect(result.status).toBe(401);
  });

  it('a stale HTTP timestamp answers 401', async () => {
    const result = await deliver(configured(), sessionEnvelope(), {
      timestamp: String(Math.floor(Date.now() / 1000) - 3600),
    });
    expect(result).toEqual({ status: 401, body: { error: 'stale_timestamp' } });
  });

  it('an unknown key id answers 401', async () => {
    const result = await deliver(configured(), sessionEnvelope(), { keyId: 'core-1999-01' });
    expect(result).toEqual({ status: 401, body: { error: 'unknown_key' } });
  });

  it('an oversized body answers 401 without parsing it', async () => {
    const huge = Buffer.alloc(MAX_BODY_BYTES + 1, 0x61);
    const result = await deliver(configured(), null, { raw: huge });

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: 'body_too_large' });
  });

  it('a refusal is audited with the CLAIMED key id and no credential', async () => {
    await deliver(configured(), sessionEnvelope(), { keyId: 'core-1999-01' });

    const rows = await g.prisma.auditLog.findMany({ where: { action: 'core_webhook_rejected' } });
    expect(rows).toHaveLength(1);
    // The actor is null: an unauthenticated caller has no identity, and
    // inventing one would put a lie in the audit log.
    expect(rows[0].actorId).toBeNull();
    expect(rows[0].after).toMatchObject({ reason: 'unknown_key', claimedKeyId: 'core-1999-01' });

    // Nothing cryptographic reached the trail.
    const serialised = JSON.stringify(rows[0], (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain('sha256=');
  });

  it('a JSON field cannot talk its way past the signature', async () => {
    // The envelope claims everything it can. None of it is read: the delivery
    // never gets past verification, which looks only at headers and bytes.
    const result = await deliver(
      configured(),
      { event_id: 'e1', event_type: 'class_session.upserted', occurred_at: new Date().toISOString(), data: {}, authenticated: true, key_id: KEY_ID, signature_valid: true },
      { signature: 'sha256=deadbeef' },
    );

    expect(result.status).toBe(401);
    expect(await g.prisma.coreEventRow.count()).toBe(0);
  });
});

// =========================================================================
describe('a client cannot reach the ledger directly', () => {
  it('an authenticated session may not insert a core event', async () => {
    await expect(
      g.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local role authenticated`);
        await tx.$executeRawUnsafe(
          `select set_config('chat.actor_id', '${s.parentId}', true)`,
        );
        return tx.$executeRawUnsafe(
          `insert into chat.core_event (source, external_event_id, event_type, payload, occurred_at)
           values ('jawwid_core', '${randomUUID()}', 'class_session.upserted', '{}'::jsonb, now())`,
        );
      }),
    ).rejects.toBeDefined();
  });

  it('nor call record_core_event', async () => {
    await expect(
      g.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local role authenticated`);
        return tx.$executeRawUnsafe(
          `select chat.record_core_event('${randomUUID()}', 'class_session.upserted',
                                        '{}'::jsonb, 'jawwid_core', now())`,
        );
      }),
    ).rejects.toBeDefined();
  });
});
