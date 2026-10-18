/**
 * PD-11 T1 over real HTTP, on the PD-8 organization seed: real logins, the global
 * bearer guard, the real routes -- and the families as PD-8 actually serves them,
 * through supervisor-created FAMILY groups rather than per-child student groups.
 *
 * What it proves that lessons-pd011.spec.ts cannot: the routes exist and are
 * guarded, a card reaches a family group and is read back through the ordinary
 * message route, and a teacher of a sibling in the same family group can neither
 * see nor close a lesson that is not theirs.
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
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd11-lessons-spec-password-1';
const DOMAIN = 'pd11lessons.qa.jawwid.test';
const MIN = 60_000;

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

/** A family group with two children taught by two different teachers. */
let fam: {
  groupId: string;
  parent: string;
  child: { id: string; teacherId: string };
  teacher: string;
  siblingTeacher: string;
};
let tsup: string;

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

const at = (ms: number) => new Date(Date.now() + ms).toISOString();

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd11-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd11-${orgId.slice(0, 8)}', 'PD-11 QA academy')`,
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

  const subjectOfTeacher = new Map(m.teachers.map((t) => [t.id, t.subject]));
  const family = m.families.find((f) =>
    f.groups.some((gr) => new Set(f.children.filter((c) => gr.learnerIds.includes(c.id)).map((c) => c.teacherId)).size >= 2),
  )!;
  expect(family).toBeDefined();
  const group = family.groups.find((gr) => new Set(family.children.filter((c) => gr.learnerIds.includes(c.id)).map((c) => c.teacherId)).size >= 2)!;
  const kids = family.children.filter((c) => group.learnerIds.includes(c.id));
  const child = kids[0];
  const sibling = kids.find((k) => k.teacherId !== child.teacherId)!;
  fam = {
    groupId: group.conversationId,
    parent: family.parent.subject,
    child: { id: child.id, teacherId: child.teacherId },
    teacher: subjectOfTeacher.get(child.teacherId)!,
    siblingTeacher: subjectOfTeacher.get(sibling.teacherId)!,
  };
  tsup = m.teacherSupervisors[0].subject;

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule],
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
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd11-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

async function schedule(startMs: number): Promise<string> {
  const r = await http(tsup, 'POST', '/lessons', { learnerId: fam.child.id, startsAt: at(startMs), endsAt: at(startMs + 30 * MIN) });
  expect(r.status).toBe(201);
  return r.json.id as string;
}

describe('lesson tickets over HTTP, in a PD-8 family group', () => {
  it('every route is behind the bearer guard', async () => {
    expect((await http(null, 'GET', '/lessons')).status).toBe(401);
    expect((await http(null, 'POST', `/lessons/${randomUUID()}/report`, { covered: 'x' })).status).toBe(401);
  });

  it('a Teachers supervisor schedules; the teacher reports; the family reads the card in their family group', async () => {
    const id = await schedule(-10 * MIN);

    const offered = await http(fam.teacher, 'GET', `/conversations/${fam.groupId}/lesson-tickets`);
    expect(offered.status).toBe(200);
    expect((offered.json.tickets as Array<{ ticket: string; lessonId: string }>).filter((t) => t.lessonId === id).map((t) => t.ticket).sort())
      .toEqual(['absence', 'report']);

    const r = await http(fam.teacher, 'POST', `/lessons/${id}/report`, { covered: 'Al-Mulk 1-15', rating: 5 });
    expect(r.status).toBe(201);
    expect(r.json.outcome).toBe('held');

    const page = await http(fam.parent, 'GET', `/conversations/${fam.groupId}/messages`);
    expect(page.status).toBe(200);
    const cards = (page.json.messages as Array<{ type: string; moderation: string; card: { kind: string; lessonId: string; payload: Record<string, unknown> } | null }>)
      .filter((x) => x.type === 'card' && x.card?.lessonId === id);
    expect(cards).toHaveLength(1);
    expect(cards[0].moderation).toBe('published');
    expect(cards[0].card?.payload.covered).toBe('Al-Mulk 1-15');
  });

  it('the teacher of a sibling in the same family group neither sees nor closes the lesson', async () => {
    const id = await schedule(-50 * MIN);
    const offered = await http(fam.siblingTeacher, 'GET', `/conversations/${fam.groupId}/lesson-tickets`);
    expect((offered.json.tickets as Array<{ lessonId: string }>).some((t) => t.lessonId === id)).toBe(false);
    expect((await http(fam.siblingTeacher, 'GET', `/lessons/${id}`)).code).toBe(CommErrorCode.LESSON_NOT_FOUND);
    const r = await http(fam.siblingTeacher, 'POST', `/lessons/${id}/report`, { covered: 'not mine' });
    expect(r.status).toBe(404);
    expect(r.code).toBe(CommErrorCode.LESSON_NOT_FOUND);
  });

  it('the parent is offered an apology for an upcoming lesson, and may not write a report', async () => {
    const id = await schedule(3 * 60 * MIN);
    const offered = await http(fam.parent, 'GET', `/conversations/${fam.groupId}/lesson-tickets`);
    expect((offered.json.tickets as Array<{ ticket: string; lessonId: string }>).filter((t) => t.lessonId === id).map((t) => t.ticket))
      .toEqual(['apology']);
    const denied = await http(fam.parent, 'POST', `/lessons/${id}/report`, { covered: 'x' });
    expect(denied.status).toBe(403);
    expect(denied.code).toBe(CommErrorCode.LESSON_DENIED);
    const ok = await http(fam.parent, 'POST', `/lessons/${id}/apology`, { reason: 'travel' });
    expect(ok.status).toBe(201);
    expect(ok.json.outcome).toBe('student_apology');
  });

  it('the needs-action queue is the Teachers department\'s; a client cannot send a card', async () => {
    expect((await http(fam.teacher, 'GET', '/lessons/needs-action')).status).toBe(403);
    expect((await http(tsup, 'GET', '/lessons/needs-action')).status).toBe(200);
    const forged = await http(fam.parent, 'POST', `/conversations/${fam.groupId}/messages`, {
      type: 'card', body: 'forged', clientMessageId: randomUUID(),
    });
    expect(forged.status).toBe(400);
  });
});
