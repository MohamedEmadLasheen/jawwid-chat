/**
 * D-1 regression — message author validation against the canonical
 * conversation model.
 *
 * Migration: 20260906120000_chat_message_author_validation.sql
 *
 * The defect: chat.assert_message_author_exists() resolved the author's family
 * through chat.thread, which is NULL for every conversation message, so every
 * POST /messages failed with SQLSTATE 23503 and surfaced as HTTP 500.
 *
 * These tests assert the fix AND that enforcement was not weakened to get
 * sending to pass -- the negative cases outnumber the positive ones on purpose.
 *
 * Same execution style as schema-invariants.spec.ts (AI #5): psql over docker
 * exec, so no npm dependency is added to another agent's package and the
 * database is tested exactly as the migrations define it.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const CONTAINER = process.env.JAWWID_INT_CONTAINER ?? 'jawwid-chat-int';
const DB = process.env.JAWWID_INT_DB ?? 'jawwid_chat_int';

function psqlArgv(statement: string): [string, string[]] {
  const flags = ['-q', '-v', 'ON_ERROR_STOP=1', '-tAc', statement];
  if (process.env.DATABASE_URL) return ['psql', [process.env.DATABASE_URL, ...flags]];
  return ['docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DB, ...flags]];
}

function sql(statement: string): string {
  const [cmd, args] = psqlArgv(statement);
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function expectRejected(statement: string): string {
  try {
    sql(statement);
    throw new Error('STATEMENT_UNEXPECTEDLY_SUCCEEDED');
  } catch (e) {
    if (e instanceof Error && e.message === 'STATEMENT_UNEXPECTEDLY_SUCCEEDED') throw e;
    const err = e as { stderr?: Buffer | string };
    return String(err.stderr ?? e);
  }
}

// Synthetic identities only (QA gate G-20).
const ids = {
  accStaff: randomUUID(), accStaffGone: randomUUID(), accContact: randomUUID(), accOther: randomUUID(),
  staff: randomUUID(), staffGone: randomUUID(),
  family: randomUUID(), otherFamily: randomUUID(),
  contact: randomUUID(), otherContact: randomUUID(), nonMember: randomUUID(),
  teacher: randomUUID(), learner: randomUUID(),
  direct: randomUUID(), group: randomUUID(),
};

/** Inserts a message row, returning the id. Kept in one place so every test differs only in the author. */
function insertMessage(opts: {
  conversationId?: string | null;
  threadId?: string | null;
  authorType: string;
  authorId: string | null;
  body?: string;
}): string {
  const conv = opts.conversationId ? `'${opts.conversationId}'` : 'null';
  const thread = opts.threadId ? `'${opts.threadId}'` : 'null';
  const author = opts.authorId ? `'${opts.authorId}'` : 'null';
  const onBehalf = opts.authorType === 'staff' ? `'owner'` : 'null';
  return sql(`
    insert into chat.message (conversation_id, thread_id, author_type, author_id,
                              on_behalf_mode, type, body, visibility, seq)
    values (${conv}, ${thread}, '${opts.authorType}', ${author}, ${onBehalf},
            'text', '${opts.body ?? 'regression'}', 'customer', nextval_dummy())
    returning id;`);
}

beforeAll(() => {
  // A sequence stand-in: seq is per-conversation in the app, but these tests
  // only care about the author trigger, so any monotonic value will do.
  sql(`create or replace function nextval_dummy() returns bigint language sql
       as $$ select coalesce((select max(seq) from chat.message), 0) + 1 $$;`);

  sql(`
    insert into chat.account (id, subject, kind) values
      ('${ids.accStaff}',     'staff_reg@example.invalid',      'staff'),
      ('${ids.accStaffGone}', 'staff_gone_reg@example.invalid', 'staff'),
      ('${ids.accContact}',   'contact_reg@example.invalid',    'family'),
      ('${ids.accOther}',     'other_reg@example.invalid',      'family');

    insert into chat.staff (id, account_id, name, role, is_active, left_at) values
      ('${ids.staff}',     '${ids.accStaff}',     'staff_reg',      'admin', true,  null),
      ('${ids.staffGone}', '${ids.accStaffGone}', 'staff_gone_reg', 'admin', false, now());

    insert into chat.family (id, display_name, owner_id, state, language) values
      ('${ids.family}',      'family_reg',       '${ids.staff}', 'active', 'ar'),
      ('${ids.otherFamily}', 'family_other_reg', '${ids.staff}', 'active', 'ar');

    insert into chat.contact (id, family_id, account_id, name, role_preset, can_message, is_active) values
      ('${ids.contact}',      '${ids.family}',      '${ids.accContact}', 'contact_reg',    'primary_guardian', true, true),
      ('${ids.nonMember}',    '${ids.family}',      null,                'nonmember_reg',  'authorized_contact', true, true),
      ('${ids.otherContact}', '${ids.otherFamily}', '${ids.accOther}',   'othercontact_reg','primary_guardian', true, true);

    insert into chat.learner (id, family_id, name, level, teacher_id, schedule_ref,
                              next_class_at, last_attended_at, consecutive_absences, core_child_id) values
      ('${ids.learner}', '${ids.family}', 'learner_reg', 'l1', '${ids.teacher}', 'sched',
       now(), now(), 0, '${randomUUID()}');

    insert into chat.conversation (id, type, family_id, direct_key) values
      ('${ids.direct}', 'direct', '${ids.family}', 'reg-${ids.direct}');
    insert into chat.conversation (id, type, family_id, learner_id) values
      ('${ids.group}', 'student_group', '${ids.family}', '${ids.learner}');

    insert into chat.conversation_member (id, conversation_id, actor_kind, actor_id, member_role) values
      ('${randomUUID()}', '${ids.direct}', 'contact', '${ids.contact}', 'parent'),
      ('${randomUUID()}', '${ids.direct}', 'staff',   '${ids.staff}',   'admin'),
      ('${randomUUID()}', '${ids.group}',  'contact', '${ids.contact}', 'parent'),
      ('${randomUUID()}', '${ids.group}',  'staff',   '${ids.staff}',   'admin'),
      ('${randomUUID()}', '${ids.group}',  'teacher', '${ids.teacher}', 'teacher');`);
});

afterAll(() => {
  sql(`delete from chat.message where conversation_id in ('${ids.direct}','${ids.group}');
       delete from chat.conversation_member where conversation_id in ('${ids.direct}','${ids.group}');
       delete from chat.conversation where id in ('${ids.direct}','${ids.group}');
       delete from chat.learner where id = '${ids.learner}';
       delete from chat.contact where id in ('${ids.contact}','${ids.nonMember}','${ids.otherContact}');
       delete from chat.family where id in ('${ids.family}','${ids.otherFamily}');
       delete from chat.staff where id in ('${ids.staff}','${ids.staffGone}');
       delete from chat.account where id in ('${ids.accStaff}','${ids.accStaffGone}','${ids.accContact}','${ids.accOther}');
       drop function if exists nextval_dummy();`);
});

describe('D-1 · a conversation message no longer requires a thread', () => {
  it('accepts a contact who is a member of the conversation', () => {
    expect(insertMessage({
      conversationId: ids.direct, authorType: 'contact', authorId: ids.contact,
    })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepts a teacher in a student group — impossible before this migration', () => {
    // author_type previously allowed only ('contact','staff','system'), so a
    // teacher could not post in the one channel BR-1 permits them.
    expect(insertMessage({
      conversationId: ids.group, authorType: 'teacher', authorId: ids.teacher,
    })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepts active staff without conversation membership (coverage may answer)', () => {
    expect(insertMessage({
      conversationId: ids.group, authorType: 'staff', authorId: ids.staff,
    })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepts a system message with no author', () => {
    expect(insertMessage({
      conversationId: ids.direct, authorType: 'system', authorId: null,
    })).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('D-1 · enforcement was strengthened, not relaxed', () => {
  it('rejects a contact of the family who is not a member of the conversation', () => {
    expect(expectRejected(`
      insert into chat.message (conversation_id, author_type, author_id, type, body, visibility, seq)
      values ('${ids.direct}', 'contact', '${ids.nonMember}', 'text', 'x', 'customer', 99);`))
      .toMatch(/not a member of conversation/);
  });

  it('rejects a contact belonging to a different family', () => {
    expect(expectRejected(`
      insert into chat.message (conversation_id, author_type, author_id, type, body, visibility, seq)
      values ('${ids.direct}', 'contact', '${ids.otherContact}', 'text', 'x', 'customer', 98);`))
      .toMatch(/not an active contact on this family/);
  });

  it('rejects a teacher who is not a member of the conversation', () => {
    expect(expectRejected(`
      insert into chat.message (conversation_id, author_type, author_id, type, body, visibility, seq)
      values ('${ids.group}', 'teacher', '${randomUUID()}', 'text', 'x', 'customer', 97);`))
      .toMatch(/not a teacher member of conversation/);
  });

  it('BR-1 · rejects a teacher posting into a direct conversation', () => {
    expect(expectRejected(`
      insert into chat.message (conversation_id, author_type, author_id, type, body, visibility, seq)
      values ('${ids.direct}', 'teacher', '${ids.teacher}', 'text', 'x', 'customer', 96);`))
      .toMatch(/BR-1|not a teacher member/);
  });

  it('rejects an inactive staff author', () => {
    expect(expectRejected(`
      insert into chat.message (conversation_id, author_type, author_id, on_behalf_mode, type, body, visibility, seq)
      values ('${ids.direct}', 'staff', '${ids.staffGone}', 'owner', 'text', 'x', 'customer', 95);`))
      .toMatch(/not an active staff member/);
  });

  it('rejects a system message that names an author', () => {
    expect(expectRejected(`
      insert into chat.message (conversation_id, author_type, author_id, type, body, visibility, seq)
      values ('${ids.direct}', 'system', '${ids.staff}', 'text', 'x', 'customer', 94);`))
      .toMatch(/must not name an author/);
  });

  it('rejects a message that belongs to neither a conversation nor a thread', () => {
    expect(expectRejected(`
      insert into chat.message (author_type, author_id, type, body, visibility, seq)
      values ('contact', '${ids.contact}', 'text', 'x', 'customer', 93);`))
      .toMatch(/belongs to no conversation or thread/);
  });
});
