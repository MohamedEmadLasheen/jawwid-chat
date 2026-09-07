/**
 * THE GROUP ROSTER IS A PRIVACY BOUNDARY.
 *
 * A group spans families. Its roster therefore names students belonging to
 * families the reader may not supervise, which makes an unscoped roster the
 * group-level shape of red-team A-1/RT-011 -- a directory of other people's
 * children.
 *
 * This suite tests the boundary against EVERY persona, at BOTH layers: the
 * service (AuthorizationService + ScopeService) and the database (RLS as
 * chat_app, with the service removed from the picture entirely). UI filtering
 * is not part of the boundary and is not tested as though it were.
 *
 * The sharpest requirement: no parent may obtain another family's identity,
 * another family's learner, another family's group membership, or any contact
 * information -- by any path.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService, withRequestScopedTransaction } from '@platform/prisma.service';
import { buildGraph, buildGraphOn, seed, truncate, Scenario, appDatabaseUrl } from './harness';
import { CommErrorCode } from '@platform/errors';

const owner = new PrismaService();
const g = buildGraph();

/** The API's real connection: chat_app, NOBYPASSRLS, not the owner. */
const connection = new PrismaService({ datasources: { db: { url: appDatabaseUrl() } } });
const app = withRequestScopedTransaction(connection);
const rls = buildGraphOn(app);

let s: Scenario;
/** A SECOND family, its learner and its parent -- the "other family". */
let other: { familyId: string; learnerId: string; parentId: string; adminId: string };
let groupId: string;

const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;

async function asActor<T>(actorId: string, fn: () => Promise<T>): Promise<T> {
  const a = (await owner.$queryRawUnsafe<Array<{ subject: string; org: string; kind: string }>>(
    `select a.subject, a.organization_id::text as org, a.kind
       from chat.account a
       left join chat.staff   st on st.account_id = a.id
       left join chat.contact c  on c.account_id = a.id
       left join chat.teacher t  on t.account_id = a.id
      where st.id = '${actorId}'::uuid or c.id = '${actorId}'::uuid or t.id = '${actorId}'::uuid
      limit 1`,
  ))[0];
  return app.runWithActor(
    { actorId, kind: a.kind as 'staff' | 'contact' | 'teacher', organizationId: a.org },
    a.subject,
    fn,
  );
}

beforeAll(async () => {
  await truncate(owner);
  s = await seed(owner);

  // Build the other family through the owner connection: fixtures are not the
  // thing under test.
  other = {
    familyId: randomUUID(),
    learnerId: randomUUID(),
    parentId: randomUUID(),
    adminId: randomUUID(),
  };
  const acct = randomUUID();
  const adminAcct = randomUUID();
  await owner.$executeRawUnsafe(`
    insert into chat.account (id, subject, kind, status) values
      ('${acct}'::uuid, 'subject_${other.parentId}', 'family', 'active'),
      ('${adminAcct}'::uuid, 'subject_${other.adminId}', 'staff', 'active')`);
  await owner.$executeRawUnsafe(`
    insert into chat.staff (id, account_id, name, role, is_active)
    values ('${other.adminId}'::uuid, '${adminAcct}'::uuid, 'admin_other', 'admin', true)`);
  await owner.$executeRawUnsafe(`
    insert into chat.family (id, display_name, owner_id, language)
    values ('${other.familyId}'::uuid, 'family_other', '${other.adminId}'::uuid, 'ar')`);
  await owner.$executeRawUnsafe(`
    insert into chat.contact (id, account_id, family_id, name, role_preset, can_message,
                              can_view_progress, can_manage_schedule, can_manage_billing,
                              can_manage_contacts, can_cancel, is_active)
    values ('${other.parentId}'::uuid, '${acct}'::uuid, '${other.familyId}'::uuid, 'parent_other',
            'primary_guardian', true, true, true, true, true, true, true)`);
  await owner.$executeRawUnsafe(`
    insert into chat.learner (id, family_id, name)
    values ('${other.learnerId}'::uuid, '${other.familyId}'::uuid, 'learner_other')`);

  // ONE group holding BOTH families' students -- the cross-family case.
  const manager = await actorOf(s.managerId);
  const group = await g.groups.create(manager, { name: 'Mixed group', ownerId: s.ownerId });
  groupId = group.id;
  await g.groups.addMember(manager, groupId, s.learnerId);
  await g.groups.addMember(manager, groupId, other.learnerId);
  await g.groups.addTeacher(manager, groupId, s.teacherId);
});

afterAll(async () => {
  await truncate(owner);
  await Promise.all([owner.$disconnect(), connection.$disconnect()]);
});

describe('service layer: who sees which roster rows', () => {
  it('MANAGER (organization-wide) sees the whole roster', async () => {
    const manager = await actorOf(s.managerId);
    const rows = await g.groups.members(manager, groupId);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(2);
  });

  it('AUTHORIZED SUPERVISOR sees only their own family’s student', async () => {
    // s.ownerId supervises s.familyId only. The other family's child must not
    // appear, even though both are in the same group.
    const supervisor = await actorOf(s.ownerId);
    const rows = await g.groups.members(supervisor, groupId);
    expect(rows.map((r) => r.learnerId)).toEqual([s.learnerId]);
    expect(rows.map((r) => r.learnerId)).not.toContain(other.learnerId);
  });

  it('THE OTHER SUPERVISOR sees only their own, symmetrically', async () => {
    const otherSupervisor = await actorOf(other.adminId);
    const rows = await g.groups.members(otherSupervisor, groupId);
    expect(rows.map((r) => r.learnerId)).toEqual([other.learnerId]);
  });

  it('UNRELATED SUPERVISOR (supervises nothing) sees an empty roster', async () => {
    const unrelated = await actorOf(s.otherAdminId);
    expect(await g.groups.members(unrelated, groupId)).toHaveLength(0);
  });

  it('CURRENT TEACHER sees the group', async () => {
    const teacher = await actorOf(s.teacherId);
    expect((await g.groups.list(teacher)).map((x) => x.id)).toContain(groupId);
  });

  it('FORMER TEACHER loses the group; the historical row grants nothing', async () => {
    const manager = await actorOf(s.managerId);
    const teacher = await actorOf(s.newTeacherId);
    await g.groups.addTeacher(manager, groupId, s.newTeacherId);
    expect((await g.groups.list(teacher)).map((x) => x.id)).toContain(groupId);

    await g.groups.removeTeacher(manager, groupId, s.newTeacherId, 'reassigned');

    expect((await g.groups.list(teacher)).map((x) => x.id)).not.toContain(groupId);
    await expect(g.groups.get(teacher, groupId)).rejects.toMatchObject({
      code: CommErrorCode.CONVERSATION_NOT_FOUND,
    });
  });

  it('PARENT is refused at the permission gate, before any query runs', async () => {
    const parent = await actorOf(s.parentId);
    for (const call of [
      () => g.groups.list(parent),
      () => g.groups.get(parent, groupId),
      () => g.groups.members(parent, groupId),
      () => g.groups.teachers(parent, groupId),
      () => g.groups.history(parent, groupId),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
    }
  });

  it('THE OTHER FAMILY’S PARENT is refused identically', async () => {
    const otherParent = await actorOf(other.parentId);
    await expect(g.groups.members(otherParent, groupId)).rejects.toMatchObject({
      code: CommErrorCode.PERMISSION_DENIED,
    });
  });

  it('UNAUTHORIZED USER (deactivated staff) is refused', async () => {
    // Access ends with the role, on every path.
    await owner.$executeRawUnsafe(
      `update chat.staff set is_active = false, left_at = now() where id = '${s.otherAdminId}'::uuid`,
    );
    const deactivated = await actorOf(s.otherAdminId);
    await expect(g.groups.members(deactivated, groupId)).rejects.toMatchObject({
      code: CommErrorCode.ACTOR_INACTIVE,
    });
    await owner.$executeRawUnsafe(
      `update chat.staff set is_active = true, left_at = null where id = '${s.otherAdminId}'::uuid`,
    );
  });
});

describe('database layer: the boundary holds with the service removed', () => {
  it('a parent reads NO group, roster or teacher row under RLS', async () => {
    for (const table of ['chat.group', 'chat.group_member', 'chat.group_teacher']) {
      const rows = await asActor(s.parentId, () =>
        app.$queryRawUnsafe<unknown[]>(`select * from ${table}`),
      );
      expect({ table, count: rows.length }).toEqual({ table, count: 0 });
    }
  });

  it('a parent cannot reach ANOTHER family, its learner or its contacts', async () => {
    const family = await asActor(s.parentId, () =>
      app.$queryRawUnsafe<unknown[]>(
        `select id from chat.family where id = '${other.familyId}'::uuid`,
      ),
    );
    const learner = await asActor(s.parentId, () =>
      app.$queryRawUnsafe<unknown[]>(
        `select id from chat.learner where id = '${other.learnerId}'::uuid`,
      ),
    );
    const contacts = await asActor(s.parentId, () =>
      app.$queryRawUnsafe<unknown[]>(
        `select id from chat.contact where family_id = '${other.familyId}'::uuid`,
      ),
    );
    expect({ family: family.length, learner: learner.length, contacts: contacts.length }).toEqual({
      family: 0,
      learner: 0,
      contacts: 0,
    });
  });

  it('a supervisor reads only their own family’s roster rows under RLS', async () => {
    const rows = await asActor(s.ownerId, () =>
      app.$queryRawUnsafe<Array<{ learner_id: string }>>(
        `select learner_id from chat.group_member where group_id = '${groupId}'::uuid`,
      ),
    );
    expect(rows.map((r) => r.learner_id)).toEqual([s.learnerId]);
  });

  it('the RLS roster result matches the service result exactly', async () => {
    // The two layers must agree. A database stricter than the service turns a
    // correct request into a silent empty result; a database looser than the
    // service means the service is the only thing holding the line.
    const supervisor = await actorOf(s.ownerId);
    const viaService = (await g.groups.members(supervisor, groupId))
      .filter((r) => r.isCurrent)
      .map((r) => r.learnerId)
      .sort();
    const viaRls = (
      await asActor(s.ownerId, () =>
        app.$queryRawUnsafe<Array<{ learner_id: string }>>(
          `select learner_id from chat.group_member
            where group_id = '${groupId}'::uuid and left_at is null`,
        ),
      )
    )
      .map((r) => r.learner_id)
      .sort();
    expect(viaRls).toEqual(viaService);
  });

  it('no contact channel exists to leak: the schema has no such column', async () => {
    // BR-2. The strongest possible form of "a parent cannot obtain another
    // family's contact information" is that the column does not exist.
    //
    // `account.email_verified_at` is deliberately excluded: it is a nullable
    // TIMESTAMP recording when a verification completed, and holds no address.
    // The rule is that no column CARRIES a contact channel, not that no column
    // name may contain the substring.
    const cols = await owner.$queryRawUnsafe<Array<{ c: string }>>(`
      select table_name||'.'||column_name as c from information_schema.columns
       where table_schema='chat'
         and (column_name ~* 'phone|mobile|email|e_mail|address|whatsapp')
         and data_type not in ('timestamp with time zone', 'timestamp without time zone')`);
    expect(cols.map((x) => x.c)).toEqual([]);
  });
});
