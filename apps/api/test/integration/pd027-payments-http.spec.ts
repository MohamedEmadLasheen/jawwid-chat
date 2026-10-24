/**
 * PD-27 over real HTTP: real logins, the global bearer guard, the real routes,
 * the real Stripe signature check (FakeStripe verifies with the SDK).
 *
 * What it proves, end to end:
 *  - a payment link opens without an account, pays by card through Checkout,
 *    and the payment exists only after a VERIFIED webhook -- exactly once;
 *  - an invoice is issued and the parent downloads it as a PDF; nobody else can;
 *  - partial instalment payments (cash + card), bank-transfer receipts
 *    (approve / reject), voids, refunds, settings, reminders;
 *  - who may do what (recorders record, void and decide receipts; refunds and
 *    settings are canVerify's; teachers never).
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
import { CommErrorCode } from '@platform/errors';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { LessonModule } from '../../src/lessons/lesson.module';
import { BillingModule } from '../../src/billing/billing.module';
import { ParentRecordModule } from '../../src/parent-profile/parent-record.module';
import { STRIPE_GATEWAY } from '../../src/billing/stripe.gateway';
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
const PASSWORD = 'pd27-http-spec-password-1';
const DOMAIN = 'pd27http.qa.jawwid.test';

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

/** The academy's today (Africa/Cairo, the default schedule.timezone). */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function tokenOf(link: string): string {
  return link.slice(link.lastIndexOf('/') + 1);
}

/** POST the link page's form; answers Stripe's URL from the 303. */
async function payByCard(token: string): Promise<string> {
  const r = await fetch(`${base}/pay/${token}/checkout`, { method: 'POST', redirect: 'manual' });
  expect(r.status).toBe(303);
  const location = r.headers.get('location')!;
  expect(location).toMatch(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
  return location.slice(location.lastIndexOf('/') + 1);
}

function familyOf(i: number) {
  const f = m.families[i]!;
  const supervisorId = f.children[0]!.supervisorId;
  const supervisor = m.supervisors.find((s) => s.id === supervisorId)!;
  const teacher = m.teachers.find((t) => t.id === f.children[0]!.teacherId)!;
  return { f, supervisor, teacher };
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd27h-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd27h-${orgId.slice(0, 8)}', 'PD-27 HTTP QA academy')`,
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

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd27h-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedLinkBase === undefined) delete process.env.PAYMENT_LINK_BASE_URL;
  else process.env.PAYMENT_LINK_BASE_URL = inheritedLinkBase;
});

describe('PD-27 over HTTP', () => {
  it('staff and parent routes are behind the bearer guard; the link page and the webhook are not', async () => {
    const { f } = familyOf(0);
    expect((await http(null, 'POST', `/families/${f.id}/payment-requests`, {})).status).toBe(401);
    expect((await http(null, 'GET', '/payment-receipts')).status).toBe(401);
    expect((await http(null, 'GET', '/me/billing')).status).toBe(401);
    expect((await http(null, 'POST', '/me/billing/checkout', {})).status).toBe(401);
    // Public, and still answering only what they must.
    const page = await fetch(`${base}/pay/${'x'.repeat(43)}`);
    expect(page.status).toBe(404);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await webhook({ body: '{}', signature: 't=1,v1=deadbeef' })).status).toBe(400);
  });

  it('a subscription link: opened without an account, paid by card, recorded once by the verified webhook, invoiced', async () => {
    const { f } = familyOf(0);
    const child = f.children[0]!;
    expect((await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED', planMonths: 3 })).status).toBe(201);

    // Sales asks for the subscription.
    const created = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'subscription', label: 'Quran — 3 months', amountMinor: 150000, learnerId: child.id,
      planMonths: 3, periodStart: '2026-11-01', periodEnd: '2027-01-31',
    });
    expect(created.status).toBe(201);
    const request = created.json.request;
    expect(request).toMatchObject({ status: 'open', amountMinor: 150000, remainingMinor: 150000, currency: 'AED', planMonths: 3 });
    expect(request.link).toBe(`${base}/pay/${tokenOf(request.link)}`);
    expect(tokenOf(request.link)).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The parent opens the link: no sign-in, the amount and the child's first name -- and nothing else.
    const token = tokenOf(request.link);
    const page = await fetch(`${base}/pay/${token}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('1,500.00');
    expect(html).toContain(child.name.split(' ')[0]!);
    expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(html).not.toContain(DOMAIN);
    expect(html).toContain('/checkout?lang=ar');

    // Pay by card -> Stripe Checkout, for exactly what is owed.
    const sessionId = await payByCard(token);
    expect(stripe.sessions.get(sessionId)!.input).toMatchObject({ amountMinor: 150000, currency: 'AED', requestId: request.id });

    // The success page records nothing.
    expect((await fetch(`${base}/pay/${token}?checkout=success`)).status).toBe(200);
    expect(await g.prisma.payment.count({ where: { requestId: request.id } })).toBe(0);

    // Stripe confirms. Recorded once; a redelivery and a second event change nothing.
    const event = stripe.completedEvent(stripe.complete(sessionId));
    expect((await webhook(event)).json.outcome).toBe('recorded');
    expect((await webhook(event)).json.outcome).toBe('duplicate');
    expect((await webhook(stripe.completedEvent(stripe.sessions.get(sessionId)!))).json.outcome).toBe('already_recorded');
    expect(await g.prisma.payment.count({ where: { requestId: request.id } })).toBe(1);

    const billing = await http(m.superAdmin.subject, 'GET', `/families/${f.id}/billing`);
    const req = billing.json.requests.find((r: any) => r.id === request.id);
    expect(req).toMatchObject({ status: 'paid', paidMinor: 150000, remainingMinor: 0 });
    const payment = billing.json.payments.find((p: any) => p.requestId === request.id);
    expect(payment).toMatchObject({ method: 'card', amountMinor: 150000, recordedBy: null, child: { id: child.id } });
    expect(payment.invoice.number).toMatch(/^JW-\d{4}-000001$/);

    // The parent sees it, with the invoice, and downloads the PDF.
    const mine = await http(f.parent.subject, 'GET', '/me/billing');
    expect(mine.status).toBe(200);
    expect(mine.json.cardAvailable).toBe(true);
    const inv = mine.json.invoices.find((i: any) => i.id === payment.invoice.id);
    expect(inv).toMatchObject({ status: 'paid', amountMinor: 150000, method: 'card', planMonths: 3, periodStart: '2026-11-01' });
    expect(mine.json.requests.find((r: any) => r.id === request.id)).not.toHaveProperty('link');
    const link = await http(f.parent.subject, 'GET', `/me/billing/invoices/${inv.id}/link`);
    expect(link.status).toBe(200);
    const pdf = await fetch(link.json.url.replace(/^.*\/api\/v1/, base));
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');

    // Another family's parent cannot open it, by either route.
    const other = familyOf(1).f;
    expect((await http(other.parent.subject, 'GET', `/me/billing/invoices/${inv.id}/link`)).code).toBe(CommErrorCode.BILLING_NOT_FOUND);
    const theirsSigned = await fetch(link.json.url.replace(/^.*\/api\/v1/, base).replace(/a=[^&]+/, `a=${other.parent.id}`));
    expect(theirsSigned.status).toBe(403);

    // The page now says paid, and offers no card.
    const after = await (await fetch(`${base}/pay/${token}?lang=en`)).text();
    expect(after).toContain('Paid — thank you');
    expect(after).not.toContain('/checkout?lang=');
  });

  it('a webhook that does not verify, or a paid amount that is not what we asked, records nothing', async () => {
    const { f } = familyOf(2);
    const created = await http(m.operationsManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'renewal', label: 'Renewal', amountMinor: 90000, currency: 'AED',
    });
    const token = tokenOf(created.json.request.link);
    const sessionId = await payByCard(token);
    const session = stripe.complete(sessionId);

    const forged = stripe.signedEvent(JSON.parse(stripe.completedEvent(session).body), 'whsec_not_the_endpoint_secret');
    expect((await webhook(forged)).status).toBe(400);

    const cheap = stripe.completedEvent({ ...session, amountTotal: 100 });
    expect((await webhook(cheap)).json.outcome).toBe('mismatch');
    expect(await g.prisma.payment.count({ where: { requestId: created.json.request.id } })).toBe(0);
    expect(await g.prisma.auditLog.count({ where: { action: 'payment.stripe_mismatch' } })).toBeGreaterThanOrEqual(1);
  });

  it('an instalment plan with a custom schedule, paid in part in cash and the rest by card in the app', async () => {
    const { f, supervisor } = familyOf(3);
    expect((await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' })).status).toBe(201);
    const plan = await http(supervisor.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Annual plan', items: [{ amountMinor: 100000, dueDate: '2026-11-01' }, { amountMinor: 50000, dueDate: '2026-12-01' }],
    });
    expect(plan.status).toBe(201);
    const [first, second] = plan.json.instalments as any[];
    expect(first).toMatchObject({ amountMinor: 100000, label: 'Annual plan · 1/2', paidMinor: 0, remainingMinor: 100000, partial: false });
    expect(second.amountMinor).toBe(50000);
    expect((await http(supervisor.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'x', items: [{ amountMinor: 1, dueDate: '2026-12-01' }, { amountMinor: 1, dueDate: '2026-11-01' }],
    })).code).toBe(CommErrorCode.VALIDATION);

    // A supervisor records cash (PD-17 / PD-20: Operations records payments in reach).
    const cash = await http(supervisor.subject, 'POST', `/families/${f.id}/payments`, {
      method: 'cash', amountMinor: 40000, paidOn: today(), instalmentId: first.id, reference: 'Receipt book 12',
    });
    expect(cash.status).toBe(201);
    const partial = cash.json.instalments.find((i: any) => i.id === first.id);
    expect(partial).toMatchObject({ status: expect.any(String), paidMinor: 40000, remainingMinor: 60000, partial: true });
    expect(cash.json.payments[0]).toMatchObject({ method: 'cash', amountMinor: 40000, recordedBy: { id: supervisor.id } });
    expect((await http(supervisor.subject, 'POST', `/families/${f.id}/payments`, {
      method: 'cash', amountMinor: 60001, paidOn: today(), instalmentId: first.id,
    })).code).toBe(CommErrorCode.VALIDATION);

    // The parent pays the rest by card, in the app.
    const mine = await http(f.parent.subject, 'GET', '/me/billing');
    expect(mine.json.instalments.find((i: any) => i.id === first.id)).toMatchObject({ partial: true, remainingMinor: 60000 });
    const checkout = await http(f.parent.subject, 'POST', '/me/billing/checkout', { instalmentId: first.id });
    expect(checkout.status).toBe(201);
    const sessionId = checkout.json.url.slice(checkout.json.url.lastIndexOf('/') + 1);
    expect(stripe.sessions.get(sessionId)!.input.amountMinor).toBe(60000);
    expect((await webhook(stripe.completedEvent(stripe.complete(sessionId)))).json.outcome).toBe('recorded');

    const done = await http(m.superAdmin.subject, 'GET', `/families/${f.id}/billing`);
    const paid = done.json.instalments.find((i: any) => i.id === first.id);
    expect(paid).toMatchObject({ status: 'paid', paidMinor: 100000, remainingMinor: 0, partial: false });
    expect(paid.payment).toMatchObject({ method: 'card', recordedBy: null });
    expect(done.json.totals.find((t: any) => t.currency === 'AED')).toMatchObject({ paidMinor: 100000, outstandingMinor: 50000 });
    // The instalment is paid now, so its cash part is corrected by voiding the instalment, not the payment...
    const cashPayment = done.json.payments.find((p: any) => p.method === 'cash');
    expect((await http(m.operationsManager.subject, 'POST', `/payments/${cashPayment.id}/void`, { reason: 'typo' })).code).toBe(CommErrorCode.BILLING_STATE);
    // And an instalment a card paid towards is refunded, never voided.
    expect((await http(m.operationsManager.subject, 'POST', `/instalments/${first.id}/void`, { reason: 'x' })).code).toBe(CommErrorCode.BILLING_STATE);
  });

  it('a bank-transfer receipt: uploaded by the parent, pending, approved by a verifier into a payment; another rejected with a reason', async () => {
    const { f } = familyOf(4);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    await http(m.superAdmin.subject, 'POST', '/billing/settings', {
      bankAccount: { accountName: 'Academy Account', bankName: 'Test Bank', iban: 'AE070331234567890123456' },
    });
    const created = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'balance', label: 'Outstanding balance', amountMinor: 70000,
    });
    const requestId = created.json.request.id;

    const mine = await http(f.parent.subject, 'GET', '/me/billing');
    expect(mine.json.bankAccount).toMatchObject({ accountName: 'Academy Account', iban: 'AE070331234567890123456' });

    async function sendReceipt(amountMinor: number) {
      const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
      const grant = await http(f.parent.subject, 'POST', '/me/billing/receipts/upload', { mimeType: 'image/jpeg', byteSize: bytes.length });
      expect(grant.status).toBe(201);
      expect(grant.json.objectKey).toMatch(new RegExp(`^payment-receipts/${f.id}/`));
      const route = grant.json.uploadUrl.slice(grant.json.uploadUrl.indexOf('/storage/'));
      const put = await fetch(`${base}${route}`, {
        method: 'PUT',
        headers: { ...grant.json.headers, authorization: `Bearer ${await tokenFor(f.parent.subject)}` },
        body: bytes,
      });
      expect(put.status).toBe(201);
      const sent = await http(f.parent.subject, 'POST', '/me/billing/receipts', {
        objectKey: grant.json.objectKey, requestId, amountMinor, transferredOn: today(), note: 'transfer ref 991',
      });
      expect(sent.status).toBe(201);
      return sent.json.receipts[0];
    }

    const receipt = await sendReceipt(70000);
    expect(receipt).toMatchObject({ status: 'pending', amountMinor: 70000, requestId, label: 'Outstanding balance' });
    expect(receipt).not.toHaveProperty('uploadedBy');
    // The parent opens their own file; another family's parent cannot.
    const own = await fetch(receipt.fileUrl.replace(/^.*\/api\/v1/, base));
    expect(own.status).toBe(200);
    const other = familyOf(5).f;
    expect((await fetch(receipt.fileUrl.replace(/^.*\/api\/v1/, base).replace(/a=[^&]+/, `a=${other.parent.id}`))).status).toBe(403);

    // The queue: the payment recorders decide receipts (PD-17 / PD-20) -- here Sales.
    const queue = await http(m.salesManager.subject, 'GET', '/payment-receipts');
    expect(queue.json.items.find((r: any) => r.id === receipt.id)).toMatchObject({ family: { id: f.id }, uploadedBy: { id: f.parent.id } });
    expect(queue.json.canDecide).toBe(true);
    const approved = await http(m.salesManager.subject, 'POST', `/payment-receipts/${receipt.id}/approve`, {});
    expect(approved.status).toBe(201);
    expect(approved.json.receipt).toMatchObject({ status: 'approved', reviewedBy: { id: m.salesManager.id } });
    expect((await http(m.operationsManager.subject, 'POST', `/payment-receipts/${receipt.id}/approve`, {})).code).toBe(CommErrorCode.BILLING_STATE);

    const billing = await http(m.superAdmin.subject, 'GET', `/families/${f.id}/billing`);
    expect(billing.json.requests.find((r: any) => r.id === requestId)).toMatchObject({ status: 'paid' });
    const p = billing.json.payments.find((x: any) => x.requestId === requestId);
    expect(p).toMatchObject({ method: 'bank_transfer', amountMinor: 70000 });
    expect(p.invoice).not.toBeNull();

    // A second request, a receipt rejected with a reason the parent reads.
    const second = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'other', label: 'Books', amountMinor: 5000,
    });
    const rid = second.json.request.id;
    const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(80, 0x20)]);
    const grant = await http(f.parent.subject, 'POST', '/me/billing/receipts/upload', { mimeType: 'application/pdf', byteSize: bytes.length });
    const route = grant.json.uploadUrl.slice(grant.json.uploadUrl.indexOf('/storage/'));
    await fetch(`${base}${route}`, { method: 'PUT', headers: { ...grant.json.headers, authorization: `Bearer ${await tokenFor(f.parent.subject)}` }, body: bytes });
    // A file that is not what it claims is refused.
    const liar = await http(f.parent.subject, 'POST', '/me/billing/receipts', {
      objectKey: `payment-receipts/${familyOf(5).f.id}/x`, requestId: rid, amountMinor: 5000, transferredOn: today(),
    });
    expect(liar.code).toBe(CommErrorCode.VALIDATION);
    const sent = await http(f.parent.subject, 'POST', '/me/billing/receipts', {
      objectKey: grant.json.objectKey, requestId: rid, amountMinor: 5000, transferredOn: today(),
    });
    const pending = sent.json.receipts.find((r: any) => r.requestId === rid);
    const rejected = await http(m.superAdmin.subject, 'POST', `/payment-receipts/${pending.id}/reject`, { reason: 'The amount on the receipt is unreadable' });
    expect(rejected.json.receipt).toMatchObject({ status: 'rejected', rejectReason: 'The amount on the receipt is unreadable' });
    const seen = await http(f.parent.subject, 'GET', '/me/billing');
    expect(seen.json.receipts.find((r: any) => r.id === pending.id)).toMatchObject({ status: 'rejected', rejectReason: 'The amount on the receipt is unreadable' });
    expect(await g.prisma.notification.count({ where: { templateKey: 'payment_receipt_rejected', recipientId: f.parent.id } })).toBe(1);
  });

  it('voids and refunds: a cash mistake is voided (its invoice with it, the request owed again); a card payment is refunded through Stripe, once', async () => {
    const { f } = familyOf(6);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    const req = (await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'subscription', label: 'Monthly', amountMinor: 30000,
    })).json.request;
    const cash = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, {
      method: 'cash', amountMinor: 30000, paidOn: today(), requestId: req.id,
    });
    expect(cash.json.requests.find((r: any) => r.id === req.id).status).toBe('paid');
    const payment = cash.json.payments.find((p: any) => p.requestId === req.id);
    // A teacher never; the recorder who made the mistake voids it (PD-17's rule).
    expect((await http(familyOf(6).teacher.subject, 'POST', `/payments/${payment.id}/void`, { reason: 'x' })).code).toBe(CommErrorCode.BILLING_DENIED);
    const voided = await http(m.salesManager.subject, 'POST', `/payments/${payment.id}/void`, { reason: 'wrong family' });
    expect(voided.status).toBe(201);
    expect(voided.json.payments.find((p: any) => p.id === payment.id).voided).toMatchObject({ reason: 'wrong family' });
    expect(voided.json.invoices.find((i: any) => i.id === payment.invoice.id).status).toBe('void');
    expect(voided.json.requests.find((r: any) => r.id === req.id)).toMatchObject({ status: 'open', remainingMinor: 30000 });
    // The parent never sees the voided payment or its invoice.
    const mine = await http(f.parent.subject, 'GET', '/me/billing');
    expect(mine.json.invoices.find((i: any) => i.id === payment.invoice.id)).toBeUndefined();

    // Now by card, and refunded in part.
    const sessionId = await payByCard(tokenOf(req.link));
    await webhook(stripe.completedEvent(stripe.complete(sessionId)));
    const card = (await http(m.superAdmin.subject, 'GET', `/families/${f.id}/billing`)).json.payments.find((p: any) => p.method === 'card');
    expect((await http(m.superAdmin.subject, 'POST', `/payments/${card.id}/void`, { reason: 'x' })).code).toBe(CommErrorCode.BILLING_STATE);
    // Money going back out is the super admin's or the Operations Manager's.
    expect((await http(m.salesManager.subject, 'POST', `/payments/${card.id}/refunds`, { amountMinor: 1, reason: 'x' })).code).toBe(CommErrorCode.BILLING_DENIED);
    const refunded = await http(m.superAdmin.subject, 'POST', `/payments/${card.id}/refunds`, { amountMinor: 10000, reason: 'one lesson cancelled' });
    expect(refunded.status).toBe(201);
    expect(stripe.refunds).toHaveLength(1);
    const after = refunded.json.payments.find((p: any) => p.id === card.id);
    expect(after.refundedMinor).toBe(10000);
    expect(after.refunds[0]).toMatchObject({ amountMinor: 10000, source: 'staff' });
    expect(refunded.json.invoices.find((i: any) => i.id === card.invoice.id).status).toBe('partially_refunded');
    // Stripe's own refund.created for the same refund adds nothing.
    const stripeRefund = stripe.refunds[0]!;
    expect((await webhook(stripe.refundEvent(stripeRefund.paymentIntentId, stripeRefund.id, 10000))).json.outcome).toBe('refund_recorded');
    expect(await g.prisma.paymentRefund.count({ where: { paymentId: card.id } })).toBe(1);
    // Never more than was paid.
    expect((await http(m.superAdmin.subject, 'POST', `/payments/${card.id}/refunds`, { amountMinor: 20001, reason: 'x' })).code).toBe(CommErrorCode.BILLING_STATE);
  });

  it('Stripe refusing a checkout reaches nobody raw: the app gets 503 PAYMENTS_UNAVAILABLE, the link page a plain message', async () => {
    const { f } = familyOf(7);
    const req = (await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'other', label: 'Uniform', amountMinor: 2000, currency: 'AED',
    })).json.request;
    const stripeError = () => Object.assign(new Error('Invalid locale: must be one of auto, bg, cs, da (sk_test_secret_should_never_leak)'), {
      type: 'StripeInvalidRequestError', code: 'parameter_invalid_empty', statusCode: 400,
    });

    stripe.failNextCheckout = stripeError();
    const inApp = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: req.id });
    expect(inApp.status).toBe(503);
    expect(inApp.code).toBe(CommErrorCode.PAYMENTS_UNAVAILABLE);
    expect(JSON.stringify(inApp.json)).not.toMatch(/locale|sk_test|Stripe/);

    stripe.failNextCheckout = stripeError();
    const page = await fetch(`${base}/pay/${tokenOf(req.link)}/checkout`, { method: 'POST', redirect: 'manual' });
    expect(page.status).toBe(503);
    const html = await page.text();
    expect(html).not.toMatch(/Invalid locale|sk_test/);
    expect(html).toContain('الدفع بالبطاقة غير متاح حاليًا');
    // Nothing half-made: no checkout row for a session Stripe never opened.
    expect(await g.prisma.paymentCheckout.count({ where: { requestId: req.id } })).toBe(0);
  });

  it('a cancelled link cannot be paid; its page says so', async () => {
    const { f } = familyOf(7);
    const req = (await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'other', label: 'Trip', amountMinor: 1000, currency: 'AED',
    })).json.request;
    const sessionId = await payByCard(tokenOf(req.link));
    const cancelled = await http(m.salesManager.subject, 'POST', `/payment-requests/${req.id}/cancel`, { reason: 'sent to the wrong parent' });
    expect(cancelled.status).toBe(201);
    expect(stripe.expired).toContain(sessionId);
    const page = await (await fetch(`${base}/pay/${tokenOf(req.link)}?lang=en`)).text();
    expect(page).toContain('was cancelled');
    const retry = await fetch(`${base}/pay/${tokenOf(req.link)}/checkout`, { method: 'POST', redirect: 'manual' });
    expect(retry.status).toBe(409);
    expect((await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: req.id })).code).toBe(CommErrorCode.BILLING_STATE);
  });

  it('a teacher reaches no PD-27 route; a parent no staff route; settings are the super admin\'s and the Operations Manager\'s', async () => {
    const { f, teacher } = familyOf(8);
    const routes: Array<[string, string, unknown?]> = [
      ['POST', `/families/${f.id}/payment-requests`, { purpose: 'other', label: 'x', amountMinor: 1, currency: 'AED' }],
      ['POST', `/families/${f.id}/payments`, { method: 'cash', amountMinor: 1, paidOn: today() }],
      ['GET', '/payment-receipts'],
      ['GET', '/billing/settings'],
      ['POST', '/billing/settings', { bankAccount: null }],
    ];
    for (const [method, path, body] of routes) {
      expect([method, path, (await http(teacher.subject, method, path, body)).code]).toEqual([method, path, CommErrorCode.BILLING_DENIED]);
      expect([method, path, (await http(f.parent.subject, method, path, body)).code]).toEqual([method, path, CommErrorCode.BILLING_DENIED]);
    }
    expect((await http(teacher.subject, 'GET', '/me/billing')).code).toBe(CommErrorCode.BILLING_DENIED);

    const sales = await http(m.salesManager.subject, 'GET', '/billing/settings');
    expect(sales.json).toMatchObject({ canEdit: false, cardAvailable: true });
    expect(sales.json.reminders.map((r: any) => r.key)).toEqual(['payment_d7', 'payment_d3', 'payment_d0', 'payment_p3', 'payment_p7']);
    expect((await http(m.salesManager.subject, 'POST', '/billing/settings', { bankAccount: null })).code).toBe(CommErrorCode.BILLING_DENIED);
    const set = await http(m.operationsManager.subject, 'POST', '/billing/settings', {
      reminders: [{ key: 'payment_p7', enabled: false }], issuer: { name: 'Jawwid Academy', taxId: '100-200-300' },
    });
    expect(set.status).toBe(201);
    expect(set.json.reminders.find((r: any) => r.key === 'payment_p7').enabled).toBe(false);
    expect(set.json.issuer).toMatchObject({ name: 'Jawwid Academy', taxId: '100-200-300' });
    await http(m.operationsManager.subject, 'POST', '/billing/settings', { reminders: [{ key: 'payment_p7', enabled: true }] });
  });

  it('reminders: an open instalment schedules the enabled payment rules for each parent; full payment cancels them', async () => {
    const { f } = familyOf(9);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    const due = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const plan = await http(m.superAdmin.subject, 'POST', `/families/${f.id}/instalments`, { label: 'Fees', amountMinor: 20000, firstDueDate: due });
    const id = plan.json.instalments[0].id;
    const scheduled = await g.prisma.notification.findMany({ where: { dedupeKey: { contains: `:${id}:` }, status: 'scheduled' } });
    expect(scheduled.map((n) => n.ruleKey).sort()).toEqual(['payment_d0', 'payment_d3', 'payment_d7', 'payment_p3', 'payment_p7']);
    expect(scheduled.every((n) => n.recipientId === f.parent.id)).toBe(true);
    await http(m.superAdmin.subject, 'POST', `/instalments/${id}/payment`, { paidOn: today(), method: 'cash' });
    expect(await g.prisma.notification.count({ where: { dedupeKey: { contains: `:${id}:` }, status: 'scheduled' } })).toBe(0);
    // ...and the PD-17 route now issues an invoice too.
    const after = await http(m.superAdmin.subject, 'GET', `/families/${f.id}/billing`);
    expect(after.json.payments.find((p: any) => p.instalmentId === id)).toMatchObject({ method: 'cash', amountMinor: 20000 });
  });
});
