/**
 * PD-12 S3 -- Instalment Payments, end to end on the PD-8 synthetic organization.
 *
 *   1. who reads: Operations supervisors (their families only), the Operations
 *      Manager and the super admin (every family); nobody else -- and Core is
 *      asked ONLY about the families the viewer may see
 *   2. each row: the payer by name, the child or "family", the responsible
 *      supervisor (the child's PD-8 supervisor, or the family's billing
 *      supervisor), the status and order, the conversation to follow up in
 *   3. the billing supervisor: set by the Operations Manager only, chosen
 *      among the supervisors of the family's children, cleared by the database
 *      the moment they supervise none of them
 *   4. Core not connected, Core down: said, never shown as "nothing due"
 *   5. the request role (chat_app) reads none of it (needs DATABASE_APP_URL)
 *
 * Core is a fake here: the HTTP boundary is unit-tested in pd012-s3-billing.spec.
 * Synthetic people only (G-20).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaAuditService } from '@platform/audit.service';
import { hashPassword } from '@platform/auth/password';
import { CommError, CommErrorCode } from '@platform/errors';
import { BillingService } from '../../src/billing/billing.service';
import {
  CoreInvoiceSourceError,
  type CoreInvoice,
  type CoreInvoiceSource,
} from '../../src/billing/core-invoice-source';
import { OrgStructureService } from '../../src/org/org-structure.service';
import { todayIn } from '../../src/leave/leave.service';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

jest.setTimeout(300_000);

const PASSWORD = 'pd12-s3-spec-password-1';
const DOMAIN = 'pd12s3.qa.jawwid.test';

class FakeCore implements CoreInvoiceSource {
  connected = true;
  down = false;
  asked: string[][] = [];
  invoices: CoreInvoice[] = [];
  async invoicesFor(parentIds: readonly string[], opts: { includePaid: boolean }) {
    this.asked.push([...parentIds]);
    if (this.down) throw new CoreInvoiceSourceError('Jawwid Core did not answer');
    const asked = new Set(parentIds);
    return this.invoices.filter((i) => asked.has(i.parentId) && (opts.includePaid || i.status === 'open'));
  }
}

const g = buildGraph();
const audit = new PrismaAuditService();
const core = new FakeCore();
const billing = new BillingService(g.prisma, g.conversations, core, audit);
const org = new OrgStructureService(g.prisma, g.authz, g.conversations, audit);

let m: SeedManifest;
let orgId: string;
let today: string;
const parentOf = new Map<string, string>(); // family id -> core parent id
const childCore = new Map<string, string>(); // learner id -> core child id
/** Core's ids are MongoDB ObjectIds: 24 hex characters, opaque text in Chat (20261019200000). */
const objectId = () => randomBytes(12).toString('hex');

const shift = (days: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function invoice(familyId: string, over: Partial<CoreInvoice> = {}): CoreInvoice {
  return {
    id: `inv-${randomUUID().slice(0, 8)}`,
    parentId: parentOf.get(familyId)!,
    childId: null,
    amountMinor: 120000,
    currency: 'EGP',
    dueDate: shift(3),
    status: 'open',
    paidAt: null,
    label: null,
    ...over,
  };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

/** A family whose two children have DIFFERENT supervisors (scenario C, two kids). */
const splitFamily = () => m.families.find((f) => f.children.length === 2 && f.children[0]!.supervisorId !== f.children[1]!.supervisorId)!;
/** A one-child family. */
const singleFamily = () => m.families.find((f) => f.children.length === 1)!;

function reachableFamilies(staffId: string): Set<string> {
  const principals = new Set([staffId]);
  for (const l of m.backupLinks) if (l.active && l.backupId === staffId) principals.add(l.primaryId);
  return new Set(m.families.filter((f) => f.children.some((c) => principals.has(c.supervisorId))).map((f) => f.id));
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd12s3-${orgId.slice(0, 8)}', 'PD-12 S3 QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
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
  // Core identities: the seed has none (it is not a Core sync).
  for (const f of m.families) {
    const p = objectId();
    parentOf.set(f.id, p);
    await g.prisma.$executeRaw`update chat.family set core_parent_id = ${p} where id = ${f.id}::uuid`;
    for (const c of f.children) {
      const k = objectId();
      childCore.set(c.id, k);
      await g.prisma.$executeRaw`update chat.learner set core_child_id = ${k} where id = ${c.id}::uuid`;
    }
  }
  today = todayIn('Africa/Cairo');
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  core.connected = true;
  core.down = false;
  core.asked = [];
  core.invoices = [];
  await g.prisma.$executeRaw`delete from chat.family_billing_supervision where organization_id = ${orgId}::uuid`;
});

describe('1. who reads instalments', () => {
  it('Operations supervisors read their own families; Core is asked about nothing else', async () => {
    for (const s of m.supervisors) {
      core.asked = [];
      const out = await billing.list(s.id, {});
      expect(out.source).toBe('core');
      const expected = [...reachableFamilies(s.id)].map((id) => parentOf.get(id)!).sort();
      expect(expected.length).toBeGreaterThan(0);
      expect(core.asked.flat().sort()).toEqual(expected);
    }
  });

  it('the Operations Manager and the super admin read every family', async () => {
    for (const who of [m.operationsManager.id, m.superAdmin.id]) {
      core.asked = [];
      await billing.list(who, {});
      expect(new Set(core.asked.flat())).toEqual(new Set(parentOf.values()));
    }
    expect((await billing.access(m.operationsManager.id)).canAssignBillingSupervisor).toBe(true);
  });

  it('nobody else: Teachers and Sales departments, a teacher, a parent', async () => {
    const refused = [
      m.teachersManager.id,
      m.salesManager.id,
      ...m.teacherSupervisors.map((s) => s.id),
      m.teachers[0]!.id,
      m.families[0]!.parent.id,
    ];
    for (const who of refused) {
      expect(await code(billing.list(who, {}))).toBe(CommErrorCode.BILLING_DENIED);
      expect((await billing.access(who)).billingReader).toBe(false);
    }
    expect(core.asked).toEqual([]);
  });
});

describe('2. the rows', () => {
  it('names the payer, the child or "family", the responsible supervisor, and orders them', async () => {
    const f = splitFamily();
    const [c0, c1] = f.children as [SeedManifest['families'][0]['children'][0], SeedManifest['families'][0]['children'][0]];
    core.invoices = [
      invoice(f.id, { id: 'upcoming-far', dueDate: shift(20) }),
      invoice(f.id, { id: 'overdue-new', dueDate: shift(-2), childId: childCore.get(c0.id)! }),
      invoice(f.id, { id: 'due-today', dueDate: today, childId: childCore.get(c1.id)! }),
      invoice(f.id, { id: 'overdue-old', dueDate: shift(-30) }),
      invoice(f.id, { id: 'upcoming-near', dueDate: shift(1) }),
      invoice(f.id, { id: 'paid', dueDate: shift(-60), status: 'paid', paidAt: new Date().toISOString() }),
    ];
    const out = await billing.list(m.operationsManager.id, {});
    const mine = out.items.filter((i) => i.family.id === f.id);
    expect(mine.map((i) => i.id)).toEqual(['overdue-old', 'overdue-new', 'due-today', 'upcoming-near', 'upcoming-far']);
    const byId = new Map(mine.map((i) => [i.id, i]));
    expect(byId.get('overdue-old')).toMatchObject({ status: 'overdue', days: 30, child: null, responsibleBasis: 'family', responsibleSupervisor: null });
    expect(byId.get('overdue-new')).toMatchObject({
      status: 'overdue',
      child: { id: c0.id, name: c0.name, known: true },
      responsibleBasis: 'child',
      responsibleSupervisor: { id: c0.supervisorId },
    });
    expect(byId.get('due-today')).toMatchObject({ status: 'due', responsibleSupervisor: { id: c1.supervisorId } });
    expect(byId.get('upcoming-near')).toMatchObject({ status: 'upcoming', days: 1 });
    expect(mine[0]!.account.name).toBe(f.parent.name);
    expect(out.counts).toMatchObject({ overdue: 2, due: 1, upcoming: 2, paid: 0, unassigned: 3 });

    const withPaid = await billing.list(m.operationsManager.id, { paid: 'true' });
    expect(withPaid.items.filter((i) => i.family.id === f.id).map((i) => i.id).at(-1)).toBe('paid');
  });

  it('a child Core names outside the payer\'s family is unknown, never another family\'s supervisor', async () => {
    const f = singleFamily();
    const other = splitFamily();
    core.invoices = [invoice(f.id, { id: 'foreign-child', childId: childCore.get(other.children[0]!.id)! })];
    const [row] = (await billing.list(m.operationsManager.id, {})).items;
    expect(row).toMatchObject({ id: 'foreign-child', child: { id: null, name: null, known: false }, responsibleSupervisor: null });
  });

  it('opens a direct conversation of the family that this viewer may open', async () => {
    const f = m.families.find((x) => x.directs.length > 0)!;
    core.invoices = [invoice(f.id)];
    const supervisor = f.directs[0]!.supervisorId;
    const [row] = (await billing.list(supervisor, {})).items;
    expect(f.directs.map((d) => d.conversationId)).toContain(row!.conversationId);
    const access = await g.prisma.$queryRaw<{ a: string | null }[]>`
      select chat.staff_conversation_access(${supervisor}::uuid, ${row!.conversationId}::uuid) as a`;
    expect(access[0]!.a).not.toBeNull();
  });

  it('a supervisor reads every invoice of a family they reach -- and only those families', async () => {
    const f = splitFamily();
    const outsider = m.supervisors.find((s) => !reachableFamilies(s.id).has(f.id))!;
    core.invoices = [invoice(f.id, { childId: childCore.get(f.children[1]!.id)! })];
    expect((await billing.list(f.children[0]!.supervisorId, {})).items).toHaveLength(1);
    expect((await billing.list(outsider.id, {})).items).toHaveLength(0);
  });
});

describe('3. the family billing supervisor', () => {
  it('the Operations Manager sets it among the children\'s supervisors; it becomes the responsible supervisor', async () => {
    const f = splitFamily();
    const chosen = f.children[1]!.supervisorId;
    const view = await billing.billingSupervisor(m.operationsManager.id, f.id);
    expect(view.current).toBeNull();
    expect(view.candidates.map((c) => c.id).sort()).toEqual([...new Set(f.children.map((c) => c.supervisorId))].sort());

    core.invoices = [invoice(f.id, { id: 'family-inv' })];
    expect((await billing.list(m.operationsManager.id, { responsible: 'none' })).items.map((i) => i.id)).toEqual(['family-inv']);

    await billing.setBillingSupervisor(m.operationsManager.id, f.id, { supervisorId: chosen, reason: 'billing follows the elder child' });
    const [row] = (await billing.list(m.operationsManager.id, {})).items;
    expect(row!.responsibleSupervisor).toMatchObject({ id: chosen });
    expect((await billing.list(m.operationsManager.id, { responsible: 'none' })).items).toEqual([]);
    expect((await billing.list(chosen, { responsible: 'me' })).items.map((i) => i.id)).toEqual(['family-inv']);

    const audited = await g.prisma.auditLog.findFirst({ where: { entityId: f.id, action: 'family.billing_supervisor_set' } });
    expect(audited).toMatchObject({ actorId: m.operationsManager.id, after: { supervisorId: chosen } });

    await billing.setBillingSupervisor(m.operationsManager.id, f.id, { supervisorId: null, reason: 'reset' });
    expect((await billing.billingSupervisor(m.operationsManager.id, f.id)).current).toBeNull();
  });

  it('a supervisor may not set it, and nobody may name a supervisor who does not supervise a child of the family', async () => {
    const f = singleFamily();
    const own = f.children[0]!.supervisorId;
    expect(await code(billing.setBillingSupervisor(own, f.id, { supervisorId: own, reason: 'r' }))).toBe(CommErrorCode.BILLING_DENIED);
    const stranger = m.supervisors.find((s) => s.id !== own)!.id;
    expect(await code(billing.setBillingSupervisor(m.operationsManager.id, f.id, { supervisorId: stranger, reason: 'r' }))).toBe(
      CommErrorCode.ORG_STRUCTURE_INVALID,
    );
    expect(await code(billing.setBillingSupervisor(m.superAdmin.id, f.id, { supervisorId: m.teacherSupervisors[0]!.id, reason: 'r' }))).toBe(
      CommErrorCode.ORG_STRUCTURE_INVALID,
    );
    expect(await code(billing.setBillingSupervisor(m.operationsManager.id, f.id, { supervisorId: own }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(billing.billingSupervisor(m.operationsManager.id, randomUUID()))).toBe(CommErrorCode.BILLING_NOT_FOUND);
  });

  it('is cleared, with an audit row, when the children move away from the billing supervisor', async () => {
    const f = splitFamily();
    const [c0, c1] = f.children as [SeedManifest['families'][0]['children'][0], SeedManifest['families'][0]['children'][0]];
    await billing.setBillingSupervisor(m.superAdmin.id, f.id, { supervisorId: c0.supervisorId, reason: 'r' });
    // c0 moves to c1's supervisor: the billing supervisor supervises nobody in the family any more.
    await org.assignSupervisor(m.superAdmin.id, c0.id, { supervisorId: c1.supervisorId, reason: 'rebalance' });
    try {
      expect(await g.prisma.familyBillingSupervision.findUnique({ where: { familyId: f.id } })).toBeNull();
      const cleared = await g.prisma.auditLog.findFirst({
        where: { entityId: f.id, action: 'family.billing_supervisor_cleared', actorId: null },
      });
      expect(cleared?.before).toEqual({ supervisorId: c0.supervisorId });
    } finally {
      await org.assignSupervisor(m.superAdmin.id, c0.id, { supervisorId: c0.supervisorId, reason: 'restore' });
    }
  });

  it('survives a reassignment that keeps one of the family\'s children with them', async () => {
    const f = m.families.find((x) => x.children.length >= 2 && x.children[0]!.supervisorId === x.children[1]!.supervisorId)!;
    const [c0] = f.children as [SeedManifest['families'][0]['children'][0]];
    const elsewhere = m.supervisors.find((s) => s.id !== c0.supervisorId)!.id;
    await billing.setBillingSupervisor(m.superAdmin.id, f.id, { supervisorId: c0.supervisorId, reason: 'r' });
    await org.assignSupervisor(m.superAdmin.id, c0.id, { supervisorId: elsewhere, reason: 'rebalance' });
    try {
      expect((await g.prisma.familyBillingSupervision.findUnique({ where: { familyId: f.id } }))?.supervisorId).toBe(c0.supervisorId);
    } finally {
      await org.assignSupervisor(m.superAdmin.id, c0.id, { supervisorId: c0.supervisorId, reason: 'restore' });
    }
  });
});

describe('4. Core not connected, Core down', () => {
  it('not connected: said so, and Core is never asked', async () => {
    core.connected = false;
    const out = await billing.list(m.operationsManager.id, {});
    expect(out).toMatchObject({ source: 'not_connected', items: [] });
    expect(core.asked).toEqual([]);
    expect((await billing.access(m.operationsManager.id)).coreConnected).toBe(false);
  });

  it('down: a 502 BILLING_CORE_UNAVAILABLE, never an empty "nothing due" list', async () => {
    core.down = true;
    const err = await billing.list(m.operationsManager.id, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommError);
    expect(err).toMatchObject({ code: CommErrorCode.BILLING_CORE_UNAVAILABLE, status: 502 });
  });

  it('nothing about an invoice is written anywhere in Chat', async () => {
    const f = singleFamily();
    core.invoices = [invoice(f.id, { id: 'inv-not-stored-7731' })];
    await billing.list(m.operationsManager.id, {});
    const hits = await g.prisma.$queryRaw<{ n: bigint }[]>`
      select (select count(*) from chat.audit_log where before::text like '%inv-not-stored-7731%' or after::text like '%inv-not-stored-7731%')
           + (select count(*) from chat.event_log where payload::text like '%inv-not-stored-7731%') as n`;
    expect(Number(hits[0]!.n)).toBe(0);
  });
});

const appUrl = process.env.DATABASE_APP_URL;
(appUrl ? describe : describe.skip)('5. the request role (chat_app)', () => {
  let app2: PrismaClient;
  beforeAll(() => {
    app2 = new PrismaClient({ datasourceUrl: appUrl });
  });
  afterAll(async () => {
    await app2.$disconnect();
  });

  it('reads and writes no billing supervision, and cannot call the clearing function', async () => {
    const f = singleFamily();
    await billing.setBillingSupervisor(m.superAdmin.id, f.id, { supervisorId: f.children[0]!.supervisorId, reason: 'r' });
    const read = await app2.$queryRawUnsafe(`select * from chat.family_billing_supervision`).catch((e: Error) => e);
    expect(read).toBeInstanceOf(Error);
    const write = await app2
      .$executeRawUnsafe(`delete from chat.family_billing_supervision where family_id = '${f.id}'::uuid`)
      .catch((e: Error) => e);
    expect(write).toBeInstanceOf(Error);
    const call = await app2.$queryRawUnsafe(`select chat.clear_stale_billing_supervisor('${f.id}'::uuid)`).catch((e: Error) => e);
    expect(call).toBeInstanceOf(Error);
    expect(await g.prisma.familyBillingSupervision.findUnique({ where: { familyId: f.id } })).not.toBeNull();
  });
});
