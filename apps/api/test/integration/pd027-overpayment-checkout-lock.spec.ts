/**
 * PD-27 hardening (docs/admin/pd027-stripe-lifecycle.md §3.8), over real HTTP
 * with the in-memory Stripe stand-in (real signature check, no network):
 *
 *  M3  money recorded on a request that is already paid or cancelled, or on an
 *      instalment already paid another way, is STILL recorded (it was taken),
 *      and is flagged: an audit row `payment.overpayment_detected` with the
 *      amounts, a notice to the staff who refund (canVerify), and an
 *      "Overpaid: refund or credit" marker on the Admin transaction. A payment
 *      that is owed is never flagged.
 *  S1  CheckoutService.open() CLAIMS the request in a short transaction
 *      (pg_try_advisory_xact_lock + a chat.config claim row) and asks Stripe
 *      with no transaction open: two opens at once create ONE Stripe session
 *      and the other gets 409 CHECKOUT_OPENING at once; a burst on a small
 *      pool never starves other queries; a claim lost to another opener stops
 *      before Stripe or hands nothing out; a session already recorded (a
 *      replayed idempotency key) answers the same page, never a 500.
 *  LR-46 P2-1  if Stripe cannot confirm an earlier page is closed (look-up or
 *      expire fails and it may still be payable), open() fails closed: 503
 *      PAYMENTS_UNAVAILABLE, no new page, the row stays open, claim released.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { AuthService } from '@platform/auth/auth.service';
import { hashPassword } from '@platform/auth/password';
import { PrismaService } from '@platform/prisma.service';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { LessonModule } from '../../src/lessons/lesson.module';
import { BillingModule } from '../../src/billing/billing.module';
import { ParentRecordModule } from '../../src/parent-profile/parent-record.module';
import { STRIPE_GATEWAY, type CheckoutInput } from '../../src/billing/stripe.gateway';
import { CheckoutService, checkoutClaimKey } from '../../src/billing/checkout.service';
import { OVERPAYMENT_ACTION, OVERPAYMENT_EVENT, PaymentLedger } from '../../src/billing/payment-ledger.service';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';
import { FakeStripe } from './fake-stripe';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const inheritedLinkBase = process.env.PAYMENT_LINK_BASE_URL;
const PASSWORD = 'pd27-overpay-lock-password-1';
const DOMAIN = 'pd27o.qa.jawwid.test';
/** A fixed day in the past: money is recorded once it arrived. */
const PAID_ON = '2026-10-15';

const g = buildGraph();
const stripe = new FakeStripe();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
let ownerId: string;

const tokens = new Map<string, string>();
async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return tokens.get(subject)!;
}

type Json = { error?: { code?: string; message?: string } } & Record<string, any>;
async function http(subject: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {};
  if (subject) headers.authorization = `Bearer ${await tokenFor(subject)}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as Json;
  return { status: r.status, code: json.error?.code, json };
}

async function webhook(event: { body: string; signature: string }) {
  const r = await fetch(`${base}/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': event.signature },
    body: event.body,
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Json };
}

function tokenOf(link: string): string {
  return link.slice(link.lastIndexOf('/') + 1);
}

/** POST the link page's form; answers the Stripe session id from the 303. */
async function payByCard(token: string): Promise<string> {
  const r = await fetch(`${base}/pay/${token}/checkout`, { method: 'POST', redirect: 'manual' });
  expect(r.status).toBe(303);
  const location = r.headers.get('location')!;
  return location.slice(location.lastIndexOf('/') + 1);
}

let nextFamily = 0;
function freshFamily() {
  const f = m.families[nextFamily++]!;
  const supervisor = m.supervisors.find((s) => s.id === f.children[0]!.supervisorId)!;
  return { f, child: f.children[0]!, supervisor };
}

/** A renewal of 8 lessons for the child: a lesson package, payable in the app (PD-30). */
async function lessonRequest(familyId: string, learnerId: string, amountMinor = 120000) {
  const created = await http(m.salesManager.subject, 'POST', `/families/${familyId}/payment-requests`, {
    purpose: 'renewal', label: 'Quran — renewal', amountMinor, currency: 'AED', learnerId, lessonsIncluded: 8, planMonths: 1,
  });
  expect(created.status).toBe(201);
  return created.json.request as { id: string; link: string };
}

const overpaymentAudit = (paymentId: string) =>
  g.prisma.auditLog.findMany({ where: { action: OVERPAYMENT_ACTION, entity: 'payment', entityId: paymentId } });
const overpaymentNotices = (paymentId: string) =>
  g.prisma.notification.findMany({ where: { eventType: OVERPAYMENT_EVENT, dedupeKey: { startsWith: `${OVERPAYMENT_EVENT}:${paymentId}:` } } });

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd27o-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd27o-${orgId.slice(0, 8)}', 'PD-27 overpayment QA academy')`,
  );
  ownerId = await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    const owner = await tx.staff.create({
      data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id },
    });
    return owner.id;
  });
  m = await seedOrgChat(g.prisma, {
    organizationId: orgId,
    emailDomain: DOMAIN,
    password: PASSWORD,
    passwordHash: await hashPassword(PASSWORD),
    messages: false,
  });

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, BillingModule, ParentRecordModule],
  })
    .overrideProvider(STRIPE_GATEWAY)
    .useValue(stripe)
    .compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
  process.env.PAYMENT_LINK_BASE_URL = base;
  process.env.STORAGE_PUBLIC_BASE_URL = base;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd27o-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedLinkBase === undefined) delete process.env.PAYMENT_LINK_BASE_URL;
  else process.env.PAYMENT_LINK_BASE_URL = inheritedLinkBase;
});

describe('M3: money beyond what was owed is recorded AND flagged', () => {
  it('a bank transfer pays the request, then a late card webhook: the card payment is recorded, flagged (request_paid), billing staff told, the Admin transaction marked', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    // The parent opened Stripe's page...
    const sessionId = await payByCard(tokenOf(request.link));
    // ...and meanwhile staff confirmed a bank transfer for the whole request.
    const bank = await http(m.operationsManager.subject, 'POST', `/families/${f.id}/payments`, {
      method: 'bank_transfer', amountMinor: 120000, paidOn: PAID_ON, requestId: request.id, reference: 'transfer 4411',
    });
    expect({ status: bank.status, error: bank.json.error?.message }).toEqual({ status: 201, error: undefined });
    expect(await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ paidAt: expect.any(Date) });
    const bankPayment = await g.prisma.payment.findFirstOrThrow({ where: { requestId: request.id, method: 'bank_transfer' } });
    // Owed money is never flagged.
    expect(await overpaymentAudit(bankPayment.id)).toHaveLength(0);

    // Then Stripe's webhook for the card the parent also used.
    expect((await webhook(stripe.completedEvent(stripe.complete(sessionId)))).json.outcome).toBe('recorded');

    // Recorded: the money was taken.
    const payments = await g.prisma.payment.findMany({ where: { requestId: request.id, voidedAt: null } });
    expect(payments).toHaveLength(2);
    const card = payments.find((p) => p.method === 'card')!;
    expect(Number(card.amountMinor)).toBe(120000);

    // Flagged, with the amounts.
    const audit = await overpaymentAudit(card.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBeNull();
    expect(audit[0]!.after).toMatchObject({
      paymentId: card.id, method: 'card', amountMinor: 120000, owedMinor: 0, overpaidMinor: 120000, currency: 'AED',
      why: 'request_paid', requestId: request.id,
    });

    // The staff who refund (canVerify: the super admins and the Operations Manager) are told; nobody else.
    const notices = await overpaymentNotices(card.id);
    const told = notices.map((n) => n.recipientId).sort();
    expect(told).toEqual([ownerId, m.superAdmin.id, m.operationsManager.id].filter((v, i, a) => a.indexOf(v) === i).sort());
    expect(told).not.toContain(m.salesManager.id);
    expect(told).not.toContain(f.parent.id);
    // The lock screen shows the generic push; the amount stays behind sign-in.
    expect(notices.every((n) => n.templateKey === 'inbox.generic')).toBe(true);
    // The parent hears "payment received" as for any payment, never about the flag.
    expect(await g.prisma.notification.count({ where: { eventType: OVERPAYMENT_EVENT, recipientId: f.parent.id } })).toBe(0);

    // The Admin transaction carries the marker; the owed bank payment does not.
    const list = await http(m.superAdmin.subject, 'GET', `/payments?familyId=${f.id}`);
    expect(list.status).toBe(200);
    const cardTx = list.json.items.find((x: any) => x.id === card.id);
    const bankTx = list.json.items.find((x: any) => x.id === bankPayment.id);
    expect(cardTx.overpaid).toEqual({ amountMinor: 120000, why: 'request_paid', settled: false });
    expect(bankTx.overpaid).toBeNull();
    const detail = await http(m.operationsManager.subject, 'GET', `/payments/${card.id}`);
    expect(detail.json.payment.overpaid).toEqual({ amountMinor: 120000, why: 'request_paid', settled: false });

    // A redelivery records nothing more and flags nothing more.
    expect((await webhook(stripe.completedEvent(stripe.sessions.get(sessionId)!))).json.outcome).toBe('already_recorded');
    expect(await overpaymentAudit(card.id)).toHaveLength(1);
    expect(await overpaymentNotices(card.id)).toHaveLength(notices.length);
  });

  it('an instalment paid in cash while the parent paid it by card: the card payment is recorded, flagged (instalment_closed), staff told', async () => {
    const { f, supervisor } = freshFamily();
    expect((await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' })).status).toBe(201);
    const plan = await http(supervisor.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Term plan', items: [{ amountMinor: 90000, dueDate: '2027-01-01' }], learnerId: f.children[0]!.id, lessonsIncluded: 24,
    });
    expect(plan.status).toBe(201);
    const inst = (plan.json.instalments as any[])[0];

    const opened = await http(f.parent.subject, 'POST', '/me/billing/checkout', { instalmentId: inst.id });
    expect(opened.status).toBe(201);
    const sessionId = opened.json.url.slice(opened.json.url.lastIndexOf('/') + 1);

    const cash = await http(supervisor.subject, 'POST', `/families/${f.id}/payments`, {
      method: 'cash', amountMinor: 90000, paidOn: PAID_ON, instalmentId: inst.id,
    });
    expect(cash.status).toBe(201);
    expect(await g.prisma.familyInstalment.findUniqueOrThrow({ where: { id: inst.id } })).toMatchObject({ paidOn: expect.any(Date) });

    expect((await webhook(stripe.completedEvent(stripe.complete(sessionId)))).json.outcome).toBe('recorded');
    const card = await g.prisma.payment.findFirstOrThrow({ where: { stripeCheckoutSessionId: sessionId } });
    // Recorded against no instalment (it was paid otherwise), as before.
    expect(card.instalmentId).toBeNull();
    const audit = await overpaymentAudit(card.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ amountMinor: 90000, owedMinor: 0, overpaidMinor: 90000, why: 'instalment_closed', instalmentId: inst.id });
    expect((await overpaymentNotices(card.id)).map((n) => n.recipientId)).toContain(m.operationsManager.id);
    const tx = (await http(m.superAdmin.subject, 'GET', `/payments?familyId=${f.id}&method=card`)).json.items[0];
    expect(tx.overpaid).toMatchObject({ amountMinor: 90000, why: 'instalment_closed', settled: false });
  });

  it('a card payment that was owed is never flagged', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    expect((await webhook(stripe.completedEvent(stripe.complete(sessionId)))).json.outcome).toBe('recorded');
    const card = await g.prisma.payment.findFirstOrThrow({ where: { stripeCheckoutSessionId: sessionId } });
    expect(await overpaymentAudit(card.id)).toHaveLength(0);
    expect(await overpaymentNotices(card.id)).toHaveLength(0);
    const tx = (await http(m.superAdmin.subject, 'GET', `/payments?familyId=${f.id}`)).json.items.find((x: any) => x.id === card.id);
    expect(tx.overpaid).toBeNull();
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stripe answering createCheckout slowly, as a real network does: the window the claim must cover. */
function slowCheckouts(ms: number) {
  const real = stripe.createCheckout.bind(stripe);
  return jest.spyOn(stripe, 'createCheckout').mockImplementation(async (input: CheckoutInput) => {
    await sleep(ms);
    return real(input);
  });
}

/** Refused at once because another opener holds the request: 409 CHECKOUT_OPENING, never "paid". */
function isOpening(e: unknown): boolean {
  return e instanceof CommError && e.code === CommErrorCode.CHECKOUT_OPENING && e.status === 409;
}

const sessionsOf = (requestId: string) => [...stripe.sessions.values()].filter((s) => s.input.requestId === requestId);

describe('S1: one payable Checkout session per request', () => {
  it('two opens at once while Stripe is slow: ONE Stripe session is created, the other is refused at once (409 CHECKOUT_OPENING)', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const row = await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } });
    const svc = app.get(CheckoutService);
    const opts = { locale: 'en' as const, returnUrl: request.link };
    const created = slowCheckouts(400);

    const both = await Promise.allSettled([svc.open(row, opts), svc.open(row, opts)]);
    const opened = both.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled');
    const refused = both.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(opened).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(isOpening(refused[0]!.reason)).toBe(true);

    // Stripe was asked once; one page exists and it is the one recorded open.
    expect(created.mock.calls.filter(([input]) => input.requestId === request.id)).toHaveLength(1);
    const atStripe = sessionsOf(request.id);
    expect(atStripe).toHaveLength(1);
    expect(atStripe[0]!.status).toBe('open');
    expect(opened[0]!.value).toBe(atStripe[0]!.url);
    const rows = await g.prisma.paymentCheckout.findMany({ where: { requestId: request.id } });
    expect(rows.map((r) => [r.stripeSessionId, r.status])).toEqual([[atStripe[0]!.id, 'open']]);
    // The claim is given up when the open ends.
    expect(await g.prisma.config.findUnique({ where: { key: checkoutClaimKey(request.id) } })).toBeNull();

    // The next tap works: it expires that page and opens a new one.
    created.mockRestore();
    const again = await svc.open(row, opts);
    expect(sessionsOf(request.id).filter((s) => s.status === 'open').map((s) => s.url)).toEqual([again]);
  });

  it('eight opens at once on a 3-connection pool while Stripe is slow: nobody waits holding a connection, an unrelated query is not starved, one Stripe session', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const row = await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } });
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('connection_limit', '3');
    url.searchParams.set('pool_timeout', '5');
    const small = new PrismaService({ datasourceUrl: url.toString() });
    await small.$connect();
    try {
      const audit = new PrismaAuditService();
      const svc = new CheckoutService(small, new PaymentLedger(small, audit), stripe, audit);
      const opts = { locale: 'en' as const, returnUrl: request.link };
      const created = slowCheckouts(2_500);

      const opens = Promise.allSettled(Array.from({ length: 8 }, () => svc.open(row, opts)));
      // The winner is now inside Stripe's (slow) call; every other tap was answered.
      await sleep(600);
      const t0 = Date.now();
      await small.$queryRaw`SELECT 1`;
      const waited = Date.now() - t0;
      const results = await opens;

      // Under a lock held across Stripe, this query waited for the pool (pool_timeout, P2024).
      expect(waited).toBeLessThan(1_000);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(refused).toHaveLength(7);
      expect(refused.every((r) => isOpening(r.reason))).toBe(true);
      expect(created.mock.calls.filter(([input]) => input.requestId === request.id)).toHaveLength(1);
      expect(sessionsOf(request.id)).toHaveLength(1);
      expect(await g.prisma.paymentCheckout.count({ where: { requestId: request.id, status: 'open' } })).toBe(1);
      expect(await g.prisma.config.findUnique({ where: { key: checkoutClaimKey(request.id) } })).toBeNull();
    } finally {
      await small.$disconnect();
    }
  });

  it('two taps on Pay over HTTP at once (app and link page): one page, the other a 409 the clients show as "try again", no 500', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    slowCheckouts(400);
    const both = await Promise.all([
      http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id }),
      http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    // Not COMM.BILLING_STATE: the app would read that as "paid, cancelled or expired".
    expect(both.find((r) => r.status === 409)!.code).toBe(CommErrorCode.CHECKOUT_OPENING);
    expect(sessionsOf(request.id)).toHaveLength(1);
    expect(await g.prisma.paymentCheckout.count({ where: { requestId: request.id, status: 'open' } })).toBe(1);

    // The link page's form: one 303 to Stripe, the other the page again with a 409, never a 500.
    const token = tokenOf(request.link);
    const taps = await Promise.all([1, 2].map(() => fetch(`${base}/pay/${token}/checkout`, { method: 'POST', redirect: 'manual' })));
    expect(taps.map((r) => r.status).sort()).toEqual([303, 409]);
    expect(sessionsOf(request.id).filter((s) => s.status === 'open')).toHaveLength(1);
    expect(await g.prisma.paymentCheckout.count({ where: { requestId: request.id, status: 'open' } })).toBe(1);
  });

  it('a claim taken over before Stripe is asked: this opener stops, no Stripe session is created', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const row = await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } });
    const key = checkoutClaimKey(request.id);
    const realCustomer = stripe.createCustomer.bind(stripe);
    // While this opener asks Stripe for the family's customer, its claim runs out and another opener takes it.
    jest.spyOn(stripe, 'createCustomer').mockImplementationOnce(async (input) => {
      await g.prisma.config.update({ where: { key }, data: { value: { holder: 'another-opener', until: new Date(Date.now() + 60_000).toISOString() } } });
      return realCustomer(input);
    });
    const created = jest.spyOn(stripe, 'createCheckout');
    try {
      expect(isOpening(await app.get(CheckoutService).open(row, { locale: 'en', returnUrl: request.link }).catch((e: unknown) => e))).toBe(true);
      expect(created).not.toHaveBeenCalled();
      expect(sessionsOf(request.id)).toHaveLength(0);
      expect(await g.prisma.paymentCheckout.count({ where: { requestId: request.id } })).toBe(0);
      // The other opener's claim is never removed by this one.
      expect((await g.prisma.config.findUniqueOrThrow({ where: { key } })).value).toMatchObject({ holder: 'another-opener' });
    } finally {
      await g.prisma.config.deleteMany({ where: { key } });
    }
  });

  it('a claim taken over while Stripe creates the page (Stripe slower than the claim): the page is recorded, expired and never handed out', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const row = await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } });
    const key = checkoutClaimKey(request.id);
    const real = stripe.createCheckout.bind(stripe);
    jest.spyOn(stripe, 'createCheckout').mockImplementationOnce(async (input: CheckoutInput) => {
      const s = await real(input);
      await g.prisma.config.update({ where: { key }, data: { value: { holder: 'another-opener', until: new Date(Date.now() + 60_000).toISOString() } } });
      return s;
    });
    try {
      expect(isOpening(await app.get(CheckoutService).open(row, { locale: 'en', returnUrl: request.link }).catch((e: unknown) => e))).toBe(true);
      const atStripe = sessionsOf(request.id);
      expect(atStripe).toHaveLength(1);
      expect(atStripe[0]!.status).toBe('expired');
      const rows = await g.prisma.paymentCheckout.findMany({ where: { requestId: request.id } });
      expect(rows.map((r) => [r.stripeSessionId, r.status])).toEqual([[atStripe[0]!.id, 'expired']]);
      expect((await g.prisma.config.findUniqueOrThrow({ where: { key } })).value).toMatchObject({ holder: 'another-opener' });
    } finally {
      await g.prisma.config.deleteMany({ where: { key } });
    }
  });

  it('a claim left by an API process that died is taken over once its time has passed', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const row = await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } });
    const key = checkoutClaimKey(request.id);
    const opts = { locale: 'en' as const, returnUrl: request.link };
    const svc = app.get(CheckoutService);
    try {
      // Still live: refused.
      await g.prisma.config.create({ data: { key, scope: 'checkout', value: { holder: 'dead-opener', until: new Date(Date.now() + 60_000).toISOString() } } });
      expect(isOpening(await svc.open(row, opts).catch((e: unknown) => e))).toBe(true);
      expect(sessionsOf(request.id)).toHaveLength(0);
      // Its time has passed: taken over, opened, released.
      await g.prisma.config.update({ where: { key }, data: { value: { holder: 'dead-opener', until: new Date(Date.now() - 1_000).toISOString() } } });
      const url = await svc.open(row, opts);
      expect(sessionsOf(request.id).map((s) => s.url)).toEqual([url]);
      expect(await g.prisma.config.findUnique({ where: { key } })).toBeNull();
    } finally {
      await g.prisma.config.deleteMany({ where: { key } });
    }
  });

  it('the session already recorded (Stripe answered a replayed idempotency key): the same page, not a 500', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const real = stripe.createCheckout.bind(stripe);
    let replayed: string | null = null;
    jest.spyOn(stripe, 'createCheckout').mockImplementationOnce(async (input: CheckoutInput) => {
      const s = await real(input);
      // Another open() with the same idempotency key got this same session and recorded it first.
      await g.prisma.paymentCheckout.create({
        data: {
          stripeSessionId: s.id, organizationId: orgId, requestId: request.id,
          amountMinor: BigInt(input.amountMinor), currency: input.currency, expiresAt: s.expiresAt,
        },
      });
      replayed = s.id;
      return s;
    });

    const r = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id });
    expect({ status: r.status, error: r.json.error?.message }).toEqual({ status: 201, error: undefined });
    expect(replayed).not.toBeNull();
    expect(r.json.url.endsWith(replayed!)).toBe(true);
    expect(await g.prisma.paymentCheckout.count({ where: { stripeSessionId: replayed! } })).toBe(1);
  });
});

/** The bank-transfer answer: 503 PAYMENTS_UNAVAILABLE. */
function isUnavailable(e: unknown): boolean {
  return e instanceof CommError && e.code === CommErrorCode.PAYMENTS_UNAVAILABLE && e.status === 503;
}

describe('LR-46 P2-1: an earlier page Stripe has not confirmed closed blocks a new one (fail closed)', () => {
  /** A request with one page already opened (session A, open at Stripe and in Chat). */
  async function withOpenPage() {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const row = await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } });
    const opts = { locale: 'en' as const, returnUrl: request.link };
    const svc = app.get(CheckoutService);
    const firstUrl = await svc.open(row, opts);
    const [a] = sessionsOf(request.id);
    expect(a!.url).toBe(firstUrl);
    return { f, request, row, opts, svc, a: a! };
  }
  const rowStatus = async (sessionId: string) => (await g.prisma.paymentCheckout.findUniqueOrThrow({ where: { stripeSessionId: sessionId } })).status;
  const claimOf = (requestId: string) => g.prisma.config.findUnique({ where: { key: checkoutClaimKey(requestId) } });

  it('Stripe unreachable when the earlier page is looked up: 503 (pay by bank transfer), no new page, the earlier one untouched, the claim released', async () => {
    const { f, request, row, opts, svc, a } = await withOpenPage();
    const created = jest.spyOn(stripe, 'createCheckout');
    stripe.failNextRead = Object.assign(new Error('connect ETIMEDOUT'), { type: 'StripeConnectionError' });

    expect(isUnavailable(await svc.open(row, opts).catch((e: unknown) => e))).toBe(true);
    expect(created).not.toHaveBeenCalled();
    expect(sessionsOf(request.id)).toHaveLength(1);
    expect(a.status).toBe('open');
    expect(await rowStatus(a.id)).toBe('open');
    expect(await claimOf(request.id)).toBeNull();

    // Over HTTP the parent sees the same bank-transfer answer, never a 500.
    stripe.failNextRead = Object.assign(new Error('connect ETIMEDOUT'), { type: 'StripeConnectionError' });
    const r = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id });
    expect({ status: r.status, code: r.code }).toEqual({ status: 503, code: CommErrorCode.PAYMENTS_UNAVAILABLE });
    expect(created).not.toHaveBeenCalled();
    expect(await claimOf(request.id)).toBeNull();

    // Stripe back: the earlier page is expired at Stripe first, then ONE new page.
    const url = await svc.open(row, opts);
    expect(a.status).toBe('expired');
    expect(await rowStatus(a.id)).toBe('expired');
    expect(sessionsOf(request.id).filter((s) => s.status === 'open').map((s) => s.url)).toEqual([url]);
  });

  it('Stripe fails to expire the earlier page (a 5xx): the row stays open, 503, no new page, the claim released', async () => {
    const { request, row, opts, svc, a } = await withOpenPage();
    const created = jest.spyOn(stripe, 'createCheckout');
    jest.spyOn(stripe, 'expireCheckout').mockRejectedValueOnce(
      Object.assign(new Error('An unknown error occurred'), { type: 'StripeAPIError', statusCode: 500 }),
    );

    expect(isUnavailable(await svc.open(row, opts).catch((e: unknown) => e))).toBe(true);
    expect(created).not.toHaveBeenCalled();
    expect(sessionsOf(request.id)).toHaveLength(1);
    expect(a.status).toBe('open');
    expect(await rowStatus(a.id)).toBe('open');
    expect(await claimOf(request.id)).toBeNull();
  });

  it('expire fails and Stripe cannot be asked again either: 503, the row stays open', async () => {
    const { request, row, opts, svc, a } = await withOpenPage();
    const created = jest.spyOn(stripe, 'createCheckout');
    jest.spyOn(stripe, 'expireCheckout').mockImplementationOnce(async () => {
      stripe.failNextRead = Object.assign(new Error('connect ECONNRESET'), { type: 'StripeConnectionError' });
      throw Object.assign(new Error('timeout'), { type: 'StripeConnectionError' });
    });

    expect(isUnavailable(await svc.open(row, opts).catch((e: unknown) => e))).toBe(true);
    expect(created).not.toHaveBeenCalled();
    expect(await rowStatus(a.id)).toBe('open');
    expect(await claimOf(request.id)).toBeNull();
  });

  it('the earlier page was paid between the look-up and the expire: Stripe confirms it, the payment is recorded, no new page', async () => {
    const { request, row, opts, svc, a } = await withOpenPage();
    const created = jest.spyOn(stripe, 'createCheckout');
    const realExpire = stripe.expireCheckout.bind(stripe);
    jest.spyOn(stripe, 'expireCheckout').mockImplementationOnce(async (id: string) => {
      stripe.complete(id);
      return realExpire(id); // Stripe refuses: the session is no longer open.
    });

    const e = await svc.open(row, opts).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CommError);
    expect({ code: (e as CommError).code, status: (e as CommError).status }).toEqual({ code: CommErrorCode.BILLING_STATE, status: 409 }); // already paid
    expect(created).not.toHaveBeenCalled();
    expect(await g.prisma.payment.count({ where: { stripeCheckoutSessionId: a.id } })).toBe(1);
    expect(await claimOf(request.id)).toBeNull();
  });

  it('the earlier page expired at Stripe between the look-up and the expire: Stripe confirms it, marked expired, one new page', async () => {
    const { request, row, opts, svc, a } = await withOpenPage();
    const realExpire = stripe.expireCheckout.bind(stripe);
    jest.spyOn(stripe, 'expireCheckout').mockImplementationOnce(async (id: string) => {
      stripe.expireAtStripe(id);
      return realExpire(id); // Stripe refuses: the session is no longer open.
    });

    const url = await svc.open(row, opts);
    expect(await rowStatus(a.id)).toBe('expired');
    expect(sessionsOf(request.id).filter((s) => s.status === 'open').map((s) => s.url)).toEqual([url]);
    expect(await claimOf(request.id)).toBeNull();
  });
});
