-- PD-47 (2026-10-29), PR-2b -- financial tasks from their sources. Slot 20261029233000.
--
-- Plan: docs/product/pd047-amendment-priority.md §5-§6 (owner-approved
-- 2026-10-28: thresholds, Q-F1..F7). Builds on 20261029210000 (PR-2): its
-- helpers (raise / settle / withdraw / restore / reroute, the issue log, the
-- cut-offs) and its guard, redefined here to add these sources to the ones
-- that follow their source.
--
-- Every task here is category 'financial' (sorted first inside its colour).
--
--   source_type       key                        assignee                             level
--   instalment        instalment:<instalment>    billing owner*                       floor 'instalment': D-7 Yellow, D0 Red, D+1 overdue
--   package_low       package_low:<episode>      the family's Sales owner, else the   Yellow at <= 2 lessons left; source floor High at 0
--                                                live Sales manager
--   renewal_request   renewal_request:<episode>  as package_low                       High (the child is locked)
--   receipt_review    receipt_review:<receipt>   billing owner*                       generic, due upload + 72 h: Yellow on upload, Red at 48 h
--   checkout_failed   checkout_failed:<request>  billing owner*                       High
--
--   * the billing owner: the child's PD-8 supervisor for a child instalment,
--     the family's billing supervisor for a family one (BillingService's
--     responsibleSupervisor), while live; else the live Operations manager.
--
--   An EPISODE (chat.work_task_package_episode) is one stretch of a child's
--   newest package running low, or one renewal asked for on it. A package
--   that comes back as the newest (the newer one voided with its payment)
--   opens a fresh episode: the old task's key is spent, the new low is not.
--
--   Completed on positive evidence, by who did it, the evidence in the
--   completion event: the instalment or the request paid (by who recorded the
--   covering payment; a card payment names nobody, so the system), a newer
--   package (its creator), the receipt reviewed (its reviewer). Withdrawn when
--   the source goes away: an instalment voided; a standalone request
--   cancelled; a package voided, or a correction lifting the balance above 2
--   (restored if it falls again). A failed checkout of an instalment follows
--   the INSTALMENT: a link replaced or cancelled while the money is still owed
--   leaves it open.
--
--   Financial tasks follow their owner: the sweep moves them when the billing
--   supervisor or Sales owner changes, and nobody moves them by hand -- except
--   the super admin, for a task whose assignee has left with nobody live to
--   follow (recorded in the issue log until then).
--
--   A system completion: the family paid online, and no staff member did the
--   work, so 'completed' joins the event kinds the system may write -- for
--   these five sources only (the guard); every other source names its actor.
--
--   Cut-offs (owner 2026-10-29, the last 14 days): instalments by due date
--   (the academy's day), receipts by upload, failed checkouts and renewals by
--   their time; a low balance is a present state and has none.
--
-- FAIL CLOSED: RLS and revoked grants as PR-1/PR-2. Every function pins its
-- search_path.

-- ===========================================================================
-- 1. Who, and what proves the work
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

-- The standing payment that completed a request or an instalment: the latest.
create or replace function chat.work_task_covering_payment(p_request uuid, p_instalment uuid)
returns chat.payment
language sql
stable
set search_path = chat, pg_temp
as $$
  select p.* from chat.payment p
   where p.voided_at is null
     and (p.request_id = p_request or p.instalment_id = p_instalment)
   order by p.recorded_at desc, p.id desc
   limit 1;
$$;

-- One stretch of a child's newest package running low, or one renewal asked
-- for on it: the task's source.
create table chat.work_task_package_episode (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  source_type      text not null check (source_type in ('package_low', 'renewal_request')),
  learner_id       uuid not null references chat.learner (id) on delete restrict,
  family_id        uuid not null references chat.family (id) on delete restrict,
  -- The child's newest package when it opened. No foreign key, as PD-30's
  -- request_id: a package is never deleted (chat.guard_learner_subscription).
  subscription_id  uuid not null,
  opened_at        timestamptz not null default clock_timestamp()
);

comment on table chat.work_task_package_episode is
  'PD-47 PR-2b: one stretch of a child''s newest package running low (or one renewal asked for on it) -- the source of a package_low / renewal_request task. Written only by chat.work_task_episode_for.';

create index work_task_package_episode_learner_idx
  on chat.work_task_package_episode (learner_id, source_type, opened_at desc, id desc);

-- The child's current episode of p_type: the latest, while it is on the
-- newest package and its task is not spent; else a fresh one on the newest
-- package. Null when there is no package, or a manager removed this
-- package's task (not raised again for it).
create or replace function chat.work_task_episode_for(p_type text, p_learner uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_pkg   uuid;
  v_id    uuid;
  v_sub   uuid;
  v_state text;
begin
  -- One writer per child and kind, so a trigger and the sweep never open two;
  -- without waiting: a busy child is the next sweep's.
  if not pg_try_advisory_xact_lock(hashtextextended('chat.work_task_episode:' || p_type || ':' || p_learner, 0)) then
    return null;
  end if;
  v_pkg := chat.work_task_newest_package(p_learner);
  if v_pkg is null then
    return null;
  end if;
  select e.id, e.subscription_id into v_id, v_sub
    from chat.work_task_package_episode e
   where e.learner_id = p_learner and e.source_type = p_type
   order by e.opened_at desc, e.id desc
   limit 1;
  if v_id is not null and v_sub = v_pkg then
    select t.state into v_state from chat.work_task t
     where t.source_key = p_type || ':' || v_id;
    if v_state is null or v_state in ('open', 'awaiting_decision') then
      return v_id;
    end if;
    if v_state = 'removed' then
      return null;
    end if;
  end if;
  insert into chat.work_task_package_episode (organization_id, source_type, learner_id, family_id, subscription_id)
  select s.organization_id, p_type, s.learner_id, s.family_id, s.id
    from chat.learner_subscription s where s.id = v_pkg
  returning id into v_id;
  return v_id;
end;
$$;

-- Where an episode's task stands against its package now:
--   gone   its package voided, or (a low balance) a correction lifted it above 2
--   done   a newer package
--   back   withdrawn by a correction, and low again
--   floor  used up: High
create or replace function chat.work_task_package_verdict(p_type text, p_episode uuid, p_source_state text, p_floor text)
returns text
language sql
stable
set search_path = chat, pg_temp
as $$
  select case
    when s.voided_at is not null then 'gone'
    when chat.work_task_newest_package(e.learner_id) is distinct from s.id then 'done'
    when p_type <> 'package_low' or a.balance is null then null
    when a.balance > 2 then case when p_source_state = 'pending' then 'gone' end
    when p_source_state = 'withdrawn' then 'back'
    when a.balance <= 0 and p_floor is null then 'floor'
  end
  from chat.work_task_package_episode e
  join chat.learner_subscription s on s.id = e.subscription_id
  left join chat.learner_access a on a.learner_id = e.learner_id
  where e.id = p_episode;
$$;

-- Who did a financial source's work, and its evidence for the history.
create or replace function chat.work_task_financial_done(p_type text, p_source uuid, out actor uuid, out evidence jsonb)
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_pay chat.payment;
  v_req chat.payment_request;
begin
  case p_type
    when 'instalment' then
      select i.paid_recorded_by into actor from chat.family_instalment i where i.id = p_source;
      v_pay := chat.work_task_covering_payment(null, p_source);
    when 'checkout_failed' then
      select * into v_req from chat.payment_request q where q.id = p_source;
      if v_req.paid_at is not null then
        v_pay := chat.work_task_covering_payment(p_source, null);
        actor := v_pay.recorded_by;
      else
        select i.paid_recorded_by into actor from chat.family_instalment i where i.id = v_req.instalment_id;
        v_pay := chat.work_task_covering_payment(null, v_req.instalment_id);
      end if;
    when 'receipt_review' then
      select x.reviewed_by, jsonb_strip_nulls(jsonb_build_object('receipt', x.status, 'paymentId', x.payment_id))
        into actor, evidence
        from chat.payment_receipt x where x.id = p_source;
    when 'package_low', 'renewal_request' then
      select s.created_by, jsonb_build_object('subscriptionId', s.id) into actor, evidence
        from chat.work_task_package_episode e
        join chat.learner_subscription s on s.id = chat.work_task_newest_package(e.learner_id)
       where e.id = p_source;
    else
      null;
  end case;
  if v_pay.id is not null then
    evidence := jsonb_build_object('paymentId', v_pay.id, 'method', v_pay.method);
  end if;
end;
$$;

-- chat.work_task_settle, its evidence recorded in the completion event.
create or replace function chat.work_task_settle_with(p_org uuid, p_key text, p_actor uuid, p_evidence jsonb)
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_prev text := current_setting('chat.task_evidence', true);
  v_n    integer;
begin
  perform set_config('chat.task_evidence', coalesce(p_evidence::text, ''), true);
  v_n := chat.work_task_settle(p_org, p_key, p_actor);
  perform set_config('chat.task_evidence', coalesce(v_prev, ''), true);
  return v_n;
end;
$$;

-- A source's work is done: who did it and the evidence, read now.
create or replace function chat.work_task_settle_financial(p_org uuid, p_type text, p_source uuid)
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  d record;
begin
  select * into d from chat.work_task_financial_done(p_type, p_source);
  return chat.work_task_settle_with(p_org, p_type || ':' || p_source, d.actor, d.evidence);
end;
$$;

-- A source floor raised (the balance used up), recorded as source_raised. It
-- never lowers: a child who ran out is in PD-30's grace, and the task stays
-- Red until a package arrives -- or a correction lifting the balance above 2
-- withdraws it, and a later low is a fresh episode.
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
     or i.due_date > chat.academy_today() + 7
     or i.due_date < (chat.work_task_since('instalment') at time zone chat.work_task_academy_zone())::date then
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

-- A child whose balance is 2 lessons or fewer (owner Q-F7), one task per
-- episode; High once the balance is used up (PD-30's grace begins).
create or replace function chat.work_task_raise_package_low(p_episode uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  e       chat.work_task_package_episode;
  v_bal   integer;
  v_owner uuid;
  v_id    uuid;
begin
  select * into e from chat.work_task_package_episode where id = p_episode and source_type = 'package_low';
  if e.id is null then
    return null;
  end if;
  select a.balance into v_bal from chat.learner_access a where a.learner_id = e.learner_id;
  if v_bal is null or v_bal > 2 or chat.work_task_newest_package(e.learner_id) is distinct from e.subscription_id then
    return null;
  end if;
  v_owner := chat.work_task_sales_owner(e.family_id);
  if v_owner is null then
    perform chat.work_task_note_issue(e.organization_id, 'package_low:' || e.id, 'no live Sales owner or Sales manager');
    return null;
  end if;
  v_id := chat.work_task_raise(e.organization_id, 'package_low', e.id, v_owner, null, 'medium', 'financial', 'none', null);
  if v_bal <= 0 then
    perform chat.work_task_set_floor(e.organization_id, 'package_low:' || e.id, 'high');
  end if;
  return v_id;
end;
$$;

-- A renewal the parent asked for while the child is locked: High at once.
-- One episode per package, so a tap on another day joins it.
create or replace function chat.work_task_raise_renewal(p_episode uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  e       chat.work_task_package_episode;
  v_at    timestamptz;
  v_owner uuid;
begin
  select * into e from chat.work_task_package_episode where id = p_episode and source_type = 'renewal_request';
  if e.id is null or chat.work_task_newest_package(e.learner_id) is distinct from e.subscription_id then
    return null;
  end if;
  -- The latest request still waiting: no live package entered after it.
  select max(q.requested_at) into v_at from chat.renewal_request q
   where q.learner_id = e.learner_id and q.requested_at >= chat.work_task_since('renewal_request')
     and not exists (select 1 from chat.learner_subscription s
                      where s.learner_id = q.learner_id and s.voided_at is null and s.created_at > q.requested_at);
  if v_at is null then
    return null; -- nothing asked for, or already renewed
  end if;
  v_owner := chat.work_task_sales_owner(e.family_id);
  if v_owner is null then
    perform chat.work_task_note_issue(e.organization_id, 'renewal_request:' || e.id, 'no live Sales owner or Sales manager');
    return null;
  end if;
  return chat.work_task_raise(e.organization_id, 'renewal_request', e.id, v_owner, null, 'high', 'financial', 'none',
                              v_at + interval '24 hours');
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

-- A card payment that failed (owner Q-F5): High, one task per payment
-- request. Stripe reports a failure only for a delayed method
-- (checkout.session.async_payment_failed); a card declined at the checkout
-- leaves the session to expire, and raises nothing.
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
    when 'package_low' then (select chat.work_task_sales_owner(e.family_id) from chat.work_task_package_episode e where e.id = p_source)
    when 'renewal_request' then (select chat.work_task_sales_owner(e.family_id) from chat.work_task_package_episode e where e.id = p_source)
    when 'receipt_review' then (select chat.work_task_billing_owner(r.family_id,
                                         (select i.learner_id from chat.payment_request q join chat.family_instalment i on i.id = q.instalment_id
                                           where q.id = r.request_id))
                                  from chat.payment_receipt r where r.id = p_source)
    when 'checkout_failed' then (select chat.work_task_billing_owner(q.family_id,
                                          coalesce(q.learner_id, (select i.learner_id from chat.family_instalment i where i.id = q.instalment_id)))
                                   from chat.payment_request q where q.id = p_source)
  end;
$$;

-- A child's package tasks follow the package (chat.work_task_package_verdict).
create or replace function chat.work_task_package_follow(p_learner uuid)
returns void
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  t record;
begin
  for t in
    select w.organization_id, w.source_key, w.source_type, w.source_id,
           chat.work_task_package_verdict(w.source_type, w.source_id, w.source_state, w.source_floor) as verdict
      from chat.work_task_package_episode e
      join chat.work_task w on w.organization_id = e.organization_id and w.source_key = e.source_type || ':' || e.id
     where e.learner_id = p_learner and w.state in ('open', 'awaiting_decision')
  loop
    begin
      case t.verdict
        when 'done' then perform chat.work_task_settle_financial(t.organization_id, t.source_type, t.source_id);
        when 'gone' then perform chat.work_task_withdraw(t.organization_id, t.source_key);
        when 'back' then perform chat.work_task_restore(t.organization_id, t.source_key);
        when 'floor' then perform chat.work_task_set_floor(t.organization_id, t.source_key, 'high');
        else null;
      end case;
    exception when others then
      perform chat.work_task_note_issue(t.organization_id, t.source_key, sqlerrm);
    end;
  end loop;
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
  v_restored  integer := 0;
  v_rerouted  integer := 0;
  v_floored   integer := 0;
  v_orphaned  integer := 0;
  v_failed    integer := 0;
  v_declined  integer := 0;
  v_more      boolean := false;
  v_ep        uuid;
  v_key       text;
  r           record;
  s_inst      date;
  s_renew     timestamptz;
  s_receipt   timestamptz;
  s_checkout  timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('chat.work_task_sweep_financial')) then
    return jsonb_build_object('skipped', true);
  end if;
  s_inst := (chat.work_task_since('instalment') at time zone chat.work_task_academy_zone())::date;
  s_renew := chat.work_task_since('renewal_request');
  s_receipt := chat.work_task_since('receipt_review');
  s_checkout := chat.work_task_since('checkout_failed');

  -- The issue log shrinks with these sources too: an occurrence resolved, or
  -- the move it waited for made.
  delete from chat.work_task_source_issue i
   where split_part(i.source_key, ':', 1) in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed')
     and (exists (select 1 from chat.work_task t
                   where t.organization_id = i.organization_id and t.source_key = i.source_key
                     and (t.state in ('completed', 'removed')
                          or chat.task_principal_kind(coalesce(t.assignee_staff_id, t.assignee_teacher_id), t.organization_id) is not null
                             and coalesce(chat.work_task_financial_owner(t.source_type, t.source_id), t.assignee_staff_id)
                                 is not distinct from t.assignee_staff_id))
          or case split_part(i.source_key, ':', 1)
               when 'instalment' then not exists (select 1 from chat.family_instalment x
                                                   where x.id = split_part(i.source_key, ':', 2)::uuid
                                                     and x.paid_on is null and x.voided_at is null)
               when 'receipt_review' then not exists (select 1 from chat.payment_receipt x
                                                       where x.id = split_part(i.source_key, ':', 2)::uuid and x.status = 'pending')
               when 'checkout_failed' then not exists (select 1 from chat.payment_request x
                                                         left join chat.family_instalment n on n.id = x.instalment_id
                                                        where x.id = split_part(i.source_key, ':', 2)::uuid and x.paid_at is null
                                                          and (x.cancelled_at is null
                                                               or n.id is not null and n.paid_on is null and n.voided_at is null))
               else not exists (select 1 from chat.work_task_package_episode e
                                  join chat.learner_subscription x on x.id = e.subscription_id
                                 where e.id = split_part(i.source_key, ':', 2)::uuid and x.voided_at is null)
             end);

  -- Create. A package candidate's key is its unraised episode's (whose
  -- back-off holds), or null for one to open.
  for r in
    select x.org, x.src, x.id, x.key from (
      select i.organization_id as org, 'instalment' as src, i.id, 'instalment:' || i.id as key, i.due_date::timestamptz as at
        from chat.family_instalment i
       where i.paid_on is null and i.voided_at is null
         and i.due_date <= chat.academy_today() + 7 and i.due_date >= s_inst
      union all
      select a.organization_id, 'package_low', a.learner_id,
             case when e.subscription_id = n.pkg and t.id is null then 'package_low:' || e.id end, a.computed_at
        from chat.learner_access a
        cross join lateral (select chat.work_task_newest_package(a.learner_id) as pkg) n
        left join lateral (select x.id, x.subscription_id from chat.work_task_package_episode x
                            where x.learner_id = a.learner_id and x.source_type = 'package_low'
                            order by x.opened_at desc, x.id desc limit 1) e on true
        left join chat.work_task t on t.organization_id = a.organization_id and t.source_key = 'package_low:' || e.id
       where a.balance is not null and a.balance <= 2 and n.pkg is not null
         and not coalesce(e.subscription_id = n.pkg and t.state in ('open', 'awaiting_decision', 'removed'), false)
      union all
      select q.organization_id, 'renewal_request', q.learner_id,
             case when e.subscription_id = n.pkg and t.id is null then 'renewal_request:' || e.id end, max(q.requested_at)
        from chat.renewal_request q
        cross join lateral (select chat.work_task_newest_package(q.learner_id) as pkg) n
        left join lateral (select x.id, x.subscription_id from chat.work_task_package_episode x
                            where x.learner_id = q.learner_id and x.source_type = 'renewal_request'
                            order by x.opened_at desc, x.id desc limit 1) e on true
        left join chat.work_task t on t.organization_id = q.organization_id and t.source_key = 'renewal_request:' || e.id
       where q.requested_at >= s_renew and n.pkg is not null
         and not exists (select 1 from chat.learner_subscription s
                          where s.learner_id = q.learner_id and s.voided_at is null and s.created_at > q.requested_at)
         and not coalesce(e.subscription_id = n.pkg and t.state in ('open', 'awaiting_decision', 'removed'), false)
       group by q.organization_id, q.learner_id, e.id, e.subscription_id, n.pkg, t.id
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
     where x.key is null
        or not exists (select 1 from chat.work_task t where t.organization_id = x.org and t.source_key = x.key)
           and not exists (select 1 from chat.work_task_source_issue i
                            where i.organization_id = x.org and i.source_key = x.key and i.next_try_at > now())
     order by x.at
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    -- An episode is opened before its raise, so a raise that fails keeps its key.
    v_ep := null;
    v_key := r.key;
    if r.src in ('package_low', 'renewal_request') then
      v_ep := chat.work_task_episode_for(r.src, r.id);
      v_key := r.src || ':' || coalesce(v_ep::text, r.id::text);
    end if;
    begin
      if (case r.src
            when 'instalment' then chat.work_task_raise_instalment(r.id)
            when 'package_low' then chat.work_task_raise_package_low(v_ep)
            when 'renewal_request' then chat.work_task_raise_renewal(v_ep)
            when 'receipt_review' then chat.work_task_raise_receipt(r.id)
            when 'checkout_failed' then chat.work_task_raise_checkout_failed(r.id)
          end) is not null then
        v_raised := v_raised + 1;
      else
        v_declined := v_declined + 1;
        if not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = r.org and i.source_key = v_key and i.next_try_at > now()) then
          perform chat.work_task_note_issue(r.org, v_key, 'not raised: its source declined it (see its raise rule)');
        end if;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, v_key, sqlerrm);
    end;
  end loop;

  -- Reconcile: positive evidence only, re-read now. A withdrawn task may come
  -- back, or be done; nothing else moves it.
  for r in
    select y.* from (
      select t.organization_id as org, t.source_key as key, t.source_type as src, t.source_id, t.source_state,
             case t.source_type
               when 'instalment' then (select case when i.paid_on is not null then 'done' when i.voided_at is not null then 'gone' end
                                         from chat.family_instalment i where i.id = t.source_id)
               when 'package_low' then chat.work_task_package_verdict(t.source_type, t.source_id, t.source_state, t.source_floor)
               when 'renewal_request' then chat.work_task_package_verdict(t.source_type, t.source_id, t.source_state, t.source_floor)
               when 'receipt_review' then (select case when x.status <> 'pending' then 'done' end
                                             from chat.payment_receipt x where x.id = t.source_id)
               -- An instalment's failed checkout follows the instalment; a
               -- standalone request, the request.
               when 'checkout_failed' then (select case when q.paid_at is not null or n.paid_on is not null then 'done'
                                                       when n.voided_at is not null then 'gone'
                                                       when q.cancelled_at is not null and q.instalment_id is null then 'gone' end
                                              from chat.payment_request q left join chat.family_instalment n on n.id = q.instalment_id
                                             where q.id = t.source_id)
             end as verdict
        from chat.work_task t
       where t.kind = 'system' and t.state in ('open', 'awaiting_decision')
         and t.source_type in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed')
    ) y
     where y.verdict is not null
       and (y.source_state = 'pending' and y.verdict <> 'back' or y.source_state = 'withdrawn' and y.verdict in ('back', 'done'))
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if r.verdict = 'done' then
        v_settled := v_settled + chat.work_task_settle_financial(r.org, r.src, r.source_id);
      elsif r.verdict = 'gone' then
        v_withdrawn := v_withdrawn + chat.work_task_withdraw(r.org, r.key);
      elsif r.verdict = 'back' then
        v_restored := v_restored + chat.work_task_restore(r.org, r.key);
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

  -- An owner who left with nobody live to follow: recorded (with its back-off)
  -- for the super admin, who may reassign it (the guard).
  for r in
    select t.organization_id as org, t.source_key as key
      from chat.work_task t
     where t.kind = 'system' and t.state in ('open', 'awaiting_decision')
       and t.source_type in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed')
       and chat.task_principal_kind(coalesce(t.assignee_staff_id, t.assignee_teacher_id), t.organization_id) is null
       and chat.work_task_financial_owner(t.source_type, t.source_id) is null
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = t.organization_id and i.source_key = t.source_key and i.next_try_at > now())
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    perform chat.work_task_note_issue(r.org, r.key,
      'its assignee left and nobody live follows (billing supervisor, Sales owner or their manager): the super admin may reassign it');
    v_orphaned := v_orphaned + 1;
  end loop;

  return jsonb_build_object('skipped', false, 'raised', v_raised, 'settled', v_settled, 'withdrawn', v_withdrawn,
                            'restored', v_restored, 'rerouted', v_rerouted, 'floored', v_floored, 'orphaned', v_orphaned,
                            'failed', v_failed, 'declined', v_declined, 'more', v_more,
                            'issues', (select count(*) from chat.work_task_source_issue));
end;
$$;

-- ===========================================================================
-- 4. The source triggers: in the source's own transaction, never blocking it
-- ===========================================================================

-- An instalment paid (by who recorded it; a card payment, by the system) or
-- voided; its failed checkouts' tasks follow it.
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
      perform chat.work_task_settle_financial(new.organization_id, 'instalment', new.id);
    elsif old.voided_at is null and new.voided_at is not null then
      perform chat.work_task_withdraw(new.organization_id, 'instalment:' || new.id);
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'instalment:' || new.id, sqlerrm);
  end;
  for q in select x.id from chat.payment_request x where x.instalment_id = new.id loop
    begin
      if old.paid_on is null and new.paid_on is not null then
        perform chat.work_task_settle_financial(new.organization_id, 'checkout_failed', q.id);
      elsif old.voided_at is null and new.voided_at is not null then
        perform chat.work_task_withdraw(new.organization_id, 'checkout_failed:' || q.id);
      end if;
    exception when others then
      perform chat.work_task_note_issue(new.organization_id, 'checkout_failed:' || q.id, sqlerrm);
    end;
  end loop;
  return null;
end;
$$;

create trigger family_instalment_settles_its_task after update of paid_on, voided_at on chat.family_instalment
  for each row
  when ((old.paid_on is null and new.paid_on is not null) or (old.voided_at is null and new.voided_at is not null))
  execute function chat.work_task_from_instalment();

-- A child's balance changed (chat.refresh_learner_access): its package tasks
-- follow the package, and a low balance opens (or rejoins) its episode.
create or replace function chat.work_task_from_learner_access()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    perform chat.work_task_package_follow(new.learner_id);
    if new.balance is not null and new.balance <= 2 then
      perform chat.work_task_raise_package_low(chat.work_task_episode_for('package_low', new.learner_id));
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'package_low:' || new.learner_id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger learner_access_raises_package_task after insert on chat.learner_access
  for each row execute function chat.work_task_from_learner_access();
create trigger learner_access_moves_package_task after update of balance on chat.learner_access
  for each row when (old.balance is distinct from new.balance)
  execute function chat.work_task_from_learner_access();

-- A package entered or voided: the child's package tasks follow it (the
-- balance trigger above usually has already).
create or replace function chat.work_task_from_learner_subscription()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    perform chat.work_task_package_follow(new.learner_id);
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'package_low:' || new.learner_id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger learner_subscription_settles_renewal_tasks after insert on chat.learner_subscription
  for each row execute function chat.work_task_from_learner_subscription();
create trigger learner_subscription_withdraws_package_tasks after update of voided_at on chat.learner_subscription
  for each row when (old.voided_at is null and new.voided_at is not null)
  execute function chat.work_task_from_learner_subscription();

create or replace function chat.work_task_from_renewal_request()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    perform chat.work_task_raise_renewal(chat.work_task_episode_for('renewal_request', new.learner_id));
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'renewal_request:' || new.learner_id, sqlerrm);
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
      perform chat.work_task_settle_financial(new.organization_id, 'receipt_review', new.id);
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

-- A request paid (by who recorded the covering payment; by card, the system)
-- or cancelled. An instalment's request cancelled -- an expired link replaced,
-- the instalment paid another way -- leaves its task to the instalment.
create or replace function chat.work_task_from_payment_request()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if old.paid_at is null and new.paid_at is not null then
      perform chat.work_task_settle_financial(new.organization_id, 'checkout_failed', new.id);
    elsif old.cancelled_at is null and new.cancelled_at is not null and new.instalment_id is null then
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
--    paid online), with its evidence; the guard keeps financial tasks with
--    their owner, and every other source naming its actor.
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
  -- The one exception: the super admin hands on a financial task whose
  -- assignee left with nobody live to follow (the sweep records it); the
  -- sweep moves it on to its owner once there is one again.
  if v_moved and old.kind = 'system' and not v_system
     and old.source_type in ('lesson_report', 'report_correction', 'case',
                             'instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed')
     and not (old.source_type in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed')
              and exists (select 1 from chat.staff s
                           where s.id = v_actor::uuid and s.organization_id = old.organization_id and s.role = 'super_admin'
                             and s.is_active and s.left_at is null)
              and chat.task_principal_kind(coalesce(old.assignee_staff_id, old.assignee_teacher_id), old.organization_id) is null) then
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
    -- A source names who did its work. Only money paid online is nobody's
    -- (PR-2b): every other source's completion without its actor fails, into
    -- the issue log, rather than closing silently as the system's.
    if new.state = 'completed' and v_system and v_actor is null
       and coalesce(old.source_type, '') not in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed') then
      raise exception 'a source''s completion names who did its work (chat.task_actor)' using errcode = 'check_violation';
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

create or replace function chat.record_work_task_event()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor  uuid := nullif(current_setting('chat.task_actor', true), '')::uuid;
  v_note   text := nullif(btrim(coalesce(current_setting('chat.task_note', true), '')), '');
  -- No actor: the system (a source creating or withdrawing). A source may name
  -- someone who has left since, so its kind is read whether live or not.
  v_kind   text := case when v_actor is null then 'system'
                        else coalesce(chat.task_principal_kind(v_actor, new.organization_id),
                                      chat.task_principal_any(v_actor, new.organization_id)) end;
  v_from   uuid;
  v_to     uuid := coalesce(new.assignee_staff_id, new.assignee_teacher_id);
  v_moved  boolean;
  -- PR-2b: what proved a source's work (chat.work_task_settle_with), only
  -- from the helpers.
  v_proof  jsonb := case when coalesce(current_setting('chat.task_system', true), '') = 'on'
                         then nullif(current_setting('chat.task_evidence', true), '')::jsonb end;
begin
  if tg_op = 'INSERT' then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, after)
    values (new.id, new.organization_id, 'created', v_kind, v_actor, v_to,
            jsonb_build_object('dueAt', new.due_at, 'priority', new.priority, 'category', new.category));
    return new;
  end if;

  v_from := coalesce(old.assignee_staff_id, old.assignee_teacher_id);
  v_moved := v_from is distinct from v_to;
  if v_moved then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, from_assignee, to_assignee, body)
    values (new.id, new.organization_id, 'reassigned', v_kind, v_actor, v_from, v_to, v_note);
  end if;
  if new.state is distinct from old.state then
    if new.state = 'awaiting_decision' then
      insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, body)
      values (new.id, new.organization_id, 'out_of_scope', v_kind, v_actor, v_to, v_note);
    elsif new.state = 'open' and not v_moved then
      insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, body)
      values (new.id, new.organization_id, 'returned', v_kind, v_actor, v_to, v_note);
    elsif new.state in ('completed', 'removed') then
      insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, body, after)
      values (new.id, new.organization_id, new.state, v_kind, v_actor, v_to, v_note,
              nullif(jsonb_strip_nulls(jsonb_build_object('outcome', new.outcome,
                                                          'evidence', case when new.state = 'completed' then v_proof end)), '{}'::jsonb));
    end if;
  end if;
  if new.source_state is distinct from old.source_state then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, before, after)
    values (new.id, new.organization_id,
            case when new.source_state = 'withdrawn' then 'source_withdrawn' else 'source_restored' end, 'system', null, v_to,
            jsonb_build_object('sourceState', old.source_state), jsonb_build_object('sourceState', new.source_state));
  end if;
  if new.source_floor is distinct from old.source_floor then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, before, after)
    values (new.id, new.organization_id, 'source_raised', 'system', null, v_to,
            jsonb_build_object('sourceFloor', old.source_floor), jsonb_build_object('sourceFloor', new.source_floor));
  end if;
  if new.priority is distinct from old.priority then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, before, after)
    values (new.id, new.organization_id, 'priority_changed', v_kind, v_actor, v_to,
            jsonb_build_object('priority', old.priority), jsonb_build_object('priority', new.priority));
  end if;
  if new.due_at is distinct from old.due_at then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, before, after)
    values (new.id, new.organization_id, 'due_changed', v_kind, v_actor, v_to,
            jsonb_build_object('dueAt', old.due_at), jsonb_build_object('dueAt', new.due_at));
  end if;
  return new;
end;
$$;


-- ===========================================================================
-- 6. Fail closed
-- ===========================================================================

alter table chat.work_task_package_episode enable row level security;
revoke all on chat.work_task_package_episode from public, anon, authenticated, chat_app;

revoke all on function chat.work_task_billing_owner(uuid, uuid) from public;
revoke all on function chat.work_task_sales_owner(uuid) from public;
revoke all on function chat.work_task_newest_package(uuid) from public;
revoke all on function chat.work_task_covering_payment(uuid, uuid) from public;
revoke all on function chat.work_task_episode_for(text, uuid) from public;
revoke all on function chat.work_task_package_verdict(text, uuid, text, text) from public;
revoke all on function chat.work_task_financial_done(text, uuid) from public;
revoke all on function chat.work_task_settle_with(uuid, text, uuid, jsonb) from public;
revoke all on function chat.work_task_settle_financial(uuid, text, uuid) from public;
revoke all on function chat.work_task_set_floor(uuid, text, text) from public;
revoke all on function chat.work_task_raise_instalment(uuid) from public;
revoke all on function chat.work_task_raise_package_low(uuid) from public;
revoke all on function chat.work_task_raise_renewal(uuid) from public;
revoke all on function chat.work_task_raise_receipt(uuid) from public;
revoke all on function chat.work_task_raise_checkout_failed(uuid) from public;
revoke all on function chat.work_task_financial_owner(text, uuid) from public;
revoke all on function chat.work_task_package_follow(uuid) from public;
revoke all on function chat.work_task_sweep_financial(integer) from public;
revoke all on function chat.work_task_from_instalment() from public;
revoke all on function chat.work_task_from_learner_access() from public;
revoke all on function chat.work_task_from_learner_subscription() from public;
revoke all on function chat.work_task_from_renewal_request() from public;
revoke all on function chat.work_task_from_receipt() from public;
revoke all on function chat.work_task_from_checkout() from public;
revoke all on function chat.work_task_from_payment_request() from public;
revoke all on function chat.guard_work_task() from public;
revoke all on function chat.record_work_task_event() from public;
