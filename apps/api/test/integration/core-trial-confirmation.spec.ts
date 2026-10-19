/**
 * The Core -> Chat boundary for trial subscriptions (PD-11 T4), end to end.
 *
 *   1. Chat -> Core: Sales' "subscribed" queues trial.converted (no reason, no
 *      contact detail); "not subscribed" queues nothing
 *   2. Core -> Chat: subscription.created confirms the trial and links the
 *      student -- now, or when the learner arrives later with Core's child id --
 *      and New Students moves it from "awaiting Core" to "awaiting student" to
 *      "ready to set up"
 *   3. every disagreement is answered for what it is: retry later (Sales has
 *      not recorded the decision), refused for good (unknown trial, not
 *      subscribed, another subscription), not applicable (not from a trial),
 *      duplicate -- and each stays visible in chat.core_event
 *   4. the signed webhook over real HTTP: no session needed, a bad or missing
 *      signature refused and audited, an unknown type refused
 *   5. Core ids are opaque text; the request role reaches none of it
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { PrismaAuditService } from '@platform/audit.service';
import { CommunicationModule } from '@communication/communication.module';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { CoreBoundaryModule } from '../../src/core-boundary/core-boundary.module';
import { CoreIngestService, CoreRetryLater } from '../../src/core-boundary/core-ingest.service';
import { expectedSignature } from '../../src/core-boundary/core-webhook.verifier';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { TrialService } from '../../src/lessons/trial.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(120_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, g.outbox);
const ingest = new CoreIngestService(g.prisma);

const HOUR = 3_600_000;
const KEY_ID = 'core-test-2026-10';
const SECRET = 'core-trial-confirmation-spec-secret';
const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const inheritedSecrets = process.env.CORE_WEBHOOK_SECRETS;

let s: Scenario;
let salesId: string;
let prospectId: string;
let app: INestApplication;
let base: string;

/** Core's ids are MongoDB ObjectIds: 24 hex characters, opaque text in Chat. */
const objectId = () => randomBytes(12).toString('hex');

async function department(kind: string, staffId: string) {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ($1, $1) returning id::text as id`, kind,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    staffId, id,
  );
}

/** An attended trial in the past; `decide` records Sales' decision too. */
let trialsBooked = 0;
async function attendedTrial(decide?: 'subscribed' | 'not_subscribed'): Promise<string> {
  // An hour apart: the teacher is never double-booked.
  const startsAt = new Date(Date.now() - (2 + trialsBooked++) * HOUR);
  const l = await g.prisma.lesson.create({
    data: {
      organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId,
      kind: 'trial', prospectId, teacherId: s.teacherId, startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000), createdByKind: 'staff', createdBy: salesId,
    },
  });
  await trials.attendance(s.teacherId, l.id, { attended: true, covered: 'tajweed basics' });
  if (decide === 'subscribed') await trials.outcome(salesId, l.id, { result: 'subscribed' });
  if (decide === 'not_subscribed') await trials.outcome(salesId, l.id, { result: 'not_subscribed', reason: 'price', note: 'private reason' });
  return l.id;
}

async function newLearner(coreChildId: string | null): Promise<string> {
  const id = randomUUID();
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (id, family_id, name, teacher_id, core_child_id)
     values ('${id}'::uuid, '${s.familyId}'::uuid, 'learner_q', '${s.teacherId}'::uuid, ${coreChildId ? `'${coreChildId}'` : 'null'})`,
  );
  return id;
}

const created = (data: Record<string, unknown>, eventId = `evt-${randomUUID()}`) =>
  ingest.recordAndApply({ externalEventId: eventId, eventType: 'subscription.created', payload: data });

const ledger = (eventId: string) =>
  g.prisma.$queryRaw<Array<{ processed_at: Date | null; error: string | null }>>`
    select processed_at, error from chat.core_event where external_event_id = ${eventId}`.then((r) => r[0]);

beforeAll(async () => {
  await g.prisma.$connect();
  process.env.REDIS_URL = REDIS_URL;
  process.env.CORE_WEBHOOK_SECRETS = `${KEY_ID}:${SECRET}`;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, CoreBoundaryModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedSecrets === undefined) delete process.env.CORE_WEBHOOK_SECRETS;
  else process.env.CORE_WEBHOOK_SECRETS = inheritedSecrets;
});

beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.core_event`);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  salesId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sales_a', 'admin', true)`, salesId);
  await department('sales', salesId);
  prospectId = (await trials.createProspect(salesId, { displayName: 'prospect_q', level: 'beginner', note: 'met at open day' })).id;
});

describe('1. Chat tells Core about a conversion', () => {
  it('"subscribed" queues trial.converted with the trial id and the prospect by name only', async () => {
    const id = await attendedTrial('subscribed');
    const rows = await g.prisma.$queryRaw<Array<{ payload: Record<string, unknown> }>>`
      select payload from chat.outbox_event where type = 'trial.converted'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      trialId: id,
      teacherId: s.teacherId,
      prospect: { id: prospectId, displayName: 'prospect_q', level: 'beginner' },
      recordedBy: salesId,
    });
    // Sales' private note and the prospect's note never leave Chat.
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/open day|private/);
  });

  it('"not subscribed" queues nothing for Core', async () => {
    await attendedTrial('not_subscribed');
    const [{ n }] = await g.prisma.$queryRaw<Array<{ n: bigint }>>`select count(*) as n from chat.outbox_event where type = 'trial.converted'`;
    expect(Number(n)).toBe(0);
  });
});

describe('2. Core confirms, and New Students follows', () => {
  it('a known student: confirmed and linked at once -- ready to set up', async () => {
    const id = await attendedTrial('subscribed');
    const child = objectId();
    const learnerId = await newLearner(child);
    expect((await trials.newStudents(salesId)).awaitingCore.map((x) => x.lessonId)).toEqual([id]);

    const sub = objectId();
    expect(await created({ core_subscription_id: sub, chat_trial_id: id, core_child_id: child })).toEqual({ status: 'applied', detail: 'confirmed' });
    expect((await trials.get(salesId, id)).conversion).toBe('confirmed');
    const page = await trials.newStudents(salesId);
    expect(page.awaitingCore).toEqual([]);
    expect(page.awaitingStudent).toEqual([]);
    expect(page.readyForSetup).toEqual([expect.objectContaining({ lessonId: id, learnerId })]);
    const outcome = await g.prisma.trialOutcome.findUniqueOrThrow({ where: { lessonId: id } });
    expect(outcome.coreSubscriptionRef).toBe(sub);
  });

  it('a student Chat does not have yet: "awaiting student", then linked when the learner arrives', async () => {
    const id = await attendedTrial('subscribed');
    const child = objectId();
    expect(await created({ core_subscription_id: objectId(), chat_trial_id: id, core_child_id: child })).toEqual({
      status: 'applied', detail: 'confirmed_awaiting_student',
    });
    let page = await trials.newStudents(salesId);
    expect(page.awaitingStudent.map((x) => x.lessonId)).toEqual([id]);
    expect(page.readyForSetup).toEqual([]);
    expect(page.awaitingCore).toEqual([]);

    // Another child of the organization arriving links nothing.
    await newLearner(objectId());
    expect((await trials.newStudents(salesId)).awaitingStudent).toHaveLength(1);

    const learnerId = await newLearner(child);
    page = await trials.newStudents(salesId);
    expect(page.awaitingStudent).toEqual([]);
    expect(page.readyForSetup).toEqual([expect.objectContaining({ lessonId: id, learnerId })]);
  });

  it('a learner that gains Core\'s child id later links too', async () => {
    const id = await attendedTrial('subscribed');
    const child = objectId();
    const learnerId = await newLearner(null);
    await created({ core_subscription_id: objectId(), chat_trial_id: id, core_child_id: child });
    await withAssignmentGate(g.prisma, `update chat.learner set core_child_id = '${child}' where id = '${learnerId}'::uuid`);
    expect((await trials.newStudents(salesId)).readyForSetup).toEqual([expect.objectContaining({ lessonId: id, learnerId })]);
  });
});

describe('3. every disagreement is answered for what it is', () => {
  it('before Sales records the decision: retry later, visible in the ledger, applied on the retry', async () => {
    const id = await attendedTrial();
    const evt = `evt-${randomUUID()}`;
    const sub = objectId();
    await expect(created({ core_subscription_id: sub, chat_trial_id: id }, evt)).rejects.toBeInstanceOf(CoreRetryLater);
    expect(await ledger(evt)).toEqual({ processed_at: null, error: expect.stringMatching(/not recorded/) });

    await trials.outcome(salesId, id, { result: 'subscribed' });
    expect(await created({ core_subscription_id: sub, chat_trial_id: id }, evt)).toEqual({ status: 'applied', detail: 'confirmed_awaiting_student' });
    expect(await ledger(evt)).toEqual({ processed_at: expect.any(Date), error: null });
  });

  it('a redelivery is a duplicate; the same subscription under a new event id is a duplicate too', async () => {
    const id = await attendedTrial('subscribed');
    const sub = objectId();
    const evt = `evt-${randomUUID()}`;
    await created({ core_subscription_id: sub, chat_trial_id: id }, evt);
    expect(await created({ core_subscription_id: sub, chat_trial_id: id }, evt)).toEqual({ status: 'duplicate' });
    expect(await created({ core_subscription_id: sub, chat_trial_id: id })).toEqual({ status: 'duplicate' });
  });

  it('refused for good, and kept with its reason: another subscription, not subscribed, unknown or non-trial lesson', async () => {
    const id = await attendedTrial('subscribed');
    await created({ core_subscription_id: objectId(), chat_trial_id: id });
    const evt = `evt-${randomUUID()}`;
    expect(await created({ core_subscription_id: objectId(), chat_trial_id: id }, evt)).toEqual({
      status: 'rejected', reason: 'trial_confirmed_by_another_subscription',
    });
    expect(await ledger(evt)).toEqual({ processed_at: expect.any(Date), error: 'rejected:trial_confirmed_by_another_subscription' });
    // Redelivering a refused event gives the same answer; it is not re-applied.
    expect(await created({ core_subscription_id: objectId(), chat_trial_id: id }, evt)).toEqual({
      status: 'rejected', reason: 'trial_confirmed_by_another_subscription',
    });

    const no = await attendedTrial('not_subscribed');
    expect(await created({ core_subscription_id: objectId(), chat_trial_id: no })).toEqual({ status: 'rejected', reason: 'trial_not_subscribed' });
    expect(await created({ core_subscription_id: objectId(), chat_trial_id: randomUUID() })).toEqual({ status: 'rejected', reason: 'unknown_trial' });
    expect(await created({ core_subscription_id: objectId(), chat_trial_id: 'not-a-uuid' })).toEqual({ status: 'rejected', reason: 'unknown_trial' });
    const regular = await g.prisma.lesson.findFirst({ where: { kind: 'regular' }, select: { id: true } });
    if (regular) {
      expect(await created({ core_subscription_id: objectId(), chat_trial_id: regular.id })).toEqual({ status: 'rejected', reason: 'unknown_trial' });
    }
    expect(await created({ chat_trial_id: id })).toEqual({ status: 'rejected', reason: 'missing_core_subscription_id' });
    expect(await created({ core_subscription_id: objectId(), chat_trial_id: id, core_child_id: '   ' })).toEqual({
      status: 'rejected', reason: 'invalid_core_child_id',
    });
  });

  it('a subscription that did not come from a trial is not Chat\'s to record', async () => {
    expect(await created({ core_subscription_id: objectId(), core_parent_id: objectId() })).toEqual({
      status: 'not_applicable', detail: 'not from a Chat trial',
    });
    const [{ n }] = await g.prisma.$queryRaw<Array<{ n: bigint }>>`select count(*) as n from chat.subscription`;
    expect(Number(n)).toBe(0);
  });
});

describe('4. the signed webhook over HTTP', () => {
  const post = (body: unknown, opts: { sign?: boolean; secret?: string; keyId?: string; at?: number } = {}) => {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const ts = String(opts.at ?? Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.sign !== false) {
      headers['x-jawwid-key-id'] = opts.keyId ?? KEY_ID;
      headers['x-jawwid-timestamp'] = ts;
      headers['x-jawwid-signature'] = expectedSignature(opts.secret ?? SECRET, ts, raw);
    }
    return fetch(`${base}/integration/core/events`, { method: 'POST', headers, body: raw });
  };
  const envelope = (data: Record<string, unknown>, type = 'subscription.created') => ({
    event_id: `evt-${randomUUID()}`, event_type: type, occurred_at: new Date().toISOString(), data,
  });

  it('a signed delivery applies without any session; a redelivery is a duplicate', async () => {
    const id = await attendedTrial('subscribed');
    const body = envelope({ core_subscription_id: objectId(), chat_trial_id: id });
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'applied' });
    expect((await trials.get(salesId, id)).conversion).toBe('confirmed');
    const again = await post(body);
    expect(await again.json()).toEqual({ status: 'duplicate' });
  });

  it('unsigned, wrongly signed, unknown key or stale: 401, audited, nothing recorded', async () => {
    const id = await attendedTrial('subscribed');
    const body = envelope({ core_subscription_id: objectId(), chat_trial_id: id });
    const answers = [
      await post(body, { sign: false }),
      await post(body, { secret: 'not-the-secret' }),
      await post(body, { keyId: 'core-old' }),
      await post(body, { at: Math.floor(Date.now() / 1000) - 3600 }),
    ];
    expect(answers.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    expect(await Promise.all(answers.map((r) => r.json()))).toEqual([
      { error: 'missing_headers' }, { error: 'invalid_signature' }, { error: 'unknown_key' }, { error: 'stale_timestamp' },
    ]);
    const [{ n }] = await g.prisma.$queryRaw<Array<{ n: bigint }>>`select count(*) as n from chat.core_event`;
    expect(Number(n)).toBe(0);
    const audited = await g.prisma.auditLog.findMany({ where: { action: 'core_webhook_rejected' }, orderBy: { id: 'desc' }, take: 4 });
    expect(audited.map((a) => (a.after as { reason: string }).reason).sort()).toEqual(
      ['invalid_signature', 'missing_headers', 'stale_timestamp', 'unknown_key'],
    );
    expect(JSON.stringify(audited.map((a) => a.after))).not.toContain(SECRET);
    expect((await trials.get(salesId, id)).conversion).toBe('awaiting_core');
  });

  it('a type this boundary does not process is 400; a refusal for good is 422; retry later is 500', async () => {
    const unknownType = await post(envelope({}, 'class_session.upserted'));
    expect(unknownType.status).toBe(400);
    expect(await unknownType.json()).toEqual({ error: 'unknown_event_type' });

    const refused = await post(envelope({ core_subscription_id: objectId(), chat_trial_id: randomUUID() }));
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: 'unknown_trial' });

    const id = await attendedTrial();
    const early = await post(envelope({ core_subscription_id: objectId(), chat_trial_id: id }));
    expect(early.status).toBe(500);
    expect(await early.json()).toEqual({ error: 'retry_later' });
  });
});

describe('5. Core ids and the request role', () => {
  it('a Core ObjectId is stored as given; a blank one is refused', async () => {
    const child = objectId();
    const learnerId = await newLearner(child);
    const row = await g.prisma.$queryRaw<Array<{ c: string }>>`select core_child_id as c from chat.learner where id = ${learnerId}::uuid`;
    expect(row[0]!.c).toBe(child);
    await expect(withAssignmentGate(g.prisma, `update chat.learner set core_child_id = '  ' where id = '${learnerId}'::uuid`)).rejects.toThrow(/learner_core_child_id_not_blank/);
  });

  it('the request role can call none of the Core functions', async () => {
    const id = await attendedTrial('subscribed');
    for (const sql of [
      `select chat.confirm_trial_subscription('${id}'::uuid, 'x', null)`,
      `select chat.record_core_event('e', 'subscription.created', '{}'::jsonb, 'jawwid_core')`,
      `select chat.mark_core_event_processed('e', null, 'jawwid_core')`,
      `select chat.ingest_core_parent('{"core_parent_id": "x"}'::jsonb)`,
      `select chat.ingest_core_learner('{"core_child_id": "x"}'::jsonb)`,
      `select chat.ingest_core_subscription('{"core_subscription_id": "x"}'::jsonb)`,
    ]) {
      await expect(g.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local role chat_app`);
        await tx.$executeRawUnsafe(sql);
      })).rejects.toThrow(/permission denied/);
    }
  });
});
