/**
 * PD-59 ownership, over real HTTP on a real database (the migration chain, the global bearer guard, the
 * real routes, the real triggers). Synthetic fixtures only (QA gate G-16).
 *
 * Staff: super admin, Sales manager, Sales representatives A and B, Operations, Finance, the Teachers
 * department, and one unrelated staff member.
 *
 *   1. READ  : a representative lists, counts and reads only their own leads; another's lead answers
 *              exactly like a missing one (same status, same body); the manager and the super admin read
 *              all; everyone else is refused (403) on every route.
 *   2. WRITE : update, contact edit, mark contacted, convert and reassign follow the same scope; only the
 *              manager (and the super admin) reassigns; an owner is always live Sales staff, in the
 *              service and in the database (a direct UPDATE is refused too).
 *   3. TRIALS: GET /trials/prospects and booking a trial for a prospect are scoped for a representative.
 *   4. AUDIT : the contact read, the reassignment and the convert attempts are audited, by field name,
 *              never by value; a refused look at another's lead writes nothing.
 *   5. CONTACT: the confined table has no grant for the request roles.
 *   6. HAND-OVER: a lead made Converted by a subscribed trial: not yet enrolled -> awaiting_enrolment, its
 *              contact kept; enrolled -> linked to that family, contact deleted, never a second parent.
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
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { LessonModule } from '../../src/lessons/lesson.module';
import { SalesPipelineModule } from '../../src/sales-pipeline/sales-pipeline.module';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { contactKeyHash } from '../../src/new-students/contact-key';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd59-ownership-spec-password-1';
const DOMAIN = 'pd59own.qa.jawwid.test';
const MIN = 60_000;

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

const who: Record<string, { id: string; subject: string }> = {};
const tokens = new Map<string, string>();

async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return tokens.get(subject)!;
}

type Res = { status: number; code?: string; json: any };
async function http(actor: string | null, method: string, path: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = body !== undefined ? { 'content-type': 'application/json' } : {};
  if (actor) headers.authorization = `Bearer ${await tokenFor(who[actor].subject)}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as any;
  return { status: r.status, code: json?.error?.code, json };
}

/** A staff member with a sign-in; `sales` makes them a member of the Sales department. */
async function staffWho(key: string, name: string, role: string, sales = false): Promise<void> {
  const subject = `${key}@${DOMAIN}`;
  const account = await g.prisma.account.create({
    data: { organizationId: orgId, subject, kind: 'staff', status: 'active', isActive: true },
  });
  await g.prisma.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
  const s = await g.prisma.staff.create({ data: { organizationId: orgId, name, role, isActive: true, accountId: account.id } });
  if (sales) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, $2::uuid, $3::uuid, 'supervisor')`,
      s.id, orgId, m.departments.sales,
    );
  }
  who[key] = { id: s.id, subject };
}

const CONTACT_A = { parentName: 'Synthetic Parent Alpha', phone: '+15557770001', email: 'pd59.alpha@example.test' };
const CONTACT_B = { parentName: 'Synthetic Parent Bravo', phone: '+15557770002', email: 'pd59.bravo@example.test' };
const CONTACT_M = { parentName: 'Synthetic Parent Mike', phone: '+15557770003' };
/** Every value the spec puts in a contact or a note: none may ever appear in an audit row. */
const SECRETS = [
  ...[CONTACT_A, CONTACT_B, CONTACT_M].flatMap((c) => Object.values(c)),
  '15557770001', '15557770002', '15557770003', 'note-alpha-secret', 'note-bravo-secret',
];

let leadA: string; // owned by rep A, contact A
let leadB: string; // owned by rep B, contact B
let leadM: string; // created by the manager for rep A
let legacy: string; // a pre-PD-59 prospect with no owner (created by Operations)
const missing = randomUUID();

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd59own-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd59own-${orgId.slice(0, 8)}', 'PD-59 ownership QA academy')`,
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
    organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD),
  });
  who.superAdmin = { id: m.superAdmin.id, subject: m.superAdmin.subject };
  who.manager = { id: m.salesManager.id, subject: m.salesManager.subject };
  who.ops = { id: m.supervisors[0].id, subject: m.supervisors[0].subject };
  who.teachers = { id: m.teacherSupervisors[0].id, subject: m.teacherSupervisors[0].subject };
  await staffWho('repA', 'rep_a', 'admin', true);
  await staffWho('repB', 'rep_b', 'admin', true);
  await staffWho('finance', 'finance_f', 'finance');
  await staffWho('unrelated', 'unrelated_u', 'admin');

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, SalesPipelineModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;

  // Leads, through the API as their owners (the real create path).
  const a = await http('repA', 'POST', '/sales-pipeline/leads', { displayName: 'lead_alpha', note: 'note-alpha-secret', contact: CONTACT_A });
  expect(a.status).toBe(201);
  leadA = a.json.id;
  const b = await http('repB', 'POST', '/sales-pipeline/leads', { displayName: 'lead_bravo', note: 'note-bravo-secret', contact: CONTACT_B });
  expect(b.status).toBe(201);
  leadB = b.json.id;
  const mm = await http('manager', 'POST', '/sales-pipeline/leads', { displayName: 'lead_mike', contact: CONTACT_M, ownerId: who.repA.id });
  expect(mm.status).toBe(201);
  leadM = mm.json.id;
  // A prospect recorded before PD-59 by Operations: no owner (written as the old code wrote it).
  legacy = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.trial_prospect (id, organization_id, display_name, created_by) values ($1::uuid, $2::uuid, 'legacy_unowned', $3::uuid)`,
    legacy, orgId, who.ops.id,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.trial_student (prospect_id, organization_id, position, display_name) values ($1::uuid, $2::uuid, 1, 'legacy_unowned')`,
    legacy, orgId,
  );
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd59own-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

const ids = (r: Res) => (r.json.leads as Array<{ id: string }>).map((l) => l.id).sort();
const audits = (action: string, entityId: string) =>
  g.prisma.$queryRawUnsafe<Array<{ actor_id: string; before: unknown; after: unknown }>>(
    `select actor_id::text, before, after from chat.audit_log where action = $1 and entity_id = $2::uuid order by at`,
    action, entityId,
  );
const auditCount = async (actorKey: string, entityId: string) =>
  Number((await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `select count(*) n from chat.audit_log where actor_id = $1::uuid and entity_id = $2::uuid`, who[actorKey].id, entityId))[0].n);

describe('1. READ scope', () => {
  it('a representative lists, counts and reads only their own leads; the unowned and the others\' are not there', async () => {
    const a = await http('repA', 'GET', '/sales-pipeline/leads');
    expect(a.status).toBe(200);
    expect(ids(a)).toEqual([leadA, leadM].sort());
    expect(a.json.total).toBe(2);
    // The board's counts are the representative's own too: two new leads, nothing else.
    expect(a.json.counts.new_lead).toBe(2);
    const b = await http('repB', 'GET', '/sales-pipeline/leads');
    expect(ids(b)).toEqual([leadB]);
    expect(b.json.counts.new_lead).toBe(1);
  });

  it('the manager and the super admin read every lead of the academy, the unowned one included', async () => {
    for (const k of ['manager', 'superAdmin']) {
      const r = await http(k, 'GET', '/sales-pipeline/leads');
      expect(r.status).toBe(200);
      expect(ids(r)).toEqual([leadA, leadB, leadM, legacy].sort());
      expect(r.json.counts.new_lead).toBe(4);
      const d = await http(k, 'GET', `/sales-pipeline/leads/${leadB}`);
      expect(d.status).toBe(200);
      expect(d.json.contact.parentName).toBe(CONTACT_B.parentName);
    }
  });

  it('another representative\'s lead answers exactly like a lead that does not exist (status and body), and writes no audit row', async () => {
    const before = await auditCount('repA', leadB);
    const foreign = await http('repA', 'GET', `/sales-pipeline/leads/${leadB}`);
    const absent = await http('repA', 'GET', `/sales-pipeline/leads/${missing}`);
    const unowned = await http('repA', 'GET', `/sales-pipeline/leads/${legacy}`);
    expect(foreign.status).toBe(404);
    expect(foreign.code).toBe('COMM.SALES_LEAD_NOT_FOUND');
    expect(foreign.json).toEqual(absent.json);
    expect(unowned.status).toBe(404);
    expect(unowned.json).toEqual(absent.json);
    expect(JSON.stringify(foreign.json)).not.toContain('Bravo');
    expect(await auditCount('repA', leadB)).toBe(before);
    expect((await audits('sales_lead.contact_viewed', leadB)).filter((r) => r.actor_id === who.repA.id)).toHaveLength(0);
  });

  it('a representative reading their own lead gets the contact, audited by field name only', async () => {
    const d = await http('repA', 'GET', `/sales-pipeline/leads/${leadA}`);
    expect(d.status).toBe(200);
    expect(d.json.contact).toMatchObject({ parentName: CONTACT_A.parentName, email: CONTACT_A.email });
    expect(d.json.owner.id).toBe(who.repA.id);
    const rows = await audits('sales_lead.contact_viewed', leadA);
    expect(rows.filter((r) => r.actor_id === who.repA.id)).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/Synthetic|example\.test|1555777/);
  });

  it('the list never carries a contact value', async () => {
    const r = await http('manager', 'GET', '/sales-pipeline/leads');
    const text = JSON.stringify(r.json);
    for (const s of SECRETS) expect(text).not.toContain(s);
    const row = r.json.leads.find((l: { id: string }) => l.id === leadA);
    expect(row.contact).toEqual({ phone: true, whatsapp: false, email: true });
  });

  it.each(['ops', 'finance', 'teachers', 'unrelated'])('%s is refused (403) on every Sales-pipeline route', async (k) => {
    const routes: Array<[string, string, unknown?]> = [
      ['GET', '/sales-pipeline/leads'],
      ['GET', `/sales-pipeline/leads/${leadA}`],
      ['GET', '/sales-pipeline/owners'],
      ['POST', '/sales-pipeline/leads', { displayName: 'x', contact: CONTACT_M }],
      ['POST', `/sales-pipeline/leads/${leadA}`, { followUpNote: 'x' }],
      ['POST', `/sales-pipeline/leads/${leadA}/contacted`, {}],
      ['POST', `/sales-pipeline/leads/${leadA}/convert`, {}],
      ['POST', `/sales-pipeline/leads/${leadA}/owner`, { ownerId: who.repB.id }],
    ];
    for (const [method, path, body] of routes) {
      const r = await http(k, method, path, body ?? (method === 'POST' ? {} : undefined));
      expect([method, path, r.status]).toEqual([method, path, 403]);
      for (const s of SECRETS) expect(JSON.stringify(r.json)).not.toContain(s);
    }
    expect((await http(k, 'GET', '/sales-pipeline/access')).json).toEqual({ allowed: false, standing: null });
  });

  it('access reports the standing; no token is 401', async () => {
    expect((await http('repA', 'GET', '/sales-pipeline/access')).json).toEqual({ allowed: true, standing: 'sales_member' });
    expect((await http('manager', 'GET', '/sales-pipeline/access')).json).toEqual({ allowed: true, standing: 'sales_manager' });
    expect((await http('superAdmin', 'GET', '/sales-pipeline/access')).json).toEqual({ allowed: true, standing: 'super_admin' });
    expect((await http(null, 'GET', '/sales-pipeline/leads')).status).toBe(401);
  });
});

describe('2. WRITE scope', () => {
  it('a representative changes nothing of another\'s lead: 404 for update, contact edit, contacted and convert; the row is untouched', async () => {
    const snap = async () => JSON.stringify(await g.prisma.$queryRawUnsafe(
      `select p.*, c.parent_name, c.phone, c.email from chat.trial_prospect p left join chat.sales_lead_contact c on c.prospect_id = p.id where p.id = $1::uuid`, leadB));
    const before = await snap();
    const absent = await http('repA', 'POST', `/sales-pipeline/leads/${missing}`, { followUpNote: 'x' });
    const writes: Array<[string, unknown]> = [
      [`/sales-pipeline/leads/${leadB}`, { followUpNote: 'intruder' }],
      [`/sales-pipeline/leads/${leadB}`, { contact: { phone: '+15559990000' } }],
      [`/sales-pipeline/leads/${leadB}`, { stage: 'lost', lostReason: 'price' }],
      [`/sales-pipeline/leads/${leadB}/contacted`, {}],
      [`/sales-pipeline/leads/${leadB}/convert`, {}],
    ];
    for (const [path, body] of writes) {
      const r = await http('repA', 'POST', path, body);
      expect([path, r.status, r.json]).toEqual([path, 404, absent.json]);
    }
    expect(await snap()).toBe(before);
    // ...and nothing of it is audited under rep A (a refused look leaves no trace of the lead).
    expect(await auditCount('repA', leadB)).toBe(0);
  });

  it('a representative creating a lead for another representative is refused; the manager may', async () => {
    const r = await http('repA', 'POST', '/sales-pipeline/leads', { displayName: 'x', contact: CONTACT_M, ownerId: who.repB.id });
    expect(r.status).toBe(403);
    const ok = await http('manager', 'POST', '/sales-pipeline/leads', { displayName: 'for_b', contact: CONTACT_M, ownerId: who.repB.id });
    expect(ok.status).toBe(201);
    expect(ok.json.owner.id).toBe(who.repB.id);
  });

  it('a lead created without an owner named is owned by its creator', async () => {
    const r = await http('repB', 'POST', '/sales-pipeline/leads', { displayName: 'mine', contact: CONTACT_M });
    expect(r.status).toBe(201);
    expect(r.json.owner.id).toBe(who.repB.id);
  });

  it('own lead: contact edit and mark contacted work, are audited by field name, and move the retention clock', async () => {
    const t0 = (await g.prisma.$queryRawUnsafe<Array<{ t: Date }>>(`select last_activity_at t from chat.trial_prospect where id = $1::uuid`, leadA))[0].t;
    const up = await http('repA', 'POST', `/sales-pipeline/leads/${leadA}`, { contact: { whatsapp: '+15557770009' }, followUpNote: 'note-alpha-secret' });
    expect(up.status).toBe(201);
    expect(up.json.contact.whatsapp).toBe('+15557770009');
    const c = await http('repA', 'POST', `/sales-pipeline/leads/${leadA}/contacted`, { followUpNote: 'note-alpha-secret' });
    expect(c.status).toBe(201);
    expect(c.json.stage).toBe('contacted');
    const t1 = (await g.prisma.$queryRawUnsafe<Array<{ t: Date }>>(`select last_activity_at t from chat.trial_prospect where id = $1::uuid`, leadA))[0].t;
    expect(t1.getTime()).toBeGreaterThan(t0.getTime());
    const updated = await audits('sales_lead.contact_updated', leadA);
    expect(updated).toHaveLength(1);
    expect(updated[0].after).toEqual({ fields: ['whatsapp'] });
    expect(JSON.stringify(await audits('sales_lead.contacted', leadA))).not.toContain('secret');
  });

  it('only the manager (or the super admin) reassigns; a representative is refused, even for their own lead', async () => {
    expect((await http('repA', 'POST', `/sales-pipeline/leads/${leadA}/owner`, { ownerId: who.repB.id })).status).toBe(403);
    expect((await http('repA', 'GET', '/sales-pipeline/owners')).status).toBe(403);
    const owners = await http('manager', 'GET', '/sales-pipeline/owners');
    expect(owners.status).toBe(200);
    const names = (owners.json.owners as Array<{ id: string }>).map((o) => o.id);
    expect(names).toEqual(expect.arrayContaining([who.repA.id, who.repB.id, who.manager.id]));
    expect(names).not.toContain(who.ops.id);
    expect(names).not.toContain(who.finance.id);
    expect(names).not.toContain(who.unrelated.id);
  });

  it('reassigning moves the lead: the old owner loses sight of it (404), the new owner has it; audited who/from/to, no values', async () => {
    const r = await http('manager', 'POST', `/sales-pipeline/leads/${leadM}/owner`, { ownerId: who.repB.id });
    expect(r.status).toBe(201);
    expect(r.json.owner.id).toBe(who.repB.id);
    expect((await http('repA', 'GET', `/sales-pipeline/leads/${leadM}`)).status).toBe(404);
    expect((await http('repB', 'GET', `/sales-pipeline/leads/${leadM}`)).status).toBe(200);
    expect(ids(await http('repA', 'GET', '/sales-pipeline/leads'))).not.toContain(leadM);
    const rows = await audits('sales_lead.reassigned', leadM);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(who.manager.id);
    expect(rows[0].before).toEqual({ ownerId: who.repA.id });
    expect(rows[0].after).toEqual({ ownerId: who.repB.id });
    // the super admin assigns the unowned legacy lead
    const s = await http('superAdmin', 'POST', `/sales-pipeline/leads/${legacy}/owner`, { ownerId: who.repA.id });
    expect(s.status).toBe(201);
    expect(ids(await http('repA', 'GET', '/sales-pipeline/leads'))).toContain(legacy);
    expect((await audits('sales_lead.reassigned', legacy))[0].before).toEqual({ ownerId: null });
  });

  it('an owner must be live Sales staff: Operations, Finance, Teachers, unrelated, a departed rep, a stranger id are refused (service)', async () => {
    for (const k of ['ops', 'finance', 'teachers', 'unrelated']) {
      const r = await http('manager', 'POST', `/sales-pipeline/leads/${leadB}/owner`, { ownerId: who[k].id });
      expect([k, r.status, r.code]).toEqual([k, 400, 'COMM.SALES_LEAD_INVALID']);
    }
    expect((await http('manager', 'POST', `/sales-pipeline/leads/${leadB}/owner`, { ownerId: randomUUID() })).status).toBe(400);
    expect((await http('manager', 'POST', `/sales-pipeline/leads/${leadB}/owner`, { ownerId: 'not-a-uuid' })).status).toBe(400);
    expect((await http('manager', 'POST', `/sales-pipeline/leads/${missing}/owner`, { ownerId: who.repA.id })).status).toBe(404);
  });
});

describe('3. the database guard, by direct SQL (it does not rely on the service)', () => {
  const upd = (lead: string, owner: string | null) =>
    g.prisma.$executeRawUnsafe(`update chat.trial_prospect set owner_staff_id = $1::uuid where id = $2::uuid`, owner, lead);

  it.each(['ops', 'finance', 'teachers', 'unrelated'])('refuses %s as an owner', async (k) => {
    await expect(upd(leadB, who[k].id)).rejects.toThrow(/owned by live Sales staff/);
  });

  it('refuses a departed Sales member, accepts a live one, never clears an owner', async () => {
    const gone = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active, left_at, organization_id) values ($1::uuid, 'sales_gone', 'admin', false, now(), $2::uuid)`, gone, orgId);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, $2::uuid, $3::uuid, 'supervisor')`,
      gone, orgId, m.departments.sales);
    await expect(upd(leadB, gone)).rejects.toThrow(/owned by live Sales staff/);
    await expect(upd(leadB, who.repB.id)).resolves.toBeDefined();
    await expect(upd(leadB, null)).rejects.toThrow(/reassigned, never cleared/);
  });

  it('an insert names only a live Sales owner too', async () => {
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.trial_prospect (organization_id, display_name, created_by, owner_staff_id) values ($1::uuid, 'x', $2::uuid, $2::uuid)`,
      orgId, who.ops.id)).rejects.toThrow(/owned by live Sales staff/);
  });

  it('the free-text note of a prospect is not rewritten outside the retention purge', async () => {
    await expect(g.prisma.$executeRawUnsafe(`update chat.trial_prospect set note = null where id = $1::uuid`, leadB)).rejects.toThrow(/not rewritten/);
  });
});

describe('4. the confined contact table has no grant for a request role', () => {
  it.each(['chat_app', 'anon', 'authenticated'])('%s cannot read it', async (role) => {
    await expect(g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local role ${role}`);
      await tx.$queryRawUnsafe(`select count(*) from chat.sales_lead_contact`);
    })).rejects.toThrow(/permission denied/);
  });

  it.each(['chat_app', 'anon', 'authenticated'])('%s cannot run the retention purge', async (role) => {
    await expect(g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local role ${role}`);
      await tx.$queryRawUnsafe(`select * from chat.purge_expired_sales_leads(1, true)`);
    })).rejects.toThrow(/permission denied/);
  });
});

describe('5. trials: the prospect list and booking follow the same ownership (a representative only)', () => {
  let teacherId: string;
  beforeAll(async () => {
    teacherId = m.teachers[0].id;
    await app.get(SchedulingService).setAvailability(m.teacherSupervisors[0].id, teacherId, {
      timezone: 'UTC',
      windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
    });
  });

  it('GET /trials/prospects: a representative sees their own only; the manager, super admin, Operations and Teachers read as before (all)', async () => {
    const own = async (k: string) => ((await http(k, 'GET', '/trials/prospects')).json.prospects as Array<{ id: string }>).map((p) => p.id);
    const a = await own('repA');
    expect(a).toEqual(expect.arrayContaining([leadA, legacy]));
    expect(a).not.toContain(leadB);
    const b = await own('repB');
    expect(b).toContain(leadB);
    expect(b).not.toContain(leadA);
    for (const k of ['manager', 'superAdmin', 'ops', 'teachers']) {
      const all = await own(k);
      expect([k, all.includes(leadA), all.includes(leadB)]).toEqual([k, true, true]);
    }
    expect((await http('finance', 'GET', '/trials/prospects')).status).toBe(403);
    expect((await http('unrelated', 'GET', '/trials/prospects')).status).toBe(403);
  });

  it('booking a trial: a representative can book their own prospect; another\'s answers as a missing prospect', async () => {
    const slots = (await http('repA', 'GET', `/trials/slots?teacherId=${teacherId}`)).json.slots as string[];
    expect(slots.length).toBeGreaterThan(5);
    const foreign = await http('repA', 'POST', '/trials', { prospectId: leadB, teacherId, startsAt: slots[2] });
    const absent = await http('repA', 'POST', '/trials', { prospectId: missing, teacherId, startsAt: slots[2] });
    expect(foreign.status).toBe(404);
    expect(foreign.json).toEqual(absent.json);
    const own = await http('repA', 'POST', '/trials', { prospectId: leadA, teacherId, startsAt: slots[3] });
    expect([own.status, own.code]).toEqual([201, undefined]);
    // The lead is now Trial Booked for its owner, and for the manager.
    expect((await http('repA', 'GET', `/sales-pipeline/leads/${leadA}`)).json.stage).toBe('trial_booked');
    // The manager may book for any prospect (as before).
    const m2 = await http('manager', 'POST', '/trials', { prospectId: leadB, teacherId, startsAt: slots[4] });
    expect(m2.status).toBe(201);
  });

  it('booking with typed students records the party owned by the booking representative', async () => {
    const slots = (await http('repB', 'GET', `/trials/slots?teacherId=${teacherId}`)).json.slots as string[];
    const r = await http('repB', 'POST', '/trials', { students: [{ name: 'typed_child' }], teacherId, startsAt: slots[8] });
    expect(r.status).toBe(201);
    const list = await http('repB', 'GET', '/sales-pipeline/leads');
    expect((list.json.leads as Array<{ displayName: string }>).map((l) => l.displayName)).toContain('typed_child');
    expect(ids(await http('repA', 'GET', '/sales-pipeline/leads'))).not.toContain(
      (list.json.leads as Array<{ id: string; displayName: string }>).find((l) => l.displayName === 'typed_child')!.id);
  });
});

describe('6. hand-over of a lead a subscribed trial made Converted', () => {
  let lead: string;
  let lesson: string;

  /** Legacy-shaped rows, written the way PD-59's own tests of the other tables are: triggers off for the one transaction. */
  async function legacyRows(sql: string, ...args: unknown[]) {
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRawUnsafe(sql, ...args);
    });
  }

  beforeAll(async () => {
    const c = await http('repA', 'POST', '/sales-pipeline/leads', { displayName: 'lead_converted', contact: { parentName: 'Synthetic Parent Charlie', phone: '+15557770044' } });
    lead = c.json.id;
    lesson = randomUUID();
    await legacyRows(
      `insert into chat.lesson (id, organization_id, teacher_id, kind, starts_at, ends_at, outcome, outcome_by_kind, outcome_at, outcome_by, created_by, created_by_kind, prospect_id)
       values ($1::uuid, $2::uuid, $3::uuid, 'trial', now() - interval '3 days', now() - interval '3 days' + interval '30 minutes', 'held', 'staff', now() - interval '3 days', $4::uuid, $4::uuid, 'staff', $5::uuid)`,
      lesson, orgId, m.teachers[0].id, who.repA.id, lead);
    await legacyRows(
      `insert into chat.trial_outcome (lesson_id, organization_id, result, recorded_by) values ($1::uuid, $2::uuid, 'subscribed', $3::uuid)`,
      lesson, orgId, who.repA.id);
  });

  it('is Converted at once, not handed over, still holding its contact; convert says awaiting_enrolment (audited, no values), converts nothing', async () => {
    const d = await http('repA', 'GET', `/sales-pipeline/leads/${lead}`);
    expect(d.json).toMatchObject({ stage: 'converted', canConvert: true, convertedAt: null, familyId: null });
    expect(d.json.contact.parentName).toBe('Synthetic Parent Charlie');
    const r = await http('repA', 'POST', `/sales-pipeline/leads/${lead}/convert`, {});
    expect(r.json).toEqual({ outcome: 'awaiting_enrolment', familyId: null });
    expect((await audits('sales_lead.convert_attempted', lead))[0].after).toEqual({ outcome: 'awaiting_enrolment' });
    const row = (await g.prisma.$queryRawUnsafe<Array<{ converted_at: Date | null; contact: bigint }>>(
      `select p.converted_at, (select count(*) from chat.sales_lead_contact c where c.prospect_id = p.id) contact from chat.trial_prospect p where p.id = $1::uuid`, lead))[0];
    expect(row.converted_at).toBeNull();
    expect(Number(row.contact)).toBe(1);
    // it cannot be reassigned (converted) and another representative cannot see it
    expect((await http('manager', 'POST', `/sales-pipeline/leads/${lead}/owner`, { ownerId: who.repB.id })).status).toBe(409);
    expect((await http('repB', 'POST', `/sales-pipeline/leads/${lead}/convert`, {})).status).toBe(404);
  });

  it('retention never touches it (a subscribed trial keeps the lead whole), even with an old clock', async () => {
    await g.prisma.$executeRawUnsafe(`update chat.trial_prospect set last_activity_at = now() - interval '30 months', created_at = created_at where id = $1::uuid`, lead);
    const [{ expired }] = await g.prisma.$queryRawUnsafe<Array<{ expired: boolean }>>(`select chat.sales_lead_expired($1::uuid) expired`, lead);
    expect(expired).toBe(false);
  });

  it('once Operations has enrolled the trial into a family, convert LINKS it: converted_at and the family set, the lead\'s contact deleted, no second parent', async () => {
    const family = m.families[0];
    const learnerIds = family.children.map((c) => c.id).slice(0, 1);
    const familiesBefore = Number((await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`select count(*) n from chat.family`))[0].n);
    const contactsBefore = Number((await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`select count(*) n from chat.contact`))[0].n);
    await legacyRows(
      `insert into chat.trial_subscription (lesson_id, organization_id, parent_name, email, phone, children, currency, payment_method, recorded_by)
       values ($1::uuid, $2::uuid, 'Synthetic Parent Charlie', null, '+15557770044', '[{"name":"c"}]', 'USD', 'bank_transfer', $3::uuid)`,
      lesson, orgId, who.repA.id);
    await legacyRows(
      `insert into chat.student_enrolment (lesson_id, organization_id, family_id, contact_id, learner_ids, assigned_by, origin, kind)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid[], $6::uuid, 'trial', 'added_children')`,
      lesson, orgId, family.id, family.parent.id, learnerIds, who.ops.id);
    // The family's record already has its own phone, and the lead's number is a different one: the hand-over is
    // REFUSED and the lead's contact kept (a channel is never dropped); the refusal is audited by outcome only.
    const refused = await http('repA', 'POST', `/sales-pipeline/leads/${lead}/convert`, {});
    expect([refused.status, refused.code]).toEqual([409, 'COMM.SALES_LEAD_STATE']);
    expect((await audits('sales_lead.convert_refused', lead))[0].after).toEqual({ outcome: 'channel_missing' });
    expect(Number((await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`select count(*) n from chat.sales_lead_contact where prospect_id = $1::uuid`, lead))[0].n)).toBe(1);
    // Once the family holds that number (its contact key), the lead is linked to it.
    await g.prisma.familyContactKey.create({
      data: { organizationId: orgId, keyHash: contactKeyHash('phone', '+15557770044'), familyId: family.id, kind: 'phone', createdBy: who.ops.id },
    });
    const r = await http('repA', 'POST', `/sales-pipeline/leads/${lead}/convert`, {});
    expect(r.json).toMatchObject({ outcome: 'linked', familyId: family.id });
    const row = (await g.prisma.$queryRawUnsafe<Array<{ converted_family_id: string; converted_at: Date; contact: bigint }>>(
      `select p.converted_family_id::text, p.converted_at, (select count(*) from chat.sales_lead_contact c where c.prospect_id = p.id) contact from chat.trial_prospect p where p.id = $1::uuid`, lead))[0];
    expect(row.converted_family_id).toBe(family.id);
    expect(Number(row.contact)).toBe(0);
    // no second family or parent record was created; the converted audit row carries names only
    expect(Number((await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`select count(*) n from chat.family`))[0].n)).toBe(familiesBefore);
    expect(Number((await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`select count(*) n from chat.contact`))[0].n)).toBe(contactsBefore);
    expect(JSON.stringify(await audits('sales_lead.converted', lead))).not.toMatch(/Charlie|1555777/);
    // converting again is refused
    expect((await http('repA', 'POST', `/sales-pipeline/leads/${lead}/convert`, {})).status).toBe(409);
  });
});

describe('7. audit rows never carry a contact value or a note', () => {
  it('no audit row about any prospect names a value this spec typed', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ action: string; before: unknown; after: unknown; reason: string }>>(
      `select action, before, after, reason from chat.audit_log where entity = 'trial_prospect'`);
    expect(rows.length).toBeGreaterThan(5);
    const text = JSON.stringify(rows);
    for (const s of SECRETS) expect(text).not.toContain(s);
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['sales_lead.created', 'sales_lead.contact_viewed', 'sales_lead.contact_updated', 'sales_lead.reassigned', 'sales_lead.convert_attempted', 'sales_lead.converted']) {
      expect(actions).toContain(a);
    }
  });
});
