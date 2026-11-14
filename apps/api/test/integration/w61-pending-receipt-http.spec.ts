/**
 * W61 S2 over real HTTP: a card while a bank-transfer receipt is waiting.
 *
 * A family that sent a transfer receipt and then pays by card too may be
 * charged twice. What it proves:
 *  - receipts still waiting that cover what is left: the app's card checkout
 *    and the /pay page's form are REFUSED (409 COMM.BILLING_STATE, detail.reason
 *    receipt_pending); no Stripe page is opened; the /pay page shows the notice
 *    and no card button;
 *  - receipts covering only part: the card is still allowed (for the whole
 *    remaining amount -- a receipt is not money until the academy approves it),
 *    with the notice on the /pay page;
 *  - a rejected receipt, or one in another currency, does not count.
 *
 * Real logins, the global bearer guard, the real routes; Stripe is the
 * in-memory stand-in (no network). Synthetic people only (G-20).
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
const PASSWORD = 'w61-pending-receipt-password-1';
const DOMAIN = 'w61.qa.jawwid.test';

const NOTICE_EN = 'A transfer receipt for this request is waiting for the academy to check. Paying by card too may charge you twice.';
const NOTICE_AR = 'يوجد إيصال تحويل لهذا الطلب بانتظار مراجعة الأكاديمية. إن دفعتم بالبطاقة أيضًا فقد يُخصم المبلغ مرتين.';

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

type Json = { error?: { code?: string; message?: string; detail?: Record<string, unknown> } } & Record<string, any>;
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
function freshFamily() {
  const f = m.families[nextFamily++]!;
  return { f, child: f.children[0]! };
}

/** A renewal of 8 lessons for the child: a lesson package, payable in the app (PD-30). */
async function lessonRequest(familyId: string, learnerId: string, amountMinor = 120000) {
  const created = await http(m.salesManager.subject, 'POST', `/families/${familyId}/payment-requests`, {
    purpose: 'renewal', label: 'Quran — renewal', amountMinor, currency: 'AED', learnerId, lessonsIncluded: 8, planMonths: 1,
  });
  expect(created.status).toBe(201);
  return created.json.request as { id: string; link: string };
}

/** A bank-transfer receipt the parent sent, as the receipts route writes it (the file itself is not needed here). */
async function receipt(
  f: SeedManifest['families'][number],
  requestId: string,
  amountMinor: number,
  opts: { status?: 'pending' | 'rejected'; currency?: string } = {},
) {
  // A receipt is uploaded pending (chat.guard_payment_receipt); a rejection is a decision after.
  const row = await g.prisma.paymentReceipt.create({
    data: {
      organizationId: orgId,
      familyId: f.id,
      requestId,
      amountMinor: BigInt(amountMinor),
      currency: opts.currency ?? 'AED',
      transferredOn: new Date('2026-10-20T00:00:00.000Z'),
      objectKey: `payment-receipts/${f.id}/${randomUUID()}.png`,
      mimeType: 'image/png',
      byteSize: 1024,
      uploadedBy: f.parent.id,
    },
  });
  if (opts.status === 'rejected') {
    await g.prisma.paymentReceipt.update({
      where: { id: row.id },
      data: { status: 'rejected', reviewedBy: m.salesManager.id, reviewedAt: new Date(), rejectReason: 'the transfer did not arrive' },
    });
  }
}

const checkoutsOf = (requestId: string) => g.prisma.paymentCheckout.count({ where: { requestId } });

async function payPage(token: string, lang: 'ar' | 'en') {
  const r = await fetch(`${base}/pay/${token}?lang=${lang}`);
  return { status: r.status, html: await r.text() };
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'w61-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'w61-${orgId.slice(0, 8)}', 'W61 pending receipt QA academy')`,
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
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'w61-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedLinkBase === undefined) delete process.env.PAYMENT_LINK_BASE_URL;
  else process.env.PAYMENT_LINK_BASE_URL = inheritedLinkBase;
});

describe('W61 S2: a card while a transfer receipt is waiting', () => {
  it('receipts waiting that cover what is left: the app\'s card is refused with receipt_pending, and no Stripe page is opened', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    // Two receipts that together cover the whole request.
    await receipt(f, request.id, 70000);
    await receipt(f, request.id, 50000);

    const started = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id });
    expect(started.status).toBe(409);
    expect(started.code).toBe(CommErrorCode.BILLING_STATE);
    expect(started.json.error?.detail).toMatchObject({ reason: 'receipt_pending', pendingMinor: 120000, remainingMinor: 120000 });
    expect(started.json.error?.message).toBe(NOTICE_EN);
    expect(await checkoutsOf(request.id)).toBe(0);
  });

  it('the /pay page: the notice, no card button, and its form refused the same way (409, nothing opened)', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    await receipt(f, request.id, 120000);
    const token = tokenOf(request.link);

    const en = await payPage(token, 'en');
    expect(en.status).toBe(200);
    expect(en.html).toContain(NOTICE_EN);
    expect(en.html).toContain('Card payment will be available again if the academy cannot confirm the transfer.');
    expect(en.html).not.toContain('/checkout?lang=');
    const ar = await payPage(token, 'ar');
    expect(ar.html).toContain(NOTICE_AR);
    expect(ar.html).not.toContain('/checkout?lang=');

    const posted = await fetch(`${base}/pay/${token}/checkout?lang=en`, { method: 'POST', redirect: 'manual' });
    expect(posted.status).toBe(409);
    const html = await posted.text();
    expect(html).toContain(NOTICE_EN);
    // The notice once; not a second generic error line.
    expect(html.split(NOTICE_EN)).toHaveLength(2);
    expect(await checkoutsOf(request.id)).toBe(0);
  });

  it('receipts covering only part: the card is still allowed, for the whole remaining amount, with the notice', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    await receipt(f, request.id, 50000);
    const token = tokenOf(request.link);

    const en = await payPage(token, 'en');
    expect(en.html).toContain(NOTICE_EN);
    expect(en.html).not.toContain('Card payment will be available again');
    expect(en.html).toContain(`/checkout?lang=en`);
    expect((await payPage(token, 'ar')).html).toContain(NOTICE_AR);

    const started = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id });
    expect(started.status).toBe(201);
    const sessionId = started.json.url.slice(started.json.url.lastIndexOf('/') + 1);
    // A receipt is not money until the academy approves it: the card is for what is left.
    expect(stripe.sessions.get(sessionId)!.input.amountMinor).toBe(120000);

    // The link page's form too.
    const posted = await fetch(`${base}/pay/${token}/checkout`, { method: 'POST', redirect: 'manual' });
    expect(posted.status).toBe(303);
  });

  it('a rejected receipt, or one in another currency, does not count; a request with none shows no notice', async () => {
    const { f, child } = freshFamily();
    const request = await lessonRequest(f.id, child.id);
    expect((await payPage(tokenOf(request.link), 'en')).html).not.toContain(NOTICE_EN);

    await receipt(f, request.id, 120000, { status: 'rejected' });
    await receipt(f, request.id, 120000, { currency: 'USD' });
    expect((await payPage(tokenOf(request.link), 'en')).html).not.toContain(NOTICE_EN);
    const started = await http(f.parent.subject, 'POST', '/me/billing/checkout', { requestId: request.id });
    expect(started.status).toBe(201);
  });
});
