/**
 * PD-30 over real HTTP: real logins, the global bearer guard, the real routes,
 * the database's own state machine (chat.refresh_learner_access) and the
 * effects worker (SubscriptionEffects).
 *
 * What it proves, end to end:
 *  - the ledger: who reads it, who adds and voids, who grants exceptions (the
 *    super admin, the Operations Manager, the Sales Manager -- nobody else);
 *  - counting and "Lesson N of M": held and no-show lessons use the balance,
 *    the report card says "1 of 3", a renewal continues "3 of 8";
 *  - grace: two more lessons after the balance runs out, announced to the
 *    family's direct chat (never the group); then the child locks. The chat
 *    stays open (owner, 2026-11-06): the parent and the teacher still write,
 *    react and call in the group. Only new lesson bookings pause;
 *  - paying (a renewal request paid in cash) unlocks at once; voiding the
 *    payment takes the lessons back and locks again;
 *  - an instalment of a lesson package overdue since go-live locks; one due
 *    before go-live only lists; one that names no lesson package never locks
 *    (D-2, 2026-11-06); paying it unlocks; an exception lets the child go on;
 *  - a renewal request from a locked banner, once per day;
 *  - the sweep and a payment arriving together leave one state and one card;
 *  - holds: lessons already on the calendar go ahead (D-1, 2026-11-06), the
 *    materializer creates none while held, and the unlock materializes again
 *    without a duplicate;
 *  - with enforcement off nothing is refused and nothing is announced.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { StatsService } from '../../src/lessons/stats.service';
import { SubscriptionModule } from '../../src/subscriptions/subscription.module';
import { SubscriptionEffects } from '../../src/subscriptions/subscription-effects.service';
import { PAID_OUTCOMES } from '../../src/teacher-file/teacher-payroll.service';
import { STRIPE_GATEWAY } from '../../src/billing/stripe.gateway';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { monthsOf } from '../support/academy-month';
import { buildGraph, truncate } from './harness';
import { addLesson } from './lesson-fixture';
import { LessonService } from '../../src/lessons/lesson.service';
import { FakeStripe } from './fake-stripe';
import { TemplateService } from '@communication/notifications/template.service';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const inheritedEnforced = process.env.SUBSCRIPTION_LOCK_ENFORCED;
const PASSWORD = 'pd30-http-spec-password-1';
const DOMAIN = 'pd30http.qa.jawwid.test';
const HOUR = 3_600_000;

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
let effects: SubscriptionEffects;

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

/** The academy's today (Africa/Cairo, the default schedule.timezone). */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
/**
 * A future booking `inDays` from today, at 08:00 UTC (10:00 or 11:00 in Cairo): a
 * fixed time of day, never "now + n days". The weekly-slot test below materializes a
 * lesson every evening at 23:15 Cairo (and Mondays at 21:00) for a teacher that other
 * families share, so a booking at "now + n days" hit the teacher's no-double-booking
 * rule (409 LESSON_TEACHER_BUSY) whenever the suite ran between about 22:45 and 23:45
 * Cairo time -- seen in CI on 2026-11-06 at 20:53 UTC.
 */
function bookingAt(inDays: number): { startsAt: string; endsAt: string } {
  const start = Date.parse(`${addDays(new Date().toISOString().slice(0, 10), inDays)}T08:00:00Z`);
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(start + HOUR / 2).toISOString() };
}

/** Enforcement as if it had been switched on before the test (go-live recorded, announcements done). */
async function switchedOnBefore() {
  for (const key of ['subscription.enforced_since', 'subscription.announced_at']) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.config (key, value) values ($1, to_jsonb(now()::text)) on conflict (key) do nothing`, key);
  }
}

/** A statement as a legacy writer or a person with SQL access would run it: the database must still refuse. */
async function sqlRefusal(sql: string, ...args: unknown[]): Promise<string> {
  try {
    await g.prisma.$executeRawUnsafe(sql, ...args);
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error('expected the database to refuse');
}

async function setGoLive(date: string) {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.config (key, value) values ('subscription.overdue_from', to_jsonb($1::text))
     on conflict (key) do update set value = excluded.value`, date);
}

/** Families whose first group is about one child: the simplest group to lock. */
const used = new Set<string>();
function family() {
  const f = m.families.find((x) => !used.has(x.id) && x.groups.length > 0 && x.groups[0]!.learnerIds.length === 1 && x.directs.length > 0)!;
  expect(f).toBeDefined();
  used.add(f.id);
  const group = f.groups[0]!;
  const child = f.children.find((c) => c.id === group.learnerIds[0])!;
  const teacher = m.teachers.find((t) => t.id === child.teacherId)!;
  const supervisor = m.supervisors.find((s) => s.id === child.supervisorId)!;
  return { f, child, groupId: group.conversationId, directId: f.directs[0]!.conversationId, teacher, supervisor, parent: f.parent };
}

/** A lesson for the child, `hoursAgo` in the past (the Teachers department schedules it). */
let slotHour = 30;
async function pastLesson(childId: string): Promise<string> {
  slotHour += 1; // never two lessons of one teacher at one time
  // Added before it began (PD-46 PR-2c refuses a past start over HTTP), through
  // the app's own LessonService: the subscription lock applies as it did then.
  return (await addLesson(g, app.get(LessonService), m.teachersManager.id, {
    learnerId: childId, startsAt: at(-slotHour * HOUR), endsAt: at(-slotHour * HOUR + HOUR / 2),
  })).id;
}

async function report(teacherSubject: string, lessonId: string, lessonNumber?: number) {
  const r = await http(teacherSubject, 'POST', `/lessons/${lessonId}/report`, {
    coveredTopics: ['revision'], rating: 4, ...(lessonNumber ? { lessonNumber } : {}),
  });
  expect(r.status).toBe(201);
  return r;
}

async function send(subject: string, conversationId: string) {
  return http(subject, 'POST', `/conversations/${conversationId}/messages`, { type: 'text', body: 'hello', clientMessageId: randomUUID() });
}

async function cards(conversationId: string, kind: string) {
  return g.prisma.messageCard.findMany({ where: { kind, message: { conversationId } }, include: { message: true }, orderBy: { message: { seq: 'asc' } } });
}

async function access(learnerId: string) {
  return g.prisma.learnerAccess.findUniqueOrThrow({ where: { learnerId } });
}

async function addSubscription(childId: string, lessonsIncluded: number, startsOn = addDays(today(), -7)) {
  const r = await http(m.superAdmin.subject, 'POST', `/learners/${childId}/subscriptions`, {
    lessonsIncluded, planMonths: 1, startsOn, reason: 'QA: lessons agreed with the owner',
  });
  expect(r.status).toBe(201);
  return r;
}

/** A standing lesson package for the child (8 lessons), for an instalment to name (R-4, D-2). */
async function lessonPackage(childId: string): Promise<string> {
  await addSubscription(childId, 8);
  const pkg = await g.prisma.learnerSubscription.findFirstOrThrow({
    where: { learnerId: childId, voidedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true },
  });
  return pkg.id;
}

/** An instalment of the child's lesson package: the only kind an overdue one locks with (D-2). */
async function packageInstalment(familyId: string, childId: string, label: string, firstDueDate: string) {
  const r = await http(m.operationsManager.subject, 'POST', `/families/${familyId}/instalments`, {
    label, amountMinor: 5000, firstDueDate, learnerId: childId, lessonSubscriptionId: await lessonPackage(childId),
  });
  expect(r.status).toBe(201);
  return g.prisma.familyInstalment.findFirstOrThrow({ where: { familyId, label } });
}

/** A lesson the Teachers department books: the one thing a lock still refuses. */
async function book(childId: string, inDays: number) {
  return http(m.teachersManager.subject, 'POST', '/lessons', {
    learnerId: childId, ...bookingAt(inDays),
  });
}

beforeAll(async () => {
  process.env.SUBSCRIPTION_LOCK_ENFORCED = 'true';
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd30h-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd30h-${orgId.slice(0, 8)}', 'PD-30 HTTP QA academy')`,
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
  await setGoLive(addDays(today(), -60));
  await switchedOnBefore();

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, BillingModule, SubscriptionModule],
  })
    .overrideProvider(STRIPE_GATEWAY)
    .useValue(new FakeStripe())
    .compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
  effects = app.get(SubscriptionEffects);
  for (const f of m.families) {
    expect((await http(m.superAdmin.subject, 'POST', `/families/${f.id}/billing`, { currency: 'AED' })).status).toBe(201);
  }
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd30h-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedEnforced === undefined) delete process.env.SUBSCRIPTION_LOCK_ENFORCED;
  else process.env.SUBSCRIPTION_LOCK_ENFORCED = inheritedEnforced;
});

describe('PD-30 over HTTP', () => {
  it('future bookings are at a fixed time of day, clear of the weekly-slot lessons, whenever the suite runs', () => {
    const cairo = (iso: string) =>
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
    for (const n of [3, 4, 5, 6, 9, 11, 12]) {
      const { startsAt, endsAt } = bookingAt(n);
      expect(Date.parse(startsAt)).toBeGreaterThan(Date.now() + (n - 1) * 24 * HOUR); // still days ahead
      expect(Date.parse(endsAt) - Date.parse(startsAt)).toBe(HOUR / 2);
      // Far from the slots the weekly-slot test materializes (21:00 and 23:15 Cairo).
      expect(cairo(startsAt) >= '09:00' && cairo(endsAt) <= '12:00').toBe(true);
    }
  });

  it('the ledger: billing readers read it, recorders add and void, only three roles grant exceptions', async () => {
    const { child, teacher, parent, supervisor } = family();
    expect((await http(null, 'GET', `/learners/${child.id}/subscription`)).status).toBe(401);
    expect((await http(teacher.subject, 'GET', `/learners/${child.id}/subscription`)).code).toBe(CommErrorCode.BILLING_DENIED);
    expect((await http(parent.subject, 'GET', `/learners/${child.id}/subscription`)).code).toBe(CommErrorCode.BILLING_DENIED);
    expect((await http(teacher.subject, 'POST', `/learners/${child.id}/subscription-exceptions`, {})).code).toBe(CommErrorCode.BILLING_DENIED);

    // The child's supervisor (Operations, in scope) reads -- but a subscription
    // with no payment behind it is free lessons: the three roles only.
    expect((await http(supervisor.subject, 'GET', `/learners/${child.id}/subscription`)).json).toMatchObject({
      canRecord: true, canAddSubscription: false, canGrantException: false,
    });
    expect((await http(supervisor.subject, 'POST', `/learners/${child.id}/subscriptions`, { lessonsIncluded: 24, reason: 'x' })).code)
      .toBe(CommErrorCode.SUBSCRIPTION_DENIED);
    // A reason, a start from a week ago to a month ahead, 1..1000 lessons.
    expect((await http(m.salesManager.subject, 'POST', `/learners/${child.id}/subscriptions`, { lessonsIncluded: 24 })).status).toBe(400);
    expect((await http(m.salesManager.subject, 'POST', `/learners/${child.id}/subscriptions`, { lessonsIncluded: 24, reason: 'x', startsOn: addDays(today(), -8) })).status).toBe(400);
    expect((await http(m.salesManager.subject, 'POST', `/learners/${child.id}/subscriptions`, { lessonsIncluded: 24, reason: 'x', startsOn: addDays(today(), 31) })).status).toBe(400);
    expect((await http(m.salesManager.subject, 'POST', `/learners/${child.id}/subscriptions`, { lessonsIncluded: 1001, reason: 'x' })).status).toBe(400);
    const added = await http(m.salesManager.subject, 'POST', `/learners/${child.id}/subscriptions`, {
      lessonsIncluded: 24, planMonths: 3, reason: 'Paid in cash at the office before PD-27',
    });
    expect(added.status).toBe(201);
    expect(added.json.standing).toMatchObject({
      current: { planMonths: 3, lessonsIncluded: 24, startsOn: today() },
      lessonsIncluded: 24, lessonsUsed: 0, lessonsLeft: 24, state: 'open', lockReasons: [],
    });
    expect(added.json).toMatchObject({ canAddSubscription: true, canGrantException: true });

    // A supervisor cannot grant an exception; the three roles can.
    const body = { kind: 'balance', reason: 'Owner agreed to wait for the transfer', validUntil: addDays(today(), 30) };
    expect((await http(supervisor.subject, 'POST', `/learners/${child.id}/subscription-exceptions`, body)).code).toBe(CommErrorCode.SUBSCRIPTION_DENIED);
    for (const who of [m.superAdmin.subject, m.operationsManager.subject, m.salesManager.subject]) {
      const r = await http(who, 'POST', `/learners/${child.id}/subscription-exceptions`, body);
      expect(r.status).toBe(201);
      expect(r.json.canGrantException).toBe(true);
    }
    // Bounded: a reason, and at most 90 days.
    expect((await http(m.salesManager.subject, 'POST', `/learners/${child.id}/subscription-exceptions`, { ...body, validUntil: addDays(today(), 91) })).status).toBe(400);
    expect((await http(m.salesManager.subject, 'POST', `/learners/${child.id}/subscription-exceptions`, { ...body, reason: '' })).status).toBe(400);

    const view = await http(m.salesManager.subject, 'GET', `/learners/${child.id}/subscription`);
    expect(view.json.exceptions).toHaveLength(3);
    const first = view.json.exceptions[0];
    expect((await http(supervisor.subject, 'POST', `/subscription-exceptions/${first.id}/revoke`, { reason: 'x' })).code).toBe(CommErrorCode.SUBSCRIPTION_DENIED);
    const revoked = await http(m.operationsManager.subject, 'POST', `/subscription-exceptions/${first.id}/revoke`, { reason: 'Paid after all' });
    expect(revoked.status).toBe(201);
    expect(revoked.json.exceptions.find((e: any) => e.id === first.id)).toMatchObject({ active: false, revoked: { reason: 'Paid after all' } });
    expect((await http(m.operationsManager.subject, 'POST', `/subscription-exceptions/${first.id}/revoke`, { reason: 'again' })).code).toBe(CommErrorCode.SUBSCRIPTION_STATE);

    // Void a subscription (a recorder), once.
    const sub = view.json.subscriptions[0];
    expect((await http(supervisor.subject, 'POST', `/subscriptions/${sub.id}/void`, { reason: 'Entered twice' })).status).toBe(201);
    expect((await http(supervisor.subject, 'POST', `/subscriptions/${sub.id}/void`, { reason: 'again' })).code).toBe(CommErrorCode.SUBSCRIPTION_STATE);

    // Audited.
    const actions = (await g.prisma.auditLog.findMany({ where: { entityId: child.id } })).map((a) => a.action);
    expect(actions.filter((a) => a === 'subscription_exception.granted')).toHaveLength(3);
    expect(actions).toEqual(expect.arrayContaining(['subscription.added', 'subscription.voided', 'subscription_exception.revoked']));
  });

  it('lessons used up: Lesson N of M, two grace lessons, then only new bookings pause -- the chat stays open', async () => {
    const { child, teacher, parent, supervisor, groupId, directId, f } = family();
    await addSubscription(child.id, 3);
    // PD-15's package is now the ledger's: shown from it, no longer typed.
    const kids = await http(supervisor.subject, 'GET', `/conversations/${groupId}/learners`);
    expect(kids.json.learners.find((l: any) => l.id === child.id)).toMatchObject({ packageLessons: 3, packageFromSubscription: true });
    expect((await http(supervisor.subject, 'POST', `/learners/${child.id}/enrollment`, { packageLessons: 99 })).status).toBe(201);
    expect((await http(supervisor.subject, 'GET', `/conversations/${groupId}/learners`)).json.learners.find((l: any) => l.id === child.id).packageLessons).toBe(3);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await pastLesson(child.id));
    const future = await http(m.teachersManager.subject, 'POST', '/lessons', {
      learnerId: child.id, ...bookingAt(5),
    });
    expect(future.status).toBe(201);

    // Lesson 1 of 3: suggested, kept with the report, on the card.
    const suggested = await http(teacher.subject, 'GET', `/lessons/${ids[0]}`);
    expect(suggested.json).toMatchObject({ suggestedLessonNumber: 1, suggestedLessonTotal: 3 });
    await report(teacher.subject, ids[0]!, 1);
    const reportCard = (await cards(groupId, 'lesson_report')).find((c) => c.lessonId === ids[0]);
    expect(reportCard!.payload).toMatchObject({ lessonNumber: 1, lessonTotal: 3 });
    expect(reportCard!.message.body).toMatch(/1 (of|من) 3/);
    await report(teacher.subject, ids[1]!);
    // An absence without an excuse uses the balance too.
    expect((await http(teacher.subject, 'POST', `/lessons/${ids[2]}/absence`, {})).status).toBe(201);
    expect(await access(child.id)).toMatchObject({ state: 'grace', balance: 0, graceLeft: 2 });

    await effects.applyEvents();
    expect((await cards(directId, 'subscription_grace')).map((c) => c.payload)).toEqual([expect.objectContaining({ graceLeft: 2 })]);
    expect(await cards(groupId, 'subscription_grace')).toHaveLength(0); // the teacher sees nothing financial
    const mine = await http(parent.subject, 'GET', '/me/billing');
    expect(mine.json.subscriptions.find((s: any) => s.child.id === child.id)).toMatchObject({
      state: 'grace', lessonsLeft: 0, graceLeft: 2, lockReasons: [], hasOpenPayment: false,
    });
    expect(mine.json.subscriptions[0]).not.toHaveProperty('excepted');

    await report(teacher.subject, ids[3]!);
    await effects.applyEvents();
    expect((await cards(directId, 'subscription_grace')).map((c) => (c.payload as { graceLeft: number }).graceLeft)).toEqual([2, 1]);

    // Lesson 5 is the second grace lesson: "5 of 3" says it is past the subscription.
    expect((await http(teacher.subject, 'GET', `/lessons/${ids[4]}`)).json).toMatchObject({ suggestedLessonNumber: 5, suggestedLessonTotal: 3 });
    await report(teacher.subject, ids[4]!);
    expect(await access(child.id)).toMatchObject({ state: 'locked', reasons: ['balance'], balance: -2, graceLeft: 0 });

    // The chat stays open (owner, 2026-11-06): the parent and the teacher write,
    // react, delete for everyone and call in the group, exactly as staff do.
    expect((await send(parent.subject, groupId)).status).toBe(201);
    const teacherSent = await send(teacher.subject, groupId);
    expect(teacherSent.status).toBe(201);
    const staffSent = await send(supervisor.subject, groupId);
    expect(staffSent.status).toBe(201);
    expect((await http(parent.subject, 'POST', `/conversations/${groupId}/messages/${staffSent.json.id}/reactions`, { emoji: '👍' })).status)
      .toBe(201);
    expect((await http(teacher.subject, 'POST', `/conversations/${groupId}/messages/${staffSent.json.id}/reactions`, { emoji: '👍' })).status)
      .toBe(201);
    expect((await http(teacher.subject, 'DELETE', `/conversations/${groupId}/messages/${teacherSent.json.id}`)).status).toBeLessThan(300);
    expect((await http(parent.subject, 'GET', `/conversations/${groupId}/call-capability`)).json).toMatchObject({ canCall: true });
    expect((await http(teacher.subject, 'GET', `/conversations/${groupId}/call-capability`)).json).toMatchObject({ canCall: true });
    expect((await send(parent.subject, directId)).status).toBe(201);

    // The conversation still names the locked child (the reason for the parent
    // and staff, only the child for the teacher), and is read-only for nobody:
    // an app built before 2026-11-06 keeps its composer.
    const asParent = await http(parent.subject, 'GET', `/conversations/${groupId}`);
    expect(asParent.json.paymentLock).toEqual({
      readOnly: false, canPay: true, children: [{ id: child.id, name: child.name, reasons: ['balance'], overdue: null }],
    });
    expect((await http(teacher.subject, 'GET', `/conversations/${groupId}`)).json.paymentLock).toEqual({
      readOnly: false, canPay: false, children: [{ id: child.id, name: child.name }],
    });
    expect((await http(supervisor.subject, 'GET', `/conversations/${groupId}`)).json.paymentLock.readOnly).toBe(false);
    expect((await http(parent.subject, 'GET', `/conversations/${directId}`)).json.paymentLock).toBeNull();

    // No new lesson for a locked child -- not even from the Teachers department.
    const refused = await http(m.teachersManager.subject, 'POST', '/lessons', {
      learnerId: child.id, ...bookingAt(6),
    });
    expect(refused.code).toBe(CommErrorCode.SUBSCRIPTION_LOCKED);

    // Announced once: "paused" in the group (no reason), why in the direct chat.
    await effects.sweep();
    await effects.sweep();
    const paused = await cards(groupId, 'lessons_paused');
    expect(paused).toHaveLength(1);
    expect(paused[0]!.payload).not.toHaveProperty('reasons');
    const locked = await cards(directId, 'subscription_locked');
    expect(locked).toHaveLength(1);
    expect(locked[0]!.payload).toMatchObject({ learnerId: child.id, reasons: ['balance'] });
    expect(await g.prisma.notification.count({ where: { eventType: 'subscription_locked', familyId: f.id } })).toBeGreaterThan(0);
    // The lock screen (Privacy Policy 4.12.4, Child Safety 4.4): what the push
    // provider is given -- the delivery row's template, rendered as the
    // dispatcher renders it -- names neither the child nor the reason, for the
    // parent and the supervisor alike (names are off by default). The Center
    // entry is the one it always was, with the row's variables.
    const templates = new TemplateService(g.prisma);
    const lockedPushes = await g.prisma.notification.findMany({ where: { eventType: 'subscription_locked', familyId: f.id } });
    expect(lockedPushes.map((n) => n.recipientId)).toContain(parent.id);
    for (const n of lockedPushes) {
      const shown = await templates.render(n.templateKey, n.locale, n.variables as Record<string, unknown>);
      expect(shown).not.toBeNull();
      expect(`${shown!.title} ${shown!.body}`).not.toContain(child.name);
      expect(`${shown!.title} ${shown!.body}`).not.toMatch(/used up|overdue|انتهت|متأخر|\{/);
      const entry = await g.prisma.notificationItem.findUniqueOrThrow({ where: { dedupeKey: n.dedupeKey } });
      expect(entry).toMatchObject({ eventType: 'subscription_locked', templateKey: 'inbox.generic' });
      expect(entry.variables).toMatchObject({ learner: child.name, reason: expect.any(String) });
    }

    // D-1 (owner, 2026-11-06): the lesson already on the calendar goes ahead.
    // The hold stops only the materializer (no new regular lessons).
    expect(await access(child.id)).toMatchObject({ held: true });
    const kept = await g.prisma.lesson.findUniqueOrThrow({ where: { id: future.json.id } });
    expect(kept).toMatchObject({ outcome: null });
    expect(await g.prisma.outboxEvent.count({ where: { idempotencyKey: { startsWith: `lesson:${kept.id}:`, endsWith: ':paused' } } })).toBe(0);
    const asTeacher = (await http(teacher.subject, 'GET', '/lessons')).json.lessons.find((l: any) => l.id === future.json.id);
    expect(asTeacher).toMatchObject({ outcome: null });
    expect(PAID_OUTCOMES).not.toContain('suspended');

    // Nothing to pay yet: "Request renewal" instead, once a day; the supervisor and Sales hear of it.
    const billing = await http(parent.subject, 'GET', '/me/billing');
    expect(billing.json.subscriptions.find((s: any) => s.child.id === child.id)).toMatchObject({
      state: 'locked', lockReasons: ['balance'], hasOpenPayment: false, renewalRequestedToday: false,
    });
    expect((await http(parent.subject, 'POST', `/me/subscriptions/${child.id}/renewal-request`)).status).toBe(201);
    expect((await http(parent.subject, 'POST', `/me/subscriptions/${child.id}/renewal-request`)).code).toBe(CommErrorCode.SUBSCRIPTION_STATE);
    expect(await cards(directId, 'subscription_renewal_requested')).toHaveLength(1);
    const queue = await http(m.salesManager.subject, 'GET', '/subscriptions/renewal-requests');
    expect(queue.json.requests.find((r: any) => r.child.id === child.id)).toMatchObject({ renewed: false });
    // PD-47 PR-4 (owner Q-F6): no push to every Sales member; the request raises its
    // renewal task for the family's one Sales owner (else the Sales manager), whose
    // assignment is the notice (task-delivery-pd047.spec.ts).
    expect(await g.prisma.notification.count({ where: { eventType: 'subscription_renewal_requested' } })).toBe(0);
    const [renewalTask] = await g.prisma.$queryRaw<Array<{ sales: string | null }>>`
      SELECT chat.sales_department_role(t.assignee_staff_id) AS sales FROM chat.work_task t
        JOIN chat.work_task_package_episode e ON e.id = t.source_id
       WHERE t.source_type = 'renewal_request' AND e.learner_id = ${child.id}::uuid AND t.state = 'open'`;
    expect(renewalTask?.sales).not.toBeNull();
    expect((await http(teacher.subject, 'POST', `/me/subscriptions/${child.id}/renewal-request`)).code).toBe(CommErrorCode.BILLING_DENIED);

    // Sales sends a renewal for 8 lessons; the parent pays it (recorded in cash): unlocked at once.
    const renewal = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'renewal', label: 'Renewal — 1 month', amountMinor: 80000, learnerId: child.id, planMonths: 1, lessonsIncluded: 8,
    });
    expect(renewal.status).toBe(201);
    expect(renewal.json.request).toMatchObject({ lessonsIncluded: 8, planMonths: 1 });
    const page = await (await fetch(renewal.json.request.link.replace(/^.*\/api\/v1/, base) + '?lang=en')).text();
    expect(page).toContain('1 month — 8 lessons');
    const paid = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, {
      method: 'cash', amountMinor: 80000, paidOn: today(), requestId: renewal.json.request.id,
    });
    expect(paid.status).toBe(201);
    expect(await access(child.id)).toMatchObject({ state: 'open', balance: 6, reasons: [] });
    expect((await send(parent.subject, groupId)).status).toBe(201);
    expect((await http(m.salesManager.subject, 'GET', '/subscriptions/renewal-requests')).json.requests.find((r: any) => r.child.id === child.id).renewed).toBe(true);

    // The next lesson continues the new subscription: 5 used, 3 + 8 bought -> "3 of 8".
    const next = await pastLesson(child.id);
    expect((await http(teacher.subject, 'GET', `/lessons/${next}`)).json).toMatchObject({ suggestedLessonNumber: 3, suggestedLessonTotal: 8 });

    await effects.sweep();
    expect(await cards(groupId, 'subscription_unlocked')).toHaveLength(1);
    expect(await access(child.id)).toMatchObject({ held: false });

    // A payment voided by mistake takes the lessons back: locked again.
    const payment = (await http(m.salesManager.subject, 'GET', `/families/${f.id}/billing`)).json.payments.find((p: any) => p.requestId === renewal.json.request.id);
    expect((await http(m.salesManager.subject, 'POST', `/payments/${payment.id}/void`, { reason: 'Entered on the wrong family' })).status).toBe(201);
    expect(await access(child.id)).toMatchObject({ state: 'locked', reasons: ['balance'] });
    const ledger = await g.prisma.learnerSubscription.findFirstOrThrow({ where: { requestId: renewal.json.request.id } });
    expect(ledger.voidedAt).not.toBeNull();
  });

  it('a lesson-package instalment overdue since go-live pauses bookings; one due before go-live, or naming no package, never does; an exception lets the child go on; paying unlocks', async () => {
    const { child, parent, groupId, f } = family();
    // Due before go-live: listed, never locks.
    await setGoLive(addDays(today(), -3));
    const old = await http(m.operationsManager.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Old balance', amountMinor: 10000, firstDueDate: addDays(today(), -10), learnerId: child.id,
    });
    expect(old.status).toBe(201);
    expect(await access(child.id)).toMatchObject({ state: 'open' });
    const list = await http(m.operationsManager.subject, 'GET', '/instalments?beforeGoLive=true');
    expect(list.json.lockFrom).toBe(addDays(today(), -3));
    expect(list.json.items.map((i: any) => i.label)).toContain('Old balance');
    expect(list.json.items.every((i: any) => i.beforeGoLive)).toBe(true);

    // Due yesterday, unpaid: locked the day after its due date.
    const plan = await http(m.operationsManager.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Term', amountMinor: 30000, firstDueDate: addDays(today(), -1), count: 3, everyMonths: 1, learnerId: child.id,
      lessonsIncluded: 24, planMonths: 3,
    });
    expect(plan.status).toBe(201);
    const due = (await g.prisma.familyInstalment.findMany({ where: { familyId: f.id, label: { startsWith: 'Term' } }, orderBy: { dueDate: 'asc' } }))[0]!;
    expect(await access(child.id)).toMatchObject({ state: 'locked', reasons: ['overdue'], overdueInstalmentId: due.id, balance: 24 });
    // The plan credited its lessons when it was created.
    expect(await g.prisma.learnerSubscription.count({ where: { learnerId: child.id, source: 'instalment_plan', voidedAt: null } })).toBe(1);
    expect(due.lessonSubscriptionId).not.toBeNull();
    expect((await send(parent.subject, groupId)).status).toBe(201); // the chat stays open
    expect((await book(child.id, 4)).code).toBe(CommErrorCode.SUBSCRIPTION_LOCKED);
    expect((await http(parent.subject, 'GET', `/conversations/${groupId}`)).json.paymentLock.children[0]).toMatchObject({
      reasons: ['overdue'], overdue: { label: due.label, dueDate: addDays(today(), -1) },
    });
    const mine = await http(parent.subject, 'GET', '/me/billing');
    expect(mine.json.subscriptions.find((s: any) => s.child.id === child.id)).toMatchObject({
      state: 'locked', lockReasons: ['overdue'], hasOpenPayment: true, current: { planMonths: 3, lessonsIncluded: 24 },
    });

    // An exception for the overdue instalment: the child goes on; the parent sees no trace of it.
    const exc = await http(m.salesManager.subject, 'POST', `/learners/${child.id}/subscription-exceptions`, {
      kind: 'overdue', reason: 'Salary arrives on the 5th', validUntil: addDays(today(), 10),
    });
    expect(exc.status).toBe(201);
    expect(exc.json.standing).toMatchObject({ state: 'open', excepted: ['overdue'] });
    expect((await book(child.id, 4)).status).toBe(201);
    const excused = (await http(parent.subject, 'GET', '/me/billing')).json.subscriptions.find((s: any) => s.child.id === child.id);
    expect(excused).toMatchObject({ state: 'open', lockReasons: [] });
    expect(JSON.stringify(excused)).not.toMatch(/except/i);
    expect((await http(m.salesManager.subject, 'POST', `/subscription-exceptions/${exc.json.exceptions[0].id}/revoke`, { reason: 'Not paid' })).status).toBe(201);
    expect(await access(child.id)).toMatchObject({ state: 'locked', reasons: ['overdue'] });

    // Paying the instalment unlocks at once.
    expect((await http(m.operationsManager.subject, 'POST', `/instalments/${due.id}/payment`, { paidOn: today(), method: 'cash' })).status).toBe(201);
    expect(await access(child.id)).toMatchObject({ state: 'open', reasons: [] });
    expect((await book(child.id, 5)).status).toBe(201);
  });

  it('D-2: an overdue instalment that names no lesson package, or a voided one, never pauses lessons', async () => {
    const { child, f } = family();
    await setGoLive(addDays(today(), -60));
    // Not a lesson package's instalment (R-4: not payable in the app either): listed, never locks.
    const loose = await http(m.operationsManager.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Loose', amountMinor: 5000, firstDueDate: addDays(today(), -5), learnerId: child.id,
    });
    expect(loose.status).toBe(201);
    // A family-wide one (no child) is not a lesson package's either.
    expect((await http(m.operationsManager.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Family-wide', amountMinor: 5000, firstDueDate: addDays(today(), -5),
    })).status).toBe(201);
    expect(await access(child.id)).toMatchObject({ state: 'open', reasons: [], overdueInstalmentId: null });
    const [{ lock }] = await g.prisma.$queryRawUnsafe<Array<{ lock: string | null }>>(`select chat.learner_lesson_lock($1::uuid) as lock`, child.id);
    expect(lock).toBeNull();
    expect((await book(child.id, 3)).status).toBe(201);
    const listed = await http(m.operationsManager.subject, 'GET', '/instalments');
    expect(listed.json.items.filter((i: any) => i.family.id === f.id).map((i: any) => i.status)).toEqual(['overdue', 'overdue']);

    // A lesson package's instalment, overdue: locks. Voiding the package (staff) takes the lock away.
    const inst = await packageInstalment(f.id, child.id, 'Package', addDays(today(), -2));
    expect(await access(child.id)).toMatchObject({ state: 'locked', reasons: ['overdue'], overdueInstalmentId: inst.id });
    expect((await book(child.id, 4)).code).toBe(CommErrorCode.SUBSCRIPTION_LOCKED);
    expect((await http(m.superAdmin.subject, 'POST', `/subscriptions/${inst.lessonSubscriptionId}/void`, { reason: 'Entered twice' })).status).toBe(201);
    expect(await access(child.id)).toMatchObject({ state: 'open', reasons: [] });

    // A row that names the child's package but no child (the R-4 trigger allows it): it locks
    // that child, matched through the package.
    const pkg = await lessonPackage(child.id);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family_instalment (family_id, learner_id, label, amount_minor, currency, due_date, created_by, lesson_subscription_id)
       values ($1::uuid, null, 'No child named', 5000, 'EGP', chat.pd030_today() - 2, $2::uuid, $3::uuid)`,
      f.id, m.operationsManager.id, pkg);
    expect(await access(child.id)).toMatchObject({ state: 'locked', reasons: ['overdue'] });
  });

  it('the sweep and a payment arriving together leave one state and one announcement', async () => {
    const { child, groupId, f } = family();
    await setGoLive(addDays(today(), -60));
    const inst = await packageInstalment(f.id, child.id, 'Race', addDays(today(), -2));
    await effects.sweep();
    expect(await access(child.id)).toMatchObject({ state: 'locked', held: true });

    const [, paid] = await Promise.all([
      effects.sweep(),
      http(m.operationsManager.subject, 'POST', `/instalments/${inst.id}/payment`, { paidOn: today(), method: 'cash' }),
      effects.sweep(),
      effects.applyEvents(),
    ]);
    expect(paid.status).toBe(201);
    await effects.sweep();
    await effects.sweep();

    expect(await access(child.id)).toMatchObject({ state: 'open', held: false });
    const events = await g.prisma.learnerAccessEvent.findMany({ where: { learnerId: child.id }, orderBy: { at: 'asc' } });
    expect(events.map((e) => `${e.fromState}>${e.toState}`)).toEqual(['open>locked', 'locked>open']);
    expect(events.every((e) => e.appliedAt !== null)).toBe(true);
    expect(await cards(groupId, 'lessons_paused')).toHaveLength(1);
    expect(await cards(groupId, 'subscription_unlocked')).toHaveLength(1);
  });

  it('holds (D-1): booked lessons go ahead, no lesson is materialized while held, the unlock materializes again without a duplicate', async () => {
    const { child, teacher, f } = family();
    const scheduling = app.get(SchedulingService);
    const stats = app.get(StatsService);
    // A regular time every day this week, starting tomorrow.
    const tz = 'Africa/Cairo';
    for (let wd = 1; wd <= 7; wd++) {
      await g.prisma.$executeRawUnsafe(
        `insert into chat.learner_schedule_slot (organization_id, learner_id, teacher_id, weekday, start_minute, duration_minutes, timezone, valid_from, created_by)
         values ($1::uuid, $2::uuid, $3::uuid, $4, 23 * 60 + 15, 30, $5, $6::date, $7::uuid)`,
        orgId, child.id, teacher.id, wd, tz, addDays(today(), 1), m.teachersManager.id,
      );
    }
    await scheduling.materialize();
    const standing = () => g.prisma.lesson.count({ where: { learnerId: child.id, outcome: null, scheduleSlotId: { not: null } } });
    const before = await standing();
    expect(before).toBeGreaterThan(14);
    // Every month the materialized lessons fall in (stats.zone) -- never "today + 31 days",
    // which skips a month on the last day(s) of one (2026-10-31 + 31 = 2026-12-01).
    const months = monthsOf((await g.prisma.lesson.findMany({ where: { learnerId: child.id }, select: { startsAt: true } })).map((l) => l.startsAt));
    const scheduled = async () => {
      let n = 0;
      for (const month of months) n += (await stats.teacher(m.teachersManager.id, teacher.id, month)).summary.totalScheduled;
      return n;
    };
    const scheduledBefore = await scheduled();

    // Locked (overdue): held. Every lesson already on the calendar stays booked (D-1).
    await setGoLive(addDays(today(), -60));
    const inst = await packageInstalment(f.id, child.id, 'Hold', addDays(today(), -1));
    await effects.sweep();
    expect(await access(child.id)).toMatchObject({ state: 'locked', held: true });
    expect(await standing()).toBe(before);
    expect(await g.prisma.lesson.count({ where: { learnerId: child.id, outcome: 'suspended' } })).toBe(0);
    expect(await scheduled()).toBe(scheduledBefore);
    // A new weekly time agreed while held: the materializer makes none of its lessons.
    await g.prisma.$executeRawUnsafe(
      `insert into chat.learner_schedule_slot (organization_id, learner_id, teacher_id, weekday, start_minute, duration_minutes, timezone, valid_from, created_by)
       values ($1::uuid, $2::uuid, $3::uuid, 1, 21 * 60, 30, $4, $5::date, $6::uuid)`,
      orgId, child.id, teacher.id, tz, addDays(today(), 1), m.teachersManager.id,
    );
    await scheduling.materialize();
    expect(await standing()).toBe(before); // nothing materialized while held
    // The Schedule still shows the next start of each booked weekly time (D-1); the new
    // time, with nothing booked, has none while held.
    const slotsHeld = await scheduling.currentSlots(child.id);
    const bookedNext = slotsHeld.filter((x: any) => x.nextStartsAt !== null);
    expect(bookedNext.length).toBe(7);
    expect(slotsHeld.find((x: any) => x.start === '21:00')?.nextStartsAt ?? null).toBeNull();

    // Paid: released and materialized again -- the new time's lessons appear, one per slot and start.
    await http(m.operationsManager.subject, 'POST', `/instalments/${inst.id}/payment`, { paidOn: today(), method: 'cash' });
    await effects.sweep();
    await scheduling.materialize();
    await effects.sweep();
    expect(await access(child.id)).toMatchObject({ state: 'open', held: false });
    expect(await standing()).toBeGreaterThan(before);
    const dupes = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `select count(*)::int as n from (select schedule_slot_id, starts_at from chat.lesson
         where learner_id = $1::uuid and outcome is null and schedule_slot_id is not null
         group by 1, 2 having count(*) > 1) d`, child.id);
    expect(dupes[0]!.n).toBe(0);
    // The Schedule shows each time once.
    const list = (await http(m.teachersManager.subject, 'GET', `/lessons?learnerId=${child.id}`)).json.lessons.filter((l: any) => l.startsAt > at(0));
    expect(list.filter((l: any) => l.suspendedFor === 'payment')).toHaveLength(0);
    expect(new Set(list.map((l: any) => l.startsAt)).size).toBe(list.length);
  });

  it('with enforcement off: the state is still computed and shown; nothing is refused or announced; holds are released', async () => {
    const { child, parent, teacher, groupId, f } = family();
    await setGoLive(addDays(today(), -60));
    const inst = await packageInstalment(f.id, child.id, 'Off', addDays(today(), -1));
    await effects.sweep();
    expect(await access(child.id)).toMatchObject({ state: 'locked', held: true });

    process.env.SUBSCRIPTION_LOCK_ENFORCED = 'false';
    try {
      await effects.sweep();
      expect(await access(child.id)).toMatchObject({ state: 'locked', held: false });
      expect((await send(parent.subject, groupId)).status).toBe(201);
      expect((await send(teacher.subject, groupId)).status).toBe(201);
      expect((await http(parent.subject, 'GET', `/conversations/${groupId}`)).json.paymentLock).toBeNull();
      expect((await http(parent.subject, 'GET', '/me/billing')).json.subscriptions.find((s: any) => s.child.id === child.id).state).toBe('locked');
      expect((await book(child.id, 3)).status).toBe(201);
      await http(m.operationsManager.subject, 'POST', `/instalments/${inst.id}/payment`, { paidOn: today(), method: 'cash' });
      await effects.sweep();
      expect(await cards(groupId, 'subscription_unlocked')).toHaveLength(0);
    } finally {
      process.env.SUBSCRIPTION_LOCK_ENFORCED = 'true';
    }
  });

  it('the database refuses free lessons and exceptions from anyone but the three roles; a 1000-lesson package backfills', async () => {
    const { child, supervisor } = family();
    // A supervisor (Operations) writing straight to the database is refused.
    expect(await sqlRefusal(
      `insert into chat.subscription_exception (learner_id, organization_id, family_id, kind, reason, valid_until, granted_by)
       select l.id, l.organization_id, l.family_id, 'both', 'direct SQL', chat.pd030_today() + 5, $2::uuid from chat.learner l where l.id = $1::uuid`,
      child.id, supervisor.id)).toMatch(/super admin, the Operations Manager or the Sales Manager/);
    expect(await sqlRefusal(
      `insert into chat.learner_subscription (learner_id, organization_id, family_id, lessons_included, starts_on, source, note, created_by)
       select l.id, l.organization_id, l.family_id, 50, chat.pd030_today(), 'staff', 'direct SQL', $2::uuid from chat.learner l where l.id = $1::uuid`,
      child.id, supervisor.id)).toMatch(/no payment is added by the super admin/);
    // A grant by the Sales Manager, revoked by a supervisor in SQL: refused.
    const granted = await http(m.salesManager.subject, 'POST', `/learners/${child.id}/subscription-exceptions`, {
      kind: 'overdue', reason: 'Salary on the 5th', validUntil: addDays(today(), 5),
    });
    expect(granted.status).toBe(201);
    expect(await sqlRefusal(
      `update chat.subscription_exception set revoked_at = now(), revoked_by = $2::uuid, revoke_reason = 'x' where id = $1::uuid`,
      granted.json.exceptions[0].id, supervisor.id)).toMatch(/revoked by the super admin/);
    // PD-15 packages run to 1000 lessons: the go-live backfill fits them.
    await g.prisma.$executeRawUnsafe(
      `insert into chat.learner_enrollment (learner_id, organization_id, package_lessons, updated_by)
       select l.id, l.organization_id, 1000, $2::uuid from chat.learner l where l.id = $1::uuid
       on conflict (learner_id) do update set package_lessons = 1000`, child.id, m.superAdmin.id);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.learner_subscription (learner_id, organization_id, family_id, plan_months, lessons_included, starts_on, source, note)
       select e.learner_id, l.organization_id, l.family_id, f.subscription_plan_months, e.package_lessons,
              chat.pd030_today(), 'backfill', 'PD-15 package size, carried over at go-live'
         from chat.learner_enrollment e join chat.learner l on l.id = e.learner_id join chat.family f on f.id = l.family_id
        where e.learner_id = $1::uuid`, child.id);
    expect(await g.prisma.learnerSubscription.count({ where: { learnerId: child.id, lessonsIncluded: 1000, source: 'backfill' } })).toBe(1);
  });

  it('a paid request credits its lessons once: a voided credit never comes back on a later update of the request', async () => {
    const { child, f } = family();
    const req = await http(m.salesManager.subject, 'POST', `/families/${f.id}/payment-requests`, {
      purpose: 'renewal', label: 'Renewal', amountMinor: 1000, learnerId: child.id, lessonsIncluded: 8,
    });
    await http(m.salesManager.subject, 'POST', `/families/${f.id}/payments`, { method: 'cash', amountMinor: 1000, paidOn: today(), requestId: req.json.request.id });
    const credit = await g.prisma.learnerSubscription.findFirstOrThrow({ where: { requestId: req.json.request.id } });
    // Staff void the credit (not the payment): the request stays paid.
    expect((await http(m.salesManager.subject, 'POST', `/subscriptions/${credit.id}/void`, { reason: 'Credited to the sibling instead' })).status).toBe(201);
    // A webhook retry or a reminder stamp touches the paid request again: nothing is credited.
    await g.prisma.$executeRawUnsafe(`update chat.payment_request set paid_at = paid_at where id = $1::uuid`, req.json.request.id);
    await g.prisma.$executeRawUnsafe(`update chat.payment_request set cancelled_at = cancelled_at where id = $1::uuid`, req.json.request.id);
    expect(await g.prisma.learnerSubscription.count({ where: { requestId: req.json.request.id, voidedAt: null } })).toBe(0);
  });

  it('fails closed: a stale or missing state row never lets a locked child be booked; a group with no child rows covers its family', async () => {
    const { child, parent, groupId, f } = family();
    await setGoLive(addDays(today(), -60));
    const lesson = await http(m.teachersManager.subject, 'POST', '/lessons', {
      learnerId: child.id, ...bookingAt(11),
    });
    expect(lesson.status).toBe(201);
    await packageInstalment(f.id, child.id, 'Stale', addDays(today(), -1));
    expect((await book(child.id, 12)).code).toBe(CommErrorCode.SUBSCRIPTION_LOCKED);
    // PD-31's move picker asks the same lock (SchedulingService.lockOf), and only while enforced.
    expect((await http(parent.subject, 'GET', `/lessons/${lesson.json.id}/move-slots`)).json).toMatchObject({ locked: 'overdue', slots: [] });
    process.env.SUBSCRIPTION_LOCK_ENFORCED = 'off';
    try {
      expect((await http(parent.subject, 'GET', `/lessons/${lesson.json.id}/move-slots`)).json.locked).toBeNull();
    } finally {
      process.env.SUBSCRIPTION_LOCK_ENFORCED = 'true';
    }
    // The worker is not running; the stored row says open (stale), then disappears.
    await g.prisma.$executeRawUnsafe(`update chat.learner_access set state = 'open', reasons = '{}' where learner_id = $1::uuid`, child.id);
    expect((await book(child.id, 12)).code).toBe(CommErrorCode.SUBSCRIPTION_LOCKED);
    await g.prisma.$executeRawUnsafe(`delete from chat.learner_access where learner_id = $1::uuid`, child.id);
    expect((await book(child.id, 12)).code).toBe(CommErrorCode.SUBSCRIPTION_LOCKED);
    const [{ lock }] = await g.prisma.$queryRawUnsafe<Array<{ lock: string | null }>>(`select chat.learner_lesson_lock($1::uuid) as lock`, child.id);
    expect(lock).toBe('overdue');
    // A request role learns only about children it may see: with no session identity, nothing.
    const asApp = await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local role chat_app`);
      return tx.$queryRawUnsafe<Array<{ lock: string | null }>>(`select chat.learner_lesson_lock($1::uuid) as lock`, child.id);
    });
    expect(asApp[0]?.lock ?? null).toBeNull();
    // A family group whose child rows are missing (legacy data): it covers every child of its family.
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRawUnsafe(`delete from chat.conversation_learner where conversation_id = $1::uuid`, groupId);
    });
    expect(await g.prisma.conversationLearner.count({ where: { conversationId: groupId } })).toBe(0);
    expect((await send(parent.subject, groupId)).status).toBe(201); // the chat stays open
    expect((await http(parent.subject, 'GET', `/conversations/${groupId}`)).json.paymentLock.children.map((c: any) => c.id)).toContain(child.id);
  });

  it('financial cards reach only the family\'s chat with its supervisor -- never a legacy teacher-parent direct', async () => {
    const { child, teacher, parent, directId, f } = family();
    // A PD-6 era teacher<->parent direct of this family, more recently active (a fixture of legacy data).
    const legacy = randomUUID();
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRawUnsafe(
        `insert into chat.conversation (id, organization_id, type, family_id, direct_key, last_activity_at)
         values ($1::uuid, $2::uuid, 'direct', $3::uuid, 'legacy-pd6:' || $1, now() + interval '1 day')`,
        legacy, orgId, f.id);
      await tx.$executeRawUnsafe(
        `insert into chat.conversation_member (conversation_id, actor_id, actor_kind, member_role)
         values ($1::uuid, $2::uuid, 'teacher', 'teacher'), ($1::uuid, $3::uuid, 'contact', 'parent')`,
        legacy, teacher.id, parent.id);
    });
    await addSubscription(child.id, 1);
    for (let i = 0; i < 3; i++) await report(teacher.subject, await pastLesson(child.id));
    await effects.applyEvents();
    expect(await cards(legacy, 'subscription_grace')).toHaveLength(0);
    expect(await cards(legacy, 'subscription_locked')).toHaveLength(0);
    expect((await cards(directId, 'subscription_locked')).length).toBe(1);
    // The supervisor is pushed as well as the parents.
    expect(await g.prisma.notification.count({ where: { eventType: 'subscription_locked', familyId: f.id, recipientId: m.families.find((x) => x.id === f.id)!.children.find((c) => c.id === child.id)!.supervisorId } })).toBe(1);
  });

  it('while locked (D-1, D-3): booked lessons go ahead, both chats work, calls ring and are answered, the teacher learns nothing financial, the parent the reason', async () => {
    const { f, child, teacher, supervisor, parent, groupId, directId } = family();
    // Booked BEFORE the lock: one already held (to be reported), one ahead.
    const held = await pastLesson(child.id);
    const booked = await http(m.teachersManager.subject, 'POST', '/lessons', { learnerId: child.id, ...bookingAt(10) });
    expect(booked.status).toBe(201);
    const aheadBefore = await g.prisma.lesson.findUniqueOrThrow({ where: { id: booked.json.id } });

    await setGoLive(addDays(today(), -60));
    await packageInstalment(f.id, child.id, 'Term · 2/3', addDays(today(), -2));
    await effects.sweep();
    await effects.sweep(); // the second pass holds the materializer
    expect(await access(child.id)).toMatchObject({ state: 'locked', reasons: ['overdue'], held: true });

    // 1. Lessons already booked are unchanged and go ahead: the teacher reports the held one.
    expect(await g.prisma.lesson.findUniqueOrThrow({ where: { id: booked.json.id } })).toMatchObject({
      outcome: null, startsAt: aheadBefore.startsAt, endsAt: aheadBefore.endsAt, teacherId: aheadBefore.teacherId,
    });
    await report(teacher.subject, held);
    expect((await g.prisma.lesson.findUniqueOrThrow({ where: { id: held } })).outcome).not.toBeNull();
    // Only a NEW booking is refused.
    expect((await book(child.id, 4)).code).toBe(CommErrorCode.SUBSCRIPTION_LOCKED);

    // 2. The parent-teacher group and the parent-supervisor chat work both ways.
    for (const who of [parent, teacher, supervisor]) expect((await send(who.subject, groupId)).status).toBe(201);
    expect((await send(parent.subject, directId)).status).toBe(201);
    expect((await send(supervisor.subject, directId)).status).toBe(201);
    for (const who of [parent, teacher]) {
      expect((await http(who.subject, 'GET', `/conversations/${groupId}/messages`)).status).toBe(200);
    }
    expect((await http(parent.subject, 'GET', `/conversations/${directId}/messages`)).status).toBe(200);

    // 3. Calls are started AND received: the callee is rung (call.incoming, a participant
    //    row) and answers, and gets a media token -- each way round.
    for (const [caller, callee] of [[parent, teacher], [teacher, parent]] as const) {
      const started = await http(caller.subject, 'POST', '/calls', { conversationId: groupId });
      expect(started.status).toBe(201);
      const callId: string = started.json.callId;
      expect(await g.prisma.callParticipant.findFirst({ where: { callId, actorId: callee.id } })).not.toBeNull();
      const rung = await g.prisma.outboxEvent.findMany({ where: { type: 'call.incoming' } });
      expect(rung.some((e) => (e.payload as { callId?: string }).callId === callId)).toBe(true);
      expect((await http(callee.subject, 'POST', `/calls/${callId}/accept`)).status).toBeLessThan(300);
      expect((await http(callee.subject, 'POST', `/calls/${callId}/token`)).status).toBeLessThan(300);
      expect((await http(caller.subject, 'POST', `/calls/${callId}/token`)).status).toBeLessThan(300);
      expect((await g.prisma.call.findUniqueOrThrow({ where: { id: callId } })).status).toBe('active');
      expect((await http(caller.subject, 'POST', `/calls/${callId}/end`)).status).toBeLessThan(300);
    }

    // 4. The teacher: no reason, no amount, no pay flag, no financial card, no push.
    const asTeacher = await http(teacher.subject, 'GET', `/conversations/${groupId}`);
    expect(asTeacher.json.paymentLock).toEqual({ readOnly: false, canPay: false, children: [{ id: child.id, name: child.name }] });
    // `5000` as a whole number only: a random UUID can contain the digits (d0ce5000-...), which made this flaky.
    const financial = /overdue|instalment|used up|Subscriptions|Term · 2\/3|(?<![0-9a-f-])5000(?![0-9a-f-])|متأخر|القسط|انتهت|الاشتراكات/i;
    const teacherThread = (await http(teacher.subject, 'GET', `/conversations/${groupId}/messages`)).json;
    expect(JSON.stringify(teacherThread)).not.toMatch(financial);
    expect((await http(teacher.subject, 'GET', `/conversations/${directId}`)).status).toBeGreaterThanOrEqual(400);
    expect(await g.prisma.notification.count({ where: { recipientId: teacher.id, eventType: { startsWith: 'subscription_' } } })).toBe(0);

    // 5. The parent: the reason, the instalment, and the way to pay.
    const asParent = await http(parent.subject, 'GET', `/conversations/${groupId}`);
    expect(asParent.json.paymentLock).toMatchObject({
      readOnly: false, canPay: true,
      children: [{ id: child.id, name: child.name, reasons: ['overdue'], overdue: { label: 'Term · 2/3' } }],
    });
    const pushed = await g.prisma.notification.findFirstOrThrow({ where: { recipientId: parent.id, eventType: 'subscription_locked', familyId: f.id } });
    expect(String((pushed.variables as Record<string, unknown>).reason)).toMatch(/overdue|متأخر/);
  });

  it('switching enforcement on: go-live recorded once, every child already in grace or locked is told, holds start on the next pass', async () => {
    const { child, teacher, groupId, directId } = family();
    process.env.SUBSCRIPTION_LOCK_ENFORCED = 'false';
    let futureId = '';
    try {
      await g.prisma.$executeRawUnsafe(`delete from chat.config where key in ('subscription.enforced_since', 'subscription.announced_at', 'subscription.overdue_from')`);
      await addSubscription(child.id, 1);
      const future = await http(m.teachersManager.subject, 'POST', '/lessons', {
        learnerId: child.id, ...bookingAt(9),
      });
      expect(future.status).toBe(201);
      futureId = future.json.id;
      for (let i = 0; i < 3; i++) await report(teacher.subject, await pastLesson(child.id));
      await effects.sweep();
      expect(await access(child.id)).toMatchObject({ state: 'locked', held: false });
      expect(await cards(groupId, 'lessons_paused')).toHaveLength(0); // nothing announced while off
    } finally {
      process.env.SUBSCRIPTION_LOCK_ENFORCED = 'TRUE'; // any case
    }
    // First pass with it on: go-live = today, the announcements, no hold yet.
    await effects.sweep();
    const keys = await g.prisma.config.findMany({ where: { key: { in: ['subscription.enforced_since', 'subscription.announced_at', 'subscription.overdue_from'] } } });
    expect(keys.map((k) => k.key).sort()).toEqual(['subscription.announced_at', 'subscription.enforced_since', 'subscription.overdue_from']);
    expect(keys.find((k) => k.key === 'subscription.overdue_from')!.value).toBe(today());
    expect(await cards(groupId, 'lessons_paused')).toHaveLength(1);
    expect(await cards(directId, 'subscription_locked')).toHaveLength(1);
    expect(await access(child.id)).toMatchObject({ held: false });
    expect(await g.prisma.lesson.findUniqueOrThrow({ where: { id: futureId } })).toMatchObject({ outcome: null });
    // The next pass holds (the materializer only: the booked lesson goes ahead, D-1);
    // a third changes nothing and announces nothing again.
    await effects.sweep();
    expect(await access(child.id)).toMatchObject({ held: true });
    expect(await g.prisma.lesson.findUniqueOrThrow({ where: { id: futureId } })).toMatchObject({ outcome: null });
    await effects.sweep();
    expect(await cards(groupId, 'lessons_paused')).toHaveLength(1);
  });
  it('D-3 (owner, 2026-11-06): the pushes say only NEW lessons pause, in Arabic and English; rollback and re-apply', async () => {
    const templates = new TemplateService(g.prisma);
    const render = (key: string, locale: 'ar' | 'en', variables: Record<string, string>) =>
      templates.render(key, locale, variables);
    expect(await render('subscription_locked', 'en', { learner: 'Adam', reason: 'an instalment is overdue' })).toEqual({
      title: 'Jawwid',
      body: 'New lessons for Adam are paused: an instalment is overdue. Booked lessons go ahead. Renew in Subscriptions.',
    });
    expect(await render('subscription_locked', 'ar', { learner: 'آدم', reason: 'قسط متأخر' })).toEqual({
      title: 'جَوِّد',
      body: 'توقّف حجز حصص جديدة لـآدم: قسط متأخر. الحصص المحجوزة تُقام في موعدها. جدّدوا الاشتراك من «الاشتراكات».',
    });
    expect(await render('subscription_unlocked', 'en', { learner: 'Adam' }))
      .toEqual({ title: 'Jawwid', body: 'New lessons for Adam are back on the schedule. Thank you.' });
    expect(await render('subscription_unlocked', 'ar', { learner: 'آدم' }))
      .toEqual({ title: 'جَوِّد', body: 'عادت الحصص الجديدة لـآدم إلى الجدول. شكرًا لكم.' });

    // The rollback brings back version 1 (the PD-30 texts); applying the migration again
    // restores version 2. Both run here from the files themselves, as an operator would.
    const VERSION = '20261106170000_chat_pd030_d3_push_wording';
    const root = join(__dirname, '../../../..');
    const run = async (file: string) => {
      const statements = readFileSync(join(root, file), 'utf8')
        .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
        .split(/;\s*(?:\n|$)/).map((x) => x.trim()).filter(Boolean);
      await g.prisma.$transaction(async (tx) => {
        for (const sql of statements) await tx.$executeRawUnsafe(sql);
      });
    };
    const ledger = () => g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM chat.schema_migrations WHERE version = ${VERSION}`;
    expect(Number((await ledger())[0]!.n)).toBe(1);
    try {
      await run(`db/rollback/${VERSION}.down.sql`);
      expect(Number((await ledger())[0]!.n)).toBe(0);
      expect((await render('subscription_locked', 'en', { learner: 'Adam', reason: 'an instalment is overdue' }))!.body)
        .toBe("Adam's lessons are paused: an instalment is overdue. Renew in Subscriptions.");
      expect((await render('subscription_unlocked', 'ar', { learner: 'آدم' }))!.body).toBe('عادت حصص آدم. شكرًا لكم.');
    } finally {
      await run(`supabase/migrations/${VERSION}.sql`);
      await g.prisma.$executeRawUnsafe(`INSERT INTO chat.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`, VERSION);
    }
    expect(Number((await ledger())[0]!.n)).toBe(1);
    expect((await render('subscription_locked', 'ar', { learner: 'آدم', reason: 'قسط متأخر' }))!.body)
      .toBe('توقّف حجز حصص جديدة لـآدم: قسط متأخر. الحصص المحجوزة تُقام في موعدها. جدّدوا الاشتراك من «الاشتراكات».');
    expect((await render('subscription_unlocked', 'en', { learner: 'Adam' }))!.body).toBe('New lessons for Adam are back on the schedule. Thank you.');
    // Applying it twice changes nothing (one row per key, locale and version).
    await run(`supabase/migrations/${VERSION}.sql`);
    expect(await g.prisma.notificationTemplate.count({ where: { key: { in: ['subscription_locked', 'subscription_unlocked'] }, version: 2 } })).toBe(4);
  });
});
