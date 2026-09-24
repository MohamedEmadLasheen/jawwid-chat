/**
 * CORE IDENTITY IS OPAQUE TEXT, NOT A UUID.
 *
 * Jawwid Core is a Node/Express/Mongoose application on MongoDB. Its primary
 * keys are MongoDB ObjectIds -- 12 bytes, 24 hexadecimal characters -- and they
 * are not UUIDs and cannot be made into them. Every `core_*_id` in this schema
 * was nevertheless typed `uuid`, so the very first event Core sent would have
 * died on `'507f1f77bcf86cd799439011'::uuid` and every event after it would
 * have died the same way. Not intermittently: deterministically, under the
 * family, teacher, subscription, class-session and attendance ingests alike.
 *
 * 20260924110000 converts those six columns to `text`. These tests hold the
 * line the conversion draws:
 *
 *   Chat-owned identity          -> uuid   (unchanged)
 *   Core-owned external identity -> text   (opaque; Chat asserts no format)
 *
 * The first test is the one that matters -- a real ObjectId travelling the real
 * boundary to a real notification. The rest stop the `uuid` assumption from
 * creeping back in through a new column, a new cast, or a well-meaning
 * "validation" that decides an external identifier ought to look a certain way.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { NotificationType } from '@communication/contracts/notifications';

const g = buildGraph();
let s: Scenario;

/**
 * A MongoDB ObjectId, shaped exactly as Core's ObjectId#toString() renders one:
 * 24 lowercase hex characters. Deliberately NOT a uuid -- that is the point.
 *
 * The first character is always a letter, so `toUpperCase()` is guaranteed to
 * differ from the original. An all-digit id would upper-case to itself and the
 * case-sensitivity test below would collide with its own first insert rather
 * than proving anything.
 */
function objectId(): string {
  const hex = '0123456789abcdef';
  let out = 'abcdef'[Math.floor(Math.random() * 6)];
  for (let i = 1; i < 24; i += 1) out += hex[Math.floor(Math.random() * 16)];
  return out;
}

let coreChildId: string;

const drainOutbox = () => g.outboxWorker.drain(200);

async function coreEvent(
  eventType: string,
  payload: Record<string, unknown>,
  occurredAt = new Date(),
): Promise<void> {
  await g.prisma.$executeRaw`
    insert into chat.core_event (source, external_event_id, event_type, payload,
                                occurred_at, received_at)
    values ('jawwid_core', ${randomUUID()}, ${eventType}, ${JSON.stringify(payload)}::jsonb,
            ${occurredAt}::timestamptz, now())`;
}

beforeEach(async () => {
  await truncate(g.prisma);
  // chat.core_parent_inbox is not in the harness truncate list -- it holds
  // parents waiting for a manager, which no other suite writes. This one does,
  // so it clears up after itself rather than leaking state into a later run.
  await g.prisma.$executeRawUnsafe('truncate chat.core_parent_inbox');
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;

  // The learner as Core knows them -- by ObjectId, not by uuid. Note there is
  // no ::uuid cast here, and there cannot be one any more.
  coreChildId = objectId();
  await g.prisma.$executeRaw`
    update chat.learner set core_child_id = ${coreChildId} where id = ${s.learnerId}::uuid`;
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});

// =========================================================================
describe('a MongoDB ObjectId travels the whole boundary', () => {
  it('mirrors an occurrence and notifies the parent of a missed class', async () => {
    const coreSessionId = objectId();

    await coreEvent(
      'class_session.upserted',
      {
        core_class_session_id: coreSessionId,
        core_child_id: coreChildId,
        starts_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
        ends_at: new Date(Date.now() + 48 * 3600_000 + 3600_000).toISOString(),
        status: 'scheduled',
      },
      new Date(Date.now() - 60_000),
    );
    expect(await g.coreIngest.drain()).toBe(1);
    await drainOutbox();

    const session = await g.prisma.classSession.findUnique({
      where: { coreClassSessionId: coreSessionId },
    });
    // The occurrence exists, and it is keyed by the ObjectId Core sent --
    // stored verbatim, not reformatted into anything.
    expect(session).not.toBeNull();
    expect(session!.coreClassSessionId).toBe(coreSessionId);
    expect(session!.learnerId).toBe(s.learnerId);

    await coreEvent('attendance.upserted', {
      core_class_session_id: coreSessionId,
      outcome: 'class_missed',
    });
    expect(await g.coreIngest.drain()).toBe(1);
    await drainOutbox();

    // The whole point: a real Core identifier produces a real notification
    // through the frozen platform, with nothing translated in between.
    const rows = await g.prisma.notification.findMany({
      where: { recipientId: s.parentId, type: NotificationType.CLASS_MISSED },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].learnerId).toBe(s.learnerId);
  });

  it('resolves the teacher by the Core id, which is what the payload field means', async () => {
    // Before 20260924110000 this lookup compared Chat's own primary key against
    // an identifier minted by Core -- two unrelated id spaces -- so it silently
    // matched nothing and every mirrored session came through teacher-less.
    // Under `text` that comparison is a type error, which is how it surfaced.
    const coreTeacherId = objectId();
    await g.prisma.$executeRaw`
      update chat.teacher set core_teacher_id = ${coreTeacherId} where id = ${s.teacherId}::uuid`;

    const coreSessionId = objectId();
    await coreEvent('class_session.upserted', {
      core_class_session_id: coreSessionId,
      core_child_id: coreChildId,
      core_teacher_id: coreTeacherId,
      starts_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      status: 'scheduled',
    });
    await g.coreIngest.drain();

    const session = await g.prisma.classSession.findUnique({
      where: { coreClassSessionId: coreSessionId },
    });
    expect(session!.teacherId).toBe(s.teacherId);
  });

  it('is idempotent on the ObjectId, and a different ObjectId is a different occurrence', async () => {
    const coreSessionId = objectId();
    const base = {
      core_class_session_id: coreSessionId,
      core_child_id: coreChildId,
      starts_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      status: 'scheduled',
    };

    await coreEvent('class_session.upserted', base, new Date(Date.now() - 120_000));
    await g.coreIngest.drain();
    await coreEvent('class_session.upserted', base, new Date(Date.now() - 60_000));
    await g.coreIngest.drain();

    // Redelivery updates in place. Uniqueness survived the type change: the
    // index was rebuilt by ALTER, not dropped and forgotten.
    expect(await g.prisma.classSession.count()).toBe(1);

    await coreEvent('class_session.upserted', {
      ...base,
      core_class_session_id: objectId(),
    });
    await g.coreIngest.drain();
    expect(await g.prisma.classSession.count()).toBe(2);
  });
});

// =========================================================================
describe('the schema keeps the two identity spaces apart', () => {
  it('types every Core-owned identifier as text', async () => {
    const rows = await g.prisma.$queryRaw<{ table_name: string; column_name: string; data_type: string }[]>`
      select table_name, column_name, data_type
        from information_schema.columns
       where table_schema = 'chat'
         and column_name like 'core\\_%\\_id'
       order by table_name, column_name`;

    // A regression here means someone added a Core-owned column as uuid, which
    // is the exact assumption this migration exists to remove.
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const offenders = rows.filter((r) => r.data_type !== 'text');
    expect(offenders).toEqual([]);
  });

  it('leaves Chat-owned primary keys as uuid', async () => {
    const rows = await g.prisma.$queryRaw<{ table_name: string; data_type: string }[]>`
      select table_name, data_type
        from information_schema.columns
       where table_schema = 'chat'
         and column_name = 'id'
         and table_name in ('family', 'learner', 'teacher', 'class_session',
                            'class_attendance', 'contact', 'staff')
       order by table_name`;

    expect(rows.length).toBe(7);
    // The distinction is the design, not an accident of history: Chat mints
    // these, so Chat gets to say what they look like.
    expect(rows.filter((r) => r.data_type !== 'uuid')).toEqual([]);
  });

  it('casts no Core identifier to uuid in any ingest function', async () => {
    const rows = await g.prisma.$queryRaw<{ proname: string; def: string }[]>`
      select p.proname, pg_get_functiondef(p.oid) as def
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'chat'
         and p.proname in ('ingest_core_parent', 'ingest_core_learner',
                           'ingest_core_subscription', 'ingest_core_class_session',
                           'cancel_core_class_session', 'ingest_core_attendance',
                           'assign_family_owner')`;

    expect(rows).toHaveLength(7);
    // Catches the cast wherever it hides: `(p_payload ->> 'core_child_id')::uuid`.
    const bad = rows.filter((r) => /'core_[a-z_]*_id'\s*\)\s*::\s*uuid/i.test(r.def));
    expect(bad.map((r) => r.proname)).toEqual([]);
  });

  it('declares assign_family_owner with a text Core id and no uuid overload', async () => {
    const rows = await g.prisma.$queryRaw<{ args: string }[]>`
      select pg_get_function_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'chat' and p.proname = 'assign_family_owner'`;

    // Exactly one. A `create or replace` with a changed parameter type would
    // have left the uuid version callable beside the text one.
    expect(rows).toHaveLength(1);
    expect(rows[0].args).toMatch(/p_core_parent_id text/);
  });
});

// =========================================================================
describe('what text cost, and what it must not cost', () => {
  it('still refuses a blank Core identifier, which the uuid type used to do for free', async () => {
    // `''::uuid` raised. `''::text` does not, so the fail-closed behaviour had
    // to be rebuilt deliberately -- otherwise a blank string becomes a valid
    // key and every blank-id event collides on one row.
    await expect(
      g.prisma.$executeRaw`select chat.ingest_core_class_session(
        jsonb_build_object('core_class_session_id', '   ',
                           'core_child_id', ${coreChildId},
                           'starts_at', now()::text),
        now())`,
    ).rejects.toThrow(/core_class_session_id is required/);
  });

  it('refuses a blank Core identifier at the table too', async () => {
    await expect(
      g.prisma.$executeRaw`insert into chat.core_parent_inbox (core_parent_id) values ('  ')`,
    ).rejects.toThrow(/not_blank/);
  });

  it('treats identifiers differing only in case as distinct, which uuid did not', async () => {
    // Recorded as a deliberate consequence rather than discovered later. uuid
    // comparison canonicalised case; text comparison is exact. Core emits
    // ObjectId#toString(), always lowercase hex, so this cannot bite in
    // practice -- but Chat does not normalise, because normalising an opaque
    // external identifier is the reinterpretation the migration exists to stop.
    // Generated, not a fixed literal: chat.core_parent_inbox is outside the
    // harness truncate list, so a hardcoded id survives the run that wrote it
    // and collides with itself the next time the suite executes.
    const lower = objectId();
    const upper = lower.toUpperCase();

    await g.prisma.$executeRaw`
      insert into chat.core_parent_inbox (core_parent_id, display_name)
      values (${lower}, 'lower'), (${upper}, 'upper')`;

    const rows = await g.prisma.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from chat.core_parent_inbox
       where core_parent_id in (${lower}, ${upper})`;
    expect(Number(rows[0].n)).toBe(2);
  });
});
