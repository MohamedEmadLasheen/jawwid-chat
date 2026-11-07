-- =============================================================================
-- PD-56 · O-3 (owner, 2026-11-07): a teacher's account deletion request.
-- "The teacher requests deletion in the app; staff close the lessons and
-- payroll; the account is deleted within 30 days." (App Store 5.1.1(v),
-- Google Play account deletion; store-readiness 2026-11-03 blocker 4.)
--
-- Before: a teacher with a future lesson, an assigned student or open payroll
-- was refused (TEACHER_DELETION_BLOCKED, "contact the academy"). Now:
--
--   * Nothing open: deleted at once, exactly as before (chat.erase_account).
--   * Something open: a REQUEST is recorded instead, and the account is
--     deleted within 30 days, always.
--
-- WHAT IS NEW
--   chat.account_deletion_request   one row per request: requested_at and
--       deadline_at (requested_at + 30 days, both from the database clock),
--       what was open when it was asked (open_items), the state
--       (pending -> completed | cancelled, never back), and who completed it,
--       how (staff | deadline | holder) and when; what was still open then
--       (left_open). One pending request per account. Never deleted: it is the
--       record that the commitment was kept. Ids only, no personal data.
--   chat.account_deletion_reminder  the worker's day-21 and day-28 markers,
--       one per request and day (the reminders are deduped on it and on the
--       PD-34 dedupe key per recipient).
--   chat.teacher_deletion_open_items(account)  what blocks an immediate
--       deletion, the one definition the erasure and the request share.
--   chat.request_account_deletion(account)     idempotent: the pending
--       request, or a new one with its PD-47 task (teacher_deletion_request,
--       for the Teachers manager, due at the deadline) and its audit row.
--   chat.cancel_account_deletion_request(account)  the holder, while pending.
--   chat.complete_account_deletion_request(request, staff, via)  staff (the
--       Teacher File's "Close and delete account") or the worker at the
--       deadline: the request is completed, then the SAME erasure runs past the
--       open-items gate.
--   chat.erase_account  as 20261104100000 defined it, with three changes: the
--       gate reads chat.teacher_deletion_open_items; it is passed only by
--       chat.complete_account_deletion_request (chat.erasing_on_request); a
--       pending request is completed by the holder's own immediate deletion;
--       and a forced erasure that leaves work open raises the
--       teacher_account_deleted notice as high, so staff see it first.
--
-- WHAT A FORCED ERASURE (staff completion, or the deadline) DOES WITH WHAT IS OPEN
--   Future lessons: chat.lesson.teacher_id is NOT NULL, so they cannot be left
--       unassigned. They stay on the anonymised teacher ("Deleted user"),
--       untouched (never cancelled: cancelling tells families and loses the
--       booking). They are flagged: left_open counts them, and the Teachers
--       manager's teacher_account_deleted notice is raised high and shows the
--       students and lessons still on the teacher.
--   Assigned students: stay assigned to the anonymised teacher (moving a
--       student is a staff decision with its own rules); flagged the same way.
--   Payroll rows (held lessons, pay adjustments): KEPT, unchanged, attributed
--       to "Deleted user", as every financial record of the erasure is. The
--       payout account goes, as the erasure already defines: the staff were
--       told at the request and reminded at days 21 and 28 to settle first.
--   Retention is unchanged: what the erasure keeps and deletes is 20261102210000's.
--
-- FAIL CLOSED: RLS on, no policy, no grant to any request role on either
-- table. Only the API's server-side connection reads or writes them, through
-- apps/api/src/account-deletion. One guard trigger function per table.
--
-- Idempotent (G-19). Rollback:
-- db/rollback/20261107140000_chat_teacher_deletion_request.down.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. chat.account_deletion_request
-- ---------------------------------------------------------------------------
create table if not exists chat.account_deletion_request (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references chat.organization (id),
  account_id      uuid not null references chat.account (id),
  teacher_id      uuid not null references chat.teacher (id),
  state           text not null default 'pending' check (state in ('pending', 'completed', 'cancelled')),
  requested_at    timestamptz not null default now(),
  deadline_at     timestamptz not null,
  -- What blocked an immediate deletion when it was asked (future_lessons,
  -- assigned_learners, open_payroll).
  open_items      text[] not null default '{}',
  completed_at    timestamptz,
  -- The staff member who completed it; null at the deadline and for the holder.
  completed_by    uuid references chat.staff (id),
  completed_via   text check (completed_via is null or completed_via in ('staff', 'deadline', 'holder')),
  -- What was still open at completion: { futureLessons, assignedLearners, openPayroll }.
  left_open       jsonb,
  cancelled_at    timestamptz,
  constraint account_deletion_request_deadline check (deadline_at = requested_at + interval '30 days'),
  constraint account_deletion_request_completed_shape check (
    (state = 'completed') = (completed_at is not null and completed_via is not null)
    and (completed_by is null or completed_via = 'staff')
    and (completed_via is distinct from 'staff' or completed_by is not null)),
  constraint account_deletion_request_cancelled_shape check ((state = 'cancelled') = (cancelled_at is not null))
);

comment on table chat.account_deletion_request is
  'PD-56 O-3: a teacher asked to delete their account while lessons, students or payroll were open. Deleted by '
  'deadline_at (requested_at + 30 days) at the latest: by staff, by the worker, or by the holder once nothing is open. '
  'Never deleted. No request role reads it.';

create unique index if not exists account_deletion_request_one_pending
  on chat.account_deletion_request (account_id) where state = 'pending';
create index if not exists account_deletion_request_due_idx
  on chat.account_deletion_request (deadline_at) where state = 'pending';
create index if not exists account_deletion_request_teacher_idx
  on chat.account_deletion_request (teacher_id, requested_at desc);

create or replace function chat.guard_account_deletion_request()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_kind text;
  v_org  uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'a deletion request is never deleted' using errcode = 'check_violation';
  end if;
  if not chat.caller_is_server_side() then
    raise exception 'only the server records a deletion request' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    select a.kind into v_kind from chat.account a where a.id = new.account_id;
    select t.organization_id into v_org from chat.teacher t where t.id = new.teacher_id and t.account_id = new.account_id;
    if v_kind is distinct from 'teacher' or v_org is null then
      raise exception 'a deletion request is a teacher''s, for their own account' using errcode = 'check_violation';
    end if;
    new.organization_id := v_org;
    new.state := 'pending';
    -- The database's clock, never the caller's.
    new.requested_at := now();
    new.deadline_at := now() + interval '30 days';
    new.completed_at := null;
    new.completed_by := null;
    new.completed_via := null;
    new.left_open := null;
    new.cancelled_at := null;
    return new;
  end if;

  -- UPDATE: only pending -> completed | cancelled, once; the request itself never changes.
  if (new.id, new.organization_id, new.account_id, new.teacher_id, new.requested_at, new.deadline_at, new.open_items)
     is distinct from
     (old.id, old.organization_id, old.account_id, old.teacher_id, old.requested_at, old.deadline_at, old.open_items) then
    raise exception 'a deletion request never changes what was asked' using errcode = 'check_violation';
  end if;
  if old.state <> 'pending' then
    raise exception 'a % deletion request never changes', old.state using errcode = 'check_violation';
  end if;
  if new.state = 'completed' then
    new.completed_at := now();
    new.cancelled_at := null;
  elsif new.state = 'cancelled' then
    new.cancelled_at := now();
    new.completed_at := null;
    new.completed_by := null;
    new.completed_via := null;
    new.left_open := null;
  else
    raise exception 'a pending deletion request is completed or cancelled' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists account_deletion_request_is_coherent on chat.account_deletion_request;
create trigger account_deletion_request_is_coherent
  before insert or update or delete on chat.account_deletion_request
  for each row execute function chat.guard_account_deletion_request();

alter table chat.account_deletion_request enable row level security;
revoke all on chat.account_deletion_request from public, anon, authenticated, chat_app;
revoke all on function chat.guard_account_deletion_request() from public;

-- ---------------------------------------------------------------------------
-- 2. chat.account_deletion_reminder
-- ---------------------------------------------------------------------------
create table if not exists chat.account_deletion_reminder (
  request_id  uuid not null references chat.account_deletion_request (id),
  day         smallint not null check (day in (21, 28)),
  created_at  timestamptz not null default now(),
  primary key (request_id, day)
);

comment on table chat.account_deletion_reminder is
  'PD-56 O-3: a deletion request''s day-21 or day-28 reminder to staff, once each. Insert-only; '
  'the worker''s marker (TeacherDeletionRequestService.sweep). No request role reads it.';

create or replace function chat.guard_account_deletion_reminder()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a deletion reminder is never changed or deleted' using errcode = 'check_violation';
  end if;
  new.created_at := now();
  if not exists (select 1 from chat.account_deletion_request r where r.id = new.request_id and r.state = 'pending') then
    raise exception 'a reminder is for a pending deletion request' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists account_deletion_reminder_is_coherent on chat.account_deletion_reminder;
create trigger account_deletion_reminder_is_coherent
  before insert or update or delete on chat.account_deletion_reminder
  for each row execute function chat.guard_account_deletion_reminder();

alter table chat.account_deletion_reminder enable row level security;
revoke all on chat.account_deletion_reminder from public, anon, authenticated, chat_app;
revoke all on function chat.guard_account_deletion_reminder() from public;

-- ---------------------------------------------------------------------------
-- 3. What blocks an immediate deletion (the gate 20261102210000 wrote inline)
-- ---------------------------------------------------------------------------
create or replace function chat.teacher_deletion_open_items(p_account uuid)
returns text[]
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_items text[] := '{}';
  r       record;
begin
  for r in select t.id from chat.teacher t where t.account_id = p_account loop
    if exists (select 1 from chat.lesson l where l.teacher_id = r.id and l.outcome is null and l.starts_at >= now())
       and not 'future_lessons' = any (v_items) then
      v_items := v_items || 'future_lessons'::text;
    end if;
    if exists (select 1 from chat.learner l where l.teacher_id = r.id) and not 'assigned_learners' = any (v_items) then
      v_items := v_items || 'assigned_learners'::text;
    end if;
    if (exists (select 1 from chat.lesson l
                 where l.teacher_id = r.id and l.outcome is not null
                   and l.starts_at >= date_trunc('month', now()) - interval '1 month')
        or exists (select 1 from chat.teacher_pay_adjustment a
                    where a.teacher_id = r.id and a.month >= (date_trunc('month', now()) - interval '1 month')::date))
       and not 'open_payroll' = any (v_items) then
      v_items := v_items || 'open_payroll'::text;
    end if;
  end loop;
  return v_items;
end;
$$;
revoke all on function chat.teacher_deletion_open_items(uuid) from public;

-- What is still on the teacher, counted: the request's left_open, the notice's level.
create or replace function chat.teacher_deletion_left_open(p_account uuid)
returns jsonb
language sql
stable
set search_path = chat, pg_temp
as $$
  select jsonb_build_object(
    'futureLessons', (select count(*)::int from chat.lesson l join chat.teacher t on t.id = l.teacher_id
                       where t.account_id = p_account and l.outcome is null and l.starts_at >= now()),
    'assignedLearners', (select count(*)::int from chat.learner l join chat.teacher t on t.id = l.teacher_id
                          where t.account_id = p_account),
    'openPayroll', 'open_payroll' = any (chat.teacher_deletion_open_items(p_account)));
$$;
revoke all on function chat.teacher_deletion_left_open(uuid) from public;

-- ---------------------------------------------------------------------------
-- 4. The request: made, cancelled, completed
-- ---------------------------------------------------------------------------
create or replace function chat.account_deletion_request_json(r chat.account_deletion_request)
returns jsonb
language sql
immutable
set search_path = chat, pg_temp
as $$
  select jsonb_build_object('id', r.id, 'state', r.state, 'requestedAt', r.requested_at, 'deadlineAt', r.deadline_at,
                            'openItems', to_jsonb(r.open_items), 'completedAt', r.completed_at,
                            'completedVia', r.completed_via, 'cancelledAt', r.cancelled_at);
$$;
revoke all on function chat.account_deletion_request_json(chat.account_deletion_request) from public;

-- The holder asks (the API proved the password). The pending request if there
-- is one -- asking again changes nothing --, else a new one, its task and its
-- audit row. Refused when nothing is open: that is an immediate deletion.
create or replace function chat.request_account_deletion(p_account uuid)
returns jsonb
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_teacher chat.teacher;
  v_items   text[];
  v_req     chat.account_deletion_request;
  v_owner   uuid;
begin
  if not chat.caller_is_server_side() then
    raise exception 'only the server records a deletion request' using errcode = 'insufficient_privilege';
  end if;
  -- One writer per account: two taps at once make one request.
  perform 1 from chat.account a where a.id = p_account and a.kind = 'teacher' and a.subject not like 'erased:%' for update;
  if not found then
    raise exception 'a deletion request is a teacher''s, for their own account' using errcode = 'check_violation';
  end if;
  select * into v_req from chat.account_deletion_request where account_id = p_account and state = 'pending';
  if v_req.id is not null then
    return chat.account_deletion_request_json(v_req) || jsonb_build_object('created', false);
  end if;
  select * into v_teacher from chat.teacher where account_id = p_account;
  v_items := chat.teacher_deletion_open_items(p_account);
  if cardinality(v_items) = 0 then
    raise exception 'nothing is open: the account is deleted at once' using errcode = 'check_violation';
  end if;

  insert into chat.account_deletion_request (account_id, teacher_id, deadline_at, open_items)
  values (p_account, v_teacher.id, now() + interval '30 days', v_items)
  returning * into v_req;

  -- The Teachers manager (else the super admin) closes the lessons and payroll, by the deadline.
  v_owner := chat.work_task_teachers_manager(v_req.organization_id);
  if v_owner is null then
    perform chat.work_task_note_issue(v_req.organization_id, 'teacher_deletion_request:' || v_req.id,
                                      'no live Teachers manager or super admin');
  else
    perform chat.work_task_raise(v_req.organization_id, 'teacher_deletion_request', v_req.id, v_owner, null,
                                 'high', 'operational', 'generic', v_req.deadline_at);
  end if;

  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_teacher.id, 'account_deletion_request.created', 'account_deletion_request', v_req.id, null,
          jsonb_build_object('accountId', p_account, 'deadlineAt', v_req.deadline_at, 'openItems', to_jsonb(v_items)),
          'requested by the account holder');
  return chat.account_deletion_request_json(v_req) || jsonb_build_object('created', true);
end;
$$;
revoke all on function chat.request_account_deletion(uuid) from public;

-- The holder changes their mind while it is pending. The task stays open,
-- marked withdrawn (PD-47: a person closes it).
create or replace function chat.cancel_account_deletion_request(p_account uuid)
returns jsonb
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_req chat.account_deletion_request;
begin
  if not chat.caller_is_server_side() then
    raise exception 'only the server records a deletion request' using errcode = 'insufficient_privilege';
  end if;
  select * into v_req from chat.account_deletion_request where account_id = p_account and state = 'pending' for update;
  if v_req.id is null then
    raise exception 'no pending deletion request' using errcode = 'no_data_found';
  end if;
  update chat.account_deletion_request set state = 'cancelled' where id = v_req.id returning * into v_req;
  perform chat.work_task_withdraw(v_req.organization_id, 'teacher_deletion_request:' || v_req.id);
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_req.teacher_id, 'account_deletion_request.cancelled', 'account_deletion_request', v_req.id,
          jsonb_build_object('state', 'pending'), jsonb_build_object('state', 'cancelled'),
          'cancelled by the account holder');
  return chat.account_deletion_request_json(v_req);
end;
$$;
revoke all on function chat.cancel_account_deletion_request(uuid) from public;

-- Marks a pending request completed, settles its task and audits it. Called by
-- chat.complete_account_deletion_request and by chat.erase_account (holder).
create or replace function chat.account_deletion_request_close(p_request uuid, p_via text, p_staff uuid, p_left jsonb)
returns void
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_req chat.account_deletion_request;
begin
  update chat.account_deletion_request
     set state = 'completed', completed_via = p_via, completed_by = p_staff, left_open = p_left
   where id = p_request and state = 'pending'
   returning * into v_req;
  if v_req.id is null then
    return;
  end if;
  -- A source names who did its work (PD-47): the staff member; the holder, for
  -- their own deletion (still live here: the erasure comes after); at the
  -- deadline, the task's assignee, as chat.work_task_sweep_erasure does.
  perform chat.work_task_settle(
    v_req.organization_id, 'teacher_deletion_request:' || v_req.id,
    case p_via when 'staff' then p_staff
               when 'holder' then v_req.teacher_id
               else (select coalesce(t.assignee_staff_id, t.assignee_teacher_id) from chat.work_task t
                      where t.organization_id = v_req.organization_id
                        and t.source_key = 'teacher_deletion_request:' || v_req.id) end);
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (case p_via when 'staff' then p_staff when 'holder' then v_req.teacher_id end,
          'account_deletion_request.completed', 'account_deletion_request', v_req.id,
          jsonb_build_object('state', 'pending'),
          jsonb_build_object('state', 'completed', 'via', p_via, 'leftOpen', p_left),
          case p_via when 'staff' then 'closed and deleted by staff'
                     when 'deadline' then 'deleted at the 30-day deadline'
                     else 'deleted by the account holder once nothing was open' end);
end;
$$;
revoke all on function chat.account_deletion_request_close(uuid, text, uuid, jsonb) from public;

-- Staff (via 'staff', p_staff the actor; the API checked who may) or the worker
-- at the deadline (via 'deadline', p_staff null, only once deadline_at passed):
-- the request is completed, then the same erasure runs past the gate.
create or replace function chat.complete_account_deletion_request(p_request uuid, p_staff uuid, p_via text)
returns jsonb
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_req     chat.account_deletion_request;
  v_left    jsonb;
  v_erasure jsonb;
begin
  if not chat.caller_is_server_side() then
    raise exception 'only the server completes a deletion request' using errcode = 'insufficient_privilege';
  end if;
  if p_via not in ('staff', 'deadline') or (p_via = 'staff') <> (p_staff is not null) then
    raise exception 'a deletion request is completed by staff or at its deadline' using errcode = 'check_violation';
  end if;
  -- The account first, then the request: the order chat.erase_account (the
  -- holder's own deletion) and chat.request_account_deletion take them in.
  perform 1 from chat.account a
   where a.id = (select q.account_id from chat.account_deletion_request q where q.id = p_request)
     for update;
  select * into v_req from chat.account_deletion_request where id = p_request for update;
  if v_req.id is null then
    raise exception 'no such deletion request' using errcode = 'no_data_found';
  end if;
  if v_req.state <> 'pending' then
    raise exception 'this deletion request is %', v_req.state using errcode = 'check_violation';
  end if;
  if p_via = 'deadline' and v_req.deadline_at > now() then
    raise exception 'this deletion request is not due yet' using errcode = 'check_violation';
  end if;
  if p_via = 'staff' and not exists (select 1 from chat.staff s where s.id = p_staff and s.organization_id = v_req.organization_id
                                                                   and s.is_active and s.left_at is null) then
    raise exception 'a deletion request is completed by live staff of its organization' using errcode = 'insufficient_privilege';
  end if;

  v_left := chat.teacher_deletion_left_open(v_req.account_id);
  perform chat.account_deletion_request_close(v_req.id, p_via, p_staff, v_left);
  perform set_config('chat.erasing_on_request', v_req.account_id::text, true);
  v_erasure := chat.erase_account(v_req.account_id,
                                  case p_via when 'staff' then 'deletion request closed by staff'
                                             else 'deletion request reached its 30-day deadline' end,
                                  '{}'::text[]);
  perform set_config('chat.erasing_on_request', '', true);
  return v_erasure || jsonb_build_object('requestId', v_req.id, 'leftOpen', v_left);
end;
$$;
revoke all on function chat.complete_account_deletion_request(uuid, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 5. chat.erase_account (as 20261104100000, with the O-3 changes marked)
-- ---------------------------------------------------------------------------
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
  -- O-3: past the gate only through chat.complete_account_deletion_request.
  v_forced   boolean := false;
  v_left     jsonb;
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

  -- A teacher with anything open is refused before anything is written --
  -- unless a deletion request is being completed (O-3: the 30-day commitment).
  if v_account.kind = 'teacher' then
    perform 1 from chat.teacher where account_id = v_account.id for update;
    v_blocked := chat.teacher_deletion_open_items(v_account.id);
    if cardinality(v_blocked) > 0 then
      if coalesce(current_setting('chat.erasing_on_request', true), '') = v_account.id::text then
        v_forced := true;
        v_left := chat.teacher_deletion_left_open(v_account.id);
      else
        raise exception 'TEACHER_DELETION_BLOCKED: %', array_to_string(v_blocked, ',') using errcode = 'check_violation';
      end if;
    end if;
    -- O-3: the holder's own deletion, once nothing is open, completes their pending request.
    for r in select q.id from chat.account_deletion_request q where q.account_id = v_account.id and q.state = 'pending' loop
      perform chat.account_deletion_request_close(r.id, 'holder', null, chat.teacher_deletion_left_open(v_account.id));
    end loop;
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
      -- How they were paid goes (the gate, or the request's 30 days, closed the payroll first).
      delete from chat.teacher_payout_account where teacher_id = r.id;

      -- The department records the departure: a notice to acknowledge. O-3: a
      -- forced erasure that left lessons or students on the teacher is high,
      -- so the Teachers manager sees it first and moves them.
      v_task := chat.work_task_raise(r.organization_id, 'teacher_account_deleted', r.id,
                                     chat.work_task_teachers_manager(r.organization_id), null,
                                     case when v_forced and ((v_left ->> 'futureLessons')::int > 0
                                                             or (v_left ->> 'assignedLearners')::int > 0)
                                          then 'high' else 'medium' end,
                                     'operational', 'none', null);
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
          jsonb_build_object('principalIds', to_jsonb(v_ids), 'tasks', to_jsonb(v_tasks))
            || case when v_forced then jsonb_build_object('onRequest', true, 'leftOpen', v_left) else '{}'::jsonb end,
          v_reason);

  return jsonb_build_object('kind', v_account.kind, 'alreadyErased', false, 'principalIds', to_jsonb(v_ids),
                            'avatarKeys', to_jsonb(v_keys), 'tasks', to_jsonb(v_tasks));
end;
$$;
comment on function chat.erase_account(uuid, text, text[]) is
  'Store compliance: a parent or teacher deletes their own account. Personal data anonymised or deleted; '
  'payments, invoices, receipts, audit and sent messages kept (as "Deleted user"). Returns the principal ids, '
  'the photo object keys the caller deletes from storage, and the tasks raised. Idempotent. '
  'PD-57: the person''s reports are kept, anonymous; their blocks, made and received, are deleted. '
  'O-3: a teacher with something open is erased only through chat.complete_account_deletion_request.';
revoke all on function chat.erase_account(uuid, text, text[]) from public;

-- ---------------------------------------------------------------------------
-- 6. The reminders' rules and texts (TeacherDeletionRequestService sends them)
-- ---------------------------------------------------------------------------
-- Fixed texts, no placeholder: the push names no teacher (a lock screen is not
-- behind sign-in); the task, opened in Tasks, says who.
insert into chat.notification_rule
  (key, event_type, offset_seconds, template_key, recipient_role, channel, priority, respect_quiet_hours) values
  ('teacher_deletion_day21', 'teacher_deletion_day21', 0, 'teacher_deletion_day21', 'staff', 'push', 'normal', true),
  ('teacher_deletion_day28', 'teacher_deletion_day28', 0, 'teacher_deletion_day28', 'staff', 'push', 'high',   true)
on conflict (key) do nothing;

-- DRAFT copy for the owner's review. Arabic first.
insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('teacher_deletion_day21', 'ar', 'جَوِّد', 'طلب حذف حساب معلم ما زال مفتوحًا، ويُحذف الحساب خلال 9 أيام.'),
    ('teacher_deletion_day21', 'en', 'Jawwid', 'A teacher''s account deletion request is still open; the account is deleted in 9 days.'),
    ('inbox.teacher_deletion_day21', 'ar', 'طلب حذف حساب معلم', 'ما زال طلب حذف حساب معلم مفتوحًا. أغلق دروسه ورواتبه، فالحساب يُحذف تلقائيًا خلال 9 أيام. افتح المهمة.'),
    ('inbox.teacher_deletion_day21', 'en', 'Teacher account deletion', 'A teacher''s account deletion request is still open. Close their lessons and payroll: the account is deleted automatically in 9 days. Open the task.'),
    ('teacher_deletion_day28', 'ar', 'جَوِّد', 'يُحذف حساب معلم تلقائيًا خلال يومين.'),
    ('teacher_deletion_day28', 'en', 'Jawwid', 'A teacher''s account is deleted automatically in 2 days.'),
    ('inbox.teacher_deletion_day28', 'ar', 'حذف حساب معلم خلال يومين', 'يُحذف حساب معلم طلب الحذف تلقائيًا خلال يومين. أغلق دروسه ورواتبه الآن. افتح المهمة.'),
    ('inbox.teacher_deletion_day28', 'en', 'Teacher account deleted in 2 days', 'A teacher who asked to delete their account is deleted automatically in 2 days. Close their lessons and payroll now. Open the task.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);

-- ---------------------------------------------------------------------------
-- 7. Prove it inside the migration: fail closed
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_role text;
  v_table text;
begin
  foreach v_table in array array['chat.account_deletion_request', 'chat.account_deletion_reminder'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = v_table::regclass) then
      raise exception 'O-3: % must have row-level security on', v_table;
    end if;
    if exists (select 1 from pg_policies p where p.schemaname || '.' || p.tablename = v_table) then
      raise exception 'O-3: % must have no policy', v_table;
    end if;
    foreach v_role in array array['chat_app', 'authenticated', 'anon'] loop
      if exists (select 1 from pg_roles where rolname = v_role)
         and (has_table_privilege(v_role, v_table, 'SELECT') or has_table_privilege(v_role, v_table, 'INSERT')
              or has_table_privilege(v_role, v_table, 'UPDATE') or has_table_privilege(v_role, v_table, 'DELETE')) then
        raise exception 'O-3: % can reach %', v_role, v_table;
      end if;
    end loop;
  end loop;
end
$assert$;
