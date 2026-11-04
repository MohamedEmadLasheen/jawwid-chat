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

  it('lesson-tickets is refused (403) to someone who may not read the conversation, like every conversation route; a member gets 200', async () => {
    const outsider = m.families.find((f) => f.parent.subject !== fam.parent)!.parent.subject;
    const path = `/conversations/${fam.groupId}/lesson-tickets`;
    const refused = await http(outsider, 'GET', path);
    expect({ status: refused.status, tickets: refused.json.tickets }).toEqual({ status: 403, tickets: undefined });
    // Control: the same outsider is refused the same conversation's messages -- one rule.
    expect((await http(outsider, 'GET', `/conversations/${fam.groupId}/messages`)).status).toBe(403);
    const member = await http(fam.parent, 'GET', path);
    expect(member.status).toBe(200);
    expect(Array.isArray(member.json.tickets)).toBe(true);
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

  it('the super admin lists every lesson of a teacher, not only the learners they supervise (the Teacher File schedule)', async () => {
    const id = await schedule(26 * 60 * MIN);
    const from = at(-MIN);
    const to = at(2 * 24 * 60 * MIN);
    const q = `/lessons?teacherId=${fam.child.teacherId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const owner = await http(`owner@${DOMAIN}`, 'GET', q);
    expect(owner.status).toBe(200);
    expect((owner.json.lessons as Array<{ id: string }>).map((l) => l.id)).toContain(id);
    // The Teachers department reads the same list; this is the rule the super admin now shares.
    const dept = await http(tsup, 'GET', q);
    expect((dept.json.lessons as Array<{ id: string }>).map((l) => l.id)).toContain(id);
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

  it('T2: the Teachers department sets availability; the parent books the make-up the teacher owes them', async () => {
    expect((await http(null, 'GET', `/teachers/${fam.child.teacherId}/availability`)).status).toBe(401);
    const set = await http(tsup, 'POST', `/teachers/${fam.child.teacherId}/availability`, {
      timezone: 'Africa/Cairo',
      windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '08:00', end: '22:00' })),
    });
    expect(set.status).toBe(201);
    expect((await http(fam.teacher, 'GET', '/teachers/me/availability')).json.timezone).toBe('Africa/Cairo');
    expect((await http(fam.parent, 'POST', `/teachers/${fam.child.teacherId}/availability`, { timezone: 'Africa/Cairo', windows: [] })).status).toBe(403);

    const id = await schedule(5 * 24 * 60 * MIN);
    expect((await http(fam.teacher, 'POST', `/lessons/${id}/teacher-apology`, { reason: 'ill' })).status).toBe(201);
    const offered = await http(fam.parent, 'GET', `/conversations/${fam.groupId}/lesson-tickets`);
    expect((offered.json.tickets as Array<{ ticket: string; lessonId: string }>).some((t) => t.ticket === 'book_makeup' && t.lessonId === id)).toBe(true);
    const slots = await http(fam.parent, 'GET', `/lessons/${id}/makeup-slots`);
    expect(slots.status).toBe(200);
    const pick = (slots.json.slots as string[])[3];
    const booked = await http(fam.parent, 'POST', `/lessons/${id}/makeup`, { startsAt: pick });
    expect(booked.status).toBe(201);
    expect(booked.json.kind).toBe('makeup');
    // The sibling's teacher cannot see, let alone book, someone else's make-up.
    expect((await http(fam.siblingTeacher, 'GET', `/lessons/${id}/makeup-slots`)).status).toBe(404);
  });

  it('PD-15: the supervisor\'s cards, make-ups, report edits and deletes, corrections and the group\'s children', async () => {
    const [{ supervisor_id: supId }] = await g.prisma.$queryRawUnsafe<Array<{ supervisor_id: string }>>(
      `select supervisor_id::text from chat.learner_supervision where learner_id = $1::uuid`, fam.child.id,
    );
    const sup = [...m.supervisors, ...m.backups].find((x) => x.id === supId)!.subject;
    const ops = m.operationsManager.subject;
    const ticketsOf = async (who: string, id: string) =>
      ((await http(who, 'GET', `/conversations/${fam.groupId}/lesson-tickets`)).json.tickets as Array<{ ticket: string; lessonId: string }>)
        .filter((t) => t.lessonId === id).map((t) => t.ticket).sort();

    // A student's excuse before the start, recorded by the supervisor; the teacher records the agreed make-up.
    const ahead = await schedule(6 * 60 * MIN);
    expect(await ticketsOf(sup, ahead)).toEqual(['apology', 'teacher_apology']);
    const excused = await http(sup, 'POST', `/lessons/${ahead}/apology`, {});
    expect(excused.status).toBe(201);
    expect(excused.json.apologyTiming).toBe('before_start');
    expect(await ticketsOf(fam.teacher, ahead)).toContain('book_makeup');
    expect((await http(fam.teacher, 'POST', `/lessons/${ahead}/makeup`, { startsAt: at(2 * 24 * 60 * MIN + 7 * MIN) })).status).toBe(201);

    // After the start: excused at once by the supervisor, never by the parent through this card.
    const started = await schedule(-90 * MIN);
    expect((await http(fam.parent, 'POST', `/lessons/${started}/late-excuse`, { reason: 'x' })).status).toBe(403);
    expect((await http(sup, 'POST', `/lessons/${started}/late-excuse`, { reason: 'sick' })).json.apologyTiming).toBe('after_start');

    // Corrections: Operations yes, the teacher no; the history is staff's.
    expect((await http(fam.teacher, 'POST', `/lessons/${started}/correction`, { outcome: 'student_no_show', reason: 'x' })).status).toBe(403);
    const corrected = await http(ops, 'POST', `/lessons/${started}/correction`, { outcome: 'student_no_show', reason: 'the excuse was for another day' });
    expect(corrected.status).toBe(201);
    expect(corrected.json.outcome).toBe('student_no_show');
    expect((await http(fam.parent, 'GET', `/lessons/${started}/history`)).status).toBe(403);
    expect(((await http(sup, 'GET', `/lessons/${started}/history`)).json.corrections as unknown[])).toHaveLength(1);

    // A report: edited by its teacher, deleted (not resent) by the supervisor only.
    const taught = await schedule(-130 * MIN);
    expect((await http(fam.teacher, 'POST', `/lessons/${taught}/report`, { lessonNumber: 3, coveredTopics: ['reading'], rating: 4 })).status).toBe(201);
    const edited = await http(fam.teacher, 'POST', `/lessons/${taught}/report/edit`, { lessonNumber: 4, coveredTopics: ['reading', 'writing'] });
    expect(edited.status).toBe(201);
    expect((edited.json.report as { version: number }).version).toBe(2);
    expect((await http(fam.teacher, 'POST', `/lessons/${taught}/report/delete`, { reason: 'x', resend: false })).status).toBe(403);
    const deleted = await http(sup, 'POST', `/lessons/${taught}/report/delete`, { reason: 'lesson did not belong here', resend: false });
    expect(deleted.status).toBe(201);
    expect(deleted.json.outcome).toBe('voided');

    // The group's children, one by one; the course list and a child's details.
    const kids = await http(fam.parent, 'GET', `/conversations/${fam.groupId}/learners`);
    expect(kids.status).toBe(200);
    expect((kids.json.learners as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect((await http(fam.parent, 'GET', '/courses')).status).toBe(403);
    const course = await http(ops, 'POST', '/courses', { name: 'Noor Al-Bayan' });
    expect(course.status).toBe(201);
    expect((await http(sup, 'POST', `/learners/${fam.child.id}/enrollment`, { courseId: course.json.id, packageLessons: 12 })).status).toBe(201);
    expect((await http(fam.teacher, 'POST', `/learners/${fam.child.id}/enrollment`, { packageLessons: 1 })).status).toBe(403);
    const after = (await http(fam.teacher, 'GET', `/conversations/${fam.groupId}/learners`)).json.learners as Array<{ id: string; course: { name: string } | null; packageLessons: number | null }>;
    expect(after.find((l) => l.id === fam.child.id)).toMatchObject({ course: { name: 'Noor Al-Bayan' }, packageLessons: 12 });
  });

  it('T3: a transfer inside a family group swaps the teachers there, and the old one loses the chat', async () => {
    const third = m.teachers.find((t) => t.subject !== fam.teacher && t.subject !== fam.siblingTeacher)!;
    expect((await http(fam.teacher, 'POST', `/learners/${fam.child.id}/transfer`, { toTeacherId: third.id, reason: 'schedule_fit' })).status).toBe(403);
    const r = await http(tsup, 'POST', `/learners/${fam.child.id}/transfer`, {
      toTeacherId: third.id, reason: 'schedule_fit', handoverNote: 'continue from Al-Mulk 16',
    });
    expect(r.status).toBe(201);
    const live = await g.prisma.conversationMember.findMany({ where: { conversationId: fam.groupId, leftAt: null, actorKind: 'teacher' } });
    expect(live.map((x) => x.actorId)).toContain(third.id);
    // The old teacher stays only if they still teach another child of this group.
    const others = await g.prisma.conversationLearner.findMany({ where: { conversationId: fam.groupId, NOT: { learnerId: fam.child.id } } });
    const stillTeaches = await g.prisma.learner.count({
      where: { id: { in: others.map((o) => o.learnerId) }, teacherId: fam.child.teacherId },
    });
    if (stillTeaches === 0) {
      expect(live.map((x) => x.actorId)).not.toContain(fam.child.teacherId);
      expect([403, 404]).toContain((await http(fam.teacher, 'GET', `/conversations/${fam.groupId}/messages`)).status);
    } else {
      expect(live.map((x) => x.actorId)).toContain(fam.child.teacherId);
    }
    expect((await http(third.subject, 'GET', `/conversations/${fam.groupId}/messages`)).status).toBe(200);
  });

  it('T5: statistics routes resolve (not shadowed by /lessons/:id) and follow PD-10', async () => {
    const access = await http(tsup, 'GET', '/lessons/access');
    expect(access.status).toBe(200);
    expect(access.json.lessonManager).toBe(true);
    expect((await http(fam.parent, 'GET', '/lessons/access')).json.lessonManager).toBe(false);
    expect((await http(tsup, 'GET', '/stats/teachers')).status).toBe(200);
    expect((await http(fam.teacher, 'GET', '/stats/teachers')).status).toBe(403);
    expect((await http(fam.teacher, 'GET', '/stats/me')).status).toBe(200);
    expect((await http(fam.parent, 'GET', `/learners/${fam.child.id}/progress`)).status).toBe(200);
    expect((await http(null, 'GET', '/stats/me')).status).toBe(401);
    // The Schedules tab's roster resolves too (not shadowed by /lessons/:id).
    expect((await http(tsup, 'GET', '/lessons/roster')).status).toBe(200);
    expect((await http(fam.teacher, 'GET', '/lessons/roster')).status).toBe(403);
  });

  it('T4: Sales books a trial into real free time; the teacher reports it; Sales records the decision', async () => {
    const sales = m.salesManager.subject;
    expect((await http(null, 'GET', '/trials')).status).toBe(401);
    expect((await http(sales, 'GET', '/lessons/access')).json).toMatchObject({ sales: true, lessonManager: false });
    expect((await http(fam.teacher, 'POST', '/trials/prospects', { displayName: 'x' })).status).toBe(403);
    const prospect = await http(sales, 'POST', '/trials/prospects', { displayName: 'QA prospect' });
    expect(prospect.status).toBe(201);
    const teachers = await http(sales, 'GET', '/trials/teachers');
    expect((teachers.json.teachers as Array<{ id: string }>).map((t) => t.id)).toContain(fam.child.teacherId);
    expect((await http(fam.teacher, 'GET', '/trials/teachers')).status).toBe(403);
    const slots = await http(sales, 'GET', `/trials/slots?teacherId=${fam.child.teacherId}&durationMinutes=30`);
    expect(slots.status).toBe(200);
    const booked = await http(sales, 'POST', '/trials', {
      prospectId: prospect.json.id, teacherId: fam.child.teacherId, startsAt: (slots.json.slots as string[])[2],
    });
    expect(booked.status).toBe(201);
    expect((await http(fam.teacher, 'GET', '/trials')).json.trials).toEqual([expect.objectContaining({ id: booked.json.id })]);
    expect((await http(fam.siblingTeacher, 'GET', `/trials/${booked.json.id as string}`)).status).toBe(404);
    // A trial is not a lesson: /lessons/:id does not know it.
    expect((await http(tsup, 'GET', `/lessons/${booked.json.id as string}`)).status).toBe(404);
    // Before it starts there is nothing to report; the decision waits for attendance.
    expect((await http(fam.teacher, 'POST', `/trials/${booked.json.id as string}/attendance`, { attended: true, covered: 'x' })).status).toBe(409);
    expect((await http(sales, 'POST', `/trials/${booked.json.id as string}/outcome`, { result: 'subscribed' })).status).toBe(409);
    expect((await http(sales, 'GET', '/trials/new-students')).status).toBe(200);
    expect((await http(fam.teacher, 'GET', '/trials/new-students')).status).toBe(403);

    // Part 2: the booking's card is in the teacher's trial group, which the
    // teacher, Sales and the Teachers department read -- and Operations does not.
    const group = await http(fam.teacher, 'POST', '/trials/my-group');
    expect(group.status).toBe(201);
    const gid = group.json.conversationId as string;
    expect((await http(sales, 'POST', `/trials/teachers/${fam.child.teacherId}/group`)).json.conversationId).toBe(gid);
    const read = await http(fam.teacher, 'GET', `/conversations/${gid}/messages`);
    expect(read.status).toBe(200);
    expect(JSON.stringify(read.json)).toContain('trial_booked');
    expect((await http(sales, 'GET', `/conversations/${gid}/messages`)).status).toBe(200);
    expect((await http(tsup, 'GET', `/conversations/${gid}/messages`)).status).toBe(200);
    // Operations is part of the trial desk since 2026-10-21: it reads the group too.
    expect((await http(m.operationsManager.subject, 'GET', `/conversations/${gid}/messages`)).status).toBe(200);
    expect([403, 404]).toContain((await http(fam.siblingTeacher, 'GET', `/conversations/${gid}/messages`)).status);
    // Nothing has started yet, so "+" offers no trial report.
    const tickets = await http(fam.teacher, 'GET', `/conversations/${gid}/trial-tickets`);
    expect(tickets.status).toBe(200);
    expect(tickets.json.tickets).toEqual([]);
  });

  it('the needs-action queue is the Teachers department\'s; a client cannot send a card', async () => {
    expect((await http(fam.teacher, 'GET', '/lessons/needs-action')).status).toBe(403);
    expect((await http(tsup, 'GET', '/lessons/needs-action')).status).toBe(200);
    const forged = await http(fam.parent, 'POST', `/conversations/${fam.groupId}/messages`, {
      type: 'card', body: 'forged', clientMessageId: randomUUID(),
    });
    expect(forged.status).toBe(400);
  });

  it('PD-16: the parent sign-up routes are public and say nothing about who exists; New Students is staff-only', async () => {
    const ask = await http(null, 'POST', '/auth/signup/request', { email: 'nobody-pd16@example.test' });
    expect(ask.status).toBe(200);
    expect(ask.json).toEqual({ ok: true, delivery: 'relay' });
    const wrong = await http(null, 'POST', '/auth/signup/verify', { email: 'nobody-pd16@example.test', code: '123456', password: 'long-enough-1' });
    expect(wrong.status).toBe(401);
    expect(wrong.code).toBe('AUTH.SIGNUP_CODE_INVALID');
    expect((await http(fam.parent, 'GET', '/trials/new-students')).status).toBe(403);
    expect((await http(fam.parent, 'POST', `/trials/new-students/${randomUUID()}/assign`, { supervisorId: randomUUID() })).status).toBe(403);
    expect((await http(m.operationsManager.subject, 'GET', '/trials/new-students')).status).toBe(200);
  });
});

