/**
 * PD-56 · store compliance: a parent or a teacher deletes their own account
 * (Apple 5.1.1(v), Google Play), over real HTTP.
 *
 *   1. a parent, in the app: the password is asked again; then the person is
 *      "Deleted user", their photo, contact details, push tokens, inbox,
 *      sign-in and sessions are gone, the e-mail is free again, their messages
 *      stay, the children stay, and the Operations manager is told
 *   2. a teacher: the same; the Teachers manager is told to move the
 *      students, and the task settles once they are moved
 *   3. a staff account cannot delete itself here; erasing twice changes nothing
 *   4. the public page (Google Play's link): a form with no script, a wrong
 *      password refused, the right one deletes
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { hashPassword } from '@platform/auth/password';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { AccountDeletionModule } from '../../src/account-deletion/account-deletion.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate, withAssignmentGate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd56-deletion-spec-password-1';
const DOMAIN = 'pd56deletion.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

async function login(subject: string, password = PASSWORD) {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: subject, password }),
  });
  return { status: r.status, token: ((await r.json().catch(() => ({}))) as { accessToken?: string }).accessToken ?? '' };
}
async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  return { status: r.status, code: json.error?.code, json };
}
async function form(path: string, fields: Record<string, string>) {
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: r.status, html: await r.text(), csp: r.headers.get('content-security-policy') ?? '' };
}
const tasks = (type: string) =>
  g.prisma.$queryRaw<Array<{ source_id: string; state: string; assignee_staff_id: string | null }>>`
    SELECT source_id::text, state, assignee_staff_id::text FROM chat.work_task
     WHERE organization_id = ${orgId}::uuid AND source_type = ${type}`;

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  // An erased account's sign-in is no longer an e-mail: clear by organization.
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}' or organization_id in (select id from chat.organization where slug like 'pd56-%')`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd56-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd56-${orgId.slice(0, 8)}', 'PD-56 QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: true });

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({ imports: [PlatformModule, AuthModule, CommunicationModule, AccountDeletionModule] }).compile();
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
  // An erased account's sign-in is no longer an e-mail: clear by organization.
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}' or organization_id in (select id from chat.organization where slug like 'pd56-%')`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd56-%'`);
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  await g.prisma.$disconnect();
});

describe('PD-56: deleting one\'s own account', () => {
  it('1. a parent, in the app: password again, then anonymised -- messages and children stay, Operations is told', async () => {
    const family = m.families[0]!;
    const parentId = family.parent.id;
    const { token } = await login(family.parent.subject);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.device_token (organization_id, actor_id, token, platform) values ($1::uuid, $2::uuid, $3, 'ios')`,
      orgId, parentId, `pd56-token-${parentId}`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.parent_file (contact_id, organization_id, phone, email) values ($1::uuid, $2::uuid, '+201000000056', 'p56@${DOMAIN}')
       on conflict (contact_id) do update set phone = excluded.phone, email = excluded.email`,
      parentId, orgId,
    );
    const sentBefore = await g.prisma.message.count({ where: { authorId: parentId } });
    const childrenBefore = await g.prisma.learner.count({ where: { familyId: family.id } });

    // The password is asked again.
    expect((await call(token, 'POST', '/me/account/delete', { password: 'not-the-password' })).status).toBe(401);
    expect((await call(token, 'POST', '/me/account/delete', {})).status).toBe(401);
    expect((await call(token, 'GET', '/me')).status).toBe(200);

    const done = await call(token, 'POST', '/me/account/delete', { password: PASSWORD });
    expect(done).toMatchObject({ status: 200, json: { deleted: true } });

    // Signed out everywhere, and the e-mail is free.
    expect((await call(token, 'GET', '/me')).status).toBe(401);
    expect((await login(family.parent.subject)).status).toBe(401);
    expect(await g.prisma.account.count({ where: { subject: family.parent.subject } })).toBe(0);

    const contact = await g.prisma.contact.findUniqueOrThrow({ where: { id: parentId } });
    expect(contact).toMatchObject({ name: 'Deleted user', avatarObjectKey: null, isActive: false });
    const account = await g.prisma.account.findUniqueOrThrow({ where: { id: contact.accountId! }, include: { credential: true } });
    expect(account).toMatchObject({ status: 'deactivated', isActive: false, credential: null });
    expect(account.subject).toBe(`erased:${account.id}`);
    expect(await g.prisma.session.count({ where: { accountId: account.id, revokedAt: null } })).toBe(0);
    expect(await g.prisma.deviceToken.count({ where: { actorId: parentId } })).toBe(0);
    expect(await g.prisma.parentFile.count({ where: { contactId: parentId } })).toBe(0);
    expect(await g.prisma.notification.count({ where: { recipientId: parentId } })).toBe(0);
    expect(await g.prisma.conversationMember.count({ where: { actorId: parentId, leftAt: null } })).toBe(0);

    // Kept: what they wrote, the children, the audit.
    expect(sentBefore).toBeGreaterThan(0);
    expect(await g.prisma.message.count({ where: { authorId: parentId } })).toBe(sentBefore);
    expect(await g.prisma.learner.count({ where: { familyId: family.id } })).toBe(childrenBefore);
    expect(await g.prisma.auditLog.count({ where: { action: 'account.erased', entityId: account.id } })).toBe(1);

    // Nobody else in the family signs in: the Operations manager is told.
    expect(await tasks('family_without_account')).toEqual([
      { source_id: family.id, state: 'open', assignee_staff_id: m.operationsManager.id },
    ]);
    // Still nobody who can sign in: the sweep leaves it open.
    await g.prisma.$queryRaw`SELECT chat.work_task_sweep_erasure(50)`;
    expect((await tasks('family_without_account'))[0]!.state).toBe('open');
  });

  it('2. a teacher: anonymised; the Teachers manager moves the students, and the task settles when they are moved', async () => {
    const teacher = m.teachers[0]!;
    const { token } = await login(teacher.subject);
    expect((await call(token, 'POST', '/me/account/delete', { password: PASSWORD })).status).toBe(200);

    expect(await g.prisma.teacher.findUniqueOrThrow({ where: { id: teacher.id } })).toMatchObject({ name: 'Deleted user', isActive: false, avatarObjectKey: null });
    expect((await login(teacher.subject)).status).toBe(401);
    const [task] = await tasks('teacher_account_deleted');
    expect(task).toEqual({ source_id: teacher.id, state: 'open', assignee_staff_id: m.teachersManager.id });

    // Not done while a student is still on the teacher.
    await g.prisma.$queryRaw`SELECT chat.work_task_sweep_erasure(50)`;
    expect((await tasks('teacher_account_deleted'))[0]!.state).toBe('open');

    const other = m.teachers.find((t) => t.id !== teacher.id)!;
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${other.id}'::uuid where teacher_id = '${teacher.id}'::uuid`);
    await g.prisma.$executeRawUnsafe(
      `update chat.lesson set teacher_id = $1::uuid where teacher_id = $2::uuid and outcome is null and starts_at >= now()`, other.id, teacher.id,
    );
    await g.prisma.$queryRaw`SELECT chat.work_task_sweep_erasure(50)`;
    expect((await tasks('teacher_account_deleted'))[0]!.state).toBe('completed');
  });

  it('3. staff cannot delete themselves here; erasing twice changes nothing', async () => {
    const { token } = await login(m.supervisors[0]!.subject);
    const r = await call(token, 'POST', '/me/account/delete', { password: PASSWORD });
    expect(r.status).toBe(403);
    expect((await call(token, 'GET', '/me')).status).toBe(200);

    const family = m.families[0]!;
    const contact = await g.prisma.contact.findUniqueOrThrow({ where: { id: family.parent.id } });
    const [again] = await g.prisma.$queryRaw<Array<{ r: { alreadyErased: boolean } }>>`
      SELECT chat.erase_account(${contact.accountId}::uuid, 'again') AS r`;
    expect(again!.r.alreadyErased).toBe(true);
    expect(await g.prisma.auditLog.count({ where: { action: 'account.erased', entityId: contact.accountId! } })).toBe(1);
  });

  it('4. the public page: no script, a wrong password refused, the right one deletes', async () => {
    const page = await fetch(`${base}/account-deletion?lang=en`);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("form-action 'self'");
    expect(html).toContain('Delete your Jawwid account');
    expect(html).not.toMatch(/<script/i);
    expect(await (await fetch(`${base}/account-deletion`)).text()).toContain('حذف حساب جوّد');

    const family = m.families[1]!;
    expect((await form('/account-deletion?lang=en', { username: family.parent.subject, password: PASSWORD })).status).toBe(400);
    const wrong = await form('/account-deletion?lang=en', { username: family.parent.subject, password: 'nope-nope-nope', confirm: 'yes' });
    expect(wrong.status).toBe(401);
    expect(wrong.html).toContain('not right');
    expect((await login(family.parent.subject)).status).toBe(200);

    const right = await form('/account-deletion?lang=en', { username: family.parent.subject.toUpperCase(), password: PASSWORD, confirm: 'yes' });
    expect(right.status).toBe(200);
    expect(right.html).toContain('Your account has been deleted');
    expect((await login(family.parent.subject)).status).toBe(401);
    expect(await g.prisma.contact.findUniqueOrThrow({ where: { id: family.parent.id } })).toMatchObject({ name: 'Deleted user' });

    // Staff, through the page: refused after the password, nothing changes.
    const staff = await form('/account-deletion?lang=en', { username: m.supervisors[0]!.subject, password: PASSWORD, confirm: 'yes' });
    expect(staff.status).toBe(403);
    expect((await login(m.supervisors[0]!.subject)).status).toBe(200);
  });
});
