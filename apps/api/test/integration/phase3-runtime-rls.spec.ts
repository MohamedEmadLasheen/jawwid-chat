/**
 * PHASE 3 UNDER THE LEAST-PRIVILEGED RUNTIME ROLE.
 *
 * Every other Phase 3 suite runs as the database OWNER, which bypasses RLS --
 * so it proves the service layer and says nothing about the second layer. This
 * one connects as `chat_app`: NOBYPASSRLS, owns nothing, and is the role the
 * API connects as in a correctly deployed environment.
 *
 * Phase 3 WIDENS that role -- it gains INSERT/UPDATE on chat.family and
 * chat.learner, which it did not have before. A privilege expansion has to be
 * proved in both directions, so this suite asserts:
 *
 *   1. the application still WORKS through the role (least privilege that takes
 *      the product down is not a security improvement);
 *   2. the policies actually CONSTRAIN -- an out-of-scope write is refused with
 *      the service layer removed from the picture;
 *   3. what was deliberately NOT granted really is not granted, so "history is
 *      never hard-deleted" is a property of the role rather than a convention.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService, withRequestScopedTransaction } from '@platform/prisma.service';
import { buildGraphOn, seed, truncate, Scenario, appDatabaseUrl } from './harness';

const owner = new PrismaService();
const connection = new PrismaService({ datasources: { db: { url: appDatabaseUrl() } } });
const app = withRequestScopedTransaction(connection);
const g = buildGraphOn(app);

let s: Scenario;

async function asActor<T>(actorId: string, fn: () => Promise<T>): Promise<T> {
  const actor = (await owner.$queryRawUnsafe<Array<{ subject: string; org: string; kind: string }>>(
    `select a.subject, a.organization_id::text as org, a.kind
       from chat.account a
       left join chat.staff   s on s.account_id = a.id
       left join chat.contact c on c.account_id = a.id
       left join chat.teacher t on t.account_id = a.id
      where s.id = '${actorId}'::uuid or c.id = '${actorId}'::uuid or t.id = '${actorId}'::uuid
      limit 1`,
  ))[0];
  return app.runWithActor(
    { actorId, kind: actor.kind as 'staff' | 'contact' | 'teacher', organizationId: actor.org },
    actor.subject,
    fn,
  );
}

const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;

beforeAll(async () => {
  await truncate(owner);
  s = await seed(owner);
});
afterAll(async () => {
  await truncate(owner);
  await Promise.all([owner.$disconnect(), connection.$disconnect()]);
});

describe('the application works as chat_app', () => {
  it('a manager creates a family, a student and a label', async () => {
    await asActor(s.managerId, async () => {
      const manager = await actorOf(s.managerId);
      const family = await g.families.createFamily(manager, {
        displayName: 'family_rls',
        supervisorId: s.ownerId,
      });
      expect(family.id).toBeDefined();

      const learner = await g.learners.create(manager, family.id, { name: 'rls_student' });
      expect(learner.familyId).toBe(family.id);

      const label = await g.labels.create(manager, { name: 'RLS Label' });
      const outcomes = await g.labels.addFamilies(manager, label.id, [family.id]);
      expect(outcomes).toEqual([{ familyId: family.id, status: 'applied' }]);
    });
  });

  it('a supervisor transfers a teacher, through the policy', async () => {
    await asActor(s.managerId, async () => {
      const manager = await actorOf(s.managerId);
      const history = await g.learners.assignTeacher(
        manager,
        s.learnerId,
        s.newTeacherId,
        'rls transfer',
      );
      expect(history.filter((h) => h.isCurrent)[0].teacherId).toBe(s.newTeacherId);
    });
  });

  it('a manager runs the whole group lifecycle', async () => {
    await asActor(s.managerId, async () => {
      const manager = await actorOf(s.managerId);
      const group = await g.groups.create(manager, { name: 'rls group', ownerId: s.ownerId });
      await g.groups.addMember(manager, group.id, s.learnerId);
      await g.groups.addTeacher(manager, group.id, s.teacherId);
      await g.groups.close(manager, group.id, 'done');
      const archived = await g.groups.archive(manager, group.id, 'done');
      expect(archived.state).toBe('archived');
    });
  });
});

describe('the policies constrain, with the service layer removed', () => {
  it('an out-of-scope family is invisible to a raw SELECT', async () => {
    // otherAdmin supervises nothing. Not "filtered by the service" -- not
    // returned by the database at all.
    const rows = await asActor(s.otherAdminId, () =>
      app.$queryRawUnsafe<Array<{ id: string }>>(
        `select id from chat.family where id = '${s.familyId}'::uuid`,
      ),
    );
    expect(rows).toHaveLength(0);
  });

  it('an out-of-scope family cannot be UPDATED by a raw statement', async () => {
    const before = await owner.family.findUniqueOrThrow({ where: { id: s.familyId } });
    await asActor(s.otherAdminId, () =>
      app.$executeRawUnsafe(
        `update chat.family set display_name = 'hijacked' where id = '${s.familyId}'::uuid`,
      ),
    );
    // The policy makes the row invisible, so the UPDATE matches nothing. It
    // does not error -- it simply has no effect, which is the fail-closed shape.
    const after = await owner.family.findUniqueOrThrow({ where: { id: s.familyId } });
    expect(after.displayName).toBe(before.displayName);
    expect(after.displayName).not.toBe('hijacked');
  });

  it('an out-of-scope learner cannot be relabelled by a raw statement', async () => {
    const before = await owner.learner.findUniqueOrThrow({ where: { id: s.learnerId } });
    await asActor(s.otherAdminId, () =>
      app.$executeRawUnsafe(
        `update chat.learner set name = 'hijacked' where id = '${s.learnerId}'::uuid`,
      ),
    );
    const after = await owner.learner.findUniqueOrThrow({ where: { id: s.learnerId } });
    expect(after.name).toBe(before.name);
  });

  it('a teacher assignment for an out-of-scope learner is refused', async () => {
    await expect(
      asActor(s.otherAdminId, () =>
        app.$executeRawUnsafe(
          `insert into chat.learner_teacher_assignment (learner_id, teacher_id, reason)
           values ('${s.learnerId}'::uuid, '${s.teacherId}'::uuid, 'bypass')`,
        ),
      ),
    ).rejects.toBeDefined();
  });

  it('a parent cannot read the group tables at all', async () => {
    const groups = await asActor(s.parentId, () =>
      app.$queryRawUnsafe<unknown[]>(`select id from chat.group`),
    );
    const members = await asActor(s.parentId, () =>
      app.$queryRawUnsafe<unknown[]>(`select id from chat.group_member`),
    );
    expect(groups).toHaveLength(0);
    expect(members).toHaveLength(0);
  });

  it('a parent cannot enumerate the label vocabulary', async () => {
    const labels = await asActor(s.parentId, () =>
      app.$queryRawUnsafe<unknown[]>(`select id from chat.label`),
    );
    expect(labels).toHaveLength(0);
  });
});

describe('cross-organization writes are refused', () => {
  it('a family in another organization cannot be created through the role', async () => {
    const foreignOrg = randomUUID();
    await owner.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name)
       values ('${foreignOrg}'::uuid, 'other-${foreignOrg.slice(0, 8)}', 'Other Academy')`,
    );
    await expect(
      asActor(s.managerId, () =>
        app.$executeRawUnsafe(
          `insert into chat.family (display_name, owner_id, language, organization_id)
           values ('foreign', '${s.ownerId}'::uuid, 'ar', '${foreignOrg}'::uuid)`,
        ),
      ),
    ).rejects.toBeDefined();
  });

  it('a label in another organization cannot be created through the role', async () => {
    const rows = await owner.$queryRawUnsafe<Array<{ id: string }>>(
      `select id from chat.organization where slug <> 'jawwid' limit 1`,
    );
    if (rows.length === 0) return;
    await expect(
      asActor(s.managerId, () =>
        app.$executeRawUnsafe(
          `insert into chat.label (name, organization_id)
           values ('foreign label', '${rows[0].id}'::uuid)`,
        ),
      ),
    ).rejects.toBeDefined();
  });
});

describe('what was deliberately NOT granted', () => {
  /**
   * These are the privileges Phase 3 withheld ON PURPOSE. Withholding DELETE is
   * what turns "Phase 3 never hard-deletes history" from a convention the
   * service layer is trusted to keep into a property of the role: a bug that
   * tried to delete a family, a student or an assignment fails at the database
   * as a privilege error rather than succeeding quietly.
   */
  it.each([
    ['chat.family', 'delete from chat.family'],
    ['chat.learner', 'delete from chat.learner'],
    ['chat.learner_teacher_assignment', 'delete from chat.learner_teacher_assignment'],
    ['chat.group', 'delete from chat.group'],
    ['chat.group_member', 'delete from chat.group_member'],
    ['chat.group_teacher', 'delete from chat.group_teacher'],
    ['chat.label', 'delete from chat.label'],
  ])('chat_app holds no DELETE on %s', async (_table, sql) => {
    await expect(
      asActor(s.managerId, () => app.$executeRawUnsafe(`${sql} where false`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it('chat_app CAN delete a family_label -- un-filing is not history', async () => {
    // The one intended exception: a label association carries no timeline, and
    // re-adding it is idempotent, so a row is the right granularity to remove.
    await expect(
      asActor(s.managerId, () =>
        app.$executeRawUnsafe(`delete from chat.family_label where false`),
      ),
    ).resolves.toBeDefined();
  });
});
