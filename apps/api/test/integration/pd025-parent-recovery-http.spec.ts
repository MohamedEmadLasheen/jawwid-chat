/**
 * PD-25 over real HTTP: a parent recovers their own account from the sign-in
 * screen, with real routes, the real limiter, the real database rules -- and
 * capturing senders in place of SMTP and WhatsApp.
 *
 *   - forgot password: a code is e-mailed to the sign-in address; the PD-21
 *     completion sets the password and ends every old session;
 *   - forgot e-mail: a code goes by WhatsApp to the phone ON FILE (however the
 *     parent spaces it); the code reveals the sign-in e-mail and then still sets
 *     a password; wrong guesses at either step spend the same five tries;
 *   - nothing is said or sent for an unknown e-mail or phone, a teacher, staff,
 *     or a suspended parent -- and the answer is the same every time;
 *   - the resend wait, the channel switches, and the database refusing a
 *     self-service code for anyone but a parent.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { AuthErrorCode } from '@platform/auth/auth.errors';
import { LoginRateLimiter } from '@platform/auth/login-rate-limit';
import { hashPassword } from '@platform/auth/password';
import { RESET_AUDIT } from '@platform/auth/password-reset.service';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { AccountRecoveryModule } from '../../src/account-recovery/account-recovery.module';
import { RECOVERY_MAILER, RECOVERY_WHATSAPP, type RecoverySender } from '../../src/account-recovery/recovery-delivery';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd25-http-spec-password-1';
const NEW_PASSWORD = 'pd25-chosen-by-the-parent-2';
const DOMAIN = 'pd25http.qa.jawwid.test';
/** Stored the way staff type it; the parent types it in another shape. */
const PHONE_ON_FILE = '010 0555 0123';
const PHONE_E164 = '+201005550123';

class Capture implements RecoverySender {
  available = true;
  readonly sent: Array<{ to: string; code: string }> = [];
  async sendCode(to: string, code: string): Promise<void> {
    this.sent.push({ to, code });
  }
}
const mail = new Capture();
const whatsapp = new Capture();

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = body !== undefined ? { 'content-type': 'application/json' } : {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  return { status: r.status, code: json.error?.code, json };
}

async function login(username: string, password: string) {
  const r = await call('POST', '/auth/login', { username, password });
  return { status: r.status, code: r.code, accessToken: (r.json.accessToken as string) ?? '' };
}

/** Delivery runs after the answer; give it the turn it needs. */
async function delivered(c: Capture, count: number): Promise<void> {
  for (let i = 0; i < 100 && c.sent.length < count; i++) await new Promise((r) => setTimeout(r, 10));
}

const accountIdOf = async (subject: string) =>
  (await g.prisma.account.findUniqueOrThrow({ where: { subject }, select: { id: true } })).id;

/** Each test starts with no codes, so the resend wait and hourly cap begin at zero. */
async function clearCodes(): Promise<void> {
  await g.prisma.$executeRawUnsafe('alter table chat.password_reset_code disable trigger password_reset_code_is_coherent');
  await g.prisma.$executeRawUnsafe('delete from chat.password_reset_code');
  await g.prisma.$executeRawUnsafe('alter table chat.password_reset_code enable trigger password_reset_code_is_coherent');
  mail.sent.length = 0;
  whatsapp.sent.length = 0;
  mail.available = true;
  whatsapp.available = true;
  // The limiter is real and these tests reuse one phone; clear only its own buckets.
  if (app) await app.get(LoginRateLimiter).clearIdentifier(`recover-phone:${PHONE_E164.slice(-9)}`);
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd25h-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd25h-${orgId.slice(0, 8)}', 'PD-25 HTTP QA academy')`,
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
  // The administration's record of the first parent: the phone the academy already holds.
  await g.prisma.$executeRawUnsafe(
    `insert into chat.parent_file (contact_id, organization_id, phone) values ($1::uuid, $2::uuid, $3)
     on conflict (contact_id) do update set phone = excluded.phone`,
    m.families[0]!.parent.id,
    orgId,
    PHONE_ON_FILE,
  );

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, AccountRecoveryModule],
  })
    .overrideProvider(RECOVERY_MAILER)
    .useValue(mail)
    .overrideProvider(RECOVERY_WHATSAPP)
    .useValue(whatsapp)
    .compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});

beforeEach(clearCodes);

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd25h-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('PD-25 options', () => {
  it('say which ways in this deployment offers, the same for everyone, without signing in', async () => {
    expect((await call('GET', '/auth/recovery/options')).json).toEqual({ email: true, whatsapp: true, codeMinutes: 10 });
    whatsapp.available = false;
    expect((await call('GET', '/auth/recovery/options')).json).toEqual({ email: true, whatsapp: false, codeMinutes: 10 });
  });
});

describe('PD-25 forgot password (e-mail)', () => {
  it('e-mails a code to the sign-in address; the code sets a new password and ends every old session', async () => {
    const parent = m.families[0]!.parent;
    const before = await login(parent.subject, PASSWORD);
    expect(before.status).toBe(200);

    const r = await call('POST', '/auth/recovery/password', { email: `  ${parent.subject.toUpperCase()} ` });
    expect({ status: r.status, json: r.json }).toEqual({ status: 200, json: { ok: true } });
    await delivered(mail, 1);
    expect(mail.sent).toEqual([{ to: parent.subject, code: expect.stringMatching(/^[0-9]{6}$/) }]);

    const row = await g.prisma.passwordResetCode.findFirstOrThrow({ where: { accountId: await accountIdOf(parent.subject) } });
    expect({ channel: row.channel, issuedBy: row.issuedBy }).toEqual({ channel: 'email', issuedBy: null });
    expect(row.codeHash).not.toContain(mail.sent[0]!.code);

    const done = await call('POST', '/auth/password-reset', { username: parent.subject, code: mail.sent[0]!.code, password: NEW_PASSWORD });
    expect(done.status).toBe(200);
    expect((await call('GET', '/me', undefined, before.accessToken)).status).toBe(401);
    expect((await login(parent.subject, PASSWORD)).status).toBe(401);
    expect((await login(parent.subject, NEW_PASSWORD)).status).toBe(200);

    const audits = await g.prisma.auditLog.findMany({
      where: { entity: 'account', entityId: row.accountId, action: { in: [RESET_AUDIT.RECOVERY_SENT, RESET_AUDIT.COMPLETED] } },
      orderBy: { id: 'asc' },
    });
    expect(audits.map((a) => a.action)).toEqual([RESET_AUDIT.RECOVERY_SENT, RESET_AUDIT.COMPLETED]);
    const auditText = JSON.stringify(audits, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    expect(auditText).not.toContain(mail.sent[0]!.code);
    expect(auditText).not.toContain(parent.subject);

    // Put the shared password back for the tests that follow.
    await g.prisma.accountCredential.update({ where: { accountId: row.accountId }, data: { passwordHash: await hashPassword(PASSWORD) } });
  });

  it('answers the same, and sends nothing, for an unknown e-mail, a teacher, staff, or a suspended parent', async () => {
    const suspended = m.families[2]!.parent.subject;
    await g.prisma.account.update({ where: { subject: suspended }, data: { status: 'suspended', isActive: false } });
    try {
      for (const email of [`nobody@${DOMAIN}`, m.teachers[0]!.subject, m.supervisors[0]!.subject, suspended, 'not an e-mail']) {
        const r = await call('POST', '/auth/recovery/password', { email });
        expect({ email, status: r.status, json: r.json }).toEqual({ email, status: 200, json: { ok: true } });
      }
      await new Promise((r) => setTimeout(r, 50));
      expect(mail.sent).toEqual([]);
      expect(await g.prisma.passwordResetCode.count()).toBe(0);
    } finally {
      await g.prisma.account.update({ where: { subject: suspended }, data: { status: 'active', isActive: true } });
    }
  });

  it('a second request inside the resend wait sends nothing new, and the first code still works', async () => {
    const parent = m.families[1]!.parent;
    await call('POST', '/auth/recovery/password', { email: parent.subject });
    await call('POST', '/auth/recovery/password', { email: parent.subject });
    await delivered(mail, 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.sent).toHaveLength(1);
    expect(await g.prisma.passwordResetCode.count({ where: { accountId: await accountIdOf(parent.subject) } })).toBe(1);
  });

  it('issues nothing while e-mail is switched off', async () => {
    mail.available = false;
    expect((await call('POST', '/auth/recovery/password', { email: m.families[1]!.parent.subject })).json).toEqual({ ok: true });
    expect(await g.prisma.passwordResetCode.count()).toBe(0);
  });
});

describe('PD-25 forgot e-mail (WhatsApp)', () => {
  it('sends a code to the phone ON FILE, reveals the sign-in e-mail, and the same code then sets a password', async () => {
    const parent = m.families[0]!.parent;
    const r = await call('POST', '/auth/recovery/email', { phone: PHONE_E164.replace('+20', '+20 ') });
    expect({ status: r.status, json: r.json }).toEqual({ status: 200, json: { ok: true } });
    await delivered(whatsapp, 1);
    expect(whatsapp.sent).toEqual([{ to: PHONE_E164, code: expect.stringMatching(/^[0-9]{6}$/) }]);
    const code = whatsapp.sent[0]!.code;

    const wrong = await call('POST', '/auth/recovery/email/verify', { phone: '01005550123', code: code === '000000' ? '111111' : '000000' });
    expect({ status: wrong.status, code: wrong.code }).toEqual({ status: 401, code: AuthErrorCode.RESET_CODE_INVALID });

    const ok = await call('POST', '/auth/recovery/email/verify', { phone: '01005550123', code });
    expect({ status: ok.status, json: ok.json }).toEqual({ status: 200, json: { emails: [parent.subject] } });
    const row = await g.prisma.passwordResetCode.findFirstOrThrow({ where: { accountId: await accountIdOf(parent.subject) } });
    expect({ channel: row.channel, attempts: row.attempts, verified: row.verifiedAt !== null, used: row.usedAt }).toEqual({
      channel: 'whatsapp',
      attempts: 1,
      verified: true,
      used: null,
    });

    // Signing in with the old password is still the parent's choice...
    expect((await login(parent.subject, PASSWORD)).status).toBe(200);
    // ...or the same code sets a new one.
    const done = await call('POST', '/auth/password-reset', { username: parent.subject, code, password: NEW_PASSWORD });
    expect(done.status).toBe(200);
    expect((await login(parent.subject, NEW_PASSWORD)).status).toBe(200);
    await g.prisma.accountCredential.update({ where: { accountId: row.accountId }, data: { passwordHash: await hashPassword(PASSWORD) } });
  });

  it('answers the same, and sends nothing, for a phone nobody has on file', async () => {
    for (const phone of ['+201009990000', '12', 'call me']) {
      const r = await call('POST', '/auth/recovery/email', { phone });
      expect({ phone, status: r.status, json: r.json }).toEqual({ phone, status: 200, json: { ok: true } });
    }
    const v = await call('POST', '/auth/recovery/email/verify', { phone: '+201009990000', code: '123456' });
    expect({ status: v.status, code: v.code }).toEqual({ status: 401, code: AuthErrorCode.RESET_CODE_INVALID });
    await new Promise((r) => setTimeout(r, 50));
    expect(whatsapp.sent).toEqual([]);
  });

  it('five wrong guesses spend the code, and the right code is then refused too', async () => {
    await call('POST', '/auth/recovery/email', { phone: PHONE_E164 });
    await delivered(whatsapp, 1);
    const code = whatsapp.sent[0]!.code;
    const wrong = code === '999999' ? '888888' : '999999';
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/auth/recovery/email/verify', { phone: PHONE_E164, code: wrong })).status).toBe(401);
    }
    expect((await call('POST', '/auth/recovery/email/verify', { phone: PHONE_E164, code })).status).toBe(401);
    expect((await call('POST', '/auth/password-reset', { username: m.families[0]!.parent.subject, code, password: NEW_PASSWORD })).status).toBe(401);
  });

  it('a code e-mailed for the password is not a WhatsApp code', async () => {
    await call('POST', '/auth/recovery/password', { email: m.families[0]!.parent.subject });
    await delivered(mail, 1);
    const v = await call('POST', '/auth/recovery/email/verify', { phone: PHONE_E164, code: mail.sent[0]!.code });
    expect(v.code).toBe(AuthErrorCode.RESET_CODE_INVALID);
  });

  it('issues nothing while WhatsApp is switched off', async () => {
    whatsapp.available = false;
    expect((await call('POST', '/auth/recovery/email', { phone: PHONE_E164 })).json).toEqual({ ok: true });
    expect(await g.prisma.passwordResetCode.count()).toBe(0);
  });
});

describe('PD-25 database rules', () => {
  it('refuses a self-service code for a teacher or staff account, and an admin code without an issuer', async () => {
    const expiresAt = new Date(Date.now() + 600_000);
    for (const subject of [m.teachers[0]!.subject, m.supervisors[0]!.subject]) {
      await expect(
        g.prisma.passwordResetCode.create({
          data: { organizationId: orgId, accountId: await accountIdOf(subject), channel: 'email', codeHash: 'a'.repeat(64), reason: 'x', expiresAt },
        }),
      ).rejects.toThrow(/only a parent account recovers itself/);
    }
    await expect(
      g.prisma.passwordResetCode.create({
        data: { organizationId: orgId, accountId: await accountIdOf(m.families[0]!.parent.subject), channel: 'admin', codeHash: 'a'.repeat(64), reason: 'x', expiresAt },
      }),
    ).rejects.toThrow(/issued by active staff/);
  });
});
