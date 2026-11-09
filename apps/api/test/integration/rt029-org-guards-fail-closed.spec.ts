/**
 * RT-029 follow-up, LR-46 P2-4 and P2-5 (20261109160000_chat_org_guards_fail_closed).
 *
 * P2-4. 20261109130000 guarded chat.learner.teacher_id with the shared
 * chat.enforce_same_organization(), which is SECURITY INVOKER and treats "the
 * parent row is not visible" as a pass. chat.teacher has row-level security, so
 * a writer that cannot see the teacher would have passed a cross-organization
 * teacher_id (the foreign key, checked by the owner, still sees the row). The
 * learner trigger now runs its own SECURITY DEFINER function that refuses a
 * teacher in another organization AND a teacher that does not exist, whoever
 * writes. The shared function is unchanged for every other table.
 *
 * Only server-side (BYPASSRLS) roles write teacher_id today, so the "cannot see
 * the teacher" case is staged inside a transaction that is always rolled back:
 * on the owner connection the assignment gate is disabled, chat.learner's own
 * row-level security is switched off and chat_app is granted INSERT, then the
 * insert runs AS chat_app with the tenant set to organization A, where
 * chat.teacher's restrictive tenant policy hides organization B's teacher. All
 * of that DDL rolls back with the transaction.
 *
 * P2-5. organization_id is immutable after insert on chat.learner, chat.contact,
 * chat.staff and chat.account too (20261109150000 did family, conversation and
 * teacher). No code path moves these rows between organizations.
 *
 * Its own two organizations and rows, removed by id afterwards. Synthetic data
 * only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { withAssignmentGate } from './harness';

jest.setTimeout(60_000);

const db = new PrismaService();
const ORG_A = randomUUID();
const ORG_B = randomUUID();
const ids = {
  staffA: randomUUID(),
  staffB: randomUUID(),
  teacherA: randomUUID(),
  teacherB: randomUUID(),
  familyA: randomUUID(),
  familyB: randomUUID(),
  learnerA: randomUUID(),
  contactA: randomUUID(),
  accountA: randomUUID(),
};

/** The newly immutable tables, with the trigger, function and an unrelated column update. */
const GUARDED = [
  { table: 'learner', id: () => ids.learnerA, trigger: 'learner_org_immutable', fn: 'learner_organization_immutable', other: `level = 'B1'` },
  { table: 'contact', id: () => ids.contactA, trigger: 'contact_org_immutable', fn: 'contact_organization_immutable', other: `can_message = false` },
  { table: 'staff', id: () => ids.staffA, trigger: 'staff_org_immutable', fn: 'staff_organization_immutable', other: `name = 'rt029g_admin_a_renamed'` },
  { table: 'account', id: () => ids.accountA, trigger: 'account_org_immutable', fn: 'account_organization_immutable', other: `last_login_at = now()` },
] as const;

/** SQLSTATE and message of a refused statement; null when it succeeded. */
async function refusal(run: () => Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await run();
    return null;
  } catch (e) {
    const message = String((e as Error).message);
    const code = (e as { meta?: { code?: string } }).meta?.code ?? (message.match(/Code: `(\w+)`/)?.[1] ?? '');
    return { code: String(code), message };
  }
}
const exec = (sql: string) => () => db.$executeRawUnsafe(sql);
const gated = (sql: string) => () => withAssignmentGate(db, sql);
const orgOf = async (table: string, id: string) =>
  (await db.$queryRawUnsafe<Array<{ o: string }>>(`select organization_id::text as o from chat.${table} where id = '${id}'::uuid`))[0]?.o ?? null;
const learnerCount = async (id: string) =>
  (await db.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int as n from chat.learner where id = '${id}'::uuid`))[0].n;
const insertLearner = (id: string, org: string, family: string, teacher: string | null) =>
  `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
   values ('${id}'::uuid, '${org}'::uuid, '${family}'::uuid, 'rt029g_learner', ${teacher ? `'${teacher}'::uuid` : 'null'})`;

type Tx = Pick<PrismaService, '$queryRawUnsafe' | '$executeRawUnsafe'>;
const ROLLBACK = new Error('rollback');

/**
 * Runs `fn` AS chat_app, tenant = organization A, in a transaction that is
 * always rolled back. Before switching role, on the owner connection: the
 * assignment gate is disabled (it would refuse a request role first, and this
 * test is about the tenancy guard behind it), chat.learner's row-level security
 * is off and chat_app may INSERT into it and read chat.teacher / chat.family
 * (so a missing row is hidden by RLS, not by a missing grant). chat.teacher's
 * row-level security stays ON.
 */
async function asRequestRoleThatCannotSeeTeacherB<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await db
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`alter table chat.learner disable trigger learner_assignment_is_guarded`);
      await tx.$executeRawUnsafe(`alter table chat.learner disable row level security`);
      await tx.$executeRawUnsafe(`grant insert on chat.learner to chat_app`);
      await tx.$executeRawUnsafe(`grant select on chat.teacher, chat.family to chat_app`);
      await tx.$executeRawUnsafe(`set local role chat_app`);
      await tx.$executeRawUnsafe(`select set_config('chat.actor_organization', $1, true)`, ORG_A);
      const [who] = await tx.$queryRawUnsafe<Array<{ u: string }>>(`select current_user::text as u`);
      expect(who.u).toBe('chat_app');
      // The premise: this caller cannot see organization B's teacher.
      const [seen] = await tx.$queryRawUnsafe<Array<{ n: number }>>(
        `select count(*)::int as n from chat.teacher where id = '${ids.teacherB}'::uuid`,
      );
      expect(seen.n).toBe(0);
      out = await fn(tx);
      throw ROLLBACK;
    }, { timeout: 30_000 })
    .catch((e: unknown) => {
      if (e !== ROLLBACK) throw e;
    });
  return out as T;
}
/** The statement's outcome inside the request-role transaction: row count, or "SQLSTATE message". */
async function run(tx: Tx, sql: string): Promise<number | string> {
  let count = 0;
  const out = await refusal(async () => {
    count = await tx.$executeRawUnsafe(sql);
  });
  return out ? `${out.code} ${out.message}` : count;
}

beforeAll(async () => {
  for (const [org, slug] of [[ORG_A, 'a'], [ORG_B, 'b']] as const) {
    await db.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name) values ('${org}'::uuid, 'rt029g-${slug}-${org.slice(0, 8)}', 'RT-029 fail-closed ${slug}')`,
    );
  }
  await db.$executeRawUnsafe(
    `insert into chat.staff (id, organization_id, name, role) values
       ('${ids.staffA}'::uuid, '${ORG_A}'::uuid, 'rt029g_admin_a', 'admin'),
       ('${ids.staffB}'::uuid, '${ORG_B}'::uuid, 'rt029g_admin_b', 'admin')`,
  );
  await db.$executeRawUnsafe(
    `insert into chat.teacher (id, organization_id, name, is_active) values
       ('${ids.teacherA}'::uuid, '${ORG_A}'::uuid, 'rt029g_teacher_a', true),
       ('${ids.teacherB}'::uuid, '${ORG_B}'::uuid, 'rt029g_teacher_b', true)`,
  );
  await db.$executeRawUnsafe(
    `insert into chat.family (id, organization_id, display_name, owner_id, language) values
       ('${ids.familyA}'::uuid, '${ORG_A}'::uuid, 'rt029g_family_a', '${ids.staffA}'::uuid, 'ar'),
       ('${ids.familyB}'::uuid, '${ORG_B}'::uuid, 'rt029g_family_b', '${ids.staffB}'::uuid, 'ar')`,
  );
  await withAssignmentGate(db, insertLearner(ids.learnerA, ORG_A, ids.familyA, ids.teacherA));
  // Not live (is_active false), so removing them afterwards writes no revocation journal row.
  await db.$executeRawUnsafe(
    `insert into chat.contact (id, organization_id, family_id, name, role_preset, can_message, is_active)
     values ('${ids.contactA}'::uuid, '${ORG_A}'::uuid, '${ids.familyA}'::uuid, 'rt029g_parent_a', 'primary_guardian', true, false)`,
  );
  await db.$executeRawUnsafe(
    `insert into chat.account (id, organization_id, subject, kind, status, is_active)
     values ('${ids.accountA}'::uuid, '${ORG_A}'::uuid, 'rt029g-${ids.accountA}@example.test', 'staff', 'deactivated', false)`,
  );
});

afterAll(async () => {
  const orgs = `('${ORG_A}'::uuid, '${ORG_B}'::uuid)`;
  await withAssignmentGate(db, `delete from chat.learner where organization_id in ${orgs}`);
  await db.$executeRawUnsafe(`delete from chat.contact where organization_id in ${orgs}`);
  await db.$executeRawUnsafe(`delete from chat.account where organization_id in ${orgs}`);
  await db.$executeRawUnsafe(`delete from chat.family where organization_id in ${orgs}`);
  await db.$executeRawUnsafe(`delete from chat.teacher where organization_id in ${orgs}`);
  await db.$executeRawUnsafe(`delete from chat.staff where organization_id in ${orgs}`);
  await db.$executeRawUnsafe(`delete from chat.organization where id in ${orgs}`);
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// P2-4: the learner's teacher check fails closed

describe('the learner teacher guard is a dedicated SECURITY DEFINER function', () => {
  it('learner_teacher_same_organization runs chat.enforce_learner_teacher_organization(), still after the assignment gate', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ tgname: string; def: string }>>(
      `select tgname::text, pg_get_triggerdef(oid) as def from pg_trigger
        where tgrelid = 'chat.learner'::regclass and not tgisinternal
        order by tgname`,
    );
    const names = rows.map((r) => r.tgname);
    const def = rows.find((r) => r.tgname === 'learner_teacher_same_organization')!.def;
    expect(def).toMatch(/BEFORE INSERT OR UPDATE OF (organization_id, teacher_id|teacher_id, organization_id) ON chat\.learner/);
    expect(def).toMatch(/FOR EACH ROW EXECUTE FUNCTION chat\.enforce_learner_teacher_organization\(\)/);
    expect(names.indexOf('learner_assignment_is_guarded')).toBeLessThan(names.indexOf('learner_teacher_same_organization'));
  });

  it('is SECURITY DEFINER with search_path pinned to pg_catalog, pg_temp, and no request role may execute it', async () => {
    const [row] = await db.$queryRawUnsafe<Array<{ definer: boolean; config: string[] | null; anon: boolean; authn: boolean; app: boolean }>>(
      `select p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn,
              has_function_privilege('chat_app', p.oid, 'EXECUTE') as app
         from pg_proc p
        where p.oid = 'chat.enforce_learner_teacher_organization()'::regprocedure`,
    );
    expect(row.definer).toBe(true);
    expect(row.config).toEqual(expect.arrayContaining(['search_path=pg_catalog, pg_temp']));
    expect({ anon: row.anon, authn: row.authn, app: row.app }).toEqual({ anon: false, authn: false, app: false });
  });

  it('the shared chat.enforce_same_organization() is unchanged: still SECURITY INVOKER', async () => {
    const [row] = await db.$queryRawUnsafe<Array<{ definer: boolean }>>(
      `select prosecdef as definer from pg_proc where oid = 'chat.enforce_same_organization()'::regprocedure`,
    );
    expect(row.definer).toBe(false);
  });
});

describe('a writer that cannot see the teacher still cannot name another organization\'s teacher', () => {
  it('INSERT as chat_app (teacher B hidden by row-level security) is refused with check_violation', async () => {
    const id = randomUUID();
    const out = await asRequestRoleThatCannotSeeTeacherB((tx) => run(tx, insertLearner(id, ORG_A, ids.familyA, ids.teacherB)));
    // Before this fix the invoker guard read "no teacher" as a pass and the
    // foreign key (checked as owner) accepted the row: out was 1.
    expect(String(out)).toMatch(/cross-organization reference: chat\.learner row belongs to organization .*parent chat\.teacher/);
    expect(String(out)).toMatch(/23514/);
    expect(await learnerCount(id)).toBe(0);
  });

  it('control: the same caller naming its own organization\'s teacher is accepted (the definer reads the teacher)', async () => {
    const out = await asRequestRoleThatCannotSeeTeacherB((tx) => run(tx, insertLearner(randomUUID(), ORG_A, ids.familyA, ids.teacherA)));
    expect(out).toBe(1);
  });

  it('a teacher that does not exist is refused by the guard itself, before the foreign key', async () => {
    const out = await asRequestRoleThatCannotSeeTeacherB((tx) => run(tx, insertLearner(randomUUID(), ORG_A, ids.familyA, randomUUID())));
    expect(String(out)).toMatch(/names chat\.teacher .* which does not exist/);
    expect(String(out)).toMatch(/23503/);
  });
});

describe('server-side writes (owner connection, through the assignment gate)', () => {
  it('a cross-organization teacher is refused on INSERT and on UPDATE', async () => {
    const id = randomUUID();
    const ins = await refusal(gated(insertLearner(id, ORG_A, ids.familyA, ids.teacherB)));
    expect(ins?.code).toBe('23514');
    expect(ins?.message).toMatch(/cross-organization reference: chat\.learner row belongs to organization .*parent chat\.teacher/);
    expect(await learnerCount(id)).toBe(0);

    const upd = await refusal(gated(`update chat.learner set teacher_id = '${ids.teacherB}'::uuid where id = '${ids.learnerA}'::uuid`));
    expect(upd?.code).toBe('23514');
    const [{ t }] = await db.$queryRawUnsafe<Array<{ t: string }>>(`select teacher_id::text as t from chat.learner where id = '${ids.learnerA}'::uuid`);
    expect(t).toBe(ids.teacherA);
  });

  it('a missing teacher is refused by the guard (23503, its own message), on INSERT and on UPDATE', async () => {
    const ins = await refusal(gated(insertLearner(randomUUID(), ORG_A, ids.familyA, randomUUID())));
    expect(ins?.code).toBe('23503');
    expect(ins?.message).toMatch(/which does not exist/);
    const upd = await refusal(gated(`update chat.learner set teacher_id = '${randomUUID()}'::uuid where id = '${ids.learnerA}'::uuid`));
    expect(upd?.code).toBe('23503');
    expect(upd?.message).toMatch(/which does not exist/);
  });

  it('no teacher, and a same-organization teacher, are accepted', async () => {
    expect(await refusal(gated(insertLearner(randomUUID(), ORG_A, ids.familyA, null)))).toBeNull();
    expect(await refusal(gated(insertLearner(randomUUID(), ORG_A, ids.familyA, ids.teacherA)))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P2-5: learner, contact, staff and account never change organization

describe('the immutability guards are installed', () => {
  it.each(GUARDED)('chat.$table carries $trigger: BEFORE UPDATE, only when organization_id changes', async ({ table, trigger, fn }) => {
    const rows = await db.$queryRawUnsafe<Array<{ def: string; enabled: string }>>(
      `select pg_get_triggerdef(oid) as def, tgenabled::text as enabled from pg_trigger
        where tgrelid = 'chat.${table}'::regclass and not tgisinternal and tgname = '${trigger}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe('O');
    expect(rows[0].def).toMatch(new RegExp(`BEFORE UPDATE ON chat\\.${table} FOR EACH ROW`));
    expect(rows[0].def).toMatch(/WHEN \(\(new\.organization_id IS DISTINCT FROM old\.organization_id\)\)/i);
    expect(rows[0].def).toMatch(new RegExp(`EXECUTE FUNCTION chat\\.${fn}\\(\\)`));
  });

  it('each table has its own trigger function, with a pinned search_path', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ fn: string; pinned: boolean }>>(
      `select p.proname::text as fn,
              exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as pinned
         from pg_proc p
        where p.pronamespace = 'chat'::regnamespace
          and p.proname in (${GUARDED.map((g) => `'${g.fn}'`).join(', ')})
        order by 1`,
    );
    expect(rows).toEqual(GUARDED.map((g) => ({ fn: g.fn, pinned: true })).sort((x, y) => x.fn.localeCompare(y.fn)));
  });
});

describe('organization_id cannot change after insert', () => {
  it.each(GUARDED)('chat.$table: a move to another organization is refused with check_violation', async ({ table, id }) => {
    const out = await refusal(exec(`update chat.${table} set organization_id = '${ORG_B}'::uuid where id = '${id()}'::uuid`));
    expect(out?.code).toBe('23514');
    expect(out?.message).toMatch(new RegExp(`organization_id is immutable: chat\\.${table} `));
    expect(await orgOf(table, id())).toBe(ORG_A);
  });

  it.each(GUARDED)('chat.$table: a move bundled with another change is refused whole', async ({ table, id, other }) => {
    const out = await refusal(exec(`update chat.${table} set ${other}, organization_id = '${ORG_B}'::uuid where id = '${id()}'::uuid`));
    expect(out?.code).toBe('23514');
    expect(out?.message).toMatch(/organization_id is immutable/);
    expect(await orgOf(table, id())).toBe(ORG_A);
  });

  it('a learner moved together with a matching family and teacher is still refused: the assignment gate opens assignment, not tenancy', async () => {
    const out = await refusal(gated(
      `update chat.learner set organization_id = '${ORG_B}'::uuid, family_id = '${ids.familyB}'::uuid, teacher_id = '${ids.teacherB}'::uuid
        where id = '${ids.learnerA}'::uuid`,
    ));
    expect(out?.code).toBe('23514');
    expect(out?.message).toMatch(/organization_id is immutable: chat\.learner /);
    expect(await orgOf('learner', ids.learnerA)).toBe(ORG_A);
  });
});

describe('every other update is unaffected', () => {
  it.each(GUARDED)('chat.$table: restating the same organization is accepted', async ({ table, id }) => {
    expect(await refusal(exec(`update chat.${table} set organization_id = '${ORG_A}'::uuid where id = '${id()}'::uuid`))).toBeNull();
    expect(await refusal(exec(`update chat.${table} set organization_id = organization_id where id = '${id()}'::uuid`))).toBeNull();
    expect(await orgOf(table, id())).toBe(ORG_A);
  });

  it.each(GUARDED)('chat.$table: an update of another column goes through', async ({ table, id, other }) => {
    expect(await refusal(exec(`update chat.${table} set ${other} where id = '${id()}'::uuid`))).toBeNull();
    expect(await orgOf(table, id())).toBe(ORG_A);
  });
});
