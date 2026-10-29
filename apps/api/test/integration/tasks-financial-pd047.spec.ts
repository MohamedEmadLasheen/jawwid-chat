/**
 * PD-47 PR-2b -- financial tasks from their sources.
 * Plan: docs/product/pd047-amendment-priority.md §5-§6 (owner-approved 2026-10-28).
 *
 *   instalment       the billing owner's, from D-7 (Yellow) to D0 (Red); completed
 *                    when paid, withdrawn when voided
 *   package_low      the Sales owner's (else the Sales manager's) at <= 2 lessons
 *                    left, one task per episode; High at 0; completed by a new package
 *   renewal_request  the same owner's, High at once; completed by a new package
 *   receipt_review   the billing owner's, Yellow on upload, Red at 48 h; completed
 *                    by its review
 *   checkout_failed  the billing owner's, High; completed when paid -- an
 *                    instalment's follows the instalment
 *   every one        category financial; it follows its owner, never by hand
 *
 * Synthetic fixtures only (G-16).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { PaymentLedger } from '../../src/billing/payment-ledger.service';
import { TaskService } from '../../src/tasks/task.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const tasks = new TaskService(g.prisma, g.outbox);
const ledger = new PaymentLedger(g.prisma, new PrismaAuditService());

jest.setTimeout(120_000);

let s: Scenario;
let smgr: string;
let sa: string;
let org: string;
let today: string;

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
const taskFor = async (key: string) =>
  (await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM chat.work_task WHERE source_key = ${key}`)[0]?.id;
/** Every task of a source type, oldest first. */
const tasksOf = async (type: string) =>
  (await g.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM chat.work_task WHERE source_type = ${type} ORDER BY created_at, id`).map((r) => r.id);
const issues = async (key: string) =>
  g.prisma.$queryRaw<Array<{ attempts: number }>>`SELECT attempts FROM chat.work_task_source_issue WHERE source_key = ${key}`;
/** The completion event, read as the super admin (who sees every task). */
const completion = async (id: string) => (await tasks.get(sa, id)).history.find((e) => e.kind === 'completed');
const SOURCES = ['instalment', 'renewal_request', 'receipt_review', 'checkout_failed'];

/** A child instalment of family_x's learner_l, due `days` from the academy's today. */
async function instalment(days: number, amount = 50000): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.family_instalment (family_id, learner_id, label, amount_minor, currency, due_date, created_by)
     values ($1::uuid, $2::uuid, 'October', $3::bigint, 'EGP', chat.academy_today() + $4::int, $5::uuid)
     returning id::text as id`,
    s.familyId, s.learnerId, amount, days, s.managerId,
  );
  return id;
}

/** A package of `lessons` for learner_l, entered by `by` (the Operations manager; only a manager or the super admin may). */
async function packageOf(lessons: number, by = s.managerId): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.learner_subscription (organization_id, learner_id, family_id, lessons_included, starts_on, source, created_by, note)
     values (chat.default_organization_id(), $1::uuid, $2::uuid, $3::int, chat.academy_today(), 'staff', $4::uuid, 'PD-47 test package')
     returning id::text as id`,
    s.learnerId, s.familyId, lessons, by,
  );
  return id;
}

/** A payment link for family_x: an instalment's, or a renewal of `lessons`, or a standalone one. */
async function request(opts: { instalmentId?: string; amount?: number; lessons?: number } = {}): Promise<string> {
  const purpose = opts.instalmentId ? 'instalment' : opts.lessons ? 'renewal' : 'other';
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.payment_request (family_id, learner_id, instalment_id, token, purpose, label, amount_minor, currency,
                                       expires_at, created_by, lessons_included)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'October', $6::bigint, 'EGP', now() + interval '14 days', $7::uuid, $8::int)
     returning id::text as id`,
    s.familyId, s.learnerId, opts.instalmentId ?? null, randomBytes(32).toString('base64url'), purpose,
    opts.amount ?? 50000, s.managerId, opts.lessons ?? null,
  );
  return id;
}

/** A Stripe checkout for the request that ends failed (async_payment_failed). */
async function failedCheckout(requestId: string): Promise<string> {
  const session = `cs_test_${randomUUID().replace(/-/g, '')}`;
  await exec(
    `insert into chat.payment_checkout (stripe_session_id, organization_id, request_id, amount_minor, currency, expires_at)
     values ($1, chat.default_organization_id(), $2::uuid, 50000, 'EGP', now() + interval '1 hour')`,
    session, requestId,
  );
  await exec(`update chat.payment_checkout set status = 'failed' where stripe_session_id = $1`, session);
  return session;
}

/** Money against a request, as PD-27 records it: by staff, or by card (Stripe: nobody). */
async function pay(requestId: string, opts: { by: string | null; amount?: number; instalmentId?: string | null }) {
  const card = opts.by === null;
  const tail = randomUUID().replace(/-/g, '');
  return g.prisma.$transaction((tx) =>
    ledger.record(tx, {
      organizationId: org,
      familyId: s.familyId,
      trialLessonId: null,
      learnerId: s.learnerId,
      childName: null,
      requestId,
      instalmentId: opts.instalmentId,
      method: card ? 'card' : 'bank_transfer',
      amountMinor: opts.amount ?? 50000,
      currency: 'EGP',
      paidOn: today,
      recordedBy: opts.by,
      reference: card ? null : 'TRF-1',
      stripeCheckoutSessionId: card ? `cs_test_${tail}` : null,
      stripePaymentIntentId: card ? `pi_test_${tail}` : null,
      auditActorId: opts.by,
      auditReason: 'PD-47 PR-2b test',
    }),
  );
}

/** A parent's transfer receipt against the request. */
async function receipt(requestId: string): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.payment_receipt (family_id, request_id, amount_minor, currency, transferred_on, object_key, mime_type, byte_size, uploaded_by)
     values ($1::uuid, $2::uuid, 50000, 'EGP', chat.academy_today(), 'payment-receipts/' || gen_random_uuid(), 'image/png', 1024, $3::uuid)
     returning id::text as id`,
    s.familyId, requestId, s.parentId,
  );
  return id;
}

const leave = (id: string) => exec(`update chat.staff set is_active = false, left_at = now() where id = $1::uuid`, id);

/**
 * The instalment task's owner leaves with nobody live to follow. Its first owner
 * (s.ownerId) owns the family and cannot be deactivated, so the child moves to
 * s.otherAdminId first, who then leaves; Operations is left without a manager.
 */
async function orphanTheOwner() {
  await exec(`update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = $3::uuid where learner_id = $1::uuid`,
    s.learnerId, s.otherAdminId, s.managerId);
  await tasks.sweep();
  await leave(s.otherAdminId);
  await exec(`update chat.department set manager_id = null where kind = 'operations'`);
}

beforeAll(async () => {
  await g.prisma.$connect();
  [{ org, today }] = await g.prisma.$queryRaw<Array<{ org: string; today: string }>>`
    SELECT chat.default_organization_id()::text AS org, chat.academy_today()::text AS today`;
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  // seed(): Operations is run by s.managerId; s.ownerId supervises learner_l.
  s = await seed(g.prisma);
  [smgr, sa] = [randomUUID(), randomUUID()];
  await exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'smgr_f', 'manager', true)`, smgr);
  await g.prisma.$transaction([
    exec(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_f', 'super_admin', true)`, sa),
  ]);
  await exec(`insert into chat.department (kind, display_name, manager_id) values ('sales', 'sales', $1::uuid)`, smgr);
  for (const src of SOURCES) {
    await exec(`insert into chat.config (key, value) values ($1, to_jsonb('2000-01-01T00:00:00Z'::text))
                on conflict (key) do update set value = excluded.value`, `tasks.since.${src}`);
  }
});

// ---------------------------------------------------------------------------

describe('instalments', () => {
  it('from D-7 an instalment is its child\'s supervisor\'s financial task, Yellow; not before', async () => {
    const soon = await instalment(7);
    const later = await instalment(8);
    await tasks.sweep();
    expect(await taskFor(`instalment:${later}`)).toBeUndefined();
    const id = (await taskFor(`instalment:${soon}`)) as string;
    expect(await tasks.get(s.ownerId, id)).toMatchObject({
      assignee: { kind: 'staff', id: s.ownerId },
      category: 'financial',
      effectivePriority: 'medium',
      priorityReason: 'due_soon',
      source: { type: 'instalment', id: soon },
      titleParams: expect.objectContaining({ label: 'October', currency: 'EGP' }),
    });
  });

  it('on its due day it is Red; overdue after it', async () => {
    const day = await instalment(0);
    const late = await instalment(-2);
    await tasks.sweep();
    expect(await tasks.get(s.ownerId, (await taskFor(`instalment:${day}`)) as string))
      .toMatchObject({ effectivePriority: 'high', priorityReason: 'due_soon', overdue: false });
    expect(await tasks.get(s.ownerId, (await taskFor(`instalment:${late}`)) as string))
      .toMatchObject({ effectivePriority: 'high', priorityReason: 'overdue', overdue: true });
  });

  it('is due at the academy\'s local midnight, in the academy\'s zone', async () => {
    // Other suites need the academy's zone as it was: put it back afterwards, never delete it.
    const [was] = await g.prisma.$queryRaw<Array<{ v: string }>>`SELECT value::text AS v FROM chat.config WHERE key = 'schedule.timezone'`;
    await exec(`insert into chat.config (key, value) values ('schedule.timezone', to_jsonb('Pacific/Kiritimati'::text))
                on conflict (key) do update set value = excluded.value`);
    try {
      const inst = await instalment(3);
      await tasks.sweep();
      const [{ due }] = await g.prisma.$queryRaw<Array<{ due: Date }>>`
        SELECT ((chat.academy_today() + 3)::timestamp at time zone 'Pacific/Kiritimati') AS due`;
      expect((await tasks.get(s.ownerId, (await taskFor(`instalment:${inst}`)) as string)).dueAt).toBe(due.toISOString());
    } finally {
      if (was) await exec(`update chat.config set value = $1::jsonb where key = 'schedule.timezone'`, was.v);
      else await exec(`delete from chat.config where key = 'schedule.timezone'`);
    }
  });

  it('only the last 14 days become tasks at switch-on (the owner\'s cut-off)', async () => {
    await exec(`delete from chat.config where key = 'tasks.since.instalment'`);
    const old = await instalment(-20);
    const recent = await instalment(-10);
    await tasks.sweep();
    expect(await taskFor(`instalment:${old}`)).toBeUndefined();
    expect(await taskFor(`instalment:${recent}`)).toBeDefined();
  });

  it('paid by staff: completed by whoever recorded the payment, the payment in its history', async () => {
    const inst = await instalment(3);
    await tasks.sweep();
    const id = (await taskFor(`instalment:${inst}`)) as string;
    const { payment } = await pay(await request({ instalmentId: inst }), { by: s.otherAdminId });
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ state: 'completed', closedBy: { id: s.otherAdminId } });
    expect((await completion(id))?.after).toEqual({ outcome: 'done', evidence: { paymentId: payment.id, method: 'bank_transfer' } });
  });

  it('paid by card: completed by the system, which names nobody', async () => {
    const inst = await instalment(3);
    await tasks.sweep();
    const id = (await taskFor(`instalment:${inst}`)) as string;
    const { payment } = await pay(await request({ instalmentId: inst }), { by: null });
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ state: 'completed', closedBy: null });
    expect(await completion(id)).toMatchObject({ actor: null, after: { evidence: { paymentId: payment.id, method: 'card' } } });
  });

  it('a part payment leaves it open; the rest completes it, by who recorded the rest', async () => {
    const inst = await instalment(3);
    await tasks.sweep();
    const id = (await taskFor(`instalment:${inst}`)) as string;
    const req = await request({ instalmentId: inst });
    await pay(req, { by: s.managerId, amount: 30000 });
    expect((await tasks.get(s.ownerId, id)).state).toBe('open');
    await pay(req, { by: s.otherAdminId, amount: 20000 });
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ state: 'completed', closedBy: { id: s.otherAdminId } });
  });

  it('a voided instalment withdraws its task; it stays until acknowledged', async () => {
    const inst = await instalment(3);
    await tasks.sweep();
    const id = (await taskFor(`instalment:${inst}`)) as string;
    await exec(`update chat.family_instalment set voided_at = now(), voided_by = $2::uuid, void_reason = 'entered twice' where id = $1::uuid`,
      inst, s.managerId);
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ state: 'open', sourceState: 'withdrawn' });
  });

  it('follows its owner, never by hand', async () => {
    const inst = await instalment(3);
    await tasks.sweep();
    const id = (await taskFor(`instalment:${inst}`)) as string;
    expect(await code(tasks.reassign(s.managerId, id, { to: { kind: 'staff', id: s.otherAdminId } }))).toBe(CommErrorCode.TASK_DENIED);
    expect(await code(tasks.reassign(sa, id, { to: { kind: 'staff', id: s.otherAdminId } }))).toBe(CommErrorCode.TASK_DENIED);
    await expect(
      g.prisma.$transaction([
        exec(`select set_config('chat.task_actor', $1, true)`, sa),
        exec(`update chat.work_task set assignee_staff_id = $2::uuid where id = $1::uuid`, id, s.otherAdminId),
      ]),
    ).rejects.toThrow(/follows its source/);
  });

  it('moves with the child\'s supervisor, and to the Operations manager when the supervisor leaves -- by the system', async () => {
    const inst = await instalment(3);
    await tasks.sweep();
    const id = (await taskFor(`instalment:${inst}`)) as string;
    await exec(`update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = $3::uuid where learner_id = $1::uuid`,
      s.learnerId, s.otherAdminId, s.managerId);
    await tasks.sweep();
    expect((await tasks.get(s.otherAdminId, id)).assignee).toEqual({ kind: 'staff', id: s.otherAdminId });
    await leave(s.otherAdminId);
    await tasks.sweep();
    const t = await tasks.get(s.managerId, id);
    expect(t.assignee).toEqual({ kind: 'staff', id: s.managerId });
    expect(t.history.filter((e) => e.kind === 'reassigned').map((e) => e.actor)).toEqual([null, null]);
  });

  it('an owner gone with nobody live to follow is recorded, and the super admin may hand it on', async () => {
    const inst = await instalment(3);
    await tasks.sweep();
    const id = (await taskFor(`instalment:${inst}`)) as string;
    await orphanTheOwner();
    const swept = await tasks.sweep();
    expect(swept.orphaned).toBe(1);
    expect(await issues(`instalment:${inst}`)).toEqual([{ attempts: 1 }]);
    await tasks.sweep();
    expect(await issues(`instalment:${inst}`)).toEqual([{ attempts: 1 }]); // the back-off holds
    // Nobody else: a manager of another department neither sees nor moves it.
    expect([CommErrorCode.TASK_DENIED, CommErrorCode.TASK_NOT_FOUND])
      .toContain(await code(tasks.reassign(smgr, id, { to: { kind: 'staff', id: s.ownerId } })));
    // The database refuses anyone but the super admin, whatever the API does.
    await expect(
      g.prisma.$transaction([
        exec(`select set_config('chat.task_actor', $1, true)`, smgr),
        exec(`update chat.work_task set assignee_staff_id = $2::uuid where id = $1::uuid`, id, s.ownerId),
      ]),
    ).rejects.toThrow(/follows its source/);
    await tasks.reassign(sa, id, { to: { kind: 'staff', id: s.ownerId } });
    expect((await tasks.get(sa, id)).assignee).toEqual({ kind: 'staff', id: s.ownerId });
  });

  it('an orphan goes to a newly appointed manager on the next sweep, not after its back-off', async () => {
    const inst = await instalment(3);
    await tasks.sweep();
    const id = (await taskFor(`instalment:${inst}`)) as string;
    await orphanTheOwner();
    expect((await tasks.sweep()).orphaned).toBe(1);
    const fresh = randomUUID();
    await exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'omgr_f', 'manager', true)`, fresh);
    await exec(`update chat.department set manager_id = $1::uuid where kind = 'operations'`, fresh);
    await tasks.sweep();
    expect((await tasks.get(fresh, id)).assignee).toEqual({ kind: 'staff', id: fresh });
    expect(await issues(`instalment:${inst}`)).toEqual([]);
  });

  it('sorts first among the operational tasks of its colour', async () => {
    await instalment(3);
    await tasks.create(s.managerId, { assignee: { kind: 'staff', id: s.ownerId }, title: 'call back', priority: 'medium' });
    await tasks.sweep();
    const [first, second] = (await tasks.list(s.ownerId, { view: 'mine' })).items;
    expect([first.category, second.category]).toEqual(['financial', 'operational']);
  });

  it('stays in its organization', async () => {
    const [farOrg, farMgr, farFamily] = [randomUUID(), randomUUID(), randomUUID()];
    await exec(`insert into chat.organization (id, slug, display_name) values ($1::uuid, 'pd047f-' || left($1::text, 8), 'pd047 far')`, farOrg);
    await exec(`insert into chat.staff (id, organization_id, name, role, is_active) values ($1::uuid, $2::uuid, 'far_mgr', 'manager', true)`, farMgr, farOrg);
    await exec(`insert into chat.department (organization_id, kind, display_name, manager_id) values ($1::uuid, 'operations', 'operations', $2::uuid)`, farOrg, farMgr);
    await exec(`insert into chat.family (id, organization_id, display_name, owner_id, language) values ($1::uuid, $2::uuid, 'family_far', $3::uuid, 'ar')`,
      farFamily, farOrg, farMgr);
    const [{ id: inst }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.family_instalment (organization_id, family_id, label, amount_minor, currency, due_date, created_by)
       values ($1::uuid, $2::uuid, 'October', 50000, 'EGP', chat.academy_today() + 3, $3::uuid) returning id::text as id`,
      farOrg, farFamily, farMgr,
    );
    await tasks.sweep();
    const id = (await taskFor(`instalment:${inst}`)) as string;
    expect((await tasks.get(farMgr, id)).assignee).toEqual({ kind: 'staff', id: farMgr });
    expect((await tasks.list(sa, { view: 'all' })).items.map((t) => t.id)).not.toContain(id);
    expect(await code(tasks.get(sa, id))).toBe(CommErrorCode.TASK_NOT_FOUND);
  });
});

describe('packages and renewals', () => {
  it('a child with 2 lessons left is the Sales manager\'s task (no Sales owner); a new package completes it, by its creator', async () => {
    await packageOf(2);
    const [id] = await tasksOf('package_low');
    expect(await tasks.get(smgr, id)).toMatchObject({
      assignee: { kind: 'staff', id: smgr }, category: 'financial', effectivePriority: 'medium',
      titleParams: expect.objectContaining({ learnerName: 'learner_l', balance: 2 }),
    });
    const next = await packageOf(10, smgr);
    expect(await tasks.get(smgr, id)).toMatchObject({ state: 'completed', closedBy: { id: smgr } });
    expect((await completion(id))?.after).toEqual({ outcome: 'done', evidence: { subscriptionId: next } });
  });

  it('used up, it is High by its source', async () => {
    await packageOf(2);
    const [id] = await tasksOf('package_low');
    await exec(`update chat.learner_access set balance = 0 where learner_id = $1::uuid`, s.learnerId);
    expect(await tasks.get(smgr, id)).toMatchObject({ effectivePriority: 'high', priorityReason: 'source' });
  });

  it('a correction lifting the balance above 2 withdraws it -- not completed; low again, it is back', async () => {
    await packageOf(2);
    const [id] = await tasksOf('package_low');
    await exec(`update chat.learner_access set balance = 3 where learner_id = $1::uuid`, s.learnerId);
    expect(await tasks.get(smgr, id)).toMatchObject({ state: 'open', sourceState: 'withdrawn' });
    await exec(`update chat.learner_access set balance = 1 where learner_id = $1::uuid`, s.learnerId);
    expect(await tasks.get(smgr, id)).toMatchObject({ state: 'open', sourceState: 'pending' });
    expect(await tasksOf('package_low')).toEqual([id]);
  });

  it('a payment voided takes its package back: the old package, low again, is a fresh task', async () => {
    await packageOf(2);
    const [first] = await tasksOf('package_low');
    // A renewal link paid by transfer credits a package (PD-30). The system
    // entered the package; whoever recorded the transfer did the work.
    const req = await request({ lessons: 8, amount: 40000 });
    const { payment } = await pay(req, { by: s.managerId, amount: 40000 });
    const [{ id: credited }] = await g.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.learner_subscription WHERE request_id = ${req}::uuid`;
    expect(await tasks.get(smgr, first)).toMatchObject({ state: 'completed', closedBy: { id: s.managerId } });
    expect((await completion(first))?.after).toEqual({
      outcome: 'done', evidence: { subscriptionId: credited, paymentId: payment.id, method: 'bank_transfer' },
    });
    await g.prisma.$transaction((tx) => ledger.voidPayment(tx, payment, s.managerId, 'entered twice'));
    const after = await tasksOf('package_low');
    expect(after).toHaveLength(2);
    expect(await tasks.get(smgr, after[1])).toMatchObject({ state: 'open', sourceState: 'pending', effectivePriority: 'medium' });
    expect((await tasks.get(smgr, first)).state).toBe('completed');
  });

  it('a manager\'s removal holds: no sweep and no balance change raises it again on that package', async () => {
    await packageOf(2);
    const [id] = await tasksOf('package_low');
    await tasks.remove(sa, id, { reason: 'the family is leaving' });
    await tasks.sweep();
    await exec(`update chat.learner_access set balance = 1 where learner_id = $1::uuid`, s.learnerId);
    await exec(`update chat.learner_access set balance = 0 where learner_id = $1::uuid`, s.learnerId);
    await tasks.sweep();
    expect(await tasksOf('package_low')).toEqual([id]);
    expect((await tasks.get(sa, id)).state).toBe('removed');
  });

  it('a renewal with no Sales owner or Sales manager reaches the super admin (PR-4: no push to Sales any more)', async () => {
    await exec(`update chat.department set manager_id = null where kind = 'sales'`);
    await packageOf(8);
    await exec(`insert into chat.renewal_request (organization_id, learner_id, family_id, requested_by)
                values (chat.default_organization_id(), $1::uuid, $2::uuid, $3::uuid)`, s.learnerId, s.familyId, s.parentId);
    const [id] = await tasksOf('renewal_request');
    expect((await tasks.get(sa, id)).assignee).toEqual({ kind: 'staff', id: sa });
    // A Sales manager appointed later takes it over (the task follows its owner).
    await exec(`update chat.department set manager_id = $1::uuid where kind = 'sales'`, smgr);
    await tasks.sweep();
    expect((await tasks.get(smgr, id)).assignee).toEqual({ kind: 'staff', id: smgr });
  });

  it('a renewal the parent asks for is High at once, and a new package completes it', async () => {
    await packageOf(8);
    await exec(`insert into chat.renewal_request (organization_id, learner_id, family_id, requested_by)
                values (chat.default_organization_id(), $1::uuid, $2::uuid, $3::uuid)`, s.learnerId, s.familyId, s.parentId);
    const [id] = await tasksOf('renewal_request');
    expect(await tasks.get(smgr, id)).toMatchObject({ effectivePriority: 'high', category: 'financial' });
    await packageOf(10);
    expect((await tasks.get(smgr, id)).state).toBe('completed');
  });

  it('goes to the family\'s Sales owner, and back to the Sales manager when they leave', async () => {
    const owner = randomUUID();
    await exec(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sales_o', 'admin', true)`, owner);
    await exec(`insert into chat.department_member (staff_id, organization_id, department_id, position)
                select $1::uuid, chat.default_organization_id(), d.id, 'supervisor' from chat.department d where d.kind = 'sales'`, owner);
    await exec(`insert into chat.family_sales_owner (family_id, organization_id, staff_id, assigned_by)
                values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`, s.familyId, owner, smgr);
    await packageOf(2);
    const [id] = await tasksOf('package_low');
    expect((await tasks.get(owner, id)).assignee).toEqual({ kind: 'staff', id: owner });
    await leave(owner);
    await tasks.sweep();
    expect((await tasks.get(smgr, id)).assignee).toEqual({ kind: 'staff', id: smgr });
  });
});

describe('receipts', () => {
  it('a receipt is the billing owner\'s, Yellow on upload; its review completes it, by the reviewer', async () => {
    const inst = await instalment(20);
    const rec = await receipt(await request({ instalmentId: inst }));
    const id = (await taskFor(`receipt_review:${rec}`)) as string;
    expect(await tasks.get(s.ownerId, id)).toMatchObject({
      assignee: { kind: 'staff', id: s.ownerId }, category: 'financial', effectivePriority: 'medium',
    });
    await exec(`update chat.payment_receipt set status = 'rejected', reviewed_by = $2::uuid, reviewed_at = now(), reject_reason = 'unreadable'
                where id = $1::uuid`, rec, s.otherAdminId);
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ state: 'completed', closedBy: { id: s.otherAdminId } });
    expect((await completion(id))?.after).toEqual({ outcome: 'done', evidence: { receipt: 'rejected' } });
  });

  it('Red at 48 hours', async () => {
    const inst = await instalment(20);
    const rec = await receipt(await request({ instalmentId: inst }));
    const id = (await taskFor(`receipt_review:${rec}`)) as string;
    const [{ e }] = await g.prisma.$queryRaw<Array<{ e: { level: string } }>>`
      SELECT to_jsonb(x) AS e FROM chat.work_task t,
             chat.work_task_effective(t.priority, t.floor_rule, t.due_at, t.source_floor, t.state, now() + interval '49 hours', 'Africa/Cairo') x
       WHERE t.id = ${id}::uuid`;
    expect(e.level).toBe('high');
  });
});

describe('failed checkouts', () => {
  it('a failed checkout is High, the billing owner\'s; a replayed failure raises nothing more', async () => {
    const req = await request();
    await failedCheckout(req);
    const id = (await taskFor(`checkout_failed:${req}`)) as string;
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ effectivePriority: 'high', category: 'financial', assignee: { kind: 'staff', id: s.ownerId } });
    // The same failure again (a redelivered webhook raises once more), and the sweep: one task.
    const [{ again }] = await g.prisma.$queryRaw<Array<{ again: string | null }>>`
      SELECT chat.work_task_raise_checkout_failed(${req}::uuid)::text AS again`;
    expect(again).toBeNull();
    await tasks.sweep();
    expect(await tasksOf('checkout_failed')).toEqual([id]);
  });

  it('paid by card afterwards: the system completes it, the payment in its history', async () => {
    const req = await request();
    await failedCheckout(req);
    const id = (await taskFor(`checkout_failed:${req}`)) as string;
    const { payment } = await pay(req, { by: null });
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ state: 'completed', closedBy: null });
    expect((await completion(id))?.after).toEqual({ outcome: 'done', evidence: { paymentId: payment.id, method: 'card' } });
  });

  it('paid by a transfer staff recorded: completed by them, not the system', async () => {
    const req = await request();
    await failedCheckout(req);
    const id = (await taskFor(`checkout_failed:${req}`)) as string;
    const { payment } = await pay(req, { by: s.otherAdminId });
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ state: 'completed', closedBy: { id: s.otherAdminId } });
    expect((await completion(id))?.after).toEqual({ outcome: 'done', evidence: { paymentId: payment.id, method: 'bank_transfer' } });
  });

  it('a standalone request cancelled withdraws it', async () => {
    const req = await request();
    await failedCheckout(req);
    const id = (await taskFor(`checkout_failed:${req}`)) as string;
    await exec(`update chat.payment_request set cancelled_at = now(), cancelled_by = $2::uuid, cancel_reason = 'sent twice' where id = $1::uuid`,
      req, s.managerId);
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ state: 'open', sourceState: 'withdrawn' });
  });

  it('an instalment\'s link replaced while the money is owed leaves it open; the instalment paid completes it', async () => {
    const inst = await instalment(20);
    const req = await request({ instalmentId: inst });
    await failedCheckout(req);
    const id = (await taskFor(`checkout_failed:${req}`)) as string;
    await exec(`update chat.payment_request set cancelled_at = now(), cancel_reason = 'expired; replaced by a new link' where id = $1::uuid`, req);
    await tasks.sweep();
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ state: 'open', sourceState: 'pending' });
    const { payment } = await pay(await request({ instalmentId: inst }), { by: s.managerId });
    expect(await tasks.get(s.ownerId, id)).toMatchObject({ state: 'completed', closedBy: { id: s.managerId } });
    expect((await completion(id))?.after).toEqual({ outcome: 'done', evidence: { paymentId: payment.id, method: 'bank_transfer' } });
  });
});

describe('the database', () => {
  it('only a financial source completes as the system; every other source names who did its work', async () => {
    const [lesson, inst] = [randomUUID(), randomUUID()];
    await g.prisma.$queryRaw`SELECT chat.work_task_raise(${org}::uuid, 'lesson_report', ${lesson}::uuid, NULL, ${s.teacherId}::uuid,
                                                          'medium', 'operational', 'overdue_only', now())`;
    await g.prisma.$queryRaw`SELECT chat.work_task_raise(${org}::uuid, 'instalment', ${inst}::uuid, ${s.ownerId}::uuid, NULL,
                                                          'medium', 'financial', 'instalment', now())`;
    await expect(g.prisma.$queryRaw`SELECT chat.work_task_settle(${org}::uuid, ${`lesson_report:${lesson}`}, NULL)`)
      .rejects.toThrow(/names who did its work/);
    expect((await tasks.get(s.teacherId, (await taskFor(`lesson_report:${lesson}`)) as string)).state).toBe('open');
    await g.prisma.$queryRaw`SELECT chat.work_task_settle(${org}::uuid, ${`instalment:${inst}`}, NULL)`;
    expect(await tasks.get(s.ownerId, (await taskFor(`instalment:${inst}`)) as string)).toMatchObject({ state: 'completed', closedBy: null });
  });

  it('the sweep counts what it raised to High', async () => {
    await packageOf(2);
    const [id] = await tasksOf('package_low');
    // The balance used up with the trigger out of the way (as if it had failed): the sweep floors it.
    await g.prisma.$transaction([
      exec(`alter table chat.learner_access disable trigger learner_access_moves_package_task`),
      exec(`update chat.learner_access set balance = 0 where learner_id = $1::uuid`, s.learnerId),
      exec(`alter table chat.learner_access enable trigger learner_access_moves_package_task`),
    ]);
    expect((await tasks.sweep()).floored).toBe(1);
    expect((await tasks.get(smgr, id)).effectivePriority).toBe('high');
  });
});
