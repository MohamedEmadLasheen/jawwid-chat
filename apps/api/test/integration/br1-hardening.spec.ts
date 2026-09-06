/**
 * BR-1 hardening — executable evidence for RT-024 and RT-025.
 *
 * Both were confirmed-open bypasses of the strongest control in the system.
 * These probes run raw SQL as a superuser, i.e. they simulate a compromised API,
 * a SQL-injection sink or an operator at a psql prompt. If any of them is
 * ALLOWED, BR-1 is not implemented, whatever the application layer does.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const CONTAINER = process.env.JAWWID_INT_CONTAINER ?? 'jawwid-chat-int';
const DB = process.env.JAWWID_INT_DB ?? 'jawwid_chat_int';
const USER = process.env.JAWWID_INT_USER ?? 'postgres';

jest.setTimeout(60_000);

function sql(statement: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', USER, '-d', DB, '-tAc', statement],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

/** Returns the postgres error, or null if the statement unexpectedly succeeded. */
function refused(statement: string): string | null {
  try {
    sql(statement);
    return null;
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    return err.stderr?.toString() ?? err.message ?? 'unknown';
  }
}

const FAMILY = 'f0000000-0000-0000-0000-000000000001';
const ADMIN = '50000000-0000-0000-0000-000000000001';

function learner(): string {
  const id = randomUUID();
  sql(`insert into chat.learner (id, family_id, name) values ('${id}', '${FAMILY}', 'probe_learner')`);
  return id;
}

function conversation(type: string): string {
  const id = randomUUID();
  const learnerRef = type === 'student_group' ? `'${learner()}'` : 'null';
  sql(
    `insert into chat.conversation (id, type, family_id, learner_id, title, direct_key)
     values ('${id}', '${type}', '${FAMILY}', ${learnerRef}, 'probe',
             ${type === 'direct' ? `'${id}'` : 'null'})`,
  );
  return id;
}

function addMember(conv: string, kind: string, role: string, actorId = randomUUID()): string {
  const memberId = randomUUID();
  sql(
    `insert into chat.conversation_member (id, conversation_id, actor_kind, actor_id, member_role)
     values ('${memberId}', '${conv}', '${kind}', '${actorId}', '${role}')`,
  );
  return memberId;
}

describe('RT-025 · required admin presence', () => {
  it('a student_group with a teacher and a parent and NO admin is refused', () => {
    const conv = conversation('student_group');
    addMember(conv, 'teacher', 'teacher');
    const err = refused(
      `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
       values ('${conv}', 'contact', '${randomUUID()}', 'parent')`,
    );
    expect(err).toContain('requires at least one Jawwid admin');
  });

  it('the same group WITH an admin present is allowed', () => {
    const conv = conversation('student_group');
    addMember(conv, 'staff', 'admin', ADMIN);
    addMember(conv, 'teacher', 'teacher');
    addMember(conv, 'contact', 'parent');
    expect(sql(`select count(*) from chat.conversation_member where conversation_id='${conv}' and left_at is null`)).toBe('3');
  });

  it('RT-025a · a class_group is covered too, not only student_group', () => {
    const conv = conversation('class_group');
    addMember(conv, 'teacher', 'teacher');
    const err = refused(
      `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
       values ('${conv}', 'contact', '${randomUUID()}', 'parent')`,
    );
    expect(err).toContain('requires at least one Jawwid admin');
  });

  it('RT-025b · the last admin cannot be removed, leaving teacher and parent alone', () => {
    const conv = conversation('student_group');
    const adminMember = addMember(conv, 'staff', 'admin', ADMIN);
    addMember(conv, 'teacher', 'teacher');
    addMember(conv, 'contact', 'parent');

    const err = refused(`update chat.conversation_member set left_at = now() where id = '${adminMember}'`);
    expect(err).toContain('requires at least one Jawwid admin');
  });

  it('RT-025c · the last admin cannot be DELETEd either', () => {
    const conv = conversation('student_group');
    const adminMember = addMember(conv, 'staff', 'admin', ADMIN);
    addMember(conv, 'teacher', 'teacher');
    addMember(conv, 'contact', 'parent');

    const err = refused(`delete from chat.conversation_member where id = '${adminMember}'`);
    expect(err).toContain('requires at least one Jawwid admin');
  });

  it('an admin may leave a group that has a second admin', () => {
    const conv = conversation('student_group');
    const first = addMember(conv, 'staff', 'admin', ADMIN);
    addMember(conv, 'staff', 'admin');
    addMember(conv, 'teacher', 'teacher');
    addMember(conv, 'contact', 'parent');

    sql(`update chat.conversation_member set left_at = now() where id = '${first}'`);
    expect(sql(`select count(*) from chat.conversation_member where conversation_id='${conv}' and left_at is null`)).toBe('3');
  });
});

describe('RT-024 · type promotion', () => {
  it('a group conversation cannot be promoted to direct', () => {
    const conv = conversation('student_group');
    addMember(conv, 'staff', 'admin', ADMIN);
    addMember(conv, 'teacher', 'teacher');
    addMember(conv, 'contact', 'parent');

    const err = refused(`update chat.conversation set type='direct', direct_key='${randomUUID()}' where id='${conv}'`);
    expect(err).toMatch(/BR-1 violation|immutable/);
  });

  it('a group CALL cannot be promoted to a direct call', () => {
    const conv = conversation('student_group');
    addMember(conv, 'staff', 'admin', ADMIN);
    addMember(conv, 'teacher', 'teacher');
    addMember(conv, 'contact', 'parent');

    const call = randomUUID();
    sql(
      `insert into chat.call (id, conversation_id, initiator_id, type, room_name)
       values ('${call}', '${conv}', '${ADMIN}', 'group', 'probe-${call}')`,
    );
    sql(`insert into chat.call_participant (call_id, actor_id, actor_kind) values ('${call}', '${ADMIN}', 'staff')`);
    sql(`insert into chat.call_participant (call_id, actor_id, actor_kind) values ('${call}', '${randomUUID()}', 'teacher')`);
    sql(`insert into chat.call_participant (call_id, actor_id, actor_kind) values ('${call}', '${randomUUID()}', 'contact')`);

    const err = refused(`update chat.call set type='direct' where id='${call}'`);
    expect(err).toContain('immutable');
  });

  it('a call cannot be moved to another conversation', () => {
    const conv = conversation('student_group');
    addMember(conv, 'staff', 'admin', ADMIN);
    const other = conversation('student_group');
    const call = randomUUID();
    sql(
      `insert into chat.call (id, conversation_id, initiator_id, type, room_name)
       values ('${call}', '${conv}', '${ADMIN}', 'group', 'probe-${call}')`,
    );
    const err = refused(`update chat.call set conversation_id='${other}' where id='${call}'`);
    expect(err).toContain('immutable');
  });

  it('a group call losing its last staff participant is refused', () => {
    const conv = conversation('student_group');
    addMember(conv, 'staff', 'admin', ADMIN);
    addMember(conv, 'teacher', 'teacher');
    addMember(conv, 'contact', 'parent');

    const call = randomUUID();
    sql(
      `insert into chat.call (id, conversation_id, initiator_id, type, room_name)
       values ('${call}', '${conv}', '${ADMIN}', 'group', 'probe-${call}')`,
    );
    sql(`insert into chat.call_participant (call_id, actor_id, actor_kind) values ('${call}', '${ADMIN}', 'staff')`);
    sql(`insert into chat.call_participant (call_id, actor_id, actor_kind) values ('${call}', '${randomUUID()}', 'teacher')`);
    sql(`insert into chat.call_participant (call_id, actor_id, actor_kind) values ('${call}', '${randomUUID()}', 'contact')`);

    const err = refused(`update chat.call_participant set left_at=now() where call_id='${call}' and actor_kind='staff'`);
    expect(err).toContain('requires Jawwid staff present');
  });
});
