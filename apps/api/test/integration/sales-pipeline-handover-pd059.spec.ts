/**
 * PD-59 stabilization, option O4: the read-only "Needs hand-over" list, over real HTTP on a real database.
 * Synthetic fixtures only (QA gate G-16). Modelled on sales-pipeline-ownership-pd059.spec.ts.
 *
 *   1. WHO   : the Sales manager and the super admin only; a representative, Operations, Finance, the Teachers
 *              department and an unrelated staff member are refused (403); no token is 401.
 *   2. STATES: every state of the stabilization doc, section 2, appears with the right state, blocker, owner,
 *              contact-copy and enrolment flags; another organization's lead never appears.
 *   3. KINDS : channel_missing names the channel KINDS only; no value and no hash anywhere in the JSON.
 *   4. F8    : the list's and the detail's handedOver follow ONE rule (an enrolment counts); convert() is unchanged.
 *   5. READ-ONLY: the call changes no row of any table it reads and writes no audit row.
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
import { contactKeyHash } from '../../src/new-students/contact-key';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd59-handover-spec-password-1';
const DOMAIN = 'pd59ho.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
let otherOrgId: string;

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

async function staffWho(key: string, name: string, role: string, sales = false): Promise<void> {
  const subject = `${key}@${DOMAIN}`;
  const account = await g.prisma.account.create({ data: { organizationId: orgId, subject, kind: 'staff', status: 'active', isActive: true } });
  await g.prisma.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
  const s = await g.prisma.staff.create({ data: { organizationId: orgId, name, role, isActive: true, accountId: account.id } });
  if (sales) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, $2::uuid, $3::uuid, 'supervisor')`,
      s.id, orgId, m.departments.sales,
    );
  }
  who[key] = { id: s.id, subject };
}

/** Legacy-shaped rows: triggers off for the one transaction (as the ownership spec does). */
async function legacyRows(sql: string, ...args: unknown[]) {
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    await tx.$executeRawUnsafe(sql, ...args);
  });
}

/** A trial held 3 days ago with the outcome `subscribed` for the prospect; returns the lesson id. */
let trialSeq = 0;
async function subscribedTrial(prospect: string): Promise<string> {
  const lesson = randomUUID();
  await legacyRows(
    `insert into chat.lesson (id, organization_id, teacher_id, kind, starts_at, ends_at, outcome, outcome_by_kind, outcome_at, outcome_by, created_by, created_by_kind, prospect_id)
     values ($1::uuid, $2::uuid, $3::uuid, 'trial', now() - interval '3 days' - make_interval(hours => $6::int), now() - interval '3 days' - make_interval(hours => $6::int) + interval '30 minutes', 'held', 'staff', now() - interval '3 days', $4::uuid, $4::uuid, 'staff', $5::uuid)`,
    lesson, orgId, m.teachers[0].id, who.repA.id, prospect, trialSeq++);
  await legacyRows(
    `insert into chat.trial_outcome (lesson_id, organization_id, result, recorded_by) values ($1::uuid, $2::uuid, 'subscribed', $3::uuid)`,
    lesson, orgId, who.repA.id);
  return lesson;
}

async function enrol(lesson: string, family: SeedManifest['families'][number], ageDays: number) {
  await legacyRows(
    `insert into chat.student_enrolment (lesson_id, organization_id, family_id, contact_id, learner_ids, assigned_by, origin, kind, assigned_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid[], $6::uuid, 'trial', 'added_children', now() - make_interval(days => $7::int))`,
    lesson, orgId, family.id, family.parent.id, family.children.map((c) => c.id).slice(0, 1), who.ops.id, ageDays);
}

// Synthetic values: none may ever appear in the list.
const C_AWAIT = { parentName: 'Synthetic Parent Await', phone: '+15558880001', email: 'pd59ho.await@example.test' };
const C_MISSING = { parentName: 'Synthetic Parent Missing', phone: '+15558880002', whatsapp: '+15558880012', email: 'pd59ho.missing@example.test' };
const C_READY = { parentName: 'Synthetic Parent Ready', phone: '+15558880003' };
const C_LEARNER = { parentName: 'Synthetic Parent Learner', phone: '+15558880004' };
const C_NEW = { parentName: 'Synthetic Parent Newlead', phone: '+15558880005' };
const VALUES = [C_AWAIT, C_MISSING, C_READY, C_LEARNER, C_NEW].flatMap((c) => Object.values(c));
const KEYED = ['+15558880001', '+15558880002', '+15558880012', '+15558880003', '+15558880004', '+15558880005'];

let awaiting: string; // state 1-2: subscribed, not enrolled
let missing: string; // state 3: enrolled, channel_missing
let ready: string; // state 3: enrolled, every channel covered
let noContact: string; // state 7: enrolled, no contact copy
let learner: string; // state 6: learner linked
let plainLead: string; // a new lead: not listed
let linkedAlready: string; // converted + linked: not listed
let foreign: string; // another organization's learner-linked prospect: never listed

const TABLES = ['family', 'contact', 'parent_file', 'learner', 'student_enrolment', 'lesson', 'sales_lead_contact', 'trial_prospect', 'trial_outcome', 'trial_subscription', 'family_contact_key'];
async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of TABLES) {
    const [r] = await g.prisma.$queryRawUnsafe<Array<{ h: string }>>(`select coalesce(md5(string_agg(x::text, ',' order by x::text)), 'empty') h from chat.${t} x`);
    out[t] = r.h;
  }
  return out;
}
const auditTotal = async () => Number((await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`select count(*) n from chat.audit_log`))[0].n);

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd59ho-%'`);

  orgId = randomUUID();
  otherOrgId = randomUUID();
  for (const [id, label] of [[orgId, 'a'], [otherOrgId, 'b']] as const) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name) values ('${id}'::uuid, 'pd59ho-${label}-${id.slice(0, 8)}', 'PD-59 hand-over QA academy ${label}')`,
    );
  }
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD) });
  who.superAdmin = { id: m.superAdmin.id, subject: m.superAdmin.subject };
  who.manager = { id: m.salesManager.id, subject: m.salesManager.subject };
  who.ops = { id: m.supervisors[0].id, subject: m.supervisors[0].subject };
  who.teachers = { id: m.teacherSupervisors[0].id, subject: m.teacherSupervisors[0].subject };
  await staffWho('repA', 'rep_a', 'admin', true);
  await staffWho('repB', 'rep_b', 'admin', true);
  await staffWho('finance', 'finance_f', 'finance');
  await staffWho('unrelated', 'unrelated_u', 'admin');

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({ imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, SalesPipelineModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;

  const mk = async (actor: string, name: string, contact: object) => {
    const r = await http(actor, 'POST', '/sales-pipeline/leads', { displayName: name, contact });
    expect(r.status).toBe(201);
    return r.json.id as string;
  };
  awaiting = await mk('repA', 'lead_awaiting', C_AWAIT);
  await subscribedTrial(awaiting);
  missing = await mk('repA', 'lead_missing', C_MISSING);
  await enrol(await subscribedTrial(missing), m.families[0], 12);
  ready = await mk('repB', 'lead_ready', C_READY);
  await enrol(await subscribedTrial(ready), m.families[1], 2);
  await g.prisma.familyContactKey.create({
    data: { organizationId: orgId, keyHash: contactKeyHash('phone', '+15558880003'), familyId: m.families[1].id, kind: 'phone', createdBy: who.ops.id },
  });
  learner = await mk('repA', 'lead_learner', C_LEARNER);
  await subscribedTrial(learner);
  await legacyRows(`update chat.trial_prospect set learner_id = $2::uuid where id = $1::uuid`, learner, m.families[2].children[0].id);
  plainLead = await mk('repA', 'lead_plain', C_NEW);

  // A prospect recorded before PD-59 by Operations: no owner, no contact copy, subscribed and enrolled.
  noContact = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.trial_prospect (id, organization_id, display_name, created_by) values ($1::uuid, $2::uuid, 'legacy_no_contact', $3::uuid)`,
    noContact, orgId, who.ops.id);
  await g.prisma.$executeRawUnsafe(
    `insert into chat.trial_student (prospect_id, organization_id, position, display_name) values ($1::uuid, $2::uuid, 1, 'legacy_no_contact')`, noContact, orgId);
  await enrol(await subscribedTrial(noContact), m.families[2], 40);

  // Already linked: never listed.
  linkedAlready = randomUUID();
  await legacyRows(
    `insert into chat.trial_prospect (id, organization_id, display_name, created_by, converted_at, converted_family_id) values ($1::uuid, $2::uuid, 'legacy_linked', $3::uuid, now(), $4::uuid)`,
    linkedAlready, orgId, who.ops.id, m.families[0].id);
  await enrol(await subscribedTrial(linkedAlready), m.families[0], 5);

  // Another organization's prospect that would qualify (learner-linked): never reaches this academy's manager.
  foreign = randomUUID();
  await legacyRows(
    `insert into chat.trial_prospect (id, organization_id, display_name, created_by, learner_id) values ($1::uuid, $2::uuid, 'foreign_learner', $4::uuid, $3::uuid)`,
    foreign, otherOrgId, m.families[2].children[0].id, who.ops.id);
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd59ho-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

const byId = (r: Res, id: string) => (r.json.leads as Array<any>).find((l) => l.id === id);

describe('1. who may read the list', () => {
  it.each(['manager', 'superAdmin'])('%s reads it (200)', async (actor) => {
    const r = await http(actor, 'GET', '/sales-pipeline/reconciliation');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.leads)).toBe(true);
  });

  it.each(['repA', 'repB', 'ops', 'teachers', 'finance', 'unrelated'])('%s is refused (403)', async (actor) => {
    const r = await http(actor, 'GET', '/sales-pipeline/reconciliation');
    expect(r.status).toBe(403);
    expect(r.json.leads).toBeUndefined();
  });

  it('no token is 401', async () => {
    expect((await http(null, 'GET', '/sales-pipeline/reconciliation')).status).toBe(401);
  });
});

describe('2. the states', () => {
  let r: Res;
  beforeAll(async () => { r = await http('manager', 'GET', '/sales-pipeline/reconciliation'); });

  it('lists exactly the unlinked leads of a subscribed trial or a learner link; not new, linked or foreign ones', () => {
    expect((r.json.leads as Array<{ id: string }>).map((l) => l.id).sort()).toEqual([awaiting, missing, ready, noContact, learner].sort());
    expect(r.json.total).toBe(5);
    expect(r.json.counts).toEqual({ awaiting_enrolment: 1, enrolled: 2, enrolled_no_contact: 1, learner_linked: 1 });
    expect(byId(r, plainLead)).toBeUndefined();
    expect(byId(r, linkedAlready)).toBeUndefined();
    expect(byId(r, foreign)).toBeUndefined();
  });

  it('subscribed, not enrolled: awaiting_enrolment, contact copy kept, owner shown', () => {
    expect(byId(r, awaiting)).toMatchObject({
      state: 'awaiting_enrolment', blocker: 'awaiting_enrolment', hasContactCopy: true, enrolled: false, learnerLinked: false,
      missingKinds: [], owner: { id: who.repA.id, name: 'rep_a' },
    });
  });

  it('enrolled with channels the family has no room for: channel_missing, the kinds only, 12 days old', () => {
    const l = byId(r, missing);
    expect(l).toMatchObject({ state: 'enrolled', blocker: 'channel_missing', hasContactCopy: true, enrolled: true, learnerLinked: false, ageDays: 12 });
    expect([...l.missingKinds].sort()).toEqual(['email', 'phone', 'whatsapp']);
    for (const k of l.missingKinds) expect(['phone', 'whatsapp', 'email']).toContain(k);
    expect(l.owner.id).toBe(who.repA.id);
  });

  it('enrolled with every channel already in the family\'s record: ready, no kinds missing', () => {
    expect(byId(r, ready)).toMatchObject({ state: 'enrolled', blocker: 'ready', missingKinds: [], hasContactCopy: true, enrolled: true, ageDays: 2, owner: { id: who.repB.id } });
  });

  it('enrolled, no contact copy (state 7): flagged as bookkeeping only, owner null, 40 days old', () => {
    expect(byId(r, noContact)).toMatchObject({ state: 'enrolled_no_contact', blocker: 'no_contact', hasContactCopy: false, enrolled: true, owner: null, ageDays: 40, missingKinds: [] });
  });

  it('learner linked (state 6)', () => {
    expect(byId(r, learner)).toMatchObject({ state: 'learner_linked', learnerLinked: true, hasContactCopy: true });
  });

  it('the oldest wait comes first', () => {
    const ages = (r.json.leads as Array<{ ageDays: number }>).map((l) => l.ageDays);
    expect(ages).toEqual([...ages].sort((a, b) => b - a));
  });
});

describe('3. kinds only: no value, no hash', () => {
  it('the whole response carries none of the seeded contact values, their keyed forms or their hashes', async () => {
    const r = await http('manager', 'GET', '/sales-pipeline/reconciliation');
    const text = JSON.stringify(r.json);
    for (const v of [...VALUES, ...KEYED, ...KEYED.map((k) => k.slice(1))]) expect(text).not.toContain(v);
    for (const k of KEYED) expect(text).not.toContain(contactKeyHash('phone', k));
    expect(text).not.toContain(contactKeyHash('email', 'pd59ho.missing@example.test'));
    expect(text).not.toMatch(/Synthetic Parent|example\.test|\+1555/);
    for (const l of r.json.leads) {
      expect(Object.keys(l).sort()).toEqual(
        ['ageDays', 'blocker', 'displayName', 'enrolled', 'hasContactCopy', 'id', 'learnerLinked', 'missingKinds', 'owner', 'state', 'waitingSince']);
    }
  });
});

describe('4. F8: one rule for handedOver; convert() is unchanged', () => {
  it('the list and the detail agree for every lead, an enrolment counting as handed over', async () => {
    const list = await http('manager', 'GET', '/sales-pipeline/leads');
    for (const id of [awaiting, missing, ready, noContact, learner, plainLead, linkedAlready]) {
      const row = (list.json.leads as Array<any>).find((l) => l.id === id);
      const detail = await http('manager', 'GET', `/sales-pipeline/leads/${id}`);
      expect(detail.json.handedOver).toBe(row.handedOver);
    }
    const flags = async (id: string) => (await http('manager', 'GET', `/sales-pipeline/leads/${id}`)).json;
    expect(await flags(awaiting)).toMatchObject({ handedOver: false, canConvert: true });
    expect(await flags(missing)).toMatchObject({ handedOver: true, canConvert: true });
    expect(await flags(plainLead)).toMatchObject({ handedOver: false, canConvert: true });
    expect(await flags(linkedAlready)).toMatchObject({ handedOver: true, canConvert: false });
  });

  it('Convert still answers channel_missing for the lead the list flags, and awaiting_enrolment for the unenrolled one', async () => {
    const refused = await http('repA', 'POST', `/sales-pipeline/leads/${missing}/convert`, {});
    expect([refused.status, refused.code]).toEqual([409, 'COMM.SALES_LEAD_STATE']);
    expect((await http('repA', 'POST', `/sales-pipeline/leads/${awaiting}/convert`, {})).json).toEqual({ outcome: 'awaiting_enrolment', familyId: null });
    // the contact of the refused lead is kept, so it stays on the list
    const r = await http('manager', 'GET', '/sales-pipeline/reconciliation');
    expect(byId(r, missing)).toMatchObject({ blocker: 'channel_missing', hasContactCopy: true });
  });
});

describe('5. the list is read-only', () => {
  it('changes no row of any table it reads and writes no audit row, on every call and for every role that may call it', async () => {
    const before = await snapshot();
    const audits = await auditTotal();
    for (const actor of ['manager', 'superAdmin', 'manager']) expect((await http(actor, 'GET', '/sales-pipeline/reconciliation')).status).toBe(200);
    for (const actor of ['repA', 'ops', 'finance']) expect((await http(actor, 'GET', '/sales-pipeline/reconciliation')).status).toBe(403);
    expect(await snapshot()).toEqual(before);
    expect(await auditTotal()).toBe(audits);
  });

  it('no write route exists for it', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await http('manager', method, '/sales-pipeline/reconciliation', {});
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
  });
});
