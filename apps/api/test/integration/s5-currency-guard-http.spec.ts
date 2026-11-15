/**
 * S5 over real HTTP: the currency guard (src/billing/currency-rules.ts).
 * Real logins, the real routes; Stripe is the in-memory FakeStripe, so no
 * network and no real payment.
 *
 * What it proves:
 *  - a new amount names a real ISO 4217 currency ("XYZ" is refused at creation);
 *  - a currency Stripe takes no card in, or counts in other minor units than
 *    Chat, is still a request the family pays by bank transfer -- card only
 *    is refused (503, the existing "pay by bank transfer" answer), before Stripe is asked;
 *  - less than Stripe's minimum for the currency (also what is LEFT after a
 *    part payment) is refused for card, never sent to Stripe;
 *  - an instalment the ledger already covers gets no 1-minor-unit request;
 *  - with OA-12 review mode (#585): a review organization keeps the demo card
 *    page for a request S5 would refuse, and never sees the S5 refusal; the
 *    W63 card pause still wins over both.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
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
import { CARD_PAUSED_KEY } from '../../src/billing/card-pause';
import { REVIEW_ORGANIZATIONS_KEY } from '../../src/billing/review-mode';
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
const PASSWORD = 's5-currency-guard-password-1';
const DOMAIN = 's5cg.qa.jawwid.test';

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

type Json = { error?: { code?: string; message?: string; detail?: unknown } } & Record<string, any>;
async function http(subject: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {};
  if (subject) headers.authorization = `Bearer ${await tokenFor(subject)}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as Json;
  return { status: r.status, code: json.error?.code, json };
}


function tokenOf(link: string): string {
  return link.slice(link.lastIndexOf('/') + 1);
}


let nextFamily = 0;
/** A fresh seeded family per test, so no test sees another's money. */
function freshFamily() {
  const f = m.families[nextFamily++]!;
  const supervisor = m.supervisors.find((s) => s.id === f.children[0]!.supervisorId)!;
  return { f, child: f.children[0]!, supervisor };
}



beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 's5cg-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 's5cg-${orgId.slice(0, 8)}', 'S5 currency guard QA academy')`,
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
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 's5cg-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedLinkBase === undefined) delete process.env.PAYMENT_LINK_BASE_URL;
  else process.env.PAYMENT_LINK_BASE_URL = inheritedLinkBase;
});

const PAID_ON = '2026-01-15'; // a fixed past day: never crosses a boundary

async function request(familyId: string, learnerId: string, amountMinor: number, currency: string) {
  const created = await http(m.salesManager.subject, 'POST', `/families/${familyId}/payment-requests`, {
    purpose: 'renewal', label: 'Quran — renewal', amountMinor, currency, learnerId, lessonsIncluded: 8, planMonths: 1,
  });
  expect(created.status).toBe(201);
  return created.json.request as { id: string; link: string };
}

function sessionsFor(requestId: string) {
  return [...stripe.sessions.values()].filter((s) => s.input.requestId === requestId);
}

describe('creation: a real currency', () => {
  it('a payment request or an instalment in "XYZ" is refused (400); a real one is created', async () => {
    const { f, child } = freshFamily();
    const bad = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'renewal', label: 'x', amountMinor: 120000, currency: 'XYZ', learnerId: child.id, lessonsIncluded: 8, planMonths: 1,
    });
    expect(bad.status).toBe(400);
    expect(bad.code).toBe(CommErrorCode.VALIDATION);
    const badPlan = await http(m.salesManager.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'x', amountMinor: 50000, currency: 'XYZ', firstDueDate: '2026-12-01',
    });
    expect(badPlan.status).toBe(400);
    expect(badPlan.code).toBe(CommErrorCode.VALIDATION);
    expect(await g.prisma.paymentRequest.count({ where: { familyId: f.id } })).toBe(0);
    expect(await g.prisma.familyInstalment.count({ where: { familyId: f.id } })).toBe(0);
    // A currency Stripe takes no card in is still a currency: created, for a bank transfer.
    await request(f.id, child.id, 100000, 'IQD');
  });
});

describe('card checkout: refused before Stripe is asked; bank transfer unaffected', () => {
  it('a currency Stripe takes no card in (IQD): 503 CARD_CURRENCY_UNSUPPORTED in the app and on the link page; no card offered; a transfer still records', async () => {
    const { f, child } = freshFamily();
    const r = await request(f.id, child.id, 100000, 'IQD');
    const calls = stripe.sessions.size;

    const inApp = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: r.id });
    expect(inApp.status).toBe(503);
    expect(inApp.code).toBe(CommErrorCode.PAYMENTS_UNAVAILABLE);
    expect(inApp.json.error?.detail).toEqual({ reason: 'CARD_CURRENCY_UNSUPPORTED', currency: 'IQD' });

    const page = await fetch(`${base}/pay/${tokenOf(r.link)}`);
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain('/checkout');
    const post = await fetch(`${base}/pay/${tokenOf(r.link)}/checkout`, { method: 'POST', redirect: 'manual' });
    expect(post.status).toBe(503);
    expect(stripe.sessions.size).toBe(calls);
    expect(await g.prisma.paymentCheckout.count({ where: { requestId: r.id } })).toBe(0);

    const transfer = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, {
      method: 'bank_transfer', amountMinor: 100000, paidOn: PAID_ON, requestId: r.id,
    });
    expect(transfer.status).toBe(201);
    expect((await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: r.id } })).paidAt).not.toBeNull();
  });

  it('a currency Chat counts in other minor units than Stripe (PKR): 503 CARD_CURRENCY_PRECISION, never a charge 100x too small', async () => {
    const { f, child } = freshFamily();
    const r = await request(f.id, child.id, 25000, 'PKR');
    const res = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: r.id });
    expect(res.status).toBe(503);
    expect(res.json.error?.detail).toEqual({ reason: 'CARD_CURRENCY_PRECISION', currency: 'PKR' });
    expect(sessionsFor(r.id)).toHaveLength(0);
  });

  it('below Stripe\'s minimum (AED 1.50 < 2.00): 503 CARD_AMOUNT_BELOW_MINIMUM; exactly the minimum opens Stripe\'s page', async () => {
    const { f, child } = freshFamily();
    const small = await request(f.id, child.id, 150, 'AED');
    const res = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: small.id });
    expect(res.status).toBe(503);
    expect(res.code).toBe(CommErrorCode.PAYMENTS_UNAVAILABLE);
    expect(res.json.error?.detail).toEqual({ reason: 'CARD_AMOUNT_BELOW_MINIMUM', currency: 'AED', minimumMinor: 200 });
    expect(sessionsFor(small.id)).toHaveLength(0);

    const atMinimum = await request(f.id, child.id, 200, 'AED');
    const ok = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: atMinimum.id });
    expect(ok.status).toBe(201);
    expect(sessionsFor(atMinimum.id).map((s) => s.input.amountMinor)).toEqual([200]);
  });

  it('what is LEFT after a part transfer is below the minimum: card refused, not a 1-dirham charge', async () => {
    const { f, child } = freshFamily();
    const r = await request(f.id, child.id, 120000, 'AED');
    const part = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, {
      method: 'bank_transfer', amountMinor: 119900, paidOn: PAID_ON, requestId: r.id,
    });
    expect(part.status).toBe(201);
    const res = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: r.id });
    expect(res.status).toBe(503);
    expect(res.json.error?.detail).toEqual({ reason: 'CARD_AMOUNT_BELOW_MINIMUM', currency: 'AED', minimumMinor: 200 });
    expect(sessionsFor(r.id)).toHaveLength(0);
  });
});

describe('instalments: no 1-minor-unit request', () => {
  it('an instalment the ledger already covers (left open) gets no request; 409, nothing created', async () => {
    const { f } = freshFamily();
    const created = await http(m.salesManager.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Term fee', amountMinor: 50000, currency: 'AED', firstDueDate: '2026-12-01',
    });
    expect(created.status).toBe(201);
    const inst = await g.prisma.familyInstalment.findFirstOrThrow({ where: { familyId: f.id } });
    // A state the database can hold (no trigger closes an instalment from its payments):
    // a ledger row covering it in full, the instalment itself still open.
    await g.prisma.payment.create({
      data: {
        organizationId: inst.organizationId, familyId: f.id, instalmentId: inst.id, method: 'bank_transfer',
        amountMinor: 50000n, currency: 'AED', paidOn: new Date(`${PAID_ON}T00:00:00Z`), recordedBy: m.salesManager.id,
      },
    });
    expect((await g.prisma.familyInstalment.findUniqueOrThrow({ where: { id: inst.id } })).paidOn).toBeNull();

    const res = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, { instalmentId: inst.id });
    expect(res.status).toBe(409);
    expect(res.code).toBe(CommErrorCode.BILLING_STATE);
    expect(await g.prisma.paymentRequest.count({ where: { instalmentId: inst.id } })).toBe(0);
  });
});

/** The 13 card currencies Chat counts in other minor units than Stripe (see the unit spec). */
const MISMATCHED = ['AFN', 'ALL', 'COP', 'HUF', 'IDR', 'ISK', 'LAK', 'LBP', 'MMK', 'PKR', 'SOS', 'UGX', 'YER'] as const;

describe('regression: every mismatched currency -- card refused before Stripe is called; bank transfer unaffected', () => {
  // A fresh family per case: the per-parent checkout rate limit (429) must never be what answers.
  it.each(MISMATCHED)('%s: created (sent lower-case, stored upper-case); card refused in the app, on the link page and for its instalment; bank transfer and cash record', async (c) => {
    const { f, child } = freshFamily();
    const r = await request(f.id, child.id, 250000, c.toLowerCase()); // C3 B8 + B9
    expect((await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: r.id } })).currency).toBe(c);
    const before = stripe.sessions.size;

    const inApp = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: r.id });
    expect(inApp.status).toBe(503);
    expect(inApp.code).toBe(CommErrorCode.PAYMENTS_UNAVAILABLE);
    expect(inApp.json.error?.detail).toEqual({ reason: 'CARD_CURRENCY_PRECISION', currency: c });

    const page = await fetch(`${base}/pay/${tokenOf(r.link)}`);
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain('/checkout');
    const post = await fetch(`${base}/pay/${tokenOf(r.link)}/checkout`, { method: 'POST', redirect: 'manual' });
    expect(post.status).toBe(503);

    // Stripe was never asked: no session, no checkout row.
    expect(stripe.sessions.size).toBe(before);
    expect(await g.prisma.paymentCheckout.count({ where: { requestId: r.id } })).toBe(0);

    // C3 B4: a request made for an instalment in the same currency (ensureInstalmentRequest) is refused the same way.
    const plan = await http(m.salesManager.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Term fee', amountMinor: 100000, currency: c, firstDueDate: '2026-12-01',
    });
    expect(plan.status).toBe(201);
    const inst = await g.prisma.familyInstalment.findFirstOrThrow({ where: { familyId: f.id, currency: c } });
    const forInst = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, { instalmentId: inst.id });
    expect(forInst.status).toBe(201);
    const instLink = forInst.json.request as { id: string; link: string };
    const instPost = await fetch(`${base}/pay/${tokenOf(instLink.link)}/checkout`, { method: 'POST', redirect: 'manual' });
    expect(instPost.status).toBe(503);

    // Stripe was never asked for either request: no session, no checkout row.
    expect(stripe.sessions.size).toBe(before);
    expect(await g.prisma.paymentCheckout.count({ where: { requestId: { in: [r.id, instLink.id] } } })).toBe(0);

    // C3 B3: cash and a bank transfer record in full.
    for (const [method, amountMinor] of [['cash', 100000], ['bank_transfer', 150000]] as const) {
      const recorded = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, {
        method, amountMinor, paidOn: PAID_ON, requestId: r.id,
      });
      expect(recorded.status).toBe(201);
    }
    const paid = await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(paid.paidAt).not.toBeNull();
    expect(await g.prisma.payment.count({ where: { requestId: r.id, currency: c, voidedAt: null } })).toBe(2);
  });

  it.each([
    ['USD', 50], ['AED', 5000], ['JPY', 50], ['KWD', 12340],
  ])('control %s %d: Stripe\'s page opens for exactly that amount', async (c, amount) => {
    const { f, child } = freshFamily();
    const r = await request(f.id, child.id, amount as number, c as string);
    const res = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: r.id });
    expect(res.status).toBe(201);
    const s = sessionsFor(r.id);
    expect(s).toHaveLength(1);
    expect(s[0]!.input).toMatchObject({ amountMinor: amount, currency: c });
    expect(s[0]!.params.line_items![0]!.price_data).toMatchObject({ currency: (c as string).toLowerCase(), unit_amount: amount });
  });

  it('KWD 12.345 (last digit not 0): CONSERVATIVE refusal before Stripe; a bank transfer still records', async () => {
    const { f, child } = freshFamily();
    const r = await request(f.id, child.id, 12345, 'KWD');
    const res = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: r.id });
    expect(res.status).toBe(503);
    expect(res.json.error?.detail).toEqual({ reason: 'CARD_AMOUNT_THREE_DECIMAL_ROUNDING', currency: 'KWD', multipleOf: 10 });
    expect(sessionsFor(r.id)).toHaveLength(0);
    const transfer = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, {
      method: 'bank_transfer', amountMinor: 12345, paidOn: PAID_ON, requestId: r.id,
    });
    expect(transfer.status).toBe(201);
  });

  it('C3 B5b: a page opened before the guard (PKR) is neither reused nor expired by a refused tap; it lapses on its own (documented residual)', async () => {
    const { f, child } = freshFamily();
    const r = await request(f.id, child.id, 250000, 'PKR');
    const stale = `cs_test_pre_s5_${r.id.slice(0, 8)}`;
    await g.prisma.paymentCheckout.create({
      data: {
        stripeSessionId: stale, organizationId: orgId, requestId: r.id, amountMinor: 250000n, currency: 'PKR',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    const res = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: r.id });
    expect(res.status).toBe(503);
    expect(res.json.error?.detail).toEqual({ reason: 'CARD_CURRENCY_PRECISION', currency: 'PKR' });
    expect(res.json.url).toBeUndefined();
    expect(stripe.expired).not.toContain(stale);
    expect((await g.prisma.paymentCheckout.findUniqueOrThrow({ where: { stripeSessionId: stale } })).status).toBe('open');
  });

  it('C3 B6: a refund of a card payment in PKR is NOT guarded (money Stripe took must be refundable); the amount goes to Stripe unchanged -- the pre-converter behaviour, documented', async () => {
    const { f } = freshFamily();
    const pi = `pi_test_pre_s5_${f.id.slice(0, 8)}`;
    const payment = await g.prisma.payment.create({
      data: {
        organizationId: orgId, familyId: f.id, method: 'card', amountMinor: 250000n, currency: 'PKR',
        paidOn: new Date(`${PAID_ON}T00:00:00Z`), stripePaymentIntentId: pi, stripeCheckoutSessionId: `cs_test_pre_s5_${f.id.slice(0, 8)}`,
      },
    });
    const calls = stripe.refundCalls.length;
    const res = await http(m.superAdmin.subject, 'POST', `/payments/${payment.id}/refunds`, { amountMinor: 1000, reason: 'S5 refund probe' });
    expect(res.status).toBe(201);
    expect(stripe.refundCalls.slice(calls)).toEqual([expect.objectContaining({ paymentIntentId: pi, amountMinor: 1000 })]);
  });

  // C3 B5: refusing to RECORD a confirmed Stripe payment in one of the 13 would lose money Stripe took; production has
  // never run a card payment and S5 prevents new ones, so no hardening of confirm() -- decision in reports/B4.md.
  it.todo('C3 B5: webhook hardening for a pre-S5 session in a mismatched currency (decided: not implemented; see B4.md)');
});

describe('with OA-12 review mode and the W63 card pause (#585 on main)', () => {
  async function setConfig(key: string, value: unknown | undefined) {
    if (value === undefined) await g.prisma.config.deleteMany({ where: { key } });
    else await g.prisma.config.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  }
  const demoUrl = (lang: string) => `${base}/pay/review-demo?lang=${lang}`;

  it('a review organization gets the demo card page for a request S5 refuses (PKR, below the minimum), never the S5 refusal; the pause wins over both; Stripe never asked', async () => {
    const { f, child } = freshFamily();
    const pkr = await request(f.id, child.id, 25000, 'PKR');
    const small = await request(f.id, child.id, 150, 'AED');
    const both = [pkr, small];
    const formOf = (r: { link: string }) => `action="./${tokenOf(r.link)}/checkout?lang=en"`;
    const calls = stripe.sessions.size;

    // Control, outside review mode: S5 refuses both, the link page offers no card form.
    for (const r of both) expect(await (await fetch(`${base}/pay/${tokenOf(r.link)}?lang=en`)).text()).not.toContain('/checkout');

    await setConfig(REVIEW_ORGANIZATIONS_KEY, [orgId]);
    try {
      for (const r of both) {
        const page = await fetch(`${base}/pay/${tokenOf(r.link)}?lang=en`);
        expect(page.status).toBe(200);
        expect(await page.text()).toContain(formOf(r));
        const post = await fetch(`${base}/pay/${tokenOf(r.link)}/checkout?lang=en`, { method: 'POST', redirect: 'manual' });
        expect([r.id, post.status, post.headers.get('location')]).toEqual([r.id, 303, demoUrl('en')]);
        const inApp = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: r.id });
        expect([r.id, inApp.status]).toEqual([r.id, 201]);
        expect(inApp.json.url).toMatch(/\/pay\/review-demo\?lang=(ar|en)$/);
        expect(JSON.stringify(inApp.json)).not.toMatch(/CARD_(CURRENCY|AMOUNT)_/);
      }

      // W63: the operator's pause wins in review mode too, for these requests as for any.
      await setConfig(CARD_PAUSED_KEY, true);
      try {
        for (const r of both) {
          expect(await (await fetch(`${base}/pay/${tokenOf(r.link)}?lang=en`)).text()).not.toContain('/checkout');
          const post = await fetch(`${base}/pay/${tokenOf(r.link)}/checkout?lang=en`, { method: 'POST', redirect: 'manual' });
          expect([r.id, post.status]).toEqual([r.id, 503]);
          const inApp = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: r.id });
          expect([r.id, inApp.status, inApp.code]).toEqual([r.id, 503, CommErrorCode.PAYMENTS_UNAVAILABLE]);
          expect(JSON.stringify(inApp.json)).not.toMatch(/CARD_(CURRENCY|AMOUNT)_/);
        }
      } finally {
        await setConfig(CARD_PAUSED_KEY, undefined);
      }
    } finally {
      await setConfig(REVIEW_ORGANIZATIONS_KEY, undefined);
    }

    expect(stripe.sessions.size).toBe(calls);
    expect(await g.prisma.paymentCheckout.count({ where: { requestId: { in: both.map((r) => r.id) } } })).toBe(0);
    // Review mode off again: S5 refuses as before.
    const after = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: pkr.id });
    expect(after.json.error?.detail).toEqual({ reason: 'CARD_CURRENCY_PRECISION', currency: 'PKR' });
  });
});

