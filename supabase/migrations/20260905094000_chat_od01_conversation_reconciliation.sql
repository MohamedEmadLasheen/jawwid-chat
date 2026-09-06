-- Jawwid Chat -- OD-01 structural reconciliation.
--
-- AUTHORITY
--   docs/product/jawwid-chat-prd-v0.1.md (sha256 3e63ec…a1b697), plus the
--   product-owner decisions C-1..C-4 of 2026-09-06 recorded in
--   docs/release/od-01-conversation-model.md §14.
--
-- WHAT THIS MIGRATION DOES
--   1. Makes chat.conversation the ONLY parent of a message, and drops
--      chat.thread. PRD §6 has no thread entity; §7.5 requires many
--      conversations per family; §7.3 requires one Student Group per STUDENT.
--      chat.thread carried the superseded brief's `family_id UNIQUE` invariant
--      and made both requirements unrepresentable.
--   2. Removes chat.support_case. PRD §6's entity list has no Case, and C-3
--      decides: "There is NO Case domain entity in Jawwid Chat MVP."
--   3. Re-expresses everything that depended on Case against the PRD's own
--      model -- Task (§7.6), Conversation state (§7.5), Attention (§5.4) and
--      Workload (§5.3).
--   4. Constrains conversation.family_id so a customer-facing conversation is
--      always family-scoped, while a Teacher<->Admin `direct` conversation
--      (C-2) may legitimately have none.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It does not add organization_id (PRD §2.3) -- out of the requested scope.
--   * It does not re-key attention/workload onto the conversation as their
--     primary subject (PRD §5.4/§6) -- that is a separate, larger change. This
--     migration only removes their dependency on Case and thread.
--   * It does not resolve PD-1 (coverage-admin group membership) or PD-2
--     (parent-initiated group calls). Both remain PRD-open.
--   * It invents no product semantics. Every signal that has no PRD basis after
--     Case removal is DROPPED and reported, never replaced with a guess.
--
-- OWNER-LOCKED CLOSURE -- WHY IT IS NOT RE-EXPRESSED
--   The instruction was to preserve owner-lock "if the behavior is required by
--   PRD ownership permanence." It is not. The PRD never restricts who may
--   resolve a conversation, and §5.2 states the opposite of a lock:
--     "Coverage admins act with the owner's permissions on that family for the
--      duration of the window, and nothing more."
--   The existing guard raises "brief SS5", citing the superseded document by
--   name. It is removed with Case. If Jawwid wants it back it is a product
--   decision against the PRD, not a migration.

-- ===========================================================================
-- 0. CUSTOMER-FACING VIEWS -- dropped here, rebuilt in section 11
-- ===========================================================================
-- chat.my_messages reads message.thread_id and message.case_id; chat.my_topics
-- is built entirely on chat.support_case. Both must go before the columns and
-- the table they depend on can be dropped.

drop view if exists chat.my_messages;
drop view if exists chat.my_topics;

-- RLS policies read message.thread_id / handoff.thread_id directly, so they
-- pin the columns too. Dropped here, rebuilt in section 9 against the
-- conversation.
drop policy if exists message_visible_to_staff on chat.message;
drop policy if exists message_written_by_staff on chat.message;
drop policy if exists handoff_visible_to_staff on chat.handoff;

-- ===========================================================================
-- 1. MESSAGE -- the conversation is the only parent
-- ===========================================================================

-- Greenfield safety: if any message predates chat.conversation, attach it to
-- its family's direct conversation rather than losing it.
update chat.message m
   set conversation_id = c.id
  from chat.thread t
  join chat.conversation c
    on c.family_id = t.family_id and c.type = 'direct'
 where m.conversation_id is null and m.thread_id = t.id;

delete from chat.message where conversation_id is null;

alter table chat.message drop column if exists case_id;
alter table chat.message drop column if exists thread_id;
alter table chat.message alter column conversation_id set not null;

-- A message author must belong to the conversation's family. Rewritten from
-- the thread-based version; same rule, new parent.
create or replace function chat.assert_message_author_exists()
returns trigger
language plpgsql
as $$
begin
  if new.author_type = 'staff'
     and not exists (select 1 from chat.staff s where s.id = new.author_id) then
    raise exception 'message author % is not a staff member', new.author_id
      using errcode = 'foreign_key_violation';
  elsif new.author_type = 'contact'
     and not exists (
       select 1
         from chat.contact c
         join chat.conversation cv on cv.id = new.conversation_id
        where c.id = new.author_id
          and cv.family_id is not null
          and c.family_id = cv.family_id) then
    raise exception
      'message author % is not a contact on this conversation''s family', new.author_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

-- needs_reply bookkeeping moves from thread to conversation. Internal notes are
-- still not staff replies: writing a note must never make a waiting family look
-- answered.
create or replace function chat.touch_conversation_from_message()
returns trigger
language plpgsql
as $$
begin
  if new.visibility <> 'customer' or new.moderation <> 'published' then
    return new;
  end if;

  if new.author_type = 'contact' then
    update chat.conversation
       set last_customer_message_at = greatest(
             coalesce(last_customer_message_at, new.created_at), new.created_at),
           last_activity_at = greatest(last_activity_at, new.created_at),
           resolved_at = null,
           state = case when state = 'resolved' then 'open' else state end
     where id = new.conversation_id;
  elsif new.author_type in ('staff', 'teacher') then
    update chat.conversation
       set last_staff_message_at = greatest(
             coalesce(last_staff_message_at, new.created_at), new.created_at),
           last_activity_at = greatest(last_activity_at, new.created_at)
     where id = new.conversation_id;
  end if;

  return new;
end;
$$;

drop trigger if exists message_touches_thread on chat.message;
drop function if exists chat.touch_thread_from_message() cascade;

create trigger message_touches_conversation
  after insert on chat.message
  for each row execute function chat.touch_conversation_from_message();

-- ===========================================================================
-- 2. TASK -- PRD §7.6: "Tasks belong to a family (optionally a student and a
--    conversation)". Case was its mandatory parent; the family now is.
-- ===========================================================================

alter table chat.task drop column if exists case_id;
alter table chat.task add column if not exists learner_id uuid
  references chat.learner (id) on delete set null;
alter table chat.task add column if not exists conversation_id uuid
  references chat.conversation (id) on delete set null;

-- PRD §7.6 task vocabulary, and the carrier for C-3's system events:
-- "onboarding event -> Task(type=onboarding) + message in the existing family
--  direct conversation", and the same for renewal, payment, follow-up,
-- complaint. The previous vocabulary (finance/technical/academic) came from the
-- superseded brief and names departments, not task types.
alter table chat.task drop constraint if exists task_type_check;
alter table chat.task add constraint task_type_check check (type in (
  'follow_up', 'renewal', 'payment', 'complaint', 'onboarding', 'custom'));

create index if not exists task_learner_idx on chat.task (learner_id)
  where learner_id is not null;
create index if not exists task_conversation_idx on chat.task (conversation_id)
  where conversation_id is not null;
create index if not exists task_family_open_idx on chat.task (family_id)
  where status in ('open', 'in_progress');

comment on column chat.task.conversation_id is
  'Optional link to the conversation the task was raised from (PRD §7.6). '
  'System events (onboarding, renewal, payment, follow-up, complaint) create a '
  'task of the matching type plus a message in the family''s persistent direct '
  'conversation -- product decision C-3, 2026-09-06.';

-- ===========================================================================
-- 3. EVENT LOG -- drop the case dimension and re-sign log_event()
-- ===========================================================================

drop index if exists chat.event_log_case_idx;
alter table chat.event_log drop column if exists case_id;

drop function if exists chat.log_event(text, uuid, uuid, text, uuid, jsonb);

create or replace function chat.log_event(
  p_type       text,
  p_family_id  uuid default null,
  p_actor_type text default 'system',
  p_actor_id   uuid default null,
  p_payload    jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into chat.event_log (family_id, actor_type, actor_id, type, payload)
  values (p_family_id, p_actor_type, p_actor_id, p_type, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- ===========================================================================
-- 4. HANDOFF -- rehomed from thread to conversation
-- ===========================================================================

alter table chat.handoff add column if not exists conversation_id uuid
  references chat.conversation (id) on delete cascade;

update chat.handoff h
   set conversation_id = c.id
  from chat.thread t
  join chat.conversation c on c.family_id = t.family_id and c.type = 'direct'
 where h.conversation_id is null and h.thread_id = t.id;

delete from chat.handoff where conversation_id is null;

drop index if exists chat.handoff_thread_idx;
alter table chat.handoff drop column if exists thread_id;
alter table chat.handoff alter column conversation_id set not null;
create index if not exists handoff_conversation_idx
  on chat.handoff (conversation_id, created_at desc);

-- ===========================================================================
-- 5. ATTENTION -- Case-derived signals re-expressed, or dropped with a reason
-- ===========================================================================
--
--   blocking_issue   was: support_case.is_blocking
--                    now: PRD §5.4 "a service-blocking state in Jawwid Core
--                         (suspended subscription, failed payment)" -- read
--                         from the subscription mirror, which is closer to the
--                         PRD than the Case version was.
--   complaint_open   was: support_case type=complaint
--                    now: PRD §5.4 "a complaint flagged by an admin" carried as
--                         an open Task(type=complaint) (§7.6).
--   follow_up_due    was: support_case.due_at
--                    now: PRD §5.4 "follow-up due today ... task overdue" --
--                         an open Task past its due_at.
--   complaint_high_extra  DROPPED. PRD Tasks (§7.6) have no severity, and this
--                    migration invents none.
--   repeat_case      DROPPED. No Case entity, and the PRD never describes a
--                    repeat-issue signal.
--   escalated        DROPPED as a Case-derived signal. PRD §7.5 has "escalate
--                    to the manager" as a handler action but defines no store
--                    for it. family.manual_flag='urgent' still raises
--                    manual_urgent, which is unaffected.

create or replace function chat.attention_signals(
  p_family_id    uuid,
  p_at           timestamptz default now(),
  p_for_staff_id uuid default null
) returns table (signal text, points numeric, reason text)
language plpgsql
stable
as $$
declare
  v_family      chat.family%rowtype;
  v_conv        chat.conversation%rowtype;
  v_needs_reply boolean;
  v_waiting_min numeric;
  v_target      numeric;
  v_is_owner    boolean;
begin
  select * into v_family from chat.family where id = p_family_id;
  if not found then
    return;
  end if;

  -- The family's persistent customer-facing conversation (PRD §5.2: the parent
  -- "sees the same 'Jawwid' conversation with a different named person").
  select * into v_conv
    from chat.conversation
   where family_id = p_family_id and type = 'direct' and archived_at is null
   order by last_activity_at desc
   limit 1;

  v_needs_reply := v_conv.id is not null
                   and v_conv.last_customer_message_at is not null
                   and (v_conv.last_staff_message_at is null
                        or v_conv.last_customer_message_at > v_conv.last_staff_message_at);

  v_is_owner := p_for_staff_id is null or p_for_staff_id = v_family.owner_id;

  -- 1. Customer message unanswered.
  if v_needs_reply then
    v_waiting_min := extract(epoch from (p_at - v_conv.last_customer_message_at)) / 60.0;

    signal := 'unanswered_message';
    points := chat.config_num('attention.points.unanswered_base')
              + least(v_waiting_min * chat.config_num('attention.points.unanswered_per_minute'),
                      chat.config_num('attention.points.unanswered_wait_cap'));
    reason := case
                when v_waiting_min < 1 then 'just messaged, no reply yet'
                when v_waiting_min < 60 then format('waiting %s minutes for a reply',
                                                    round(v_waiting_min))
                else format('waiting %s hours for a reply', round(v_waiting_min / 60))
              end;
    return next;

    v_target := chat.response_target_minutes(p_family_id, p_at);
    if v_waiting_min >= v_target then
      signal := 'response_target_breached';
      points := chat.config_num('attention.points.sla_breached');
      reason := format('past the %s minute reply target', v_target);
      return next;
    elsif v_waiting_min >= v_target * chat.config_num('response_target.sla_risk_pct') then
      signal := 'response_target_at_risk';
      points := chat.config_num('attention.points.sla_70pct');
      reason := format('approaching the %s minute reply target', v_target);
      return next;
    end if;
  end if;

  -- 2. Class in progress or imminent AND a message is waiting.
  if v_needs_reply then
    for signal, points, reason in
      select 'class_imminent',
             chat.config_num('attention.points.class_soon'),
             case
               when l.next_class_at <= p_at
                 then format('%s''s class started %s minutes ago', l.name,
                             round(extract(epoch from (p_at - l.next_class_at)) / 60.0))
               else format('%s''s class starts in %s minutes', l.name,
                           round(extract(epoch from (l.next_class_at - p_at)) / 60.0))
             end
      from chat.learner l
      where l.family_id = p_family_id
        and l.next_class_at is not null
        and l.next_class_at <= p_at + make_interval(mins => chat.config_int('attention.class_window_minutes'))
        and l.next_class_at >  p_at - make_interval(mins => chat.config_int('attention.class_window_minutes'))
      order by l.next_class_at
      limit 1
    loop
      return next;
    end loop;
  end if;

  -- 3. Service-blocking state (PRD §5.4), read from the Core subscription mirror.
  if exists (select 1 from chat.subscription s
             where s.family_id = p_family_id
               and s.status in ('past_due', 'paused', 'expired', 'cancelled')) then
    signal := 'blocking_issue';
    points := chat.config_num('attention.points.blocking');
    reason := 'blocked: the family cannot use the service';
    return next;
  end if;

  -- 4. Payment failed inside the window.
  if exists (select 1 from chat.subscription s
             where s.family_id = p_family_id
               and s.last_payment_status = 'failed'
               and s.last_payment_at > p_at - make_interval(
                     hours => chat.config_int('attention.payment_failed_window_hours'))) then
    signal := 'payment_failed';
    points := chat.config_num('attention.points.payment_failed');
    reason := 'a payment failed recently';
    return next;
  end if;

  -- 5. Renewal due.
  if v_is_owner then
    for signal, points, reason in
      select 'renewal_due',
             case when s.renewal_due_at <= p_at + make_interval(
                         days => chat.config_int('attention.renewal_urgent_days'))
                  then chat.config_num('attention.points.renewal_urgent')
                  else chat.config_num('attention.points.renewal_window') end,
             format('renewal due in %s days',
                    greatest(0, ceil(extract(epoch from (s.renewal_due_at - p_at)) / 86400.0)))
      from chat.subscription s
      where s.family_id = p_family_id
        and s.renewal_due_at is not null
        and s.renewal_due_at >  p_at
        and s.renewal_due_at <= p_at + make_interval(
              days => chat.config_int('attention.renewal_window_days'))
      order by s.renewal_due_at
      limit 1
    loop
      return next;
    end loop;
  end if;

  -- 6. Complaint open -- now an open Task(type=complaint) (PRD §5.4 + §7.6).
  if exists (select 1 from chat.task t
             where t.family_id = p_family_id and t.type = 'complaint'
               and t.status in ('open', 'in_progress')) then
    signal := 'complaint_open';
    points := chat.config_num('attention.points.complaint_open');
    reason := 'a complaint is open';
    return next;
  end if;

  -- 7. Family state at_risk.
  if v_family.state = 'at_risk' then
    signal := 'family_at_risk';
    points := chat.config_num('attention.points.family_at_risk');
    reason := coalesce(v_family.state_reason, 'the family is at risk');
    return next;
  end if;

  -- 8. Follow-up due (PRD §5.4 "follow-up due today", "task overdue").
  if exists (select 1 from chat.task t
             where t.family_id = p_family_id and t.due_at is not null
               and t.due_at <= p_at and t.status in ('open', 'in_progress')) then
    signal := 'follow_up_due';
    points := chat.config_num('attention.points.follow_up_due');
    reason := 'a follow-up is due';
    return next;
  end if;

  -- 9. Manually flagged urgent.
  if v_family.manual_flag = 'urgent' then
    signal := 'manual_urgent';
    points := chat.config_num('attention.points.manual_urgent');
    reason := coalesce(v_family.manual_flag_reason, 'flagged urgent');
    return next;
  end if;
end;
$$;

-- ===========================================================================
-- 6. WORKLOAD -- counted from conversations and tasks (PRD §5.3)
-- ===========================================================================
--   technical_open DROPPED: the PRD's task vocabulary (§7.6) has no
--   'technical' type, and this migration invents none.

insert into chat.config (key, value, scope, description) values
  ('workload.weights.active_conversation', '1', 'workload',
   'Weight per open conversation on duty. Replaces workload.weights.active_case '
   '(PRD §5.3 counts active_conversations). INITIAL HYPOTHESIS.')
on conflict (key) do nothing;

insert into chat.config (key, value, scope, description) values
  ('workload.weights.open_task', '1', 'workload',
   'Weight per open task on duty (PRD §5.3 open_tasks). INITIAL HYPOTHESIS.')
on conflict (key) do nothing;

create or replace function chat.workload_units(
  p_staff_id uuid,
  p_at       timestamptz default now()
) returns table (unit text, count integer, weight numeric, points numeric)
language sql
stable
as $$
  with mine as (select family_id from chat.families_on_duty(p_staff_id, p_at)),
  live as (
    select c.* from chat.conversation c join mine m on m.family_id = c.family_id
     where c.archived_at is null
  ),
  counted as (
    select 'needs_reply' as unit,
           (select count(*) from live c
             where c.last_customer_message_at is not null
               and (c.last_staff_message_at is null
                    or c.last_customer_message_at > c.last_staff_message_at))::integer as count
    union all
    select 'active_conversation',
           (select count(*) from live c where c.state <> 'resolved')::integer
    union all
    select 'follow_up_due_today',
           (select count(*) from chat.task t join mine m on m.family_id = t.family_id
             where t.status in ('open', 'in_progress') and t.due_at is not null
               and chat.local_at(t.due_at)::date <= chat.local_at(p_at)::date)::integer
    union all
    select 'open_task',
           (select count(*) from chat.task t join mine m on m.family_id = t.family_id
             where t.status in ('open', 'in_progress'))::integer
    union all
    select 'sla_risk',
           (select count(*) from live c
             where c.last_customer_message_at is not null
               and (c.last_staff_message_at is null
                    or c.last_customer_message_at > c.last_staff_message_at)
               and extract(epoch from (p_at - c.last_customer_message_at)) / 60.0
                   >= chat.response_target_minutes(c.family_id, p_at)
                      * chat.config_num('response_target.sla_risk_pct'))::integer
    union all
    select 'waiting_internal',
           (select count(*) from live c where c.state = 'waiting_on_jawwid')::integer
    union all
    select 'renewal_in_window',
           (select count(*) from chat.subscription s join mine m on m.family_id = s.family_id
             where s.renewal_due_at is not null and s.renewal_due_at > p_at
               and s.renewal_due_at <= p_at + make_interval(
                     days => chat.config_int('attention.renewal_window_days')))::integer
    union all
    select 'complaint_open',
           (select count(*) from chat.task t join mine m on m.family_id = t.family_id
             where t.type = 'complaint' and t.status in ('open', 'in_progress'))::integer
    union all
    select 'at_risk_family',
           (select count(*) from chat.family f join mine m on m.family_id = f.id
             where f.state = 'at_risk')::integer
  )
  select c.unit, c.count,
         chat.config_num('workload.weights.' || c.unit),
         round(c.count * chat.config_num('workload.weights.' || c.unit), 2)
  from counted c
$$;

-- ===========================================================================
-- 7. AUTHORIZATION + COVERAGE -- rehomed off thread and Case
-- ===========================================================================

-- may_assist: the assist precondition. Its Case dependency was "an open case";
-- the PRD basis is the waiting conversation itself, which the function already
-- measures.
create or replace function chat.may_assist(
  p_staff_id  uuid,
  p_family_id uuid,
  p_at        timestamptz default now()
) returns boolean
language plpgsql
stable
as $$
declare
  v_conv         chat.conversation%rowtype;
  v_waiting_min  numeric;
  v_target       numeric;
begin
  if chat.staff_role(p_staff_id) is distinct from 'admin'
     and chat.staff_role(p_staff_id) is distinct from 'coverage'
     and chat.staff_role(p_staff_id) is distinct from 'manager' then
    return false;
  end if;

  select * into v_conv
    from chat.conversation
   where family_id = p_family_id and type = 'direct' and archived_at is null
   order by last_activity_at desc
   limit 1;

  if v_conv.id is null or v_conv.last_customer_message_at is null then
    return false;
  end if;
  if v_conv.last_staff_message_at is not null
     and v_conv.last_staff_message_at >= v_conv.last_customer_message_at then
    return false;
  end if;

  v_waiting_min := extract(epoch from (p_at - v_conv.last_customer_message_at)) / 60.0;
  v_target      := chat.response_target_minutes(p_family_id, p_at);

  return v_waiting_min >= v_target * chat.config_num('assist.min_wait_fraction');
end;
$$;

-- effective_handler: stickiness now lives on the conversation.
create or replace function chat.effective_handler(
  p_family_id uuid,
  p_at        timestamptz default now()
) returns uuid
language sql
stable
as $$
  select coalesce(
    (select c.sticky_handler_id
       from chat.conversation c
      where c.family_id = p_family_id
        and c.type = 'direct'
        and c.archived_at is null
        and c.sticky_handler_id is not null
        and c.sticky_until is not null
        and c.sticky_until > p_at
      order by c.sticky_until desc
      limit 1),
    chat.on_duty(p_family_id, p_at));
$$;

-- Parameter renamed p_thread_id -> p_conversation_id, so the old signature must
-- be dropped rather than replaced: Postgres refuses to rename an input parameter.
drop function if exists chat.extend_stickiness(uuid, uuid);
create function chat.extend_stickiness(p_conversation_id uuid, p_staff_id uuid)
returns void
language sql
as $$
  update chat.conversation
     set sticky_handler_id = p_staff_id,
         sticky_until = now() + make_interval(mins => chat.config_int('handoff.grace_minutes'))
   where id = p_conversation_id;
$$;

-- response_target_minutes and staff_may_send lose their Case reads.
create or replace function chat.staff_may_send(
  p_staff_id  uuid,
  p_family_id uuid,
  p_mode      text,
  p_at        timestamptz default now()
) returns boolean
language plpgsql
stable
as $$
declare
  v_role text := chat.staff_role(p_staff_id);
begin
  if v_role is null then
    return false;
  end if;
  if v_role not in ('admin', 'coverage', 'manager') then
    return false;
  end if;
  if v_role = 'manager' then
    return true;
  end if;
  if chat.effective_handler(p_family_id, p_at) = p_staff_id then
    return true;
  end if;
  if p_mode = 'assist' then
    return chat.may_assist(p_staff_id, p_family_id, p_at);
  end if;
  return false;
end;
$$;

-- ===========================================================================
-- 8. DROP support_case AND thread
-- ===========================================================================

drop trigger if exists support_case_owner_lock on chat.support_case;
drop trigger if exists support_case_owner_locked_closure on chat.support_case;
drop trigger if exists support_case_thread_matches_family on chat.support_case;
drop trigger if exists support_case_set_updated_at on chat.support_case;

drop function if exists chat.apply_owner_lock() cascade;
drop function if exists chat.guard_owner_locked_case_closure() cascade;
drop function if exists chat.assert_case_thread_matches_family() cascade;

drop table if exists chat.support_case cascade;

alter table chat.conversation drop column if exists thread_id;
drop table if exists chat.thread cascade;

-- Config keys whose subject no longer exists. Left in place would be a lie the
-- manager settings UI would render.
delete from chat.config where key in (
  'cases.owner_locked_types',
  'cases.owner_locked_complaint_severity',
  'attention.points.complaint_high_extra',
  'attention.points.repeat_case',
  'attention.repeat_case_window_days',
  'workload.weights.active_case',
  'workload.weights.technical_open'
);

-- ===========================================================================
-- 9. RLS -- re-derive family scope from the conversation, not the thread
-- ===========================================================================

drop policy if exists message_visible_to_staff on chat.message;
create policy message_visible_to_staff on chat.message for select to authenticated
  using (exists (select 1 from chat.conversation c
                  where c.id = message.conversation_id
                    and c.family_id is not null
                    and chat.staff_can_see_family(c.family_id)));

drop policy if exists message_written_by_staff on chat.message;
create policy message_written_by_staff on chat.message for insert to authenticated
  with check (
    author_type = 'staff'
    and author_id = chat.current_staff_id()
    and (
      (visibility = 'internal'
       and chat.current_staff_role() = any (array['admin', 'coverage', 'manager']))
      or
      (visibility = 'customer'
       and chat.staff_may_send(
             chat.current_staff_id(),
             (select c.family_id from chat.conversation c where c.id = message.conversation_id),
             on_behalf_mode))
    ));

drop policy if exists handoff_visible_to_staff on chat.handoff;
create policy handoff_visible_to_staff on chat.handoff for select to authenticated
  using (exists (select 1 from chat.conversation c
                  where c.id = handoff.conversation_id
                    and c.family_id is not null
                    and chat.staff_can_see_family(c.family_id)));

-- ===========================================================================
-- 10. FAMILY SCOPE (C-2) -- when family_id may be null, and when it may not
-- ===========================================================================
--
-- PRD §6 lists `family` on Conversation without marking it optional, but two
-- PRD-required conversations are not family-scoped:
--   * Teacher<->Admin `direct` (C-2, §4.1 "Teacher may contact assigned
--     admins") -- a teacher spans many families, so no single family_id is
--     correct;
--   * `class_group` (§7.3, Phase 2) -- "a whole teaching group with several
--     families".
--
-- The rule enforced here is therefore the one the PRD does imply: a
-- conversation with a family contact in it IS family-scoped, and scoped to
-- THAT contact's family. Deferred, so a conversation may be assembled member by
-- member inside a transaction and is judged on the state it commits.

create or replace function chat.assert_conversation_family_scope(p_conversation_id uuid)
returns void
language plpgsql
as $$
declare
  v_type            text;
  v_family_id       uuid;
  v_contact_count   integer;
  v_foreign_contact integer;
begin
  select type, family_id into v_type, v_family_id
    from chat.conversation where id = p_conversation_id;
  if not found then
    return;
  end if;

  select count(*) into v_contact_count
    from chat.conversation_member m
   where m.conversation_id = p_conversation_id
     and m.actor_kind = 'contact'
     and m.left_at is null;

  if v_contact_count = 0 then
    return;   -- staff-only or teacher<->admin: no family scope required (C-2)
  end if;

  if v_family_id is null then
    raise exception
      'conversation % has family contacts but no family_id; a customer-facing conversation must be family-scoped (PRD §6)',
      p_conversation_id
      using errcode = 'check_violation';
  end if;

  select count(*) into v_foreign_contact
    from chat.conversation_member m
    join chat.contact ct on ct.id = m.actor_id
   where m.conversation_id = p_conversation_id
     and m.actor_kind = 'contact'
     and m.left_at is null
     and ct.family_id is distinct from v_family_id;

  if v_foreign_contact > 0 and v_type <> 'class_group' then
    raise exception
      'conversation % contains a contact from another family; only class_group may span families (PRD §7.3)',
      p_conversation_id
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function chat.tg_conversation_family_scope()
returns trigger
language plpgsql
as $$
begin
  perform chat.assert_conversation_family_scope(
    coalesce(new.conversation_id, old.conversation_id));
  return null;
end;
$$;

create or replace function chat.tg_conversation_family_scope_row()
returns trigger
language plpgsql
as $$
begin
  perform chat.assert_conversation_family_scope(new.id);
  return null;
end;
$$;

drop trigger if exists conversation_member_family_scope on chat.conversation_member;
create constraint trigger conversation_member_family_scope
  after insert or update or delete on chat.conversation_member
  deferrable initially deferred
  for each row execute function chat.tg_conversation_family_scope();

drop trigger if exists conversation_family_scope on chat.conversation;
create constraint trigger conversation_family_scope
  after insert or update of family_id, type on chat.conversation
  deferrable initially deferred
  for each row execute function chat.tg_conversation_family_scope_row();

comment on column chat.conversation.family_id is
  'The family this conversation belongs to. NULL is legitimate for a '
  'Teacher<->Admin direct conversation (product decision C-2, 2026-09-06) and '
  'for a Phase 2 class_group spanning several families (PRD §7.3). Enforced by '
  'chat.assert_conversation_family_scope(): any conversation containing a live '
  'family contact must be family-scoped, to that contact''s family.';

-- ===========================================================================
-- 11. CUSTOMER-FACING SURFACE -- rebuilt on the conversation
-- ===========================================================================

create or replace view chat.my_messages as
  select m.id,
         m.conversation_id,
         m.body,
         m.attachments,
         m.created_at,
         m.client_id,
         case m.author_type when 'contact' then 'family'
                            when 'staff'   then 'jawwid'
                            when 'teacher' then 'teacher'
                            else 'system' end as sender_kind,
         case m.author_type
           when 'contact' then (select c2.name from chat.contact c2 where c2.id = m.author_id)
           when 'staff'   then (select s.name from chat.staff s where s.id = m.author_id)
           else null
         end as sender_name
  from chat.message m
  join chat.conversation cv on cv.id = m.conversation_id
  where m.visibility = 'customer'
    and m.moderation = 'published'
    and cv.family_id in (select family_id from chat.contact
                         where account_id = chat.current_account_id() and is_active);

comment on view chat.my_messages is
  'Filtered on visibility = customer AND moderation = published. Internal notes '
  'and messages still awaiting approval (PRD §7.4) are not merely hidden by the '
  'client; they are not in this view at all.';

-- chat.my_topics is NOT rebuilt. It projected chat.support_case, which product
-- decision C-3 removes, and the PRD defines no customer-facing "topic" list:
-- §7.2 gives the parent a chat list of conversations. Re-creating it against
-- Task would expose Jawwid's internal workflow to the family, which the
-- original view's own comment says must never happen.

grant select on chat.my_messages to authenticated;

-- The only write a family-side user can perform, rehomed onto the family's
-- persistent direct conversation (PRD §5.2, product decision C-2).
create or replace function chat.post_customer_message(
  p_body        text,
  p_client_id   text default null,
  p_attachments jsonb default '[]'::jsonb,
  p_family_id   uuid default null
) returns uuid
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  v_contact         chat.contact%rowtype;
  v_conversation_id uuid;
  v_message         uuid;
begin
  select * into v_contact
  from chat.contact
  where account_id = chat.current_account_id() and is_active
    and (p_family_id is null or family_id = p_family_id)
  order by (family_id = p_family_id) desc
  limit 1;

  if not found then
    raise exception 'no active Jawwid Chat contact for this account'
      using errcode = 'insufficient_privilege';
  end if;

  if not v_contact.can_message then
    raise exception 'this contact is not permitted to send messages'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_conversation_id
    from chat.conversation
   where family_id = v_contact.family_id and type = 'direct' and archived_at is null
   order by last_activity_at desc
   limit 1;

  if v_conversation_id is null then
    raise exception 'this family has no direct conversation'
      using errcode = 'no_data_found';
  end if;

  insert into chat.message (conversation_id, author_type, author_id, body, attachments,
                            visibility, client_id, type, moderation, origin)
  values (v_conversation_id, 'contact', v_contact.id, p_body,
          coalesce(p_attachments, '[]'::jsonb), 'customer', p_client_id,
          'text', 'published', 'user')
  returning id into v_message;

  perform chat.log_event('message_received', v_contact.family_id,
                         'contact', v_contact.id,
                         jsonb_build_object('message_id', v_message));
  return v_message;
end;
$$;

revoke all on function chat.post_customer_message(text, text, jsonb, uuid) from public;
grant execute on function chat.post_customer_message(text, text, jsonb, uuid) to authenticated;

-- ===========================================================================
-- 12. REMAINING THREAD/CASE READERS
-- ===========================================================================
-- These three compile against a dropped table (PL/pgSQL bodies are not
-- validated at definition time) and would fail only when first called. That is
-- exactly the class of latent breakage this reconciliation exists to remove.

-- response_target_minutes: "blocking" was support_case.is_blocking. The PRD's
-- own definition of a blocking state (§5.4) is a service-blocking state in
-- Jawwid Core, which the subscription mirror already carries.
create or replace function chat.response_target_minutes(
  p_family_id uuid,
  p_at        timestamptz default now()
) returns integer
language plpgsql
stable
as $$
declare
  v_blocking boolean;
begin
  select exists (
    select 1 from chat.subscription s
    where s.family_id = p_family_id
      and s.status in ('past_due', 'paused', 'expired', 'cancelled')
  ) into v_blocking;

  return chat.config_int(
    format('response_target.%s.%s',
           case when v_blocking then 'now_blocking' else 'now_other' end,
           chat.response_shift_kind(p_family_id, p_at)));
end;
$$;

-- attention_bucket: needs_reply now comes from the conversation, and "something
-- is due" from an open Task (PRD §7.6) rather than from a case.
create or replace function chat.attention_bucket(
  p_family_id    uuid,
  p_at           timestamptz default now(),
  p_for_staff_id uuid default null
) returns text
language plpgsql
stable
as $$
declare
  v_score       numeric := chat.attention_score(p_family_id, p_at, p_for_staff_id);
  v_needs       boolean;
  v_due         boolean;
  v_staff_spoke boolean;
begin
  if v_score >= chat.config_num('attention.bucket.now') then
    return 'now';
  elsif v_score >= chat.config_num('attention.bucket.today') then
    return 'today';
  end if;

  select coalesce(c.last_customer_message_at is not null
                  and (c.last_staff_message_at is null
                       or c.last_customer_message_at > c.last_staff_message_at), false),
         c.last_staff_message_at is not null
    into v_needs, v_staff_spoke
    from chat.conversation c
   where c.family_id = p_family_id and c.type = 'direct' and c.archived_at is null
   order by c.last_activity_at desc
   limit 1;

  select exists (select 1 from chat.task t
                 where t.family_id = p_family_id and t.due_at is not null
                   and t.status in ('open', 'in_progress')) into v_due;

  if coalesce(v_staff_spoke, false) and not coalesce(v_needs, false) and not v_due then
    return 'waiting_on_family';
  end if;
  return 'quiet';
end;
$$;

-- assign_family_owner: a new family is created with its persistent direct
-- conversation (PRD §5.2 / decision C-2), not a thread. The Primary Guardian is
-- added as its family contact member so the conversation is well-formed under
-- chat.assert_conversation_family_scope() the moment it exists.
create or replace function chat.assign_family_owner(
  p_core_parent_id uuid,
  p_owner_id       uuid,
  p_reason         text,
  p_actor_id       uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_actor           uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_inbox           chat.core_parent_inbox%rowtype;
  v_family_id       uuid;
  v_contact         uuid;
  v_conversation_id uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'assigning an owner requires a reason' using errcode = 'check_violation';
  end if;
  if chat.staff_role(v_actor) is distinct from 'manager' then
    raise exception 'only a manager may assign a family owner'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from chat.staff
                 where id = p_owner_id and is_active and role in ('admin', 'coverage')) then
    raise exception 'the owner must be an active admin or coverage admin'
      using errcode = 'check_violation';
  end if;

  select * into v_inbox from chat.core_parent_inbox where core_parent_id = p_core_parent_id;
  if not found then
    raise exception 'no waiting Jawwid Core parent with id %', p_core_parent_id
      using errcode = 'no_data_found';
  end if;

  insert into chat.family (display_name, owner_id, language, core_parent_id)
  values (coalesce(v_inbox.display_name, 'Family'), p_owner_id,
          coalesce(v_inbox.language, 'ar'), p_core_parent_id)
  returning id into v_family_id;

  insert into chat.contact (family_id, name, relationship, role_preset,
                            can_message, can_view_progress, can_manage_schedule,
                            can_manage_billing, can_manage_contacts, can_cancel)
  values (v_family_id, coalesce(v_inbox.display_name, 'Parent'), 'parent',
          'primary_guardian', true, true, true, true, true, true)
  returning id into v_contact;

  update chat.family set primary_contact_id = v_contact where id = v_family_id;

  -- The family's one persistent "Jawwid" conversation. Coverage changes who
  -- answers in it; it is never replaced (PRD §5.2).
  insert into chat.conversation (type, family_id, direct_key, title)
  values ('direct', v_family_id, 'family:' || v_family_id::text, 'Jawwid')
  returning id into v_conversation_id;

  insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
  values (v_conversation_id, 'contact', v_contact, 'parent');

  insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
  values (v_conversation_id, 'staff', p_owner_id, 'admin');

  delete from chat.core_parent_inbox where core_parent_id = p_core_parent_id;

  perform chat.write_audit(v_actor, 'family_owner_assigned', 'family', v_family_id, p_reason,
                           null, jsonb_build_object('owner_id', p_owner_id));
  perform chat.log_event('subscription_synced', v_family_id, 'staff', v_actor,
                         jsonb_build_object('created', true, 'core_parent_id', p_core_parent_id));
  return v_family_id;
end;
$$;
