import { PrismaService } from '@platform/prisma.service';
import { assertWorkerRuntimeRole, type RuntimeRoleReport } from '@platform/auth/startup';
import { appDatabaseUrl } from './harness';

/**
 * C-1/C-2 against a real database: the roles the two processes actually get.
 *
 * Runtime Verification #1 proved the defect here rather than in theory -- a
 * worker on chat_app drained two outbox events, routed both to an empty
 * audience, marked both `published` and delivered neither, with no error. The
 * last test in this file is that fixture, reduced to the reads that decided it.
 *
 * Run against a PRIVATE database. Both runtime roles need a LOGIN, which
 * scripts/db/integration-db.sh grants.
 */

/** chat_service, the worker's role. Mirrors harness.appDatabaseUrl(). */
function serviceDatabaseUrl(): string {
  return (
    process.env.DATABASE_SERVICE_URL ??
    'postgres://chat_service:chat_service@localhost:55433/jawwid_chat_int'
  );
}

/** Exactly what platform.module.ts builds, for each role. */
const apiConnection = new PrismaService({ datasources: { db: { url: appDatabaseUrl() } } });
const workerConnection = new PrismaService({
  datasources: { db: { url: serviceDatabaseUrl() } },
});

const roleOf = async (c: PrismaService): Promise<RuntimeRoleReport> => {
  const [row] = await c.$queryRaw<RuntimeRoleReport[]>`select * from chat.runtime_role_report()`;
  return row;
};

afterAll(async () => {
  await apiConnection.$disconnect();
  await workerConnection.$disconnect();
});

describe('the two processes get the two roles', () => {
  // Test 1.
  it('the API connection is chat_app and RLS applies to it', async () => {
    const role = await roleOf(apiConnection);
    expect(role.role_name).toBe('chat_app');
    expect(role.bypasses_rls).toBe(false);
    expect(role.is_superuser).toBe(false);
    expect(role.owns_schema).toBe(false);
  });

  // Test 2.
  it('the worker connection is chat_service and bypasses RLS', async () => {
    const role = await roleOf(workerConnection);
    expect(role.role_name).toBe('chat_service');
    expect(role.bypasses_rls).toBe(true);
    // BYPASSRLS is all it needs; it is still not the owner and still not a
    // superuser. "The worker bypasses RLS" is not licence to run as postgres.
    expect(role.is_superuser).toBe(false);
    expect(role.owns_schema).toBe(false);
  });

  it('C-2 accepts the worker connection and rejects the API one', async () => {
    await expect(roleOf(workerConnection).then(assertWorkerRuntimeRole)).resolves.toBeUndefined();
    await expect(roleOf(apiConnection).then(assertWorkerRuntimeRole)).rejects.toThrow(
      /chat_app.*not 'chat_service'/s,
    );
  });
});

describe('the routing reads the worker was silently losing', () => {
  // Test 10. The reduced Verification #1 fixture.
  //
  // Neither connection establishes an actor context, because the worker never
  // has one -- that is the state in which chat_app sees nothing.
  it('chat_service can read conversation members; chat_app with no actor context cannot', async () => {
    const countFor = async (c: PrismaService) =>
      c.conversationMember.count({ where: { leftAt: null } });

    const asWorker = await countFor(workerConnection);
    const asApi = await countFor(apiConnection);

    // The database must actually contain something, or this test passes for
    // the wrong reason -- an empty table would make both sides zero and the
    // regression would be invisible exactly as it was in production.
    expect(asWorker).toBeGreaterThan(0);
    expect(asApi).toBe(0);
  });

  it('chat_service can read messages; chat_app with no actor context cannot', async () => {
    // messageVisibility() reads this. Under chat_app it returned null, fell
    // back to `internal`, and rerouted customer-visible events to a staff-only
    // audience that then resolved to nobody.
    const asWorker = await workerConnection.message.count();
    const asApi = await apiConnection.message.count();

    expect(asWorker).toBeGreaterThan(0);
    expect(asApi).toBe(0);
  });
});
