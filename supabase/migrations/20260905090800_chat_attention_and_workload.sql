-- Jawwid Chat -- the attention and workload engines (brief SS6, SS7).
--
-- Brief SS12: "Attention and workload are computed, never user-entered; all
-- constants read from config." Neither value is stored on the family; both are
-- derived here and cached in chat.family_state_cache for the inbox.
--
-- Brief SS6: the inbox shows top_reason as readable text ("class started 5 min
-- ago"), never a number or a P1/P2/P3 label. chat.attention_signals() therefore
-- returns the reason alongside the points.

-- Response targets ----------------------------------------------------------
-- Which target applies depends on the shift that is running. Friday wins; a
-- moment inside the family owner's own shift is "day"; anything else is
-- "night". Derived from the roster rather than a second set of config hours, so
-- targets cannot drift out of step with the shifts themselves.

create or replace function chat.response_shift_kind(p_family_id uuid, p_at timestamptz)
returns text
language plpgsql
stable
as $$
declare
  v_owner uuid;
begin
  if extract(dow from chat.local_at(p_at))::smallint = 5 then
    return 'friday';
  end if;
  select owner_id into v_owner from chat.family where id = p_family_id;
  if v_owner is not null and chat.in_shift(v_owner, p_at) then
    return 'day';
  end if;
  return 'night';
end;
$$;

create or replace function chat.response_target_minutes(p_family_id uuid, p_at timestamptz default now())
returns integer
language plpgsql
stable
as $$
declare
  v_blocking boolean;
begin
  select exists (
    select 1 from chat.support_case c
    where c.family_id = p_family_id
      and c.is_blocking
      and c.status not in ('resolved', 'closed')
  ) into v_blocking;

  return chat.config_int(
    format('response_target.%s.%s',
           case when v_blocking then 'now_blocking' else 'now_other' end,
           chat.response_shift_kind(p_family_id, p_at)));
end;
$$;

-- Attention signals ---------------------------------------------------------

create or replace function chat.attention_signals(
  p_family_id    uuid,
  p_at           timestamptz default now(),
  p_for_staff_id uuid default null
) returns table (signal text, points numeric, reason text)
language plpgsql
stable
as $$
declare
  v_family       chat.family%rowtype;
  v_thread       chat.thread%rowtype;
  v_waiting_min  numeric;
  v_target       numeric;
  v_is_owner     boolean;
begin
  select * into v_family from chat.family where id = p_family_id;
  if not found then
    return;
  end if;
  select * into v_thread from chat.thread where family_id = p_family_id;

  v_is_owner := p_for_staff_id is null or p_for_staff_id = v_family.owner_id;

  -- 1. Customer message unanswered: base + per minute waiting, capped.
  if v_thread.needs_reply then
    v_waiting_min := extract(epoch from (p_at - v_thread.last_customer_message_at)) / 60.0;

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

    -- 9. Response target elapsed / breached. Only meaningful while waiting.
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

  -- 2. Class in progress or imminent AND there is a message waiting.
  if v_thread.needs_reply then
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

  -- 3. Blocking issue.
  if exists (select 1 from chat.support_case c
             where c.family_id = p_family_id and c.is_blocking
               and c.status not in ('resolved', 'closed')) then
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
    reason := 'a payment failed in the last two days';
    return next;
  end if;

  -- 5. Renewal due. Brief SS6 marks the urgent step "owner only": coverage is
  -- not pushed a relationship decision it is not allowed to make (brief SS5).
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

  -- 6. Complaint open.
  for signal, points, reason in
    select 'complaint_open',
           chat.config_num('attention.points.complaint_open')
           + case when c.severity = 'high'
                  then chat.config_num('attention.points.complaint_high_extra') else 0 end,
           case when c.severity = 'high' then 'a serious complaint is open'
                else 'a complaint is open' end
    from chat.support_case c
    where c.family_id = p_family_id and c.type = 'complaint'
      and c.status not in ('resolved', 'closed')
    order by (c.severity = 'high') desc
    limit 1
  loop
    return next;
  end loop;

  -- 7. Family state at_risk.
  if v_family.state = 'at_risk' then
    signal := 'family_at_risk';
    points := chat.config_num('attention.points.family_at_risk');
    reason := coalesce(v_family.state_reason, 'the family is at risk');
    return next;
  end if;

  -- 8. Same case type recurring inside the window.
  for signal, points, reason in
    select 'repeat_case',
           chat.config_num('attention.points.repeat_case'),
           format('third %s issue this month', c.type)
    from chat.support_case c
    where c.family_id = p_family_id
      and c.created_at > p_at - make_interval(
            days => chat.config_int('attention.repeat_case_window_days'))
    group by c.type
    having count(*) > 1
    order by count(*) desc
    limit 1
  loop
    return next;
  end loop;

  -- 10. Follow-up due now.
  if exists (select 1 from chat.support_case c
             where c.family_id = p_family_id and c.due_at is not null and c.due_at <= p_at
               and c.status not in ('resolved', 'closed')) then
    signal := 'follow_up_due';
    points := chat.config_num('attention.points.follow_up_due');
    reason := 'a follow-up is due';
    return next;
  end if;

  -- 11. Manually flagged urgent, or escalated.
  if v_family.manual_flag = 'urgent' then
    signal := 'manual_urgent';
    points := chat.config_num('attention.points.manual_urgent');
    reason := coalesce(v_family.manual_flag_reason, 'flagged urgent');
    return next;
  elsif exists (select 1 from chat.support_case c
                where c.family_id = p_family_id and c.escalation_level > 0
                  and c.status not in ('resolved', 'closed')) then
    signal := 'escalated';
    points := chat.config_num('attention.points.manual_urgent');
    reason := 'escalated to the manager';
    return next;
  end if;
end;
$$;

create or replace function chat.attention_score(
  p_family_id uuid, p_at timestamptz default now(), p_for_staff_id uuid default null
) returns numeric
language sql
stable
as $$
  select round(coalesce(sum(s.points), 0) * chat.config_num(
           'attention.tier_multiplier.' || (select tier from chat.family where id = p_family_id)
         ), 2)
  from chat.attention_signals(p_family_id, p_at, p_for_staff_id) s
$$;

comment on function chat.attention_score is
  'Brief SS6: tier is a multiplier over the summed signals, never an added '
  'constant, so a priority family cannot outrank a genuine emergency on tier '
  'alone.';

create or replace function chat.attention_top_reason(
  p_family_id uuid, p_at timestamptz default now(), p_for_staff_id uuid default null
) returns text
language sql
stable
as $$
  select s.reason
  from chat.attention_signals(p_family_id, p_at, p_for_staff_id) s
  order by s.points desc, s.signal
  limit 1
$$;

create or replace function chat.attention_bucket(
  p_family_id uuid, p_at timestamptz default now(), p_for_staff_id uuid default null
) returns text
language plpgsql
stable
as $$
declare
  v_score numeric := chat.attention_score(p_family_id, p_at, p_for_staff_id);
  v_needs       boolean;
  v_due         boolean;
  v_staff_spoke boolean;
begin
  if v_score >= chat.config_num('attention.bucket.now') then
    return 'now';
  elsif v_score >= chat.config_num('attention.bucket.today') then
    return 'today';
  end if;

  -- WAITING ON FAMILY means the ball is genuinely in their court: staff spoke
  -- last and nothing is due. A family nobody has ever messaged is QUIET.
  select coalesce(t.needs_reply, false), t.last_staff_message_at is not null
    into v_needs, v_staff_spoke
    from chat.thread t where t.family_id = p_family_id;

  select exists (select 1 from chat.support_case c
                 where c.family_id = p_family_id and c.due_at is not null
                   and c.status not in ('resolved', 'closed')) into v_due;

  if coalesce(v_staff_spoke, false) and not v_needs and not v_due then
    return 'waiting_on_family';
  end if;
  return 'quiet';
end;
$$;

-- Cache ---------------------------------------------------------------------

create or replace function chat.recompute_family_state(p_family_id uuid, p_at timestamptz default now())
returns void
language plpgsql
as $$
declare
  v_handler uuid := chat.effective_handler(p_family_id, p_at);
begin
  insert into chat.family_state_cache (family_id, on_duty_id, attention, bucket, top_reason, computed_at)
  values (p_family_id, v_handler,
          chat.attention_score(p_family_id, p_at, v_handler),
          chat.attention_bucket(p_family_id, p_at, v_handler),
          chat.attention_top_reason(p_family_id, p_at, v_handler),
          p_at)
  on conflict (family_id) do update
    set on_duty_id = excluded.on_duty_id,
        attention  = excluded.attention,
        bucket     = excluded.bucket,
        top_reason = excluded.top_reason,
        computed_at = excluded.computed_at;
end;
$$;

comment on function chat.recompute_family_state is
  'Attention is cached for the family''s current handler. The renewal-urgent '
  'signal is owner-only, so a covering admin''s cached score legitimately '
  'differs from the owner''s.';

create or replace function chat.recompute_all_family_states(p_at timestamptz default now())
returns integer
language plpgsql
as $$
declare
  v_count integer := 0;
  v_id    uuid;
begin
  for v_id in select id from chat.family loop
    perform chat.recompute_family_state(v_id, p_at);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Workload ------------------------------------------------------------------
-- Brief SS7: "Number of families is never part of workload." Every unit below
-- is a piece of live work. Covered families count fully on the covering admin
-- while she is on duty, which is exactly what on_duty() already answers.

create or replace function chat.families_on_duty(p_staff_id uuid, p_at timestamptz default now())
returns table (family_id uuid)
language sql
stable
as $$
  select f.id from chat.family f where chat.on_duty(f.id, p_at) = p_staff_id
$$;

create or replace function chat.workload_units(p_staff_id uuid, p_at timestamptz default now())
returns table (unit text, count integer, weight numeric, points numeric)
language sql
stable
as $$
  with mine as (select family_id from chat.families_on_duty(p_staff_id, p_at)),
  counted as (
    select 'needs_reply' as unit,
           (select count(*) from chat.thread t join mine m on m.family_id = t.family_id
             where t.needs_reply)::integer as count
    union all
    select 'active_case',
           (select count(*) from chat.support_case c join mine m on m.family_id = c.family_id
             where c.status not in ('resolved', 'closed'))::integer
    union all
    select 'follow_up_due_today',
           (select count(*) from chat.support_case c join mine m on m.family_id = c.family_id
             where c.status not in ('resolved', 'closed') and c.due_at is not null
               and chat.local_at(c.due_at)::date <= chat.local_at(p_at)::date)::integer
    union all
    select 'sla_risk',
           (select count(*) from chat.thread t join mine m on m.family_id = t.family_id
             where t.needs_reply
               and extract(epoch from (p_at - t.last_customer_message_at)) / 60.0
                   >= chat.response_target_minutes(t.family_id, p_at)
                      * chat.config_num('response_target.sla_risk_pct'))::integer
    union all
    select 'waiting_internal',
           (select count(*) from chat.support_case c join mine m on m.family_id = c.family_id
             where c.status = 'waiting_internal')::integer
    union all
    select 'renewal_in_window',
           (select count(*) from chat.subscription s join mine m on m.family_id = s.family_id
             where s.renewal_due_at is not null and s.renewal_due_at > p_at
               and s.renewal_due_at <= p_at + make_interval(
                     days => chat.config_int('attention.renewal_window_days')))::integer
    union all
    select 'complaint_open',
           (select count(*) from chat.support_case c join mine m on m.family_id = c.family_id
             where c.type = 'complaint' and c.status not in ('resolved', 'closed'))::integer
    union all
    select 'technical_open',
           (select count(*) from chat.support_case c join mine m on m.family_id = c.family_id
             where c.type = 'technical' and c.status not in ('resolved', 'closed'))::integer
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

create or replace function chat.workload_score(p_staff_id uuid, p_at timestamptz default now())
returns numeric
language sql
stable
as $$
  select round(coalesce(sum(points), 0), 2) from chat.workload_units(p_staff_id, p_at)
$$;

create or replace function chat.workload_level(p_staff_id uuid, p_at timestamptz default now())
returns text
language plpgsql
stable
as $$
declare
  v_score       numeric := chat.workload_score(p_staff_id, p_at);
  v_high        numeric := coalesce((select capacity_override from chat.staff where id = p_staff_id),
                                    chat.config_num('workload.level.high'));
  v_needs_reply integer;
begin
  select count from chat.workload_units(p_staff_id, p_at) into v_needs_reply
   where unit = 'needs_reply';

  -- Brief SS7: a burst of unanswered families is HIGH regardless of the score.
  if v_needs_reply >= chat.config_int('workload.reply_burst') then
    return 'HIGH';
  end if;

  if v_score >= v_high then
    return 'HIGH';
  elsif v_score >= chat.config_num('workload.level.medium') then
    return 'MEDIUM';
  end if;
  return 'LOW';
end;
$$;

comment on function chat.workload_level is
  'staff.capacity_override replaces the HIGH threshold for one person, so the '
  'manager can account for someone working reduced hours without changing the '
  'global config.';

-- Calibration ---------------------------------------------------------------
-- Brief SS6: an inbox button that records "this order is wrong" and what the
-- admin would have done instead. Read after 60-90 days to re-derive weights.

create or replace function chat.dispute_attention_order(
  p_family_id       uuid,
  p_staff_id        uuid,
  p_expected_rank   integer,
  p_note            text default null
) returns bigint
language sql
as $$
  select chat.log_event(
    'attention_order_disputed', p_family_id, null, 'staff', p_staff_id,
    jsonb_build_object(
      'expected_rank', p_expected_rank,
      'note', p_note,
      'scored', chat.attention_score(p_family_id, now(), p_staff_id),
      'bucket', chat.attention_bucket(p_family_id, now(), p_staff_id),
      'top_reason', chat.attention_top_reason(p_family_id, now(), p_staff_id),
      'signals', (select jsonb_agg(jsonb_build_object('signal', s.signal, 'points', s.points))
                  from chat.attention_signals(p_family_id, now(), p_staff_id) s)));
$$;
