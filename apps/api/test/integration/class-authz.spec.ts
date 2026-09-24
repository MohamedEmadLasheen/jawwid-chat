/**
 * A CLASS ID IS NOT A CREDENTIAL EITHER.
 *
 * The same rule the notification platform's deep links were held to, applied to
 * the two tables this phase adds. Both hold Core-authoritative facts, so the
 * question is not only "who may read this" but "who may assert it" -- and the
 * answer to the second is nobody with a client session.
 *
 * The attacker is a signed-in parent of another family holding real ids, which
 * is the realistic case: a learner id reaches a parent's device in every class
 * notification's push payload.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
let s: Scenario;
let coreChildId: string;

async function coreEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  await g.prisma.$executeRaw`
    insert into chat.core_event (source, external_event_id, event_type, payload,
                                occurred_at, received_at)
    values ('jawwid_core', ${randomUUID()}, ${eventType}, ${JSON.stringify(payload)}::jsonb,
            now(), now())`;
}

async function mirroredSession(): Promise<{ coreId: string; id: string }> {
  const coreId = randomUUID();
  await coreEvent('class_session.upserted', {
    core_class_session_id: coreId,
    core_child_id: coreChildId,
    starts_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
    status: 'scheduled',
  });
  await g.coreIngest.drain();
  const row = (await g.prisma.classSession.findUnique({
    where: { coreClassSessionId: coreId },
  }))!;
  return { coreId, id: row.id };
}

/** Another family entirely, with its own signed-in parent and its own child. */
async function outsider(): Promise<{ parentId: string; coreChildId: string }> {
  const familyId = randomUUID();
  const parentId = randomUUID();
  const childCoreId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${familyId}'::uuid, 'family_o', '${s.ownerId}'::uuid, 'ar')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ('${parentId}'::uuid, '${familyId}'::uuid, 'parent_o',
             'primary_guardian', true, true)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.learner (id, family_id, name, teacher_id, core_child_id)
     values ('${randomUUID()}'::uuid, '${familyId}'::uuid, 'learner_o',
             '${s.teacherId}'::uuid, '${childCoreId}'::uuid)`,
  );
  return { parentId, coreChildId: childCoreId };
}

/** Read as a given actor, with RLS actually enforced. */
async function readAs<T>(actorId: string, sql: string): Promise<T[]> {
  return g.prisma.$transaction(async (tx) => {
    // `authenticated` is the role a client session runs as; the API's own role
    // and service_role both bypass these policies by design, so asserting
    // anything about RLS means actually becoming the client.
    await tx.$executeRawUnsafe(`set local role authenticated`);
    await tx.$executeRawUnsafe(`select set_config('chat.actor_id', '${actorId}', true)`);
    return tx.$queryRawUnsafe<T[]>(sql);
  });
}

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  coreChildId = randomUUID();
  await g.prisma.$executeRaw`
    update chat.learner set core_child_id = ${coreChildId}::uuid where id = ${s.learnerId}::uuid`;
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});

// =========================================================================
describe('nobody with a client session can assert a class fact', () => {
  it('a parent cannot insert a class session', async () => {
    await expect(
      readAs(
        s.parentId,
        `insert into chat.class_session
           (core_class_session_id, learner_id, starts_at, core_synced_at)
         values (gen_random_uuid(), '${s.learnerId}'::uuid, now(), now())`,
      ),
    ).rejects.toBeDefined();
  });

  it('a parent cannot insert attendance', async () => {
    const session = await mirroredSession();
    await expect(
      readAs(
        s.parentId,
        `insert into chat.class_attendance
           (class_session_id, learner_id, outcome, core_synced_at)
         values ('${session.id}'::uuid, '${s.learnerId}'::uuid, 'class_attended', now())`,
      ),
    ).rejects.toBeDefined();
  });

  it('a parent cannot rewrite an attendance outcome', async () => {
    const session = await mirroredSession();
    await coreEvent('attendance.upserted', {
      core_class_session_id: session.coreId,
      outcome: 'class_missed',
    });
    await g.coreIngest.drain();

    await expect(
      readAs(
        s.parentId,
        `update chat.class_attendance set outcome = 'class_attended'`,
      ),
    ).rejects.toBeDefined();

    // Unchanged. Core said missed, and only Core can say otherwise.
    expect((await g.prisma.classAttendance.findFirst())!.outcome).toBe('class_missed');
  });

  it('a staff member cannot either -- the grant is the boundary, not the role',
    async () => {
      await expect(
        readAs(
          s.ownerId,
          `insert into chat.class_session
             (core_class_session_id, learner_id, starts_at, core_synced_at)
           values (gen_random_uuid(), '${s.learnerId}'::uuid, now(), now())`,
        ),
      ).rejects.toBeDefined();
    });
});

// =========================================================================
describe('reads do not cross a family', () => {
  it('a parent sees their own child’s sessions', async () => {
    await mirroredSession();

    const rows = await readAs<{ id: string }>(
      s.parentId,
      `select id from chat.class_session`,
    );
    expect(rows).toHaveLength(1);
  });

  it('another family’s parent sees none of them', async () => {
    await mirroredSession();
    const them = await outsider();

    // The row exists and they hold a real session id; RLS answers with an
    // empty set rather than a refusal, which is the same shape "it does not
    // exist" has.
    const rows = await readAs<{ id: string }>(
      them.parentId,
      `select id from chat.class_session`,
    );
    expect(rows).toEqual([]);
  });

  it('naming the row explicitly does not help', async () => {
    const session = await mirroredSession();
    const them = await outsider();

    const rows = await readAs<{ id: string }>(
      them.parentId,
      `select id from chat.class_session where id = '${session.id}'::uuid`,
    );
    // The id from a push payload is a routing hint. It is not an argument.
    expect(rows).toEqual([]);
  });

  it('attendance is scoped the same way', async () => {
    const session = await mirroredSession();
    await coreEvent('attendance.upserted', {
      core_class_session_id: session.coreId,
      outcome: 'class_missed',
    });
    await g.coreIngest.drain();
    const them = await outsider();

    expect(
      await readAs<{ id: string }>(s.parentId, `select id from chat.class_attendance`),
    ).toHaveLength(1);
    expect(
      await readAs<{ id: string }>(them.parentId, `select id from chat.class_attendance`),
    ).toEqual([]);
  });

  it('a learner id from another family cannot pull a session into view', async () => {
    const them = await outsider();
    // Their own child's session, mirrored.
    await coreEvent('class_session.upserted', {
      core_class_session_id: randomUUID(),
      core_child_id: them.coreChildId,
      starts_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      status: 'scheduled',
    });
    await g.coreIngest.drain();

    // This family's parent, asking for everything.
    const rows = await readAs<{ learner_id: string }>(
      s.parentId,
      `select learner_id from chat.class_session`,
    );
    // They see their own child's, and nothing of the other family's.
    expect(rows.every((r) => r.learner_id === s.learnerId)).toBe(true);
  });
});
