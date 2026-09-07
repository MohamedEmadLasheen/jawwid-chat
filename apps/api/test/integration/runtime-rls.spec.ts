/**
 * THE PROOF FOR PHASE 1's LAST CRITICAL GAP.
 *
 * Every other suite runs against the database OWNER, which bypasses row-level
 * security -- so it proves the service layer and says nothing about the second
 * layer. This one connects as `chat_app`: the role the API connects as in a
 * correctly deployed environment, which owns nothing and cannot bypass RLS.
 *
 * It asserts two things that have to be true together, because either alone is
 * worthless:
 *
 *   1. RLS actually CONSTRAINS. A supervisor reaches their own family and not
 *      another's, with the service layer removed from the picture entirely.
 *   2. The application still WORKS. The real ConversationService and
 *      MessageService complete real operations through this role -- so
 *      "least privilege" is not a configuration that would take the product
 *      down the moment it was applied.
 *
 * Note what running as `chat_app` requires: every query must be inside
 * `PrismaService.runWithActor()`, because the policies resolve the caller from
 * transaction-local settings. That is what ActorContextInterceptor does for
 * every authenticated HTTP request, and what this suite does explicitly.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService, withRequestScopedTransaction } from '@platform/prisma.service';
import { buildGraphOn, seed, truncate, Scenario, appDatabaseUrl } from './harness';
import { CommErrorCode } from '@platform/errors';

const owner = new PrismaService();

/**
 * The API's connection: chat_app, NOBYPASSRLS, not the owner -- and wrapped in
 * the same request-scoped proxy the application uses, so every query a service
 * makes lands inside the actor's transaction. Without the wrapper the queries
 * would run outside it, see no actor context, and (correctly) return nothing.
 */
const connection = new PrismaService({ datasources: { db: { url: appDatabaseUrl() } } });
const app = withRequestScopedTransaction(connection);
const g = buildGraphOn(app);

let s: Scenario;
let otherFamilyId: string;
let otherParentId: string;
let otherConversationId: string;
let myConversationId: string;

const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;

/** Runs `fn` the way a request does: inside this actor's database context. */
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

beforeAll(async () => {
  await truncate(owner);
  s = await seed(owner);

  // The second family, supervised by the other admin. Seeded through the owner
  // connection: fixtures are not the thing under test.
  otherFamilyId = randomUUID();
  otherParentId = randomUUID();
  const account = randomUUID();
  await owner.$executeRawUnsafe(
    `insert into chat.account (id, subject, kind, status)
     values ('${account}'::uuid, 'subject_${otherParentId}', 'family', 'active')`,
  );
  await owner.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${otherFamilyId}'::uuid, 'family_zeta', '${s.otherAdminId}'::uuid, 'ar')`,
  );
  await owner.$executeRawUnsafe(
    `insert into chat.contact (id, account_id, family_id, name, role_preset, can_message,
                               can_view_progress, can_manage_schedule, can_manage_billing,
                               can_manage_contacts, can_cancel, is_active)
     values ('${otherParentId}'::uuid, '${account}'::uuid, '${otherFamilyId}'::uuid,
             'parent_z', 'primary_guardian', true, true, true, true, true, true, true)`,
  );

  myConversationId = (
    await asActor(s.ownerId, () => g.conversations.getOrCreateDirect(s.ownerId, s.parentId))
  ).id;
  otherConversationId = (
    await asActor(s.otherAdminId, () =>
      g.conversations.getOrCreateDirect(s.otherAdminId, otherParentId),
    )
  ).id;
});

afterAll(async () => {
  await connection.$disconnect();
  await owner.$disconnect();
});

// -------------------------------------------------------------------------
describe('the connection is least-privileged', () => {
  it('is not the owner, is not a superuser, and cannot bypass RLS', async () => {
    const [report] = await app.$queryRawUnsafe<
      Array<{
        role_name: string;
        is_superuser: boolean;
        bypasses_rls: boolean;
        owns_schema: boolean;
        can_create_in_schema: boolean;
      }>
    >(`select * from chat.runtime_role_report()`);

    expect(report.role_name).toBe('chat_app');
    expect(report.is_superuser).toBe(false);
    expect(report.bypasses_rls).toBe(false);
    expect(report.owns_schema).toBe(false);
    expect(report.can_create_in_schema).toBe(false);
  });

  it('cannot disable row-level security, drop a table, or create one', async () => {
    await expect(
      app.$executeRawUnsafe('alter table chat.message disable row level security'),
    ).rejects.toThrow();
    await expect(app.$executeRawUnsafe('drop table chat.message')).rejects.toThrow();
    await expect(app.$executeRawUnsafe('create table chat.smuggled (id int)')).rejects.toThrow();
  });

  it('cannot create a policy of its own', async () => {
    await expect(
      app.$executeRawUnsafe(
        `create policy everything on chat.message for select to authenticated using (true)`,
      ),
    ).rejects.toThrow();
  });

  it('holds no privilege on tables the application never touches', async () => {
    await expect(
      app.$executeRawUnsafe(`select * from chat.schema_migrations`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('the OWNER connection, by contrast, does bypass RLS -- which is the whole point', async () => {
    const [report] = await owner.$queryRawUnsafe<Array<{ bypasses_rls: boolean }>>(
      `select * from chat.runtime_role_report()`,
    );
    expect(report.bypasses_rls).toBe(true);
  });
});

// -------------------------------------------------------------------------
describe('RLS constrains the runtime connection', () => {
  it('without an actor context, the connection sees NOTHING -- it fails closed', async () => {
    // No runWithActor: this is what a query that escaped the interceptor does.
    expect(await app.conversation.count()).toBe(0);
    expect(await app.family.count()).toBe(0);
    expect(await app.message.count()).toBe(0);
  });

  it('a supervisor sees their own family and conversation', async () => {
    await asActor(s.ownerId, async () => {
      expect(await app.family.count()).toBe(1);
      expect((await app.family.findMany())[0].id).toBe(s.familyId);
      expect(await app.conversation.findUnique({ where: { id: myConversationId } })).not.toBeNull();
    });
  });

  it('and CANNOT see another supervisor\'s, even naming the id exactly', async () => {
    await asActor(s.ownerId, async () => {
      expect(await app.family.findUnique({ where: { id: otherFamilyId } })).toBeNull();
      expect(
        await app.conversation.findUnique({ where: { id: otherConversationId } }),
      ).toBeNull();
      expect(await app.message.count({ where: { conversationId: otherConversationId } })).toBe(0);
    });
  });

  it('a family contact sees their own conversation and no other family\'s', async () => {
    await asActor(s.parentId, async () => {
      expect(await app.conversation.findUnique({ where: { id: myConversationId } })).not.toBeNull();
      expect(await app.conversation.findUnique({ where: { id: otherConversationId } })).toBeNull();
    });
  });

  it('a manager sees the organization', async () => {
    await asActor(s.managerId, async () => {
      expect(await app.family.count()).toBe(2);
    });
  });

  it('the identity tables are unreachable through the `authenticated` role', async () => {
    // chat_app holds them in its own right, because authenticating is what
    // establishes the identity every other policy depends on. `authenticated`
    // -- the role a direct-to-database client would adopt -- holds nothing.
    const [row] = await owner.$queryRawUnsafe<Array<{ ok: boolean }>>(
      `select has_table_privilege('authenticated', 'chat.account_credential', 'select') as ok`,
    );
    expect(row.ok).toBe(false);
  });
});

// -------------------------------------------------------------------------
describe('the application still works through the least-privileged role', () => {
  it('sends and reads a message end to end', async () => {
    g.coverage.onDutyId = s.ownerId;
    const sent = await asActor(s.ownerId, () =>
      g.messages.send({
        conversationId: myConversationId,
        senderId: s.ownerId,
        body: 'through chat_app',
      }),
    );
    expect(sent.id).toBeTruthy();

    const read = await asActor(s.parentId, () =>
      g.messages.list({ conversationId: myConversationId, actorId: s.parentId }),
    );
    expect(read.messages.map((m) => m.body)).toContain('through chat_app');
  });

  it('writes the receipts, the outbox row and the audit trail that send depends on', async () => {
    g.coverage.onDutyId = s.ownerId;
    const sent = await asActor(s.ownerId, () =>
      g.messages.send({
        conversationId: myConversationId,
        senderId: s.ownerId,
        body: 'with its side effects',
      }),
    );

    expect(await owner.messageReceipt.count({ where: { messageId: sent.id } })).toBeGreaterThan(0);
    expect(await owner.outboxEvent.count()).toBeGreaterThan(0);
  });

  it('lists conversations, scoped, without the service filtering afterwards', async () => {
    const mine = await asActor(s.ownerId, () => g.conversations.listForActor(s.ownerId));
    expect(mine.map((c) => c.id)).toEqual([myConversationId]);
  });

  it('refuses an out-of-scope send with the service\'s own error, not a database one', async () => {
    // The service still decides. RLS never had to intervene here, which is
    // exactly the intended division of labour.
    await expect(
      asActor(s.ownerId, () =>
        g.messages.send({
          conversationId: otherConversationId,
          senderId: s.ownerId,
          body: 'reaching across',
        }),
      ),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });
  });

  it('registers a device token and marks a notification, both scoped to the actor', async () => {
    await asActor(s.parentId, () =>
      g.notifications.registerDevice({
        actorId: s.parentId,
        token: `token-${randomUUID()}`,
        platform: 'ios',
      }),
    );
    expect(await owner.deviceToken.count({ where: { actorId: s.parentId } })).toBeGreaterThan(0);
  });

  it('reassigns a family, and the previous supervisor immediately sees nothing', async () => {
    const manager = await asActor(s.managerId, () => actorOf(s.managerId));
    await asActor(s.managerId, () =>
      g.families.assignSupervisor(manager, s.familyId, s.otherAdminId, 'the family moved'),
    );

    await asActor(s.ownerId, async () => {
      expect(await app.family.findUnique({ where: { id: s.familyId } })).toBeNull();
    });
    await asActor(s.otherAdminId, async () => {
      expect(await app.family.findUnique({ where: { id: s.familyId } })).not.toBeNull();
    });
  });
});
