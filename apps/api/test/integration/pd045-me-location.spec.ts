/**
 * PD-45 PR-4 over real HTTP (plan §5.4, §4, §6.1 b, §6.2, §8): a parent's own
 * location, `GET /me/location`, `PUT /me/location`, `POST /me/location/later`.
 *
 *   1. a parent reads and sets their OWN family's location, and only it
 *   2. staff and teachers are refused (403), whatever the body names
 *   3. a contact without an account, or no longer active, reads and writes nothing
 *   4. the country and subdivision are validated against the list (400)
 *   5. the one-time prompt is answered on the server: Save and Later
 *   6. the suggestion from the phone is shown, never saved
 *   7. a country change re-keys the family's local number (§9), as staff's does
 *   8. nothing carries the location: no outbox event, no event log, and the
 *      audit names the fields, never the values
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
import { ParentRecordModule } from '../../src/parent-profile/parent-record.module';
import { MyLocationService } from '../../src/parent-profile/my-location.service';
import { GeoModule } from '../../src/geo/geo.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd45-me-location-spec-password-1';
const DOMAIN = 'pd45me.qa.jawwid.test';

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
  const headers: Record<string, string> = body !== undefined ? { 'content-type': 'application/json' } : {};
  if (subject) headers.authorization = `Bearer ${await tokenFor(subject)}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  const json = (text ? JSON.parse(text) : {}) as { error?: { code?: string; message?: string } } & Record<string, unknown>;
  return { status: r.status, code: json.error?.code, json, text };
}

type FamilyLocation = {
  country_code: string | null; subdivision_code: string | null;
  location_source: string | null; location_updated_by: string | null; location_updated_at: Date | null;
};
async function familyLocation(familyId: string): Promise<FamilyLocation> {
  const [row] = await g.prisma.$queryRawUnsafe<FamilyLocation[]>(
    `select country_code, subdivision_code, location_source, location_updated_by::text, location_updated_at
       from chat.family where id = $1::uuid`, familyId);
  return row!;
}
async function setFamilyLocation(familyId: string, country: string | null, subdivision: string | null) {
  await g.prisma.$executeRawUnsafe(
    `update chat.family set country_code = $2, subdivision_code = $3,
            location_source = case when $2::text is null then null else 'staff' end,
            location_updated_by = case when $2::text is null then null else $4::uuid end,
            location_updated_at = case when $2::text is null then null else now() end
      where id = $1::uuid`,
    familyId, country, subdivision, m.superAdmin.id);
}
async function promptOf(contactId: string) {
  return g.prisma.contactLocationPrompt.findUnique({ where: { contactId } });
}
async function setPhone(contactId: string, phone: string | null) {
  await g.prisma.parentFile.upsert({
    where: { contactId },
    create: { contactId, organizationId: orgId, adminOnlyParentPhone: phone, updatedBy: m.superAdmin.id },
    update: { adminOnlyParentPhone: phone },
  });
}
const counts = async () => ({
  outbox: await g.prisma.outboxEvent.count(),
  events: await g.prisma.eventLog.count(),
});

/** A family's second guardian with their own sign-in. */
async function addGuardian(familyId: string, key: string) {
  const subject = `${key}@${DOMAIN}`;
  const account = await g.prisma.account.create({
    data: { organizationId: orgId, subject, kind: 'family', status: 'active', isActive: true },
  });
  await g.prisma.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
  const contact = await g.prisma.contact.create({
    data: { organizationId: orgId, familyId, name: `QA Guardian ${key}`, relationship: 'parent', accountId: account.id, isActive: true, ...RIGHTS },
  });
  return { id: contact.id, subject };
}

/** A second guardian's rights: none of them matter to the location, which any active guardian with an account may set. */
const RIGHTS = {
  rolePreset: 'authorized_contact', canMessage: false, canViewProgress: true, canManageSchedule: false,
  canManageBilling: false, canManageContacts: false, canCancel: false,
} as const;

let A: SeedManifest['families'][number];
let B: SeedManifest['families'][number];

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd45me-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd45me-${orgId.slice(0, 8)}', 'PD-45 me QA academy')`,
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
  A = m.families[0]!;
  B = m.families[1]!;

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, ParentRecordModule, GeoModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});

beforeEach(async () => {
  // Each test starts from families with no location, no phone and no answer.
  for (const f of m.families) await setFamilyLocation(f.id, null, null);
  await g.prisma.contactLocationPrompt.deleteMany({});
  await g.prisma.$executeRawUnsafe(`update chat.parent_file set phone = null`);
  // The write budget is per actor per window: start every test with a full one.
  const redis = app.get<Redis>(REDIS_CLIENT);
  const keys = await redis.keys('ratelimit:action:location_write_actor:*');
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd45me-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('1. a parent\'s own family, and only it', () => {
  it('every route is behind the bearer guard', async () => {
    expect((await http(null, 'GET', '/me/location')).status).toBe(401);
    expect((await http(null, 'PUT', '/me/location', { countryCode: 'EG' })).status).toBe(401);
    expect((await http(null, 'POST', '/me/location/later')).status).toBe(401);
  });

  it('reads the family\'s location: the two codes, the names, the prompt -- and nothing else', async () => {
    await setFamilyLocation(A.id, 'EG', 'EG-GZ');
    const r = await http(A.parent.subject, 'GET', '/me/location');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ countryCode: 'EG', subdivisionCode: 'EG-GZ', location: { ar: 'مصر · الجيزة', en: 'Egypt · Giza' }, prompt: false });
  });

  it('sets it: validated, written with location_source parent and this contact as the writer, and returned', async () => {
    const r = await http(A.parent.subject, 'PUT', '/me/location', { countryCode: 'ae', subdivisionCode: 'ae-du' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ countryCode: 'AE', subdivisionCode: 'AE-DU', location: { ar: 'الإمارات العربية المتحدة · دبي', en: 'United Arab Emirates · Dubai' }, prompt: false });
    const row = await familyLocation(A.id);
    expect(row).toMatchObject({ country_code: 'AE', subdivision_code: 'AE-DU', location_source: 'parent', location_updated_by: A.parent.id });
    expect(row.location_updated_at).toBeInstanceOf(Date);
    // The read agrees.
    expect((await http(A.parent.subject, 'GET', '/me/location')).json).toEqual(r.json);
  });

  it('replaces the location: a country alone clears the old subdivision', async () => {
    await setFamilyLocation(A.id, 'EG', 'EG-GZ');
    const r = await http(A.parent.subject, 'PUT', '/me/location', { countryCode: 'EG' });
    expect(r.status).toBe(200);
    expect(await familyLocation(A.id)).toMatchObject({ country_code: 'EG', subdivision_code: null, location_source: 'parent' });
  });

  it('never touches another family: an id in the body is ignored, and the other parent reads only their own', async () => {
    await setFamilyLocation(B.id, 'EG', 'EG-C');
    const before = await familyLocation(B.id);
    const r = await http(A.parent.subject, 'PUT', '/me/location', {
      countryCode: 'SA', subdivisionCode: 'SA-01', familyId: B.id, contactId: B.parent.id,
    });
    expect(r.status).toBe(200);
    expect(await familyLocation(A.id)).toMatchObject({ country_code: 'SA', subdivision_code: 'SA-01' });
    expect(await familyLocation(B.id)).toEqual(before);
    expect(await promptOf(B.parent.id)).toBeNull();
    // Each parent reads their own family, never the other's.
    expect((await http(B.parent.subject, 'GET', '/me/location')).json).toMatchObject({ countryCode: 'EG', subdivisionCode: 'EG-C' });
    expect((await http(A.parent.subject, 'GET', '/me/location')).json).toMatchObject({ countryCode: 'SA', subdivisionCode: 'SA-01' });
  });

  it('a query string names no one either', async () => {
    await setFamilyLocation(B.id, 'EG', 'EG-C');
    const r = await http(A.parent.subject, 'GET', `/me/location?familyId=${B.id}&contactId=${B.parent.id}`);
    expect(r.json).toMatchObject({ countryCode: null, subdivisionCode: null, location: null });
  });

  it('any active guardian of the family with an account may set it; the answer is theirs alone', async () => {
    const second = await addGuardian(A.id, 'second.guardian.a');
    const r = await http(second.subject, 'PUT', '/me/location', { countryCode: 'JO', subdivisionCode: 'JO-AM' });
    expect(r.status).toBe(200);
    expect(await familyLocation(A.id)).toMatchObject({ country_code: 'JO', location_source: 'parent', location_updated_by: second.id });
    expect(await promptOf(second.id)).toMatchObject({ outcome: 'saved' });
    expect(await promptOf(A.parent.id)).toBeNull();
    // The family's location is now complete, so the first guardian is not asked either.
    expect((await http(A.parent.subject, 'GET', '/me/location')).json).toMatchObject({ countryCode: 'JO', prompt: false });
  });
});

describe('2. staff and teachers are refused', () => {
  it('every staff role gets 403 on every route, and nothing changes', async () => {
    const staff = [m.superAdmin, m.operationsManager, m.salesManager, m.teachersManager, m.supervisors[0]!];
    const before = await familyLocation(A.id);
    for (const s of staff) {
      for (const [method, path, body] of [
        ['GET', '/me/location', undefined],
        ['PUT', '/me/location', { countryCode: 'EG', subdivisionCode: 'EG-GZ', familyId: A.id }],
        ['POST', '/me/location/later', undefined],
      ] as const) {
        const r = await http(s.subject, method, path, body);
        expect({ who: s.subject, method, status: r.status }).toEqual({ who: s.subject, method, status: 403 });
        expect([CommErrorCode.PERMISSION_DENIED, CommErrorCode.PROFILE_NOT_AVAILABLE]).toContain(r.code);
        expect(r.text).not.toMatch(/countryCode|subdivisionCode/);
      }
      expect(await promptOf(s.id)).toBeNull();
    }
    expect(await familyLocation(A.id)).toEqual(before);
  });

  it('a teacher gets 403 PROFILE_NOT_AVAILABLE, and nothing changes', async () => {
    const teacher = m.teachers[0]!;
    for (const [method, path, body] of [
      ['GET', '/me/location', undefined],
      ['PUT', '/me/location', { countryCode: 'EG' }],
      ['POST', '/me/location/later', undefined],
    ] as const) {
      const r = await http(teacher.subject, method, path, body);
      expect({ method, status: r.status, code: r.code }).toEqual({ method, status: 403, code: CommErrorCode.PROFILE_NOT_AVAILABLE });
    }
    expect(await familyLocation(A.id)).toMatchObject({ country_code: null });
    expect(await promptOf(teacher.id)).toBeNull();
  });
});

describe('3. a contact who cannot sign in reads and writes nothing', () => {
  it('a contact without an account is refused by the service itself (no token can name one)', async () => {
    await setFamilyLocation(A.id, 'EG', 'EG-GZ');
    const orphan = await g.prisma.contact.create({
      data: { organizationId: orgId, familyId: A.id, name: 'QA Contact Without Account', relationship: 'parent', isActive: true, ...RIGHTS },
    });
    const svc = app.get(MyLocationService);
    for (const call of [() => svc.read(orphan.id), () => svc.save(orphan.id, { countryCode: 'AE' }), () => svc.later(orphan.id)]) {
      await expect(call()).rejects.toMatchObject({ code: CommErrorCode.PROFILE_NOT_AVAILABLE, status: 403 });
    }
    expect(await familyLocation(A.id)).toMatchObject({ country_code: 'EG', subdivision_code: 'EG-GZ' });
    expect(await promptOf(orphan.id)).toBeNull();
  });

  it('a contact who is no longer active is refused', async () => {
    const gone = await addGuardian(A.id, 'gone.guardian.a');
    const token = await tokenFor(gone.subject);
    expect(token).toBeTruthy();
    await g.prisma.contact.update({ where: { id: gone.id }, data: { isActive: false } });
    const svc = app.get(MyLocationService);
    await expect(svc.save(gone.id, { countryCode: 'AE' })).rejects.toMatchObject({ status: 403 });
    await expect(svc.read(gone.id)).rejects.toMatchObject({ status: 403 });
    expect(await familyLocation(A.id)).toMatchObject({ country_code: null });
  });
});

describe('4. validation', () => {
  it.each([
    ['no country', {}],
    ['a null country (a parent cannot clear it)', { countryCode: null, subdivisionCode: null }],
    ['an unlisted country', { countryCode: 'ZZ' }],
    ['the United Kingdom as UK', { countryCode: 'UK' }],
    ['a subdivision of another country', { countryCode: 'EG', subdivisionCode: 'AE-DU' }],
    ['an unknown subdivision', { countryCode: 'EG', subdivisionCode: 'EG-XX' }],
    ['a subdivision for a country that has none', { countryCode: 'AW', subdivisionCode: 'AW-01' }],
    ['a subdivision alone', { subdivisionCode: 'EG-GZ' }],
  ])('refuses %s with 400, and writes nothing -- not even the answer', async (_name, body) => {
    await setFamilyLocation(A.id, 'EG', 'EG-GZ');
    const before = await familyLocation(A.id);
    const r = await http(A.parent.subject, 'PUT', '/me/location', body);
    expect({ status: r.status, code: r.code }).toEqual({ status: 400, code: CommErrorCode.VALIDATION });
    expect(await familyLocation(A.id)).toEqual(before);
    expect(await promptOf(A.parent.id)).toBeNull();
  });
});

describe('5. the one-time prompt, answered on the server', () => {
  it('is due while the family has no location, and Save answers it', async () => {
    expect((await http(A.parent.subject, 'GET', '/me/location')).json).toMatchObject({ prompt: true, location: null });
    const r = await http(A.parent.subject, 'PUT', '/me/location', { countryCode: 'EG', subdivisionCode: 'EG-GZ' });
    expect(r.json).toMatchObject({ prompt: false });
    const stamp = await promptOf(A.parent.id);
    expect(stamp).toMatchObject({ outcome: 'saved' });
    expect(stamp!.answeredAt).toBeInstanceOf(Date);
  });

  it('Later counts as the answer: never asked again, on any device, and the location is untouched', async () => {
    const later = await http(A.parent.subject, 'POST', '/me/location/later');
    expect(later.status).toBe(201);
    expect(later.json).toMatchObject({ countryCode: null, prompt: false });
    expect(await promptOf(A.parent.id)).toMatchObject({ outcome: 'later' });
    expect(await familyLocation(A.id)).toMatchObject({ country_code: null, location_source: null });
    // A fresh read (another device) is not asked either.
    expect((await http(A.parent.subject, 'GET', '/me/location')).json).toMatchObject({ prompt: false });
    // Another family's parent is still asked: the answer is per contact.
    expect((await http(B.parent.subject, 'GET', '/me/location')).json).toMatchObject({ prompt: true });
  });

  it('Later twice keeps the first answer; Save after Later records the save', async () => {
    await http(A.parent.subject, 'POST', '/me/location/later');
    const first = await promptOf(A.parent.id);
    await http(A.parent.subject, 'POST', '/me/location/later');
    expect(await promptOf(A.parent.id)).toEqual(first);
    await http(A.parent.subject, 'PUT', '/me/location', { countryCode: 'EG', subdivisionCode: 'EG-GZ' });
    expect(await promptOf(A.parent.id)).toMatchObject({ outcome: 'saved' });
    // Later after Save never downgrades it.
    await http(A.parent.subject, 'POST', '/me/location/later');
    expect(await promptOf(A.parent.id)).toMatchObject({ outcome: 'saved' });
  });

  it('is due for an incomplete location too (a country with governorates and none chosen), as the "Missing location" list counts it', async () => {
    await setFamilyLocation(A.id, 'EG', null);
    expect((await http(A.parent.subject, 'GET', '/me/location')).json).toMatchObject({ countryCode: 'EG', subdivisionCode: null, prompt: true });
  });

  it('saving the location as it already is still answers the prompt, and changes nothing else', async () => {
    await setFamilyLocation(A.id, 'EG', 'EG-GZ');
    const before = await familyLocation(A.id);
    const r = await http(A.parent.subject, 'PUT', '/me/location', { countryCode: 'EG', subdivisionCode: 'EG-GZ' });
    expect(r.status).toBe(200);
    expect(await familyLocation(A.id)).toEqual(before);
    expect(await promptOf(A.parent.id)).toMatchObject({ outcome: 'saved' });
  });
});

describe('6. the suggestion from the phone (§6.2): shown, never saved', () => {
  it('suggests the country of an international number while the family has none, and never returns the number', async () => {
    await setPhone(A.parent.id, '+971 50 123 4567');
    const r = await http(A.parent.subject, 'GET', '/me/location');
    expect(r.json).toEqual({ countryCode: null, subdivisionCode: null, location: null, prompt: true, suggestedCountryCode: 'AE' });
    expect(r.text).not.toMatch(/971|4567/);
    // Shown, not saved.
    expect(await familyLocation(A.id)).toMatchObject({ country_code: null, location_source: null });
    expect(await promptOf(A.parent.id)).toBeNull();
  });

  it('suggests nothing from a local number, or once the family has a country', async () => {
    await setPhone(A.parent.id, '050 123 4567');
    expect((await http(A.parent.subject, 'GET', '/me/location')).json).not.toHaveProperty('suggestedCountryCode');
    await setPhone(A.parent.id, '+971 50 123 4567');
    await setFamilyLocation(A.id, 'EG', null);
    expect((await http(A.parent.subject, 'GET', '/me/location')).json).not.toHaveProperty('suggestedCountryCode');
  });
});

describe('7. a country change re-keys the family\'s local number (§9), as staff\'s does', () => {
  it('keys the number as the new country reads it, with no staff member named', async () => {
    await setPhone(A.parent.id, '050 765 3333');
    const keysBefore = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `select count(*)::int as n from chat.family_contact_key where family_id = $1::uuid and source = 'rekey'`, A.id);
    expect(keysBefore[0]!.n).toBe(0);
    expect((await http(A.parent.subject, 'PUT', '/me/location', { countryCode: 'AE' })).status).toBe(200);
    const keys = await g.prisma.$queryRawUnsafe<Array<{ kind: string; created_by: string | null }>>(
      `select kind, created_by::text from chat.family_contact_key where family_id = $1::uuid and source = 'rekey'`, A.id);
    expect(keys).toEqual([{ kind: 'phone', created_by: null }]);
  });

  it('refuses a country under which the number is another family\'s (409), naming no family, and saves nothing', async () => {
    // Family B's parent has +971 50 765 4444 on record (keyed by staff).
    const staffEdit = await http(m.superAdmin.subject, 'POST', `/parent-profiles/${B.parent.id}`, { phone: '+971 50 765 4444' });
    expect(staffEdit.status).toBe(201);
    await setPhone(A.parent.id, '050 765 4444');
    const r = await http(A.parent.subject, 'PUT', '/me/location', { countryCode: 'AE', subdivisionCode: 'AE-DU' });
    expect({ status: r.status, code: r.code }).toEqual({ status: 409, code: CommErrorCode.PARENT_EXISTS });
    expect(r.text).not.toContain(B.id);
    expect(r.text).not.toMatch(/765|4444/);
    expect(await familyLocation(A.id)).toMatchObject({ country_code: null });
    expect(await promptOf(A.parent.id)).toBeNull();
  });
});

describe('8. nothing carries the location', () => {
  it('no outbox event and no event log; the audit names the fields and the parent, never the codes', async () => {
    const before = await counts();
    const [{ last }] = await g.prisma.$queryRawUnsafe<Array<{ last: bigint }>>(`select coalesce(max(id), 0) as last from chat.audit_log`);
    await setPhone(A.parent.id, '+971 50 999 0000');
    expect((await http(A.parent.subject, 'PUT', '/me/location', { countryCode: 'QA', subdivisionCode: 'QA-DA' })).status).toBe(200);
    expect((await http(A.parent.subject, 'GET', '/me/location')).status).toBe(200);
    expect((await http(B.parent.subject, 'POST', '/me/location/later')).status).toBe(201);
    expect(await counts()).toEqual(before);

    const audits = await g.prisma.auditLog.findMany({ where: { id: { gt: last } } });
    const mine = audits.filter((a) => a.actorId === A.parent.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      action: 'profile.location.changed', entity: 'family', entityId: A.id,
      after: { fields: ['countryCode', 'subdivisionCode'] },
    });
    expect(mine[0]!.before).toBeNull();
    for (const a of audits) {
      expect(JSON.stringify([a.before, a.after, a.reason])).not.toMatch(/\bQA-DA\b|"QA"|Doha|الدوحة|971/);
    }
    // Later is an answer, not a change: no audit row for it.
    expect(audits.filter((a) => a.actorId === B.parent.id)).toEqual([]);
  });
});

describe('9. the writes are rationed per parent (abuse.throttle.location_write_actor)', () => {
  it('admits the budget, then answers 429; the read is never counted, and another parent keeps their budget', async () => {
    for (let i = 0; i < 10; i++) expect((await http(A.parent.subject, 'POST', '/me/location/later')).status).toBe(201);
    const over = await http(A.parent.subject, 'PUT', '/me/location', { countryCode: 'EG' });
    expect(over.status).toBe(429);
    expect(await familyLocation(A.id)).toMatchObject({ country_code: null });
    expect((await http(A.parent.subject, 'GET', '/me/location')).status).toBe(200);
    expect((await http(B.parent.subject, 'PUT', '/me/location', { countryCode: 'EG' })).status).toBe(200);
  });
});
