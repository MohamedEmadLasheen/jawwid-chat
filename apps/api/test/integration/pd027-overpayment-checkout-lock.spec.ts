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
 *  S1  CheckoutService.open() is serialized per request (advisory lock): two
 *      opens at once leave ONE payable Stripe session; a session already
 *      recorded (a replayed idempotency key) answers the same page, never a 500.
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
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { LessonModule } from '../../src/lessons/lesson.module';
import { BillingModule } from '../../src/billing/billing.module';
import { ParentRecordModule } from '../../src/parent-profile/parent-record.module';
import { STRIPE_GATEWAY, type CheckoutInput } from '../../src/billing/stripe.gateway';
import { CheckoutService } from '../../src/billing/checkout.service';
import { OVERPAYMENT_ACTION, OVERPAYMENT_EVENT } from '../../src/billing/payment-ledger.service';
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

describe('S1: one payable Checkout session per request', () => {
  it('two opens at once: serialized, so exactly one Stripe session stays payable', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const row = await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } });
    const svc = app.get(CheckoutService);
    const opts = { locale: 'en' as const, returnUrl: request.link };

    const urls = await Promise.all([svc.open(row, opts), svc.open(row, opts)]);
    expect(new Set(urls).size).toBe(2);

    const atStripe = [...stripe.sessions.values()].filter((s) => s.input.requestId === request.id);
    expect(atStripe).toHaveLength(2);
    expect(atStripe.filter((s) => s.status === 'open')).toHaveLength(1);
    expect(await g.prisma.paymentCheckout.count({ where: { requestId: request.id } })).toBe(2);
    expect(await g.prisma.paymentCheckout.count({ where: { requestId: request.id, status: 'open' } })).toBe(1);
    // The payable one is the one recorded open.
    const open = await g.prisma.paymentCheckout.findFirstOrThrow({ where: { requestId: request.id, status: 'open' } });
    expect(atStripe.find((s) => s.status === 'open')!.id).toBe(open.stripeSessionId);
  });

  it('two taps on Pay over HTTP at once: both answer a page, one is payable, no 500', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    const both = await Promise.all([
      http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id }),
      http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id }),
    ]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect([...stripe.sessions.values()].filter((s) => s.input.requestId === request.id && s.status === 'open')).toHaveLength(1);
    expect(await g.prisma.paymentCheckout.count({ where: { requestId: request.id, status: 'open' } })).toBe(1);
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
