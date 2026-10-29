/**
 * PD-42 PR-2 -- entering families by hand (the intake from Jawwid Core), and
 * the Sales scope switch at the API and the database.
 *
 *   1. entering: an Operations supervisor (their own supervision), a Sales
 *      member (their own family, waiting for an Operations supervisor), a
 *      manager for one of their supervisors (D5); the three required fields
 *   2. idempotency and duplicates (S1): a replayed intake id, the same parent
 *      by e-mail or number however typed, two supervisors at the same moment
 *   3. the carried-over package at intake, afterwards, and its correction
 *   4. Add child; the sign-in e-mail entered later
 *   5. the Sales switch: 'all' changes nothing; 'own' narrows a Sales member to
 *      the families they own, at the API and at the database; the Sales
 *      manager keeps every family; a Sales account edits its own families only
 *   6. review of #202: the intake waits for the contact-key backfill; PD-16
 *      Assign keys its parents; a replay must be the same intake; a local
 *      number needs its country; one answer for every parent the caller may not
 *      act on; 'own' everywhere a Sales member reaches (accounts, money,
 *      subscriptions, the contact record, Add child)
 *
 * Synthetic fixtures only (G-16). Fresh e-mails per test: accounts outlive truncate.
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { billingAccessOf } from '../../src/billing/billing-access';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { FamilyIntakeService } from '../../src/new-students/intake.service';
import { ParentRecordService } from '../../src/parent-profile/parent-record.service';
import { AvatarService } from '../../src/communication/profile/avatar.service';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { SalesScopeService } from '../../src/platform/sales-scope';
import { AuthService } from '@platform/auth/auth.service';
import { PrismaIdentityService } from '@platform/identity.service';
import { PasswordResetService } from '../../src/platform/auth/password-reset.service';
import { AccountAdminService } from '../../src/account-admin/account-admin.service';
import { BillingService } from '../../src/billing/billing.service';
import { SubscriptionLedger } from '../../src/billing/subscription-ledger.service';
import { NO_SUBSCRIPTION_LOCK } from '@platform/subscription-lock';
import { backfillFamilyContactKeys } from '../../src/parent-profile/family-contact-keys';
import { contactKeyHash } from '../../src/new-students/contact-key';
import { buildGraph, seed, truncate, type Scenario } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(60_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const intake = new FamilyIntakeService(g.prisma, g.conversations, lessons, scheduling, audit);
const avatars = new AvatarService(g.prisma, g.conversations, new SignedLocalObjectStorage(), audit);
const parents = new ParentRecordService(g.prisma, g.conversations, avatars, audit);
parents.onModuleInit();
const auth = new AuthService(g.prisma, new PrismaIdentityService(g.prisma), audit);
const accounts = new AccountAdminService(g.prisma, g.authz, auth, new PasswordResetService(g.prisma, auth, audit), audit);
const billing = new BillingService(g.prisma, g.conversations, audit);
const ledger = new SubscriptionLedger(g.prisma, g.conversations, billing, audit, NO_SUBSCRIPTION_LOCK);

let s: Scenario;
let salesA: string;
let salesB: string;
let salesManager: string;
let superId: string;
let tsupId: string;
let n = 0;

const sql = (q: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(q, ...args);

/** The JSON of `value` with every uuid taken out: digits inside an id never pass for a phone (G-07 checks). */
function withoutIds(value: unknown): string {
  return JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>');
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

async function refusal(p: Promise<unknown>): Promise<CommError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

/** A fresh Egyptian mobile, as typed locally. */
function phone(): string {
  n += 1;
  return `010${String(10_000_000 + n).slice(-8)}`;
}

function form(over: Record<string, unknown> = {}) {
  return {
    intakeId: randomUUID(),
    parent: { name: 'parent_i', phone: phone() },
    children: [{ name: 'child_i' }],
    ...over,
  };
}

async function staff(id: string, name: string, role: string) {
  await sql(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, $2, $3, true)`, id, name, role);
}

async function department(kind: string, managerId: string | null, members: string[]) {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ($1, $1, $2::uuid) returning id::text as id`, kind, managerId,
  );
  for (const m of members) {
    await sql(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`, m, id,
    );
  }
}

async function ready(on: boolean) {
  if (on) {
    await sql(`insert into chat.config (key, value) values ('intake.contact_keys_ready', 'true'::jsonb)
               on conflict (key) do update set value = excluded.value`);
  } else {
    await sql(`delete from chat.config where key = 'intake.contact_keys_ready'`);
  }
}

async function scope(value: 'all' | 'own') {
  await sql(
    `insert into chat.config (key, value) values ('sales.family_scope', to_jsonb($1::text))
     on conflict (key) do update set value = excluded.value`, value,
  );
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await sql(`delete from chat.config where key in ('sales.family_scope', 'intake.contact_keys_ready')`);
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await sql(`delete from chat.config where key = 'sales.family_scope'`);
  await ready(true);
  await truncate(g.prisma);
  s = await seed(g.prisma);
  salesA = randomUUID();
  salesB = randomUUID();
  salesManager = randomUUID();
  superId = randomUUID();
  tsupId = randomUUID();
  await staff(salesA, 'sales_a', 'admin');
  await staff(salesB, 'sales_b', 'admin');
  await staff(salesManager, 'sales_m', 'manager');
  await staff(tsupId, 'tsup_t', 'admin');
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'super_s', 'super_admin', true)`, superId),
  ]);
  await department('sales', salesManager, [salesA, salesB]);
  await department('teachers', null, [tsupId]);
});

describe('1. entering a family', () => {
  it('an Operations supervisor enters a family with the three required fields only: their own supervision, no account yet', async () => {
    const f = form();
    const r = await intake.enter(s.ownerId, f);
    expect(r).toMatchObject({ enrolmentId: f.intakeId, supervision: 'placed', salesOwnerId: null, replay: false });
    const e = await g.prisma.studentEnrolment.findUniqueOrThrow({ where: { id: f.intakeId } });
    expect(e).toMatchObject({ origin: 'intake', kind: 'new_family', accountId: null, assignedBy: s.ownerId });
    expect(await g.prisma.learnerSupervision.findUniqueOrThrow({ where: { learnerId: r.learnerIds[0]! } })).toMatchObject({ supervisorId: s.ownerId, assignedBy: s.ownerId });
    expect(await g.prisma.learnerIntake.findUniqueOrThrow({ where: { learnerId: r.learnerIds[0]! } })).toMatchObject({ enteredBy: s.ownerId });
    expect(await g.prisma.familyContactKey.count({ where: { familyId: r.familyId, kind: 'phone' } })).toBe(1);
    // The number lives in the parent file only; the audit never carries it.
    const entered = await g.prisma.auditLog.findFirstOrThrow({ where: { action: 'family.entered', entityId: r.familyId } });
    // Ids taken out first: a typed number can also be a run of digits inside a uuid.
    expect(withoutIds({ before: entered.before, after: entered.after, reason: entered.reason })).not.toContain(f.parent.phone);
  });

  it('a Sales member enters a family with an e-mail: the parent can sign up; they own it; it waits for an Operations supervisor', async () => {
    const email = `PD42.${randomUUID().slice(0, 8)}@QA.jawwid.test`;
    const r = await intake.enter(salesA, form({ parent: { name: 'parent_s', email } }));
    expect(r).toMatchObject({ supervision: 'needs_operations_supervisor', salesOwnerId: salesA });
    const account = await g.prisma.account.findUniqueOrThrow({ where: { subject: email.toLowerCase() } });
    expect(await g.prisma.studentEnrolment.findUniqueOrThrow({ where: { id: r.enrolmentId } })).toMatchObject({ accountId: account.id });
    expect(await g.prisma.familySalesOwner.findUniqueOrThrow({ where: { familyId: r.familyId } })).toMatchObject({ staffId: salesA });
    expect(await g.prisma.learnerSupervision.count({ where: { learnerId: { in: r.learnerIds } } })).toBe(0);
  });

  it('the parent\'s name, a phone or an e-mail, and each child\'s name are required; nothing else', async () => {
    expect(await code(intake.enter(s.ownerId, form({ parent: { name: 'parent_x' } })))).toBe(CommErrorCode.INTAKE_INVALID);
    expect(await code(intake.enter(s.ownerId, form({ parent: { phone: phone() } })))).toBe(CommErrorCode.INTAKE_INVALID);
    expect(await code(intake.enter(s.ownerId, form({ children: [{}] })))).toBe(CommErrorCode.INTAKE_INVALID);
    expect(await code(intake.enter(s.ownerId, form({ parent: { name: 'parent_x', phone: '12' } })))).toBe(CommErrorCode.INTAKE_INVALID);
  });

  it('nobody else enters a family: a Teachers-department member and a teacher are refused before anything is looked up', async () => {
    expect(await code(intake.enter(tsupId, form()))).toBe(CommErrorCode.INTAKE_DENIED);
    expect(await code(intake.enter(s.teacherId, form()))).toBe(CommErrorCode.INTAKE_DENIED);
    expect(await code(intake.options(tsupId))).toBe(CommErrorCode.INTAKE_DENIED);
  });

  it('D5: the Operations manager enters for an Operations supervisor, the Sales manager for a Sales member; never across', async () => {
    const ops = await intake.enter(s.managerId, form({ onBehalfOf: s.otherAdminId }));
    expect(await g.prisma.family.findUniqueOrThrow({ where: { id: ops.familyId } })).toMatchObject({ ownerId: s.otherAdminId });
    expect(await g.prisma.learnerSupervision.findUniqueOrThrow({ where: { learnerId: ops.learnerIds[0]! } })).toMatchObject({ supervisorId: s.otherAdminId, assignedBy: s.managerId });
    expect(await g.prisma.studentEnrolment.findUniqueOrThrow({ where: { id: ops.enrolmentId } })).toMatchObject({ assignedBy: s.managerId });

    const sales = await intake.enter(salesManager, form({ onBehalfOf: salesA }));
    expect(await g.prisma.familySalesOwner.findUniqueOrThrow({ where: { familyId: sales.familyId } })).toMatchObject({ staffId: salesA, assignedBy: salesManager });

    expect(await code(intake.enter(salesManager, form({ onBehalfOf: s.ownerId })))).toBe(CommErrorCode.INTAKE_INVALID);
    expect(await code(intake.enter(s.managerId, form()))).toBe(CommErrorCode.INTAKE_INVALID);
    expect(await code(intake.enter(s.ownerId, form({ onBehalfOf: s.otherAdminId })))).toBe(CommErrorCode.INTAKE_DENIED);
  });

  it('options: a manager sees their department\'s supervisors to enter for; everyone sees the teachers', async () => {
    const mine = await intake.options(s.ownerId);
    expect(mine).toMatchObject({ standing: 'operations_supervisor', ready: true, onBehalfOf: [] });
    const mgr = await intake.options(s.managerId);
    expect(mgr.standing).toBe('operations_manager');
    expect(mgr.onBehalfOf.map((x) => x.id).sort()).toEqual([s.ownerId, s.otherAdminId].sort());
    expect(mgr.teachers.map((t) => t.id)).toContain(s.teacherId);
    expect((await intake.options(salesManager)).onBehalfOf.map((x) => x.id).sort()).toEqual([salesA, salesB].sort());
  });
});

describe('2. idempotency and duplicates (S1)', () => {
  it('the same intake id again writes nothing and answers the first result; another supervisor is refused', async () => {
    const f = form();
    const first = await intake.enter(s.ownerId, f);
    const again = await intake.enter(s.ownerId, f);
    expect(again).toMatchObject({ replay: true, familyId: first.familyId, enrolmentId: f.intakeId });
    expect(await g.prisma.studentEnrolment.count({ where: { familyId: first.familyId } })).toBe(1);
    expect(await g.prisma.learner.count({ where: { familyId: first.familyId } })).toBe(1);
    expect(await code(intake.enter(s.otherAdminId, f))).toBe(CommErrorCode.INTAKE_STATE);
  });

  it('the same parent by number, however it is typed, or by e-mail in another case, is refused -- naming the family only to who may handle it', async () => {
    const local = phone();
    const email = `pd42.same.${randomUUID().slice(0, 8)}@qa.jawwid.test`;
    const first = await intake.enter(s.ownerId, form({ parent: { name: 'parent_d', phone: local, email } }));
    const international = `+20 ${local.slice(1, 4)} ${local.slice(4)}`;
    const own = await refusal(intake.enter(s.ownerId, form({ parent: { name: 'parent_d', phone: international } })));
    expect(own.code).toBe(CommErrorCode.PARENT_EXISTS);
    expect(own.detail).toMatchObject({ familyId: first.familyId });
    const byEmail = await refusal(intake.enter(s.ownerId, form({ parent: { name: 'parent_d', email: email.toUpperCase() } })));
    expect(byEmail.code).toBe(CommErrorCode.PARENT_EXISTS);
    // admin_b does not handle this family: told only that the parent exists.
    const other = await refusal(intake.enter(s.otherAdminId, form({ parent: { name: 'parent_d', phone: local } })));
    expect(other.code).toBe(CommErrorCode.PARENT_EXISTS);
    expect(other.detail).toBeUndefined();
    expect(await g.prisma.contact.count({ where: { name: 'parent_d' } })).toBe(1);
  });

  it('two supervisors entering the same parent at the same moment make one family', async () => {
    const same = phone();
    const results = await Promise.allSettled([
      intake.enter(s.ownerId, form({ parent: { name: 'parent_c', phone: same } })),
      intake.enter(salesA, form({ parent: { name: 'parent_c', phone: same } })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((failed.reason as CommError).code).toBe(CommErrorCode.PARENT_EXISTS);
  });

  it('an e-mail that belongs to staff is refused -- with the same answer as any parent the caller may not act on', async () => {
    const [{ subject }] = await g.prisma.$queryRawUnsafe<Array<{ subject: string }>>(
      `insert into chat.account (subject, kind, status, is_active) values ($1, 'staff', 'active', true) returning subject`,
      `pd42.staff.${randomUUID().slice(0, 8)}@qa.jawwid.test`,
    );
    const staffEmail = await refusal(intake.enter(s.ownerId, form({ parent: { name: 'parent_x', email: subject } })));
    // Another supervisor's family, by e-mail: the very same answer.
    const email = `pd42.y.${randomUUID().slice(0, 8)}@qa.jawwid.test`;
    await intake.enter(salesA, form({ parent: { name: 'parent_y', email } }));
    const someoneElses = await refusal(intake.enter(s.ownerId, form({ parent: { name: 'parent_y', email } })));
    expect(staffEmail.code).toBe(CommErrorCode.PARENT_EXISTS);
    expect(staffEmail.detail).toBeUndefined();
    expect({ code: someoneElses.code, message: someoneElses.message, detail: someoneElses.detail })
      .toEqual({ code: staffEmail.code, message: staffEmail.message, detail: staffEmail.detail });
  });
});

describe('3. the carried-over package', () => {
  const access = (learnerId: string) => g.prisma.learnerAccess.findUniqueOrThrow({ where: { learnerId } });

  it('entered with the child: 20 with 12 completed leaves 8; no payment is created', async () => {
    const r = await intake.enter(s.ownerId, form({ children: [{ name: 'child_p', carriedOver: { total: 20, completed: 12, planMonths: 2 } }] }));
    expect(await access(r.learnerIds[0]!)).toMatchObject({ state: 'open', balance: 8 });
    expect(await g.prisma.learnerSubscription.findFirstOrThrow({ where: { learnerId: r.learnerIds[0]! } }))
      .toMatchObject({ source: 'carried_over', lessonsIncluded: 20, lessonsUsedBefore: 12, planMonths: 2, createdBy: s.ownerId });
    expect(await g.prisma.paymentRequest.count({ where: { familyId: r.familyId } })).toBe(0);
  });

  it('completed above the total: a supervisor is refused; a manager confirms their own entry', async () => {
    const over = { children: [{ name: 'child_o', carriedOver: { total: 20, completed: 21 } }] };
    expect(await code(intake.enter(s.ownerId, form(over)))).toBe(CommErrorCode.INTAKE_INVALID);
    expect(await code(intake.enter(s.managerId, form({ ...over, onBehalfOf: s.otherAdminId })))).toBe(CommErrorCode.INTAKE_INVALID);
    const r = await intake.enter(s.managerId, form({ ...over, onBehalfOf: s.otherAdminId, confirmOver: true }));
    expect(await access(r.learnerIds[0]!)).toMatchObject({ state: 'grace', balance: -1, graceLeft: 1 });
  });

  it('after the intake: the entrant carries it over, never twice; corrects it within the 14 days; nobody else may', async () => {
    const r = await intake.enter(s.ownerId, form());
    const child = r.learnerIds[0]!;
    await intake.carryOver(s.ownerId, child, { total: 24, completed: 0 });
    expect(await access(child)).toMatchObject({ balance: 24 });
    expect(await code(intake.carryOver(s.ownerId, child, { total: 24, completed: 3 }))).toBe(CommErrorCode.INTAKE_INVALID);
    expect(await code(intake.voidCarryOver(s.otherAdminId, child, { reason: 'typo' }))).toBe(CommErrorCode.INTAKE_NOT_FOUND);
    await intake.voidCarryOver(s.ownerId, child, { reason: 'typed 24 instead of 20' });
    await intake.carryOver(s.ownerId, child, { total: 20, completed: 0 });
    expect(await access(child)).toMatchObject({ balance: 20 });
    expect(await g.prisma.auditLog.count({ where: { action: { in: ['subscription.carried_over', 'subscription.voided'] }, entityId: child } })).toBe(3);
  });
});

describe('4. Add child, and the sign-in e-mail', () => {
  it('the family\'s own supervisor adds a child (placed on them); the same name again needs a confirmation; another supervisor finds nothing', async () => {
    const r = await intake.enter(s.ownerId, form());
    const more = await intake.addChildren(s.ownerId, r.familyId, { intakeId: randomUUID(), children: [{ name: 'child_two' }] });
    expect(more).toMatchObject({ supervision: 'placed' });
    expect(await g.prisma.learnerSupervision.findUniqueOrThrow({ where: { learnerId: more.learnerIds[0]! } })).toMatchObject({ supervisorId: s.ownerId });
    const twin = await refusal(intake.addChildren(s.ownerId, r.familyId, { intakeId: randomUUID(), children: [{ name: ' Child_Two ' }] }));
    expect(twin.code).toBe(CommErrorCode.CHILD_EXISTS);
    await intake.addChildren(s.ownerId, r.familyId, { intakeId: randomUUID(), children: [{ name: 'child_two' }], confirmDuplicate: true });
    expect(await code(intake.addChildren(s.otherAdminId, r.familyId, { intakeId: randomUUID(), children: [{ name: 'child_x' }] }))).toBe(CommErrorCode.INTAKE_NOT_FOUND);
  });

  it('a Sales owner adds a child to their family; the Operations manager places it later', async () => {
    const r = await intake.enter(salesA, form());
    const more = await intake.addChildren(salesA, r.familyId, { intakeId: randomUUID(), children: [{ name: 'child_s2' }] });
    expect(more).toMatchObject({ supervision: 'needs_operations_supervisor' });
  });

  it('the sign-in e-mail, entered later, makes the parent\'s account once; another family\'s e-mail is refused', async () => {
    const r = await intake.enter(s.ownerId, form());
    const email = `pd42.later.${randomUUID().slice(0, 8)}@qa.jawwid.test`;
    const set = await intake.setSignInEmail(s.ownerId, r.familyId, { email });
    expect(await g.prisma.contact.findUniqueOrThrow({ where: { id: r.contactId } })).toMatchObject({ accountId: set.accountId });
    expect(await g.prisma.studentEnrolment.findUniqueOrThrow({ where: { id: r.enrolmentId } })).toMatchObject({ accountId: set.accountId });
    expect(await code(intake.setSignInEmail(s.ownerId, r.familyId, { email: `x.${email}` }))).toBe(CommErrorCode.INTAKE_STATE);
    const other = await intake.enter(s.ownerId, form());
    expect(await code(intake.setSignInEmail(s.ownerId, other.familyId, { email }))).toBe(CommErrorCode.PARENT_EXISTS);
  });
});

describe('5. the Sales switch', () => {
  it('"all" (the default): every Sales member reads every family, as before -- but edits only the families they own', async () => {
    const r = await intake.enter(salesA, form());
    expect((await billingAccessOf(g.prisma, await g.conversations.requireActor(salesB))).scope).toBe('all');
    expect((await parents.detail(salesB, r.contactId)).access.canEdit).toBe(false);
    expect(await code(parents.update(salesB, r.contactId, { name: 'parent_renamed' }))).toBe(CommErrorCode.PARENT_PROFILE_DENIED);
    await parents.update(salesA, r.contactId, { name: 'parent_renamed' });
    await parents.update(salesManager, r.contactId, { name: 'parent_renamed_again' });
  });

  it('"own": a Sales member reads only the families they own; the Sales manager keeps every family', async () => {
    const a = await intake.enter(salesA, form());
    await scope('own');
    expect((await billingAccessOf(g.prisma, await g.conversations.requireActor(salesB))).scope).toBe('owned');
    expect((await parents.list(salesB)).items.map((x) => x.id)).not.toContain(a.contactId);
    expect(await code(parents.detail(salesB, a.contactId))).toBe(CommErrorCode.PARENT_PROFILE_NOT_FOUND);
    expect((await parents.list(salesA)).items.map((x) => x.id)).toContain(a.contactId);
    expect((await parents.list(salesManager)).items.map((x) => x.id)).toContain(a.contactId);
    expect((await billingAccessOf(g.prisma, await g.conversations.requireActor(salesManager))).scope).toBe('all');
  });

  it('"own" at the database: a Sales member\'s write to a family they do not own is refused, whatever the API does', async () => {
    const a = await intake.enter(salesA, form());
    const write = (who: string) => sql(`update chat.family_billing set currency = 'USD', updated_by = $2::uuid where family_id = $1::uuid`, a.familyId, who);
    await write(salesB); // 'all': as before
    await scope('own');
    await expect(write(salesB)).rejects.toThrow(/handles only their own families/);
    await write(salesA);
    await write(salesManager);
    await write(s.managerId);
  });

  it('the switch is written at boot from SALES_FAMILY_SCOPE only when it is given', async () => {
    const saved = process.env.SALES_FAMILY_SCOPE;
    const svc = new SalesScopeService(g.prisma);
    try {
      delete process.env.SALES_FAMILY_SCOPE;
      await svc.onModuleInit();
      expect(await svc.scope()).toBe('all');
      process.env.SALES_FAMILY_SCOPE = 'own';
      await svc.onModuleInit();
      expect(await svc.scope()).toBe('own');
      delete process.env.SALES_FAMILY_SCOPE;
      await svc.onModuleInit();
      expect(await svc.scope()).toBe('own');
      process.env.SALES_FAMILY_SCOPE = 'all';
      await svc.onModuleInit();
      expect(await svc.scope()).toBe('all');
      process.env.SALES_FAMILY_SCOPE = 'anything';
      await expect(svc.onModuleInit()).rejects.toThrow(/must be 'all' or 'own'/);
    } finally {
      if (saved === undefined) delete process.env.SALES_FAMILY_SCOPE;
      else process.env.SALES_FAMILY_SCOPE = saved;
    }
  });
});

describe('6. review of #202', () => {
  it('P1-2: the intake waits for the contact-key backfill; options says so', async () => {
    await ready(false);
    expect(await code(intake.enter(s.ownerId, form()))).toBe(CommErrorCode.INTAKE_NOT_READY);
    expect((await intake.options(s.ownerId)).ready).toBe(false);
  });

  it('P1-2: the backfill keys every existing parent -- a dry run writes nothing; --apply writes once, opens the intake; a parent already in Chat is not entered twice', async () => {
    await ready(false);
    // A family made before the intake (PD-16, the seed): its parent file has a number.
    await sql(
      `insert into chat.parent_file (contact_id, organization_id, phone, email)
       values ($1::uuid, chat.default_organization_id(), '010 0000 0042', 'Parent.Seed@QA.jawwid.test')`, s.parentId,
    );
    const dry = await backfillFamilyContactKeys(g.prisma, { apply: false, acceptGaps: false });
    expect(dry).toMatchObject({ apply: false, keys: 2, ready: false });
    expect(await g.prisma.familyContactKey.count()).toBe(0);

    const applied = await backfillFamilyContactKeys(g.prisma, { apply: true, acceptGaps: false });
    expect(applied).toMatchObject({ apply: true, keys: 2, collisions: [], unreadable: [], ready: true });
    expect(await g.prisma.familyContactKey.count({ where: { familyId: s.familyId } })).toBe(2);
    for (const typed of ['010 0000 0042', '+201000000042', 'parent.seed@qa.jawwid.test', 'Parent.Seed@QA.jawwid.test']) {
      expect(withoutIds(applied)).not.toContain(typed);
    }

    const again = await backfillFamilyContactKeys(g.prisma, { apply: true, acceptGaps: false });
    expect(again).toMatchObject({ keys: 0, already: 2, ready: true });

    // The same parent typed another way is refused; admin_a owns family_x and is told which family.
    const dup = await refusal(intake.enter(s.ownerId, form({ parent: { name: 'parent_p', phone: '+20 100 000 0042' } })));
    expect(dup.code).toBe(CommErrorCode.PARENT_EXISTS);
    expect(dup.detail).toMatchObject({ familyId: s.familyId });
    expect(await code(intake.enter(s.ownerId, form({ parent: { name: 'parent_p', email: 'parent.seed@qa.jawwid.test' } })))).toBe(CommErrorCode.PARENT_EXISTS);
  });

  it('P1-2: two families that share a number are reported, never merged; the intake stays closed unless the operator accepts the gaps', async () => {
    await ready(false);
    const [{ id: other }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.family (display_name, owner_id, language) values ('family_twin', $1::uuid, 'ar') returning id::text as id`, s.ownerId,
    );
    const [{ id: otherParent }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.contact (family_id, name, role_preset, can_message, is_active) values ($1::uuid, 'parent_t', 'primary_guardian', true, true) returning id::text as id`, other,
    );
    for (const c of [s.parentId, otherParent]) {
      await sql(`insert into chat.parent_file (contact_id, organization_id, phone) values ($1::uuid, chat.default_organization_id(), '01000000077')`, c);
    }
    await sql(`insert into chat.parent_file (contact_id, organization_id, phone) values ($1::uuid, chat.default_organization_id(), '050 123 4567')`, s.otherParentId);
    const r = await backfillFamilyContactKeys(g.prisma, { apply: true, acceptGaps: false });
    expect(r.collisions).toEqual([{ familyId: other, otherFamilyId: s.familyId, kind: 'phone' }]);
    expect(r.unreadable).toEqual([{ familyId: s.familyId, contactId: s.otherParentId }]);
    expect(r.ready).toBe(false);
    expect((await backfillFamilyContactKeys(g.prisma, { apply: true, acceptGaps: true })).ready).toBe(true);
  });

  it('P2: a replay must be the same intake -- another body under the same id is refused', async () => {
    const f = form();
    await intake.enter(s.ownerId, f);
    expect(await code(intake.enter(s.ownerId, { ...f, children: [{ name: 'someone_else' }] }))).toBe(CommErrorCode.INTAKE_STATE);
    const r = await intake.enter(s.ownerId, form());
    const add = { intakeId: randomUUID(), children: [{ name: 'child_r' }] };
    await intake.addChildren(s.ownerId, r.familyId, add);
    expect((await intake.addChildren(s.ownerId, r.familyId, add)).replay).toBe(true);
    const otherFamily = await intake.enter(s.ownerId, form());
    expect(await code(intake.addChildren(s.ownerId, otherFamily.familyId, add))).toBe(CommErrorCode.INTAKE_STATE);
  });

  it('P2: a local number needs its country unless it is an Egyptian mobile', async () => {
    expect(await code(intake.enter(s.ownerId, form({ parent: { name: 'parent_g', phone: '050 123 4567' } })))).toBe(CommErrorCode.INTAKE_INVALID);
    const ok = await intake.enter(s.ownerId, form({ parent: { name: 'parent_g', phone: '050 123 4567', country: 'AE' } }));
    expect(await g.prisma.familyContactKey.findFirstOrThrow({ where: { familyId: ok.familyId, kind: 'phone' } }))
      .toMatchObject({ keyHash: contactKeyHash('phone', '+971501234567') });
  });

  it('P2: the family is named only to a caller who OWNS it -- a Sales member who merely reads it is told nothing more', async () => {
    const local = phone();
    await intake.enter(salesA, form({ parent: { name: 'parent_o', phone: local } }));
    const b = await refusal(intake.enter(salesB, form({ parent: { name: 'parent_o', phone: local } })));
    expect(b.code).toBe(CommErrorCode.PARENT_EXISTS);
    expect(b.detail).toBeUndefined();
    const a = await refusal(intake.enter(salesA, form({ parent: { name: 'parent_o', phone: local } })));
    expect(a.detail).toBeDefined();
  });

  it('P1-3: a Sales member never adds a child to another Sales member\'s family', async () => {
    const r = await intake.enter(salesA, form());
    expect(await code(intake.addChildren(salesB, r.familyId, { intakeId: randomUUID(), children: [{ name: 'child_b' }] }))).toBe(CommErrorCode.INTAKE_NOT_FOUND);
  });

  it('P1-3 "own": parent accounts -- list, open, sign-out -- are a Sales member\'s for their own families only', async () => {
    const email = `pd42.acct.${randomUUID().slice(0, 8)}@qa.jawwid.test`;
    await intake.enter(salesA, form({ parent: { name: 'parent_acct', email } }));
    const account = await g.prisma.account.findUniqueOrThrow({ where: { subject: email } });
    const b = await g.conversations.requireActor(salesB);
    const a = await g.conversations.requireActor(salesA);
    expect((await accounts.list(b, {})).accounts.map((x) => x.accountId)).toContain(account.id); // 'all': as before
    await scope('own');
    expect((await accounts.list(b, {})).accounts.map((x) => x.accountId)).not.toContain(account.id);
    expect(await code(accounts.get(b, account.id))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    expect(await code(accounts.listSessions(b, account.id))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    expect((await accounts.list(a, {})).accounts.map((x) => x.accountId)).toContain(account.id);
    await accounts.get(a, account.id);
    const manager = await g.conversations.requireActor(salesManager);
    await accounts.get(manager, account.id);
  });

  it('P1-3 "own": money and subscriptions -- the API finds nothing; the database refuses parent file, instalment and payment writes', async () => {
    const r = await intake.enter(salesA, form({ children: [{ name: 'child_m', carriedOver: { total: 10, completed: 2 } }] }));
    await scope('own');
    expect(await code(billing.familyBilling(salesB, r.familyId))).toBe(CommErrorCode.BILLING_NOT_FOUND);
    expect(await code(ledger.view(salesB, r.learnerIds[0]!))).toBe(CommErrorCode.BILLING_NOT_FOUND);
    await ledger.view(salesA, r.learnerIds[0]!);
    const refused = /handles only their own families/;
    await expect(sql(`update chat.parent_file set region = 'x', updated_by = $2::uuid where contact_id = $1::uuid`, r.contactId, salesB)).rejects.toThrow(refused);
    await expect(sql(
      `insert into chat.family_instalment (family_id, label, amount_minor, currency, due_date, created_by)
       values ($1::uuid, 'term', 1000, 'EGP', current_date + 30, $2::uuid)`, r.familyId, salesB,
    )).rejects.toThrow(refused);
    await expect(sql(
      `insert into chat.payment (organization_id, family_id, method, amount_minor, currency, paid_on, recorded_by)
       values (chat.default_organization_id(), $1::uuid, 'cash', 1000, 'EGP', current_date, $2::uuid)`, r.familyId, salesB,
    )).rejects.toThrow(refused);
    await sql(`update chat.parent_file set region = 'x', updated_by = $2::uuid where contact_id = $1::uuid`, r.contactId, salesA);
    await sql(
      `insert into chat.payment (organization_id, family_id, method, amount_minor, currency, paid_on, recorded_by)
       values (chat.default_organization_id(), $1::uuid, 'cash', 1000, 'EGP', current_date, $2::uuid)`, r.familyId, salesA,
    );
  });

  it('P1-3 "own": a parent\'s name and photo and a family\'s country, when a Sales member is the one writing', async () => {
    const r = await intake.enter(salesA, form());
    await scope('own');
    const asStaff = (who: string, statement: string, ...args: unknown[]) =>
      g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.acting_staff_id', $1, true)`, who),
        g.prisma.$executeRawUnsafe(statement, ...args),
      ]);
    const refused = /handles only their own families/;
    await expect(asStaff(salesB, `update chat.contact set name = 'renamed' where id = $1::uuid`, r.contactId)).rejects.toThrow(refused);
    await expect(asStaff(salesB, `update chat.contact set avatar_object_key = 'avatars/contact/x' where id = $1::uuid`, r.contactId)).rejects.toThrow(refused);
    await expect(asStaff(salesB, `update chat.family set country_code = 'AE' where id = $1::uuid`, r.familyId)).rejects.toThrow(refused);
    await asStaff(salesA, `update chat.contact set name = 'renamed' where id = $1::uuid`, r.contactId);
    await asStaff(salesA, `update chat.family set country_code = 'AE' where id = $1::uuid`, r.familyId);
    // The Parent Profile's own edit names its staff member: refused for B at the API already.
    expect(await code(parents.update(salesB, r.contactId, { name: 'x' }))).toBe(CommErrorCode.PARENT_PROFILE_NOT_FOUND);
  });
});
