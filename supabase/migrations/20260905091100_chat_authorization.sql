-- Jawwid Chat -- the authorization layer.
--
-- Every question of "may this person do this" is answered by a function in this
-- file. RLS policies and application code call these; they never re-implement
-- the reasoning. Brief SS5 is the specification.

-- The inbox needs to record that an admin actually looked at a family, because
-- brief SS5 gates "reply as assist" on the on-duty admin not having opened it.
alter table chat.event_log drop constraint event_log_type_check;
alter table chat.event_log add constraint event_log_type_check check (type in (
  'message_received', 'message_sent', 'internal_note_added',
  'case_opened', 'case_status_changed', 'case_resolved', 'case_closed',
  'case_reopened', 'case_escalated', 'case_auto_resolved',
  'task_created', 'task_completed', 'task_cancelled',
  'handoff_created', 'handoff_acknowledged', 'coverage_started',
  'coverage_ended', 'sticky_started', 'sticky_expired',
  'absence_activated', 'absence_auto_detected', 'unattended_detected',
  'ownership_transferred', 'family_state_changed', 'family_flagged',
  'payment_failed', 'payment_succeeded', 'renewal_due', 'subscription_synced',
  'class_reminder_due', 'class_attended', 'class_missed',
  'attention_order_disputed',
  -- Inbox telemetry, required by the assist rule.
  'family_opened', 'assist_requested'));

create or replace function chat.current_staff_role()
returns text
language sql
stable
as $$ select role from chat.staff where id = chat.current_staff_id() $$;

create or replace function chat.is_manager()
returns boolean
language sql
stable
as $$ select chat.current_staff_role() = 'manager' $$;

-- The families the signed-in family-side user belongs to.
create or replace function chat.current_contact_family_ids()
returns setof uuid
language sql
stable
as $$
  select family_id from chat.contact
  where app_user_id = auth.uid() and is_active
$$;

-- Visibility ---------------------------------------------------------------
-- Brief SS5: "Any admin May open any family and write internal notes any time."
-- Department staff see only families they hold a task on; they never message.

create or replace function chat.staff_can_see_family(p_family_id uuid, p_staff_id uuid default null)
returns boolean
language sql
stable
as $$
  select case coalesce((select role from chat.staff where id = coalesce(p_staff_id, chat.current_staff_id())), '')
    when 'manager'  then true
    when 'admin'    then true
    when 'coverage' then true
    when ''         then false
    else exists (
      select 1 from chat.task t
      where t.family_id = p_family_id
        and t.owner_id = coalesce(p_staff_id, chat.current_staff_id()))
  end
$$;

-- Assist -------------------------------------------------------------------
-- Brief SS5: allowed only if the family is in the NOW bucket, has waited more
-- than half the response target, and the on-duty admin has not opened it --
-- or the on-duty admin explicitly asked for help.

create or replace function chat.may_assist(
  p_staff_id uuid, p_family_id uuid, p_at timestamptz default now()
) returns boolean
language plpgsql
stable
as $$
declare
  v_on_duty      uuid := chat.effective_handler(p_family_id, p_at);
  v_role         text := (select role from chat.staff where id = p_staff_id);
  v_last_message timestamptz;
  v_waiting      numeric;
begin
  if v_role not in ('admin', 'coverage', 'manager') then
    return false;
  end if;
  if v_on_duty is null or v_on_duty = p_staff_id then
    return false;  -- nothing to assist with, or she is the one on duty
  end if;

  select last_customer_message_at into v_last_message
  from chat.thread where family_id = p_family_id;

  if v_last_message is null then
    return false;
  end if;

  -- The on-duty admin asked for help since the customer last wrote.
  if exists (select 1 from chat.event_log e
             where e.family_id = p_family_id and e.type = 'assist_requested'
               and e.actor_id = v_on_duty and e.at >= v_last_message) then
    return true;
  end if;

  if chat.attention_bucket(p_family_id, p_at, v_on_duty) <> 'now' then
    return false;
  end if;

  v_waiting := extract(epoch from (p_at - v_last_message)) / 60.0;
  if v_waiting <= chat.response_target_minutes(p_family_id, p_at)
                  * chat.config_num('assist.min_wait_fraction') then
    return false;
  end if;

  -- The on-duty admin has already opened it: it is hers to answer.
  return not exists (
    select 1 from chat.event_log e
    where e.family_id = p_family_id and e.type = 'family_opened'
      and e.actor_id = v_on_duty and e.at >= v_last_message);
end;
$$;

-- May this staff member send a customer-facing message, in this mode? --------

create or replace function chat.staff_may_send(
  p_staff_id uuid, p_family_id uuid, p_mode text, p_at timestamptz default now()
) returns boolean
language plpgsql
stable
as $$
declare
  v_role    text := (select role from chat.staff where id = p_staff_id and is_active);
  v_owner   uuid := (select owner_id from chat.family where id = p_family_id);
  v_handler uuid := chat.effective_handler(p_family_id, p_at);
begin
  -- Brief SS2: finance, technical and academic staff never message families.
  if v_role is null or v_role not in ('admin', 'coverage', 'manager') then
    return false;
  end if;

  return case p_mode
    when 'owner'      then p_staff_id = v_owner and p_staff_id = v_handler
    when 'coverage'   then p_staff_id = v_handler and p_staff_id is distinct from v_owner
    when 'assist'     then chat.may_assist(p_staff_id, p_family_id, p_at)
    when 'escalation' then v_role = 'manager'
                           or exists (select 1 from chat.support_case c
                                      where c.family_id = p_family_id
                                        and c.escalated_to_id = p_staff_id
                                        and c.status not in ('resolved', 'closed'))
    else false
  end;
end;
$$;

comment on function chat.staff_may_send is
  'The single answer to "may this staff member speak to this family right now, '
  'in this mode". RLS calls it; no controller re-implements it. Internal notes '
  'do not go through it: brief SS5 lets any admin write one at any time.';

-- When will somebody next be on duty ----------------------------------------
-- Brief SS9: the customer is told an honest reply time from the current or next
-- shift. Stepped rather than solved analytically: shifts, coverage rules and
-- absences interact, and on_duty() is the only thing allowed to combine them.

create or replace function chat.next_on_duty_at(p_family_id uuid, p_at timestamptz default now())
returns timestamptz
language plpgsql
stable
as $$
declare
  v_step  interval := interval '15 minutes';
  v_probe timestamptz := p_at;
  v_limit timestamptz := p_at + interval '7 days';
begin
  if chat.on_duty(p_family_id, p_at) is not null then
    return p_at;
  end if;
  while v_probe < v_limit loop
    v_probe := v_probe + v_step;
    if chat.on_duty(p_family_id, v_probe) is not null then
      return v_probe;
    end if;
  end loop;
  return null;
end;
$$;
