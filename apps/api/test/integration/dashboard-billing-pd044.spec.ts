/**
 * PD-44 PR-5 -- the Dashboard's Payments section, GET /dashboard/billing
 * (docs/product/pd044-manager-dashboard-plan.md §3.5, §6).
 *
 *   parity    every tile equals what the page it links to shows the same
 *             person at the same instant:
 *               instalments.overdue / .due / .unassigned
 *                                     GET /instalments -- its own counts line
 *               receipts.pending      GET /payment-receipts -- counts.pending
 *               parents.locked / .grace
 *                                     GET /parent-profiles?access=locked|grace,
 *                                     each child's state computed NOW, as
 *                                     enforcement computes it -- never the
 *                                     stored row a sweep may not have refreshed
 *   scope     the billing scope (all, the families a supervisor reaches,
 *             Sales' own under PD-42) as each page applies it -- with a
 *             second family, so a supervisor reaches one family of two
 *   absent    a tile outside the caller's basis is left out, never sent as 0
 *   tenant    another organization's super admin counts nothing of this one
 *   bounded   the statements one request runs do not grow with the rows (N+1)
 *
 * Synthetic fixtures only (G-16).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { PrismaService } from '@platform/prisma.service';
import { AvatarService } from '@communication/profile/avatar.service';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { BillingService } from '../../src/billing/billing.service';
import { PaymentLedger } from '../../src/billing/payment-ledger.service';
import { PaymentReminders } from '../../src/billing/payment-reminders.service';
import { PaymentsReadService } from '../../src/billing/payments-read.service';
import { PaymentsService } from '../../src/billing/payments.service';
import { ParentRecordService } from '../../src/parent-profile/parent-record.service';
import type { DashboardTile } from '../../src/dashboard/dashboard-tile';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';
import { FakeStripe } from './fake-stripe';

const logged = new PrismaService({ log: [{ emit: 'event', level: 'query' }] });
let statements = 0;
(logged as unknown as { $on(event: 'query', cb: () => void): void }).$on('query', () => {
  statements += 1;
});

const g = buildGraph(undefined, logged);
const audit = new PrismaAuditService();
const stripe = new FakeStripe();
const ledger = new PaymentLedger(g.prisma, audit, g.notifications, g.reminders);
const reads = new PaymentsReadService(g.prisma);
const reminders = new PaymentReminders(g.prisma, g.reminders);
const billing = new BillingService(g.prisma, g.conversations, audit, ledger, reads, reminders, stripe);
const payments = new PaymentsService(g.prisma, g.conversations, billing, ledger, reads, g.notifications, stripe, audit);
const parents = new ParentRecordService(g.prisma, g.conversations, new AvatarService(g.prisma, g.conversations, new SignedLocalObjectStorage(), audit), audit);

jest.setTimeout(120_000);

const BILLING_KEYS = ['instalments.overdue', 'instalments.due', 'instalments.unassigned', 'receipts.pending'] as const;
const PARENT_KEYS = ['parents.locked', 'parents.grace'] as const;

let s: Scenario;
let salesId: string;
let tsupId: string;
let sa: string;
let sa2: string;
let org2: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const exec = (sql: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(sql, ...args);
const tileOf = (tiles: DashboardTile[], key: string) => tiles.find((t) => t.key === key);
const keys = (tiles: DashboardTile[]) => tiles.map((t) => t.key).sort();
const both = async (actorId: string) => [
  ...(await billing.dashboardCounts(actorId)),
  ...(await payments.dashboardCounts(actorId)),
  ...(await parents.dashboardCounts(actorId)),
];

async function counted<T>(run: () => Promise<T>): Promise<{ result: T; n: number }> {
  statements = 0;
  const result = await run();
  return { result, n: statements };
}

/** A family the instalments, receipts and packages below belong to: family_x by default. */
interface Fam {
  familyId: string;
  parentId: string;
  learnerId: string;
}
const famX = (): Fam => ({ familyId: s.familyId, parentId: s.parentId, learnerId: s.learnerId });

/** An instalment due `days` from the academy's today; a child's when `learnerId` is given. */
async function instalment(days: number, learnerId: string | null = s.learnerId, f: Fam = famX()): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.family_instalment (family_id, learner_id, label, amount_minor, currency, due_date, created_by)
     values ($1::uuid, $2::uuid, 'October', 50000, 'EGP', chat.academy_today() + $3::int, $4::uuid)
     returning id::text as id`,
    f.familyId, learnerId, days, s.managerId,
  );
  return id;
}

/** A payment link and a parent's transfer receipt against it, waiting for review. */
async function pendingReceipt(f: Fam = famX()): Promise<void> {
  const [{ id: requestId }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.payment_request (family_id, learner_id, token, purpose, label, amount_minor, currency, expires_at, created_by)
     values ($1::uuid, $2::uuid, $3, 'other', 'October', 50000, 'EGP', now() + interval '14 days', $4::uuid)
     returning id::text as id`,
    f.familyId, f.learnerId, randomBytes(32).toString('base64url'), s.managerId,
  );
  await exec(
    `insert into chat.payment_receipt (family_id, request_id, amount_minor, currency, transferred_on, object_key, mime_type, byte_size, uploaded_by)
     values ($1::uuid, $2::uuid, 50000, 'EGP', chat.academy_today(), 'payment-receipts/' || gen_random_uuid(), 'image/png', 1024, $3::uuid)`,
    f.familyId, requestId, f.parentId,
  );
}

/**
 * A child's carried-over package (PD-42): `used` of `included` lessons done.
 * Used = included leaves a balance of 0, inside the 2-lesson grace; 6 past it
 * locks. Written as data with triggers off, so the stored chat.learner_access
 * row is NOT refreshed: only a state computed now sees it.
 */
async function carried(learnerId: string, included: number, used: number, familyId = s.familyId): Promise<void> {
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`set local session_replication_role = replica`),
    g.prisma.$executeRawUnsafe(
      `insert into chat.learner_subscription (organization_id, learner_id, family_id, lessons_included, lessons_used_before,
                                              starts_on, source, created_by, over_confirmed_by, note)
       values (chat.default_organization_id(), $1::uuid, $2::uuid, $3::int, $4::int,
               chat.academy_today() - 60, 'carried_over', $5::uuid, $6::uuid, 'PD-44 test package')`,
      learnerId, familyId, included, used, s.managerId, used > included ? s.managerId : null,
    ),
  ]);
}
const lockedChild = (learnerId: string, familyId = s.familyId) => carried(learnerId, 4, 10, familyId);
const graceChild = (learnerId: string, familyId = s.familyId) => carried(learnerId, 4, 4, familyId);

/** Ends a child's packages, so its state is open again (triggers off: the stored row is not refreshed). */
async function voidPackages(learnerId: string): Promise<void> {
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`set local session_replication_role = replica`),
    g.prisma.$executeRawUnsafe(`update chat.learner_subscription set voided_at = now() where learner_id = $1::uuid`, learnerId),
  ]);
}

/** A stored chat.learner_access row saying `state`, as a sweep that has not run since would leave it. */
async function staleRow(learnerId: string, state: 'locked' | 'grace' | 'open') {
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`set local session_replication_role = replica`),
    g.prisma.$executeRawUnsafe(
      `insert into chat.learner_access (learner_id, organization_id, family_id, state, reasons)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $3, $4::text[])
       on conflict (learner_id) do update set state = excluded.state, reasons = excluded.reasons`,
      learnerId, s.familyId, state, state === 'locked' ? ['overdue'] : [],
    ),
  ]);
}

/** PD-30's go-live: instalments due on or after it lock once overdue. */
async function goLive(daysAgo: number) {
  await exec(
    `insert into chat.config (key, value) values ('subscription.overdue_from', to_jsonb((chat.academy_today() - $1::int)::text))
     on conflict (key) do update set value = excluded.value`,
    daysAgo,
  );
}

/**
 * family_y: one parent and one child, learner_y, supervised by admin_b
 * (otherAdminId) -- so admin_a (ownerId) reaches family_x only, admin_b
 * family_y only, and the Operations manager both.
 */
async function familyY(): Promise<Fam> {
  const f: Fam = { familyId: randomUUID(), parentId: randomUUID(), learnerId: randomUUID() };
  await exec(`insert into chat.family (id, display_name, owner_id, language) values ($1::uuid, 'family_y', $2::uuid, 'ar')`, f.familyId, s.ownerId);
  await exec(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ($1::uuid, $2::uuid, 'parent_y', 'primary_guardian', true, true)`,
    f.parentId, f.familyId,
  );
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${f.learnerId}'::uuid, '${f.familyId}'::uuid, 'learner_y', '${s.teacherId}'::uuid)`,
  );
  await exec(
    `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id, assigned_by)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`,
    f.learnerId, s.otherAdminId, s.managerId,
  );
  return f;
}

/** What the Instalments, Payments and Parents pages show this person. */
async function pages(actorId: string, billingPage: boolean, parentsPage: boolean) {
  const out: Record<string, number | undefined> = {};
  if (billingPage) {
    const { counts } = await billing.list(actorId, {});
    out['instalments.overdue'] = counts.overdue;
    out['instalments.due'] = counts.due;
    out['instalments.unassigned'] = counts.unassigned;
    out['receipts.pending'] = (await payments.receipts(actorId, 'pending')).counts.pending;
  }
  if (parentsPage) {
    out['parents.locked'] = (await parents.list(actorId, undefined, 'locked')).items.length;
    out['parents.grace'] = (await parents.list(actorId, undefined, 'grace')).items.length;
  }
  return out;
}

async function expectParity(actorId: string, billingPage: boolean, parentsPage: boolean) {
  const tiles = await both(actorId);
  const page = await pages(actorId, billingPage, parentsPage);
  for (const k of BILLING_KEYS) expect({ actorId, k, n: tileOf(tiles, k)?.count }).toEqual({ actorId, k, n: billingPage ? page[k] : undefined });
  for (const k of PARENT_KEYS) expect({ actorId, k, n: tileOf(tiles, k)?.count }).toEqual({ actorId, k, n: parentsPage ? page[k] : undefined });
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await resetConfig();
  await truncate(g.prisma);
  await exec(`delete from chat.organization where slug like 'pd044b-%'`).catch(() => undefined);
  await g.prisma.$disconnect();
});
const resetConfig = () => exec(`delete from chat.config where key in ('subscription.overdue_from', 'sales.family_scope')`);

beforeEach(async () => {
  await resetConfig();
  await truncate(g.prisma);
  await exec(`delete from chat.organization where slug like 'pd044b-%'`).catch(() => undefined);
  s = await seed(g.prisma);
  [salesId, tsupId, sa, sa2, org2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await exec(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sales_b', 'admin', true), ($2::uuid, 'tsup_b', 'admin', true)`,
    salesId, tsupId,
  );
  await exec(`insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'org_two')`, org2, `pd044b-${org2.slice(0, 8)}`);
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_b', 'super_admin', true)`, sa),
    g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active, organization_id) values ($1::uuid, 'sa_two_b', 'super_admin', true, $2::uuid)`, sa2, org2,
    ),
  ]);
  for (const [kind, staffId] of [['sales', salesId], ['teachers', tsupId]] as const) {
    const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.department (kind, display_name) values ($1, $1) returning id::text as id`, kind,
    );
    await exec(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
      staffId, id,
    );
  }
});

// ---------------------------------------------------------------------------

describe('GET /dashboard/billing -- instalments, receipts and locked subscriptions', () => {
  beforeEach(async () => {
    // learner_l's (admin_a responsible): one overdue, one upcoming; the family's own, due today, with no billing supervisor.
    await instalment(-3);
    await instalment(5);
    await instalment(0, null);
    await pendingReceipt();
    await pendingReceipt();
    // family_x's children are in different states: learner_l locked (6 lessons past its balance), learner_m in grace.
    await lockedChild(s.learnerId);
    await graceChild(s.secondLearnerId);
  });

  it('equals the Instalments counts, the pending receipts and the Parents filter for every persona', async () => {
    // [persona, opens Instalments/Payments, opens Parents]
    const personas: Array<[string, boolean, boolean]> = [
      [s.managerId, true, true], // the Operations manager: every family
      [s.ownerId, true, true], // an Operations supervisor: the families they reach
      [s.otherAdminId, true, true], // an Operations supervisor who reaches none
      [salesId, true, true], // Sales: every family (PD-42's default scope)
      [sa, true, true],
      [sa2, true, true],
    ];
    for (const [p, billingPage, parentsPage] of personas) await expectParity(p, billingPage, parentsPage);

    const mgr = await both(s.managerId);
    expect(tileOf(mgr, 'instalments.overdue')?.count).toBe(1);
    expect(tileOf(mgr, 'instalments.due')?.count).toBe(1);
    expect(tileOf(mgr, 'instalments.unassigned')?.count).toBe(1);
    expect(tileOf(mgr, 'receipts.pending')?.count).toBe(2);
    // family_x has two active parents; both are listed under each filter.
    expect(tileOf(mgr, 'parents.locked')?.count).toBe(2);
    expect(tileOf(mgr, 'parents.grace')?.count).toBe(2);
    expect(tileOf(await both(s.otherAdminId), 'instalments.overdue')?.count).toBe(0);
  });

  it('counts a family whose children are in different states under each state, and follows each child', async () => {
    let mgr = await both(s.managerId);
    expect([tileOf(mgr, 'parents.locked')?.count, tileOf(mgr, 'parents.grace')?.count]).toEqual([2, 2]);
    // learner_m's package ends: open. The family is still locked through learner_l, no longer in grace.
    await voidPackages(s.secondLearnerId);
    await expectParity(s.managerId, true, true);
    mgr = await both(s.managerId);
    expect([tileOf(mgr, 'parents.locked')?.count, tileOf(mgr, 'parents.grace')?.count]).toEqual([2, 0]);
    // learner_l's too: open, so neither.
    await voidPackages(s.learnerId);
    await expectParity(s.managerId, true, true);
    mgr = await both(s.managerId);
    expect([tileOf(mgr, 'parents.locked')?.count, tileOf(mgr, 'parents.grace')?.count]).toEqual([0, 0]);
  });

  it('counts the state as enforcement computes it now, never the stored row', async () => {
    // The stored rows say open; the inputs say locked and grace.
    await staleRow(s.learnerId, 'open');
    await staleRow(s.secondLearnerId, 'open');
    await expectParity(s.managerId, true, true);
    let mgr = await both(s.managerId);
    expect([tileOf(mgr, 'parents.locked')?.count, tileOf(mgr, 'parents.grace')?.count]).toEqual([2, 2]);
    // Unlock learner_l, and say so in its stored row; the family is not locked.
    await voidPackages(s.learnerId);
    await staleRow(s.learnerId, 'open');
    expect(tileOf(await both(s.managerId), 'parents.locked')?.count).toBe(0);
    // PD-30 goes live a month back: learner_l's instalment 3 days overdue locks it at once, with no sweep run.
    await goLive(30);
    await expectParity(s.managerId, true, true);
    mgr = await both(s.managerId);
    expect(tileOf(mgr, 'parents.locked')?.count).toBe(2);
    // ... while its stored row still says open.
    expect((await g.prisma.$queryRawUnsafe<Array<{ state: string }>>(
      `select state from chat.learner_access where learner_id = $1::uuid`, s.learnerId))[0]?.state).toBe('open');
  });

  it('leaves out what the caller cannot open, and refuses anyone who is not staff', async () => {
    expect(keys(await both(s.managerId))).toEqual([...BILLING_KEYS, ...PARENT_KEYS].sort());
    // The Teachers department reads no family's money and no Parent Profile.
    expect(await both(tsupId)).toEqual([]);
    expect(await code(billing.dashboardCounts(s.parentId))).toBe(CommErrorCode.BILLING_DENIED);
    expect(await code(payments.dashboardCounts(s.parentId))).toBe(CommErrorCode.BILLING_DENIED);
    expect(await code(parents.dashboardCounts(s.parentId))).toBe(CommErrorCode.PARENT_PROFILE_DENIED);
    expect((await both(sa2)).every((t) => t.count === 0)).toBe(true);
    expect((await both(sa)).every((t) => t.capped === false)).toBe(true);
  });

  it('counts, for a supervisor who reaches one family of two, only that family', async () => {
    const y = await familyY();
    await instalment(-2, y.learnerId, y);
    await pendingReceipt(y);
    await lockedChild(y.learnerId, y.familyId);
    for (const p of [s.managerId, s.ownerId, s.otherAdminId, salesId, sa, sa2]) await expectParity(p, true, true);

    const counts = async (p: string) => {
      const t = await both(p);
      return ['instalments.overdue', 'receipts.pending', 'parents.locked', 'parents.grace'].map((k) => tileOf(t, k)?.count);
    };
    // admin_a reaches family_x only; admin_b family_y only; the manager both.
    expect(await counts(s.ownerId)).toEqual([1, 2, 2, 2]);
    expect(await counts(s.otherAdminId)).toEqual([1, 1, 1, 0]);
    expect(await counts(s.managerId)).toEqual([2, 3, 3, 2]);
  });

  it("counts, for Sales under the 'own' switch (PD-42), only the families it owns", async () => {
    const y = await familyY();
    await instalment(-2, y.learnerId, y);
    await pendingReceipt(y);
    await lockedChild(y.learnerId, y.familyId);
    await exec(
      `insert into chat.family_sales_owner (family_id, organization_id, staff_id, assigned_by)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $2::uuid)`,
      y.familyId, salesId,
    );
    await exec(`insert into chat.config (key, value) values ('sales.family_scope', to_jsonb('own'::text))`);
    g.config.invalidate();
    await expectParity(salesId, true, true);
    const t = await both(salesId);
    expect(['instalments.overdue', 'instalments.due', 'receipts.pending', 'parents.locked', 'parents.grace'].map((k) => tileOf(t, k)?.count))
      .toEqual([1, 0, 1, 1, 0]);
  });

  it('caps the receipts tile at the list it opens (200), and says so', async () => {
    await exec(
      `insert into chat.payment_receipt (family_id, request_id, amount_minor, currency, transferred_on, object_key, mime_type, byte_size, uploaded_by)
       select r.family_id, r.request_id, r.amount_minor, r.currency, r.transferred_on, 'payment-receipts/' || gen_random_uuid(), r.mime_type, r.byte_size, r.uploaded_by
         from chat.payment_receipt r, generate_series(1, 200)
        where r.family_id = $1::uuid
        limit 200`,
      s.familyId,
    );
    const tile = tileOf(await both(s.managerId), 'receipts.pending');
    expect((await payments.receipts(s.managerId, 'pending')).items.length).toBe(200);
    expect(tile).toMatchObject({ count: 200, capped: true });
  });

  it('runs the same number of statements for a few rows as for many (no N+1)', async () => {
    g.config.invalidate();
    const small = await counted(() => both(s.managerId));
    for (let i = 0; i < 8; i += 1) await instalment(-(i + 4));
    for (let i = 0; i < 4; i += 1) await pendingReceipt();
    g.config.invalidate();
    const large = await counted(() => both(s.managerId));
    await expectParity(s.managerId, true, true);
    expect(tileOf(large.result, 'instalments.overdue')?.count).toBe(9);
    expect(large.n).toBe(small.n);
  });
});
