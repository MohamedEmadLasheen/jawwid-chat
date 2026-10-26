-- PD-32 (2026-10-26) -- A parent's feedback about their child's teacher
-- (amends PD-26), and a sign-up code that no longer expires by time (amends
-- PD-16).
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-32.
--
-- WHAT IS NEW
--
--   chat.parent_feedback         praise, a suggestion or a complaint a parent
--                                files in the app about their child's teacher.
--                                The teacher is the child's teacher WHEN it was
--                                filed. The parent reads its status and the one
--                                reply staff wrote for them -- never internal
--                                notes. No request role may read it: teachers
--                                have no path to it at all.
--   teacher_supervision_entry    a parent's COMPLAINT also becomes a PD-26
--     complaint_source           complaint (source 'parent_app'), so the handler,
--     'parent_app'               follow-ups, resolution and "uphold -> monthly
--     parent_feedback_id         ladder" are PD-26's, unchanged. It has no staff
--                                author; its handler starts empty and is set
--                                once, by the Teachers department.
--   chat.parent_signup_failure   one wrong sign-up code, by the e-mail's hash
--                                (known e-mail or not, so the cap tells nobody
--                                which e-mails are enrolled). Ten in 24 hours
--                                stop the e-mail until the window rolls or staff
--                                reset it.
--   parent_signup_code           expires_at is null for new codes: a code lives
--     .expires_at nullable       until used, superseded, spent by five wrong
--                                tries, or invalidated. Codes issued before keep
--                                their expiry, so an expired code never returns.
--   invalidation triggers        a password set by ANY path (sign-up, PD-21
--                                reset, PD-25 recovery), or an account that stops
--                                being active, supersedes its live sign-up code.
--
-- FAIL CLOSED. RLS on, no grant to any request role.

-- ===========================================================================
-- 1. Parent feedback
-- ===========================================================================

create table chat.parent_feedback (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  family_id        uuid not null references chat.family (id),
  -- The parent (contact) who filed it.
  contact_id       uuid not null references chat.contact (id),
  learner_id       uuid not null references chat.learner (id),
  -- The child's teacher when it was filed; a later transfer does not move it.
  teacher_id       uuid not null references chat.teacher (id),
  category         text not null check (category in ('praise', 'suggestion', 'complaint')),
  body             text not null check (length(btrim(body)) between 1 and 2000),
  status           text not null default 'received' check (status in ('received', 'in_review', 'resolved')),
  -- The one text the parent reads back. Written deliberately by staff.
  parent_response  text check (parent_response is null or length(btrim(parent_response)) between 1 and 2000),
  responded_by     uuid references chat.staff (id),
  responded_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint parent_feedback_response_is_whole
    check ((parent_response is null) = (responded_by is null) and (responded_by is null) = (responded_at is null))
);

comment on table chat.parent_feedback is
  'PD-32: a parent''s praise, suggestion or complaint about their child''s teacher. Read by the parent (status and parent_response only), the Teachers department, the super admin and the child''s supervisor. Never by the teacher.';

create index parent_feedback_family_idx on chat.parent_feedback (family_id, created_at desc);
create index parent_feedback_org_idx on chat.parent_feedback (organization_id, status, created_at desc);
create index parent_feedback_learner_day_idx on chat.parent_feedback (learner_id, created_at);

create or replace function chat.guard_parent_feedback()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'parent feedback is never deleted' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.status := 'received';
    if new.parent_response is not null then
      raise exception 'new feedback has no reply yet' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1
        from chat.contact c
        join chat.learner l on l.family_id = c.family_id
       where c.id = new.contact_id and c.family_id = new.family_id and c.organization_id = new.organization_id
         and c.is_active
         and l.id = new.learner_id and l.teacher_id = new.teacher_id) then
      raise exception 'feedback is about a child of the parent''s own family and that child''s teacher'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- UPDATE: what the parent wrote never changes; the status only moves forward.
  if (new.id, new.organization_id, new.family_id, new.contact_id, new.learner_id, new.teacher_id,
      new.category, new.body, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.family_id, old.contact_id, old.learner_id, old.teacher_id,
      old.category, old.body, old.created_at) then
    raise exception 'what a parent wrote never changes' using errcode = 'check_violation';
  end if;
  if (case new.status when 'received' then 0 when 'in_review' then 1 else 2 end)
     < (case old.status when 'received' then 0 when 'in_review' then 1 else 2 end) then
    raise exception 'feedback status only moves forward' using errcode = 'check_violation';
  end if;
  if new.responded_by is not null and new.responded_by is distinct from old.responded_by
     and not chat.is_lesson_manager(new.responded_by, new.organization_id) then
    raise exception 'a reply to a parent is written by the Teachers department' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger parent_feedback_is_coherent
  before insert or update or delete on chat.parent_feedback
  for each row execute function chat.guard_parent_feedback();

-- ===========================================================================
-- 2. A parent's complaint is a PD-26 complaint
-- ===========================================================================

alter table chat.teacher_supervision_entry drop constraint teacher_supervision_entry_complaint_source_check;
alter table chat.teacher_supervision_entry add constraint teacher_supervision_entry_complaint_source_check
  check (complaint_source in ('management', 'parent', 'parent_app'));

alter table chat.teacher_supervision_entry
  alter column created_by drop not null,
  add column parent_feedback_id uuid unique references chat.parent_feedback (id);

-- Only a complaint from the app has no staff author, and it always names its feedback.
alter table chat.teacher_supervision_entry add constraint teacher_supervision_entry_parent_app_shape
  check ((coalesce(complaint_source, '') = 'parent_app') = (parent_feedback_id is not null)
     and (created_by is null) = (parent_feedback_id is not null));

create or replace function chat.guard_teacher_supervision_entry()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from chat.teacher t where t.id = new.teacher_id and t.organization_id = new.organization_id) then
    raise exception 'a supervision entry is written by the teacher''s own Teachers department'
      using errcode = 'insufficient_privilege';
  end if;
  if new.parent_feedback_id is not null then
    -- PD-32: the app writes the complaint a parent filed, about that feedback's teacher.
    if new.kind <> 'complaint' or new.handled_by is not null
       or not exists (select 1 from chat.parent_feedback f
                       where f.id = new.parent_feedback_id and f.category = 'complaint'
                         and f.teacher_id = new.teacher_id and f.organization_id = new.organization_id
                         and f.body = new.body) then
      raise exception 'an app complaint is the parent''s own complaint about that teacher'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.created_by is null or not chat.is_lesson_manager(new.created_by, new.organization_id) then
    raise exception 'a supervision entry is written by the teacher''s own Teachers department'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- Append-only, with one exception: an app complaint's handler is set once.
create or replace function chat.guard_teacher_supervision_entry_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.parent_feedback_id is not null and old.handled_by is null and new.handled_by is not null
     and (to_jsonb(new) - 'handled_by') = (to_jsonb(old) - 'handled_by') then
    if not chat.is_lesson_manager(new.handled_by, new.organization_id) then
      raise exception 'a complaint is handled by the Teachers department' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  raise exception '% rows are append-only', tg_table_name using errcode = 'check_violation';
end;
$$;

drop trigger teacher_supervision_entry_is_append_only on chat.teacher_supervision_entry;
create trigger teacher_supervision_entry_is_append_only before update or delete on chat.teacher_supervision_entry
  for each row execute function chat.guard_teacher_supervision_entry_change();

-- ===========================================================================
-- 3. The sign-up code lives until used or invalidated
-- ===========================================================================

alter table chat.parent_signup_code alter column expires_at drop not null;
alter table chat.parent_signup_code drop constraint parent_signup_code_expires_after_creation;
alter table chat.parent_signup_code add constraint parent_signup_code_expires_after_creation
  check (expires_at is null or expires_at > created_at);

comment on table chat.parent_signup_code is
  'PD-16, amended by PD-32: a one-time code letting a parent set the password of the account Chat created for them. No time expiry (expires_at is null from PD-32 on): single-use, one live per account, superseded by a new code, by five wrong tries, by staff, by any password being set, or by the account leaving active. The plain code is kept only while a supervisor relays it.';

create or replace function chat.guard_parent_signup_code()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a sign-up code is never deleted' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from chat.account a where a.id = new.account_id and a.organization_id = new.organization_id
                      and a.kind = 'family')
       or not exists (select 1 from chat.student_enrolment e where e.account_id = new.account_id) then
      raise exception 'a sign-up code is for a parent account Chat created at enrolment' using errcode = 'check_violation';
    end if;
    if exists (select 1 from chat.account_credential c where c.account_id = new.account_id) then
      raise exception 'this parent has already signed up' using errcode = 'check_violation';
    end if;
    new.created_at := now();
    -- PD-32: no time expiry. A code is issued without one.
    if new.expires_at is not null then
      raise exception 'a sign-up code has no time expiry (PD-32)' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (new.id, new.organization_id, new.account_id, new.code_hash, new.delivery, new.created_at, new.expires_at)
     is distinct from
     (old.id, old.organization_id, old.account_id, old.code_hash, old.delivery, old.created_at, old.expires_at) then
    raise exception 'a sign-up code''s identity never changes' using errcode = 'check_violation';
  end if;
  if new.attempts < old.attempts
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
     or (old.relay_code is null and new.relay_code is not null) then
    raise exception 'a sign-up code only moves forward' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- A password set by any path ends the sign-up: the live code is superseded.
create or replace function chat.supersede_signup_code_on_credential()
returns trigger
language plpgsql
as $$
begin
  update chat.parent_signup_code
     set superseded_at = now(), relay_code = null
   where account_id = new.account_id and used_at is null and superseded_at is null;
  return new;
end;
$$;

create trigger account_credential_ends_signup_code after insert on chat.account_credential
  for each row execute function chat.supersede_signup_code_on_credential();

-- An account that is suspended or deactivated has no live sign-up code.
create or replace function chat.supersede_signup_code_on_account()
returns trigger
language plpgsql
as $$
begin
  if not new.is_active or new.status <> 'active' then
    update chat.parent_signup_code
       set superseded_at = now(), relay_code = null
     where account_id = new.id and used_at is null and superseded_at is null;
  end if;
  return new;
end;
$$;

create trigger account_inactive_ends_signup_code after update of is_active, status on chat.account
  for each row execute function chat.supersede_signup_code_on_account();

-- ===========================================================================
-- 4. The wrong-code cap: ten in 24 hours per e-mail, across all codes
-- ===========================================================================

create table chat.parent_signup_failure (
  id            uuid primary key default gen_random_uuid(),
  -- subjectHash() of the e-mail the parent typed: never the e-mail itself.
  subject_hash  text not null check (subject_hash ~ '^[0-9a-f]{32}$'),
  created_at    timestamptz not null default now(),
  -- Staff "Reset attempts" clears the window; the row stays.
  cleared_at    timestamptz,
  cleared_by    uuid references chat.staff (id),
  constraint parent_signup_failure_clear_is_whole check ((cleared_at is null) = (cleared_by is null))
);

comment on table chat.parent_signup_failure is
  'PD-32: one wrong parent sign-up code, by e-mail hash. Ten uncleared in 24 hours refuse further tries for that e-mail. Cleared (never deleted) by staff Reset attempts.';

create index parent_signup_failure_subject_idx on chat.parent_signup_failure (subject_hash, created_at);

create or replace function chat.guard_parent_signup_failure()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a sign-up failure is never deleted' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.cleared_at := null;
    new.cleared_by := null;
    return new;
  end if;
  if (new.id, new.subject_hash, new.created_at) is distinct from (old.id, old.subject_hash, old.created_at)
     or old.cleared_at is not null then
    raise exception 'a sign-up failure is only cleared, once' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger parent_signup_failure_is_coherent
  before insert or update or delete on chat.parent_signup_failure
  for each row execute function chat.guard_parent_signup_failure();

-- ===========================================================================
-- 5. The limits, as operations-tunable configuration
-- ===========================================================================

insert into chat.config (key, value, scope, description) values
('feedback.limit.per_child_day', '3'::jsonb, 'abuse',
 'PD-32: feedback a parent may file about one child in a rolling 24 hours.'),
('feedback.limit.per_family_day', '10'::jsonb, 'abuse',
 'PD-32: feedback one family may file in a rolling 24 hours, all children together.'),
('signup.wrong_codes_per_day', '10'::jsonb, 'abuse',
 'PD-32: wrong sign-up codes one e-mail may enter in a rolling 24 hours, across all its codes, '
 'before further tries are refused until the window rolls or staff reset it.')
on conflict (key) do nothing;

-- ===========================================================================
-- 6. Request roles: none
-- ===========================================================================

alter table chat.parent_feedback enable row level security;
alter table chat.parent_signup_failure enable row level security;
revoke all on chat.parent_feedback from public, anon, authenticated, chat_app;
revoke all on chat.parent_signup_failure from public, anon, authenticated, chat_app;

revoke all on function chat.guard_parent_feedback() from public;
revoke all on function chat.guard_teacher_supervision_entry_change() from public;
revoke all on function chat.supersede_signup_code_on_credential() from public;
revoke all on function chat.supersede_signup_code_on_account() from public;
revoke all on function chat.guard_parent_signup_failure() from public;
