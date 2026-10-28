/**
 * PD-12 S1 over real HTTP, on the PD-8 organization seed: real logins, the global
 * bearer guard, the real modules and routes, and a real upload through the storage
 * route.
 *
 * What it proves that pd012-s1.spec.ts cannot: the modules wire up, every route
 * exists and is guarded, a certificate's bytes travel the same signed PUT any
 * attachment does and reach the family as an ordinary attachment of the card, and
 * leave round-trips from the teacher's app to the Teachers department and back.
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
import { SupervisionModule } from '../../src/supervision/supervision.module';
import { CertificateModule } from '../../src/certificates/certificate.module';
import { TeacherFileModule } from '../../src/teacher-file/teacher-file.module';
import { LeaveModule } from '../../src/leave/leave.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd12-s1-spec-password-1';
const DOMAIN = 'pd12s1.qa.jawwid.test';
const NEXT_YEAR = new Date().getUTCFullYear() + 1;

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

/** A child, their teacher and parent, and the group a certificate is delivered into. */
let fam: { groupId: string; parent: string; childId: string; teacher: string; teacherId: string };

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
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd12-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd12-${orgId.slice(0, 8)}', 'PD-12 QA academy')`,
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

  // A child whose family group has their teacher in it: where the certificate lands.
  const subjectOfTeacher = new Map(m.teachers.map((t) => [t.id, t.subject]));
  for (const f of m.families) {
    for (const gr of f.groups) {
      const child = f.children.find((c) => gr.learnerIds.includes(c.id) && gr.teacherIds.includes(c.teacherId));
      if (child && !fam) {
        fam = {
          groupId: gr.conversationId,
          parent: f.parent.subject,
          childId: child.id,
          teacher: subjectOfTeacher.get(child.teacherId)!,
          teacherId: child.teacherId,
        };
      }
    }
  }
  expect(fam).toBeDefined();

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, SupervisionModule, CertificateModule, TeacherFileModule, LeaveModule],
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
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd12-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('PD-12 S1 over HTTP', () => {
  it('every route is behind the bearer guard', async () => {
    for (const [method, path] of [
      ['POST', '/me/supervision-conversation'],
      ['GET', '/me/leave'],
      ['POST', '/me/leave-requests'],
      ['GET', '/teacher-leave-requests'],
      ['GET', '/learner-certificates'],
      ['POST', '/learner-certificates'],
      ['POST', '/supervision-conversations/ensure-all'],
    ]) {
      expect({ path, status: (await http(null, method, path)).status }).toEqual({ path, status: 401 });
    }
  });

  it('a certificate: requested privately, uploaded through the storage route, delivered to the family with its file', async () => {
    const tsup = m.teacherSupervisors[0].subject;
    const requested = await http(fam.teacher, 'POST', '/learner-certificates', {
      learnerId: fam.childId,
      title: 'Juz Amma',
      achievement: 'Memorized Juz Amma',
      achievedOn: '2026-10-01',
      printedName: 'QA Child',
    });
    expect(requested.status).toBe(201);
    const certId = (requested.json.certificate as { id: string }).id;
    const supervisionId = requested.json.conversationId as string;

    // PD-11's route opens the SAME one-per-teacher conversation (reconciled 2026-10-19).
    const viaLessons = await http(tsup, 'GET', `/teachers/${fam.teacherId}/supervision-chat`);
    expect(viaLessons.status).toBe(200);
    expect(viaLessons.json.conversationId).toBe(supervisionId);

    // The request is private: the teacher reads it in the supervision chat; the parent cannot open that chat.
    const privatePage = await http(fam.teacher, 'GET', `/conversations/${supervisionId}/messages`);
    expect(privatePage.status).toBe(200);
    // (403 like any conversation of the same academy one is not in; another tenant's would read 404.)
    expect((await http(fam.parent, 'GET', `/conversations/${supervisionId}/messages`)).code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
    // ...and Operations cannot see the queue.
    expect((await http(m.supervisors[0].subject, 'GET', '/learner-certificates')).code).toBe(CommErrorCode.CERTIFICATE_DENIED);

    const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 0x20)]);
    const grant = await http(tsup, 'POST', `/learner-certificates/${certId}/upload`, { mimeType: 'application/pdf', byteSize: bytes.length });
    expect(grant.status).toBe(201);
    expect(grant.json.conversationId).toBe(fam.groupId);
    const upload = grant.json.upload as { uploadUrl: string; objectKey: string; headers: Record<string, string> };
    // The signed URL names this process's storage route; send it to the port under test.
    const route = upload.uploadUrl.slice(upload.uploadUrl.indexOf('/storage/'));
    // The bearer: on this line the local storage route is still behind the global guard
    // (its @Public fix is on another branch); in production the PUT goes to S3.
    const put = await fetch(`${base}${route}`, {
      method: 'PUT',
      headers: { ...upload.headers, authorization: `Bearer ${await tokenFor(tsup)}` },
      body: bytes,
    });
    expect(put.status).toBe(201);

    const issued = await http(tsup, 'POST', `/learner-certificates/${certId}/issue`, {
      objectKey: upload.objectKey,
      mimeType: 'application/pdf',
      byteSize: bytes.length,
      fileName: 'certificate.pdf',
    });
    expect(issued.status).toBe(201);

    const page = await http(fam.parent, 'GET', `/conversations/${fam.groupId}/messages`);
    expect(page.status).toBe(200);
    const delivered = (page.json.messages as Array<{ type: string; card: { kind: string } | null; attachments: Array<{ url: string | null; originalName?: string }> }>)
      .filter((x) => x.type === 'card' && x.card?.kind === 'certificate_issued');
    expect(delivered).toHaveLength(1);
    expect(delivered[0].attachments).toHaveLength(1);
    expect(delivered[0].attachments[0].url).toBeTruthy();

    // ...and on the child's progress (PD-11 T5), pointing at where the file is.
    const progress = await http(fam.parent, 'GET', `/learners/${fam.childId}/progress`);
    expect(progress.status).toBe(200);
    expect(progress.json.certificates).toEqual([
      expect.objectContaining({ id: certId, title: 'Juz Amma', achievedOn: '2026-10-01', conversationId: fam.groupId }),
    ]);
  });

  it('leave: the teacher requests, the department approves, the teacher reads the computed balance', async () => {
    const tsup = m.teacherSupervisors[0].subject;
    const requested = await http(fam.teacher, 'POST', '/me/leave-requests', {
      firstDay: `${NEXT_YEAR}-04-06`,
      lastDay: `${NEXT_YEAR}-04-07`,
      reason: 'family event',
    });
    expect(requested.status).toBe(201);
    const requestId = (requested.json.request as { id: string }).id;

    // PD-26 amendment: Operations decides the leave of their families' teachers;
    // anyone outside both departments (here Sales) is still refused.
    expect((await http(m.salesManager.subject, 'GET', '/teacher-leave-requests')).code).toBe(CommErrorCode.LEAVE_DENIED);
    expect((await http(fam.teacher, 'GET', '/teacher-leave-requests')).code).toBe(CommErrorCode.LEAVE_DENIED);
    const queue = await http(tsup, 'GET', '/teacher-leave-requests?state=requested');
    expect((queue.json.requests as Array<{ id: string }>).map((r) => r.id)).toContain(requestId);

    // A member may not set the allowance; the department's manager may.
    expect((await http(tsup, 'POST', `/teacher-files/${fam.teacherId}/leave-allowance`, { year: NEXT_YEAR, days: 21 })).code).toBe(
      CommErrorCode.LEAVE_DENIED,
    );
    expect((await http(m.teachersManager.subject, 'POST', `/teacher-files/${fam.teacherId}/leave-allowance`, { year: NEXT_YEAR, days: 21 })).status).toBe(201);

    expect((await http(tsup, 'POST', `/teacher-leave-requests/${requestId}/approve`, {})).status).toBe(201);
    const mine = await http(fam.teacher, 'GET', `/me/leave?year=${NEXT_YEAR}`);
    expect(mine.status).toBe(200);
    expect(mine.json).toMatchObject({ year: NEXT_YEAR, allowance: 21, used: 2, balance: 19 });
    // The approved days are PD-11's days off: the record the scheduler reads.
    const off = await g.prisma.teacherDayOff.findMany({ where: { teacherId: fam.teacherId, leaveRequestId: requestId } });
    expect(off.map((o) => o.day.toISOString().slice(0, 10)).sort()).toEqual([`${NEXT_YEAR}-04-06`, `${NEXT_YEAR}-04-07`]);
  });
});
