/**
 * PD-58 (ENG-10) over real HTTP: the Terms of Use API, the gate and the
 * fail-closed configuration (roadmap 2026-11-03 §7.3-7.6; owner decision A-3).
 *
 *   1. every way an account is created -- a PD-42 intake family, a teacher
 *      from POST /teachers activated by its first-login code, a staff account
 *      from POST /admin/staff-accounts, a Sales account, the bootstrap Super
 *      Admin and a seeded account -- first sees exactly its kind's terms plus
 *      the Code of Conduct (GET /me, and the login answer);
 *   2. before acceptance EVERY @RequiresLegal() route answers 403
 *      COMM.TERMS_NOT_ACCEPTED (walked from Nest's route metadata); after it,
 *      none does, and a message is sent;
 *   3. another kind's terms are 400, a stale version 409, a malformed body 400;
 *   4. a new Code of Conduct asks every kind again, new teacher terms ask
 *      teachers only; old acceptances stay, with their times;
 *   5. PD-16 sign-up: 400 without acceptLegal; with it the parent starts
 *      accepted, AND the lesson-audio notice is recorded separately;
 *   6. a support (impersonation) session cannot accept;
 *   7. reading, the parent notices, account deletion and signing out work
 *      without acceptance;
 *   8. acceptance rows are never updated or deleted, and survive erasure;
 *   9. production: the boot check refuses a missing `legal.current.*` row,
 *      and a gated route answers 503 rather than "nothing required".
 *
 * ENG-10 (2026-11-07) adds: GET /me/legal (2b); the account is the token's,
 * never the body's (2c); LD-11, a child-safety report is accepted without
 * acceptance while every other report and a block are gated (2d); P-3,
 * requires_reacceptance (4b); P-2, the method recorded (gate / signup).
 *
 * The versions and URLs are synthetic FIXTURES (qa-*, jawwid.test), never the
 * owner's (N-3). Synthetic people only (G-20).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { hashPassword } from '@platform/auth/password';
import { CommErrorCode } from '@platform/errors';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { TeacherFileModule } from '../../src/teacher-file/teacher-file.module';
import { LessonModule } from '../../src/lessons/lesson.module';
import { StaffAccountsModule } from '../../src/staff-accounts/staff-accounts.module';
import { WhiteboardModule } from '../../src/whiteboards/whiteboard.module';
import { BillingModule } from '../../src/billing/billing.module';
import { ScheduledCallModule } from '../../src/scheduled-calls/scheduled-call.module';
import { AccountDeletionModule } from '../../src/account-deletion/account-deletion.module';
import { AccountAdminModule } from '../../src/account-admin/account-admin.module';
import { LessonAudioModule } from '../../src/lesson-audio/lesson-audio.module';
import { ModerationModule } from '../../src/moderation/moderation.module';
import { RewardModule } from '../../src/rewards/reward.module';
import { CertificateModule } from '../../src/certificates/certificate.module';
import { StaffProfileModule } from '../../src/staff-profile/staff-profile.module';
import { PARENT_NOTICES } from '../../src/lesson-audio/parent-notices';
import { FIRST_LOGIN_MAILER, type MailSender } from '../../src/account-recovery/recovery-delivery';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { bootstrapSuperAdmin } from '../../src/cli/super-admin-bootstrap';
import { LegalService } from '../../src/legal/legal.service';
import { REQUIRES_LEGAL } from '../../src/legal/requires-legal.decorator';
import { documentsFor, type AccountKind, type LegalDocumentKey } from '../../src/legal/legal-documents';
import { collectRoutes } from '../support/route-inventory';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const inheritedAppEnv = process.env.APP_ENV;
const PASSWORD = 'pd58-legal-spec-password-1';
const DOMAIN = 'pd58legal.qa.jawwid.test';
const SLUG = 'pd58l-';
const RUN = randomUUID().slice(0, 8);

const g = buildGraph();
let m: SeedManifest;
let orgId: string;
let app: INestApplication;
let base: string;

const mailer: MailSender = { get available() { return false; }, async send() {} } as MailSender;

/** The fixture version in force for each document, as this spec set it. */
const current = new Map<LegalDocumentKey, string>();
const fixtureUrl = (lang: string, key: string, version: string) => `https://jawwid.test/${lang}/${key}/${version}`;

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Publishes a fixture version (P-1 fingerprints of the fixture URL text; P-3
 * requiresReacceptance) and names it in force. Each call is its own
 * transaction, so each version has its own created_at: the order the gate
 * reads versions in (effective_at, then created_at).
 */
async function setCurrent(key: LegalDocumentKey, label: string, requiresReacceptance = true): Promise<string> {
  const version = `qa-${key}-${label}-${RUN}`;
  await g.prisma.$queryRawUnsafe(
    `select chat.publish_legal_version($1, $2, $3, $4, $5, $6, $7)`,
    key, version, fixtureUrl('ar', key, version), fixtureUrl('en', key, version),
    sha(`ar:${version}`), sha(`en:${version}`), requiresReacceptance,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.config (key, value, scope, description) values ($1, to_jsonb($2::text), 'legal', 'PD-58 spec fixture')
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    `legal.current.${key}`, version,
  );
  current.set(key, version);
  return version;
}

/** The `legal` block once everything is accepted (ENG-10 review: an explicit state). */
const ACCEPTED = { state: 'accepted', required: [], unavailable: [] };
/** The `legal` block while documents are outstanding. */
const pending = (required: unknown[]) => ({ state: 'required', required, unavailable: [] });

/** Publishes a fixture version WITHOUT naming it in force; `effectiveAt` is SQL (e.g. a backdated time). */
const publishSql = (key: LegalDocumentKey, version: string, requiresReacceptance = true, effectiveAt = 'null') =>
  g.prisma.$queryRawUnsafe(
    `select chat.publish_legal_version($1, $2, $3, $4, $5, $6, $7, ${effectiveAt})`,
    key, version, fixtureUrl('ar', key, version), fixtureUrl('en', key, version),
    sha(`ar:${version}`), sha(`en:${version}`), requiresReacceptance,
  );
const nameInForce = async (key: LegalDocumentKey, version: string) => {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.config (key, value, scope, description) values ($1, to_jsonb($2::text), 'legal', 'PD-58 spec fixture')
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    `legal.current.${key}`, version,
  );
  current.set(key, version);
};

/** What a kind must accept when it has accepted nothing in force. */
const expectedFor = (kind: AccountKind) =>
  documentsFor(kind).map((key) => ({
    documentKey: key,
    version: current.get(key)!,
    urlAr: fixtureUrl('ar', key, current.get(key)!),
    urlEn: fixtureUrl('en', key, current.get(key)!),
  }));

const docsOf = (kind: AccountKind, keys: readonly LegalDocumentKey[] = documentsFor(kind)) =>
  keys.map((documentKey) => ({ documentKey, version: current.get(documentKey)! }));

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const send = body !== undefined && method !== 'GET';
  const headers: Record<string, string> = send ? { 'content-type': 'application/json' } : {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: send ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: Record<string, any> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, any>) : {};
  } catch {
    json = {};
  }
  return { status: r.status, code: (json.error?.code as string | undefined) ?? undefined, json };
}

async function login(subject: string, password = PASSWORD) {
  const r = await call(null, 'POST', '/auth/login', { username: subject, password });
  if (r.status !== 200) throw new Error(`login ${subject}: ${r.status} ${r.code}`);
  return { token: r.json.accessToken as string, json: r.json };
}

const accept = (token: string, documents: unknown, client: unknown = 'android', locale: unknown = 'ar') =>
  call(token, 'POST', '/me/legal/accept', { documents, client, locale });

const requiredOf = async (token: string) => (await call(token, 'GET', '/me')).json.legal?.required;

let seq = 0;
const email = (label: string) => `${label}-${++seq}@${DOMAIN}`;

/** A PD-42 intake family: an account Chat created, with no password yet. */
async function intakeFamily(): Promise<{ subject: string; accountId: string }> {
  const sup = await login(m.supervisors[0]!.subject);
  const subject = email('intake.parent');
  const r = await call(sup.token, 'POST', '/family-intake', {
    intakeId: randomUUID(),
    parent: { name: 'QA Intake Parent', email: subject },
    children: [{ name: 'QA Intake Child' }],
  });
  if (r.status !== 201 && r.status !== 200) throw new Error(`intake: ${r.status} ${r.code} ${JSON.stringify(r.json)}`);
  const account = await g.prisma.account.findUniqueOrThrow({ where: { subject }, select: { id: true, kind: true } });
  expect(account.kind).toBe('family');
  return { subject, accountId: account.id };
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await cleanLegal();
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where organization_id in (select id from chat.organization where slug like '${SLUG}%')`);
  await g.prisma.$executeRawUnsafe(`delete from chat.department where organization_id in (select id from chat.organization where slug like '${SLUG}%')`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, '${SLUG}${orgId.slice(0, 8)}', 'PD-58 QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });
  await g.prisma.$executeRawUnsafe(
    `insert into chat.config (key, value) values ('intake.contact_keys_ready', 'true'::jsonb) on conflict (key) do update set value = excluded.value`,
  );
  for (const key of ['terms_family', 'terms_teacher', 'terms_staff', 'code_of_conduct'] as const) await setCurrent(key, 'v1');

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [
      PlatformModule, AuthModule, CommunicationModule, TeacherFileModule, LessonModule, StaffAccountsModule,
      WhiteboardModule, BillingModule, ScheduledCallModule, AccountDeletionModule, AccountAdminModule, LessonAudioModule,
      ModerationModule, RewardModule, CertificateModule, StaffProfileModule,
    ],
  })
    .overrideProvider(FIRST_LOGIN_MAILER)
    .useValue(mailer)
    .compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});

async function cleanLegal(): Promise<void> {
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.test_truncate', 'on', true)`),
    g.prisma.$executeRawUnsafe(`truncate chat.terms_acceptance, chat.legal_document_version`),
  ]);
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key like 'legal.current.%'`);
}

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  if (inheritedAppEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = inheritedAppEnv;
  await truncate(g.prisma);
  await cleanLegal();
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key = 'intake.contact_keys_ready'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  // An erased account (sections 5 and 7) no longer carries this suite's subject.
  await g.prisma.$executeRawUnsafe(`delete from chat.account where organization_id in (select id from chat.organization where slug like '${SLUG}%')`);
  await g.prisma.$executeRawUnsafe(`delete from chat.department where organization_id in (select id from chat.organization where slug like '${SLUG}%')`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('1. every way an account is created asks for its own kind\'s terms plus the Code of Conduct', () => {
  async function firstSight(subject: string, kind: AccountKind, password = PASSWORD) {
    const signedIn = await login(subject, password);
    expect({ subject, legal: signedIn.json.legal }).toEqual({ subject, legal: pending(expectedFor(kind)) });
    expect(signedIn.json.actor.legal).toEqual(pending(expectedFor(kind)));
    const me = await call(signedIn.token, 'GET', '/me');
    expect(me.status).toBe(200);
    expect({ subject, legal: me.json.legal }).toEqual({ subject, legal: pending(expectedFor(kind)) });
  }

  it('a PD-42 intake family', async () => {
    const family = await intakeFamily();
    // Its password set by any path other than the PD-16 sign-up (which records
    // the acceptance itself, test 5) -- e.g. an administrator's reset.
    await g.prisma.accountCredential.create({ data: { accountId: family.accountId, passwordHash: await hashPassword(PASSWORD) } });
    await firstSight(family.subject, 'family');
  });

  it('a teacher created with POST /teachers and activated by its first-login code', async () => {
    const manager = await login(m.teachersManager.subject);
    const address = email('added.teacher');
    const created = await call(manager.token, 'POST', '/teachers', { id: randomUUID(), name: 'QA Legal Teacher', confirmSimilarName: true, email: address });
    expect(created.status).toBe(201);
    const redeemed = await call(null, 'POST', '/auth/password-reset', { username: address, code: created.json.firstLogin.code, password: PASSWORD });
    expect(redeemed.status).toBe(200);
    await firstSight(address, 'teacher');
  });

  it('a staff account from POST /admin/staff-accounts, activated by its setup code', async () => {
    const owner = await login(`owner@${DOMAIN}`);
    const address = email('staff.member');
    const created = await call(owner.token, 'POST', '/admin/staff-accounts', { name: 'QA Legal Staff', email: address, tier: 'specialist', reason: 'PD-58 spec' });
    expect(created.status).toBe(201);
    expect((await call(null, 'POST', '/auth/password-reset', { username: address, code: created.json.firstLogin.code, password: PASSWORD })).status).toBe(200);
    await firstSight(address, 'staff');
  });

  it('a Sales account (created by the Sales manager in the Sales department) and the seeded Sales manager', async () => {
    const sales = await login(m.salesManager.subject);
    const address = email('sales.member');
    const created = await call(sales.token, 'POST', '/admin/staff-accounts', {
      name: 'QA Legal Sales', email: address, tier: 'specialist', departmentId: m.departments.sales, reason: 'PD-58 spec',
    });
    expect(created.status).toBe(201);
    expect((await call(null, 'POST', '/auth/password-reset', { username: address, code: created.json.firstLogin.code, password: PASSWORD })).status).toBe(200);
    await firstSight(address, 'staff');
    await firstSight(m.salesManager.subject, 'staff');
  });

  it('the bootstrap Super Admin (cli/super-admin-bootstrap.ts)', async () => {
    const address = email('bootstrap.owner');
    const result = await bootstrapSuperAdmin(g.prisma, { email: address, password: PASSWORD, displayName: 'QA Bootstrap Owner' });
    expect(result.outcome).toBe('created');
    await firstSight(address, 'staff');
  });

  it('seeded accounts: a parent, a teacher, a supervisor and a manager', async () => {
    await firstSight(m.families[0]!.parent.subject, 'family');
    await firstSight(m.teachers[0]!.subject, 'teacher');
    await firstSight(m.supervisors[0]!.subject, 'staff');
    await firstSight(m.operationsManager.subject, 'staff');
  });

  it('GET /auth/signup/legal (public) lists what a new family accepts on the sign-up screen', async () => {
    const r = await call(null, 'GET', '/auth/signup/legal');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ required: expectedFor('family') });
  });
});

describe('2. before acceptance every gated route is refused; after it, none is', () => {
  const gatedRoutes = () => {
    const routes = collectRoutes();
    // Resolve the handler's metadata through the same require cache the app uses.
    return routes.filter((r) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(`../../src/${r.controller.split('#')[0]}`) as Record<string, { prototype: Record<string, unknown> }>;
      const ctor = mod[r.controller.split('#')[1]!]!;
      return Reflect.getMetadata(REQUIRES_LEGAL, ctor.prototype[r.handler] as object) === true || Reflect.getMetadata(REQUIRES_LEGAL, ctor) === true;
    });
  };
  const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, () => randomUUID());

  it('a parent who has not accepted gets 403 COMM.TERMS_NOT_ACCEPTED on EVERY @RequiresLegal() route, naming what to accept', async () => {
    const routes = gatedRoutes();
    expect(routes.length).toBeGreaterThan(40);
    const parent = await login(m.families[1]!.parent.subject);
    const wrong: string[] = [];
    for (const r of routes) {
      const res = await call(parent.token, r.method, concrete(r.path), {});
      if (res.status !== 403 || res.code !== CommErrorCode.TERMS_NOT_ACCEPTED) wrong.push(`${r.method} ${r.path} -> ${res.status} ${res.code}`);
    }
    expect(wrong).toEqual([]);
    const one = await call(parent.token, 'POST', `/conversations/${m.families[1]!.groups[0]!.conversationId}/messages`, { body: 'hello', clientMessageId: randomUUID() });
    expect(one.json.error.detail).toEqual({ required: expectedFor('family') });
  });

  it('a teacher and a staff member who have not accepted cannot post a message either', async () => {
    const family = m.families[2]!;
    const group = family.groups[0]!;
    const teacherSubject = m.teachers.find((t) => t.id === group.teacherIds[0])!.subject;
    const supervisorSubject = m.supervisors.find((s) => s.id === group.supervisorId)?.subject ?? m.operationsManager.subject;
    for (const subject of [teacherSubject, supervisorSubject]) {
      const who = await login(subject);
      const r = await call(who.token, 'POST', `/conversations/${group.conversationId}/messages`, { body: 'hello', clientMessageId: randomUUID() });
      expect({ subject, status: r.status, code: r.code }).toEqual({ subject, status: 403, code: CommErrorCode.TERMS_NOT_ACCEPTED });
    }
  });

  it('after accepting, the parent sends a message and no gated route answers TERMS_NOT_ACCEPTED', async () => {
    const family = m.families[1]!;
    const parent = await login(family.parent.subject);
    const accepted = await accept(parent.token, docsOf('family'));
    expect(accepted.status).toBe(200);
    expect(accepted.json).toEqual({ legal: ACCEPTED });
    expect(await requiredOf(parent.token)).toEqual([]);

    const sent = await call(parent.token, 'POST', `/conversations/${family.groups[0]!.conversationId}/messages`, { body: 'PD-58 accepted', clientMessageId: randomUUID() });
    expect(sent.status).toBe(201);

    const still: string[] = [];
    for (const r of gatedRoutes()) {
      const res = await call(parent.token, r.method, concrete(r.path), {});
      if (res.code === CommErrorCode.TERMS_NOT_ACCEPTED) still.push(`${r.method} ${r.path}`);
    }
    expect(still).toEqual([]);
  });

  it('the acceptance is recorded with document, version, the database\'s time, client and locale', async () => {
    const accountId = (await g.prisma.account.findUniqueOrThrow({ where: { subject: m.families[1]!.parent.subject } })).id;
    const rows = await g.prisma.$queryRawUnsafe<Array<{ document_key: string; version: string; client: string; locale: string; method: string; accepted_at: Date }>>(
      `select document_key, version, client, locale, method, accepted_at from chat.terms_acceptance where account_id = $1::uuid order by document_key`, accountId,
    );
    expect(rows.map(({ accepted_at, ...r }) => r)).toEqual([
      { document_key: 'code_of_conduct', version: current.get('code_of_conduct'), client: 'android', locale: 'ar', method: 'gate' },
      { document_key: 'terms_family', version: current.get('terms_family'), client: 'android', locale: 'ar', method: 'gate' },
    ]);
    for (const r of rows) expect(r.accepted_at).toBeInstanceOf(Date);
  });
});

describe('2b. GET /me/legal: the documents in force, their URLs and the account\'s state', () => {
  it('lists what is required and, per document, whether and when the account accepted it', async () => {
    const parent = await login(m.families[7]!.parent.subject);
    const before = await call(parent.token, 'GET', '/me/legal');
    expect(before.status).toBe(200);
    expect(before.json).toEqual({
      ...pending(expectedFor('family')),
      documents: expectedFor('family').map((d) => ({ ...d, accepted: false, acceptedVersion: null, acceptedAt: null })),
    });
    expect((await accept(parent.token, docsOf('family'))).status).toBe(200);
    const after = await call(parent.token, 'GET', '/me/legal');
    expect(after.json).toMatchObject(ACCEPTED);
    expect(after.json.documents).toHaveLength(2);
    for (const d of after.json.documents as Array<Record<string, unknown>>) {
      expect(d).toMatchObject({ accepted: true, acceptedVersion: d.version });
      expect(Number.isNaN(Date.parse(String(d.acceptedAt)))).toBe(false);
    }
  });
});

describe('2c. the account is the token\'s, never the body\'s', () => {
  const idOf = async (subject: string) => (await g.prisma.account.findUniqueOrThrow({ where: { subject } })).id;
  const rowsOf = async (accountId: string) =>
    (await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int as n from chat.terms_acceptance where account_id = $1::uuid`, accountId))[0]!.n;

  it('a body that names an account is refused (400) and records nothing for either account', async () => {
    const caller = await login(m.families[8]!.parent.subject);
    const otherId = await idOf(m.families[9]!.parent.subject);
    for (const field of ['accountId', 'account_id', 'p_account_id']) {
      const r = await call(caller.token, 'POST', '/me/legal/accept', { documents: docsOf('family'), client: 'android', locale: 'ar', [field]: otherId });
      expect({ field, status: r.status, code: r.code }).toEqual({ field, status: 400, code: CommErrorCode.VALIDATION });
    }
    expect(await rowsOf(otherId)).toBe(0);
    expect(await rowsOf(await idOf(m.families[8]!.parent.subject))).toBe(0);
  });

  it('an acceptance is recorded for the token\'s account only', async () => {
    const caller = await login(m.families[8]!.parent.subject);
    const other = await login(m.families[9]!.parent.subject);
    expect((await accept(caller.token, docsOf('family'))).json).toEqual({ legal: ACCEPTED });
    expect(await rowsOf(await idOf(m.families[8]!.parent.subject))).toBe(2);
    expect(await rowsOf(await idOf(m.families[9]!.parent.subject))).toBe(0);
    expect(await requiredOf(other.token)).toEqual(expectedFor('family'));
  });
});

describe('2d. LD-11: a child-safety report is always accepted; every other report, and a block, is gated', () => {
  it('a parent who accepted nothing reports a child-safety concern, but no other report and no block', async () => {
    const f = m.families[10]!;
    const teacherId = f.groups[0]!.teacherIds[0]!;
    const parent = await login(f.parent.subject);
    expect(await requiredOf(parent.token)).toEqual(expectedFor('family'));
    const person = (reason: string) => ({ targetKind: 'person', subject: { kind: 'teacher', id: teacherId }, reason, note: 'PD-58 spec' });

    for (const reason of ['harassment', 'inappropriate', 'spam', 'other']) {
      const r = await call(parent.token, 'POST', '/reports', person(reason));
      expect({ reason, status: r.status, code: r.code }).toEqual({ reason, status: 403, code: CommErrorCode.TERMS_NOT_ACCEPTED });
    }
    const blocked = await call(parent.token, 'POST', '/me/blocks', { subject: { kind: 'teacher', id: teacherId } });
    expect({ status: blocked.status, code: blocked.code }).toEqual({ status: 403, code: CommErrorCode.TERMS_NOT_ACCEPTED });

    const safety = await call(parent.token, 'POST', '/reports', person('child_safety'));
    expect(safety.status).toBe(201);
    expect(await g.prisma.contentReport.count({ where: { id: safety.json.id, reason: 'child_safety' } })).toBe(1);
    // The exception is the reason, not the route: a malformed child-safety
    // report is still validated by the service, never waved through.
    const malformed = await call(parent.token, 'POST', '/reports', { reason: 'child_safety' });
    expect({ status: malformed.status, code: malformed.code }).toEqual({ status: 400, code: CommErrorCode.VALIDATION });

    expect((await accept(parent.token, docsOf('family'))).json).toEqual({ legal: ACCEPTED });
    // 200: the child-safety report about this person is still open, so the service answers with it (§5.4).
    expect((await call(parent.token, 'POST', '/reports', person('spam'))).status).toBe(200);
    expect((await call(parent.token, 'POST', '/me/blocks', { subject: { kind: 'teacher', id: teacherId } })).status).toBe(201);
  });
});

describe('2e. ENG-10 review: a call card, joining a call and a staff profile are gated too', () => {
  it('a parent who has not accepted cannot post a scheduled-call card, accept a call or take a call token', async () => {
    const f = m.families[13]!;
    const parent = await login(f.parent.subject);
    expect(await requiredOf(parent.token)).toEqual(expectedFor('family'));
    for (const [method, path, body] of [
      ['POST', '/scheduled-calls', { conversationId: f.groups[0]!.conversationId, kind: 'link', title: 'PD-58 spec call' }],
      ['POST', `/calls/${randomUUID()}/accept`, {}],
      ['POST', `/calls/${randomUUID()}/token`, {}],
    ] as const) {
      const r = await call(parent.token, method, path, body);
      expect({ path, status: r.status, code: r.code }).toEqual({ path, status: 403, code: CommErrorCode.TERMS_NOT_ACCEPTED });
    }
  });

  it('a staff member who has not accepted cannot change their profile text or photo', async () => {
    const staff = await login(m.teachersManager.subject);
    for (const [method, path, body] of [
      ['PATCH', '/staff-profiles/me', { bio: 'PD-58 spec' }],
      ['POST', '/staff-profiles/me/avatar/upload', { mimeType: 'image/jpeg', byteSize: 1000 }],
      ['POST', '/staff-profiles/me/avatar', { objectKey: 'x' }],
      ['DELETE', '/staff-profiles/me/avatar', undefined],
    ] as const) {
      const r = await call(staff.token, method, path, body);
      expect({ path: `${method} ${path}`, status: r.status, code: r.code }).toEqual({ path: `${method} ${path}`, status: 403, code: CommErrorCode.TERMS_NOT_ACCEPTED });
    }
  });
});

describe('3. the wrong documents, a stale version, a malformed body', () => {
  it('another kind\'s terms are 400 LEGAL_WRONG_DOCUMENTS; nothing is recorded', async () => {
    const parent = await login(m.families[3]!.parent.subject);
    for (const documents of [
      [{ documentKey: 'terms_teacher', version: current.get('terms_teacher') }, { documentKey: 'code_of_conduct', version: current.get('code_of_conduct') }],
      [{ documentKey: 'code_of_conduct', version: current.get('code_of_conduct') }],
      [...docsOf('family'), { documentKey: 'terms_family', version: current.get('terms_family') }],
      [{ documentKey: 'privacy_policy', version: 'x' }],
    ]) {
      const r = await accept(parent.token, documents);
      expect({ documents, status: r.status, code: r.code }).toEqual({ documents, status: 400, code: CommErrorCode.LEGAL_WRONG_DOCUMENTS });
    }
    expect(await requiredOf(parent.token)).toEqual(expectedFor('family'));
  });

  it('a version that is not the one in force is 409 LEGAL_VERSION_STALE', async () => {
    const parent = await login(m.families[3]!.parent.subject);
    const r = await accept(parent.token, [{ documentKey: 'terms_family', version: 'qa-not-in-force' }, docsOf('family')[1]]);
    expect({ status: r.status, code: r.code }).toEqual({ status: 409, code: CommErrorCode.LEGAL_VERSION_STALE });
  });

  it('a missing client or locale, or no documents, is 400 COMMON.VALIDATION', async () => {
    const parent = await login(m.families[3]!.parent.subject);
    for (const [documents, client, locale] of [
      [docsOf('family'), null, 'ar'],
      [docsOf('family'), 'web', 'ar'],
      [docsOf('family'), 'android', 'Arabic'],
      [[], 'android', 'ar'],
      ['terms_family', 'android', 'ar'],
    ] as const) {
      const r = await accept(parent.token, documents, client, locale);
      expect({ status: r.status, code: r.code }).toEqual({ status: 400, code: CommErrorCode.VALIDATION });
    }
  });
});

describe('4. a new version asks exactly the affected accounts again', () => {
  const people = () => ({
    family: m.families[4]!.parent.subject,
    teacher: m.teachers[1]!.subject,
    staff: m.supervisors[1]!.subject,
  });

  it('a new Code of Conduct asks every kind; new teacher terms ask teachers only; old acceptances stay', async () => {
    const tokens: Record<AccountKind, string> = { family: '', teacher: '', staff: '' };
    for (const [kind, subject] of Object.entries(people()) as Array<[AccountKind, string]>) {
      tokens[kind] = (await login(subject)).token;
      expect((await accept(tokens[kind], docsOf(kind))).json).toEqual({ legal: ACCEPTED });
    }
    const teacherId = (await g.prisma.account.findUniqueOrThrow({ where: { subject: people().teacher } })).id;
    const before = await g.prisma.$queryRawUnsafe<Array<{ document_key: string; version: string; accepted_at: Date }>>(
      `select document_key, version, accepted_at from chat.terms_acceptance where account_id = $1::uuid order by document_key`, teacherId,
    );

    await setCurrent('code_of_conduct', 'v2');
    for (const kind of ['family', 'teacher', 'staff'] as const) {
      expect({ kind, required: await requiredOf(tokens[kind]) }).toEqual({
        kind,
        required: expectedFor(kind).filter((d) => d.documentKey === 'code_of_conduct'),
      });
      // Sending only the outstanding document is enough.
      expect((await accept(tokens[kind], docsOf(kind, ['code_of_conduct']))).json).toEqual({ legal: ACCEPTED });
    }

    await setCurrent('terms_teacher', 'v2');
    expect(await requiredOf(tokens.teacher)).toEqual(expectedFor('teacher').filter((d) => d.documentKey === 'terms_teacher'));
    expect(await requiredOf(tokens.family)).toEqual([]);
    expect(await requiredOf(tokens.staff)).toEqual([]);
    // The full set again is accepted too (the Code of Conduct is already done: a no-op).
    expect((await accept(tokens.teacher, docsOf('teacher'))).json).toEqual({ legal: ACCEPTED });

    const after = await g.prisma.$queryRawUnsafe<Array<{ document_key: string; version: string; accepted_at: Date }>>(
      `select document_key, version, accepted_at from chat.terms_acceptance where account_id = $1::uuid order by document_key, accepted_at`, teacherId,
    );
    expect(after).toHaveLength(4);
    for (const old of before) {
      const kept = after.find((r) => r.document_key === old.document_key && r.version === old.version);
      expect(kept?.accepted_at.toISOString()).toBe(old.accepted_at.toISOString());
    }
  });
});

describe('4b. P-3: a version that does not require re-acceptance asks nobody again; one that does, asks everybody', () => {
  it('requires_reacceptance false keeps an earlier acceptance good; a later true version refuses the gated route again', async () => {
    const f = m.families[11]!;
    const parent = await login(f.parent.subject);
    const conversation = f.groups[0]!.conversationId;
    const send = () => call(parent.token, 'POST', `/conversations/${conversation}/messages`, { body: 'PD-58 P-3', clientMessageId: randomUUID() });
    expect((await accept(parent.token, docsOf('family'))).json).toEqual({ legal: ACCEPTED });
    expect((await send()).status).toBe(201);

    const typoFix = await setCurrent('terms_family', 'typo-fix', false);
    expect(await requiredOf(parent.token)).toEqual([]);
    expect((await send()).status).toBe(201);
    // An account that accepted nothing is asked for the version in force; accepting it is enough.
    const newcomer = await login(m.families[12]!.parent.subject);
    expect(await requiredOf(newcomer.token)).toEqual(expectedFor('family'));
    expect((await accept(newcomer.token, docsOf('family'))).json).toEqual({ legal: ACCEPTED });
    // A second non-material version: still nobody.
    await setCurrent('terms_family', 'typo-fix-2', false);
    expect(await requiredOf(parent.token)).toEqual([]);
    expect(await requiredOf(newcomer.token)).toEqual([]);

    await setCurrent('terms_family', 'material', true);
    const termsOnly = expectedFor('family').filter((d) => d.documentKey === 'terms_family');
    expect(await requiredOf(parent.token)).toEqual(termsOnly);
    expect(await requiredOf(newcomer.token)).toEqual(termsOnly);
    const refused = await send();
    expect({ status: refused.status, code: refused.code }).toEqual({ status: 403, code: CommErrorCode.TERMS_NOT_ACCEPTED });
    // Only the version in force is accepted: an older one is stale.
    const stale = await accept(parent.token, [{ documentKey: 'terms_family', version: typoFix }]);
    expect({ status: stale.status, code: stale.code }).toEqual({ status: 409, code: CommErrorCode.LEGAL_VERSION_STALE });
    expect((await accept(parent.token, docsOf('family', ['terms_family']))).json).toEqual({ legal: ACCEPTED });
    expect((await send()).status).toBe(201);
  });
});

describe('4c. ENG-10 review: versions are ordered by publication, never by a supplied time or by name', () => {
  it('a version backdated before the latest of its document is refused by the database', async () => {
    const key = 'terms_staff' as const;
    const latest = current.get(key)!;
    await expect(
      publishSql(key, `qa-${key}-backdated-${RUN}`, true,
        `(select effective_at - interval '1 day' from chat.legal_document_version where document_key = 'terms_staff' and version = '${latest}')`),
    ).rejects.toThrow(/effective_at/);
    // The same time is allowed (two versions published together share it).
    await expect(
      publishSql(key, `qa-${key}-same-time-${RUN}`, true,
        `(select effective_at from chat.legal_document_version where document_key = 'terms_staff' and version = '${latest}')`),
    ).resolves.toBeDefined();
    await nameInForce(key, latest);
  });

  it('two versions published in one transaction keep their order: v10 after v9, whatever the names sort as', async () => {
    const key = 'code_of_conduct' as const;
    const v9 = `qa-${key}-v9-${RUN}`;
    const v10 = `qa-${key}-v10-${RUN}`;
    expect(v10 < v9).toBe(true); // by text, v10 sorts first: the trap
    await g.prisma.$transaction([publishSql(key, v9), publishSql(key, v10)]);
    const seq = await g.prisma.$queryRawUnsafe<Array<{ version: string }>>(
      `select version from chat.legal_document_version where document_key = $1 and version in ($2, $3) order by publish_seq`, key, v9, v10,
    );
    expect(seq.map((r) => r.version)).toEqual([v9, v10]);

    await nameInForce(key, v9);
    const parent = await login(m.families[14]!.parent.subject);
    expect((await accept(parent.token, docsOf('family'))).json).toEqual({ legal: ACCEPTED });

    // v10 requires acceptance and was published after v9: accepting v9 is not enough.
    await nameInForce(key, v10);
    expect(await requiredOf(parent.token)).toEqual(expectedFor('family').filter((d) => d.documentKey === key));
    const refused = await call(parent.token, 'POST', `/conversations/${m.families[14]!.groups[0]!.conversationId}/messages`, { body: 'PD-58 order', clientMessageId: randomUUID() });
    expect({ status: refused.status, code: refused.code }).toEqual({ status: 403, code: CommErrorCode.TERMS_NOT_ACCEPTED });
    expect((await accept(parent.token, docsOf('family', [key]))).json).toEqual({ legal: ACCEPTED });
  });
});

describe('5. PD-16 sign-up records the acceptance, and the lesson-audio notice separately', () => {
  async function codeFor(subject: string, accountId: string): Promise<string> {
    expect((await call(null, 'POST', '/auth/signup/request', { email: subject })).status).toBe(200);
    return (await g.prisma.parentSignupCode.findFirstOrThrow({ where: { accountId, usedAt: null, supersededAt: null } })).relayCode!;
  }

  it('without acceptLegal the sign-up is 400 LEGAL_REQUIRED and nothing is set', async () => {
    const family = await intakeFamily();
    const code = await codeFor(family.subject, family.accountId);
    const r = await call(null, 'POST', '/auth/signup/verify', { email: family.subject, code, password: PASSWORD, lessonAudioNotice: PARENT_NOTICES.lesson_audio });
    expect({ status: r.status, code: r.code }).toEqual({ status: 400, code: CommErrorCode.LEGAL_REQUIRED });
    expect(await g.prisma.accountCredential.count({ where: { accountId: family.accountId } })).toBe(0);
    // Another kind's terms, or a stale version, are refused the same way /me/legal/accept refuses them.
    const wrong = await call(null, 'POST', '/auth/signup/verify', {
      email: family.subject, code, password: PASSWORD, client: 'android', locale: 'ar',
      acceptLegal: [{ documentKey: 'terms_staff', version: current.get('terms_staff') }, docsOf('family')[1]],
    });
    expect({ status: wrong.status, code: wrong.code }).toEqual({ status: 400, code: CommErrorCode.LEGAL_WRONG_DOCUMENTS });
    const stale = await call(null, 'POST', '/auth/signup/verify', {
      email: family.subject, code, password: PASSWORD, client: 'android', locale: 'ar',
      acceptLegal: [{ documentKey: 'terms_family', version: 'qa-old' }, docsOf('family')[1]],
    });
    expect({ status: stale.status, code: stale.code }).toEqual({ status: 409, code: CommErrorCode.LEGAL_VERSION_STALE });
  });

  it('with acceptLegal the parent starts accepted, and the lesson-audio notice is still its own record', async () => {
    const family = await intakeFamily();
    const code = await codeFor(family.subject, family.accountId);
    const r = await call(null, 'POST', '/auth/signup/verify', {
      email: family.subject, code, password: PASSWORD, lessonAudioNotice: PARENT_NOTICES.lesson_audio,
      acceptLegal: docsOf('family'), client: 'ios', locale: 'en',
    });
    expect({ status: r.status, json: r.json }).toEqual({ status: 200, json: { ok: true } });

    const signedIn = await login(family.subject);
    expect(signedIn.json.legal).toEqual(ACCEPTED);
    const rows = await g.prisma.$queryRawUnsafe<Array<{ document_key: string; client: string; locale: string; method: string }>>(
      `select document_key, client, locale, method from chat.terms_acceptance where account_id = $1::uuid order by document_key`, family.accountId,
    );
    expect(rows).toEqual([
      { document_key: 'code_of_conduct', client: 'ios', locale: 'en', method: 'signup' },
      { document_key: 'terms_family', client: 'ios', locale: 'en', method: 'signup' },
    ]);
    const contact = await g.prisma.contact.findFirstOrThrow({ where: { accountId: family.accountId }, select: { id: true } });
    const notices = await g.prisma.$queryRawUnsafe<Array<{ notice_key: string; notice_version: number }>>(
      `select notice_key, notice_version from chat.parent_notice_ack where contact_id = $1::uuid`, contact.id,
    );
    expect(notices).toEqual([{ notice_key: 'lesson_audio', notice_version: PARENT_NOTICES.lesson_audio }]);

    // 8. Erasure keeps the consent record; deleting one's own account needs no acceptance either way.
    const deleted = await call(signedIn.token, 'POST', '/me/account/delete', { password: PASSWORD });
    expect(deleted.status).toBe(200);
    expect(
      await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`select count(*) as n from chat.terms_acceptance where account_id = $1::uuid`, family.accountId),
    ).toEqual([{ n: 2n }]);
  });
});

describe('6. a support session never accepts for the person', () => {
  it('POST /me/legal/accept in an impersonation session is 403', async () => {
    const admin = await login(m.supervisors[0]!.subject);
    const family = m.families[0]!;
    const accountId = (await g.prisma.account.findUniqueOrThrow({ where: { subject: family.parent.subject } })).id;
    const opened = await call(admin.token, 'POST', '/admin/impersonations', { accountId, reason: 'PD-58 spec: the parent cannot find the terms' });
    expect(opened.status).toBe(201);
    const support = opened.json.accessToken as string;
    const r = await accept(support, docsOf('family'));
    expect({ status: r.status, code: r.code }).toEqual({ status: 403, code: CommErrorCode.SUPPORT_SESSION_FORBIDDEN });
    expect(await requiredOf(support)).toEqual(expectedFor('family'));
    await call(admin.token, 'POST', `/admin/impersonations/${opened.json.session.id}/end`);
  });
});

describe('7. reading, the parent notices, account deletion and signing out need no acceptance', () => {
  it('a parent who accepted nothing reads, acknowledges a notice, deletes their account; another signs out', async () => {
    const reader = await login(m.families[5]!.parent.subject);
    expect(await requiredOf(reader.token)).toEqual(expectedFor('family'));
    expect((await call(reader.token, 'GET', '/conversations')).status).toBe(200);
    expect((await call(reader.token, 'GET', `/conversations/${m.families[5]!.groups[0]!.conversationId}/messages`)).status).toBe(200);
    expect((await call(reader.token, 'GET', '/parent-notices')).status).toBe(200);
    const ack = await call(reader.token, 'POST', '/parent-notices/lesson_audio/acknowledge', { version: PARENT_NOTICES.lesson_audio });
    expect(ack.code).not.toBe(CommErrorCode.TERMS_NOT_ACCEPTED);
    expect(ack.status).toBeLessThan(300);
    const out = await call(reader.token, 'POST', '/auth/logout', {});
    expect(out.status).toBe(200);

    const leaving = await login(m.families[6]!.parent.subject);
    const deleted = await call(leaving.token, 'POST', '/me/account/delete', { password: PASSWORD });
    expect(deleted.status).toBe(200);
  });
});

describe('8. an acceptance is a record: never updated, never deleted', () => {
  it('UPDATE and DELETE are refused by the database', async () => {
    const accountId = (await g.prisma.account.findUniqueOrThrow({ where: { subject: m.families[1]!.parent.subject } })).id;
    await expect(g.prisma.$executeRawUnsafe(`update chat.terms_acceptance set locale = 'en' where account_id = $1::uuid`, accountId)).rejects.toThrow(/never changed/);
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.terms_acceptance where account_id = $1::uuid`, accountId)).rejects.toThrow(/never removed/);
  });
});

describe('9. production fails closed', () => {
  afterEach(async () => {
    if (inheritedAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = inheritedAppEnv;
    await setCurrent('terms_staff', 'v1');
  });

  it('the boot check refuses a missing legal.current row in production, and only warns elsewhere', async () => {
    const legal = app.get(LegalService);
    await expect(legal.onModuleInit()).resolves.toBeUndefined();
    process.env.APP_ENV = 'production';
    await expect(legal.onModuleInit()).resolves.toBeUndefined();
    process.env.APP_ENV = inheritedAppEnv ?? '';
    await g.prisma.$executeRawUnsafe(`delete from chat.config where key = 'legal.current.terms_staff'`);
    await expect(legal.onModuleInit()).resolves.toBeUndefined();
    process.env.APP_ENV = 'production';
    await expect(legal.onModuleInit()).rejects.toThrow(/legal\.current\.terms_staff is missing/);
  });

  it('in production a gated route answers 503 LEGAL_NOT_CONFIGURED, never "nothing required"; GET /me still answers', async () => {
    const staff = await login(m.supervisors[2]!.subject);
    await g.prisma.$executeRawUnsafe(`delete from chat.config where key = 'legal.current.terms_staff'`);
    process.env.APP_ENV = 'production';
    const group = m.families.find((f) => f.groups.some((gr) => gr.supervisorId === m.supervisors[2]!.id))?.groups.find((gr) => gr.supervisorId === m.supervisors[2]!.id);
    const path = `/conversations/${group?.conversationId ?? randomUUID()}/messages`;
    const r = await call(staff.token, 'POST', path, { body: 'hello', clientMessageId: randomUUID() });
    expect({ status: r.status, code: r.code }).toEqual({ status: 503, code: CommErrorCode.LEGAL_NOT_CONFIGURED });
    // ENG-10 review: never "nothing required" -- an explicit state the client tells apart from "all accepted".
    const unavailable = { state: 'unavailable', unavailable: ['terms_staff'] };
    const me = await call(staff.token, 'GET', '/me');
    expect(me.status).toBe(200);
    expect(me.json.legal).toMatchObject(unavailable);
    const state = await call(staff.token, 'GET', '/me/legal');
    expect(state.status).toBe(200);
    expect(state.json).toMatchObject(unavailable);
    const again = await login(m.supervisors[2]!.subject);
    expect(again.json.legal).toMatchObject(unavailable);
    expect(again.json.actor.legal).toMatchObject(unavailable);
  });

  it('a row naming a version that was never published is refused everywhere', async () => {
    const staff = await login(m.supervisors[3]!.subject);
    await g.prisma.$executeRawUnsafe(
      `update chat.config set value = to_jsonb('qa-never-published'::text) where key = 'legal.current.terms_staff'`,
    );
    const r = await call(staff.token, 'POST', `/conversations/${randomUUID()}/messages`, { body: 'hello', clientMessageId: randomUUID() });
    expect({ status: r.status, code: r.code }).toEqual({ status: 503, code: CommErrorCode.LEGAL_NOT_CONFIGURED });
    expect((await call(staff.token, 'GET', '/me')).json.legal).toMatchObject({ state: 'unavailable', unavailable: ['terms_staff'] });
    process.env.APP_ENV = 'production';
    await expect(app.get(LegalService).onModuleInit()).rejects.toThrow(/legal\.current\.terms_staff names a version that was never published/);
  });
});
