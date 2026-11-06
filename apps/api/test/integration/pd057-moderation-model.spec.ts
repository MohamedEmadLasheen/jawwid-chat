/**
 * PD-57 (ENG-01) -- the moderation data model: Report and Block, proven
 * against the database with the application out of the picture.
 * Spec of record: docs/release/google-play-blocker-roadmap-2026-11-03.md
 * §5.3, §5.5, §6.1, §6.2.
 *
 *   1. fail closed (§5.5 rule 8): RLS on, no policy, no grant; chat_app,
 *      authenticated and anon can neither read nor write either table
 *   2. a report: the server's clock (created_at, due_at = +24 h, owner D-1), the priority
 *      follows the reason (child_safety is urgent), a new report is open
 *   3. what can be reported (§5): someone else's message in its conversation,
 *      never one's own, never a system or card message; a note for "other",
 *      at most 500 characters; the reporter is the signed-in account's person
 *   4. one unresolved report per reporter and target (§5.3); a duplicate may
 *      only raise the reason to child_safety
 *   5. the guard (§5.3): reporter, target, note, evidence, created_at and
 *      due_at never change; the status only moves forward; closing needs the
 *      answer; a closed report never changes; never deleted
 *   6. a block (§6.1, §6.2): parents and teachers block, staff never; not
 *      oneself; once per pair; its case is the blocker's own person report;
 *      case set once; deleting unblocks, the case stays
 *   6b. the managers told of a block (owner, 2026-11-04): one notice per
 *      manager per block, however many departments; insert-only; kept as
 *      history after an unblock; no request role reaches it
 *   7. erasure (§5.5 rule 6, §6.2): the erased reporter's reports are kept and
 *      anonymous, evidence about an erased subject is kept, blocks go both ways
 *   8. the report limit is configuration
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const DOMAIN = 'pd57model.qa.jawwid.test';

let s: Scenario;
let parentAccount: string;
let otherParentAccount: string;
let teacherAccount: string;
let unrelatedTeacherAccount: string;
let staffAccount: string;
let conversationId: string;
let otherConversationId: string;
/** teacher_c's text message in the conversation. */
let teacherMsg: string;
/** parent_p's own text message. */
let parentMsg: string;
let systemMsg: string;
let cardMsg: string;

const one = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]): Promise<T> =>
  (await g.prisma.$queryRawUnsafe<T[]>(sql, ...args))[0]!;

/** The database's refusal, as text; fails the test if the statement succeeded. */
async function refusal(sql: string, ...args: unknown[]): Promise<string> {
  try {
    await g.prisma.$executeRawUnsafe(sql, ...args);
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error(`expected a refusal, got success: ${sql}`);
}

async function message(conversation: string, authorType: string, authorId: string | null, type: string): Promise<string> {
  // A card message carries its card (checked at commit), so the two travel together.
  return g.prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.message (conversation_id, author_type, author_id, body, visibility, type, on_behalf_mode)
       values ($1::uuid, $2, $3::uuid, 'synthetic body', 'customer', $4, case when $2 = 'staff' then 'owner' end)
       returning id::text as id`,
      conversation, authorType, authorId, type,
    );
    if (type === 'card') {
      await tx.$executeRawUnsafe(
        `insert into chat.message_card (message_id, organization_id, kind)
         values ($1::uuid, chat.default_organization_id(), 'learner_resumed')`,
        row!.id,
      );
    }
    return row!.id;
  });
}

interface ReportInput {
  reporterKind?: string;
  reporterId?: string | null;
  reporterAccountId?: string | null;
  targetKind?: string;
  messageId?: string | null;
  conversationId?: string | null;
  subjectKind?: string;
  subjectId?: string;
  reason?: string;
  note?: string | null;
  evidence?: string;
}

/** The parent reports teacher_c's message for harassment, unless told otherwise. */
function reportSql(r: ReportInput = {}): [string, unknown[]] {
  const v = {
    reporterKind: 'contact',
    reporterId: s.parentId as string | null,
    reporterAccountId: parentAccount as string | null,
    targetKind: 'message',
    messageId: teacherMsg as string | null,
    conversationId: conversationId as string | null,
    subjectKind: 'teacher',
    subjectId: s.teacherId,
    reason: 'harassment',
    note: null as string | null,
    evidence: JSON.stringify({ body: 'synthetic body', attachmentKeys: [], authorId: s.teacherId }),
    ...r,
  };
  return [
    `insert into chat.content_report
       (reporter_kind, reporter_id, reporter_account_id, target_kind, message_id, conversation_id,
        subject_kind, subject_id, reason, note, evidence)
     values ($1, $2::uuid, $3::uuid, $4, $5::uuid, $6::uuid, $7, $8::uuid, $9, $10, $11::jsonb)
     returning id::text as id`,
    [v.reporterKind, v.reporterId, v.reporterAccountId, v.targetKind, v.messageId, v.conversationId,
     v.subjectKind, v.subjectId, v.reason, v.note, v.evidence],
  ];
}
const report = async (r: ReportInput = {}): Promise<string> => {
  const [sql, args] = reportSql(r);
  return (await one<{ id: string }>(sql, ...args)).id;
};
const reportRefusal = (r: ReportInput = {}): Promise<string> => {
  const [sql, args] = reportSql(r);
  return refusal(sql, ...args);
};
/** The parent reports teacher_c as a person. */
const personReport = (r: ReportInput = {}) =>
  report({ targetKind: 'person', messageId: null, conversationId: null, ...r });

/** `managerId` was told of `blockId` (the API writes one per responsible manager). */
const notice = async (blockId: string, managerId: string, caseId?: string) =>
  (await one<{ id: string }>(
    `insert into chat.actor_block_manager_notice (block_id, case_report_id, manager_staff_id)
     values ($1::uuid, coalesce($2::uuid, (select case_report_id from chat.actor_block where id = $1::uuid)), $3::uuid)
     returning id::text as id`,
    blockId, caseId ?? null, managerId,
  )).id;

/** SQL for the signed-in account of the person whose id is in placeholder `p`. */
const ACCOUNT_OF = (p: string) =>
  `coalesce((select account_id from chat.contact where id = ${p}::uuid), (select account_id from chat.teacher where id = ${p}::uuid),
            (select account_id from chat.staff where id = ${p}::uuid))`;

const block = async (blockerKind: string, blockerId: string, blockedKind: string, blockedId: string, caseId: string | null = null) =>
  (await one<{ id: string }>(
    `insert into chat.actor_block (blocker_kind, blocker_id, blocker_account_id, blocked_kind, blocked_id, case_report_id)
     values ($1, $2::uuid, ${ACCOUNT_OF('$2')}, $3, $4::uuid, $5::uuid) returning id::text as id`,
    blockerKind, blockerId, blockedKind, blockedId, caseId,
  )).id;

async function member(conversation: string, kind: string, id: string, joinedAt?: string, leftAt?: string) {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role, joined_at, left_at)
     values ($1::uuid, $2, $3::uuid, case $2 when 'contact' then 'parent' when 'teacher' then 'teacher' else 'admin' end, coalesce($4::timestamptz, now()), $5::timestamptz)`,
    conversation, kind, id, joinedAt ?? null, leftAt ?? null,
  );
}

async function account(kind: string, tag: string): Promise<string> {
  return (await one<{ id: string }>(
    `insert into chat.account (subject, kind) values ($1, $2) returning id::text as id`,
    `${tag}.${randomUUID().slice(0, 8)}@${DOMAIN}`, kind,
  )).id;
}

/** Closes a report the way the API will: taken, resolved, answered. */
async function close(id: string, status: 'actioned' | 'dismissed' = 'dismissed') {
  await g.prisma.$executeRawUnsafe(
    `update chat.content_report
        set status = $2, taken_by = coalesce(taken_by, $3::uuid), taken_at = coalesce(taken_at, now()),
            resolution = case when $2 = 'dismissed' then 'no_action' else 'warned' end,
            resolved_by = $3::uuid, resolved_at = now(),
            answer_text = 'We looked into it.', reporter_answered_at = now()
      where id = $1::uuid`,
    id, status, s.managerId,
  );
}

beforeAll(async () => {
  await g.prisma.$connect();
});

beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  s = await seed(g.prisma);
  parentAccount = await account('family', 'parent_p');
  otherParentAccount = await account('family', 'parent_q');
  teacherAccount = await account('teacher', 'teacher_c');
  unrelatedTeacherAccount = await account('teacher', 'teacher_e');
  staffAccount = await account('staff', 'admin_a');
  await g.prisma.$executeRawUnsafe(`update chat.contact set account_id = $2::uuid where id = $1::uuid`, s.parentId, parentAccount);
  await g.prisma.$executeRawUnsafe(`update chat.contact set account_id = $2::uuid where id = $1::uuid`, s.otherParentId, otherParentAccount);
  await g.prisma.$executeRawUnsafe(`update chat.teacher set account_id = $2::uuid where id = $1::uuid`, s.teacherId, teacherAccount);
  await g.prisma.$executeRawUnsafe(`update chat.teacher set account_id = $2::uuid where id = $1::uuid`, s.unrelatedTeacherId, unrelatedTeacherAccount);
  await g.prisma.$executeRawUnsafe(`update chat.staff set account_id = $2::uuid where id = $1::uuid`, s.ownerId, staffAccount);
  conversationId = (await one<{ id: string }>(
    `insert into chat.conversation (type, family_id, learner_id, title)
     values ('student_group', $1::uuid, $2::uuid, 'group_l') returning id::text as id`,
    s.familyId, s.learnerId,
  )).id;
  otherConversationId = (await one<{ id: string }>(
    `insert into chat.conversation (type, family_id, learner_id, title)
     values ('student_group', $1::uuid, $2::uuid, 'group_m') returning id::text as id`,
    s.familyId, s.secondLearnerId,
  )).id;
  // The reporters are members of group_l (closure plan §6: a parent or teacher
  // reports only within a conversation they are or were in).
  // BR-1: a group pairing a teacher with a family keeps a live admin member, added first.
  for (const [kind, id] of [['staff', s.ownerId], ['contact', s.parentId], ['contact', s.otherParentId], ['teacher', s.teacherId]] as const) {
    await member(conversationId, kind, id);
  }
  teacherMsg = await message(conversationId, 'teacher', s.teacherId, 'text');
  parentMsg = await message(conversationId, 'contact', s.parentId, 'voice');
  systemMsg = await message(conversationId, 'system', null, 'system');
  cardMsg = await message(conversationId, 'staff', s.ownerId, 'card');
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$disconnect();
});

describe('1. fail closed: no request role reaches either table (§5.5 rule 8)', () => {
  it('RLS is on, with no policy and no grant to a request role', async () => {
    const tables = await g.prisma.$queryRawUnsafe<Array<{ relname: string; rls: boolean; policies: number }>>(
      `select c.relname::text, c.relrowsecurity as rls,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'chat' and c.relname in ('content_report', 'actor_block', 'actor_block_manager_notice')
        order by c.relname`,
    );
    expect(tables).toEqual([
      { relname: 'actor_block', rls: true, policies: 0 },
      { relname: 'actor_block_manager_notice', rls: true, policies: 0 },
      { relname: 'content_report', rls: true, policies: 0 },
    ]);
    const grants = await g.prisma.$queryRawUnsafe<Array<{ grantee: string }>>(
      `select distinct grantee::text from information_schema.role_table_grants
        where table_schema = 'chat' and table_name in ('content_report', 'actor_block', 'actor_block_manager_notice')`,
    );
    expect(grants.map((r) => r.grantee).filter((x) => x !== 'postgres')).toEqual([]);
  });

  it.each(['chat_app', 'authenticated', 'anon'])('%s can neither read nor write a report or a block', async (role) => {
    const id = await report();
    const theCase = await personReport({ reason: 'blocked' });
    const b = await block('contact', s.parentId, 'teacher', s.teacherId, theCase);
    await notice(b, s.managerId);
    const asRole = async (sql: string) => {
      try {
        await g.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`set local role ${role}`);
          await tx.$queryRawUnsafe(sql);
        });
      } catch (e) {
        return String((e as Error).message);
      }
      return 'allowed';
    };
    for (const sql of [
      `select * from chat.content_report`,
      `select * from chat.actor_block`,
      `update chat.content_report set status = 'dismissed' where id = '${id}'`,
      `delete from chat.actor_block`,
      `select * from chat.actor_block_manager_notice`,
      `insert into chat.actor_block_manager_notice (block_id, case_report_id, manager_staff_id)
       values ('${b}', '${theCase}', '${s.ownerId}')`,
      `delete from chat.actor_block_manager_notice`,
      `insert into chat.actor_block (blocker_kind, blocker_id, blocker_account_id, blocked_kind, blocked_id)
       values ('contact', '${s.otherParentId}', '${otherParentAccount}', 'teacher', '${s.teacherId}')`,
    ]) {
      expect(await asRole(sql)).toMatch(/permission denied|42501/);
    }
  });
});

describe('2. a report takes the server\'s clock and its priority from its reason', () => {
  it('created now, due 24 hours later (D-1), open, normal; back-dating and a preset status are ignored', async () => {
    const [sql, args] = reportSql();
    const backdated = sql
      .replace('subject_kind, subject_id, reason, note, evidence)', 'subject_kind, subject_id, reason, note, evidence, created_at, due_at, status, priority)')
      .replace("$11::jsonb)", "$11::jsonb, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', 'actioned', 'urgent')");
    const id = (await one<{ id: string }>(backdated, ...args)).id;
    const r = await one<{ fresh: boolean; due: boolean; status: string; priority: string }>(
      `select created_at > now() - interval '1 minute' as fresh, due_at = created_at + interval '24 hours' as due,
              status, priority
         from chat.content_report where id = $1::uuid`,
      id,
    );
    expect(r).toEqual({ fresh: true, due: true, status: 'open', priority: 'normal' });
  });

  it('child_safety is urgent; every other reason is normal', async () => {
    const urgent = await report({ reason: 'child_safety' });
    const other = await personReport({ reason: 'other', note: 'Something else, said in words.' });
    const rows = await g.prisma.$queryRawUnsafe<Array<{ id: string; priority: string }>>(
      `select id::text, priority from chat.content_report`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.priority]))).toEqual({ [urgent]: 'urgent', [other]: 'normal' });
  });

  it('a new report has no reviewer, resolution or answer', async () => {
    const [sql, args] = reportSql();
    const withAnswer = sql
      .replace('subject_kind, subject_id, reason, note, evidence)', 'subject_kind, subject_id, reason, note, evidence, answer_text, reporter_answered_at)')
      .replace('$11::jsonb)', "$11::jsonb, 'pre-answered', now())");
    expect(await refusal(withAnswer, ...args)).toMatch(/a new report is open, untaken and unanswered/);
  });

  it('the Prisma model reads every column', async () => {
    const id = await report({ reason: 'other', note: 'A note.' });
    const row = await g.prisma.contentReport.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      reporterKind: 'contact', reporterId: s.parentId, reporterAccountId: parentAccount,
      targetKind: 'message', messageId: teacherMsg, conversationId, subjectKind: 'teacher', subjectId: s.teacherId,
      reason: 'other', note: 'A note.', priority: 'normal', status: 'open',
      overdueAt: null, takenBy: null, resolution: null, answerText: null, reporterAnsweredAt: null,
    });
    expect(row.dueAt.getTime() - row.createdAt.getTime()).toBe(24 * 3600 * 1000);
    const b = await block('contact', s.parentId, 'teacher', s.teacherId);
    const blockRow = await g.prisma.actorBlock.findUniqueOrThrow({ where: { id: b } });
    expect(blockRow).toMatchObject({
      blockerKind: 'contact', blockerId: s.parentId, blockedKind: 'teacher', blockedId: s.teacherId,
      caseReportId: null,
    });
    expect(blockRow).not.toHaveProperty('notifiedManagerStaffId');
    const theCase = await personReport({ reason: 'blocked', reporterId: s.otherParentId, reporterAccountId: otherParentAccount });
    const b2 = await block('contact', s.otherParentId, 'teacher', s.teacherId, theCase);
    const n = await notice(b2, s.managerId);
    expect(await g.prisma.actorBlockManagerNotice.findUniqueOrThrow({ where: { id: n } })).toMatchObject({
      blockId: b2, caseReportId: theCase, managerStaffId: s.managerId,
    });
  });
});

describe('3. what can be reported, and by whom (§5, §5.4)', () => {
  it('someone else\'s message: text, voice and the rest; a person, from their profile', async () => {
    await report();
    await report({ reporterKind: 'teacher', reporterId: s.teacherId, reporterAccountId: teacherAccount,
                   messageId: parentMsg, subjectKind: 'contact', subjectId: s.parentId });
    await personReport({ reporterKind: 'staff', reporterId: s.ownerId, reporterAccountId: staffAccount,
                         subjectKind: 'contact', subjectId: s.parentId, reason: 'spam' });
    expect((await one<{ n: number }>(`select count(*)::int as n from chat.content_report`)).n).toBe(3);
  });

  it('never oneself, one\'s own message, a system or card message, or a message of another conversation', async () => {
    expect(await reportRefusal({ messageId: parentMsg, subjectKind: 'contact', subjectId: s.parentId }))
      .toMatch(/content_report_not_self/);
    expect(await reportRefusal({ targetKind: 'person', messageId: null, conversationId: null, subjectKind: 'contact', subjectId: s.parentId }))
      .toMatch(/content_report_not_self/);
    expect(await reportRefusal({ messageId: systemMsg })).toMatch(/not a system or card message/);
    expect(await reportRefusal({ messageId: cardMsg, subjectKind: 'staff', subjectId: s.ownerId })).toMatch(/not a system or card message/);
    expect(await reportRefusal({ conversationId: otherConversationId })).toMatch(/not a system or card message/);
    // The subject of a message report is its author, nobody else.
    expect(await reportRefusal({ subjectId: s.newTeacherId })).toMatch(/not a system or card message/);
  });

  it('a message report names its message and conversation; a person report names no message', async () => {
    expect(await reportRefusal({ messageId: null })).toMatch(/content_report_target_shape/);
    expect(await reportRefusal({ conversationId: null })).toMatch(/content_report_target_shape/);
    expect(await reportRefusal({ targetKind: 'person' })).toMatch(/content_report_target_shape/);
    expect(await reportRefusal({ targetKind: 'conversation' })).toMatch(/content_report_target_kind_check/);
  });

  it('the five reasons, and `blocked` only about a person; "other" needs a note of at most 500 characters', async () => {
    expect(await reportRefusal({ reason: 'rude' })).toMatch(/content_report_reason_check/);
    expect(await reportRefusal({ reason: 'blocked' })).toMatch(/content_report_blocked_is_a_person/);
    expect(await reportRefusal({ reason: 'other' })).toMatch(/content_report_other_needs_note/);
    expect(await reportRefusal({ reason: 'other', note: '   ' })).toMatch(/content_report_note_shape/);
    expect(await reportRefusal({ reason: 'other', note: 'x'.repeat(501) })).toMatch(/content_report_note_shape/);
    await report({ reason: 'other', note: 'x'.repeat(500) });
  });

  it('the evidence is an object', async () => {
    expect(await reportRefusal({ evidence: '"just a string"' })).toMatch(/content_report_evidence_is_object/);
  });

  it('the reporter is a person of the organization signed in as that account', async () => {
    expect(await reportRefusal({ reporterAccountId: otherParentAccount })).toMatch(/signed in as that account/);
    expect(await reportRefusal({ reporterId: randomUUID() })).toMatch(/signed in as that account/);
    expect(await reportRefusal({ reporterId: null, reporterAccountId: null })).toMatch(/names its reporter/);
    expect(await reportRefusal({ targetKind: 'person', messageId: null, conversationId: null, subjectId: randomUUID() }))
      .toMatch(/the reported person is a person of the report's organization/);
  });
});

describe('4. one unresolved report per reporter and target (§5.3)', () => {
  it('a duplicate is refused while the first is open or in review, whatever its reason; allowed once it is closed', async () => {
    const first = await report();
    expect(await reportRefusal()).toMatch(/content_report_one_open|23505/);
    expect(await reportRefusal({ reason: 'spam' })).toMatch(/content_report_one_open|23505/);
    // Another target, another reporter: their own reports.
    await personReport();
    await report({ reporterId: s.otherParentId, reporterAccountId: otherParentAccount });
    await g.prisma.$executeRawUnsafe(
      `update chat.content_report set status = 'in_review', taken_by = $2::uuid, taken_at = now() where id = $1::uuid`,
      first, s.managerId,
    );
    expect(await reportRefusal()).toMatch(/content_report_one_open|23505/);
    await close(first);
    await report();
  });

  it('an unresolved report may rise to child_safety (and urgent), and no other way', async () => {
    const id = await report({ reason: 'spam' });
    expect(await refusal(`update chat.content_report set reason = 'harassment' where id = $1::uuid`, id))
      .toMatch(/only ever rises to child_safety/);
    expect(await refusal(`update chat.content_report set priority = 'urgent' where id = $1::uuid`, id))
      .toMatch(/content_report_priority_follows_reason|only ever rises/);
    await g.prisma.$executeRawUnsafe(`update chat.content_report set reason = 'child_safety', priority = 'urgent' where id = $1::uuid`, id);
    expect(await refusal(`update chat.content_report set reason = 'spam', priority = 'normal' where id = $1::uuid`, id))
      .toMatch(/only ever rises to child_safety/);
  });
});

describe('5. the guard: what never changes, and the status only moves forward (§5.3)', () => {
  it('the reporter, the target, the note, the evidence and the clock never change', async () => {
    const id = await report({ reason: 'other', note: 'A note.' });
    for (const set of [
      `reporter_id = '${s.otherParentId}', reporter_account_id = '${otherParentAccount}'`,
      `reporter_id = null, reporter_account_id = null`,
      `subject_id = '${s.newTeacherId}'`,
      `message_id = '${parentMsg}'`,
      `note = 'Rewritten.'`,
      `evidence = '{}'::jsonb`,
      `created_at = created_at - interval '1 day', due_at = due_at - interval '1 day'`,
    ]) {
      expect(await refusal(`update chat.content_report set ${set} where id = $1::uuid`, id))
        .toMatch(/never change/);
    }
  });

  it('open -> in_review -> actioned; never back; taken once; overdue once', async () => {
    const id = await report();
    await g.prisma.$executeRawUnsafe(
      `update chat.content_report set status = 'in_review', taken_by = $2::uuid, taken_at = now() where id = $1::uuid`,
      id, s.managerId,
    );
    expect(await refusal(`update chat.content_report set status = 'open' where id = $1::uuid`, id)).toMatch(/only moves forward/);
    expect(await refusal(`update chat.content_report set taken_by = $2::uuid where id = $1::uuid`, id, s.ownerId))
      .toMatch(/taken once/);
    expect(await refusal(`update chat.content_report set taken_by = null, taken_at = null where id = $1::uuid`, id))
      .toMatch(/taken once|content_report_in_review_is_taken/);
    // Overdue at or after the 24 h mark, once.
    expect(await refusal(`update chat.content_report set overdue_at = created_at where id = $1::uuid`, id))
      .toMatch(/content_report_overdue_after_due/);
    await g.prisma.$executeRawUnsafe(`update chat.content_report set overdue_at = due_at where id = $1::uuid`, id);
    expect(await refusal(`update chat.content_report set overdue_at = due_at + interval '1 hour' where id = $1::uuid`, id))
      .toMatch(/overdue once/);
    await close(id, 'actioned');
    expect((await one<{ status: string; resolution: string }>(
      `select status, resolution from chat.content_report where id = $1::uuid`, id,
    ))).toEqual({ status: 'actioned', resolution: 'warned' });
  });

  it('closing needs a resolution, its reviewer and the answer to the reporter; dismissed is no action', async () => {
    const id = await report();
    expect(await refusal(
      `update chat.content_report set status = 'dismissed', resolution = 'no_action', resolved_by = $2::uuid, resolved_at = now()
        where id = $1::uuid`, id, s.managerId,
    )).toMatch(/content_report_closed_is_answered/);
    expect(await refusal(
      `update chat.content_report set status = 'dismissed', answer_text = 'Answer.', reporter_answered_at = now()
        where id = $1::uuid`, id,
    )).toMatch(/content_report_resolution_is_whole/);
    expect(await refusal(
      `update chat.content_report set status = 'dismissed', resolution = 'warned', resolved_by = $2::uuid, resolved_at = now(),
              answer_text = 'Answer.', reporter_answered_at = now() where id = $1::uuid`, id, s.managerId,
    )).toMatch(/content_report_dismissed_is_no_action/);
    expect(await refusal(
      `update chat.content_report set status = 'actioned', resolution = 'no_action', resolved_by = $2::uuid, resolved_at = now(),
              answer_text = 'Answer.', reporter_answered_at = now() where id = $1::uuid`, id, s.managerId,
    )).toMatch(/content_report_dismissed_is_no_action/);
    expect(await refusal(
      `update chat.content_report set answer_text = $2 where id = $1::uuid`, id, 'x'.repeat(1001),
    )).toMatch(/content_report_answer_text_check|content_report_answer_is_whole/);
    await close(id, 'dismissed');
  });

  it('a closed report never changes, and no report is ever deleted', async () => {
    const id = await report();
    await close(id);
    expect(await refusal(`update chat.content_report set answer_text = 'Changed.' where id = $1::uuid`, id))
      .toMatch(/a closed report never changes/);
    expect(await refusal(`update chat.content_report set status = 'actioned', resolution = 'warned' where id = $1::uuid`, id))
      .toMatch(/a closed report never changes/);
    expect(await refusal(`delete from chat.content_report where id = $1::uuid`, id)).toMatch(/a report is never deleted/);
  });

  it('the anonymisation path is only the erasure\'s', async () => {
    const id = await report();
    expect(await refusal(
      `update chat.content_report set reporter_id = null, reporter_account_id = null where id = $1::uuid`, id,
    )).toMatch(/never change/);
    // The erasure's setting for ANOTHER account opens nothing.
    const other = await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.erasing_account', $1, true)`, otherParentAccount);
      try {
        await tx.$executeRawUnsafe(`update chat.content_report set reporter_id = null, reporter_account_id = null where id = $1::uuid`, id);
        return 'allowed';
      } catch (e) {
        return String((e as Error).message);
      }
    }).catch((e) => String((e as Error).message));
    expect(other).toMatch(/never change/);
  });
});

describe('6. a block (§6.1, §6.2)', () => {
  it('a parent blocks a teacher or a staff member; a teacher blocks a parent; staff never block', async () => {
    await block('contact', s.parentId, 'teacher', s.teacherId);
    await block('contact', s.parentId, 'staff', s.ownerId);
    await block('teacher', s.teacherId, 'contact', s.parentId);
    expect(await refusal(
      `insert into chat.actor_block (blocker_kind, blocker_id, blocker_account_id, blocked_kind, blocked_id) values ('staff', $1::uuid, ${ACCOUNT_OF('$1')}, 'contact', $2::uuid)`,
      s.ownerId, s.parentId,
    )).toMatch(/actor_block_blocker_kind_check/);
  });

  it('never oneself, never twice, only between people of the organization', async () => {
    expect(await refusal(
      `insert into chat.actor_block (blocker_kind, blocker_id, blocker_account_id, blocked_kind, blocked_id) values ('contact', $1::uuid, ${ACCOUNT_OF('$1')}, 'contact', $1::uuid)`,
      s.parentId,
    )).toMatch(/actor_block_not_self/);
    await block('contact', s.parentId, 'teacher', s.teacherId);
    expect(await refusal(
      `insert into chat.actor_block (blocker_kind, blocker_id, blocker_account_id, blocked_kind, blocked_id) values ('contact', $1::uuid, ${ACCOUNT_OF('$1')}, 'teacher', $2::uuid)`,
      s.parentId, s.teacherId,
    )).toMatch(/actor_block_once|23505/);
    expect(await refusal(
      `insert into chat.actor_block (blocker_kind, blocker_id, blocker_account_id, blocked_kind, blocked_id) values ('contact', $1::uuid, ${ACCOUNT_OF('$1')}, 'teacher', $2::uuid)`,
      s.parentId, randomUUID(),
    )).toMatch(/between two people of its organization/);
  });

  it('its case is the blocker\'s own person report about the blocked person, set once', async () => {
    const id = await block('contact', s.parentId, 'teacher', s.teacherId);
    const messageCase = await report();
    const otherPersonCase = await personReport({ reporterId: s.otherParentId, reporterAccountId: otherParentAccount });
    const theCase = await personReport({ reason: 'blocked' });
    const setCase = (c: string) =>
      g.prisma.$executeRawUnsafe(`update chat.actor_block set case_report_id = $2::uuid where id = $1::uuid`, id, c);
    await expect(setCase(messageCase)).rejects.toThrow(/blocker's own report about the blocked person/);
    await expect(setCase(otherPersonCase)).rejects.toThrow(/blocker's own report about the blocked person/);
    await setCase(theCase);
    await expect(setCase(otherPersonCase)).rejects.toThrow(/set once/);
    expect(await refusal(`update chat.actor_block set blocked_id = $2::uuid where id = $1::uuid`, id, s.newTeacherId))
      .toMatch(/a block never changes/);
    // Opened together with its case, in one insert.
    const unrelated = await personReport({ reporterKind: 'teacher', reporterId: s.unrelatedTeacherId,
      reporterAccountId: unrelatedTeacherAccount, subjectKind: 'contact', subjectId: s.otherParentId, reason: 'blocked' });
    await block('teacher', s.unrelatedTeacherId, 'contact', s.otherParentId, unrelated);
  });

  it('deleting the row unblocks; the case stays', async () => {
    const theCase = await personReport({ reason: 'blocked' });
    const id = await block('contact', s.parentId, 'teacher', s.teacherId, theCase);
    await g.prisma.$executeRawUnsafe(`delete from chat.actor_block where id = $1::uuid`, id);
    expect((await one<{ blocks: number; reports: number }>(
      `select (select count(*)::int from chat.actor_block) as blocks,
              (select count(*)::int from chat.content_report where id = $1::uuid) as reports`, theCase,
    ))).toEqual({ blocks: 0, reports: 1 });
    // Blocking again is a new block.
    await block('contact', s.parentId, 'teacher', s.teacherId, theCase);
  });
});

describe('6b. the managers told of a block (owner decision 2026-11-04)', () => {
  /** A manager of another department: the family's children can be supervised across departments. */
  async function otherDepartmentManager(): Promise<string> {
    const id = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'manager_s', 'manager', true)`, id,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department (kind, display_name, manager_id) values ('sales', 'sales', $1::uuid)`, id,
    );
    return id;
  }
  async function blockWithCase(): Promise<{ id: string; theCase: string }> {
    const theCase = await personReport({ reason: 'blocked' });
    return { id: await block('contact', s.parentId, 'teacher', s.teacherId, theCase), theCase };
  }
  const notices = () =>
    g.prisma.$queryRawUnsafe<Array<{ block_id: string | null; case_report_id: string; manager_staff_id: string; fresh: boolean }>>(
      `select block_id::text, case_report_id::text, manager_staff_id::text, notified_at > now() - interval '1 minute' as fresh
         from chat.actor_block_manager_notice order by manager_staff_id`,
    );

  it('every responsible manager, across departments, is told once; a second notice to the same manager is refused', async () => {
    const second = await otherDepartmentManager();
    const { id, theCase } = await blockWithCase();
    await notice(id, s.managerId);
    await notice(id, second);
    expect(await refusal(
      `insert into chat.actor_block_manager_notice (block_id, case_report_id, manager_staff_id) values ($1::uuid, $2::uuid, $3::uuid)`,
      id, theCase, s.managerId,
    )).toMatch(/actor_block_manager_notice_once|23505/);
    expect(await notices()).toEqual(
      [s.managerId, second].sort().map((m) => ({ block_id: id, case_report_id: theCase, manager_staff_id: m, fresh: true })),
    );
  });

  it('insert-only: a notice is never changed or deleted', async () => {
    const { id } = await blockWithCase();
    const n = await notice(id, s.managerId);
    for (const sql of [
      `update chat.actor_block_manager_notice set manager_staff_id = '${s.ownerId}' where id = $1::uuid`,
      `update chat.actor_block_manager_notice set notified_at = notified_at - interval '1 day' where id = $1::uuid`,
      `update chat.actor_block_manager_notice set block_id = null where id = $1::uuid`,
      `delete from chat.actor_block_manager_notice where id = $1::uuid`,
    ]) {
      expect(await refusal(sql, n)).toMatch(/a block notice is written once/);
    }
  });

  it('a notice is about a block with its case, to staff of the organization, at the server\'s time', async () => {
    const bare = await block('contact', s.parentId, 'teacher', s.teacherId);
    const unrelatedCase = await personReport({ reporterId: s.otherParentId, reporterAccountId: otherParentAccount });
    expect(await refusal(
      `insert into chat.actor_block_manager_notice (block_id, case_report_id, manager_staff_id) values ($1::uuid, $2::uuid, $3::uuid)`,
      bare, unrelatedCase, s.managerId,
    )).toMatch(/about a block and that block's case/);
    await g.prisma.$executeRawUnsafe(`delete from chat.actor_block where id = $1::uuid`, bare);
    const { id, theCase } = await blockWithCase();
    expect(await refusal(
      `insert into chat.actor_block_manager_notice (block_id, case_report_id, manager_staff_id) values ($1::uuid, $2::uuid, $3::uuid)`,
      id, theCase, randomUUID(),
    )).toMatch(/foreign key|23503|staff of the organization/);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.actor_block_manager_notice (block_id, case_report_id, manager_staff_id, notified_at)
       values ($1::uuid, $2::uuid, $3::uuid, '2020-01-01T00:00:00Z')`,
      id, theCase, s.managerId,
    );
    expect((await notices())[0]!.fresh).toBe(true);
  });

  it('unblocking keeps the notices as history, tied to the case', async () => {
    const { id, theCase } = await blockWithCase();
    await notice(id, s.managerId);
    await g.prisma.$executeRawUnsafe(`delete from chat.actor_block where id = $1::uuid`, id);
    expect(await notices()).toEqual([{ block_id: null, case_report_id: theCase, manager_staff_id: s.managerId, fresh: true }]);
  });

  it('block/unblock cycles while the case is open tell nobody again (closure plan §5)', async () => {
    const { id, theCase } = await blockWithCase();
    await notice(id, s.managerId);
    for (let i = 0; i < 3; i++) {
      const current = (await one<{ id: string }>(
        `select id::text from chat.actor_block where blocker_id = $1::uuid and blocked_id = $2::uuid`, s.parentId, s.teacherId)).id;
      await g.prisma.$executeRawUnsafe(`delete from chat.actor_block where id = $1::uuid`, current);
      const again = await block('contact', s.parentId, 'teacher', s.teacherId, theCase);
      expect(await refusal(
        `insert into chat.actor_block_manager_notice (block_id, case_report_id, manager_staff_id) values ($1::uuid, $2::uuid, $3::uuid)`,
        again, theCase, s.managerId,
      )).toMatch(/actor_block_manager_notice_once|23505/);
    }
    expect(await notices()).toHaveLength(1);
  });

  it('a new case (the old one closed) is a new incident, and is told', async () => {
    const { id, theCase } = await blockWithCase();
    await notice(id, s.managerId);
    await close(theCase);
    await g.prisma.$executeRawUnsafe(`delete from chat.actor_block where id = $1::uuid`, id);
    const second = await personReport({ reason: 'blocked' });
    const again = await block('contact', s.parentId, 'teacher', s.teacherId, second);
    await notice(again, s.managerId);
    expect((await notices()).map((n) => n.case_report_id).sort()).toEqual([theCase, second].sort());
  });
});

describe('7. erasure keeps reports, anonymous, and removes blocks (§5.5 rule 6, §6.2)', () => {
  it('the erased parent\'s reports stay without them; reports about them keep their evidence; their blocks go both ways', async () => {
    const theirs = await report({ reason: 'other', note: 'Kept with the report.' });
    const closed = await personReport({ reason: 'spam' });
    await close(closed);
    const aboutThem = await report({ reporterKind: 'teacher', reporterId: s.teacherId, reporterAccountId: teacherAccount,
      messageId: parentMsg, subjectKind: 'contact', subjectId: s.parentId,
      evidence: JSON.stringify({ body: 'synthetic body', authorId: s.parentId }) });
    const othersReport = await report({ reporterId: s.otherParentId, reporterAccountId: otherParentAccount });
    const blockCase = await personReport({ reason: 'blocked' });
    await notice(await block('contact', s.parentId, 'teacher', s.teacherId, blockCase), s.managerId);
    await block('teacher', s.unrelatedTeacherId, 'contact', s.parentId);
    const othersBlock = await block('contact', s.otherParentId, 'teacher', s.teacherId);

    await g.prisma.$queryRawUnsafe(`select chat.erase_account($1::uuid, 'pd57 model spec')`, parentAccount);

    const rows = await g.prisma.$queryRawUnsafe<Array<{
      id: string; reporter_kind: string; reporter_id: string | null; reporter_account_id: string | null;
      subject_id: string; note: string | null; evidence: Record<string, unknown>; status: string;
    }>>(`select id::text, reporter_kind, reporter_id::text, reporter_account_id::text, subject_id::text, note, evidence, status
           from chat.content_report`);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(rows).toHaveLength(5);
    expect(byId[theirs]).toMatchObject({ reporter_kind: 'contact', reporter_id: null, reporter_account_id: null,
                                         note: 'Kept with the report.', status: 'open' });
    expect(byId[closed]).toMatchObject({ reporter_id: null, reporter_account_id: null, status: 'dismissed' });
    expect(byId[aboutThem]).toMatchObject({ reporter_id: s.teacherId, subject_id: s.parentId,
                                            evidence: { body: 'synthetic body', authorId: s.parentId } });
    expect(byId[othersReport]).toMatchObject({ reporter_id: s.otherParentId, reporter_account_id: otherParentAccount });

    const blocks = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(`select id::text from chat.actor_block`);
    expect(blocks.map((b) => b.id)).toEqual([othersBlock]);
    // The managers' notices of the erased parent's block stay, as administrative history.
    expect(await one(`select block_id, case_report_id::text from chat.actor_block_manager_notice`))
      .toEqual({ block_id: null, case_report_id: blockCase });

    // Erasing again changes nothing.
    await g.prisma.$queryRawUnsafe(`select chat.erase_account($1::uuid, 'pd57 model spec')`, parentAccount);
    expect((await one<{ n: number }>(`select count(*)::int as n from chat.content_report`)).n).toBe(5);
  });

  it('an erased teacher\'s blocks go too', async () => {
    // The Teachers manager is told of a teacher's erasure (PD-56).
    const teachersManager = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'manager_t', 'manager', true)`, teachersManager,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid)`, teachersManager,
    );
    await block('teacher', s.unrelatedTeacherId, 'contact', s.parentId);
    await block('contact', s.otherParentId, 'teacher', s.unrelatedTeacherId);
    const kept = await block('contact', s.parentId, 'teacher', s.teacherId);
    const theirs = await personReport({ reporterKind: 'teacher', reporterId: s.unrelatedTeacherId,
      reporterAccountId: unrelatedTeacherAccount, subjectKind: 'contact', subjectId: s.parentId });
    await g.prisma.$queryRawUnsafe(`select chat.erase_account($1::uuid, 'pd57 model spec')`, unrelatedTeacherAccount);
    const blocks = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(`select id::text from chat.actor_block`);
    expect(blocks.map((b) => b.id)).toEqual([kept]);
    expect(await one(`select reporter_kind, reporter_id from chat.content_report where id = $1::uuid`, theirs))
      .toEqual({ reporter_kind: 'teacher', reporter_id: null });
  });
});

describe('8. the report limit is configuration (§5.3)', () => {
  it('ten reports per reporter per hour', async () => {
    const row = await g.prisma.config.findUniqueOrThrow({ where: { key: 'report.limit.per_reporter_hour' } });
    expect(row.value).toBe(10);
    expect(row.scope).toBe('abuse');
  });
});

describe('9. closure plan 2026-11-06: defence in depth for the API (§3, §5, §6)', () => {
  it('a parent or teacher reports only a message of a conversation they are, or were then, in', async () => {
    // Not a member of group_m: refused, even naming a real message there.
    const there = await message(otherConversationId, 'teacher', s.teacherId, 'text');
    expect(await reportRefusal({ messageId: there, conversationId: otherConversationId }))
      .toMatch(/by a member of the message's conversation/);
    // Left before the message was sent: refused.
    await member(otherConversationId, 'contact', s.parentId, '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z');
    expect(await reportRefusal({ messageId: there, conversationId: otherConversationId }))
      .toMatch(/by a member of the message's conversation/);
    // A member now (history before they joined included): allowed.
    await member(otherConversationId, 'contact', s.otherParentId);
    await report({ reporterId: s.otherParentId, reporterAccountId: otherParentAccount, messageId: there, conversationId: otherConversationId });
  });

  it('a member who left after the message was sent may still report it', async () => {
    const there = await message(otherConversationId, 'teacher', s.teacherId, 'text');
    await member(otherConversationId, 'contact', s.parentId, '2020-01-01T00:00:00Z', '2999-01-01T00:00:00Z');
    await report({ messageId: there, conversationId: otherConversationId });
  });

  it('a staff reporter\'s read access is the API\'s (coverage and stepping-in rules): no membership required here', async () => {
    await report({ reporterKind: 'staff', reporterId: s.ownerId, reporterAccountId: staffAccount });
  });

  it('a person report through a conversation names one the reporter is in', async () => {
    expect(await reportRefusal({ targetKind: 'person', messageId: null, conversationId: otherConversationId }))
      .toMatch(/names a conversation the reporter is in/);
    await report({ targetKind: 'person', messageId: null, conversationId });
  });

  it('a message report carries its evidence', async () => {
    expect(await reportRefusal({ evidence: '{}' })).toMatch(/content_report_message_has_evidence/);
    await personReport({ evidence: '{}' });
  });

  it('the departments are set once, and are departments of the organization', async () => {
    const [sql, args] = reportSql();
    const withDepartments = (ids: string) => sql
      .replace('subject_kind, subject_id, reason, note, evidence)', 'subject_kind, subject_id, reason, note, evidence, department_ids)')
      .replace('$11::jsonb)', `$11::jsonb, '{${ids}}'::uuid[])`);
    expect(await refusal(withDepartments(randomUUID()), ...args)).toMatch(/departments of its organization/);
    const id = (await one<{ id: string }>(withDepartments(s.departmentId), ...args)).id;
    expect((await g.prisma.contentReport.findUniqueOrThrow({ where: { id } })).departmentIds).toEqual([s.departmentId]);
    expect(await refusal(`update chat.content_report set department_ids = '{}' where id = $1::uuid`, id))
      .toMatch(/the departments and the clock of a report never change/);
    // Default: none (the Super Admin only).
    expect((await g.prisma.contentReport.findUniqueOrThrow({ where: { id: await personReport() } })).departmentIds).toEqual([]);
  });

  it('a block is made by the blocker\'s own signed-in account, which never changes', async () => {
    expect(await refusal(
      `insert into chat.actor_block (blocker_kind, blocker_id, blocker_account_id, blocked_kind, blocked_id)
       values ('contact', $1::uuid, $2::uuid, 'teacher', $3::uuid)`,
      s.parentId, otherParentAccount, s.teacherId,
    )).toMatch(/made by the blocker's own account/);
    const id = await block('contact', s.parentId, 'teacher', s.teacherId);
    expect(await refusal(`update chat.actor_block set blocker_account_id = $2::uuid where id = $1::uuid`, id, otherParentAccount))
      .toMatch(/a block never changes/);
  });

  it('twenty blocks per blocker per day is configuration', async () => {
    const row = await g.prisma.config.findUniqueOrThrow({ where: { key: 'block.limit.per_blocker_day' } });
    expect(row.value).toBe(20);
    expect(row.scope).toBe('abuse');
  });
});
