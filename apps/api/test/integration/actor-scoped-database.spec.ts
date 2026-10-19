/**
 * The restricted runtime path's identity guarantees, on the REAL chat_app login
 * (DATABASE_APP_URL), not a SET ROLE harness:
 *
 *   - identity is transaction-local: a pooled connection returns with none,
 *     after a commit, an application rollback and a database error alike;
 *   - the same physical connection (pg_backend_pid) serves actor after actor
 *     and none of them sees another's identity, interleaved or not;
 *   - a statement outside withActor runs as nobody and RLS shows it nothing;
 *   - it fails closed: an owner URL, an inactive actor, a missing or suspended
 *     login, a foreign organization -- each is refused before `fn` runs.
 *
 * Its own organization, staff and accounts, removed by id afterwards; the
 * suite truncates nothing.
 */
import { randomUUID } from 'node:crypto';
import { ActorScopedDatabase } from '@platform/actor-database';
import { CommError, CommErrorCode } from '@platform/errors';
import { PrismaService } from '@platform/prisma.service';
import type { Actor } from '@platform/types';

jest.setTimeout(60_000);

const APP_URL = process.env.DATABASE_APP_URL;
const OWNER_URL = process.env.DATABASE_URL;
const withLimit = (url: string, n: number): string => `${url}${url.includes('?') ? '&' : '?'}connection_limit=${n}`;

const owner = new PrismaService();
const ORG = randomUUID();
const ids = { admin: randomUUID(), manager: randomUUID(), noLogin: randomUUID(), suspended: randomUUID() };
const accounts = { admin: randomUUID(), manager: randomUUID(), suspended: randomUUID() };

function staffActor(actorId: string, extra: Partial<Actor> = {}): Actor {
  return { kind: 'staff', actorId, organizationId: ORG, role: 'admin', isActive: true, ...extra } as Actor;
}
async function refused(p: Promise<unknown>): Promise<void> {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(CommError);
  expect((e as CommError).code).toBe(CommErrorCode.ACTOR_INACTIVE);
}

const run = APP_URL ? describe : describe.skip;

run('ActorScopedDatabase on the real chat_app login', () => {
  let single: ActorScopedDatabase; // connection_limit=1: every call reuses ONE backend
  let pair: ActorScopedDatabase;   // connection_limit=2: concurrent calls interleave

  beforeAll(async () => {
    const slug = `pool-${ORG.slice(0, 8)}`;
    await owner.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${ORG}'::uuid, '${slug}', 'Pool isolation')`);
    await owner.$executeRawUnsafe(
      `insert into chat.account (id, subject, kind, organization_id, status, is_active) values
         ('${accounts.admin}'::uuid, '${slug}-admin@pool-isolation.test', 'staff', '${ORG}'::uuid, 'active', true),
         ('${accounts.manager}'::uuid, '${slug}-manager@pool-isolation.test', 'staff', '${ORG}'::uuid, 'active', true),
         ('${accounts.suspended}'::uuid, '${slug}-suspended@pool-isolation.test', 'staff', '${ORG}'::uuid, 'suspended', false)`,
    );
    await owner.$executeRawUnsafe(
      `insert into chat.staff (id, organization_id, name, role, account_id) values
         ('${ids.admin}'::uuid, '${ORG}'::uuid, 'pool_admin', 'admin', '${accounts.admin}'::uuid),
         ('${ids.manager}'::uuid, '${ORG}'::uuid, 'pool_manager', 'manager', '${accounts.manager}'::uuid),
         ('${ids.noLogin}'::uuid, '${ORG}'::uuid, 'pool_nologin', 'admin', null),
         ('${ids.suspended}'::uuid, '${ORG}'::uuid, 'pool_suspended', 'admin', '${accounts.suspended}'::uuid)`,
    );
    single = new ActorScopedDatabase(owner, withLimit(APP_URL as string, 1));
    pair = new ActorScopedDatabase(owner, withLimit(APP_URL as string, 2));
  });

  afterAll(async () => {
    await single?.onModuleDestroy();
    await pair?.onModuleDestroy();
    await owner.$executeRawUnsafe(`delete from chat.staff where organization_id = '${ORG}'::uuid`);
    await owner.$executeRawUnsafe(`delete from chat.account where organization_id = '${ORG}'::uuid`);
    await owner.$executeRawUnsafe(`delete from chat.organization where id = '${ORG}'::uuid`);
    await owner.$disconnect();
  });

  const whoAmI = (db: ActorScopedDatabase, actorId: string) =>
    db.withActor(staffActor(actorId), async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ staff: string; org: string; pid: number; bypass: boolean; usr: string }>>`
        select chat.current_staff_id()::text as staff, chat.current_organization_id()::text as org,
               pg_backend_pid() as pid, (select rolbypassrls from pg_roles where rolname = current_user) as bypass,
               current_user::text as usr`;
      return row;
    });

  it('the connection is chat_app, not the owner, and cannot bypass RLS', async () => {
    const me = await whoAmI(single, ids.admin);
    expect(me).toMatchObject({ staff: ids.admin, org: ORG, bypass: false, usr: 'chat_app' });
  });

  it('outside withActor the pooled connection has no identity and RLS shows nothing', async () => {
    const before = await single.ambientIdentity();
    expect(before).toMatchObject({ subject: null, organization: null, staff: null });
    const inside = await whoAmI(single, ids.admin);
    const after = await single.ambientIdentity();
    expect(after.pid).toBe(inside.pid); // the SAME backend served both
    expect(after).toMatchObject({ subject: null, organization: null, staff: null });
  });

  it('one backend serves actor after actor; none sees the previous one', async () => {
    const seen: Array<{ staff: string; pid: number }> = [];
    for (const id of [ids.admin, ids.manager, ids.admin, ids.manager]) {
      seen.push(await whoAmI(single, id));
      expect((await single.ambientIdentity()).staff).toBeNull();
    }
    expect(new Set(seen.map((r) => r.pid)).size).toBe(1);
    expect(seen.map((r) => r.staff)).toEqual([ids.admin, ids.manager, ids.admin, ids.manager]);
  });

  it('an application error rolls back the write AND the identity', async () => {
    const [{ before }] = await owner.$queryRaw<Array<{ before: Date | null }>>`
      select last_activity_at as before from chat.staff where id = ${ids.admin}::uuid`;
    const pid = (await whoAmI(single, ids.admin)).pid;
    const err = await single
      .withActor(staffActor(ids.admin), async (tx) => {
        await tx.$executeRaw`update chat.staff set last_activity_at = now() + interval '1 day' where id = ${ids.admin}::uuid`;
        throw new Error('boom');
      })
      .catch((e: unknown) => e);
    expect(String(err)).toMatch(/boom/);
    const [{ after }] = await owner.$queryRaw<Array<{ after: Date | null }>>`
      select last_activity_at as after from chat.staff where id = ${ids.admin}::uuid`;
    expect(after).toEqual(before);
    const ambient = await single.ambientIdentity();
    expect(ambient.pid).toBe(pid);
    expect(ambient).toMatchObject({ subject: null, staff: null });
  });

  it('a database error inside the transaction leaves no identity behind', async () => {
    const err = await single
      .withActor(staffActor(ids.manager), async (tx) => tx.$queryRaw`select 1 / 0`)
      .catch((e: unknown) => e);
    expect(String(err)).toMatch(/division by zero/);
    expect(await single.ambientIdentity()).toMatchObject({ subject: null, staff: null });
    expect((await whoAmI(single, ids.admin)).staff).toBe(ids.admin);
  });

  it('a permission error (a column chat_app may not write) also leaves no identity behind', async () => {
    const err = await single
      .withActor(staffActor(ids.admin), async (tx) => tx.$executeRaw`update chat.staff set role = 'manager' where id = ${ids.admin}::uuid`)
      .catch((e: unknown) => e);
    expect(String(err)).toMatch(/permission denied/);
    expect(await single.ambientIdentity()).toMatchObject({ subject: null, staff: null });
    const [{ role }] = await owner.$queryRaw<Array<{ role: string }>>`select role from chat.staff where id = ${ids.admin}::uuid`;
    expect(role).toBe('admin');
  });

  it('interleaved concurrent requests on a shared pool each see only themselves', async () => {
    const calls = Array.from({ length: 16 }, (_, i) => (i % 2 ? ids.manager : ids.admin));
    const results = await Promise.all(
      calls.map((id) =>
        pair.withActor(staffActor(id), async (tx) => {
          const [a] = await tx.$queryRaw<Array<{ s: string }>>`select chat.current_staff_id()::text as s`;
          await tx.$executeRaw`select pg_sleep(0.02)`;
          const [b] = await tx.$queryRaw<Array<{ s: string; pid: number }>>`select chat.current_staff_id()::text as s, pg_backend_pid() as pid`;
          return { want: id, a: a.s, b: b.s, pid: b.pid };
        }),
      ),
    );
    for (const r of results) {
      expect(r.a).toBe(r.want);
      expect(r.b).toBe(r.want);
    }
    expect(new Set(results.map((r) => r.pid)).size).toBeLessThanOrEqual(2);
    expect((await pair.ambientIdentity()).staff).toBeNull();
  });

  describe('fails closed before fn runs', () => {
    const neverRuns = jest.fn(async () => 'ran');
    afterEach(() => expect(neverRuns).not.toHaveBeenCalled());

    it('an owner (server-side, RLS-bypassing) URL is refused', async () => {
      const wrong = new ActorScopedDatabase(owner, OWNER_URL);
      try {
        await refused(wrong.withActor(staffActor(ids.admin), neverRuns));
      } finally {
        await wrong.onModuleDestroy();
      }
    });
    it('an inactive actor, a staff member with no login, a suspended login', async () => {
      await refused(single.withActor(staffActor(ids.admin, { isActive: false }), neverRuns));
      await refused(single.withActor(staffActor(ids.noLogin), neverRuns));
      await refused(single.withActor(staffActor(ids.suspended), neverRuns));
    });
    it('an actor whose organization is not the staff row\'s', async () => {
      await refused(single.withActor(staffActor(ids.admin, { organizationId: randomUUID() }), neverRuns));
    });
    it('a non-staff actor', async () => {
      await refused(single.withActor({ kind: 'contact', actorId: randomUUID(), organizationId: ORG, isActive: true } as unknown as Actor, neverRuns));
    });
    it('without DATABASE_APP_URL there is no scoped path at all', async () => {
      const off = new ActorScopedDatabase(owner, null);
      expect(off.enabled).toBe(false);
      await expect(off.withActor(staffActor(ids.admin), neverRuns)).rejects.toThrow(/not configured/);
    });
  });
});
