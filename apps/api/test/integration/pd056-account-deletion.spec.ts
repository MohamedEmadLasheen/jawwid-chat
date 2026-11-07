/**
 * PD-56 · store compliance: a parent or a teacher deletes their own account
 * (Apple 5.1.1(v), Google Play), over real HTTP.
 *
 *   1. a parent, in the app: the password is asked again; then the person is
 *      "Deleted user" -- in the conversations they wrote in too --, their photo,
 *      contact details, devices, push tokens, inbox, sign-in and sessions are
 *      gone, the e-mail is free; their messages, the children and the payment
 *      records stay; the Operations manager is told
 *   2. the parent's own PD-42 contact keys go (another parent keeps theirs):
 *      the same e-mail signing up again is never linked to the old family
 *   3. a teacher with a future lesson, an assigned student or open payroll is
 *      erased in nothing: a deletion request is recorded instead (O-3,
 *      pd056-teacher-deletion-request.spec.ts); one with nothing open is
 *      deleted, the payout account goes, and the Teachers manager gets a notice
 *   4. staff cannot delete -- themselves or anyone -- here; erasing twice
 *      changes nothing
 *   5. the public page (Google Play's link): no script, an anti-forgery token,
 *      an unknown account, a wrong password and a locked account read the same,
 *      the right password deletes, a teacher with work open gets a request (O-3)
 *
 * Synthetic people only (G-20).
 */
import { randomBytes, randomUUID } from 'node:crypto';
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
import { contactKeyHash, normaliseEmailForKey } from '../../src/new-students/contact-key';
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
/** The public page's form token, as a browser would read it from the page. */
async function formToken(): Promise<string> {
  const html = await (await fetch(`${base}/account-deletion?lang=en`)).text();
  return /name="token" value="([^"]+)"/.exec(html)![1]!;
}
async function form(fields: Record<string, string>, opts: { token?: string | null } = {}) {
  const token = opts.token === undefined ? await formToken() : opts.token;
  const started = Date.now();
  const r = await fetch(`${base}/account-deletion?lang=en`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, ...(token === null ? {} : { token }) }).toString(),
  });
  return { status: r.status, html: await r.text(), ms: Date.now() - started };
}
const tasks = (type: string) =>
  g.prisma.$queryRaw<Array<{ source_id: string; state: string; source_state: string; assignee_staff_id: string | null }>>`
    SELECT source_id::text, state, source_state, assignee_staff_id::text FROM chat.work_task
     WHERE organization_id = ${orgId}::uuid AND source_type = ${type}`;

/** A teacher who can sign in, with nothing on them yet. */
async function newTeacher(tag: string): Promise<{ id: string; subject: string; accountId: string }> {
  const subject = `teacher.${tag}@${DOMAIN}`;
  const account = await g.prisma.account.create({ data: { organizationId: orgId, subject, kind: 'teacher', status: 'active', isActive: true } });
  await g.prisma.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
  const teacher = await g.prisma.teacher.create({ data: { organizationId: orgId, name: `teacher_${tag}`, accountId: account.id, isActive: true } });
  return { id: teacher.id, subject, accountId: account.id };
}

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
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}' or organization_id in (select id from chat.organization where slug like 'pd56-%')`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd56-%'`);
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  await g.prisma.$disconnect();
});

describe('PD-56: deleting one\'s own account', () => {
  it('1. a parent, in the app: password again, then "Deleted user" -- messages, children and payments stay, Operations is told', async () => {
    const family = m.families[0]!;
    const parentId = family.parent.id;
    const child = family.children[0]!;
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
    // A payment link and the parent's receipt: financial records, kept 7 years.
    const [{ id: requestId }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.payment_request (family_id, learner_id, token, purpose, label, amount_minor, currency, expires_at, created_by)
       values ($1::uuid, $2::uuid, $3, 'other', 'October', 50000, 'EGP', now() + interval '14 days', $4::uuid) returning id::text as id`,
      family.id, child.id, randomBytes(32).toString('base64url'), m.operationsManager.id,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.payment_receipt (family_id, request_id, amount_minor, currency, transferred_on, object_key, mime_type, byte_size, uploaded_by)
       values ($1::uuid, $2::uuid, 50000, 'EGP', chat.academy_today(), 'payment-receipts/' || gen_random_uuid(), 'image/png', 1024, $3::uuid)`,
      family.id, requestId, parentId,
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
    expect(await g.prisma.device.count({ where: { accountId: account.id } })).toBe(0);
    expect(await g.prisma.deviceToken.count({ where: { actorId: parentId } })).toBe(0);
    expect(await g.prisma.parentFile.count({ where: { contactId: parentId } })).toBe(0);
    expect(await g.prisma.notification.count({ where: { recipientId: parentId } })).toBe(0);
    expect(await g.prisma.conversationMember.count({ where: { actorId: parentId, leftAt: null } })).toBe(0);

    // Kept: what they wrote -- shown to the others as "Deleted user" --, the children, the money, the audit.
    expect(sentBefore).toBeGreaterThan(0);
    expect(await g.prisma.message.count({ where: { authorId: parentId } })).toBe(sentBefore);
    // A conversation they wrote in, read by a staff member still in it.
    const [where] = await g.prisma.$queryRaw<Array<{ conversation_id: string; staff_id: string }>>`
      SELECT m.conversation_id::text, cm.actor_id::text AS staff_id
        FROM chat.message m JOIN chat.conversation_member cm ON cm.conversation_id = m.conversation_id
       WHERE m.author_id = ${parentId}::uuid AND cm.actor_kind = 'staff' AND cm.left_at IS NULL
       LIMIT 1`;
    const reader = [...m.supervisors, m.operationsManager, m.superAdmin].find((s) => s.id === where!.staff_id)!;
    const { token: supervisorToken } = await login(reader.subject);
    const thread = await call(supervisorToken, 'GET', `/conversations/${where!.conversation_id}/messages`);
    const theirs = (thread.json.messages as Array<{ authorId: string | null; authorDisplayName: string | null }>).filter((x) => x.authorId === parentId);
    expect(theirs.length).toBeGreaterThan(0);
    expect(new Set(theirs.map((x) => x.authorDisplayName))).toEqual(new Set(['Deleted user']));
    expect(await g.prisma.learner.count({ where: { familyId: family.id } })).toBe(childrenBefore);
    expect(await g.prisma.paymentRequest.count({ where: { id: requestId } })).toBe(1);
    expect(await g.prisma.paymentReceipt.count({ where: { requestId, uploadedBy: parentId } })).toBe(1);
    expect(await g.prisma.auditLog.count({ where: { action: 'account.erased', entityId: account.id } })).toBe(1);

    // Nobody else in the family signs in: the Operations manager is told, and it stays open.
    await g.prisma.$queryRaw`SELECT chat.work_task_sweep_erasure(50)`;
    expect(await tasks('family_without_account')).toEqual([
      { source_id: family.id, state: 'open', source_state: 'pending', assignee_staff_id: m.operationsManager.id },
    ]);
  });

  it('2. the parent\'s own contact keys go, another parent\'s stay: the same e-mail signing up again is a new person', async () => {
    const family = m.families[2]!;
    const parent = family.parent;
    // A second parent in the family, with their own key.
    const otherEmail = `other.p56@${DOMAIN}`;
    const other = await g.prisma.contact.create({ data: { organizationId: orgId, familyId: family.id, name: 'parent_other', relationship: 'mother', rolePreset: 'authorized_contact', isActive: true, canViewProgress: true, canManageSchedule: false, canManageBilling: false, canManageContacts: false, canCancel: false } });
    const mine = contactKeyHash('email', normaliseEmailForKey(parent.subject));
    const theirs = contactKeyHash('email', normaliseEmailForKey(otherEmail));
    for (const keyHash of [mine, theirs]) {
      await g.prisma.$executeRawUnsafe(
        `insert into chat.family_contact_key (organization_id, key_hash, family_id, kind) values ($1::uuid, $2, $3::uuid, 'email') on conflict do nothing`,
        orgId, keyHash, family.id,
      );
    }
    expect(other.id).toBeDefined();

    const { token } = await login(parent.subject);
    expect((await call(token, 'POST', '/me/account/delete', { password: PASSWORD })).status).toBe(200);

    const keys = await g.prisma.$queryRaw<Array<{ key_hash: string }>>`
      SELECT key_hash FROM chat.family_contact_key WHERE family_id = ${family.id}::uuid`;
    expect(keys.map((k) => k.key_hash)).not.toContain(mine);
    expect(keys.map((k) => k.key_hash)).toContain(theirs);
    // Nothing anywhere still links this e-mail to a family (PD-42 relinks by key).
    expect(await g.prisma.$queryRaw`SELECT 1 FROM chat.family_contact_key WHERE key_hash = ${mine}`).toEqual([]);
  });

  it('3. a teacher with a future lesson, an assigned student or open payroll is erased in nothing (a request instead); with nothing open, deleted', async () => {
    const blocked = async (t: { subject: string; id: string; accountId: string }, reason: string) => {
      const { token } = await login(t.subject);
      const r = await call(token, 'POST', '/me/account/delete', { password: PASSWORD });
      // O-3: not a refusal -- a deletion request, deleted within 30 days.
      expect({ reason, status: r.status, deleted: r.json.deleted, items: (r.json.request as { openItems: string[] }).openItems })
        .toEqual({ reason, status: 200, deleted: false, items: [reason] });
      // Nothing erased: still themselves, still signed in, no notice.
      expect(await g.prisma.teacher.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ name: expect.stringMatching(/^teacher_/), isActive: true });
      expect((await call(token, 'GET', '/me')).status).toBe(200);
      expect((await tasks('teacher_account_deleted')).filter((x) => x.source_id === t.id)).toEqual([]);
    };

    // A future lesson (a trial in three days).
    const withLesson = await newTeacher('lesson');
    const prospect = await g.prisma.trialProspect.create({ data: { organizationId: orgId, displayName: 'QA Prospect', createdBy: m.superAdmin.id } });
    const at = Date.now() + 3 * 86_400_000;
    await g.prisma.lesson.create({
      data: { organizationId: orgId, kind: 'trial', prospectId: prospect.id, teacherId: withLesson.id, startsAt: new Date(at), endsAt: new Date(at + 1_800_000), createdByKind: 'staff', createdBy: m.superAdmin.id },
    });
    await blocked(withLesson, 'future_lessons');

    // An assigned student.
    const withStudent = await newTeacher('student');
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${withStudent.id}'::uuid where id = '${m.families[3]!.children[0]!.id}'::uuid`);
    await blocked(withStudent, 'assigned_learners');

    // Payroll of this month.
    const withPayroll = await newTeacher('payroll');
    await g.prisma.$executeRawUnsafe(
      `insert into chat.teacher_pay_adjustment (organization_id, teacher_id, kind, month, amount, currency, reason, created_by)
       values ($1::uuid, $2::uuid, 'bonus', date_trunc('month', now())::date, 100, 'EGP', 'QA bonus', $3::uuid)`,
      orgId, withPayroll.id, m.superAdmin.id,
    );
    await blocked(withPayroll, 'open_payroll');

    // Nothing open: deleted; payout account gone; the Teachers manager gets a notice to acknowledge.
    const clear = await newTeacher('clear');
    await g.prisma.$executeRawUnsafe(
      `insert into chat.teacher_payout_account (teacher_id, organization_id, method, details_sealed, key_id, last4, updated_by)
       values ($1::uuid, $2::uuid, 'bank_transfer', decode(repeat('ab', 40), 'hex'), 'k1', '1234', $3::uuid)`,
      clear.id, orgId, m.superAdmin.id,
    );
    const { token } = await login(clear.subject);
    expect((await call(token, 'POST', '/me/account/delete', { password: PASSWORD })).status).toBe(200);
    expect(await g.prisma.teacher.findUniqueOrThrow({ where: { id: clear.id } })).toMatchObject({ name: 'Deleted user', isActive: false, avatarObjectKey: null });
    expect(await g.prisma.teacherPayoutAccount.count({ where: { teacherId: clear.id } })).toBe(0);
    expect((await login(clear.subject)).status).toBe(401);
    expect((await tasks('teacher_account_deleted')).filter((x) => x.source_id === clear.id)).toEqual([
      { source_id: clear.id, state: 'open', source_state: 'withdrawn', assignee_staff_id: m.teachersManager.id },
    ]);
  });

  it('4. staff cannot delete -- themselves or anyone -- here; erasing twice changes nothing', async () => {
    const family = m.families[1]!;
    const { token } = await login(m.supervisors[0]!.subject);
    // The route takes no account: naming the parent changes nothing.
    const r = await call(token, 'POST', '/me/account/delete', { password: PASSWORD, accountId: family.parent.id });
    expect(r.status).toBe(403);
    expect((await call(token, 'GET', '/me')).status).toBe(200);
    expect((await login(family.parent.subject)).status).toBe(200);
    expect(await g.prisma.contact.findUniqueOrThrow({ where: { id: family.parent.id } })).toMatchObject({ isActive: true });

    const erased = await g.prisma.contact.findUniqueOrThrow({ where: { id: m.families[0]!.parent.id } });
    const [again] = await g.prisma.$queryRaw<Array<{ r: { alreadyErased: boolean } }>>`
      SELECT chat.erase_account(${erased.accountId}::uuid, 'again') AS r`;
    expect(again!.r.alreadyErased).toBe(true);
    expect(await g.prisma.auditLog.count({ where: { action: 'account.erased', entityId: erased.accountId! } })).toBe(1);
  });

  it('5. the public page: no script, anti-forgery, nothing says whether an account exists, the right password deletes', async () => {
    const page = await fetch(`${base}/account-deletion?lang=en`);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("form-action 'self'");
    expect(html).toContain('Delete your Jawwid account');
    expect(html).not.toMatch(/<script/i);
    expect(html).toMatch(/name="username" type="text" inputmode="email"/);
    expect(await (await fetch(`${base}/account-deletion`)).text()).toContain('حذف حساب جوّد');

    const family = m.families[1]!;
    const fields = { username: family.parent.subject, password: PASSWORD, confirm: 'yes' };
    // No token, or a forged one: refused unread.
    expect((await form(fields, { token: null })).status).toBe(400);
    expect((await form(fields, { token: `${Date.now()}.x.forged` })).status).toBe(400);
    expect((await login(family.parent.subject)).status).toBe(200);
    expect((await form({ username: family.parent.subject, password: PASSWORD })).status).toBe(400);

    // An unknown name and a wrong password: the same answer.
    const unknown = await form({ username: `nobody@${DOMAIN}`, password: 'nope-nope-nope', confirm: 'yes' });
    const wrong = await form({ ...fields, password: 'nope-nope-nope' });
    expect([unknown.status, wrong.status]).toEqual([401, 401]);
    const message = (h: string) => /<p class="err" role="alert">([^<]*)<\/p>/.exec(h)?.[1];
    expect(message(unknown.html)).toBe(message(wrong.html));
    // A locked account reads the same too.
    await g.prisma.accountCredential.updateMany({
      where: { account: { subject: m.families[3]!.parent.subject } },
      data: { lockedUntil: new Date(Date.now() + 600_000) },
    });
    const locked = await form({ username: m.families[3]!.parent.subject, password: PASSWORD, confirm: 'yes' });
    expect(locked.status).toBe(401);
    expect(message(locked.html)).toBe(message(wrong.html));

    const right = await form({ ...fields, username: family.parent.subject.toUpperCase() });
    expect(right.status).toBe(200);
    expect(right.html).toContain('Your account has been deleted');
    expect((await login(family.parent.subject)).status).toBe(401);
    expect(await g.prisma.contact.findUniqueOrThrow({ where: { id: family.parent.id } })).toMatchObject({ name: 'Deleted user' });

    // O-3: a teacher with something open gets, after the password, a deletion request -- never "ask the academy".
    const busy = await newTeacher('page');
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${busy.id}'::uuid where id = '${m.families[4]!.children[0]!.id}'::uuid`);
    const teacher = await form({ username: busy.subject, password: PASSWORD, confirm: 'yes' });
    expect(teacher.status).toBe(200);
    expect(teacher.html).toContain('Your deletion request is recorded');
    expect(teacher.html).not.toContain('contact the academy');
    expect((await login(busy.subject)).status).toBe(200);

    // Staff, through the page: refused after the password, nothing changes.
    const staff = await form({ username: m.supervisors[0]!.subject, password: PASSWORD, confirm: 'yes' });
    expect(staff.status).toBe(403);
    expect((await login(m.supervisors[0]!.subject)).status).toBe(200);
  });
});
