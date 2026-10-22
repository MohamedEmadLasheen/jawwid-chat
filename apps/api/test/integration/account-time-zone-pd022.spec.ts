/**
 * PD-22 over real HTTP, on the PD-8 organization seed: each person's time zone.
 *
 *   - the phone reports its OS zone; it is kept while "Set automatically" is on
 *   - a manual choice wins over every later device report, on any device
 *   - teachers follow their phone like everyone else (owner decision 2026-10-22)
 *   - a lesson reminder says the time in the RECIPIENT's zone, worked out at send
 *   - quiet hours are the recipient's own night, not Cairo's
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
import { NotificationService } from '@communication/notifications/notification.service';
import type { PushProvider } from '@communication/notifications/push.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd22-time-zone-spec-password-1';
const DOMAIN = 'pd22tz.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
let parent: { id: string; subject: string };
let teacher: { id: string; subject: string };

const tokens = new Map<string, string>();
async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return tokens.get(subject)!;
}

async function http(subject: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {};
  if (subject) headers.authorization = `Bearer ${await tokenFor(subject)}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  return { status: r.status, code: json.error?.code, json };
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd22-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd22-${orgId.slice(0, 8)}', 'PD-22 QA academy')`,
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
  });
  const family = m.families[0]!;
  parent = { id: family.parent.id, subject: family.parent.subject };
  teacher = { id: m.teachers[0]!.id, subject: m.teachers[0]!.subject };

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await g.prisma.quietHours.deleteMany({ where: { actorId: { in: [parent?.id, teacher?.id].filter(Boolean) as string[] } } });
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd22-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('PD-22 /me/time-zone', () => {
  it('is refused without a session', async () => {
    expect((await http(null, 'GET', '/me/time-zone')).status).toBe(401);
    expect((await http(null, 'POST', '/me/time-zone/device', { timeZone: 'Asia/Kuwait' })).status).toBe(401);
  });

  it('starts unknown and automatic, then follows the phone as it travels', async () => {
    expect((await http(parent.subject, 'GET', '/me/time-zone')).json).toEqual({ timeZone: null, automatic: true, updatedAt: null });

    const kuwait = await http(parent.subject, 'POST', '/me/time-zone/device', { timeZone: 'Asia/Kuwait' });
    expect(kuwait.status).toBe(201);
    expect(kuwait.json).toMatchObject({ timeZone: 'Asia/Kuwait', automatic: true });

    // Landed in Cairo: the next launch reports the new zone, with no action.
    const cairo = await http(parent.subject, 'POST', '/me/time-zone/device', { timeZone: 'Africa/Cairo' });
    expect(cairo.json).toMatchObject({ timeZone: 'Africa/Cairo', automatic: true });
  });

  it('refuses what is not an IANA zone, and stores nothing', async () => {
    for (const bad of ['+03:00', 'Mars/Olympus', '', 7]) {
      const r = await http(parent.subject, 'POST', '/me/time-zone/device', { timeZone: bad });
      expect(r.status).toBe(400);
      expect(r.code).toBe('COMMON.VALIDATION');
    }
    expect((await http(parent.subject, 'PUT', '/me/time-zone', { automatic: 'yes', timeZone: 'Asia/Kuwait' })).status).toBe(400);
    expect((await http(parent.subject, 'GET', '/me/time-zone')).json).toMatchObject({ timeZone: 'Africa/Cairo' });
  });

  it('a manual choice wins over later device reports until automatic is turned back on', async () => {
    const pinned = await http(parent.subject, 'PUT', '/me/time-zone', { automatic: false, timeZone: 'Asia/Kuwait' });
    expect(pinned.status).toBe(200);
    expect(pinned.json).toMatchObject({ timeZone: 'Asia/Kuwait', automatic: false });

    // Another phone of the same parent, set to Dubai, reports: the choice stands
    // and is handed back so that phone adopts it.
    const ignored = await http(parent.subject, 'POST', '/me/time-zone/device', { timeZone: 'Asia/Dubai' });
    expect(ignored.json).toMatchObject({ timeZone: 'Asia/Kuwait', automatic: false });

    const back = await http(parent.subject, 'PUT', '/me/time-zone', { automatic: true, timeZone: 'Asia/Dubai' });
    expect(back.json).toMatchObject({ timeZone: 'Asia/Dubai', automatic: true });
    expect((await http(parent.subject, 'POST', '/me/time-zone/device', { timeZone: 'Asia/Riyadh' })).json)
      .toMatchObject({ timeZone: 'Asia/Riyadh', automatic: true });
  });

  it('a teacher follows their phone like everyone else', async () => {
    const r = await http(teacher.subject, 'POST', '/me/time-zone/device', { timeZone: 'Asia/Riyadh' });
    expect(r.json).toMatchObject({ timeZone: 'Asia/Riyadh', automatic: true });
  });

  it('each person writes only their own row', async () => {
    const rows = await g.prisma.actorTimeZone.findMany({ where: { actorId: { in: [parent.id, teacher.id] } } });
    expect(new Map(rows.map((r) => [r.actorId, r.timeZone]))).toEqual(
      new Map([[parent.id, 'Asia/Riyadh'], [teacher.id, 'Asia/Riyadh']]),
    );
    expect(rows.every((r) => r.organizationId === orgId)).toBe(true);
  });
});

describe('PD-22 reminders and quiet hours in the recipient\'s zone', () => {
  const sent: Array<{ token: string; body: string }> = [];
  const push: PushProvider = {
    send: async (msg) => {
      sent.push({ token: msg.token, body: msg.body });
      return { ok: true };
    },
  } as PushProvider;
  let notifications: NotificationService;

  beforeAll(async () => {
    notifications = new NotificationService(g.prisma, g.templates, g.quietHours, g.config, push);
    await g.prisma.deviceToken.createMany({
      data: [
        { organizationId: orgId, actorId: parent.id, token: `pd22-parent-${orgId}`, platform: 'ios' },
        { organizationId: orgId, actorId: teacher.id, token: `pd22-teacher-${orgId}`, platform: 'android' },
      ],
    });
  });

  afterAll(async () => {
    await g.prisma.deviceToken.deleteMany({ where: { token: { startsWith: 'pd22-' } } });
  });

  async function deliverReminder(recipientId: string, startsAt: Date, locale: 'en' | 'ar') {
    sent.length = 0;
    await notifications.schedule({
      dedupeKey: `pd22:${randomUUID()}:${recipientId}`,
      templateKey: 'lesson_reminder_soon',
      eventType: 'lesson_scheduled',
      recipientId,
      locale,
      variables: { startsAt: startsAt.toISOString() },
      scheduledAt: new Date(Date.now() - 1000),
      respectQuietHours: false,
    });
    await notifications.dispatchDue(new Date());
    return sent.map((s) => s.body);
  }

  it('says the lesson time in the recipient\'s own zone, at send time', async () => {
    // 15:00 UTC in December: 17:00 Cairo, 18:00 Riyadh.
    const startsAt = new Date('2026-12-10T15:00:00Z');
    await g.prisma.actorTimeZone.update({ where: { actorId: parent.id }, data: { timeZone: 'Asia/Riyadh' } });
    await g.prisma.actorTimeZone.update({ where: { actorId: teacher.id }, data: { timeZone: 'Africa/Cairo' } });
    expect(await deliverReminder(parent.id, startsAt, 'en')).toEqual(['A lesson starts in 30 minutes, at 18:00.']);
    expect(await deliverReminder(teacher.id, startsAt, 'en')).toEqual(['A lesson starts in 30 minutes, at 17:00.']);

    // The parent flew to London since: the next reminder is in London time.
    await g.prisma.actorTimeZone.update({ where: { actorId: parent.id }, data: { timeZone: 'Europe/London' } });
    expect(await deliverReminder(parent.id, startsAt, 'en')).toEqual(['A lesson starts in 30 minutes, at 15:00.']);
  });

  it('someone whose phone never reported a zone is told the academy\'s time, named', async () => {
    const other = m.families[1]!.parent.id;
    await g.prisma.deviceToken.create({ data: { organizationId: orgId, actorId: other, token: `pd22-other-${orgId}`, platform: 'ios' } });
    const body = await deliverReminder(other, new Date('2026-12-10T15:00:00Z'), 'en');
    expect(body).toEqual(['A lesson starts in 30 minutes, at 17:00 (Cairo time).']);
  });

  it('quiet hours are the recipient\'s own night', async () => {
    // quiet_hours still carries the Cairo default; the parent is in Kuwait.
    await g.prisma.actorTimeZone.update({ where: { actorId: parent.id }, data: { timeZone: 'Asia/Kuwait' } });
    await g.prisma.quietHours.create({ data: { organizationId: orgId, actorId: parent.id, timezone: 'Africa/Cairo', startMinute: 22 * 60, endMinute: 8 * 60 } });
    // 19:30 UTC in December: 22:30 in Kuwait (quiet), 21:30 in Cairo (not).
    const adjusted = await g.quietHours.adjust(parent.id, new Date('2026-12-10T19:30:00Z'), true);
    expect(adjusted.toISOString()).toBe('2026-12-11T05:00:00.000Z'); // 08:00 Kuwait
  });
});
