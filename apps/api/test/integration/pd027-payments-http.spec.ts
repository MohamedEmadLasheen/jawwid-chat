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
import { OBJECT_STORAGE } from '../../src/platform/tokens';
import type { ObjectStorage } from '../../src/communication/attachments/object-storage';

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

/** What the app (or the web link) asked Stripe for, for one request. */
function checkoutInputs(requestId: string) {
  return [...stripe.sessions.values()].filter((s) => s.input.requestId === requestId).map((s) => s.input);
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
      purpose: 'balance', label: 'Earlier lessons', amountMinor: 5000,
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

  it('ADMIN-012: "Paid" counts every standing payment of the family -- instalment-linked or standalone -- minus refunds, never a voided one', async () => {
    const { f, supervisor } = familyOf(17);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    const plan = await http(supervisor.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Term', items: [{ amountMinor: 9000, dueDate: '2026-11-01' }, { amountMinor: 9000, dueDate: '2026-12-01' }],
    });
    const [first] = plan.json.instalments as any[];
    expect((await http(supervisor.subject, 'POST', `/instalments/${first.id}/payment`, { paidOn: today(), method: 'cash' })).status).toBe(201);
    // Standalone: one standing and refunded in part, one voided.
    const standing = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, { method: 'cash', amountMinor: 5000, paidOn: today(), reference: 'R-1' });
    const standingId = standing.json.payments.find((p: any) => p.reference === 'R-1').id;
    expect((await http(m.superAdmin.subject, 'POST', `/payments/${standingId}/refunds`, { amountMinor: 2000, reason: 'a lesson not held' })).status).toBe(201);
    const mistake = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, { method: 'cash', amountMinor: 1000, paidOn: today(), reference: 'R-2' });
    const mistakeId = mistake.json.payments.find((p: any) => p.reference === 'R-2').id;
    expect((await http(m.salesManager.subject, 'POST', `/payments/${mistakeId}/void`, { reason: 'wrong family' })).status).toBe(201);

    const staff = (await http(m.superAdmin.subject, 'GET', `/families/${f.id}/billing`)).json;
    // 9000 (the instalment) + 5000 - 2000 (standalone, refunded in part); the voided 1000 never.
    expect(staff.totals).toEqual([{ currency: 'AED', paidMinor: 12000, outstandingMinor: 9000, overdueMinor: 0 }]);
    // The parent's view adds up the same.
    expect((await http(f.parent.subject, 'GET', '/me/billing')).json.totals).toEqual(staff.totals);
  });

  it('Stripe refusing a checkout reaches nobody raw: the app gets 503 PAYMENTS_UNAVAILABLE, the link page a plain message', async () => {
    const { f } = familyOf(7);
    const req = (await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'renewal', label: 'Renewal', amountMinor: 2000, currency: 'AED',
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

  it('store payments policy: a request that is not for live one-to-one lessons (purpose other) cannot be paid in the app -- not by card, not by receipt -- but its web link still works', async () => {
    const { f } = familyOf(7);
    const req = (await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'other', label: 'Books', amountMinor: 3000, currency: 'AED',
    })).json.request;
    const mine = await http(f.parent.subject, 'GET', '/me/billing');
    expect(mine.json.requests.find((r: any) => r.id === req.id)).toMatchObject({ purpose: 'other', payableInApp: false });

    const card = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: req.id });
    expect(card.status).toBe(409);
    expect(card.code).toBe(CommErrorCode.PAYMENT_NOT_IN_APP);
    expect(checkoutInputs(req.id)).toHaveLength(0);

    const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(80, 0x20)]);
    const grant = await http(f.parent.subject, 'POST', '/me/billing/receipts/upload', { mimeType: 'application/pdf', byteSize: bytes.length });
    const route = grant.json.uploadUrl.slice(grant.json.uploadUrl.indexOf('/storage/'));
    await fetch(`${base}${route}`, { method: 'PUT', headers: { ...grant.json.headers, authorization: `Bearer ${await tokenFor(f.parent.subject)}` }, body: bytes });
    const receipt = await http(f.parent.subject, 'POST', '/me/billing/receipts', {
      objectKey: grant.json.objectKey, requestId: req.id, amountMinor: 3000, transferredOn: today(),
    });
    expect(receipt.status).toBe(409);
    expect(receipt.code).toBe(CommErrorCode.PAYMENT_NOT_IN_APP);
    expect(await g.prisma.paymentReceipt.count({ where: { requestId: req.id } })).toBe(0);
    expect(await app.get<ObjectStorage>(OBJECT_STORAGE).readHead(grant.json.objectKey, 1)).toBeNull();

    // Outside the app, the web pay link is unchanged, and its Stripe page never calls it a lesson.
    await payByCard(tokenOf(req.link));
    expect(checkoutInputs(req.id)).toHaveLength(1);
    expect(checkoutInputs(req.id)[0]!.description).toBeNull();
  });

  it('a lesson payment\'s Stripe page describes live one-to-one lessons, in the family\'s language', async () => {
    const { f } = familyOf(7);
    const child = f.children[0]!;
    const req = (await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'subscription', label: 'Quran — 1 month', amountMinor: 30000, currency: 'AED', learnerId: child.id,
    })).json.request;
    const res = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: req.id });
    expect(res.status).toBe(201);
    const [input] = checkoutInputs(req.id);
    expect(input!.description).toMatch(/^(دروس قرآن مباشرة فردية|Live one-to-one Quran lessons)/);
    expect(input!.description).toMatch(/لا تُسجَّل الدروس|not recorded/);
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

/**
 * ADMIN-001 (systest c1838fdf): manual payments and refunds were not
 * idempotent -- the same cash payment sent twice at once, then again, wrote 3
 * payments, 3 invoices and 3 audit rows; a refund sent twice at once wrote 2.
 * A money-recording POST now carries a client key (paymentId / refundId; the
 * receipt's own objectKey), generated once per submit and resent on retry.
 */
describe('ADMIN-001: money is recorded once per submit', () => {
  const count = async (familyId: string) => ({
    payments: await g.prisma.payment.count({ where: { familyId } }),
    invoices: await g.prisma.invoice.count({
      where: { paymentId: { in: (await g.prisma.payment.findMany({ where: { familyId }, select: { id: true } })).map((p) => p.id) } },
    }),
    audits: await g.prisma.auditLog.count({ where: { action: 'payment.recorded', entityId: familyId } }),
  });

  it('a cash payment sent twice at once, then again with the same key: one payment, one invoice, one audit row', async () => {
    const { f } = familyOf(20);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    const body = { method: 'cash', amountMinor: 12000, paidOn: today(), reference: 'Receipt book 7', paymentId: randomUUID() };
    const [a, b] = await Promise.all([
      http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, body),
      http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, body),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const replay = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, body);
    expect(replay.status).toBe(201);
    expect(await count(f.id)).toEqual({ payments: 1, invoices: 1, audits: 1 });
    // The answer to a replay is the family as the first submit left it.
    expect(replay.json.payments.map((p: any) => p.id)).toEqual([body.paymentId]);
  });

  it('the same key for a different payment is refused (409) and writes nothing', async () => {
    const { f } = familyOf(21);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    const paymentId = randomUUID();
    expect((await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, { method: 'cash', amountMinor: 5000, paidOn: today(), paymentId })).status).toBe(201);
    const other = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, { method: 'cash', amountMinor: 5001, paidOn: today(), paymentId });
    expect({ status: other.status, code: other.code }).toEqual({ status: 409, code: CommErrorCode.BILLING_STATE });
    // ...and another recorder may not replay someone else's submit either.
    const stranger = await http(m.superAdmin.subject, 'POST', `/families/${f.id}/payments`, { method: 'cash', amountMinor: 5000, paidOn: today(), paymentId });
    expect(stranger.status).toBe(409);
    expect(await count(f.id)).toEqual({ payments: 1, invoices: 1, audits: 1 });
  });

  it('a refund sent twice at once, then again: one refund; the same key for another amount is refused', async () => {
    const { f } = familyOf(22);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    const paid = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, { method: 'cash', amountMinor: 20000, paidOn: today(), paymentId: randomUUID() });
    const paymentId = paid.json.payments[0].id;
    const body = { amountMinor: 3000, reason: 'one lesson not held', refundId: randomUUID() };
    const [a, b] = await Promise.all([
      http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, body),
      http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, body),
    ]);
    // The one that finds the other still in progress is told so at once (409, #358
    // re-review); one that arrives after it finished is a replay (201).
    const second = [a, b].find((r) => r.status !== 201);
    expect([a, b].filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
    if (second) expect({ status: second.status, code: second.code }).toEqual({ status: 409, code: CommErrorCode.BILLING_STATE });
    expect((await http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, body)).status).toBe(201);
    expect(await g.prisma.paymentRefund.count({ where: { paymentId } })).toBe(1);
    const other = await http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, { ...body, amountMinor: 3001 });
    expect({ status: other.status, code: other.code }).toEqual({ status: 409, code: CommErrorCode.BILLING_STATE });
    expect(await g.prisma.paymentRefund.count({ where: { paymentId } })).toBe(1);
  });

  it('"this instalment is paid" sent twice at once: one payment -- with the same key, and even with none', async () => {
    const { f, supervisor } = familyOf(23);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    const plan = await http(supervisor.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Term', items: [{ amountMinor: 9000, dueDate: '2026-11-01' }, { amountMinor: 9000, dueDate: '2026-12-01' }],
    });
    const [first, second] = plan.json.instalments as any[];
    const keyed = { paidOn: today(), method: 'cash', paymentId: randomUUID() };
    const keyedAnswers = await Promise.all([
      http(supervisor.subject, 'POST', `/instalments/${first.id}/payment`, keyed),
      http(supervisor.subject, 'POST', `/instalments/${first.id}/payment`, keyed),
    ]);
    expect(keyedAnswers.map((r) => r.status)).toEqual([201, 201]);
    expect(await g.prisma.payment.count({ where: { instalmentId: first.id } })).toBe(1);
    // An old client sends no key: the instalment's row lock still lets only one through.
    const unkeyed = await Promise.all([
      http(supervisor.subject, 'POST', `/instalments/${second.id}/payment`, { paidOn: today(), method: 'cash' }),
      http(supervisor.subject, 'POST', `/instalments/${second.id}/payment`, { paidOn: today(), method: 'cash' }),
    ]);
    expect(unkeyed.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await g.prisma.payment.count({ where: { instalmentId: second.id } })).toBe(1);
  });

  it('a parent\'s receipt sent twice at once, then again: one receipt; the same file for another amount is refused', async () => {
    const { f } = familyOf(25);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    const requestId = (await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'balance', label: 'Outstanding balance', amountMinor: 40000,
    })).json.request.id;
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    const grant = await http(f.parent.subject, 'POST', '/me/billing/receipts/upload', { mimeType: 'image/jpeg', byteSize: bytes.length });
    const route = grant.json.uploadUrl.slice(grant.json.uploadUrl.indexOf('/storage/'));
    const put = await fetch(`${base}${route}`, {
      method: 'PUT', headers: { ...grant.json.headers, authorization: `Bearer ${await tokenFor(f.parent.subject)}` }, body: bytes,
    });
    expect(put.status).toBe(201);
    const body = { objectKey: grant.json.objectKey, requestId, amountMinor: 40000, transferredOn: today(), note: 'ref 5521' };
    const sent = await Promise.all([
      http(f.parent.subject, 'POST', '/me/billing/receipts', body),
      http(f.parent.subject, 'POST', '/me/billing/receipts', body),
    ]);
    expect(sent.map((r) => r.status)).toEqual([201, 201]);
    expect((await http(f.parent.subject, 'POST', '/me/billing/receipts', body)).status).toBe(201);
    expect(await g.prisma.paymentReceipt.count({ where: { familyId: f.id } })).toBe(1);
    const other = await http(f.parent.subject, 'POST', '/me/billing/receipts', { ...body, amountMinor: 39999 });
    expect({ status: other.status, code: other.code }).toEqual({ status: 409, code: CommErrorCode.BILLING_STATE });
    expect(await g.prisma.paymentReceipt.count({ where: { familyId: f.id } })).toBe(1);
  });

  it('a void sent twice at once voids once (one audit row); the second is told it is already voided', async () => {
    const { f } = familyOf(24);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    const paid = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, { method: 'cash', amountMinor: 1000, paidOn: today(), paymentId: randomUUID() });
    const id = paid.json.payments[0].id;
    const answers = await Promise.all([
      http(m.salesManager.subject, 'POST', `/payments/${id}/void`, { reason: 'wrong family' }),
      http(m.salesManager.subject, 'POST', `/payments/${id}/void`, { reason: 'wrong family' }),
    ]);
    expect(answers.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await g.prisma.auditLog.count({ where: { action: 'payment.voided', entityId: f.id } })).toBe(1);
  });
});

/**
 * #358 review: a duplicate CARD refund could reach Stripe twice -- the replay
 * check and the refunded sum were read outside the lock, which was taken only
 * after the Stripe call, whose key was not the client's refundId. And a manual
 * payment checked what was owed outside its transaction.
 */
describe('ADMIN-001: a card refund reaches Stripe once per refundId; a manual payment never overpays', () => {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const cardPaid = async (i: number) => {
    const { f } = familyOf(i);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    const req = (await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'subscription', label: 'Monthly', amountMinor: 30000,
    })).json.request;
    await webhook(stripe.completedEvent(stripe.complete(await payByCard(tokenOf(req.link)))));
    const card = (await http(m.superAdmin.subject, 'GET', `/families/${f.id}/billing`)).json.payments.find((p: any) => p.method === 'card');
    const intent = (await g.prisma.payment.findUniqueOrThrow({ where: { id: card.id } })).stripePaymentIntentId as string;
    const calls = () => stripe.refundCalls.filter((c) => c.paymentIntentId === intent);
    return { f, paymentId: card.id as string, intent, calls };
  };
  afterEach(() => { stripe.onRefund = null; });

  it('sent twice at once with one refundId: ONE Stripe call, keyed by the refundId; the second is told at once it is in progress; a replay later calls Stripe never again', async () => {
    const { paymentId, calls } = await cardPaid(10);
    const body = { amountMinor: 3000, reason: 'one lesson not held', refundId: randomUUID() };
    stripe.onRefund = () => sleep(2500); // a slow Stripe: the first submit is still in it
    const timed = async () => {
      const t0 = Date.now();
      const r = await http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, body);
      return { ...r, ms: Date.now() - t0 };
    };
    const first = timed();
    await sleep(300);
    const second = await timed();
    // Refused without waiting for the first (no connection held behind a lock).
    expect({ status: second.status, code: second.code }).toEqual({ status: 409, code: CommErrorCode.BILLING_STATE });
    expect(second.ms).toBeLessThan(1500);
    expect((await first).status).toBe(201);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ amountMinor: 3000, idempotencyKey: `refund:${body.refundId}`, metadata: { refundId: body.refundId } });
    expect((await http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, body)).status).toBe(201);
    expect(calls()).toHaveLength(1);
    expect(await g.prisma.paymentRefund.findMany({ where: { paymentId }, select: { id: true, amountMinor: true } }))
      .toEqual([{ id: body.refundId, amountMinor: 3000n }]);
  });

  it('Stripe\'s webhook arriving while the refund is being recorded: one row, under the refundId, so a replay finds it and calls Stripe never again', async () => {
    const { paymentId, calls } = await cardPaid(11);
    // Over half the payment: the webhook's own insert would exceed it (20000 + 20000 > 30000).
    const body = { amountMinor: 20000, reason: 'most lessons not held', refundId: randomUUID() };
    let delivered: Promise<{ status: number; json: any }> | null = null;
    stripe.onRefund = async (r) => {
      // Stripe tells the webhook before it answers the API call.
      delivered = webhook(stripe.refundEvent(r.paymentIntentId, r.id, r.amountMinor, undefined, r.metadata));
      await Promise.race([delivered, sleep(1500)]);
    };
    expect((await http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, body)).status).toBe(201);
    // The webhook waited for the payment's lock, then found the refund: an answer, never a 500.
    expect((await delivered!).status).toBe(200);
    stripe.onRefund = null;
    expect(await g.prisma.paymentRefund.findMany({ where: { paymentId }, select: { id: true, recordedBy: true } }))
      .toEqual([{ id: body.refundId, recordedBy: m.superAdmin.id }]);
    expect((await http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, body)).status).toBe(201);
    expect(calls()).toHaveLength(1);
    expect(await g.prisma.paymentRefund.count({ where: { paymentId } })).toBe(1);
  });

  it('a refund Stripe made but only the webhook recorded (our transaction lost) is recorded under the refundId; the replay is answered, Stripe not called', async () => {
    const { paymentId, intent, calls } = await cardPaid(12);
    const body = { amountMinor: 4000, reason: 'a lesson not held', refundId: randomUUID() };
    // Our call reached Stripe, then the recording transaction died; Stripe's webhook still arrives.
    const made = await stripe.refund(intent, 4000, `refund:${body.refundId}`, { refundId: body.refundId, recordedBy: m.superAdmin.id });
    expect((await webhook(stripe.refundEvent(intent, made.id, 4000, undefined, { refundId: body.refundId, recordedBy: m.superAdmin.id }))).json.outcome)
      .toBe('refund_recorded');
    expect(await g.prisma.paymentRefund.findMany({ where: { paymentId }, select: { id: true, recordedBy: true, stripeRefundId: true } }))
      .toEqual([{ id: body.refundId, recordedBy: m.superAdmin.id, stripeRefundId: made.id }]);
    const replay = await http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, body);
    expect(replay.status).toBe(201);
    expect(calls()).toHaveLength(1); // only the one call above
    expect(await g.prisma.paymentRefund.count({ where: { paymentId } })).toBe(1);
    // A refundId in Stripe's metadata that is not a uuid, or a stranger as recorder, is not trusted.
    const other = await stripe.refund(intent, 1000, 'refund:dashboard', { refundId: 'not-a-uuid', recordedBy: randomUUID() });
    expect((await webhook(stripe.refundEvent(intent, other.id, 1000, undefined, { refundId: 'not-a-uuid', recordedBy: randomUUID() }))).json.outcome)
      .toBe('refund_recorded');
    expect(await g.prisma.paymentRefund.findUniqueOrThrow({ where: { stripeRefundId: other.id }, select: { recordedBy: true } }))
      .toEqual({ recordedBy: null });
  });

  it('another refund of the same payment while one is in Stripe is refused after the lock timeout, not held for the whole call', async () => {
    const { paymentId } = await cardPaid(14);
    stripe.onRefund = () => sleep(8000);
    const first = http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, { amountMinor: 1000, reason: 'a lesson not held', refundId: randomUUID() });
    await sleep(300);
    const t0 = Date.now();
    const other = await http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, { amountMinor: 1000, reason: 'another lesson', refundId: randomUUID() });
    const ms = Date.now() - t0;
    expect({ status: other.status, code: other.code }).toEqual({ status: 409, code: CommErrorCode.BILLING_STATE });
    expect(ms).toBeGreaterThanOrEqual(4500);
    expect(ms).toBeLessThan(7000);
    expect((await first).status).toBe(201);
    expect(await g.prisma.paymentRefund.count({ where: { paymentId } })).toBe(1);
  }, 30_000);

  it('a NEW Stripe refund carrying a refundId already recorded (Stripe\'s 24 h key expired) is recorded as its own row, never dropped', async () => {
    const { paymentId, intent } = await cardPaid(15);
    const body = { amountMinor: 2000, reason: 'a lesson not held', refundId: randomUUID() };
    expect((await http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, body)).status).toBe(201);
    const later = await stripe.refund(intent, 2000, `refund:${body.refundId}:after-expiry`, { refundId: body.refundId, recordedBy: m.superAdmin.id });
    const answer = await webhook(stripe.refundEvent(intent, later.id, 2000, undefined, { refundId: body.refundId, recordedBy: m.superAdmin.id }));
    expect({ status: answer.status, outcome: answer.json.outcome }).toEqual({ status: 200, outcome: 'refund_recorded' });
    const rows = await g.prisma.paymentRefund.findMany({ where: { paymentId }, select: { id: true, stripeRefundId: true }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(body.refundId);
    expect(rows[1]).toMatchObject({ stripeRefundId: later.id });
    expect(rows[1]!.id).not.toBe(body.refundId);
  });

  it('Stripe refusing a reused key with other parameters (as real Stripe does) records nothing', async () => {
    const { paymentId, intent } = await cardPaid(16);
    const refundId = randomUUID();
    // Stripe made 4000 under this key; nothing was recorded (no webhook yet).
    await stripe.refund(intent, 4000, `refund:${refundId}`, { refundId, recordedBy: m.superAdmin.id });
    const other = await http(m.superAdmin.subject, 'POST', `/payments/${paymentId}/refunds`, { amountMinor: 4500, reason: 'x', refundId });
    expect({ status: other.status, code: other.code }).toEqual({ status: 409, code: CommErrorCode.BILLING_STATE });
    expect(await g.prisma.paymentRefund.count({ where: { paymentId } })).toBe(0);
  });

  it('two different submits for the whole of one instalment at once: one is recorded, the other refused -- never overpaid', async () => {
    const { f, supervisor } = familyOf(13);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    const plan = await http(supervisor.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Term', items: [{ amountMinor: 9000, dueDate: '2026-11-01' }, { amountMinor: 9000, dueDate: '2026-12-01' }],
    });
    const [first, second] = plan.json.instalments as any[];
    const pay = (instalmentId: string, paymentId: string = randomUUID()) => http(supervisor.subject, 'POST', `/families/${f.id}/payments`, {
      method: 'cash', amountMinor: 9000, paidOn: today(), instalmentId, paymentId,
    });
    const answers = await Promise.all([pay(first.id), pay(first.id)]);
    expect(answers.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await g.prisma.payment.count({ where: { instalmentId: first.id } })).toBe(1);
    // The same submit twice at once is one payment and two good answers, never "already paid".
    const key = randomUUID();
    const same = await Promise.all([pay(second.id, key), pay(second.id, key)]);
    expect(same.map((r) => r.status)).toEqual([201, 201]);
    expect(await g.prisma.payment.findMany({ where: { instalmentId: second.id }, select: { id: true } })).toEqual([{ id: key }]);
    expect((await pay(second.id, key)).status).toBe(201);
  });
});

/**
 * ADMIN-007: two staff editing one family's billing settings at once used to
 * be last-write-wins, and the audit's before-image was read before the
 * transaction, so it could name values the edit never overwrote.
 */
describe('ADMIN-007: billing settings edits are versioned', () => {
  it('two edits from the same version at once: one wins, the other is 409 with the current settings; the audit names the true before and after', async () => {
    const { f } = familyOf(26);
    const first = await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED', paymentMethod: 'invoice' });
    expect(first.status).toBe(201);
    const version = first.json.settingsVersion as string;
    expect(version).toEqual(expect.any(String));

    const [a, b] = await Promise.all([
      http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { paymentMethod: 'bank_transfer', version }),
      http(m.salesManager.subject, 'POST', `/families/${f.id}/billing`, { currency: 'EGP', version }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const lost = a.status === 409 ? a : b;
    const won = a.status === 409 ? b : a;
    expect(lost.code).toBe(CommErrorCode.BILLING_STATE);
    // The refusal carries what the settings are now (the winner's), with their version.
    expect((lost.json.error as any)?.detail?.current).toMatchObject({
      paymentMethod: won.json.paymentMethod, currency: won.json.currency, settingsVersion: won.json.settingsVersion,
    });

    // Exactly one change was recorded, and its before/after are the real ones.
    const rows = await g.prisma.auditLog.findMany({ where: { action: 'family.billing_set', entityId: f.id }, orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(2); // the initial set, and the one winner
    const winner = rows[1]!;
    expect(winner.before).toEqual({ paymentMethod: 'invoice', currency: 'AED', planMonths: null });
    expect(winner.after).toMatchObject({ paymentMethod: won.json.paymentMethod, currency: won.json.currency });

    // A stale version afterwards is refused too; the current one goes through.
    expect((await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { planMonths: 3, version })).status).toBe(409);
    expect((await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { planMonths: 3, version: won.json.settingsVersion })).status).toBe(201);
  });

  it('an edit with no version (an older client) is still serialized and audited with the true before-image', async () => {
    const { f } = familyOf(27);
    await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' });
    await Promise.all([
      http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'EGP' }),
      http(m.salesManager.subject, 'POST', `/families/${f.id}/billing`, { currency: 'SAR' }),
    ]);
    const rows = await g.prisma.auditLog.findMany({ where: { action: 'family.billing_set', entityId: f.id }, orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(3);
    // Each before is the previous after: no edit claims to have overwritten a value it never saw.
    expect((rows[1]!.before as any).currency).toBe('AED');
    expect((rows[2]!.before as any).currency).toBe((rows[1]!.after as any).currency);
  });
});
