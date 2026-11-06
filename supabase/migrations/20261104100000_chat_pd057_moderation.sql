-- PD-57 (2026-11-04) -- Report and Block: the moderation data model (ENG-01).
--
-- Spec of record: docs/release/google-play-blocker-roadmap-2026-11-03.md
-- §5.3 and §6.2 (the database), §5.5 (security and privacy), §6.1 (the block
-- rules A-2), §6.3 (the responsible managers). The owner approved A-1 (Report)
-- and A-2 (Block) on 2026-11-03, and A-2a (every responsible manager is told of
-- a family's block) on 2026-11-04. One migration for WP-1 and WP-2 (§5.3).
--
-- WHAT IS NEW
--
--   chat.content_report   a report of someone else's message or of a person,
--                         with one of the five reasons (A-1), or `blocked`, the
--                         case every block opens (§6.1 rule 4). A 24-hour clock
--                         (due_at, owner D-1 2026-11-06); child_safety is urgent. The reporter, the
--                         target, the note, the evidence snapshot, created_at
--                         and due_at never change; the status only moves
--                         forward (open -> in_review -> actioned | dismissed);
--                         a report is closed only with an answer to the
--                         reporter, and a closed report never changes. Never
--                         deleted. One unresolved report per reporter and
--                         target (a duplicate finds the open one, §5.4).
--   chat.actor_block      a personal block (A-2). A parent or a teacher blocks;
--                         staff never block (§6.1 rule 5). Unique per pair;
--                         deleting the row unblocks. It points at its case
--                         (case_report_id), set once.
--   chat.actor_block_manager_notice
--                         A-2a (owner, 2026-11-04): one row per manager told of
--                         a block -- every manager responsible for a supervisor
--                         of the family's children, across departments. Unique
--                         per case and manager: a block/unblock cycle while the
--                         case is open tells nobody again.
--                         Insert-only history: an unblock sets block_id to null
--                         (ON DELETE SET NULL) and the notice stays, tied to the
--                         block's case report, which is never deleted. Being
--                         told grants the manager nothing: no request role
--                         reads it, and it is not a permission.
--   chat.config           report.limit.per_reporter_hour = 10 (§5.3 REPORT_SUBMIT).
--   chat.erase_account    PD-56's erasure, with two additions (§5.5 rule 6, §6.2):
--                         the erased person's reports are KEPT and their
--                         reporter reference is anonymised (reporter_id and
--                         reporter_account_id become null; the reporter kind
--                         stays); their blocks are deleted in both directions.
--                         Evidence ABOUT an erased person is kept, as the audit
--                         log is.
--
-- RETENTION (one line, §5.5 rule 6): a report outlives its reporter's erasure,
-- anonymous; its evidence outlives its subject's; a block does not outlive
-- either person's erasure; the managers' notices of it do, as the audit log
-- does.
--
-- FAIL CLOSED (§5.5 rule 8). RLS on, no policy, no grant to any request role:
-- chat_app, authenticated, anon and public can neither read nor write any of
-- the three tables. Only the API's server-side connection does, through
-- apps/api/src/moderation (ENG-02). One guard trigger function per table.
--
-- Idempotent: every statement can run again on a database that has it.
-- Rollback: db/rollback/20261104100000_chat_pd057_moderation.down.sql.

set local lock_timeout = '5s';

-- ===========================================================================
-- 1. chat.content_report
-- ===========================================================================

create table if not exists chat.content_report (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null default chat.default_organization_id() references chat.organization (id),
  -- Who reported. Null id and account only after that person erased their
  -- account (the kind stays): see chat.erase_account below.
  reporter_kind         text not null check (reporter_kind in ('contact', 'teacher', 'staff')),
  reporter_id           uuid,
  reporter_account_id   uuid references chat.account (id),
  -- What is reported: a message (then subject = its author) or a person.
  target_kind           text not null check (target_kind in ('message', 'person')),
  message_id            uuid references chat.message (id),
  conversation_id       uuid references chat.conversation (id),
  subject_kind          text not null check (subject_kind in ('contact', 'teacher', 'staff')),
  subject_id            uuid not null,
  -- A-1's five reasons, and `blocked`, which only the server writes (§6.1 rule 4).
  reason                text not null
                        check (reason in ('harassment', 'inappropriate', 'spam', 'child_safety', 'other', 'blocked')),
  note                  text,
  -- What the message was at report time: body, attachment object keys, author,
  -- timestamps. Shown only with moderation.view (§5.5 rule 3); never logged.
  evidence              jsonb not null default '{}'::jsonb,
  priority              text not null default 'normal' check (priority in ('urgent', 'normal')),
  status                text not null default 'open' check (status in ('open', 'in_review', 'actioned', 'dismissed')),
  due_at                timestamptz not null,
  overdue_at            timestamptz,
  taken_by              uuid references chat.staff (id),
  taken_at              timestamptz,
  resolution            text check (resolution in ('no_action', 'message_removed', 'warned', 'account_suspended', 'reassigned')),
  resolution_note       text check (resolution_note is null or char_length(btrim(resolution_note)) between 1 and 2000),
  resolved_by           uuid references chat.staff (id),
  resolved_at           timestamptz,
  -- The one text the reporter reads back (§5.4: required to close, <= 1000).
  answer_text           text check (answer_text is null or char_length(btrim(answer_text)) between 1 and 1000),
  reporter_answered_at  timestamptz,
  department_ids        uuid[] not null default '{}',
  created_at            timestamptz not null default now(),

  constraint content_report_reporter_is_whole
    check ((reporter_id is null) = (reporter_account_id is null)),
  constraint content_report_not_self
    check (reporter_id is null or reporter_kind <> subject_kind or reporter_id <> subject_id),
  constraint content_report_target_shape
    check ((target_kind = 'message' and message_id is not null and conversation_id is not null)
        or (target_kind = 'person' and message_id is null)),
  constraint content_report_blocked_is_a_person
    check (reason <> 'blocked' or target_kind = 'person'),
  constraint content_report_note_shape
    check (note is null or (char_length(note) <= 500 and char_length(btrim(note)) >= 1)),
  constraint content_report_other_needs_note
    check (reason <> 'other' or note is not null),
  constraint content_report_priority_follows_reason
    check ((reason = 'child_safety') = (priority = 'urgent')),
  constraint content_report_evidence_is_object
    check (jsonb_typeof(evidence) = 'object'),
  -- D-1 (owner, 2026-11-06): 24 hours, replacing A-1's 48.
  constraint content_report_due_in_24_hours
    check (due_at = created_at + interval '24 hours'),
  -- D-3: the departments whose managers and moderators see this report. Set by
  -- the server when the report is filed (closure plan §3) and never changed.
  -- Empty: the Super Admin only. child_safety ignores it (D-4).
  constraint content_report_departments_shape
    check (array_position(department_ids, null) is null),
  -- A message report carries its evidence snapshot (the server builds it).
  constraint content_report_message_has_evidence
    check (target_kind <> 'message' or evidence <> '{}'::jsonb),
  constraint content_report_overdue_after_due
    check (overdue_at is null or overdue_at >= due_at),
  constraint content_report_taken_is_whole
    check ((taken_by is null) = (taken_at is null)),
  constraint content_report_in_review_is_taken
    check (status <> 'in_review' or taken_by is not null),
  constraint content_report_resolution_is_whole
    check ((status in ('actioned', 'dismissed')) = (resolution is not null)
       and (resolution is null) = (resolved_by is null)
       and (resolved_by is null) = (resolved_at is null)),
  constraint content_report_dismissed_is_no_action
    check (resolution is null or (status = 'dismissed') = (resolution = 'no_action')),
  constraint content_report_answer_is_whole
    check ((answer_text is null) = (reporter_answered_at is null)),
  constraint content_report_closed_is_answered
    check (status not in ('actioned', 'dismissed') or answer_text is not null)
);

comment on table chat.content_report is
  'PD-57 (A-1, A-2): a report of a message or a person, or the case a block opens (reason blocked). '
  'Never deleted. Reporter, target, note, evidence, created_at and due_at never change; the status only moves forward; '
  'closed only with an answer to the reporter. The reported person is never told (roadmap §5.5). '
  'No request role may read it: the server only, with moderation.view for evidence.';
comment on column chat.content_report.reporter_id is
  'The reporter (reporter_kind: contact | teacher | staff). Null, with reporter_account_id, once the reporter erased their account (chat.erase_account).';
comment on column chat.content_report.evidence is
  'Snapshot at report time (body, attachment object keys, author, timestamps). Kept after the message is deleted and after its author is erased. Never logged.';
comment on column chat.content_report.due_at is
  'created_at + 24 hours (D-1, owner 2026-11-06). At 18 h the responsible managers are told, at 24 h the Super Admin, and overdue_at is set.';

-- One unresolved report per reporter and target (§5.3): a duplicate finds it.
create unique index if not exists content_report_one_open
  on chat.content_report (reporter_kind, reporter_id, target_kind, subject_kind, subject_id,
                          coalesce(message_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('open', 'in_review') and reporter_id is not null;
-- The queue: urgent first ('urgent' < 'normal'), then by time left.
create index if not exists content_report_queue_idx
  on chat.content_report (organization_id, priority, due_at)
  where status in ('open', 'in_review');
-- The 18 h / 24 h sweep, across organizations.
create index if not exists content_report_due_idx
  on chat.content_report (due_at)
  where status in ('open', 'in_review');
-- GET /me/reports and the per-hour limit.
create index if not exists content_report_reporter_idx
  on chat.content_report (reporter_kind, reporter_id, created_at desc)
  where reporter_id is not null;
-- The erasure's anonymisation.
create index if not exists content_report_reporter_account_idx
  on chat.content_report (reporter_account_id)
  where reporter_account_id is not null;
create index if not exists content_report_subject_idx
  on chat.content_report (subject_kind, subject_id, created_at desc);
-- D-3: a department's queue.
create index if not exists content_report_departments_idx
  on chat.content_report using gin (department_ids);
create index if not exists content_report_message_idx
  on chat.content_report (message_id)
  where message_id is not null;

create or replace function chat.guard_content_report()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  c_rank_old integer;
  c_rank_new integer;
begin
  if tg_op = 'DELETE' then
    raise exception 'a report is never deleted' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    -- The clock is the server's: a report cannot be back-dated or given more time.
    new.created_at := now();
    new.due_at := new.created_at + interval '24 hours';
    new.priority := case when new.reason = 'child_safety' then 'urgent' else 'normal' end;
    new.status := 'open';
    if new.overdue_at is not null or new.taken_by is not null or new.taken_at is not null
       or new.resolution is not null or new.resolution_note is not null or new.resolved_by is not null
       or new.resolved_at is not null or new.answer_text is not null or new.reporter_answered_at is not null then
      raise exception 'a new report is open, untaken and unanswered' using errcode = 'check_violation';
    end if;
    if new.reporter_id is null or new.reporter_account_id is null then
      raise exception 'a report names its reporter and the reporter''s account' using errcode = 'check_violation';
    end if;
    -- The reporter is a person of this organization, signed in as that account.
    if not (case new.reporter_kind
             when 'contact' then exists (select 1 from chat.contact c where c.id = new.reporter_id
                                           and c.account_id = new.reporter_account_id and c.organization_id = new.organization_id)
             when 'teacher' then exists (select 1 from chat.teacher t where t.id = new.reporter_id
                                           and t.account_id = new.reporter_account_id and t.organization_id = new.organization_id)
             when 'staff' then exists (select 1 from chat.staff s where s.id = new.reporter_id
                            and s.account_id = new.reporter_account_id and s.organization_id = new.organization_id)
             else true  -- an unknown kind: the column's check refuses it
           end) then
      raise exception 'the reporter is a person of the report''s organization, signed in as that account'
        using errcode = 'check_violation';
    end if;
    -- The subject is a person of this organization.
    if not (case new.subject_kind
             when 'contact' then exists (select 1 from chat.contact c where c.id = new.subject_id and c.organization_id = new.organization_id)
             when 'teacher' then exists (select 1 from chat.teacher t where t.id = new.subject_id and t.organization_id = new.organization_id)
             when 'staff' then exists (select 1 from chat.staff s where s.id = new.subject_id and s.organization_id = new.organization_id)
             else true
           end) then
      raise exception 'the reported person is a person of the report''s organization' using errcode = 'check_violation';
    end if;
    -- A message report is about a person's message, in its own conversation;
    -- system and card messages are the server's and are not reportable (§5).
    -- (A message report without its message or conversation is the shape check's.)
    if new.target_kind = 'message' and new.message_id is not null and new.conversation_id is not null and not exists (
         select 1 from chat.message m
          where m.id = new.message_id and m.conversation_id = new.conversation_id
            and m.organization_id = new.organization_id
            and m.type not in ('system', 'card')
            and m.author_type = new.subject_kind and m.author_id = new.subject_id) then
      raise exception 'a message report is about a person''s own message in that conversation (not a system or card message)'
        using errcode = 'check_violation';
    end if;
    -- Defence in depth for the API's read check (closure plan §6): a parent or a
    -- teacher reports only a message of a conversation they are in now, or were
    -- in when it was sent. (Staff read through coverage and stepping-in rules
    -- that only the API knows; their access is the API's alone.)
    if new.target_kind = 'message' and new.message_id is not null and new.conversation_id is not null
       and new.reporter_kind in ('contact', 'teacher') and not exists (
         select 1 from chat.conversation_member cm
           join chat.message m on m.id = new.message_id
          where cm.conversation_id = new.conversation_id
            and cm.actor_kind = new.reporter_kind and cm.actor_id = new.reporter_id
            and (cm.left_at is null or (cm.joined_at <= m.created_at and cm.left_at >= m.created_at))) then
      raise exception 'a message report is by a member of the message''s conversation' using errcode = 'insufficient_privilege';
    end if;
    -- A person report through a conversation: the reporter is in it.
    if new.target_kind = 'person' and new.conversation_id is not null and new.reporter_kind in ('contact', 'teacher')
       and not exists (select 1 from chat.conversation_member cm
                        where cm.conversation_id = new.conversation_id
                          and cm.actor_kind = new.reporter_kind and cm.actor_id = new.reporter_id) then
      raise exception 'a person report names a conversation the reporter is in' using errcode = 'insufficient_privilege';
    end if;
    -- The departments are departments of this organization.
    if exists (select 1 from unnest(new.department_ids) d(id)
                where not exists (select 1 from chat.department x where x.id = d.id and x.organization_id = new.organization_id)) then
      raise exception 'a report''s departments are departments of its organization' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE.
  -- PD-56 erasure: the reporter reference goes, and nothing else changes.
  if old.reporter_account_id is not null
     and current_setting('chat.erasing_account', true) = old.reporter_account_id::text
     and new.reporter_id is null and new.reporter_account_id is null
     and (to_jsonb(new) - 'reporter_id' - 'reporter_account_id') = (to_jsonb(old) - 'reporter_id' - 'reporter_account_id') then
    return new;
  end if;

  if (new.id, new.organization_id, new.reporter_kind, new.reporter_id, new.reporter_account_id,
      new.target_kind, new.message_id, new.conversation_id, new.subject_kind, new.subject_id,
      new.note, new.evidence, new.created_at, new.due_at, new.department_ids)
     is distinct from
     (old.id, old.organization_id, old.reporter_kind, old.reporter_id, old.reporter_account_id,
      old.target_kind, old.message_id, old.conversation_id, old.subject_kind, old.subject_id,
      old.note, old.evidence, old.created_at, old.due_at, old.department_ids) then
    raise exception 'the reporter, the target, the note, the evidence, the departments and the clock of a report never change'
      using errcode = 'check_violation';
  end if;

  if old.status in ('actioned', 'dismissed') then
    raise exception 'a closed report never changes' using errcode = 'check_violation';
  end if;

  -- The reason stands, with one exception: an unresolved report may be raised
  -- to child_safety (and so to urgent), so a child-safety report from the same
  -- reporter about the same target is never lost to the duplicate rule (§5.2).
  if (new.reason, new.priority) is distinct from (old.reason, old.priority)
     and not (new.reason = 'child_safety' and new.priority = 'urgent' and old.reason <> 'child_safety') then
    raise exception 'a report''s reason only ever rises to child_safety' using errcode = 'check_violation';
  end if;

  c_rank_old := case old.status when 'open' then 0 when 'in_review' then 1 else 2 end;
  c_rank_new := case new.status when 'open' then 0 when 'in_review' then 1 else 2 end;
  if c_rank_new < c_rank_old then
    raise exception 'a report''s status only moves forward' using errcode = 'check_violation';
  end if;

  -- Taken once, marked overdue once, answered once.
  if (old.taken_by is not null and (new.taken_by, new.taken_at) is distinct from (old.taken_by, old.taken_at))
     or (old.overdue_at is not null and new.overdue_at is distinct from old.overdue_at)
     or (old.answer_text is not null
         and (new.answer_text, new.reporter_answered_at) is distinct from (old.answer_text, old.reporter_answered_at)) then
    raise exception 'a report is taken once, marked overdue once and answered once' using errcode = 'check_violation';
  end if;

  -- Whoever takes or resolves it is staff of the report's organization.
  if (new.taken_by is distinct from old.taken_by and not chat.staff_of(new.taken_by, new.organization_id))
     or (new.resolved_by is distinct from old.resolved_by and not chat.staff_of(new.resolved_by, new.organization_id)) then
    raise exception 'a report is taken and resolved by staff of its organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists content_report_is_coherent on chat.content_report;
create trigger content_report_is_coherent
  before insert or update or delete on chat.content_report
  for each row execute function chat.guard_content_report();

-- ===========================================================================
-- 2. chat.actor_block
-- ===========================================================================

create table if not exists chat.actor_block (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null default chat.default_organization_id() references chat.organization (id),
  -- A-2 / §6.1 rule 5: a parent (contact) or a teacher blocks. Staff never do.
  blocker_kind               text not null check (blocker_kind in ('contact', 'teacher')),
  blocker_id                 uuid not null,
  -- The blocker's signed-in account, checked like a reporter's (closure plan §6).
  blocker_account_id         uuid not null references chat.account (id),
  blocked_kind               text not null check (blocked_kind in ('contact', 'teacher', 'staff')),
  blocked_id                 uuid not null,
  created_at                 timestamptz not null default now(),
  -- §6.1 rule 4: the moderation case the block opened (a person report by the
  -- blocker about the blocked person). Set once. The managers told of the block
  -- are chat.actor_block_manager_notice rows (A-2a).
  case_report_id             uuid references chat.content_report (id),

  constraint actor_block_not_self
    check (blocker_kind <> blocked_kind or blocker_id <> blocked_id),
  constraint actor_block_once
    unique (blocker_kind, blocker_id, blocked_kind, blocked_id)
);

comment on table chat.actor_block is
  'PD-57 (A-2): a personal block. The blocker stops seeing the blocked person''s chat messages, notifications and non-lesson calls; '
  'lessons and the administrative channel are never affected (roadmap §6.1, enforced by the API). Staff never block. '
  'Deleting the row unblocks. No request role may read it.';

-- "Who blocked me / who is hidden from whom": the audience filters read by the blocked side.
create index if not exists actor_block_blocked_idx on chat.actor_block (blocked_kind, blocked_id);
create index if not exists actor_block_case_idx on chat.actor_block (case_report_id) where case_report_id is not null;

create or replace function chat.guard_actor_block()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    -- Unblocking is deleting the row; the case it opened stays.
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    if not (case new.blocker_kind
             when 'contact' then exists (select 1 from chat.contact c where c.id = new.blocker_id
                                           and c.account_id = new.blocker_account_id and c.organization_id = new.organization_id)
             when 'teacher' then exists (select 1 from chat.teacher t where t.id = new.blocker_id
                                           and t.account_id = new.blocker_account_id and t.organization_id = new.organization_id)
             else true  -- staff, or an unknown kind: the column's check refuses it
           end)
       or not (case new.blocked_kind
             when 'contact' then exists (select 1 from chat.contact c where c.id = new.blocked_id and c.organization_id = new.organization_id)
             when 'teacher' then exists (select 1 from chat.teacher t where t.id = new.blocked_id and t.organization_id = new.organization_id)
             when 'staff' then exists (select 1 from chat.staff s where s.id = new.blocked_id and s.organization_id = new.organization_id)
             else true
           end) then
      raise exception 'a block is between two people of its organization, made by the blocker''s own account' using errcode = 'check_violation';
    end if;
  elsif (new.id, new.organization_id, new.blocker_kind, new.blocker_id, new.blocker_account_id,
         new.blocked_kind, new.blocked_id, new.created_at)
        is distinct from
        (old.id, old.organization_id, old.blocker_kind, old.blocker_id, old.blocker_account_id,
         old.blocked_kind, old.blocked_id, old.created_at)
     or (old.case_report_id is not null and new.case_report_id is distinct from old.case_report_id) then
    raise exception 'a block never changes; its case is set once'
      using errcode = 'check_violation';
  end if;

  -- The case is the blocker's own report about the blocked person.
  if new.case_report_id is not null and new.case_report_id is distinct from (case when tg_op = 'UPDATE' then old.case_report_id end)
     and not exists (select 1 from chat.content_report r
                      where r.id = new.case_report_id and r.organization_id = new.organization_id
                        and r.target_kind = 'person'
                        and r.reporter_kind = new.blocker_kind and r.reporter_id = new.blocker_id
                        and r.subject_kind = new.blocked_kind and r.subject_id = new.blocked_id) then
    raise exception 'a block''s case is the blocker''s own report about the blocked person' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists actor_block_is_coherent on chat.actor_block;
create trigger actor_block_is_coherent
  before insert or update or delete on chat.actor_block
  for each row execute function chat.guard_actor_block();

-- ===========================================================================
-- 2a. chat.actor_block_manager_notice (A-2a, owner decision 2026-11-04)
-- ===========================================================================
-- When a family blocks someone, every manager responsible for a supervisor of
-- the family's children is told, across departments, once each. The API
-- (ENG-02) works out who they are (roadmap §6.3) and writes one row per manager
-- here; the unique constraint is "no duplicate notice to the same manager for
-- one case" in the database (re-blocking while the case is open re-uses it). A teacher's block is told the same way (§6.3).
--
-- block_id is ON DELETE SET NULL, not CASCADE and not RESTRICT:
--   * CASCADE would erase the record that a manager was told as soon as the
--     family unblocks -- the notice is administrative history, like the audit
--     log, and must outlive the block;
--   * RESTRICT would make unblocking (deleting the actor_block row, §6.2)
--     impossible once anyone was told, or force blocks to become soft-deleted;
--   * SET NULL lets the block go and keeps the notice. Who blocked whom stays
--     readable through case_report_id: the block's case report, which is never
--     deleted (its own guard), so that foreign key can stay a plain RESTRICT.
-- The guard allows exactly that one change (the foreign key nulling block_id
-- after its block is gone); nothing else is ever updated or deleted.

create table if not exists chat.actor_block_manager_notice (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default chat.default_organization_id() references chat.organization (id),
  block_id          uuid references chat.actor_block (id) on delete set null,
  case_report_id    uuid not null references chat.content_report (id),
  manager_staff_id  uuid not null references chat.staff (id),
  notified_at       timestamptz not null default now(),

  -- Once per CASE and manager (closure plan §5, owner 2026-11-06): blocking
  -- again while the case is open re-uses the case and tells nobody again, so
  -- block/unblock cycles cannot flood the managers. A new case (the old one
  -- closed) is a new incident, and is told.
  constraint actor_block_manager_notice_once unique (case_report_id, manager_staff_id)
);

comment on table chat.actor_block_manager_notice is
  'PD-57 A-2a (owner, 2026-11-04): one manager told of one block -- every manager responsible for a supervisor of the '
  'family''s children, across departments, once per case each. Insert-only history; an unblock nulls block_id and the row stays, '
  'tied to the block''s case report. Grants the manager nothing. No request role may read it.';
comment on column chat.actor_block_manager_notice.block_id is
  'The block; null once it is lifted or erased (ON DELETE SET NULL). case_report_id still says who blocked whom.';

create index if not exists actor_block_manager_notice_case_idx
  on chat.actor_block_manager_notice (case_report_id);
create index if not exists actor_block_manager_notice_manager_idx
  on chat.actor_block_manager_notice (manager_staff_id, notified_at desc);

create or replace function chat.guard_actor_block_manager_notice()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.notified_at := now();
    -- About a live block that has its case, in the notice's organization.
    if not exists (select 1 from chat.actor_block b
                    where b.id = new.block_id and b.organization_id = new.organization_id
                      and b.case_report_id is not null and b.case_report_id = new.case_report_id) then
      raise exception 'a block notice is about a block and that block''s case' using errcode = 'check_violation';
    end if;
    if not chat.staff_of(new.manager_staff_id, new.organization_id) then
      raise exception 'the manager told of a block is staff of the organization' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- The one update: the foreign key nulling block_id once its block is gone.
  if tg_op = 'UPDATE'
     and old.block_id is not null and new.block_id is null
     and (to_jsonb(new) - 'block_id') = (to_jsonb(old) - 'block_id')
     and not exists (select 1 from chat.actor_block b where b.id = old.block_id) then
    return new;
  end if;
  raise exception 'a block notice is written once and kept' using errcode = 'check_violation';
end;
$$;

drop trigger if exists actor_block_manager_notice_is_coherent on chat.actor_block_manager_notice;
create trigger actor_block_manager_notice_is_coherent
  before insert or update or delete on chat.actor_block_manager_notice
  for each row execute function chat.guard_actor_block_manager_notice();

-- ===========================================================================
-- 3. The report limit, as operations-tunable configuration (§5.3)
-- ===========================================================================
-- Counted per reporter over a rolling hour from chat.content_report, like
-- PD-32's feedback limits. Not an `abuse.throttle.*` key: those share the
-- 60-second Redis window (abuse.throttle.window_seconds), which cannot say
-- "per hour".

insert into chat.config (key, value, scope, description) values
('report.limit.per_reporter_hour', '10'::jsonb, 'abuse',
 'PD-57 (REPORT_SUBMIT): reports one person may file in a rolling hour; the next is refused (429).')
on conflict (key) do nothing;

insert into chat.config (key, value, scope, description) values
('block.limit.per_blocker_day', '20'::jsonb, 'abuse',
 'PD-57 (closure plan §6): blocks one person may make in a rolling 24 hours; the next is refused (429).')
on conflict (key) do nothing;

-- ===========================================================================
-- 4. Request roles: none (§5.5 rule 8)
-- ===========================================================================

alter table chat.content_report enable row level security;
alter table chat.actor_block enable row level security;
alter table chat.actor_block_manager_notice enable row level security;
revoke all on chat.content_report from public, anon, authenticated, chat_app;
revoke all on chat.actor_block from public, anon, authenticated, chat_app;
revoke all on chat.actor_block_manager_notice from public, anon, authenticated, chat_app;

revoke all on function chat.guard_content_report() from public;
revoke all on function chat.guard_actor_block() from public;
revoke all on function chat.guard_actor_block_manager_notice() from public;

-- ===========================================================================
-- 5. The erasure keeps reports anonymous and removes blocks (§5.5 rule 6, §6.2)
-- ===========================================================================
-- chat.erase_account as 20261102210000 defined it, with the PD-57 lines added
-- before the audit row (and v_kind declared). Nothing else changes; the
-- rollback restores the 20261102210000 text.

create or replace function chat.erase_account(p_account uuid, p_reason text, p_contact_keys text[] default '{}') returns jsonb
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  c_name     constant text := 'Deleted user';
  v_account  chat.account%rowtype;
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_ids      uuid[] := '{}';
  v_keys     text[] := '{}';
  v_tasks    text[] := '{}';
  v_task     uuid;
  v_blocked  text[] := '{}';
  -- PD-57: the principal kind of this account's people (blocks are by kind and id).
  v_kind     text;
  r          record;
begin
  if not chat.caller_is_server_side() then
    raise exception 'only the server erases an account' using errcode = 'insufficient_privilege';
  end if;
  if length(v_reason) not between 1 and 200 then
    raise exception 'erasure requires a reason' using errcode = 'check_violation';
  end if;

  select * into v_account from chat.account where id = p_account for update;
  if v_account.id is null then
    raise exception 'no such account' using errcode = 'no_data_found';
  end if;
  if v_account.kind not in ('family', 'teacher') then
    raise exception 'a staff account is closed by an administrator' using errcode = 'insufficient_privilege';
  end if;
  if v_account.subject like 'erased:%' then
    return jsonb_build_object('kind', v_account.kind, 'alreadyErased', true, 'principalIds', '[]'::jsonb,
                              'avatarKeys', '[]'::jsonb, 'tasks', '[]'::jsonb);
  end if;

  -- A teacher with anything open is refused before anything is written.
  if v_account.kind = 'teacher' then
    for r in select * from chat.teacher where account_id = v_account.id for update loop
      if exists (select 1 from chat.lesson l where l.teacher_id = r.id and l.outcome is null and l.starts_at >= now()) then
        v_blocked := v_blocked || 'future_lessons'::text;
      end if;
      if exists (select 1 from chat.learner l where l.teacher_id = r.id) then
        v_blocked := v_blocked || 'assigned_learners'::text;
      end if;
      if exists (select 1 from chat.lesson l
                  where l.teacher_id = r.id and l.outcome is not null
                    and l.starts_at >= date_trunc('month', now()) - interval '1 month')
         or exists (select 1 from chat.teacher_pay_adjustment a
                     where a.teacher_id = r.id and a.month >= (date_trunc('month', now()) - interval '1 month')::date) then
        v_blocked := v_blocked || 'open_payroll'::text;
      end if;
    end loop;
    if cardinality(v_blocked) > 0 then
      raise exception 'TEACHER_DELETION_BLOCKED: %', array_to_string(v_blocked, ',') using errcode = 'check_violation';
    end if;
  end if;

  -- The login: out of service, its identifier freed, its secrets gone.
  if v_account.status = 'active' then
    perform chat.deactivate_principal('account', v_account.id, 'erased: ' || v_reason, null, 'deactivated');
  else
    update chat.account set status = 'deactivated', is_active = false, deactivated_at = coalesce(deactivated_at, now())
     where id = v_account.id;
  end if;
  update chat.account set subject = 'erased:' || id::text where id = v_account.id;
  delete from chat.account_credential where account_id = v_account.id;
  delete from chat.device where account_id = v_account.id;
  update chat.password_reset_code set superseded_at = now()
   where account_id = v_account.id and used_at is null and superseded_at is null;

  if v_account.kind = 'family' then
    for r in select * from chat.contact where account_id = v_account.id for update loop
      v_ids := v_ids || r.id;
      if r.avatar_object_key is not null then v_keys := v_keys || r.avatar_object_key; end if;
      if r.is_active then
        perform chat.deactivate_principal('contact', r.id, 'erased: ' || v_reason, null, 'deactivated');
      end if;
      update chat.contact set name = c_name, avatar_object_key = null where id = r.id;
      delete from chat.contact_profile where contact_id = r.id;
      delete from chat.parent_file where contact_id = r.id;
      delete from chat.contact_location_prompt where contact_id = r.id;
      update chat.family set primary_contact_id = null where primary_contact_id = r.id;
      -- This parent's own keys only: another parent of the family keeps theirs.
      perform set_config('chat.erasing_family', r.family_id::text, true);
      delete from chat.family_contact_key
       where family_id = r.family_id and key_hash = any (coalesce(p_contact_keys, '{}'::text[]));
      perform set_config('chat.erasing_family', '', true);

      -- Nobody left in the family who can sign in: the children are flagged.
      if not exists (select 1 from chat.contact c join chat.account a on a.id = c.account_id
                      where c.family_id = r.family_id and c.id <> r.id and c.is_active and a.is_active) then
        if exists (select 1 from chat.learner l where l.family_id = r.family_id) then
          v_task := chat.work_task_raise(r.organization_id, 'family_without_account', r.family_id,
                                         chat.work_task_operations_manager(r.organization_id), null,
                                         'high', 'operational', 'none', null);
          v_tasks := v_tasks || ('family_without_account:' || r.family_id::text);
        end if;
      end if;
    end loop;
  else
    for r in select * from chat.teacher where account_id = v_account.id for update loop
      v_ids := v_ids || r.id;
      if r.avatar_object_key is not null then v_keys := v_keys || r.avatar_object_key; end if;
      if r.is_active then
        perform chat.deactivate_principal('teacher', r.id, 'erased: ' || v_reason, null, 'deactivated');
      end if;
      update chat.teacher set name = c_name, avatar_object_key = null where id = r.id;
      -- The admin-only contact goes; the joining date stays with the file.
      update chat.teacher_file set phone = null, email = null where teacher_id = r.id;
      -- The profile's certificate files go from storage with it.
      v_keys := v_keys || coalesce((select array_agg(c.object_key)
                                      from chat.teacher_profile_certificate c
                                      join chat.teacher_professional_profile pp on pp.id = c.profile_id
                                     where pp.teacher_id = r.id), '{}'::text[]);
      delete from chat.teacher_professional_profile where teacher_id = r.id;
      delete from chat.teacher_supervisor_assignment where teacher_id = r.id;
      -- No payroll is open (the gate above), so how they were paid goes.
      delete from chat.teacher_payout_account where teacher_id = r.id;

      -- The department records the departure: a notice to acknowledge, nothing to do.
      v_task := chat.work_task_raise(r.organization_id, 'teacher_account_deleted', r.id,
                                     chat.work_task_teachers_manager(r.organization_id), null,
                                     'medium', 'operational', 'none', null);
      perform chat.work_task_withdraw(r.organization_id, 'teacher_account_deleted:' || r.id::text);
      v_tasks := v_tasks || ('teacher_account_deleted:' || r.id::text);
    end loop;
  end if;

  -- What only this person read or used: their inbox and their push tokens.
  -- Their seats close; what they wrote stays.
  delete from chat.device_token where actor_id = any (v_ids);
  delete from chat.notification_item where recipient_id = any (v_ids);
  delete from chat.notification where recipient_id = any (v_ids);
  update chat.conversation_member set left_at = now() where actor_id = any (v_ids) and left_at is null;

  -- PD-57 (roadmap §5.5 rule 6, §6.2): the reports this person filed are kept
  -- and become anonymous; the blocks they made or received go. Evidence about
  -- them in other people's reports is kept, as the audit log is.
  v_kind := case v_account.kind when 'family' then 'contact' else 'teacher' end;
  perform set_config('chat.erasing_account', v_account.id::text, true);
  update chat.content_report set reporter_id = null, reporter_account_id = null
   where reporter_account_id = v_account.id;
  perform set_config('chat.erasing_account', '', true);
  delete from chat.actor_block
   where (blocker_kind = v_kind and blocker_id = any (v_ids))
      or (blocked_kind = v_kind and blocked_id = any (v_ids));

  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_ids[1], 'account.erased', 'account', v_account.id,
          jsonb_build_object('kind', v_account.kind, 'status', v_account.status),
          jsonb_build_object('principalIds', to_jsonb(v_ids), 'tasks', to_jsonb(v_tasks)),
          v_reason);

  return jsonb_build_object('kind', v_account.kind, 'alreadyErased', false, 'principalIds', to_jsonb(v_ids),
                            'avatarKeys', to_jsonb(v_keys), 'tasks', to_jsonb(v_tasks));
end;
$$;
comment on function chat.erase_account(uuid, text, text[]) is
  'Store compliance: a parent or teacher deletes their own account. Personal data anonymised or deleted; '
  'payments, invoices, receipts, audit and sent messages kept (as "Deleted user"). Returns the principal ids, '
  'the photo object keys the caller deletes from storage, and the tasks raised. Idempotent. '
  'PD-57: the person''s reports are kept, anonymous; their blocks, made and received, are deleted.';
revoke all on function chat.erase_account(uuid, text, text[]) from public;
