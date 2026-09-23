/**
 * QA (AI #5) — integration tests against the real migrated database.
 *
 * Environment: scripts/db/integration-db.sh reset
 * Plain postgres:17 with the full composed migration set. See
 * docs/release/branch-reconciliation.md for why composition is currently needed.
 *
 * Uses `docker exec psql` rather than a driver so the suite adds no npm
 * dependency to another agent's package and tests the database exactly as the
 * migrations define it.
 */
import { execFileSync } from 'node:child_process';

const CONTAINER = process.env.JAWWID_INT_CONTAINER ?? 'jawwid-chat-int';
const DB = process.env.JAWWID_INT_DB ?? 'jawwid_chat_int';

/**
 * Local runs talk to the Docker container; CI talks to a Postgres service
 * container over DATABASE_URL. Set JAWWID_PSQL to override entirely.
 */
function psqlArgv(statement: string): [string, string[]] {
  const flags = ['-q', '-v', 'ON_ERROR_STOP=1', '-tAc', statement];
  if (process.env.DATABASE_URL) return ['psql', [process.env.DATABASE_URL, ...flags]];
  return ['docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DB, ...flags]];
}

/** Runs SQL. Returns stdout on success; throws with the postgres error on failure. */
function sql(statement: string): string {
  const [cmd, args] = psqlArgv(statement);
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/** Returns the postgres error message, or null if the statement unexpectedly succeeded. */
function expectRejected(statement: string): string | null {
  try {
    sql(statement);
    return null;
  } catch (e) {
    const err = e as { stderr?: Buffer | string };
    return String(err.stderr ?? e);
  }
}

const uuid = () => sql('select gen_random_uuid()');

function addMember(conversationId: string, actorKind: string, memberRole: string): void {
  sql(
    `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
     values ('${conversationId}', '${actorKind}', gen_random_uuid(), '${memberRole}')`,
  );
}

/**
 * A real family to scope conversations to.
 *
 * OD-01 added chat.assert_conversation_family_scope(): any conversation holding
 * a live family contact must be family-scoped, to that contact's family (PRD §6,
 * product decision C-2). These fixtures previously left family_id null and
 * added a contact member anyway, which is now -- correctly -- rejected. Giving
 * them a real family makes the fixture well-formed; every assertion below is
 * unchanged.
 */
let FAMILY_ID = '';
/** PD-6: a real chain, for the AUTHORIZED half of the backstop assertions. */
let TEACHER_ID = '';
let PARENT_ID = '';

beforeAll(() => {
  // Fails fast with a clear message if the environment is not up.
  sql('select 1 from chat.conversation limit 1');
  const staffId = sql(
    `insert into chat.staff (name, role) values ('Integration Owner', 'admin') returning id`,
  );
  FAMILY_ID = sql(
    `insert into chat.family (display_name, owner_id)
     values ('Integration Family', '${staffId}') returning id`,
  );

  // PD-6 made the backstop depend on contact -> family -> learner -> teacher,
  // so the permitted case needs real rows. The REFUSED cases keep using
  // gen_random_uuid(), which is exactly an actor with no relationship.
  TEACHER_ID = sql(
    `insert into chat.teacher (name) values ('integration_teacher') returning id`,
  );
  PARENT_ID = sql(
    `insert into chat.contact (family_id, name, role_preset, can_message,
                               can_view_progress, can_manage_schedule,
                               can_manage_billing, can_manage_contacts, can_cancel)
     values ('${FAMILY_ID}', 'integration_parent', 'primary_guardian',
             true, true, true, true, true, true) returning id`,
  );
  sql(
    `insert into chat.learner (family_id, name, teacher_id)
     values ('${FAMILY_ID}', 'integration_learner', '${TEACHER_ID}')`,
  );
});

describe('BR-1 database backstop (PD-6)', () => {
  it('rejects a teacher and an UNAUTHORIZED family contact in a DIRECT conversation', () => {
    // Re-versioned 2026-09-23. PD-6 changed WHICH pair the database refuses,
    // not whether it refuses one with the application bypassed.
    const id = sql(
      `insert into chat.conversation (type, state, direct_key, family_id)
       values ('direct', 'open', gen_random_uuid()::text, '${FAMILY_ID}') returning id`,
    );
    addMember(id, 'teacher', 'teacher');
    const err = expectRejected(
      `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
       values ('${id}', 'contact', gen_random_uuid(), 'parent')`,
    );
    expect(err).toContain('PD-6 violation');
  });

  it('PERMITS a teacher and an AUTHORIZED family contact in a DIRECT conversation', () => {
    // The positive control for the assertion above. Without it, that test would
    // still pass against a database that refused every teacher/contact direct
    // pairing -- which is the behaviour PD-6 removed.
    const id = sql(
      `insert into chat.conversation (type, state, direct_key, family_id)
       values ('direct', 'open', gen_random_uuid()::text, '${FAMILY_ID}') returning id`,
    );
    sql(
      `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
       values ('${id}', 'teacher', '${TEACHER_ID}', 'teacher')`,
    );
    expect(
      expectRejected(
        `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
         values ('${id}', 'contact', '${PARENT_ID}', 'parent')`,
      ),
    ).toBeNull();
  });

  it('refuses the same authorized pair once the learner link is reassigned', () => {
    // The relationship, not the identities, is what the database is checking.
    const otherTeacher = sql(
      `insert into chat.teacher (name) values ('integration_teacher_other') returning id`,
    );
    sql(`update chat.learner set teacher_id = '${otherTeacher}' where family_id = '${FAMILY_ID}'`);

    const id = sql(
      `insert into chat.conversation (type, state, direct_key, family_id)
       values ('direct', 'open', gen_random_uuid()::text, '${FAMILY_ID}') returning id`,
    );
    sql(
      `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
       values ('${id}', 'teacher', '${TEACHER_ID}', 'teacher')`,
    );
    const err = expectRejected(
      `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
       values ('${id}', 'contact', '${PARENT_ID}', 'parent')`,
    );
    expect(err).toContain('PD-6 violation');

    sql(`update chat.learner set teacher_id = '${TEACHER_ID}' where family_id = '${FAMILY_ID}'`);
  });

  it('allows a teacher and a parent to share a GROUP conversation, with an admin present', () => {
    // The admin member is REQUIRED, not decoration. Red-team RT-025 showed that
    // a two-party teacher+parent group with no admin is a private
    // teacher<->parent channel wearing a group's name, which BR-1 forbids:
    // "only through the official Student Group, with the required admin
    // presence". 20260905093300 now enforces that, so this fixture asserts the
    // legitimate shape rather than the one the finding was about.
    const id = sql(
      `insert into chat.conversation (type, state, family_id)
       values ('class_group','open','${FAMILY_ID}') returning id`,
    );
    addMember(id, 'teacher', 'teacher');
    addMember(id, 'staff', 'admin');
    addMember(id, 'contact', 'parent');
    expect(sql(`select count(*) from chat.conversation_member where conversation_id='${id}' and left_at is null`)).toBe('3');
  });

  it('RT-025: the same group WITHOUT an admin is rejected', () => {
    const id = sql(
      `insert into chat.conversation (type, state, family_id)
       values ('class_group','open','${FAMILY_ID}') returning id`,
    );
    addMember(id, 'teacher', 'teacher');
    const err = expectRejected(
      `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
       values ('${id}', 'contact', gen_random_uuid(), 'parent')`,
    );
    expect(err).toContain('BR-1 violation');
  });

  /**
   * JC-008 / red-team RT-024 — the backstop guarded only one of the invariant's
   * two inputs.
   *
   * conversation_member_br1 fires on conversation_member. Nothing guarded
   * chat.conversation.type, so a legal group containing a teacher and a parent
   * could be converted into a forbidden 1:1 with a plain UPDATE. Fixed by
   * 20260905093300, which freezes `type` and re-checks the invariant from both
   * tables with deferred constraint triggers.
   *
   * The group now carries its required admin, so this is the real attack: a
   * fully legitimate Student Group being promoted, not an already-invalid one.
   *
   * Maps to test-plan BR1-10.
   */
  it('JC-008 / RT-024: converting a teacher+parent GROUP into a DIRECT conversation must be rejected', () => {
    const id = sql(
      `insert into chat.conversation (type, state, family_id)
       values ('class_group','open','${FAMILY_ID}') returning id`,
    );
    addMember(id, 'teacher', 'teacher');
    addMember(id, 'staff', 'admin');
    addMember(id, 'contact', 'parent');

    const err = expectRejected(
      `update chat.conversation set type='direct', direct_key=gen_random_uuid()::text where id='${id}'`,
    );

    expect(err).toMatch(/BR-1 violation|type is immutable/);
  });
});

describe('append-only and immutability guarantees', () => {
  // A FOR EACH ROW trigger only fires when a row actually matches, so each of
  // these inserts a real row first. An earlier draft used `where false` and
  // passed vacuously -- which is the failure mode this comment exists to stop.

  it('chat.event_log rows cannot be updated', () => {
    sql(`insert into chat.event_log (actor_type, type, payload)
         values ('system', 'message_sent', '{}')`);
    const err = expectRejected(
      `update chat.event_log set type='message_received'
        where id = (select max(id) from chat.event_log)`,
    );
    expect(err).toBeTruthy();
  });

  it('chat.event_log rows cannot be deleted', () => {
    sql(`insert into chat.event_log (actor_type, type, payload)
         values ('system', 'message_sent', '{}')`);
    const err = expectRejected(
      `delete from chat.event_log where id = (select max(id) from chat.event_log)`,
    );
    expect(err).toBeTruthy();
  });

  it('chat.audit_log rows cannot be updated', () => {
    sql(`insert into chat.audit_log (action, entity, reason)
         values ('ownership_transferred', 'family', 'integration test')`);
    const err = expectRejected(
      `update chat.audit_log set reason='tampered'
        where id = (select max(id) from chat.audit_log)`,
    );
    expect(err).toBeTruthy();
  });

  it('chat.message carries an immutability trigger', () => {
    // Weaker than an end-to-end rewrite attempt, which needs the full
    // staff -> family -> thread -> conversation fixture chain. Named honestly:
    // this asserts the guard is installed, not that a rewrite was attempted.
    const triggers = sql(
      `select string_agg(tgname, ',' order by tgname) from pg_trigger
        where tgrelid = 'chat.message'::regclass and not tgisinternal`,
    );
    // The blanket message_is_immutable trigger was deliberately narrowed to
    // message_no_rewrite by 20260905093000_chat_communication.
    //
    // PRD v0.1 gives a message two lawful state changes after sending -- an
    // approval decision (pending -> published/rejected) and a soft delete --
    // and a total UPDATE ban makes both impossible. The narrower trigger still
    // forbids what actually matters: body, author, conversation and seq cannot
    // be rewritten once the message exists. The two assertions below prove the
    // protection was narrowed rather than removed.
    expect(triggers).toContain('message_no_rewrite');
  });

  it('chat.message body still cannot be rewritten', () => {
    const conv = sql(
      `insert into chat.conversation (type, state, direct_key)
       values ('direct','open', gen_random_uuid()::text) returning id`,
    );
    const msg = sql(
      // System-authored: chat.assert_message_author_exists() requires a real
      // contact/staff row for those author types, and this test is about
      // immutability, not authorship.
      `insert into chat.message (conversation_id, author_type, body, visibility, seq, type)
       values ('${conv}', 'system', 'original', 'customer', 1, 'text') returning id`,
    );
    expect(expectRejected(`update chat.message set body='tampered' where id='${msg}'`))
      .toContain('immutable');
  });

  it('chat.message moderation may still be decided', () => {
    const conv = sql(
      `insert into chat.conversation (type, state, direct_key)
       values ('direct','open', gen_random_uuid()::text) returning id`,
    );
    const msg = sql(
      `insert into chat.message (conversation_id, author_type, body, visibility, seq, type, moderation)
       values ('${conv}', 'system', 'held', 'customer', 1, 'text', 'pending') returning id`,
    );
    sql(`update chat.message set moderation='published' where id='${msg}'`);
    expect(sql(`select moderation from chat.message where id='${msg}'`)).toBe('published');
  });
});

describe('JC-010 — duplicate event_log definitions', () => {
  it('exactly one actor column exists, and it is not both', () => {
    const cols = sql(
      `select string_agg(column_name, ',' order by column_name)
         from information_schema.columns
        where table_schema='chat' and table_name='event_log'
          and column_name in ('actor_type','actor_kind')`,
    );
    // Documents which lineage won. AI #2's shared-logs migration writes
    // actor_kind; AI #1's applies first and defines actor_type, and the
    // `create table if not exists` makes the second definition a silent no-op.
    expect(cols).toBe('actor_type');
  });

  it('an AI #2-shaped insert (actor_kind) fails against the applied schema', () => {
    const err = expectRejected(
      `insert into chat.event_log (type, actor_kind, payload) values ('message_sent','staff','{}')`,
    );
    expect(err).toContain('actor_kind');
  });
});
