-- PD-47 (2026-10-29), PR-2b -- financial tasks from their sources. Slot 20261029233000.
--
-- Plan: docs/product/pd047-amendment-priority.md §5-§6 (owner-approved
-- 2026-10-28: thresholds, Q-F1..F7). Builds on 20261029210000 (PR-2): its
-- helpers (raise / settle / withdraw / reroute, the issue log, the cut-offs)
-- and its guard, redefined here only to add these sources to the ones that
-- follow their source.
--
-- Every task here is category 'financial' (sorted first inside its colour).
--
--   source_type       key                       assignee                             level
--   instalment        instalment:<instalment>   billing owner*                       floor 'instalment': D-7 Yellow, D0 Red, D+1 overdue
--   package_low       package_low:<subscription> the family's Sales owner, else the   Yellow at <= 2 lessons left; source floor High at 0
--                     (the child's newest package) live Sales manager
--   renewal_request   renewal_request:<subscr.>  as package_low                      High (the child is locked)
--   receipt_review    receipt_review:<receipt>  billing owner*                       generic, due upload + 72 h: Yellow on upload, Red at 48 h
--   checkout_failed   checkout_failed:<request> billing owner*                       High
--
--   * the billing owner: the child's PD-8 supervisor for a child instalment,
--     the family's billing supervisor for a family one (BillingService's
--     responsibleSupervisor), while live; else the live Operations manager.
--
--   Completed on positive evidence, by who did it: the instalment paid (by
--   who recorded it; a card payment names nobody, so the system), the
--   balance above 2 or a newer package (its creator), the receipt reviewed,
--   the request paid. Withdrawn when the source goes away (an instalment
--   voided, a request cancelled). Financial tasks follow their owner: the
--   sweep moves them when the billing supervisor or Sales owner changes, and
--   nobody moves them by hand.
--
--   A system completion: the family paid online, and no staff member did the
--   work, so 'completed' joins the event kinds the system may write -- only
--   through the helpers (chat.task_system).
--
--   Cut-offs (owner 2026-10-29, the last 14 days): instalments by due date,
--   receipts by upload, failed checkouts and renewals by their time; a low
--   balance is a present state and has none.
--
-- FAIL CLOSED: RLS and revoked grants as PR-1/PR-2. Every function pins its
-- search_path.

-- ===========================================================================
-- 1. Who
-- ===========================================================================

-- The billing owner of a family's (or one child's) money.
create or replace function chat.work_task_billing_owner(p_family uuid, p_learner uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    case when p_learner is not null then
      (select ls.supervisor_id from chat.learner_supervision ls
         join chat.staff s on s.id = ls.supervisor_id and s.is_active and s.left_at is null
        where ls.learner_id = p_learner)
    else
      (select b.supervisor_id from chat.family_billing_supervision b
         join chat.staff s on s.id = b.supervisor_id and s.is_active and s.left_at is null
        where b.family_id = p_family)
    end,
    (select d.manager_id from chat.family f
       join chat.department d on d.organization_id = f.organization_id and d.kind = 'operations'
       join chat.staff m on m.id = d.manager_id and m.is_active and m.left_at is null
      where f.id = p_family));
$$;

-- The family's Sales owner while live, else the live Sales manager (owner Q-F4).
create or replace function chat.work_task_sales_owner(p_family uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select o.staff_id from chat.family_sales_owner o
       join chat.staff s on s.id = o.staff_id and s.is_active and s.left_at is null
      where o.family_id = p_family),
    (select d.manager_id from chat.family f
       join chat.department d on d.organization_id = f.organization_id and d.kind = 'sales'
       join chat.staff m on m.id = d.manager_id and m.is_active and m.left_at is null
      where f.id = p_family));
$$;

-- The child's newest live package.
create or replace function chat.work_task_newest_package(p_learner uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select s.id from chat.learner_subscription s
   where s.learner_id = p_learner and s.voided_at is null
   order by s.created_at desc, s.id desc
   limit 1;
$$;

-- A source floor raised (the balance used up), recorded as source_raised.
create or replace function chat.work_task_set_floor(p_org uuid, p_key text, p_floor text)
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := chat.work_task_begin_system(null);
  v_n     integer := 0;
  r record;
begin
  for r in
    update chat.work_task set source_floor = p_floor
     where organization_id = p_org and source_key = p_key and state in ('open', 'awaiting_decision')
       and source_floor is distinct from p_floor
     returning id, revision
  loop
    perform chat.work_task_signal(r.id, r.revision, 'source_raised');
    v_n := v_n + 1;
  end loop;
  perform chat.work_task_end_system(v_saved);
  return v_n;
end;
$$;

-- ===========================================================================
-- 2. The sources: one raise function each
-- ===========================================================================

-- An instalment from D-7 (owner Q-F7): one task carries it to its payment.
create or replace function chat.work_task_raise_instalment(p_instalment uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  i       chat.family_instalment;
  v_owner uuid;
begin
  select * into i from chat.family_instalment where id = p_instalment;
  if i.id is null or i.paid_on is not null or i.voided_at is not null
     or i.due_date > chat.academy_today() + 7 or i.due_date < chat.work_task_since('instalment')::date then
    return null;
  end if;
  v_owner := chat.work_task_billing_owner(i.family_id, i.learner_id);
  if v_owner is null then
    perform chat.work_task_note_issue(i.organization_id, 'instalment:' || i.id, 'no live billing supervisor or Operations manager');
    return null;
  end if;
  return chat.work_task_raise(i.organization_id, 'instalment', i.id, v_owner, null, 'medium', 'financial', 'instalment',
                              (i.due_date::timestamp) at time zone chat.work_task_academy_zone());
end;
$$;

-- A child whose balance is 2 lessons or fewer (owner Q-F7): one task per
-- package; High once the balance is used up (PD-30's grace begins).
create or replace function chat.work_task_raise_package_low(p_learner uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  a       chat.learner_access;
  v_pkg   uuid := chat.work_task_newest_package(p_learner);
  v_owner uuid;
  v_id    uuid;
begin
  select * into a from chat.learner_access where learner_id = p_learner;
  if a.learner_id is null or v_pkg is null or a.balance is null or a.balance > 2 then
    return null;
  end if;
  v_owner := chat.work_task_sales_owner(a.family_id);
  if v_owner is null then
    perform chat.work_task_note_issue(a.organization_id, 'package_low:' || v_pkg, 'no live Sales owner or Sales manager');
    return null;
  end if;
  v_id := chat.work_task_raise(a.organization_id, 'package_low', v_pkg, v_owner, null, 'medium', 'financial', 'none', null);
  if a.balance <= 0 then
    perform chat.work_task_set_floor(a.organization_id, 'package_low:' || v_pkg, 'high');
  end if;
  return v_id;
end;
$$;

-- A renewal the parent asked for while the child is locked: High at once.
-- Keyed by the child's newest package, so a tap on another day joins it.
create or replace function chat.work_task_raise_renewal(p_request uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  q       chat.renewal_request;
  v_pkg   uuid;
  v_owner uuid;
begin
  select * into q from chat.renewal_request where id = p_request;
  if q.id is null or q.requested_at < chat.work_task_since('renewal_request') then
    return null;
  end if;
  v_pkg := chat.work_task_newest_package(q.learner_id);
  if v_pkg is null or exists (select 1 from chat.learner_subscription s
                               where s.id = v_pkg and s.created_at > q.requested_at) then
    return null; -- no package to renew, or already renewed
  end if;
  v_owner := chat.work_task_sales_owner(q.family_id);
  if v_owner is null then
    perform chat.work_task_note_issue(q.organization_id, 'renewal_request:' || v_pkg, 'no live Sales owner or Sales manager');
    return null;
  end if;
  return chat.work_task_raise(q.organization_id, 'renewal_request', v_pkg, v_owner, null, 'high', 'financial', 'none',
                              q.requested_at + interval '24 hours');
end;
$$;

-- A parent's transfer receipt: Yellow on upload, Red at 48 h (owner Q-F7).
create or replace function chat.work_task_raise_receipt(p_receipt uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  r       chat.payment_receipt;
  v_lrn   uuid;
  v_owner uuid;
begin
  select * into r from chat.payment_receipt where id = p_receipt;
  if r.id is null or r.status <> 'pending' or r.uploaded_at < chat.work_task_since('receipt_review') then
    return null;
  end if;
  v_lrn := (select i.learner_id from chat.payment_request q join chat.family_instalment i on i.id = q.instalment_id
             where q.id = r.request_id);
  v_owner := chat.work_task_billing_owner(r.family_id, v_lrn);
  if v_owner is null then
    perform chat.work_task_note_issue(r.organization_id, 'receipt_review:' || r.id, 'no live billing supervisor or Operations manager');
    return null;
  end if;
  return chat.work_task_raise(r.organization_id, 'receipt_review', r.id, v_owner, null, 'medium', 'financial', 'generic',
                              r.uploaded_at + interval '72 hours');
end;
$$;

-- A card payment that failed (owner Q-F5): High, one task per payment request.
create or replace function chat.work_task_raise_checkout_failed(p_request uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  q       chat.payment_request;
  v_lrn   uuid;
  v_owner uuid;
begin
  select * into q from chat.payment_request where id = p_request;
  if q.id is null or q.family_id is null or q.paid_at is not null or q.cancelled_at is not null
     or not exists (select 1 from chat.payment_checkout c
                     where c.request_id = q.id and c.status = 'failed'
                       and c.created_at >= chat.work_task_since('checkout_failed')) then
    return null;
  end if;
  v_lrn := coalesce(q.learner_id, (select i.learner_id from chat.family_instalment i where i.id = q.instalment_id));
  v_owner := chat.work_task_billing_owner(q.family_id, v_lrn);
  if v_owner is null then
    perform chat.work_task_note_issue(q.organization_id, 'checkout_failed:' || q.id, 'no live billing supervisor or Operations manager');
    return null;
  end if;
  return chat.work_task_raise(q.organization_id, 'checkout_failed', q.id, v_owner, null, 'high', 'financial', 'none', null);
end;
$$;

-- The owner a financial task follows now.
create or replace function chat.work_task_financial_owner(p_type text, p_source uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select case p_type
    when 'instalment' then (select chat.work_task_billing_owner(i.family_id, i.learner_id)
                              from chat.family_instalment i where i.id = p_source)
    when 'package_low' then (select chat.work_task_sales_owner(s.family_id) from chat.learner_subscription s where s.id = p_source)
    when 'renewal_request' then (select chat.work_task_sales_owner(s.family_id) from chat.learner_subscription s where s.id = p_source)
    when 'receipt_review' then (select chat.work_task_billing_owner(r.family_id,
                                         (select i.learner_id from chat.payment_request q join chat.family_instalment i on i.id = q.instalment_id
                                           where q.id = r.request_id))
                                  from chat.payment_receipt r where r.id = p_source)
    when 'checkout_failed' then (select chat.work_task_billing_owner(q.family_id,
                                          coalesce(q.learner_id, (select i.learner_id from chat.family_instalment i where i.id = q.instalment_id)))
                                   from chat.payment_request q where q.id = p_source)
  end;
$$;

-- ===========================================================================
-- 3. The sweep of the financial sources
-- ===========================================================================

-- As chat.work_task_sweep: batches of at most 60 rows (one subtransaction
-- each), an advisory lock of its own, declined candidates recorded with a
-- back-off. Returns its counts.
create or replace function chat.work_task_sweep_financial(p_batch integer default 50)
returns jsonb
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_left      integer := least(greatest(coalesce(p_batch, 50), 1), 60);
  v_raised    integer := 0;
  v_settled   integer := 0;
  v_withdrawn integer := 0;
  v_rerouted  integer := 0;
  v_floored   integer := 0;
  v_failed    integer := 0;
  v_declined  integer := 0;
  v_more      boolean := false;
  r           record;
  s_inst      date;
  s_renew     timestamptz;
  s_receipt   timestamptz;
  s_checkout  timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('chat.work_task_sweep_financial')) then
    return jsonb_build_object('skipped', true);
  end if;
  s_inst := chat.work_task_since('instalment')::date;
  s_renew := chat.work_task_since('renewal_request');
  s_receipt := chat.work_task_since('receipt_review');
  s_checkout := chat.work_task_since('checkout_failed');

  -- The issue log shrinks with these sources too.
  delete from chat.work_task_source_issue i
   where split_part(i.source_key, ':', 1) in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed')
     and (exists (select 1 from chat.work_task t
                   where t.organization_id = i.organization_id and t.source_key = i.source_key
                     and t.state in ('completed', 'removed'))
          or case split_part(i.source_key, ':', 1)
               when 'instalment' then not exists (select 1 from chat.family_instalment x
                                                   where x.id = split_part(i.source_key, ':', 2)::uuid
                                                     and x.paid_on is null and x.voided_at is null)
               when 'receipt_review' then not exists (select 1 from chat.payment_receipt x
                                                       where x.id = split_part(i.source_key, ':', 2)::uuid and x.status = 'pending')
               when 'checkout_failed' then not exists (select 1 from chat.payment_request x
                                                        where x.id = split_part(i.source_key, ':', 2)::uuid
                                                          and x.paid_at is null and x.cancelled_at is null)
               else not exists (select 1 from chat.learner_subscription x
                                 where x.id = split_part(i.source_key, ':', 2)::uuid and x.voided_at is null)
             end);

  -- Create.
  for r in
    select x.org, x.src, x.id, x.key from (
      select i.organization_id as org, 'instalment' as src, i.id, 'instalment:' || i.id as key, i.due_date::timestamptz as at
        from chat.family_instalment i
       where i.paid_on is null and i.voided_at is null
         and i.due_date <= chat.academy_today() + 7 and i.due_date >= s_inst
      union all
      select a.organization_id, 'package_low', a.learner_id, 'package_low:' || chat.work_task_newest_package(a.learner_id), a.computed_at
        from chat.learner_access a
       where a.balance is not null and a.balance <= 2 and chat.work_task_newest_package(a.learner_id) is not null
      union all
      select q.organization_id, 'renewal_request', q.id, 'renewal_request:' || chat.work_task_newest_package(q.learner_id), q.requested_at
        from chat.renewal_request q
       where q.requested_at >= s_renew and chat.work_task_newest_package(q.learner_id) is not null
         and not exists (select 1 from chat.learner_subscription s
                          where s.learner_id = q.learner_id and s.voided_at is null and s.created_at > q.requested_at)
      union all
      select r2.organization_id, 'receipt_review', r2.id, 'receipt_review:' || r2.id, r2.uploaded_at
        from chat.payment_receipt r2
       where r2.status = 'pending' and r2.uploaded_at >= s_receipt
      union all
      select q.organization_id, 'checkout_failed', q.id, 'checkout_failed:' || q.id, min(c.created_at)
        from chat.payment_request q join chat.payment_checkout c on c.request_id = q.id and c.status = 'failed'
       where q.family_id is not null and q.paid_at is null and q.cancelled_at is null and c.created_at >= s_checkout
       group by q.organization_id, q.id
    ) x
     where not exists (select 1 from chat.work_task t where t.organization_id = x.org and t.source_key = x.key)
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = x.org and i.source_key = x.key and i.next_try_at > now())
     order by x.at
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if (case r.src
            when 'instalment' then chat.work_task_raise_instalment(r.id)
            when 'package_low' then chat.work_task_raise_package_low(r.id)
            when 'renewal_request' then chat.work_task_raise_renewal(r.id)
            when 'receipt_review' then chat.work_task_raise_receipt(r.id)
            when 'checkout_failed' then chat.work_task_raise_checkout_failed(r.id)
          end) is not null then
        v_raised := v_raised + 1;
      else
        v_declined := v_declined + 1;
        if not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = r.org and i.source_key = r.key and i.next_try_at > now()) then
          perform chat.work_task_note_issue(r.org, r.key, 'not raised: its source declined it (see its raise rule)');
        end if;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, r.key, sqlerrm);
    end;
  end loop;

  -- Reconcile: positive evidence only, re-read now.
  for r in
    select y.* from (
      select t.organization_id as org, t.source_key as key, t.source_type as src, t.source_floor,
             case t.source_type
               when 'instalment' then (select case when i.paid_on is not null then 'done' when i.voided_at is not null then 'gone' end
                                         from chat.family_instalment i where i.id = t.source_id)
               when 'package_low' then (select case when s.voided_at is not null then 'gone'
                                                   when chat.work_task_newest_package(s.learner_id) is distinct from s.id then 'done'
                                                   when coalesce((select a.balance from chat.learner_access a where a.learner_id = s.learner_id), 0) > 2 then 'done'
                                                   when coalesce((select a.balance from chat.learner_access a where a.learner_id = s.learner_id), 1) <= 0
                                                        and t.source_floor is null then 'floor' end
                                          from chat.learner_subscription s where s.id = t.source_id)
               when 'renewal_request' then (select case when s.voided_at is not null then 'gone'
                                                       when chat.work_task_newest_package(s.learner_id) is distinct from s.id then 'done' end
                                              from chat.learner_subscription s where s.id = t.source_id)
               when 'receipt_review' then (select case when x.status <> 'pending' then 'done' end
                                             from chat.payment_receipt x where x.id = t.source_id)
               when 'checkout_failed' then (select case when q.paid_at is not null then 'done' when q.cancelled_at is not null then 'gone' end
                                              from chat.payment_request q where q.id = t.source_id)
             end as verdict,
             case t.source_type
               when 'instalment' then (select i.paid_recorded_by from chat.family_instalment i where i.id = t.source_id)
               when 'package_low' then (select n.created_by from chat.learner_subscription s
                                          join chat.learner_subscription n on n.id = chat.work_task_newest_package(s.learner_id)
                                         where s.id = t.source_id and n.id <> s.id)
               when 'renewal_request' then (select n.created_by from chat.learner_subscription s
                                              join chat.learner_subscription n on n.id = chat.work_task_newest_package(s.learner_id)
                                             where s.id = t.source_id and n.id <> s.id)
               when 'receipt_review' then (select x.reviewed_by from chat.payment_receipt x where x.id = t.source_id)
             end as actor
        from chat.work_task t
       where t.kind = 'system' and t.state in ('open', 'awaiting_decision') and t.source_state = 'pending'
         and t.source_type in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed')
    ) y
     where y.verdict is not null
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if r.verdict = 'done' then
        v_settled := v_settled + chat.work_task_settle(r.org, r.key, r.actor);
      elsif r.verdict = 'gone' then
        v_withdrawn := v_withdrawn + chat.work_task_withdraw(r.org, r.key);
      else
        v_floored := v_floored + chat.work_task_set_floor(r.org, r.key, 'high');
      end if;
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, r.key, sqlerrm);
    end;
  end loop;

  -- Owners: a financial task follows the family's billing supervisor or Sales
  -- owner (the system moves it: nobody reassigns it by hand). Retries respect
  -- the back-off.
  for r in
    select t.organization_id as org, t.source_key as key, chat.work_task_financial_owner(t.source_type, t.source_id) as owner
      from chat.work_task t
     where t.kind = 'system' and t.state in ('open', 'awaiting_decision')
       and t.source_type in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed')
       and chat.work_task_financial_owner(t.source_type, t.source_id) is not null
       and t.assignee_staff_id is distinct from chat.work_task_financial_owner(t.source_type, t.source_id)
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = t.organization_id and i.source_key = t.source_key and i.next_try_at > now())
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      v_rerouted := v_rerouted + chat.work_task_reroute(r.org, r.key, r.owner, null, null);
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, r.key, sqlerrm);
    end;
  end loop;

  return jsonb_build_object('skipped', false, 'raised', v_raised, 'settled', v_settled, 'withdrawn', v_withdrawn,
                            'restored', 0, 'rerouted', v_rerouted, 'floored', v_floored, 'failed', v_failed,
                            'declined', v_declined, 'more', v_more,
                            'issues', (select count(*) from chat.work_task_source_issue));
end;
$$;

-- ===========================================================================
-- 4. The source triggers: in the source's own transaction, never blocking it
-- ===========================================================================

-- An instalment paid (by who recorded it; a card payment, by the system) or
-- voided; its failed checkouts' tasks with it.
create or replace function chat.work_task_from_instalment()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  q record;
begin
  begin
    if old.paid_on is null and new.paid_on is not null then
      perform chat.work_task_settle(new.organization_id, 'instalment:' || new.id, new.paid_recorded_by);
    elsif old.voided_at is null and new.voided_at is not null then
      perform chat.work_task_withdraw(new.organization_id, 'instalment:' || new.id);
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'instalment:' || new.id, sqlerrm);
  end;
  if old.paid_on is null and new.paid_on is not null then
    for q in select x.id from chat.payment_request x where x.instalment_id = new.id loop
      begin
        perform chat.work_task_settle(new.organization_id, 'checkout_failed:' || q.id, new.paid_recorded_by);
      exception when others then
        perform chat.work_task_note_issue(new.organization_id, 'checkout_failed:' || q.id, sqlerrm);
      end;
    end loop;
  end if;
  return null;
end;
$$;

create trigger family_instalment_settles_its_task after update of paid_on, voided_at on chat.family_instalment
  for each row
  when ((old.paid_on is null and new.paid_on is not null) or (old.voided_at is null and new.voided_at is not null))
  execute function chat.work_task_from_instalment();

-- A child's balance changed (chat.refresh_learner_access): raise at <= 2,
-- High at 0, completed above 2.
create or replace function chat.work_task_from_learner_access()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  t record;
begin
  begin
    if new.balance is not null and new.balance <= 2 then
      perform chat.work_task_raise_package_low(new.learner_id);
      if new.balance <= 0 then
        perform chat.work_task_set_floor(new.organization_id, 'package_low:' || chat.work_task_newest_package(new.learner_id), 'high');
      end if;
    elsif new.balance is not null and new.balance > 2 then
      for t in select w.source_key from chat.work_task w
                 join chat.learner_subscription s on s.id = w.source_id
                where w.source_type = 'package_low' and s.learner_id = new.learner_id
                  and w.state in ('open', 'awaiting_decision')
      loop
        perform chat.work_task_settle(new.organization_id, t.source_key,
                                      (select n.created_by from chat.learner_subscription n
                                        where n.id = chat.work_task_newest_package(new.learner_id)
                                          and 'package_low:' || n.id <> t.source_key));
      end loop;
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'package_low:' || coalesce(chat.work_task_newest_package(new.learner_id)::text, new.learner_id::text), sqlerrm);
  end;
  return null;
end;
$$;

create trigger learner_access_raises_package_task after insert on chat.learner_access
  for each row execute function chat.work_task_from_learner_access();
create trigger learner_access_moves_package_task after update of balance on chat.learner_access
  for each row when (old.balance is distinct from new.balance)
  execute function chat.work_task_from_learner_access();

-- A new package: the renewal asked for is done, and the old package's low
-- balance with it -- by whoever entered the package.
create or replace function chat.work_task_from_learner_subscription()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  t record;
begin
  for t in select w.source_key from chat.work_task w
             join chat.learner_subscription s on s.id = w.source_id
            where w.source_type in ('renewal_request', 'package_low') and s.learner_id = new.learner_id
              and s.id <> new.id and w.state in ('open', 'awaiting_decision')
  loop
    begin
      perform chat.work_task_settle(new.organization_id, t.source_key, new.created_by);
    exception when others then
      perform chat.work_task_note_issue(new.organization_id, t.source_key, sqlerrm);
    end;
  end loop;
  return null;
end;
$$;

create trigger learner_subscription_settles_renewal_tasks after insert on chat.learner_subscription
  for each row execute function chat.work_task_from_learner_subscription();

create or replace function chat.work_task_from_renewal_request()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    perform chat.work_task_raise_renewal(new.id);
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'renewal_request:' || coalesce(chat.work_task_newest_package(new.learner_id)::text, new.id::text), sqlerrm);
  end;
  return null;
end;
$$;

create trigger renewal_request_raises_its_task after insert on chat.renewal_request
  for each row execute function chat.work_task_from_renewal_request();

create or replace function chat.work_task_from_receipt()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform chat.work_task_raise_receipt(new.id);
    else
      perform chat.work_task_settle(new.organization_id, 'receipt_review:' || new.id, new.reviewed_by);
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'receipt_review:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger payment_receipt_raises_its_task after insert on chat.payment_receipt
  for each row execute function chat.work_task_from_receipt();
create trigger payment_receipt_settles_its_task after update of status on chat.payment_receipt
  for each row when (old.status = 'pending' and new.status <> 'pending')
  execute function chat.work_task_from_receipt();

create or replace function chat.work_task_from_checkout()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    perform chat.work_task_raise_checkout_failed(new.request_id);
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'checkout_failed:' || new.request_id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger payment_checkout_raises_its_task after update of status on chat.payment_checkout
  for each row when (old.status is distinct from new.status and new.status = 'failed')
  execute function chat.work_task_from_checkout();

-- A request paid (by card: the system) or cancelled.
create or replace function chat.work_task_from_payment_request()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if old.paid_at is null and new.paid_at is not null then
      perform chat.work_task_settle(new.organization_id, 'checkout_failed:' || new.id, null);
    elsif old.cancelled_at is null and new.cancelled_at is not null then
      perform chat.work_task_withdraw(new.organization_id, 'checkout_failed:' || new.id);
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'checkout_failed:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger payment_request_settles_its_task after update of paid_at, cancelled_at on chat.payment_request
  for each row
  when ((old.paid_at is null and new.paid_at is not null) or (old.cancelled_at is null and new.cancelled_at is not null))
  execute function chat.work_task_from_payment_request();

-- ===========================================================================
-- 5. The history may say the system completed a financial task (a family
--    paid online); the guard keeps financial tasks with their owner.
-- ===========================================================================

alter table chat.work_task_event drop constraint work_task_event_system_kinds;
alter table chat.work_task_event add constraint work_task_event_system_kinds
  check (actor_kind <> 'system'
         or kind in ('created', 'source_withdrawn', 'source_restored', 'source_raised', 'reassigned', 'completed'));

create or replace function chat.guard_work_task()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor    text := nullif(current_setting('chat.task_actor', true), '');
  v_note     text := nullif(btrim(coalesce(current_setting('chat.task_note', true), '')), '');
  v_org      uuid;
  v_moved    boolean;
  v_returned boolean;
  -- PD-47 PR-2: a source's own helpers (chat.work_task_raise / _settle /
  -- _withdraw / _reroute / _redate) say so; nothing else may set it.
  v_system   boolean := coalesce(current_setting('chat.task_system', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'a task is never deleted; it is completed, removed or reassigned' using errcode = 'check_violation';
  end if;
  if v_actor is null and not v_system then
    raise exception 'a task changes only with its actor named (chat.task_actor)' using errcode = 'insufficient_privilege';
  end if;
  v_org := case when tg_op = 'INSERT' then new.organization_id else old.organization_id end;
  -- A person acts live. A source names who did its work, who may have left since.
  if v_actor is not null and not v_system and chat.task_principal_kind(v_actor::uuid, v_org) is null then
    raise exception 'a task is changed by a live person of its organization (chat.task_actor)' using errcode = 'insufficient_privilege';
  end if;
  if v_actor is not null and v_system and chat.task_principal_any(v_actor::uuid, v_org) is null then
    raise exception 'a source names a person of the task''s organization (chat.task_actor)' using errcode = 'insufficient_privilege';
  end if;
  if num_nonnulls(new.assignee_staff_id, new.assignee_teacher_id) <> 1 then
    raise exception 'a task is assigned to exactly one person' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' and new.kind = 'system' then
    if not v_system or new.created_by is not null then
      raise exception 'a system task is made by its source (chat.work_task_raise)' using errcode = 'insufficient_privilege';
    end if;
    if new.state <> 'open' or new.source_state is distinct from 'pending' or new.source_floor is not null then
      raise exception 'a system task is created open and pending' using errcode = 'check_violation';
    end if;
    if chat.task_principal_kind(coalesce(new.assignee_staff_id, new.assignee_teacher_id), new.organization_id) is null then
      raise exception 'a task is assigned to a live person of its organization' using errcode = 'check_violation';
    end if;
    new.outcome := null;
    new.closed_by := null;
    new.closed_at := null;
    new.close_reason := null;
    new.instructions := null;
    new.revision := 1;
    new.created_at := now();
    new.updated_at := now();
    new.activity_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.kind <> 'manual' then
      raise exception 'a system task is made by its source' using errcode = 'check_violation';
    end if;
    if new.created_by is null or new.created_by::text is distinct from v_actor then
      raise exception 'a manual task is created by its actor' using errcode = 'insufficient_privilege';
    end if;
    if new.state <> 'open' then
      raise exception 'a task is created open' using errcode = 'check_violation';
    end if;
    -- PD-47 priority: a manual task's urgency follows its due date (the
    -- generic floor); only a source names another rule or raises a floor.
    if new.floor_rule <> 'generic' or new.source_floor is not null then
      raise exception 'a manual task has the generic floor and no source floor' using errcode = 'check_violation';
    end if;
    if chat.task_principal_kind(coalesce(new.assignee_staff_id, new.assignee_teacher_id), new.organization_id) is null then
      raise exception 'a task is assigned to a live person of its organization' using errcode = 'check_violation';
    end if;
    new.outcome := null;
    new.closed_by := null;
    new.closed_at := null;
    new.close_reason := null;
    new.revision := 1;
    new.created_at := now();
    new.updated_at := now();
    new.activity_at := now();
    return new;
  end if;

  -- UPDATE
  -- source_state and source_floor change with the sources (PR-2, PR-2b), which
  -- record source_withdrawn and source_raised. A category and a floor rule are
  -- fixed at creation (PD-47 priority amendment §1).
  if (new.id, new.organization_id, new.kind, new.source_type, new.source_id, new.source_key,
      new.category, new.floor_rule, new.title, new.body, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.kind, old.source_type, old.source_id, old.source_key,
      old.category, old.floor_rule, old.title, old.body, old.created_by, old.created_at) then
    raise exception 'a task''s what, source and creator never change' using errcode = 'check_violation';
  end if;
  -- The source's state and floor are the source's alone (its helpers).
  if (new.source_state, new.source_floor) is distinct from (old.source_state, old.source_floor) then
    if not v_system then
      raise exception 'a task''s source state and floor change only with its source' using errcode = 'check_violation';
    end if;
    if new.source_state is distinct from old.source_state
       and not (old.source_state = 'pending' and new.source_state = 'withdrawn'
                or old.source_state = 'withdrawn' and new.source_state = 'pending') then
      raise exception 'a source is pending or withdrawn' using errcode = 'check_violation';
    end if;
  end if;
  if old.state in ('completed', 'removed') then
    raise exception 'a closed task stays closed' using errcode = 'check_violation';
  end if;

  v_moved := (new.assignee_staff_id, new.assignee_teacher_id) is distinct from (old.assignee_staff_id, old.assignee_teacher_id);
  v_returned := old.state = 'awaiting_decision' and new.state = 'open' and not v_moved;
  -- A lesson report and a correction are the lesson's teacher's, a case's task
  -- follows the case's owner, and a financial task the family's billing
  -- supervisor or Sales owner: only their source moves them (PR-2, PR-2b).
  if v_moved and old.kind = 'system' and not v_system
     and old.source_type in ('lesson_report', 'report_correction', 'case',
                             'instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed') then
    raise exception 'this task follows its source: change the lesson''s teacher, the case''s owner, or the family''s billing supervisor or Sales owner' using errcode = 'check_violation';
  end if;
  if v_moved and chat.task_principal_kind(coalesce(new.assignee_staff_id, new.assignee_teacher_id), old.organization_id) is null then
    raise exception 'a task is reassigned to a live person of its organization' using errcode = 'check_violation';
  end if;

  if new.state is distinct from old.state then
    -- The four exits, and nothing else.
    if not (old.state = 'open' and new.state in ('awaiting_decision', 'completed', 'removed')
            or old.state = 'awaiting_decision' and new.state in ('open', 'completed', 'removed')) then
      raise exception 'a task moves only by its four exits' using errcode = 'check_violation';
    end if;
    if new.state = 'awaiting_decision' and v_note is null then
      raise exception 'out of scope needs a comment (chat.task_note)' using errcode = 'check_violation';
    end if;
    if new.state = 'removed' and v_note is null then
      raise exception 'a removal needs a reason (chat.task_note)' using errcode = 'check_violation';
    end if;
    if v_returned and v_note is null then
      raise exception 'a return needs instructions (chat.task_note)' using errcode = 'check_violation';
    end if;
    -- A system task is completed by its work (its source's helper), or
    -- acknowledged by its assignee once its source went away (plan Q4).
    if new.state = 'completed' and old.kind = 'system' and not v_system
       and not (new.outcome = 'acknowledged' and old.source_state = 'withdrawn') then
      raise exception 'a system task is completed by doing its work' using errcode = 'check_violation';
    end if;
    if new.outcome = 'acknowledged' and not (old.kind = 'system' and old.source_state = 'withdrawn') then
      raise exception 'only a task whose source went away is acknowledged' using errcode = 'check_violation';
    end if;
    if new.state in ('completed', 'removed') then
      new.closed_by := v_actor::uuid;
      new.closed_at := now();
      new.close_reason := v_note;
    end if;
  elsif (new.outcome, new.closed_by, new.closed_at, new.close_reason)
        is distinct from (old.outcome, old.closed_by, old.closed_at, old.close_reason) then
    raise exception 'a task is closed only by moving to completed or removed' using errcode = 'check_violation';
  end if;

  -- Instructions come with a return or a reassignment, which record them.
  if new.instructions is distinct from old.instructions and not (v_returned or v_moved) then
    raise exception 'instructions come with a return or a reassignment' using errcode = 'check_violation';
  end if;
  -- Every change is recorded: a move, a state, a due date, a priority -- or a
  -- comment, whose event touches the task from its own trigger (activity_at only).
  if not (v_moved or new.state is distinct from old.state or new.due_at is distinct from old.due_at
          or new.priority is distinct from old.priority
          or (new.source_state, new.source_floor) is distinct from (old.source_state, old.source_floor)) then
    if not (pg_trigger_depth() > 1 and new.activity_at is distinct from old.activity_at
            and new.instructions is not distinct from old.instructions) then
      raise exception 'a task changes only with a recorded event' using errcode = 'check_violation';
    end if;
  end if;

  -- activity_at is the task's last event: a comment sets it (from its own
  -- trigger), every other recorded change here.
  if v_moved or new.state is distinct from old.state or new.due_at is distinct from old.due_at
     or new.priority is distinct from old.priority
     or (new.source_state, new.source_floor) is distinct from (old.source_state, old.source_floor) then
    new.activity_at := now();
  end if;
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- 6. Fail closed
-- ===========================================================================

revoke all on function chat.work_task_billing_owner(uuid, uuid) from public;
revoke all on function chat.work_task_sales_owner(uuid) from public;
revoke all on function chat.work_task_newest_package(uuid) from public;
revoke all on function chat.work_task_set_floor(uuid, text, text) from public;
revoke all on function chat.work_task_raise_instalment(uuid) from public;
revoke all on function chat.work_task_raise_package_low(uuid) from public;
revoke all on function chat.work_task_raise_renewal(uuid) from public;
revoke all on function chat.work_task_raise_receipt(uuid) from public;
revoke all on function chat.work_task_raise_checkout_failed(uuid) from public;
revoke all on function chat.work_task_financial_owner(text, uuid) from public;
revoke all on function chat.work_task_sweep_financial(integer) from public;
revoke all on function chat.work_task_from_instalment() from public;
revoke all on function chat.work_task_from_learner_access() from public;
revoke all on function chat.work_task_from_learner_subscription() from public;
revoke all on function chat.work_task_from_renewal_request() from public;
revoke all on function chat.work_task_from_receipt() from public;
revoke all on function chat.work_task_from_checkout() from public;
revoke all on function chat.work_task_from_payment_request() from public;
revoke all on function chat.guard_work_task() from public;
