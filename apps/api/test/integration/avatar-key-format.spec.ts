/**
 * One avatar object-key format, enforced by the database for every writer
 * (20261014130000): avatars/<kind>/<id of the row>/<uuid>.
 *
 * The flat avatars/<name> shape feat/account-avatar's API issued is refused even
 * on the owner connection, as is a key under someone else's id. Contact, learner
 * and teacher photo columns have no request-role writer.
 *
 * Its own organization and rows, removed by id afterwards.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { withAssignmentGate } from './harness';

jest.setTimeout(60_000);

const db = new PrismaService();
const ORG = randomUUID();
const ids = { staff: randomUUID(), other: randomUUID(), teacher: randomUUID(), family: randomUUID(), contact: randomUUID(), learner: randomUUID() };

async function sqlState(sql: string): Promise<string | null> {
  try {
    await db.$executeRawUnsafe(sql);
    return null;
  } catch (e) {
    return String((e as { meta?: { code?: string } }).meta?.code ?? (e as Error).message);
  }
}

beforeAll(async () => {
  await db.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${ORG}'::uuid, 'avk-${ORG.slice(0, 8)}', 'Avatar keys')`);
  await db.$executeRawUnsafe(
    `insert into chat.staff (id, organization_id, name, role) values
       ('${ids.staff}'::uuid, '${ORG}'::uuid, 'avk_admin', 'admin'),
       ('${ids.other}'::uuid, '${ORG}'::uuid, 'avk_other', 'admin')`,
  );
  await db.$executeRawUnsafe(`insert into chat.teacher (id, organization_id, name) values ('${ids.teacher}'::uuid, '${ORG}'::uuid, 'avk_teacher')`);
  await db.$executeRawUnsafe(
    `insert into chat.family (id, organization_id, display_name, owner_id) values ('${ids.family}'::uuid, '${ORG}'::uuid, 'avk_family', '${ids.staff}'::uuid)`,
  );
  await db.$executeRawUnsafe(
    `insert into chat.contact (id, organization_id, family_id, name, role_preset, can_message)
     values ('${ids.contact}'::uuid, '${ORG}'::uuid, '${ids.family}'::uuid, 'avk_parent', 'primary_guardian', true)`,
  );
  await withAssignmentGate(
    db,
    `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
     values ('${ids.learner}'::uuid, '${ORG}'::uuid, '${ids.family}'::uuid, 'avk_learner', '${ids.teacher}'::uuid)`,
  );
});

afterAll(async () => {
  await withAssignmentGate(db, `delete from chat.learner where id = '${ids.learner}'::uuid`);
  await db.$executeRawUnsafe(`delete from chat.contact where id = '${ids.contact}'::uuid`);
  await db.$executeRawUnsafe(`delete from chat.family where id = '${ids.family}'::uuid`);
  await db.$executeRawUnsafe(`delete from chat.teacher where id = '${ids.teacher}'::uuid`);
  await db.$executeRawUnsafe(`delete from chat.staff where organization_id = '${ORG}'::uuid`);
  await db.$executeRawUnsafe(`delete from chat.organization where id = '${ORG}'::uuid`);
  await db.$disconnect();
});

const TABLES = [
  ['staff', () => ids.staff],
  ['teacher', () => ids.teacher],
  ['contact', () => ids.contact],
  ['learner', () => ids.learner],
] as const;

describe.each(TABLES)('chat.%s.avatar_object_key', (table, id) => {
  const set = (key: string | null) =>
    sqlState(`update chat.${table} set avatar_object_key = ${key === null ? 'null' : `'${key}'`} where id = '${id()}'::uuid`);

  it('accepts avatars/<kind>/<own id>/<uuid> and NULL, on the owner connection', async () => {
    expect(await set(`avatars/${table}/${id()}/${randomUUID()}`)).toBeNull();
    expect(await set(null)).toBeNull();
  });

  it('refuses the flat avatars/<name> shape, another row\'s prefix, and traversal -- even on the owner connection', async () => {
    expect(await set(`avatars/${randomUUID()}.jpg`)).toBe('23514');
    expect(await set(`avatars/${table}/${ids.other}/${randomUUID()}`)).toBe('23514');
    expect(await set(`avatars/${table}/${id()}/../${randomUUID()}`)).toBe('23514');
    expect(await set(`avatars/${table === 'staff' ? 'contact' : 'staff'}/${id()}/${randomUUID()}`)).toBe('23514');
  });
});

it('contact, learner and teacher photo keys have no request-role writer; staff keeps its guarded grant', async () => {
  const rows = await db.$queryRaw<Array<{ role: string; tbl: string; upd: boolean; ins: boolean }>>`
    select r.role, t.tbl,
           has_column_privilege(r.role, 'chat.' || t.tbl, 'avatar_object_key', 'UPDATE') as upd,
           has_column_privilege(r.role, 'chat.' || t.tbl, 'avatar_object_key', 'INSERT') as ins
      from unnest(array['anon', 'authenticated', 'chat_app']) as r(role),
           unnest(array['contact', 'learner', 'teacher', 'staff']) as t(tbl)`;
  for (const r of rows) {
    if (r.tbl === 'staff' && r.role !== 'anon') expect([r.role, r.tbl, r.upd]).toEqual([r.role, r.tbl, true]);
    else expect([r.role, r.tbl, r.upd, r.ins]).toEqual([r.role, r.tbl, false, false]);
  }
});
