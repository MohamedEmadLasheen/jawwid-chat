/**
 * OA-12 (owner, 2026-11-10): the App Review payment mode, over real HTTP (real
 * logins, the global bearer guard, the real routes; Stripe is FakeStripe).
 *
 * For a family of an organization listed in chat.config
 * review.sandbox_organization_ids:
 *  - GET /me/billing says reviewMode, lists one synthetic amount due that is
 *    never written, and shows demo bank details -- the real account appears in
 *    no response at all;
 *  - card (app and web link) answers the static demo page, and Stripe is never
 *    called;
 *  - the receipt upload grant and the receipt are refused;
 *  - nothing is written: no request, checkout, receipt, payment, invoice,
 *    Stripe customer, audit row, task, notification or outbox event.
 * For every other organization, and with the key absent or malformed, the
 * answers are byte for byte what they were.
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
import { SubscriptionModule } from '../../src/subscriptions/subscription.module';
import { STRIPE_GATEWAY } from '../../src/billing/stripe.gateway';
import { REVIEW_DEMO_REQUEST_ID, REVIEW_ORGANIZATIONS_KEY } from '../../src/billing/review-mode';
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
const PASSWORD = 'oa12-review-mode-password-1';
const DOMAIN = 'oa12review.qa.jawwid.test';

/** The academy's REAL bank details: they must never reach a review account. */
const REAL_BANK = { accountName: 'Real Academy Account OA12', bankName: 'Real Bank OA12', iban: 'AE070331234567890123456', swift: 'REALAEAD', note: 'Real reference note OA12' };
const REAL_MARKERS = [REAL_BANK.accountName, REAL_BANK.bankName, REAL_BANK.iban, REAL_BANK.swift, REAL_BANK.note];
const PAY_PAGE_CSP = /^default-src 'none'; style-src 'nonce-[A-Za-z0-9+/=]+'; img-src data:; form-action 'self' https:\/\/checkout\.stripe\.com; base-uri 'none'; frame-ancestors 'none'$/;

const g = buildGraph();
const stripe = new FakeStripe();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
let requestId: string;
let token: string;

const tokens = new Map<string, string>();
async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return tokens.get(subject)!;
}

type Json = { error?: { code?: string; message?: string; detail?: Record<string, unknown> } } & Record<string, any>;
async function http(subject: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {};
  if (subject) headers.authorization = `Bearer ${await tokenFor(subject)}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    // not JSON
  }
  return { status: r.status, code: json.error?.code, json, text };
}

function expectNoRealBank(text: string, where: string) {
  for (const marker of REAL_MARKERS) expect([where, text.includes(marker)]).toEqual([where, false]);
}

async function setReviewOrganizations(value: unknown | undefined) {
  if (value === undefined) {
    await g.prisma.config.deleteMany({ where: { key: REVIEW_ORGANIZATIONS_KEY } });
  } else {
    await g.prisma.config.upsert({
      where: { key: REVIEW_ORGANIZATIONS_KEY },
      create: { key: REVIEW_ORGANIZATIONS_KEY, value: value as object },
      update: { value: value as object },
    });
  }
}

/** Every table a payment, its paperwork or its follow-up could write. */
async function writeCounts() {
  const [row] = await g.prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
    SELECT (SELECT count(*) FROM chat.payment_request)  AS payment_request,
           (SELECT count(*) FROM chat.payment_checkout) AS payment_checkout,
           (SELECT count(*) FROM chat.payment_receipt)  AS payment_receipt,
           (SELECT count(*) FROM chat.payment)          AS payment,
           (SELECT count(*) FROM chat.invoice)          AS invoice,
           (SELECT count(*) FROM chat.family_instalment) AS family_instalment,
           (SELECT count(*) FROM chat.stripe_customer)  AS stripe_customer,
           (SELECT count(*) FROM chat.audit_log)        AS audit_log,
           (SELECT count(*) FROM chat.work_task)        AS work_task,
           (SELECT count(*) FROM chat.notification)     AS notification,
           (SELECT count(*) FROM chat.outbox_event)     AS outbox_event,
           (SELECT count(*) FROM chat.renewal_request)  AS renewal_request,
           (SELECT count(*) FROM chat.message)          AS message,
           (SELECT count(*) FROM chat.message_card)     AS message_card,
           (SELECT count(*) FROM chat.work_task_package_episode) AS work_task_package_episode,
           (SELECT count(*) FROM chat.config)           AS config`);
  return Object.fromEntries(Object.entries(row!).map(([k, v]) => [k, Number(v)]));
}

function stripeCalls() {
  return { sessions: stripe.sessions.size, customers: stripe.customerCalls, reads: stripe.reads.length, expired: stripe.expired.length };
}

function tokenOf(link: string): string {
  return link.slice(link.lastIndexOf('/') + 1);
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await setReviewOrganizations(undefined);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'oa12-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'oa12-${orgId.slice(0, 8)}', 'OA-12 review mode QA academy')`,
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
    imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, BillingModule, ParentRecordModule, SubscriptionModule],
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

  // The academy's real bank details, and one real, payable lesson-package balance
  // for family 0 -- made by staff before any review mode is switched on.
  expect((await http(m.superAdmin.subject, 'POST', '/billing/settings', { bankAccount: REAL_BANK })).status).toBe(201);
  const f = m.families[0]!;
  const child = f.children[0]!;
  expect((await http(m.superAdmin.subject, 'POST', `/learners/${child.id}/subscriptions`, { lessonsIncluded: 8, reason: 'test lesson package' })).status).toBe(201);
  const pkg = await g.prisma.learnerSubscription.findFirstOrThrow({ where: { learnerId: child.id, voidedAt: null }, orderBy: { createdAt: 'desc' } });
  const created = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
    purpose: 'balance', label: 'Outstanding balance', amountMinor: 70000, currency: 'AED', lessonSubscriptionId: pkg.id,
  });
  expect(created.status).toBe(201);
  requestId = created.json.request.id;
  token = tokenOf(created.json.request.link);
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await setReviewOrganizations(undefined);
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'oa12-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedLinkBase === undefined) delete process.env.PAYMENT_LINK_BASE_URL;
  else process.env.PAYMENT_LINK_BASE_URL = inheritedLinkBase;
});

describe('OA-12: the App Review payment mode', () => {
  it('the key is not writable through the billing settings route: neither created nor changed', async () => {
    const attempt = {
      [REVIEW_ORGANIZATIONS_KEY]: [orgId],
      reviewSandboxOrganizationIds: [orgId],
      review: { sandbox_organization_ids: [orgId] },
      key: REVIEW_ORGANIZATIONS_KEY,
      value: [orgId],
    };
    const configRows = async () =>
      (await g.prisma.config.findMany({ orderBy: { key: 'asc' } })).map((r) => [r.key, JSON.stringify(r.value)]);

    // Absent: a settings write that also carries the key (a real, accepted change
    // of the bank account) stores the bank account and nothing else.
    await setReviewOrganizations(undefined);
    const before = await configRows();
    const tried = await http(m.superAdmin.subject, 'POST', '/billing/settings', { ...attempt, bankAccount: REAL_BANK });
    expect(tried.status).toBe(201);
    expect(await g.prisma.config.findUnique({ where: { key: REVIEW_ORGANIZATIONS_KEY } })).toBeNull();
    expect(await configRows()).toEqual(before);
    expect(JSON.stringify(tried.json)).not.toContain(REVIEW_ORGANIZATIONS_KEY);

    // Present (listing another organization): the same attempt leaves its value exactly as it was.
    const other = randomUUID();
    await setReviewOrganizations([other]);
    const withKey = await configRows();
    const again = await http(m.superAdmin.subject, 'POST', '/billing/settings', { ...attempt, bankAccount: REAL_BANK });
    expect(again.status).toBe(201);
    expect((await g.prisma.config.findUnique({ where: { key: REVIEW_ORGANIZATIONS_KEY } }))?.value).toEqual([other]);
    expect(await configRows()).toEqual(withKey);
    await setReviewOrganizations(undefined);
  });

  it('public organizations: staff money routes, the settings and the renewal request are untouched', async () => {
    await setReviewOrganizations([randomUUID()]);
    const settings = await http(m.superAdmin.subject, 'GET', '/billing/settings');
    expect(settings.status).toBe(200);
    expect(settings.json.bankAccount).toMatchObject({ iban: REAL_BANK.iban });
    // Unknown ids reach the lookup (404), not a review refusal.
    expect((await http(m.salesManager.subject, 'POST', `/payment-receipts/${randomUUID()}/approve`, {})).code).toBe(CommErrorCode.BILLING_NOT_FOUND);
    expect((await http(m.salesManager.subject, 'POST', `/instalments/${randomUUID()}/payment`, { paidOn: '2026-11-01' })).code).toBe(CommErrorCode.BILLING_NOT_FOUND);
    expect((await http(m.superAdmin.subject, 'POST', `/payments/${randomUUID()}/refunds`, { amountMinor: 1000, reason: 'x' })).code).toBe(CommErrorCode.BILLING_NOT_FOUND);
    // A public parent's renewal request is written as before.
    const child = m.families[0]!.children[0]!;
    const renewal = await http(m.families[0]!.parent.subject, 'POST', `/me/subscriptions/${child.id}/renewal-request`);
    expect(renewal.status).toBe(201);
    expect(await g.prisma.renewalRequest.count({ where: { learnerId: child.id } })).toBe(1);
    await setReviewOrganizations(undefined);
  });

  it('public organizations: /me/billing byte for byte the same with the key absent, listing another organization, or malformed', async () => {
    for (const f of [m.families[0]!, m.families[1]!]) {
      await setReviewOrganizations(undefined);
      const absent = await http(f.parent.subject, 'GET', '/me/billing');
      expect(absent.status).toBe(200);
      expect(absent.json).not.toHaveProperty('reviewMode');
      expect(absent.json.bankAccount).toMatchObject({ accountName: REAL_BANK.accountName, iban: REAL_BANK.iban });
      expect(absent.json.requests.some((r: any) => r.id === REVIEW_DEMO_REQUEST_ID)).toBe(false);

      for (const value of [[randomUUID()], [], 'not an array', [orgId, 'not-a-uuid'], { ids: [orgId] }]) {
        await setReviewOrganizations(value);
        const now = await http(f.parent.subject, 'GET', '/me/billing');
        expect([JSON.stringify(value), now.status, now.text]).toEqual([JSON.stringify(value), 200, absent.text]);
      }
    }
    await setReviewOrganizations(undefined);
  });

  it('public organizations: card still goes to Stripe, the receipt upload is still granted, the link page still shows the real bank', async () => {
    await setReviewOrganizations([randomUUID()]);
    const f = m.families[0]!;
    const before = stripe.sessions.size;
    const card = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId });
    expect(card.status).toBe(201);
    expect(card.json.url).toMatch(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
    expect(stripe.sessions.size).toBe(before + 1);

    const grant = await http(f.parent.subject, 'POST', '/me/billing/receipts/upload', { mimeType: 'image/jpeg', byteSize: 1024 });
    expect(grant.status).toBe(201);
    expect(grant.json.objectKey).toMatch(new RegExp(`^payment-receipts/${f.id}/`));

    const page = await fetch(`${base}/pay/${token}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(REAL_BANK.iban);
    expect(html).not.toContain('App Review');
    const en = await (await fetch(`${base}/pay/${token}?lang=en`)).text();
    expect(en).toContain('After transferring, send a photo of the receipt');
    await setReviewOrganizations(undefined);
  });

  describe('a review organization', () => {
    let counts: Record<string, number>;
    let calls: ReturnType<typeof stripeCalls>;

    beforeAll(async () => {
      await setReviewOrganizations([orgId.toUpperCase()]);
      counts = await writeCounts();
      calls = stripeCalls();
    });

    afterAll(async () => {
      await setReviewOrganizations(undefined);
    });

    it('/me/billing: reviewMode, one synthetic amount due, demo bank details, card offered -- and never the real account', async () => {
      for (const f of [m.families[0]!, m.families[1]!]) {
        const mine = await http(f.parent.subject, 'GET', '/me/billing');
        expect(mine.status).toBe(200);
        expect(mine.json.reviewMode).toBe(true);
        expect(mine.json.cardAvailable).toBe(true);
        const demo = mine.json.requests.filter((r: any) => r.id === REVIEW_DEMO_REQUEST_ID);
        expect(demo).toHaveLength(1);
        expect(demo[0]).toMatchObject({
          purpose: 'subscription', payableInApp: true, status: 'open', amountMinor: 8000, remainingMinor: 8000, paidMinor: 0,
          currency: 'USD', lessonsIncluded: 8, instalmentId: null,
        });
        expect(demo[0].label).toMatch(/8/);
        expect(demo[0].child).toMatchObject({ id: expect.any(String), name: expect.any(String) });
        expect(f.children.map((c) => c.id)).toContain(demo[0].child.id);
        expect(mine.json.bankAccount.iban).toBeNull();
        expect(mine.json.bankAccount.accountNumber).toMatch(/^DEMO-/);
        expect(mine.json.bankAccount.accountName).toMatch(/Demo bank details for App Review: no transfer is possible|تجريبية/);
        expectNoRealBank(mine.text, `/me/billing ${f.id}`);
      }
      // Never written.
      expect(await g.prisma.paymentRequest.count({ where: { id: REVIEW_DEMO_REQUEST_ID } })).toBe(0);
    });

    it('card from the app: the demo page, whatever is named, and no Stripe call', async () => {
      const f = m.families[0]!;
      for (const body of [{ requestId: REVIEW_DEMO_REQUEST_ID }, { requestId }, { instalmentId: randomUUID() }, {}]) {
        const card = await http(f.parent.subject, 'POST', '/me/billing/checkout', body);
        expect([JSON.stringify(body), card.status]).toEqual([JSON.stringify(body), 201]);
        expect(card.json.url).toMatch(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/pay/review-demo\\?lang=(ar|en)$`));
        expectNoRealBank(card.text, 'checkout');
      }
      expect(stripeCalls()).toEqual(calls);
    });

    it('the demo page: static, both languages, the pay page CSP, no real bank, no Stripe', async () => {
      for (const lang of ['en', 'ar']) {
        const r = await fetch(`${base}/pay/review-demo?lang=${lang}`);
        expect(r.status).toBe(200);
        expect(r.headers.get('content-type')).toMatch(/text\/html/);
        expect(r.headers.get('cache-control')).toBe('no-store');
        expect(r.headers.get('content-security-policy')).toMatch(PAY_PAGE_CSP);
        const html = await r.text();
        expect(html).toContain("In the live app this opens Stripe&#39;s secure checkout page in the browser to pay this lesson package by card. The review account cannot make a payment.");
        expect(html).toContain('لا يمكن لحساب المراجعة إجراء أي دفع.');
        expect(html).toContain(`<html lang="${lang}"`);
        expect(html).not.toMatch(/<script|<form/i);
        expectNoRealBank(html, `demo page ${lang}`);
      }
      expect(stripeCalls()).toEqual(calls);
    });

    it('the web pay link of a review family: demo bank details, and card goes to the demo page, not Stripe', async () => {
      const page = await fetch(`${base}/pay/${token}?lang=en`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('Demo bank details for App Review: no transfer is possible');
      expect(html).not.toContain('After transferring, send a photo of the receipt');
      expectNoRealBank(html, 'pay link page');
      const ar = await (await fetch(`${base}/pay/${token}?lang=ar`)).text();
      expect(ar).not.toContain('بعد التحويل أرسل صورة الإيصال');

      const r = await fetch(`${base}/pay/${token}/checkout?lang=en`, { method: 'POST', redirect: 'manual' });
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe(`${base}/pay/review-demo?lang=en`);
      expect(stripeCalls()).toEqual(calls);
    });

    it('bank transfer: no upload grant and no receipt -- refused with reviewMode, before anything is stored', async () => {
      const f = m.families[0]!;
      const grant = await http(f.parent.subject, 'POST', '/me/billing/receipts/upload', { mimeType: 'image/jpeg', byteSize: 1024 });
      expect(grant.status).toBe(403);
      expect(grant.code).toBe(CommErrorCode.BILLING_DENIED);
      expect(grant.json.error?.detail).toEqual({ reviewMode: true });
      expect(grant.json).not.toHaveProperty('uploadUrl');

      for (const rid of [REVIEW_DEMO_REQUEST_ID, requestId]) {
        const sent = await http(f.parent.subject, 'POST', '/me/billing/receipts', {
          objectKey: `payment-receipts/${f.id}/${randomUUID()}`, requestId: rid, amountMinor: 8000, transferredOn: '2026-11-01',
        });
        expect(sent.status).toBe(403);
        expect(sent.code).toBe(CommErrorCode.BILLING_DENIED);
        expect(sent.json.error?.detail).toEqual({ reviewMode: true });
        expectNoRealBank(sent.text, 'receipt refusal');
      }
    });

    it('the renewal request is refused with reviewMode: no renewal request, audit row, chat card or staff task', async () => {
      const f = m.families[1]!;
      const child = f.children[0]!;
      const r = await http(f.parent.subject, 'POST', `/me/subscriptions/${child.id}/renewal-request`);
      expect(r.status).toBe(403);
      expect(r.code).toBe(CommErrorCode.BILLING_DENIED);
      expect(r.json.error?.detail).toEqual({ reviewMode: true });
      expect(await g.prisma.renewalRequest.count({ where: { learnerId: child.id } })).toBe(0);
      expect(await writeCounts()).toEqual(counts);
    });

    it('staff of the review organization: every money write and the settings are refused, before any lookup', async () => {
      const f = m.families[0]!;
      const child = f.children[0]!;
      const refused: Array<[string, string, string, unknown?]> = [
        [m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, { purpose: 'other', label: 'x', amountMinor: 1000, currency: 'AED' }],
        [m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, { instalmentId: randomUUID() }],
        [m.salesManager.subject, 'POST', `/payment-requests/${requestId}/cancel`, { reason: 'x' }],
        [m.salesManager.subject, 'POST', `/families/${f.id}/instalments`, { label: 'Fees', amountMinor: 50000, currency: 'AED', firstDueDate: '2026-11-01', learnerId: child.id }],
        [m.salesManager.subject, 'POST', `/families/${f.id}/payments`, { method: 'cash', amountMinor: 1000, paidOn: '2026-11-01', requestId }],
        [m.salesManager.subject, 'POST', `/instalments/${randomUUID()}/payment`, { paidOn: '2026-11-01' }],
        [m.salesManager.subject, 'POST', `/payment-receipts/${randomUUID()}/approve`, {}],
        [m.superAdmin.subject, 'POST', `/families/${f.id}/payment-requests`, { purpose: 'other', label: 'x', amountMinor: 1000, currency: 'AED' }],
        [m.superAdmin.subject, 'POST', `/families/${f.id}/payments`, { method: 'bank_transfer', amountMinor: 1000, paidOn: '2026-11-01' }],
        [m.superAdmin.subject, 'POST', `/payments/${randomUUID()}/refunds`, { amountMinor: 1000, reason: 'x' }],
        [m.superAdmin.subject, 'GET', '/billing/settings'],
        [m.superAdmin.subject, 'POST', '/billing/settings', { bankAccount: REAL_BANK }],
      ];
      for (const [who, method, path, body] of refused) {
        const r = await http(who, method, path, body);
        expect([method, path, r.status, r.code, r.json.error?.detail]).toEqual([method, path, 403, CommErrorCode.BILLING_DENIED, { reviewMode: true }]);
        expectNoRealBank(r.text, `${method} ${path}`);
      }
    });

    it('nothing was written anywhere, and Stripe was never called', async () => {
      expect(await writeCounts()).toEqual(counts);
      expect(stripeCalls()).toEqual(calls);
    });
  });
});
