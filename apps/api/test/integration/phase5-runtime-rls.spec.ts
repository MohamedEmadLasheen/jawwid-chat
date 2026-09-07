/**
 * PHASE 5 UNDER THE LEAST-PRIVILEGED RUNTIME ROLE.
 *
 * Every other Phase 5 suite runs as the database OWNER, which bypasses RLS --
 * so those suites prove the SERVICE layer and say nothing about the second one.
 * This suite connects as `chat_app`: NOBYPASSRLS, owns nothing, and is the role
 * a correctly deployed API connects as.
 *
 * Phase 5 adds four tables carrying the most sensitive data in the product --
 * recordings of people's voices, and the resolved audiences that together form
 * a directory of the academy's customers. A privilege expansion has to be
 * proved in both directions, so this asserts that the application still WORKS
 * through the role, and that the policies actually CONSTRAIN with the service
 * layer removed from the picture.
 */
import { PrismaService, withRequestScopedTransaction } from '@platform/prisma.service';
import { buildGraphOn, seed, truncate, Scenario, appDatabaseUrl } from './harness';
import { AudienceKind, CallMode } from '@communication/contracts/vocab';

const owner = new PrismaService();
const connection = new PrismaService({ datasources: { db: { url: appDatabaseUrl() } } });
const app = withRequestScopedTransaction(connection);
const g = buildGraphOn(app);

/**
 * The worker's graph, on an RLS-BYPASSING connection.
 *
 * This is not a convenience for the test -- it is the deployed topology. The
 * API connects as `chat_app` (NOBYPASSRLS) and every request carries an actor
 * the policies resolve. The worker has NO actor: it is draining a queue on
 * behalf of nobody, and there is no honest way to give it one. So it connects
 * as `chat_service`, which bypasses RLS by design
 * (infra/env/manifest.tsv, RLS-STRATEGY.md 6).
 *
 * Running the fan-out through `chat_app` here would pass only if the Phase 5
 * policies had a hole shaped exactly like a worker -- so this suite deliberately
 * proves the opposite below.
 */
const service = buildGraphOn(owner);

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

beforeEach(async () => {
  await truncate(owner);
  s = await seed(owner);
  g.coverage.onDutyId = s.ownerId;
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'test-secret-at-least-32-characters-long';
});
afterAll(async () => {
  await truncate(owner);
  await Promise.all([owner.$disconnect(), connection.$disconnect()]);
});

describe('the Phase 5 product works through chat_app', () => {
  it('a supervisor runs a recorded follow-up call end to end', async () => {
    // Least privilege that takes the product down is not a security
    // improvement, so the happy path is asserted first.
    const conv = await asActor(s.ownerId, () =>
      g.conversations.getOrCreateDirect(s.ownerId, s.parentId),
    );
    const started = await asActor(s.ownerId, () =>
      g.calls.start(conv.id, s.ownerId, { mode: CallMode.FOLLOW_UP }),
    );
    await asActor(s.parentId, () => g.calls.accept(started.callId, s.parentId));
    const { recording } = await asActor(s.ownerId, () =>
      g.recordings.start(started.callId, s.ownerId),
    );
    await asActor(s.ownerId, () =>
      g.recordings.complete(started.callId, {
        durationSeconds: 10,
        byteSize: 512,
        actorId: s.ownerId,
      }),
    );
    const playback = await asActor(s.ownerId, () =>
      g.recordings.playback(recording.id, s.ownerId),
    );
    expect(playback.url).toContain('sig=');
  });

  it('a manager publishes a story and its audience reads it', async () => {
    const story = await asActor(s.managerId, () =>
      g.stories.create(s.managerId, {
        title: 'Eid',
        body: 'Closed Monday.',
        audiences: [{ kind: AudienceKind.ALL_FAMILIES }],
      }),
    );
    await asActor(s.managerId, () => g.stories.publish(story.id, s.managerId));

    const feed = await asActor(s.parentId, () => g.stories.feed(s.parentId));
    expect(feed.map((x) => x.id)).toContain(story.id);
  });

  it('a manager creates and delivers a broadcast', async () => {
    await asActor(s.ownerId, () => g.conversations.getOrCreateDirect(s.ownerId, s.parentId));
    const b = await asActor(s.managerId, () =>
      g.broadcasts.create(s.managerId, {
        body: 'Closed Monday.',
        audiences: [{ kind: AudienceKind.FAMILY, refId: s.familyId }],
      }),
    );
    await asActor(s.managerId, () => g.broadcasts.queue(b.id, s.managerId));
    // Delivered by the WORKER's connection, as it is in a deployment.
    await service.broadcastWorker.drain();

    const status = await asActor(s.managerId, () => g.broadcasts.status(b.id, s.managerId));
    expect(status.sentCount).toBeGreaterThan(0);
  });

  it('the fan-out is a chat_service path, and does NOT work as chat_app', async () => {
    // The negative half of the statement above. If this ever starts passing,
    // some policy has grown a clause that admits an actor-less caller -- which
    // is a hole shaped exactly like the worker, reachable by anything else that
    // manages to have no actor.
    await asActor(s.ownerId, () => g.conversations.getOrCreateDirect(s.ownerId, s.parentId));
    const b = await asActor(s.managerId, () =>
      g.broadcasts.create(s.managerId, {
        body: 'Closed Monday.',
        audiences: [{ kind: AudienceKind.FAMILY, refId: s.familyId }],
      }),
    );
    await asActor(s.managerId, () => g.broadcasts.queue(b.id, s.managerId));

    // `g` is the chat_app graph, drained with no actor context established.
    // It CLAIMS NOTHING rather than erroring: the claim's subquery is filtered
    // by the read policy, so an actor-less caller finds no due rows at all.
    // Failing closed and quietly is the right shape here -- the fan-out simply
    // cannot happen on this connection.
    expect(await g.broadcastWorker.drain()).toBe(0);

    const status = await asActor(s.managerId, () => g.broadcasts.status(b.id, s.managerId));
    expect(status.sentCount).toBe(0);
    expect(status.pendingCount).toBeGreaterThan(0);
  });
});

describe('the policies constrain, with the service layer removed', () => {
  /** A raw read through the runtime role, as the given actor. */
  const rawCount = (actorId: string, sql: string) =>
    asActor(actorId, async () => {
      const rows = await app.$queryRawUnsafe<Array<{ n: bigint }>>(sql);
      return Number(rows[0]?.n ?? 0);
    });

  it('a parent cannot read a recording row, even of their own call', async () => {
    const conv = await asActor(s.ownerId, () =>
      g.conversations.getOrCreateDirect(s.ownerId, s.parentId),
    );
    const started = await asActor(s.ownerId, () =>
      g.calls.start(conv.id, s.ownerId, { mode: CallMode.FOLLOW_UP }),
    );
    await asActor(s.ownerId, () => g.recordings.start(started.callId, s.ownerId));

    // Not "forbidden" -- INVISIBLE. A parent cannot even learn that a recording
    // of their call exists by counting rows.
    expect(await rawCount(s.parentId, 'select count(*)::bigint as n from chat.call_recording')).toBe(0);
    // The authorized supervisor sees it.
    expect(await rawCount(s.ownerId, 'select count(*)::bigint as n from chat.call_recording')).toBe(1);
  });

  it('a teacher cannot read a recording row', async () => {
    const conv = await asActor(s.ownerId, () =>
      g.conversations.getOrCreateDirect(s.ownerId, s.parentId),
    );
    const started = await asActor(s.ownerId, () =>
      g.calls.start(conv.id, s.ownerId, { mode: CallMode.FOLLOW_UP }),
    );
    await asActor(s.ownerId, () => g.recordings.start(started.callId, s.ownerId));

    expect(await rawCount(s.teacherId, 'select count(*)::bigint as n from chat.call_recording')).toBe(0);
  });

  it('a parent sees only the stories they are a recipient of', async () => {
    const forParent = await asActor(s.managerId, () =>
      g.stories.create(s.managerId, {
        body: 'For this parent.',
        audiences: [{ kind: AudienceKind.USER, refId: s.parentId }],
      }),
    );
    await asActor(s.managerId, () => g.stories.publish(forParent.id, s.managerId));

    const forTeachers = await asActor(s.managerId, () =>
      g.stories.create(s.managerId, {
        body: 'For teachers.',
        audiences: [{ kind: AudienceKind.ALL_TEACHERS }],
      }),
    );
    await asActor(s.managerId, () => g.stories.publish(forTeachers.id, s.managerId));

    // Two published stories exist; this parent may see exactly one of them, and
    // the filtering is the POLICY, not a WHERE clause a client could drop.
    expect(await rawCount(s.parentId, 'select count(*)::bigint as n from chat.story')).toBe(1);
  });

  it('a parent cannot enumerate how the academy segments its customers', async () => {
    const story = await asActor(s.managerId, () =>
      g.stories.create(s.managerId, {
        body: 'Anything.',
        audiences: [{ kind: AudienceKind.ALL_FAMILIES }],
      }),
    );
    await asActor(s.managerId, () => g.stories.publish(story.id, s.managerId));

    // The authored intent names labels, groups and families.
    expect(await rawCount(s.parentId, 'select count(*)::bigint as n from chat.story_audience')).toBe(0);
    // A recipient may confirm they are one, and see nobody else's row.
    expect(
      await rawCount(s.parentId, 'select count(*)::bigint as n from chat.story_recipient'),
    ).toBe(1);
  });

  it('a broadcast and its recipient ledger are invisible to a parent', async () => {
    await asActor(s.ownerId, () => g.conversations.getOrCreateDirect(s.ownerId, s.parentId));
    await asActor(s.managerId, () =>
      g.broadcasts.create(s.managerId, {
        body: 'Closed Monday.',
        audiences: [{ kind: AudienceKind.ALL_FAMILIES }],
      }),
    );

    // The ledger names every family in the audience. One row of it read by the
    // wrong person is a directory of the academy's customers.
    expect(await rawCount(s.parentId, 'select count(*)::bigint as n from chat.broadcast')).toBe(0);
    expect(
      await rawCount(s.parentId, 'select count(*)::bigint as n from chat.broadcast_recipient'),
    ).toBe(0);
    expect(await rawCount(s.managerId, 'select count(*)::bigint as n from chat.broadcast')).toBe(1);
  });

  it('an ADMIN cannot read the broadcast ledger either -- broadcasts.send gates it', async () => {
    await asActor(s.ownerId, () => g.conversations.getOrCreateDirect(s.ownerId, s.parentId));
    await asActor(s.managerId, () =>
      g.broadcasts.create(s.managerId, {
        body: 'Closed Monday.',
        audiences: [{ kind: AudienceKind.ALL_FAMILIES }],
      }),
    );
    expect(await rawCount(s.ownerId, 'select count(*)::bigint as n from chat.broadcast')).toBe(0);
  });
});
