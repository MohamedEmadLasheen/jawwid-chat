/**
 * RT-032 -- every deactivation passes the realtime completion barrier.
 *
 * Migration 20261014150000 makes a deactivation a two-step act for EVERY
 * writer: the deactivating transaction writes a chat.principal_revocation row
 * (an ENABLE ALWAYS trigger), and an API node's RevocationConfirmer runs the
 * RT-009 completion barrier for it and stamps confirmed_at. Request roles may
 * not take anyone out of service at all.
 *
 * This file proves the DATABASE and SERVICE halves, deterministically (row
 * locks and deferred promises, never timing):
 *   - the gate: request roles refused on every table and form, server-side
 *     writers allowed and journaled exactly once, ENABLE ALWAYS, atomicity,
 *     concurrent writers, an immutable journal;
 *   - chat.deactivate_principal: coupled columns, labels, idempotency;
 *   - the legitimate writers that exist (chat.offboard_staff);
 *   - RevocationConfirmer: stamps only after the barrier, retries every failure;
 *   - the operator procedure: never reports success without a confirmation;
 *   - state-changing operations (send, react, approve, call start / accept,
 *     media token) are ordered strictly before or after a deactivation.
 *
 * The realtime half -- a delivery held after its final liveness check, its
 * connection killed, a direct deactivation, and no emit after confirmation, on
 * one node and across two -- is in realtime-revocation.spec.ts ("RT-032").
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RealtimeRevocationHub, NO_REALTIME_REVOCATION, type RealtimeRevocation } from '@platform/realtime-revocation';
import { CommError, CommErrorCode } from '@platform/errors';
import { PrismaService } from '@platform/prisma.service';
import { RevocationConfirmer } from '@communication/realtime/revocation-confirmer.service';
import {
  awaitConfirmation,
  commitDeactivation,
  deactivatePrincipal,
  DeactivationRefusal,
} from '../../src/cli/principal-deactivation';
import { NotificationService } from '@communication/notifications/notification.service';
import { TemplateService } from '@communication/notifications/template.service';
import { QuietHoursService } from '@communication/notifications/quiet-hours.service';
import type { PushProvider } from '@communication/notifications/push.provider';
import { buildGraph, legacyHeldMessage, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const ORG = '00000000-0000-0000-0000-000000000001';
const g = buildGraph();
const other = new PrismaService(); // a second pool: a writer on its own connection
let s: Scenario;
let groupId: string;

const exec = (sql: string) => g.prisma.$executeRawUnsafe(sql);
const q = <T>(sql: string) => g.prisma.$queryRawUnsafe<T[]>(sql);

interface JournalRow {
  id: string;
  principal_kind: string;
  transition: string;
  writer: string;
  reason: string | null;
  requested_by: string | null;
  account_id: string | null;
  confirmed_at: Date | null;
  confirmed_by: string | null;
  attempts: number;
  last_error: string | null;
}
const journal = (principalId: string) =>
  q<JournalRow>(`select id::text, principal_kind, transition, writer::text, reason, requested_by::text, account_id::text,
                        confirmed_at, confirmed_by, attempts, last_error
                   from chat.principal_revocation where principal_id = '${principalId}'::uuid order by recorded_at, id`);

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
async function waitUntil(cond: () => Promise<boolean>, what: string, withinMs = 10_000) {
  const end = Date.now() + withinMs;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const lockWaiters = async () =>
  Number((await q<{ n: bigint }>(`select count(*) as n from pg_locks where not granted`))[0].n);

/** Runs `sql` as `role` (SET LOCAL ROLE, so the invoking role is exactly that), with an RLS actor context. */
async function asRole(role: string, sql: string | string[], ctx: { staffId?: string } = {}): Promise<{ ok: boolean; error: string }> {
  try {
    await other.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local role ${role}`);
      if (ctx.staffId) {
        await tx.$executeRawUnsafe(`select set_config('chat.actor_staff_id', '${ctx.staffId}', true), set_config('chat.actor_organization', '${ORG}', true)`);
      }
      for (const statement of Array.isArray(sql) ? sql : [sql]) await tx.$executeRawUnsafe(statement);
    });
    return { ok: true, error: '' };
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
}

async function refusalOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ALLOWED';
  } catch (e) {
    return e instanceof CommError ? e.code : String((e as Error).message);
  }
}

/** A RealtimeRevocationHub whose barrier the test controls. */
function controllableHub() {
  const hub = new RealtimeRevocationHub();
  const disconnected: string[] = [];
  let barrier: () => Promise<void> = async () => undefined;
  let barriers = 0;
  const target: RealtimeRevocation = {
    ...NO_REALTIME_REVOCATION,
    disconnectAccount: (id: string) => void disconnected.push(id),
    confirmRevoked: async () => {
      barriers++;
      await barrier();
    },
  };
  hub.attach(target);
  return {
    hub,
    disconnected,
    barriers: () => barriers,
    setBarrier: (fn: () => Promise<void>) => (barrier = fn),
  };
}

async function account(principalTable: 'contact' | 'staff' | 'teacher', principalId: string, kind: string): Promise<string> {
  const id = randomUUID();
  await exec(`insert into chat.account (id, subject, kind, status, is_active) values ('${id}'::uuid, 'rt032j-${id}', '${kind}', 'active', true)`);
  await exec(`update chat.${principalTable} set account_id = '${id}'::uuid where id = '${principalId}'::uuid`);
  return id;
}

beforeAll(async () => {
  await g.prisma.$connect();
  await other.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await exec(`delete from chat.account where subject like 'rt032j-%'`);
  await exec(`truncate chat.principal_revocation`);
  await other.$disconnect();
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  g.conversations.afterLiveLock = undefined;
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
});

// ===========================================================================
describe('RT-032 gate · who may take a principal out of service', () => {
  /**
   * The request-role write paths onto a principal row differ by history: on
   * main, `authenticated` holds table-level UPDATE on chat.staff (manager
   * policy) and on chat.contact (admins); the staff-profile work narrows both.
   * So the test FINDS a path this database really opens -- a harmless edit that
   * a request role can make to a live principal row -- and proves the gate
   * refuses taking that same row out of service. If the history opens none,
   * the stronger property holds (no request-role write at all) and is asserted.
   */
  async function writablePrincipalPath() {
    const candidates = [
      { table: 'staff', id: s.otherAdminId, ctx: { staffId: s.managerId }, edit: `name = 'renamed'`,
        out: [`is_active = false, left_at = now()`, `left_at = now()`] },
      { table: 'contact', id: s.parentId, ctx: { staffId: s.ownerId }, edit: `name = 'renamed'`, out: [`is_active = false`] },
      { table: 'contact', id: s.parentId, ctx: { staffId: s.managerId }, edit: `name = 'renamed'`, out: [`is_active = false`] },
    ];
    for (const c of candidates) {
      const r = await asRole('chat_app', `update chat.${c.table} set ${c.edit} where id = '${c.id}'::uuid`, c.ctx);
      const [row] = await q<{ name: string }>(`select name from chat.${c.table} where id = '${c.id}'::uuid`);
      if (r.ok && row.name === 'renamed') return c;
    }
    return null;
  }

  it('where a request role CAN write a principal row, it still cannot take that row out of service, set left_at, or delete it', async () => {
    const path = await writablePrincipalPath();
    if (!path) {
      // This history opens no request-role write onto any principal row at all.
      for (const sql of [
        `update chat.staff set is_active = false, left_at = now() where id = '${s.otherAdminId}'::uuid`,
        `update chat.contact set is_active = false where id = '${s.parentId}'::uuid`,
      ]) {
        const r = await asRole('chat_app', sql, { staffId: s.managerId });
        expect(r.ok && (await journal(s.otherAdminId)).length + (await journal(s.parentId)).length > 0).toBe(false);
      }
    } else {
      for (const out of path.out) {
        const r = await asRole('chat_app', `update chat.${path.table} set ${out} where id = '${path.id}'::uuid`, path.ctx);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/RT-032/); // the gate, not a missing privilege: the row WAS writable
      }
      expect((await asRole('chat_app', `delete from chat.${path.table} where id = '${path.id}'::uuid`, path.ctx)).ok).toBe(false);
    }
    const live = await q<{ staff: boolean; contact: boolean }>(
      `select (select is_active and left_at is null from chat.staff where id = '${s.otherAdminId}'::uuid) as staff,
              (select is_active from chat.contact where id = '${s.parentId}'::uuid) as contact`);
    expect(live[0]).toEqual({ staff: true, contact: true });
    expect(await journal(s.otherAdminId)).toEqual([]);
    expect(await journal(s.parentId)).toEqual([]);
  });

  it('every request role, on every principal table and form, leaves the row live and journals nothing', async () => {
    const acct = await account('contact', s.parentId, 'family');
    const statements = [
      `update chat.contact set is_active = false where id = '${s.parentId}'::uuid`,
      `delete from chat.contact where id = '${s.parentId}'::uuid`,
      `update chat.teacher set is_active = false, left_at = now() where id = '${s.teacherId}'::uuid`,
      `update chat.teacher set left_at = now() where id = '${s.teacherId}'::uuid`,
      `update chat.account set status = 'suspended', is_active = false where id = '${acct}'::uuid`,
      `delete from chat.account where id = '${acct}'::uuid`,
    ];
    for (const role of ['chat_app', 'authenticated', 'anon']) {
      for (const ctx of [{}, { staffId: s.managerId }, { staffId: s.ownerId }]) {
        for (const sql of statements) {
          const r = await asRole(role, sql, ctx);
          if (r.ok) continue; // RLS hid the row: nothing changed either way -- asserted below
          expect(r.error).toMatch(/RT-032|permission denied|row-level security/);
        }
      }
    }
    const live = await q<{ c: boolean; t: boolean; a: boolean }>(
      `select (select is_active from chat.contact where id = '${s.parentId}'::uuid) as c,
              (select is_active and left_at is null from chat.teacher where id = '${s.teacherId}'::uuid) as t,
              (select is_active and status = 'active' from chat.account where id = '${acct}'::uuid) as a`);
    expect(live[0]).toEqual({ c: true, t: true, a: true });
    expect(Number((await q<{ n: bigint }>(`select count(*) as n from chat.principal_revocation`))[0].n)).toBe(0);
  });

  it('a request role has no route to a server-side role (SET ROLE needs a membership it does not hold)', async () => {
    const [r] = await q<{ svc: boolean; owner: boolean; superuser: boolean }>(
      `select pg_has_role('chat_app', 'service_role', 'MEMBER') as svc,
              pg_has_role('chat_app', (select relowner from pg_class where oid = 'chat.family'::regclass), 'MEMBER') as owner,
              (select rolsuper from pg_roles where rolname = 'chat_app') as superuser`);
    expect(r).toEqual({ svc: false, owner: false, superuser: false });
  });

  it('server-side writers are allowed, and each transition is journaled exactly once with the writer named', async () => {
    // The owner/superuser session (an operator with psql).
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    // A member of service_role (workers, ingestion).
    expect(await asRole('service_role', `update chat.teacher set is_active = false, left_at = now() where id = '${s.teacherId}'::uuid`))
      .toEqual({ ok: true, error: '' });

    const [contactRow] = await journal(s.parentId);
    const [teacherRow] = await journal(s.teacherId);
    expect(contactRow).toMatchObject({ principal_kind: 'contact', transition: 'deactivated', confirmed_at: null });
    expect(contactRow.writer).toBe((await q<{ u: string }>(`select session_user::text as u`))[0].u);
    expect(teacherRow).toMatchObject({ principal_kind: 'teacher', transition: 'deactivated', writer: 'service_role' });
    expect(await journal(s.parentId)).toHaveLength(1);
    expect(await journal(s.teacherId)).toHaveLength(1);
  });

  it('liveness, not is_active: left_at alone, suspension and deletion are journaled; non-transitions are not', async () => {
    const acct = await account('contact', s.otherParentId, 'family');
    await exec(`update chat.staff set left_at = now() where id = '${s.otherAdminId}'::uuid`); // is_active stays true
    await exec(`update chat.account set status = 'suspended', is_active = false where id = '${acct}'::uuid`);
    await exec(`delete from chat.teacher where id = '${s.unrelatedTeacherId}'::uuid`);
    // Non-transitions: an edit, an already-inactive row written again, a re-activation.
    await exec(`update chat.contact set name = 'edited' where id = '${s.parentId}'::uuid`);
    await exec(`update chat.staff set is_active = false where id = '${s.otherAdminId}'::uuid`);
    await exec(`update chat.account set status = 'deactivated' where id = '${acct}'::uuid`);
    await exec(`update chat.account set status = 'active', is_active = true where id = '${acct}'::uuid`);

    expect((await journal(s.otherAdminId)).map((r) => r.transition)).toEqual(['deactivated']);
    expect((await journal(acct)).map((r) => [r.principal_kind, r.transition, r.account_id])).toEqual([['account', 'suspended', acct]]);
    expect((await journal(s.unrelatedTeacherId)).map((r) => r.transition)).toEqual(['deleted']);
    expect(await journal(s.parentId)).toEqual([]);
  });

  it('ENABLE ALWAYS: replica mode still journals a server-side writer and still refuses a request role', async () => {
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRawUnsafe(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    });
    expect((await journal(s.parentId)).map((r) => r.transition)).toEqual(['deactivated']);

    // A request role cannot enter replica mode at all...
    const replica = await asRole('chat_app', [`set local session_replication_role = replica`], { staffId: s.managerId });
    expect(replica.error).toMatch(/permission denied/);
    // ...and whatever it can write is still refused by the gate (or by privilege).
    const refused = await asRole('chat_app', `update chat.staff set is_active = false, left_at = now() where id = '${s.otherAdminId}'::uuid`, { staffId: s.managerId });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/RT-032|permission denied/);
    expect((await q<{ live: boolean }>(`select is_active as live from chat.staff where id = '${s.otherAdminId}'::uuid`))[0].live).toBe(true);

    const enabled = await q<{ tgname: string; tgenabled: string }>(
      `select tgname, tgenabled from pg_trigger where tgname like '%\\_revocation\\_journal' or tgname like '%\\_deletion\\_journal' order by tgname`);
    expect(enabled).toHaveLength(8);
    expect(enabled.every((t) => t.tgenabled === 'A')).toBe(true);
  });

  it('the journal row commits with the deactivation, or not at all', async () => {
    await expect(
      g.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
        throw new Error('abort after the write');
      }),
    ).rejects.toThrow('abort after the write');
    expect(await journal(s.parentId)).toEqual([]);
    expect((await q<{ a: boolean }>(`select is_active as a from chat.contact where id = '${s.parentId}'::uuid`))[0].a).toBe(true);
  });

  it('two concurrent deactivations of one row write ONE journal row (the second finds nothing to change)', async () => {
    const release = deferred();
    const holding = deferred();
    const first = g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
      holding.resolve();
      await release.promise;
    }, { timeout: 20_000 });
    await holding.promise;
    // .then(): a Prisma raw query is lazy -- it does not run until it is awaited.
    const second = other.$executeRawUnsafe(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`).then((n) => n);
    await waitUntil(async () => (await lockWaiters()) > 0, 'the second writer is blocked on the row');
    release.resolve();
    await first;
    await second;
    expect(await journal(s.parentId)).toHaveLength(1);
  });

  it('the journal is closed to request roles, and immutable in its facts (a confirmation is never withdrawn)', async () => {
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    const [row] = await journal(s.parentId);
    for (const sql of [
      `select * from chat.principal_revocation`,
      `insert into chat.principal_revocation (organization_id, principal_kind, principal_id, transition, writer) values ('${ORG}', 'contact', '${randomUUID()}', 'deactivated', 'x')`,
      `update chat.principal_revocation set confirmed_at = now()`,
    ]) {
      expect((await asRole('chat_app', sql)).error).toMatch(/permission denied/);
    }
    await expect(exec(`update chat.principal_revocation set reason = 'rewritten' where id = '${row.id}'::uuid`)).rejects.toThrow(/immutable/);
    await exec(`update chat.principal_revocation set confirmed_at = now() where id = '${row.id}'::uuid`);
    await expect(exec(`update chat.principal_revocation set confirmed_at = null where id = '${row.id}'::uuid`)).rejects.toThrow(/stays confirmed/);
  });
});

// ===========================================================================
describe('RT-032 · chat.deactivate_principal', () => {
  const op = (kind: string, id: string, reason = 'offboarded', requestedBy: string | null = null, status = 'deactivated') =>
    q<{ id: string }>(`select chat.deactivate_principal('${kind}', '${id}'::uuid, '${reason}', ${requestedBy ? `'${requestedBy}'::uuid` : 'null'}, '${status}')::text as id`)
      .then((r) => r[0].id);

  it('writes the coupled columns for each kind and labels the journal row', async () => {
    const acct = await account('contact', s.otherParentId, 'family');
    await op('contact', s.parentId, 'left the school', s.managerId);
    await op('staff', s.otherAdminId, 'resigned');
    await op('teacher', s.teacherId, 'contract ended');
    await op('account', acct, 'payment dispute', null, 'suspended');

    const [c] = await q<{ a: boolean }>(`select is_active as a from chat.contact where id = '${s.parentId}'::uuid`);
    const [st] = await q<{ a: boolean; left: boolean; presence: string }>(`select is_active as a, left_at is not null as left, presence from chat.staff where id = '${s.otherAdminId}'::uuid`);
    const [t] = await q<{ a: boolean; left: boolean }>(`select is_active as a, left_at is not null as left from chat.teacher where id = '${s.teacherId}'::uuid`);
    const [a] = await q<{ a: boolean; status: string; at: boolean }>(`select is_active as a, status, deactivated_at is not null as at from chat.account where id = '${acct}'::uuid`);
    expect([c, st, t, a]).toEqual([
      { a: false },
      { a: false, left: true, presence: 'offline' },
      { a: false, left: true },
      { a: false, status: 'suspended', at: true },
    ]);
    expect((await journal(s.parentId))[0]).toMatchObject({ reason: 'left the school', requested_by: s.managerId });
    expect((await journal(acct))[0]).toMatchObject({ transition: 'suspended', reason: 'payment dispute' });
  });

  it('is idempotent; a re-activation followed by a second deactivation is a new revocation', async () => {
    const first = await op('contact', s.parentId);
    expect(await op('contact', s.parentId, 'retry')).toBe(first);
    expect(await journal(s.parentId)).toHaveLength(1);
    await exec(`update chat.contact set is_active = true where id = '${s.parentId}'::uuid`);
    const second = await op('contact', s.parentId, 'again');
    expect(second).not.toBe(first);
    expect((await journal(s.parentId)).map((r) => r.id)).toEqual([first, second]);
  });

  it('journals an already-inactive principal once, so a retry is still answered by a barrier and not by a commit', async () => {
    await g.prisma.$transaction(async (tx) => {
      // A row deactivated before the journal existed: written past the trigger.
      await tx.$executeRawUnsafe(`alter table chat.contact disable trigger contact_revocation_journal`);
      await tx.$executeRawUnsafe(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
      await tx.$executeRawUnsafe(`alter table chat.contact enable always trigger contact_revocation_journal`);
    });
    expect(await journal(s.parentId)).toEqual([]);
    const id = await op('contact', s.parentId, 'make sure');
    expect(await journal(s.parentId)).toEqual([expect.objectContaining({ id, transition: 'already_inactive', confirmed_at: null })]);
    expect(await op('contact', s.parentId, 'again')).toBe(id);
  });

  it('refuses bad input, an unknown id, and a staff member who still owns a family -- changing nothing', async () => {
    await expect(op('contact', s.parentId, ' ')).rejects.toThrow(/requires a reason/);
    await expect(op('family', s.parentId)).rejects.toThrow(/unknown principal kind/);
    await expect(op('contact', s.parentId, 'x', null, 'suspended')).rejects.toThrow(/unsupported target status/);
    await expect(op('teacher', randomUUID())).rejects.toThrow(/does not exist/);
    await expect(op('staff', s.ownerId)).rejects.toThrow(/still the primary owner/);
    expect(Number((await q<{ n: bigint }>(`select count(*) as n from chat.principal_revocation`))[0].n)).toBe(0);
    expect((await q<{ a: boolean }>(`select is_active as a from chat.staff where id = '${s.ownerId}'::uuid`))[0].a).toBe(true);
  });

  it('is not executable by a request role', async () => {
    const r = await asRole('chat_app', `select chat.deactivate_principal('contact', '${s.parentId}'::uuid, 'x')`);
    expect(r.error).toMatch(/permission denied for function deactivate_principal/);
  });
});

// ===========================================================================
describe('RT-032 · the legitimate writers that exist', () => {
  // Which history this database was built from is decided by the migrations in
  // this tree (the suites build their database from them), so the test that
  // does not apply is reported SKIPPED -- never as a pass that ran nothing.
  const STAFF_PROFILE_HISTORY = existsSync(
    join(__dirname, '../../../../supabase/migrations/20261014110000_chat_ownership_policy_split.sql'),
  );

  // On this branch's history (= main) chat.offboard_staff has never committed:
  // it calls chat.log_event in a form that does not exist (pre-existing; the
  // staff-profile work repairs it in 20261014090100). So main has NO working
  // SQL deactivation writer. Pinned so that changes visibly: the refusal is
  // that defect, not this gate, and nothing is left half-done.
  (STAFF_PROFILE_HISTORY ? it.skip : it)('main: chat.offboard_staff fails before committing (pre-existing log_event defect), not on this gate', async () => {
    await expect(q(`select * from chat.offboard_staff('${s.ownerId}'::uuid, 'leaving', '${s.otherAdminId}'::uuid, '${s.managerId}'::uuid)`))
      .rejects.toThrow(/function chat\.log_event\(.*\) does not exist/);
    expect((await q<{ owner: string }>(`select owner_id::text as owner from chat.family where id = '${s.familyId}'::uuid`))[0].owner).toBe(s.ownerId);
    expect(await journal(s.ownerId)).toEqual([]);
  });

  // On the staff-profile history: chat.deactivate_staff (super admin) and
  // chat.offboard_staff, both server-side only, write is_active / left_at
  // directly -- and the trigger journals them, unchanged.
  (STAFF_PROFILE_HISTORY ? it : it.skip)('staff-profile history: chat.offboard_staff -> chat.deactivate_staff is journaled for the barrier', async () => {
    const superAdmin = randomUUID();
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
      await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role) values ('${superAdmin}'::uuid, 'owner_sa', 'super_admin')`);
    });
    await q(`select * from chat.offboard_staff('${s.ownerId}'::uuid, 'leaving', '${s.otherAdminId}'::uuid, '${superAdmin}'::uuid)`);
    expect((await q<{ owner: string }>(`select owner_id::text as owner from chat.family where id = '${s.familyId}'::uuid`))[0].owner).toBe(s.otherAdminId);
    expect((await journal(s.ownerId)).map((r) => [r.principal_kind, r.transition, r.confirmed_at])).toEqual([['staff', 'deactivated', null]]);
  });
});

// ===========================================================================
describe('RT-032 · RevocationConfirmer', () => {
  it('stamps confirmed_at only AFTER the barrier resolves, and pushes the disconnect first', async () => {
    const acct = await account('contact', s.parentId, 'family');
    const h = controllableHub();
    const gate = deferred();
    const entered = deferred();
    h.setBarrier(async () => {
      entered.resolve();
      await gate.promise;
    });
    const confirmer = new RevocationConfirmer(g.prisma, h.hub);
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);

    const pass = confirmer.confirmPending();
    await entered.promise; // inside the barrier
    expect(h.disconnected).toEqual([acct]);
    const [during] = await journal(s.parentId);
    expect(during.confirmed_at).toBeNull(); // claimed, NOT confirmed
    expect(during.attempts).toBe(1);

    gate.resolve();
    expect(await pass).toBe(1);
    const [after] = await journal(s.parentId);
    expect(after.confirmed_at).not.toBeNull();
    expect(after.confirmed_by).toBe(confirmer.node);
    expect(confirmer.stats.confirmed).toBe(1);
  });

  it('a barrier that does not confirm stamps nothing; the claim is released and the next pass confirms', async () => {
    const h = controllableHub();
    h.setBarrier(async () => {
      throw new Error('node b did not acknowledge the fence');
    });
    const confirmer = new RevocationConfirmer(g.prisma, h.hub);
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);

    expect(await confirmer.confirmPending()).toBe(0);
    const [failed] = await journal(s.parentId);
    expect(failed).toMatchObject({ confirmed_at: null, attempts: 1, last_error: 'node b did not acknowledge the fence' });
    expect(confirmer.stats.unconfirmedAttempts).toBe(1);

    h.setBarrier(async () => undefined); // the node is back
    expect(await confirmer.confirmPending()).toBe(1);
    expect((await journal(s.parentId))[0]).toMatchObject({ attempts: 2, last_error: null });
    expect((await journal(s.parentId))[0].confirmed_at).not.toBeNull();
  });

  it('a process with no realtime server (the worker) never confirms', async () => {
    const confirmer = new RevocationConfirmer(g.prisma, new RealtimeRevocationHub()); // nothing attached
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    expect(await confirmer.confirmPending()).toBe(0);
    expect((await journal(s.parentId))[0]).toMatchObject({ confirmed_at: null, last_error: expect.stringMatching(/no realtime server/) });
  });

  it('a database failure after the barrier stamps nothing; once the claim lapses another pass confirms', async () => {
    const h = controllableHub();
    const failing = new RevocationConfirmer(g.prisma, h.hub);
    failing.claimSeconds = 1;
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    // The stamp is the second raw statement of a pass; fail exactly that one.
    const real = g.prisma.$executeRaw.bind(g.prisma);
    let calls = 0;
    (g.prisma as unknown as { $executeRaw: unknown }).$executeRaw = (...a: Parameters<typeof real>) => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('connection lost'));
      return real(...a);
    };
    try {
      expect(await failing.confirmPending()).toBe(0);
    } finally {
      (g.prisma as unknown as { $executeRaw: unknown }).$executeRaw = real;
    }
    expect(h.barriers()).toBe(1);
    expect((await journal(s.parentId))[0].confirmed_at).toBeNull();

    const next = new RevocationConfirmer(g.prisma, h.hub);
    expect(await next.confirmPending()).toBe(0); // still claimed by the failed pass
    await waitUntil(async () => (await next.confirmPending()) === 1, 'the claim lapses and the row is confirmed', 5_000);
    expect((await journal(s.parentId))[0].confirmed_by).toBe(next.node);
  });

  it('two confirmers racing: every revocation is confirmed exactly once, by whichever claimed it', async () => {
    const people = [s.parentId, s.otherParentId];
    for (const id of people) await exec(`update chat.contact set is_active = false where id = '${id}'::uuid`);
    await exec(`update chat.teacher set is_active = false, left_at = now() where id = '${s.newTeacherId}'::uuid`);
    const h = controllableHub();
    const gate = deferred();
    h.setBarrier(() => gate.promise);
    const a = new RevocationConfirmer(g.prisma, h.hub);
    const b = new RevocationConfirmer(g.prisma, h.hub);
    const passA = a.confirmPending(); // claims all three, then waits in the barrier
    await waitUntil(async () => h.barriers() === 1, 'A is inside its barrier');
    expect(await b.confirmPending()).toBe(0); // nothing left to claim
    gate.resolve();
    expect(await passA).toBe(3);
    const rows = await q<{ confirmed_by: string; attempts: number }>(`select confirmed_by, attempts from chat.principal_revocation`);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.confirmed_by === a.node && r.attempts === 1)).toBe(true);
  });

  it('with nothing pending, no barrier runs', async () => {
    const h = controllableHub();
    expect(await new RevocationConfirmer(g.prisma, h.hub).confirmPending()).toBe(0);
    expect(h.barriers()).toBe(0);
  });
});

// ===========================================================================
describe('RT-032 · pending notifications follow the same revocation', () => {
  const sent: string[] = [];
  const push: PushProvider = { send: async (m) => { sent.push(m.token); return { ok: true }; } } as PushProvider;
  const notifications = () =>
    new NotificationService(g.prisma, new TemplateService(g.prisma), new QuietHoursService(g.prisma), g.config, push);
  const schedule = (n: NotificationService, scheduledAt: Date) =>
    n.schedule({
      dedupeKey: `rt032:${randomUUID()}`, ruleKey: 'new_message', templateKey: 'new_message',
      eventType: 'message_published', recipientId: s.parentId, locale: 'ar', conversationId: groupId,
      variables: { sender_name: 'Jawwid', preview: '' }, scheduledAt, respectQuietHours: false,
    });
  const statusOf = async (id: string) =>
    (await q<{ status: string; failure_code: string | null }>(`select status, failure_code from chat.notification where id = '${id}'::uuid`))[0];

  beforeEach(async () => {
    sent.length = 0;
    await notifications().registerDevice({ actorId: s.parentId, token: `rt032-${randomUUID()}`, platform: 'android', isVoip: false });
  });

  it('control: a due notification to a live recipient is pushed', async () => {
    const n = notifications();
    const id = (await schedule(n, new Date()))!;
    expect(await n.dispatchDue()).toBe(1);
    expect(sent).toHaveLength(1);
    expect((await statusOf(id)).status).toBe('sent');
  });

  it('one scheduled BEFORE the deactivation is not pushed after it: liveness is re-read at send time, and it is cancelled, not retried', async () => {
    const n = notifications();
    const id = (await schedule(n, new Date()))!;
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    expect(await n.dispatchDue()).toBe(0);
    expect(sent).toEqual([]);
    expect(await statusOf(id)).toEqual({ status: 'cancelled', failure_code: 'RECIPIENT_INACTIVE' });
    // Re-activation does not replay it.
    await exec(`update chat.contact set is_active = true where id = '${s.parentId}'::uuid`);
    expect(await n.dispatchDue()).toBe(0);
    expect(sent).toEqual([]);
  });

  it('the LOGIN suspended (principal still active) is enough to stop the push', async () => {
    const acct = await account('contact', s.parentId, 'family');
    const n = notifications();
    const id = (await schedule(n, new Date()))!;
    await exec(`update chat.account set is_active = false, status = 'suspended' where id = '${acct}'::uuid`);
    expect(await n.dispatchDue()).toBe(0);
    expect(sent).toEqual([]);
    expect((await statusOf(id)).status).toBe('cancelled');
  });

  it('confirmation cancels what is still scheduled for the person (a deferred notification never fires)', async () => {
    const n = notifications();
    const later = (await schedule(n, new Date(Date.now() + 3_600_000)))!;
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    expect(await new RevocationConfirmer(g.prisma, controllableHub().hub).confirmPending()).toBe(1);
    expect(await statusOf(later)).toEqual({ status: 'cancelled', failure_code: 'RECIPIENT_INACTIVE' });
  });
});

// ===========================================================================
describe('RT-032 · the operator procedure never reports success without a confirmation', () => {
  it('no confirmation in time is confirmed:false (saved, not complete); a re-run returns the same revocation', async () => {
    const first = await deactivatePrincipal(g.prisma as never, { kind: 'contact', principalId: s.parentId, reason: 'cli' }, { timeoutMs: 300, pollMs: 50 });
    expect(first).toMatchObject({ confirmed: false, confirmedAt: null });
    expect((await q<{ a: boolean }>(`select is_active as a from chat.contact where id = '${s.parentId}'::uuid`))[0].a).toBe(false);
    const again = await deactivatePrincipal(g.prisma as never, { kind: 'contact', principalId: s.parentId, reason: 'cli retry' }, { timeoutMs: 100, pollMs: 50 });
    expect(again.revocationId).toBe(first.revocationId);
  });

  it('answers confirmed:true once an API node ran the barrier after the commit', async () => {
    const h = controllableHub();
    const confirmer = new RevocationConfirmer(g.prisma, h.hub);
    const revocationId = await commitDeactivation(g.prisma as never, { kind: 'teacher', principalId: s.teacherId, reason: 'cli' });
    const waiting = awaitConfirmation(g.prisma as never, revocationId, { timeoutMs: 5_000, pollMs: 20 });
    await confirmer.confirmPending();
    await expect(waiting).resolves.toMatchObject({ revocationId, confirmed: true });
  });

  it('refusals change nothing', async () => {
    const refuse = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof DeactivationRefusal ? e.code : String(e)));
    expect(await refuse(commitDeactivation(g.prisma as never, { kind: 'staff', principalId: s.ownerId, reason: 'x' }))).toBe('OWNS_FAMILIES');
    expect(await refuse(commitDeactivation(g.prisma as never, { kind: 'teacher', principalId: randomUUID(), reason: 'x' }))).toBe('NOT_FOUND');
    expect(await refuse(commitDeactivation(g.prisma as never, { kind: 'contact', principalId: 'nope', reason: 'x' }))).toBe('USAGE');
    expect(await refuse(commitDeactivation(g.prisma as never, { kind: 'contact', principalId: s.parentId, reason: '' }))).toBe('USAGE');
    expect(await refuse(commitDeactivation(g.prisma as never, { kind: 'contact', principalId: s.parentId, reason: 'x', status: 'suspended' }))).toBe('USAGE');
    expect(Number((await q<{ n: bigint }>(`select count(*) as n from chat.principal_revocation`))[0].n)).toBe(0);
  });
});

// ===========================================================================
// A deactivation and an operation by the same actor, raced with row locks.
// "Committed first" = a deactivation transaction that has written and is
// held open; the operation must then block on the actor's row and, once the
// deactivation commits, see it. "Checked first" = the operation held right
// after its live check; the deactivation must then block until it commits.
// ===========================================================================
async function heldDeactivation(kind: string, id: string) {
  const written = deferred();
  const commit = deferred();
  const done = other.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`select chat.deactivate_principal('${kind}', '${id}'::uuid, 'raced')`);
    written.resolve();
    await commit.promise;
  }, { timeout: 20_000 });
  await written.promise;
  return { commit: async () => { commit.resolve(); await done; } };
}

async function expectRefusedAfterDeactivationCommits(kind: string, id: string, operation: () => Promise<unknown>): Promise<string> {
  const held = await heldDeactivation(kind, id);
  const outcome = refusalOf(operation());
  await waitUntil(async () => (await lockWaiters()) > 0, 'the operation is blocked on the actor row');
  await held.commit();
  return outcome;
}

describe('RT-032 · state-changing operations are ordered strictly before or after a deactivation', () => {
  it('send: a deactivation committed first is what the locked read sees -- refused, nothing written', async () => {
    const clientMessageId = randomUUID();
    const outcome = await expectRefusedAfterDeactivationCommits('contact', s.parentId, () =>
      g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'raced', clientMessageId }));
    expect(outcome).toBe(CommErrorCode.ACTOR_INACTIVE);
    expect(await g.prisma.message.count({ where: { clientMessageId } })).toBe(0);
  });

  it('send: one already past its live check is ordered BEFORE the deactivation, which waits for it', async () => {
    const reached = deferred();
    const release = deferred();
    g.conversations.afterLiveLock = async (actorId) => {
      if (actorId !== s.parentId) return;
      g.conversations.afterLiveLock = undefined;
      reached.resolve();
      await release.promise;
    };
    const clientMessageId = randomUUID();
    const sending = g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'first', clientMessageId });
    await reached.promise;
    let deactivated = false;
    const deactivation = other.$queryRawUnsafe(`select chat.deactivate_principal('contact', '${s.parentId}'::uuid, 'raced')`)
      .then(() => (deactivated = true));
    await waitUntil(async () => (await lockWaiters()) > 0, 'the deactivation waits for the send');
    expect(deactivated).toBe(false);
    release.resolve();
    await sending;
    await deactivation;
    expect(await g.prisma.message.count({ where: { clientMessageId } })).toBe(1);
    expect((await journal(s.parentId))).toHaveLength(1);
  });

  it('reaction: refused when the deactivation commits first', async () => {
    // From staff, as it always was; since PD-14 a parent's or teacher's publishes at once too.
    const m = await g.messages.send({ conversationId: groupId, senderId: s.ownerId, body: 'react to me', clientMessageId: randomUUID() });
    const outcome = await expectRefusedAfterDeactivationCommits('contact', s.parentId, () => g.messages.react(m.id, s.parentId, '👍'));
    expect(outcome).toBe(CommErrorCode.ACTOR_INACTIVE);
    expect(await g.prisma.messageReaction.count({ where: { messageId: m.id } })).toBe(0);
  });

  it('approval: the approver deactivated just before the decision commits -- refused, the message stays held', async () => {
    // PD-14: a message held before it -- nothing new is held.
    const held = await legacyHeldMessage(g, { conversationId: groupId, senderId: s.teacherId, body: 'needs approval' });
    expect(held.moderation).toBe('pending');
    const approval = await g.prisma.messageApproval.findFirstOrThrow({ where: { messageId: held.id } });
    const outcome = await expectRefusedAfterDeactivationCommits('staff', s.managerId, () => g.approvals.approve(approval.id, s.managerId));
    expect(outcome).toBe(CommErrorCode.ACTOR_INACTIVE);
    expect((await g.prisma.messageApproval.findUniqueOrThrow({ where: { id: approval.id } })).decision).toBe('pending');
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: held.id } })).moderation).toBe('pending');
  });

  it('call start: the initiator deactivated just before the call row commits -- refused, no call', async () => {
    const outcome = await expectRefusedAfterDeactivationCommits('teacher', s.teacherId, () => g.calls.start(groupId, s.teacherId));
    expect(outcome).toBe(CommErrorCode.ACTOR_INACTIVE);
    expect(await g.prisma.call.count({ where: { conversationId: groupId } })).toBe(0);
  });

  it('call accept and media token: refused for a participant deactivated just before they commit / are minted', async () => {
    const { callId } = await g.calls.start(groupId, s.teacherId);
    expect(await expectRefusedAfterDeactivationCommits('contact', s.parentId, () => g.calls.accept(callId, s.parentId)))
      .toBe(CommErrorCode.ACTOR_INACTIVE);
    const mine = await g.prisma.callParticipant.findFirstOrThrow({ where: { callId, actorId: s.parentId } });
    expect(mine.joinedAt).toBeNull();

    expect(await expectRefusedAfterDeactivationCommits('contact', s.otherParentId, () => g.calls.issueToken(callId, s.otherParentId)))
      .toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('control: with nobody deactivated, the same operations go through', async () => {
    await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'ok', clientMessageId: randomUUID() });
    const m = await g.messages.send({ conversationId: groupId, senderId: s.ownerId, body: 'react to me', clientMessageId: randomUUID() });
    await g.messages.react(m.id, s.parentId, '👍');
    const { callId } = await g.calls.start(groupId, s.teacherId);
    await g.calls.accept(callId, s.parentId);
    await expect(g.calls.issueToken(callId, s.parentId)).resolves.toMatchObject({ token: expect.any(String) });
  });
});
