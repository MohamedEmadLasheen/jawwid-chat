/**
 * RT-029 follow-up: a root row never changes organization after it is created
 * (20261109150000_chat_org_moves_guarded).
 *
 * chat.family, chat.conversation and chat.teacher are parents: contacts,
 * learners, subscriptions, notes, cases, tasks hang off a family; messages and
 * calls off a conversation; learners name a teacher. Moving a parent's
 * organization_id left every child in the old organization, and a child write
 * racing a parent move could each pass its own check. No code path moves these
 * rows on purpose, so the migration makes organization_id immutable after
 * insert: BEFORE UPDATE, WHEN the value changes, check_violation (23514)
 * "organization_id is immutable". An UPDATE that restates the same value, and
 * every other column, are untouched.
 *
 * chat.thread was dropped by 20260905094000 (OD-01) and has no organization to
 * guard; the last block keeps that assumption under test.
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
  teacher: randomUUID(),
  family: randomUUID(),
  conversation: randomUUID(),
};

/** The guarded tables, with the trigger and function each one carries. */
const GUARDED = [
  { table: 'family', id: () => ids.family, trigger: 'family_org_immutable', fn: 'family_organization_immutable', other: `display_name = 'rt029i_family_renamed'` },
  { table: 'conversation', id: () => ids.conversation, trigger: 'conversation_org_immutable', fn: 'conversation_organization_immutable', other: `title = 'rt029i_conversation_renamed'` },
  { table: 'teacher', id: () => ids.teacher, trigger: 'teacher_org_immutable', fn: 'teacher_organization_immutable', other: `name = 'rt029i_teacher_renamed'` },
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
const orgOf = async (table: string, id: string) =>
  (await db.$queryRawUnsafe<Array<{ o: string }>>(`select organization_id::text as o from chat.${table} where id = '${id}'::uuid`))[0]?.o ?? null;

beforeAll(async () => {
  for (const [org, slug] of [[ORG_A, 'a'], [ORG_B, 'b']] as const) {
    await db.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name) values ('${org}'::uuid, 'rt029i-${slug}-${org.slice(0, 8)}', 'RT-029 immutable ${slug}')`,
    );
  }
  await db.$executeRawUnsafe(
    `insert into chat.staff (id, organization_id, name, role) values ('${ids.staffA}'::uuid, '${ORG_A}'::uuid, 'rt029i_admin_a', 'admin')`,
  );
  await db.$executeRawUnsafe(
    `insert into chat.teacher (id, organization_id, name, is_active) values ('${ids.teacher}'::uuid, '${ORG_A}'::uuid, 'rt029i_teacher', true)`,
  );
  await db.$executeRawUnsafe(
    `insert into chat.family (id, organization_id, display_name, owner_id, language)
     values ('${ids.family}'::uuid, '${ORG_A}'::uuid, 'rt029i_family', '${ids.staffA}'::uuid, 'ar')`,
  );
  await db.$executeRawUnsafe(
    `insert into chat.conversation (id, organization_id, type, family_id, direct_key)
     values ('${ids.conversation}'::uuid, '${ORG_A}'::uuid, 'direct', '${ids.family}'::uuid, 'rt029i-${ids.conversation}')`,
  );
});

afterAll(async () => {
  await db.$executeRawUnsafe(`delete from chat.conversation where organization_id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$executeRawUnsafe(`delete from chat.family where organization_id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$executeRawUnsafe(`delete from chat.teacher where organization_id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$executeRawUnsafe(`delete from chat.staff where organization_id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$executeRawUnsafe(`delete from chat.organization where id in ('${ORG_A}'::uuid, '${ORG_B}'::uuid)`);
  await db.$disconnect();
});

describe('the guards are installed', () => {
  it.each(GUARDED)('chat.$table carries $trigger: BEFORE UPDATE, only when organization_id changes', async ({ table, trigger, fn }) => {
    const rows = await db.$queryRawUnsafe<Array<{ def: string; enabled: string }>>(
      `select pg_get_triggerdef(oid) as def, tgenabled::text as enabled from pg_trigger
        where tgrelid = 'chat.${table}'::regclass and not tgisinternal and tgname = '${trigger}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe('O');
    // Any UPDATE, not only one naming the column: a value changed by another
    // BEFORE trigger is refused too.
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

  it("on chat.teacher it fires before #550's learner guard, so a refused move reads the same on every table", async () => {
    const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
      `select tgname::text as name from pg_trigger
        where tgrelid = 'chat.teacher'::regclass and not tgisinternal
          and tgname in ('teacher_org_immutable', 'teacher_org_move_keeps_learners')
        order by tgname`,
    );
    // Postgres fires same-timing row triggers in name order.
    expect(rows.map((r) => r.name)).toEqual(['teacher_org_immutable', 'teacher_org_move_keeps_learners']);
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
    expect(await orgOf(table, id())).toBe(ORG_A);
  });

  it('the assignment-ingestion gate opens assignment, not tenancy', async () => {
    const out = await refusal(() => withAssignmentGate(db, `update chat.teacher set organization_id = '${ORG_B}'::uuid where id = '${ids.teacher}'::uuid`));
    expect(out?.code).toBe('23514');
    expect(await orgOf('teacher', ids.teacher)).toBe(ORG_A);
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

describe('chat.thread', () => {
  it('no longer exists (dropped by OD-01), so it has no organization to guard', async () => {
    const [{ t }] = await db.$queryRawUnsafe<Array<{ t: string | null }>>(`select to_regclass('chat.thread')::text as t`);
    // If chat.thread comes back, it needs the same guard: add it to GUARDED and the migration.
    expect(t).toBeNull();
  });
});
