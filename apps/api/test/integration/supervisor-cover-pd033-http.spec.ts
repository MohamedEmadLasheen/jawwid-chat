/**
 * PD-33 over real HTTP: real logins, the global bearer guard, the real routes.
 *
 *   1. the supervisor's own "I'm away": GET /me/cover, the preview (counts,
 *      the linked backup first), POST /org/covers, Extend, End now
 *   2. who: a colleague, another department's manager and the backup cannot
 *      start one; the backup can end the one they hold; status codes
 *   3. the parent's view: GET /conversations and /conversations/:id carry the
 *      cover line during the cover and null after; the backup's list holds the
 *      covered chats; the system line is in the parent's message page
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
import { OrgStructureModule } from '../../src/org/org-structure.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd33-http-spec-password-1';
const DOMAIN = 'pd33http.qa.jawwid.test';
const HOUR = 3_600_000;

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

const tokens = new Map<string, string>();
async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return tokens.get(subject)!;
}

async function http(subject: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {};
  if (subject) headers.authorization = `Bearer ${await tokenFor(subject)}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & Record<string, any>;
  return { status: r.status, code: json.error?.code, json };
}

const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd33h-%'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd33h-${orgId.slice(0, 8)}', 'PD-33 HTTP QA academy')`,
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
    imports: [PlatformModule, AuthModule, CommunicationModule, OrgStructureModule],
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
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd33h-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

afterEach(async () => {
  for (const c of await g.prisma.supervisorCover.findMany({ where: { endedAt: null } })) {
    await http(`owner@${DOMAIN}`, 'POST', `/org/covers/${c.id}/end`);
  }
});

const primary = () => m.supervisors[0]!;
const backup = () => m.backups.find((b) => b.covers.includes(primary().id))!;

describe('1. "I\'m away": the supervisor hands over in one step', () => {
  it('GET /me/cover, the preview, start, extend, end', async () => {
    const me = await http(primary().subject, 'GET', '/me/cover');
    expect(me.status).toBe(200);
    expect(me.json).toEqual({ canHandOver: true, away: null, covering: [] });

    const preview = await http(primary().subject, 'GET', `/org/covers/preview?supervisorId=${primary().id}`);
    expect(preview.status).toBe(200);
    expect(preview.json.backup).toEqual({ id: backup().id, name: backup().name });
    expect(preview.json.eligibleBackups[0]).toMatchObject({ id: backup().id, linked: true, blockedReason: null });
    expect(preview.json.counts.families).toBeGreaterThan(0);
    expect(preview.json.counts.groups).toBeGreaterThan(0);
    expect(preview.json.maxDays).toBe(30);

    const started = await http(primary().subject, 'POST', '/org/covers', { supervisorId: primary().id, until: inHours(48), note: 'family matter' });
    expect(started.status).toBe(201);
    expect(started.json).toMatchObject({ status: 'active', backup: { id: backup().id }, canExtend: true, canEnd: true, note: 'family matter' });

    const away = await http(primary().subject, 'GET', '/me/cover');
    expect(away.json.away.id).toBe(started.json.id);
    const covering = await http(backup().subject, 'GET', '/me/cover');
    expect(covering.json).toMatchObject({ canHandOver: false, away: null });
    expect(covering.json.covering.map((c: { id: string }) => c.id)).toEqual([started.json.id]);
    expect(covering.json.covering[0]).toMatchObject({ canExtend: false, canEnd: true });

    const again = await http(primary().subject, 'POST', '/org/covers', { supervisorId: primary().id, until: inHours(5) });
    expect({ status: again.status, code: again.code }).toEqual({ status: 409, code: CommErrorCode.ORG_STRUCTURE_INVALID });

    const extended = await http(primary().subject, 'POST', `/org/covers/${started.json.id}/extend`);
    expect(extended.status).toBe(201);
    expect(new Date(extended.json.endsAt).getTime() - new Date(started.json.endsAt).getTime()).toBeGreaterThan(47 * HOUR);

    const ended = await http(backup().subject, 'POST', `/org/covers/${started.json.id}/end`);
    expect(ended.status).toBe(201);
    expect(ended.json).toMatchObject({ status: 'ended', endKind: 'ended_early' });
  });

  it('the Operations Manager sees the department\'s covers; a supervisor only their own', async () => {
    const c = await http(m.operationsManager.subject, 'POST', '/org/covers', { supervisorId: primary().id, until: inHours(5) });
    expect(c.status).toBe(201);
    const mgr = await http(m.operationsManager.subject, 'GET', '/org/covers?active=true');
    expect(mgr.json.covers.map((x: { id: string }) => x.id)).toContain(c.json.id);
    const colleague = await http(m.supervisors[1]!.subject, 'GET', '/org/covers?active=true');
    expect(colleague.json.covers).toEqual([]);
  });
});

describe('2. who may', () => {
  it('a colleague, the Teachers manager, the backup and a parent cannot start one; validation is 400', async () => {
    const body = { supervisorId: primary().id, until: inHours(5) };
    for (const who of [m.supervisors[1]!.subject, m.teachersManager.subject, backup().subject]) {
      const r = await http(who, 'POST', '/org/covers', body);
      expect({ who, status: r.status, code: r.code }).toEqual({ who, status: 403, code: CommErrorCode.ORG_STRUCTURE_DENIED });
    }
    const parent = await http(m.families[0]!.parent.subject, 'POST', '/org/covers', body);
    expect(parent.status).toBe(403);
    const noUntil = await http(primary().subject, 'POST', '/org/covers', { supervisorId: primary().id });
    expect({ status: noUntil.status, code: noUntil.code }).toEqual({ status: 400, code: CommErrorCode.VALIDATION });
    const tooLong = await http(primary().subject, 'POST', '/org/covers', { supervisorId: primary().id, until: inHours(31 * 24) });
    expect(tooLong.status).toBe(400);
    const unauthenticated = await http(null, 'GET', '/me/cover');
    expect(unauthenticated.status).toBe(401);
    expect(await g.prisma.supervisorCover.count({ where: { endedAt: null } })).toBe(0);
  });
});

describe('3. what the parent and the backup see', () => {
  it('the cover line on the parent\'s chats during the cover, null after; the system line in the messages', async () => {
    const fam = m.families.find((f) => f.groups.some((x) => x.supervisorId === primary().id) && f.directs.some((d) => d.supervisorId === primary().id))!;
    const group = fam.groups.find((x) => x.supervisorId === primary().id)!.conversationId;
    const direct = fam.directs.find((d) => d.supervisorId === primary().id)!.conversationId;
    const c = await http(primary().subject, 'POST', '/org/covers', { supervisorId: primary().id, until: inHours(30) });
    expect(c.status).toBe(201);

    const list = await http(fam.parent.subject, 'GET', '/conversations');
    const row = (id: string) => list.json.conversations.find((x: { id: string }) => x.id === id);
    const line = { supervisorId: primary().id, supervisorName: primary().name, coverId: backup().id, coverName: backup().name, until: c.json.endsAt };
    expect(row(group).cover).toEqual(line);
    expect(row(direct).cover).toEqual(line);
    const detail = await http(fam.parent.subject, 'GET', `/conversations/${group}`);
    expect(detail.json.cover).toEqual(line);

    const msgs = await http(fam.parent.subject, 'GET', `/conversations/${group}/messages`);
    const events = (msgs.json.messages ?? msgs.json.items ?? msgs.json).filter?.((x: { type: string }) => x.type === 'system') ?? [];
    expect(events.map((x: { systemEvent: { kind: string } }) => x.systemEvent.kind)).toContain('cover.started');

    const backupList = await http(backup().subject, 'GET', '/conversations');
    const ids = new Set(backupList.json.conversations.map((x: { id: string }) => x.id));
    expect(ids.has(group) && ids.has(direct)).toBe(true);

    await http(primary().subject, 'POST', `/org/covers/${c.json.id}/end`);
    const after = await http(fam.parent.subject, 'GET', `/conversations/${group}`);
    expect(after.json.cover).toBeNull();
    const backupAfter = await http(backup().subject, 'GET', '/conversations');
    expect(backupAfter.json.conversations.some((x: { id: string }) => x.id === group)).toBe(false);
  });
});
