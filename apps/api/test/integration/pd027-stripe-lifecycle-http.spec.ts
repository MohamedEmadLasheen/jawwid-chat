/**
 * PD-27 completion over real HTTP (docs/admin/pd027-stripe-lifecycle.md): real
 * logins, the global bearer guard, the real routes, the REAL Stripe signature
 * check (FakeStripe verifies with the SDK). Stripe itself is the in-memory
 * stand-in: no network, no real payment, test-mode ids only.
 *
 * What it proves:
 *  - a card payment is recorded once, whichever confirming event comes first
 *    or how often; it carries the Stripe customer, charge, brand and last 4;
 *    the package's lessons are credited exactly once;
 *  - a declined card is counted (once per event) and the parent is told why;
 *    a cancelled or expired checkout records nothing;
 *  - a refund that arrives BEFORE its payment is kept and recorded with it;
 *    a Dashboard refund (charge.refunded) is recorded once;
 *  - a lost webhook, a database failure mid-webhook and Stripe being down are
 *    all recovered from, exactly once;
 *  - Stripe Billing events (invoices, subscriptions) change nothing;
 *  - the transaction ledger, card attempts and the webhook log answer only the
 *    staff who may see them, and only their academy's.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { AuthService } from '@platform/auth/auth.service';
import { hashPassword } from '@platform/auth/password';
import { CommErrorCode } from '@platform/errors';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { LessonModule } from '../../src/lessons/lesson.module';
import { BillingModule } from '../../src/billing/billing.module';
import { ParentRecordModule } from '../../src/parent-profile/parent-record.module';
import { STRIPE_GATEWAY } from '../../src/billing/stripe.gateway';
import { PaymentLedger } from '../../src/billing/payment-ledger.service';
import { StripeReconciler } from '../../src/billing/stripe-reconciler.service';
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
const PASSWORD = 'pd27-stripe-lifecycle-password-1';
const DOMAIN = 'pd27s.qa.jawwid.test';

const g = buildGraph();
const stripe = new FakeStripe();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

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
/** A fresh seeded family per test, so no test sees another's money. */
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

async function backdate(sessionId: string, minutes: number) {
  await g.prisma.$executeRaw`UPDATE chat.payment_checkout SET created_at = now() - make_interval(mins => ${minutes}::int) WHERE stripe_session_id = ${sessionId}`;
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd27s-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd27s-${orgId.slice(0, 8)}', 'PD-27 Stripe lifecycle QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({
      data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id },
    });
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
  stripe.failNextRead = null;
  stripe.failNextCustomer = null;
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd27s-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedLinkBase === undefined) delete process.env.PAYMENT_LINK_BASE_URL;
  else process.env.PAYMENT_LINK_BASE_URL = inheritedLinkBase;
});

describe('a successful card payment', () => {
  it('in the app: one Stripe customer (metadata only), the server\'s amount, recorded once with its Stripe references; the lessons credited once', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);

    // The parent cannot set the price: an amount in the body is ignored.
    const started = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id, amountMinor: 1 });
    expect(started.status).toBe(201);
    const sessionId = started.json.url.slice(started.json.url.lastIndexOf('/') + 1);
    const input = stripe.sessions.get(sessionId)!.input;
    expect(input.amountMinor).toBe(120000);
    expect(input.customerId).toMatch(/^cus_/);

    // The customer carries ids only -- never a name or an e-mail.
    const customer = [...stripe.customers.values()].find((c) => c.id === input.customerId)!;
    expect(customer.metadata).toEqual({ familyId: f.id, organizationId: orgId });
    const mapped = await g.prisma.stripeCustomer.findUnique({ where: { familyId_livemode: { familyId: f.id, livemode: false } } });
    expect(mapped?.stripeCustomerId).toBe(input.customerId);

    // A second checkout reuses it (and expires the first page).
    const calls = stripe.customerCalls;
    const again = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id });
    const sessionId2 = again.json.url.slice(again.json.url.lastIndexOf('/') + 1);
    expect(stripe.customerCalls).toBe(calls);
    expect(stripe.sessions.get(sessionId2)!.input.customerId).toBe(input.customerId);
    expect(stripe.expired).toContain(sessionId);

    // Paid. checkout.session.completed, its redelivery, then payment_intent.succeeded.
    const completed = stripe.completedEvent(stripe.complete(sessionId2));
    expect((await webhook(completed)).json.outcome).toBe('recorded');
    expect((await webhook(completed)).json.outcome).toBe('duplicate');
    expect((await webhook(stripe.intentEvent(sessionId2, 'payment_intent.succeeded'))).json.outcome).toBe('already_recorded');

    const payments = await g.prisma.payment.findMany({ where: { requestId: request.id } });
    expect(payments).toHaveLength(1);
    const p = payments[0]!;
    expect(p).toMatchObject({
      method: 'card', amountMinor: 120000n, currency: 'AED', stripeCheckoutSessionId: sessionId2,
      stripeCustomerId: input.customerId, cardBrand: 'visa', cardLast4: '4242', paymentMethodType: 'card',
    });
    expect(p.stripeChargeId).toMatch(/^ch_/);
    expect(await g.prisma.invoice.count({ where: { paymentId: p.id } })).toBe(1);
    // Activation exactly once: one package credited for the request, whatever the events.
    expect(await g.prisma.learnerSubscription.count({ where: { requestId: request.id, voidedAt: null } })).toBe(1);

    // The audit row names the object and the academy, never the body.
    const ev = await g.prisma.stripeEvent.findFirst({ where: { objectId: sessionId2, outcome: 'recorded' } });
    expect(ev).toMatchObject({ type: 'checkout.session.completed', organizationId: orgId, paymentIntentId: p.stripePaymentIntentId });
    expect(ev!.stripeCreatedAt).toBeInstanceOf(Date);

    // The parent sees the card used.
    const mine = await http(f.parent.subject, 'GET', '/me/billing');
    const inv = await g.prisma.invoice.findUniqueOrThrow({ where: { paymentId: p.id } });
    expect(mine.json.invoices.find((x: any) => x.id === inv.id).card).toEqual({ brand: 'visa', last4: '4242', wallet: null });
    expect(mine.json.requests.find((r: any) => r.id === request.id)).toMatchObject({ status: 'paid', lastCardFailure: null });
  });

  it('out of order: payment_intent.succeeded first records it; checkout.session.completed after it records nothing more', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    const session = stripe.complete(sessionId);

    expect((await webhook(stripe.intentEvent(sessionId, 'payment_intent.succeeded'))).json.outcome).toBe('recorded');
    expect((await webhook(stripe.completedEvent(session))).json.outcome).toBe('already_recorded');
    expect(await g.prisma.payment.count({ where: { requestId: request.id } })).toBe(1);
    expect(await g.prisma.learnerSubscription.count({ where: { requestId: request.id, voidedAt: null } })).toBe(1);
  });

  it('a renewal is a new package: a second paid request credits a second package, once', async () => {
    const { f, child } = freshFamily();
    for (const amount of [100000, 110000]) {
      const r = await lessonRequest(f.id, child.id, amount);
      const s = await payByCard(tokenOf(r.link));
      const ev = stripe.completedEvent(stripe.complete(s));
      expect((await webhook(ev)).json.outcome).toBe('recorded');
      expect((await webhook(ev)).json.outcome).toBe('duplicate');
    }
    expect(await g.prisma.learnerSubscription.count({ where: { learnerId: child.id, source: 'payment_request', voidedAt: null } })).toBe(2);
  });

  it('Stripe refusing to create a customer never stops the payment: the parent pays as a guest', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    stripe.failNextCustomer = Object.assign(new Error('api down'), { type: 'StripeAPIError', statusCode: 500 });
    const started = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id });
    expect(started.status).toBe(201);
    const sessionId = started.json.url.slice(started.json.url.lastIndexOf('/') + 1);
    expect(stripe.sessions.get(sessionId)!.input.customerId).toBeNull();
    expect(await g.prisma.stripeCustomer.count({ where: { familyId: f.id } })).toBe(0);
  });
  it('a family\'s Stripe customer deleted in the Dashboard: the checkout retries as a guest instead of failing', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    expect((await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id })).status).toBe(201);
    stripe.failNextCheckout = Object.assign(new Error('No such customer'), { type: 'StripeInvalidRequestError', code: 'resource_missing', param: 'customer', statusCode: 400 });
    const again = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id });
    expect(again.status).toBe(201);
    const sessionId = again.json.url.slice(again.json.url.lastIndexOf('/') + 1);
    expect(stripe.sessions.get(sessionId)!.input).toMatchObject({ customerId: null });
    expect(stripe.sessions.get(sessionId)!.input.idempotencyKey).toMatch(/:guest$/);
    // Any other refusal is still a plain 503.
    stripe.failNextCheckout = Object.assign(new Error('No such price'), { type: 'StripeInvalidRequestError', code: 'resource_missing', param: 'line_items', statusCode: 400 });
    expect((await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id })).code).toBe(CommErrorCode.PAYMENTS_UNAVAILABLE);
  });
});

describe('a payment that fails', () => {
  it('a declined card: counted once per event, Stripe\'s code kept (never its message), nothing recorded, the parent told why', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));

    const declined = stripe.intentEvent(sessionId, 'payment_intent.payment_failed', { declineCode: 'insufficient_funds' });
    expect((await webhook(declined)).json.outcome).toBe('payment_failed');
    expect((await webhook(declined)).json.outcome).toBe('duplicate');
    const c = await g.prisma.paymentCheckout.findUniqueOrThrow({ where: { stripeSessionId: sessionId } });
    expect(c).toMatchObject({ status: 'open', failureCount: 1, failureCode: 'insufficient_funds' });
    expect(c.lastFailedAt).toBeInstanceOf(Date);
    const row = JSON.stringify(await g.prisma.$queryRaw`SELECT to_jsonb(c)::text AS j FROM chat.payment_checkout c WHERE stripe_session_id = ${sessionId}`);
    expect(row).not.toMatch(/Your card|4242/);
    expect(await g.prisma.payment.count({ where: { requestId: request.id } })).toBe(0);

    // A second decline on the same page.
    expect((await webhook(stripe.intentEvent(sessionId, 'payment_intent.payment_failed', { code: 'expired_card' }))).json.outcome).toBe('payment_failed');
    expect((await g.prisma.paymentCheckout.findUniqueOrThrow({ where: { stripeSessionId: sessionId } })).failureCount).toBe(2);

    // The parent, in the app and on the link page.
    const mine = await http(f.parent.subject, 'GET', '/me/billing');
    const r = mine.json.requests.find((x: any) => x.id === request.id);
    expect(r.status).toBe('open');
    expect(r.lastCardFailure).toMatchObject({ code: 'expired_card' });
    const page = await (await fetch(`${base}/pay/${tokenOf(request.link)}`)).text();
    expect(page).toContain('البطاقة منتهية الصلاحية');
    expect(page).toContain('التحويل البنكي');

    // Staff see it among failed attempts.
    const failed = await http(m.operationsManager.subject, 'GET', '/payment-attempts?status=failed');
    expect(failed.status).toBe(200);
    expect(failed.json.items.find((a: any) => a.sessionId === sessionId)).toMatchObject({ failureCount: 2, failureCode: 'expired_card', paymentId: null, family: { id: f.id } });

    // Paying on a fresh page clears the warning.
    const fresh = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id });
    expect(fresh.status).toBe(201);
    expect((await http(f.parent.subject, 'GET', '/me/billing')).json.requests.find((x: any) => x.id === request.id).lastCardFailure).toBeNull();
  });

  it('a cancelled checkout records nothing; when Stripe expires it, it is an unpaid (failed) attempt', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const token = tokenOf(request.link);
    const sessionId = await payByCard(token);

    const back = await (await fetch(`${base}/pay/${token}?checkout=cancelled&lang=en`)).text();
    expect(back).toContain('The payment was not completed');
    expect(back).toContain('/checkout?lang=en');

    stripe.expireAtStripe(sessionId);
    const expired = stripe.plainEvent('checkout.session.expired', { id: sessionId, object: 'checkout.session', status: 'expired', payment_status: 'unpaid', metadata: {}, expires_at: 0 });
    expect((await webhook(expired)).json.outcome).toBe('checkout_expired');
    expect((await g.prisma.paymentCheckout.findUniqueOrThrow({ where: { stripeSessionId: sessionId } })).status).toBe('expired');
    expect(await g.prisma.payment.count({ where: { requestId: request.id } })).toBe(0);
    const failed = await http(m.superAdmin.subject, 'GET', '/payment-attempts?status=failed');
    expect(failed.json.items.some((a: any) => a.sessionId === sessionId && a.status === 'expired')).toBe(true);
  });

  it('a webhook that does not verify touches nothing -- not even the event log', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    stripe.complete(sessionId);
    const real = stripe.intentEvent(sessionId, 'payment_intent.succeeded', { eventId: `evt_forged_${randomUUID().slice(0, 8)}` });
    const forged = stripe.signedEvent(JSON.parse(real.body), 'whsec_not_the_endpoint_secret');
    expect((await webhook(forged)).status).toBe(400);
    expect((await webhook({ body: real.body, signature: 't=1,v1=deadbeef' })).status).toBe(400);
    expect((await webhook({ body: real.body.replace('succeeded', 'Succeeded'), signature: real.signature })).status).toBe(400);
    expect(await g.prisma.stripeEvent.count({ where: { id: JSON.parse(real.body).id } })).toBe(0);
    expect(await g.prisma.payment.count({ where: { requestId: request.id } })).toBe(0);
  });

  it('an amount that is not what Chat asked for, by either confirming event, is never recorded', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    stripe.complete(sessionId, { amountTotal: 100 });
    expect((await webhook(stripe.intentEvent(sessionId, 'payment_intent.succeeded'))).json.outcome).toBe('mismatch');
    stripe.complete(sessionId, { amountTotal: 120000, currency: 'USD' });
    expect((await webhook(stripe.completedEvent(stripe.sessions.get(sessionId)!))).json.outcome).toBe('mismatch');
    expect(await g.prisma.payment.count({ where: { requestId: request.id } })).toBe(0);
    expect(await g.prisma.learnerSubscription.count({ where: { requestId: request.id } })).toBe(0);
  });
});

describe('refunds', () => {
  it('out of order: a refund before its payment is kept (refund_deferred) and recorded when the payment is', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    const session = stripe.complete(sessionId);
    const refund = stripe.dashboardRefund(session.paymentIntentId!, 20000);

    const early = stripe.refundEvent(session.paymentIntentId!, refund.id, 20000);
    expect((await webhook(early)).json.outcome).toBe('refund_deferred');
    expect((await webhook(early)).json.outcome).toBe('duplicate');

    expect((await webhook(stripe.completedEvent(session))).json.outcome).toBe('recorded');
    const p = await g.prisma.payment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: sessionId } });
    const refunds = await g.prisma.paymentRefund.findMany({ where: { paymentId: p.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ stripeRefundId: refund.id, amountMinor: 20000n, recordedBy: null });
    // A refund does not reopen what it paid (PD-27 default 4): the package stands.
    expect(await g.prisma.learnerSubscription.count({ where: { requestId: request.id, voidedAt: null } })).toBe(1);
  });

  it('a Dashboard refund (charge.refunded) is recorded once, whichever refund events follow', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    const session = stripe.complete(sessionId);
    expect((await webhook(stripe.completedEvent(session))).json.outcome).toBe('recorded');
    const p = await g.prisma.payment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: sessionId } });

    const refund = stripe.dashboardRefund(session.paymentIntentId!, 120000);
    expect((await webhook(stripe.chargeRefundedEvent(session.paymentIntentId!))).json.outcome).toBe('refund_recorded');
    expect((await webhook(stripe.chargeRefundedEvent(session.paymentIntentId!))).json.outcome).toBe('already_recorded');
    expect((await webhook(stripe.refundEvent(session.paymentIntentId!, refund.id, 120000))).json.outcome).toBe('refund_recorded');
    expect(await g.prisma.paymentRefund.count({ where: { paymentId: p.id } })).toBe(1);

    const list = await http(m.superAdmin.subject, 'GET', `/payments?status=refunded&familyId=${f.id}`);
    expect(list.json.items.map((x: any) => x.id)).toEqual([p.id]);
    expect(list.json.items[0]).toMatchObject({ status: 'refunded', refundedMinor: 120000 });
  });

  it('a failed refund at Stripe is not money given back', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    const session = stripe.complete(sessionId);
    await webhook(stripe.completedEvent(session));
    const refund = stripe.dashboardRefund(session.paymentIntentId!, 5000, 'failed');
    const ev = stripe.signedEvent({
      id: `evt_test_rf_${randomUUID().slice(0, 8)}`, object: 'event', type: 'refund.updated', livemode: false, created: Math.floor(Date.now() / 1000),
      data: { object: { id: refund.id, object: 'refund', amount: 5000, payment_intent: session.paymentIntentId, status: 'failed', metadata: {} } },
    });
    expect((await webhook(ev)).json.outcome).toBe('refund_not_final');
    expect((await webhook(stripe.chargeRefundedEvent(session.paymentIntentId!))).json.outcome).toBe('already_recorded');
    expect(await g.prisma.paymentRefund.count({ where: { stripeRefundId: refund.id } })).toBe(0);
  });
  it('a refund recorded while pending that Stripe then fails is audited and alerted (never silently counted)', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    const session = stripe.complete(sessionId);
    await webhook(stripe.completedEvent(session));
    const p = await g.prisma.payment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: sessionId } });
    const refund = stripe.dashboardRefund(session.paymentIntentId!, 7000, 'pending');
    const ev = (type: string, status: string) => stripe.signedEvent({
      id: `evt_test_${type.replace('.', '')}_${randomUUID().slice(0, 8)}`, object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000),
      data: { object: { id: refund.id, object: 'refund', amount: 7000, payment_intent: session.paymentIntentId, status, metadata: {} } },
    });
    expect((await webhook(ev('refund.created', 'pending'))).json.outcome).toBe('refund_recorded');
    const failed = ev('refund.failed', 'failed');
    expect((await webhook(failed)).json.outcome).toBe('refund_failed_after_record');
    expect((await webhook(failed)).json.outcome).toBe('duplicate');
    const audits = await g.prisma.auditLog.findMany({ where: { action: 'payment.refund_failed_at_stripe', entityId: f.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ paymentId: p.id, stripeRefundId: refund.id, stripeStatus: 'failed' });
    // Append-only: the row stands until a person corrects it (documented follow-up).
    expect(await g.prisma.paymentRefund.count({ where: { stripeRefundId: refund.id } })).toBe(1);
  });
});

describe('recovery: lost webhooks, database failures, Stripe down', () => {
  it('a database failure mid-webhook answers 500, leaves nothing, and Stripe\'s retry records it once', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    const event = stripe.completedEvent(stripe.complete(sessionId));
    const eventId = JSON.parse(event.body).id;

    jest.spyOn(app.get(PaymentLedger), 'record').mockRejectedValueOnce(Object.assign(new Error('simulated: connection terminated'), { code: 'P1017' }));
    expect((await webhook(event)).status).toBe(500);
    expect(await g.prisma.stripeEvent.count({ where: { id: eventId } })).toBe(0);
    expect(await g.prisma.payment.count({ where: { requestId: request.id } })).toBe(0);

    expect((await webhook(event)).json.outcome).toBe('recorded');
    expect(await g.prisma.payment.count({ where: { requestId: request.id } })).toBe(1);
    expect(await g.prisma.learnerSubscription.count({ where: { requestId: request.id, voidedAt: null } })).toBe(1);
  });

  it('Stripe unreachable while a payment_intent event needs a lookup: 500, then the retry records it', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    stripe.complete(sessionId);
    const event = stripe.intentEvent(sessionId, 'payment_intent.succeeded');
    stripe.failNextRead = Object.assign(new Error('connect ETIMEDOUT'), { type: 'StripeConnectionError' });
    expect((await webhook(event)).status).toBe(500);
    expect(await g.prisma.stripeEvent.count({ where: { id: JSON.parse(event.body).id } })).toBe(0);
    expect((await webhook(event)).json.outcome).toBe('recorded');
  });

  it('Stripe unreachable for the card details: the payment is still recorded (without them)', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    const event = stripe.completedEvent(stripe.complete(sessionId));
    stripe.failNextRead = Object.assign(new Error('connect ETIMEDOUT'), { type: 'StripeConnectionError' });
    expect((await webhook(event)).json.outcome).toBe('recorded');
    const p = await g.prisma.payment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: sessionId } });
    expect(p).toMatchObject({ cardLast4: null, stripeChargeId: null, method: 'card' });
  });

  it('a webhook that never came: the reconciler records the paid checkout once, marks an expired one, and survives Stripe being down', async () => {
    const { f, child } = freshFamily();
    const paidReq = await lessonRequest(f.id, child.id);
    const goneReq = await lessonRequest(f.id, child.id, 90000);
    const paid = await payByCard(tokenOf(paidReq.link));
    const gone = await payByCard(tokenOf(goneReq.link));
    stripe.complete(paid);
    stripe.expireAtStripe(gone);
    const reconciler = app.get(StripeReconciler);

    // Too recent: the webhook gets its chance first; Stripe is not asked.
    const before = stripe.reads.length;
    await reconciler.sweep({ organizationId: orgId });
    expect(stripe.reads.slice(before).some((r) => r.includes(paid))).toBe(false);

    await backdate(paid, 11);
    await backdate(gone, 50);
    // Stripe down for the first read: counted, nothing recorded, nothing lost.
    stripe.failNextRead = Object.assign(new Error('connect ECONNRESET'), { type: 'StripeConnectionError' });
    const first = await reconciler.sweep({ organizationId: orgId });
    expect(first.errors).toBeGreaterThanOrEqual(1);

    const second = await reconciler.sweep({ organizationId: orgId });
    expect(await g.prisma.payment.count({ where: { requestId: paidReq.id } })).toBe(1);
    expect((await g.prisma.paymentCheckout.findUniqueOrThrow({ where: { stripeSessionId: gone } })).status).toBe('expired');
    expect(first.recorded + second.recorded).toBe(1);

    // The late webhook, and another sweep, add nothing.
    expect((await webhook(stripe.completedEvent(stripe.sessions.get(paid)!))).json.outcome).toBe('already_recorded');
    expect((await reconciler.sweep({ organizationId: orgId })).recorded).toBe(0);
    expect(await g.prisma.payment.count({ where: { requestId: paidReq.id } })).toBe(1);
    expect(await g.prisma.learnerSubscription.count({ where: { requestId: paidReq.id, voidedAt: null } })).toBe(1);
  });

  it('reconciling one payment: a refund whose webhook never came is recorded; Chat and Stripe then agree', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    const session = stripe.complete(sessionId);
    await webhook(stripe.completedEvent(session));
    const p = await g.prisma.payment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: sessionId } });
    stripe.dashboardRefund(session.paymentIntentId!, 30000);

    const r1 = await http(m.operationsManager.subject, 'POST', `/payments/${p.id}/reconcile`);
    expect(r1.status).toBe(201);
    expect(r1.json).toMatchObject({ inSync: true, recordedRefunds: 1, chat: { amountMinor: 120000, refundedMinor: 30000 }, stripe: { amountRefundedMinor: 30000, status: 'succeeded' } });
    const r2 = await http(m.operationsManager.subject, 'POST', `/payments/${p.id}/reconcile`);
    expect(r2.json).toMatchObject({ inSync: true, recordedRefunds: 0 });

    // Stripe down: 503, a plain message.
    stripe.failNextRead = Object.assign(new Error('down'), { type: 'StripeConnectionError' });
    const down = await http(m.operationsManager.subject, 'POST', `/payments/${p.id}/reconcile`);
    expect(down.status).toBe(503);
    expect(down.code).toBe(CommErrorCode.PAYMENTS_UNAVAILABLE);
  });
});

describe('Stripe Billing events (invoices, subscriptions) change nothing', () => {
  it.each([
    'invoice.paid', 'invoice.payment_failed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  ])('%s is recorded as ignored_not_chat', async (type) => {
    const before = await g.prisma.payment.count();
    const ev = stripe.plainEvent(type, { id: type.startsWith('invoice') ? 'in_1Billing' : 'sub_1Billing', object: type.startsWith('invoice') ? 'invoice' : 'subscription' });
    expect((await webhook(ev)).json.outcome).toBe('ignored_not_chat');
    expect(await g.prisma.payment.count()).toBe(before);
    expect(await g.prisma.stripeEvent.findUnique({ where: { id: JSON.parse(ev.body).id } })).toMatchObject({ outcome: 'ignored_not_chat', organizationId: null });
  });
});

describe('S3 + S6: Chat marks its own Stripe objects, and puts no child\'s name on them', () => {
  it('the Checkout Session and its payment intent carry system jawwid-chat; the line item is the request\'s label, never the child\'s name', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    const { params, input } = stripe.sessions.get(sessionId)!;

    expect(params.metadata).toEqual({ system: 'jawwid-chat', paymentRequestId: request.id, organizationId: orgId });
    expect(params.payment_intent_data?.metadata).toEqual({ system: 'jawwid-chat', paymentRequestId: request.id, organizationId: orgId });

    // The request does know the child (the ledger keeps it); Stripe is not told.
    const row = await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.childName).toBe(child.name);
    const surname = child.name.split(' ').slice(1).join(' ');
    expect(surname.length).toBeGreaterThan(0);
    expect(input.productName).toBe('Quran — renewal');
    expect(params.line_items?.[0]?.price_data?.product_data?.name).toBe('Quran — renewal');
    expect(JSON.stringify(params)).not.toContain(surname);
    expect(JSON.stringify(params)).not.toContain(child.name);
  });
});

describe('disputes (M2): flagged and audited; the money ledger is never changed', () => {
  it('each dispute event on a recorded payment has its outcome and one audit row; redelivery is a duplicate; the payment, refunds and package stand', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    const session = stripe.complete(sessionId);
    expect((await webhook(stripe.completedEvent(session))).json.outcome).toBe('recorded');
    const before = await g.prisma.payment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: sessionId } });
    const pi = session.paymentIntentId!;
    const errors = jest.spyOn(Logger.prototype, 'error');

    const disputeId = 'du_TDisputeOne1';
    const opened = stripe.disputeEvent('created', pi, { disputeId });
    expect((await webhook(opened)).json.outcome).toBe('dispute_opened');
    expect((await webhook(opened)).json.outcome).toBe('duplicate');
    expect((await webhook(stripe.disputeEvent('updated', pi, { disputeId, status: 'under_review' }))).json.outcome).toBe('dispute_updated');
    expect((await webhook(stripe.disputeEvent('funds_withdrawn', pi, { disputeId, status: 'under_review' }))).json.outcome).toBe('dispute_funds_withdrawn');
    expect((await webhook(stripe.disputeEvent('closed', pi, { disputeId, status: 'won' }))).json.outcome).toBe('dispute_closed_won');
    expect((await webhook(stripe.disputeEvent('funds_reinstated', pi, { disputeId, status: 'won' }))).json.outcome).toBe('dispute_funds_reinstated');

    // Matched by the charge when Stripe sends no payment intent.
    expect(before.stripeChargeId).toMatch(/^ch_/);
    const byCharge = stripe.disputeEvent('created', null, { disputeId: 'du_TDisputeTwo2', chargeId: before.stripeChargeId! });
    expect((await webhook(byCharge)).json.outcome).toBe('dispute_opened');
    expect((await webhook(stripe.disputeEvent('closed', null, { disputeId: 'du_TDisputeTwo2', chargeId: before.stripeChargeId!, status: 'lost' }))).json.outcome).toBe('dispute_closed_lost');

    // One audit row per event, naming the payment and the dispute (codes only).
    const audits = await g.prisma.auditLog.findMany({ where: { action: { startsWith: 'payment.dispute_' }, entityId: f.id }, orderBy: { at: 'asc' } });
    expect(audits.map((a) => a.action)).toEqual([
      'payment.dispute_opened', 'payment.dispute_updated', 'payment.dispute_funds_withdrawn', 'payment.dispute_closed', 'payment.dispute_funds_reinstated',
      'payment.dispute_opened', 'payment.dispute_closed',
    ]);
    expect(audits[0]!.after).toMatchObject({ paymentId: before.id, requestId: request.id, disputeId, paymentIntentId: pi, amountMinor: 120000, currency: 'AED', stripeReason: 'fraudulent' });
    expect(audits[3]!.after).toMatchObject({ stripeStatus: 'won', outcome: 'dispute_closed_won' });

    // The webhook log attributes them to the academy and the payment.
    const ev = await g.prisma.stripeEvent.findUniqueOrThrow({ where: { id: JSON.parse(opened.body).id } });
    expect(ev).toMatchObject({ type: 'charge.dispute.created', outcome: 'dispute_opened', organizationId: orgId, objectId: disputeId, paymentIntentId: pi });
    const log = await http(m.operationsManager.subject, 'GET', '/stripe/events?outcome=dispute_opened&type=charge.dispute.');
    expect(log.json.items.map((e: any) => e.id)).toContain(ev.id);

    // Error level for a new dispute and for money withdrawn; not for the rest.
    const lines = errors.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes('dispute_opened'))).toHaveLength(2);
    expect(lines.filter((l) => l.includes('dispute_funds_withdrawn'))).toHaveLength(1);
    expect(lines.some((l) => l.includes('dispute_updated') || l.includes('dispute_closed_') || l.includes('dispute_funds_reinstated'))).toBe(false);

    // Flag only: the ledger is exactly as it was.
    const after = await g.prisma.payment.findUniqueOrThrow({ where: { id: before.id } });
    expect(after).toEqual(before);
    expect(await g.prisma.paymentRefund.count({ where: { paymentId: before.id } })).toBe(0);
    expect(await g.prisma.learnerSubscription.count({ where: { requestId: request.id, voidedAt: null } })).toBe(1);
    expect((await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } })).paidAt).not.toBeNull();
    const list = await http(m.superAdmin.subject, 'GET', `/payments?familyId=${f.id}`);
    expect(list.json.items.find((x: any) => x.id === before.id)).toMatchObject({ status: 'standing', refundedMinor: 0 });
  });

  it('a dispute, refund or charge.refunded on a payment Chat did not take is not_chat: nothing audited, nothing recorded, unattributed', async () => {
    const foreign = 'pi_TOtherSystem42';
    const auditsBefore = await g.prisma.auditLog.count({ where: { action: { startsWith: 'payment.' } } });
    const refundsBefore = await g.prisma.paymentRefund.count();

    const events = [
      stripe.disputeEvent('created', foreign, { disputeId: 'du_TForeignOne1' }),
      stripe.disputeEvent('funds_withdrawn', foreign, { disputeId: 'du_TForeignOne1' }),
      stripe.disputeEvent('created', null, { disputeId: 'du_TForeignTwo2', chargeId: 'ch_TOtherSystemCharge' }),
      stripe.refundEvent(foreign, 're_TForeignRefund1', 5000),
      stripe.chargeRefundedEvent(foreign),
    ];
    for (const e of events) {
      expect((await webhook(e)).json.outcome).toBe('not_chat');
      expect(await g.prisma.stripeEvent.findUniqueOrThrow({ where: { id: JSON.parse(e.body).id } })).toMatchObject({ outcome: 'not_chat', organizationId: null });
    }
    expect(await g.prisma.auditLog.count({ where: { action: { startsWith: 'payment.' } } })).toBe(auditsBefore);
    expect(await g.prisma.paymentRefund.count()).toBe(refundsBefore);
    // Never chased by the reconciler: it syncs refund_deferred only.
    expect(await g.prisma.stripeEvent.count({ where: { paymentIntentId: foreign, outcome: 'refund_deferred' } })).toBe(0);
  });

  it('a refund Chat cannot classify (Stripe unreachable) is kept as refund_deferred, never dropped', async () => {
    stripe.failNextRead = Object.assign(new Error('connect ETIMEDOUT'), { type: 'StripeConnectionError' });
    const e = stripe.refundEvent('pi_TUnclassified7', 're_TUnclassified7', 1000);
    expect((await webhook(e)).json.outcome).toBe('refund_deferred');
  });
});

describe('the transaction ledger and who sees it', () => {
  it('filters, totals, paging and the detail with Stripe references, attempts and events', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const sessionId = await payByCard(tokenOf(request.link));
    await webhook(stripe.completedEvent(stripe.complete(sessionId)));
    const cash = await http(m.operationsManager.subject, 'POST', `/families/${f.id}/payments`, {
      method: 'cash', amountMinor: 5000, currency: 'AED', paidOn: '2026-10-15', reference: 'counter-7',
    });
    expect({ status: cash.status, error: cash.json.error?.message }).toEqual({ status: 201, error: undefined });

    const all = await http(m.superAdmin.subject, 'GET', `/payments?familyId=${f.id}`);
    expect(all.status).toBe(200);
    expect(all.json.items).toHaveLength(2);
    expect(all.json.totals).toEqual([{ currency: 'AED', count: 2, amountMinor: 125000, refundedMinor: 0, netMinor: 125000 }]);
    expect(all.json.canReconcile).toBe(true);

    const card = await http(m.superAdmin.subject, 'GET', `/payments?familyId=${f.id}&method=card`);
    expect(card.json.items).toHaveLength(1);
    const tx = card.json.items[0];
    expect(tx).toMatchObject({ method: 'card', status: 'standing', card: { brand: 'visa', last4: '4242' }, family: { id: f.id }, request: { id: request.id, purpose: 'renewal', planMonths: 1 } });
    expect(tx.stripe).toMatchObject({ checkoutSessionId: sessionId, livemode: false });
    expect(tx.stripe.paymentIntentId).toMatch(/^pi_/);

    const byInvoice = await http(m.superAdmin.subject, 'GET', `/payments?q=${encodeURIComponent(tx.invoice.number)}`);
    expect(byInvoice.json.items.map((x: any) => x.id)).toEqual([tx.id]);
    const byIntent = await http(m.superAdmin.subject, 'GET', `/payments?q=${tx.stripe.paymentIntentId}`);
    expect(byIntent.json.items.map((x: any) => x.id)).toEqual([tx.id]);
    const byDate = await http(m.superAdmin.subject, 'GET', `/payments?familyId=${f.id}&from=2026-10-15&to=2026-10-15`);
    expect(byDate.json.items.map((x: any) => x.method)).toEqual(['cash']);
    // Wildcards in q are literal.
    expect((await http(m.superAdmin.subject, 'GET', `/payments?familyId=${f.id}&q=%25`)).json.items).toHaveLength(0);

    const page1 = await http(m.superAdmin.subject, 'GET', `/payments?familyId=${f.id}&limit=1`);
    expect(page1.json.items).toHaveLength(1);
    expect(page1.json.nextCursor).toEqual(expect.any(String));
    const page2 = await http(m.superAdmin.subject, 'GET', `/payments?familyId=${f.id}&limit=1&cursor=${page1.json.nextCursor}`);
    expect(page2.json.items).toHaveLength(1);
    expect(page2.json.items[0].id).not.toBe(page1.json.items[0].id);
    expect(page2.json.nextCursor).toBeNull();

    const detail = await http(m.superAdmin.subject, 'GET', `/payments/${tx.id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.payment.stripe.chargeId).toMatch(/^ch_/);
    expect(detail.json.attempts.map((a: any) => a.sessionId)).toContain(sessionId);
    expect(detail.json.events.map((e: any) => e.type)).toContain('checkout.session.completed');
    expect(detail.json.canReconcile).toBe(true);

    expect((await http(m.superAdmin.subject, 'GET', '/payments?status=paid')).status).toBe(400);
    expect((await http(m.superAdmin.subject, 'GET', `/payments/${randomUUID()}`)).status).toBe(404);
    expect((await http(m.superAdmin.subject, 'GET', '/payments/not-a-uuid')).status).toBe(404);
  });

  it('an Operations supervisor sees only the families they reach, cannot reconcile, cannot read the webhook log', async () => {
    const { supervisor } = freshFamily();
    const list = await http(supervisor.subject, 'GET', '/payments?limit=100');
    expect(list.status).toBe(200);
    expect(list.json.canReconcile).toBe(false);
    for (const item of list.json.items) {
      expect(item.family).not.toBeNull();
      const [reach] = await g.prisma.$queryRaw<{ reach: string | null }[]>`SELECT chat.staff_reaches_family(${supervisor.id}::uuid, ${item.family.id}::uuid) AS reach`;
      expect(reach!.reach).not.toBeNull();
    }
    const everyone = await http(m.superAdmin.subject, 'GET', '/payments?limit=100');
    expect(everyone.json.items.length).toBeGreaterThan(list.json.items.length);
    // A payment of a family they do not reach is not found, not forbidden (no existence oracle).
    const theirs = new Set(list.json.items.map((x: any) => x.id));
    const other = everyone.json.items.find((x: any) => !theirs.has(x.id));
    expect((await http(supervisor.subject, 'GET', `/payments/${other.id}`)).status).toBe(404);

    expect((await http(supervisor.subject, 'POST', `/payments/${other.id}/reconcile`)).status).toBe(403);
    expect((await http(supervisor.subject, 'GET', '/stripe/events')).status).toBe(403);
    expect((await http(supervisor.subject, 'POST', '/stripe/reconcile')).status).toBe(403);
  });

  it('parents, teachers and the unauthenticated reach none of it; a parent pays only their own family\'s request', async () => {
    const { f, child } = freshFamily();
    const { f: other } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const teacher = m.teachers[0]!;
    for (const [method, path] of [['GET', '/payments'], ['GET', '/payment-attempts'], ['GET', '/stripe/events'], ['POST', '/stripe/reconcile']] as const) {
      expect((await http(null, method, path)).status).toBe(401);
      expect((await http(f.parent.subject, method, path)).status).toBe(403);
      expect((await http(teacher.subject, method, path)).status).toBe(403);
    }
    const sessions = stripe.sessions.size;
    const theirs = await http(other.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id });
    expect([403, 404]).toContain(theirs.status);
    expect((await http(m.superAdmin.subject, 'POST', '/me/billing/checkout', { requestId: request.id })).status).toBe(403);
    expect(stripe.sessions.size).toBe(sessions);
  });

  it('the webhook log: the academy\'s own events for canVerify staff; events Chat could not attribute, the super admin\'s only', async () => {
    const unattributed = stripe.plainEvent('invoice.paid', { id: 'in_1Unattributed', object: 'invoice' });
    await webhook(unattributed);
    const id = JSON.parse(unattributed.body).id;

    const admin = await http(m.superAdmin.subject, 'GET', '/stripe/events?limit=100');
    expect(admin.status).toBe(200);
    expect(admin.json.items.map((e: any) => e.id)).toContain(id);
    expect(admin.json.items.some((e: any) => e.outcome === 'recorded' && e.type === 'checkout.session.completed')).toBe(true);

    const ops = await http(m.operationsManager.subject, 'GET', '/stripe/events?limit=100');
    expect(ops.status).toBe(200);
    expect(ops.json.items.map((e: any) => e.id)).not.toContain(id);
    expect(ops.json.items.length).toBeGreaterThan(0);

    const recorded = await http(m.superAdmin.subject, 'GET', '/stripe/events?outcome=recorded&type=checkout.');
    expect(recorded.json.items.every((e: any) => e.outcome === 'recorded' && e.type.startsWith('checkout.'))).toBe(true);
    const p1 = await http(m.superAdmin.subject, 'GET', '/stripe/events?limit=1');
    const p2 = await http(m.superAdmin.subject, 'GET', `/stripe/events?limit=1&cursor=${p1.json.nextCursor}`);
    expect(p2.json.items[0].id).not.toBe(p1.json.items[0].id);

    // Another academy's event never shows (an event attributed elsewhere).
    const otherOrg = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${otherOrg}'::uuid, 'pd27s-o${otherOrg.slice(0, 7)}', 'Other academy')`);
    await g.prisma.stripeEvent.create({ data: { id: `evt_other_${otherOrg.slice(0, 8)}`, type: 'checkout.session.completed', livemode: false, outcome: 'recorded', organizationId: otherOrg } });
    const again = await http(m.superAdmin.subject, 'GET', '/stripe/events?limit=100');
    expect(again.json.items.map((e: any) => e.id)).not.toContain(`evt_other_${otherOrg.slice(0, 8)}`);

    const reconcile = await http(m.superAdmin.subject, 'POST', '/stripe/reconcile');
    expect(reconcile.status).toBe(201);
    expect(reconcile.json).toEqual(expect.objectContaining({ checked: expect.any(Number), recorded: expect.any(Number), errors: expect.any(Number) }));
  });
});
