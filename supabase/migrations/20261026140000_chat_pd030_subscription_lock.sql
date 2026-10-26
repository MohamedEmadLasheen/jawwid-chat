-- PD-30 (2026-10-26): subscriptions carry lessons; a child's group locks when
-- the lessons are used up (after two grace lessons) or an instalment is
-- overdue; three roles may grant a dated exception.
--
--   chat.learner_subscription   the child's lesson ledger: each subscription
--                               (plan months, lessons included, start day).
--                               Append-only; a row is voided, never edited.
--                               Written when a subscription / renewal request
--                               is paid in full (by the trigger below), when an
--                               instalment plan is created with lessons, and --
--                               free lessons, with a reason -- by the super
--                               admin, the Operations Manager or the Sales
--                               Manager ("Add subscription"; the guard checks).
--   chat.subscription_exception lets a child go on past the balance and / or an
--                               overdue instalment until a date (at most 90
--                               days). Append-only; revoked once.
--   chat.learner_access         the child's state now: open | grace | locked,
--                               why, and whether the lessons are on hold.
--   chat.learner_access_event   every change of that state, once. The API
--                               (SubscriptionEffects) posts the cards and the
--                               pushes for each event exactly once.
--   chat.renewal_request        a parent's "please renew" from a locked banner,
--                               at most one per child per academy day.
--
-- COUNTING. Used = the child's regular and make-up lessons whose outcome is
-- held or student_no_show, starting on or after the first standing
-- subscription's start day (academy time zone). Nothing else counts: an
-- apology is replaced by its make-up, which counts when held. Balance =
-- included - used; grace lessons are taken from the next subscription.
--
-- STATE. chat.refresh_learner_access(learner) computes it in the writer's own
-- transaction: every lesson outcome, ledger row, exception, instalment and
-- request change calls it from a trigger, so no writer can forget. The worker
-- sweep calls it for every child too (an instalment becomes overdue by the
-- calendar, not by a write).
--
-- ENFORCEMENT is the API's (canSend / calls / booking) and is switched by
-- SUBSCRIPTION_LOCK_ENFORCED. The database computes and records the state
-- whatever the switch says; chat.learner_lesson_lock(learner) is the one
-- answer every check asks (computed now, fail closed). chat.learner_access.held
-- -- set by the API only when enforcement is on -- stops the materializer.
-- WHO may grant exceptions and add free lessons is the database's to enforce
-- too (chat.can_grant_subscription_exception).
--
-- Down:
--   drop trigger lesson_refreshes_access on chat.lesson; (and the other
--   *_refreshes_access / payment_request_credits_lessons triggers)
--   drop table chat.renewal_request, chat.learner_access_event, chat.learner_access,
--     chat.subscription_exception, chat.learner_subscription;
--   alter table chat.payment_request drop column lessons_included;
--   alter table chat.lesson_report drop column lesson_total;
--   restore chat.learner_suspended_on from 20261018160000 and the three lesson
--   outcome constraints from 20261021120000;
--   delete from chat.notification_template where key like 'subscription_%';
--   delete from chat.config where key in ('subscription.overdue_from', 'subscription.enforced_since');

-- ===========================================================================
-- 1. Settings
-- ===========================================================================

create or replace function chat.pd030_zone()
returns text
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce((select value #>> '{}' from chat.config where key = 'schedule.timezone'), 'Africa/Cairo');
$$;

create or replace function chat.pd030_today()
returns date
language sql
stable
set search_path = chat, pg_temp
as $$
  select (now() at time zone chat.pd030_zone())::date;
$$;

-- Owner decision (2026-10-26, Q2): only instalments due on or after go-live
-- lock a group; older unpaid ones are listed for staff instead. Go-live is
-- the academy day enforcement (SUBSCRIPTION_LOCK_ENFORCED) was FIRST seen on:
-- the API records 'subscription.overdue_from' and 'subscription.enforced_since'
-- once, at that moment (SubscriptionEffects). Until then the setting is
-- absent and NO instalment locks: there is no silent default day.
create or replace function chat.pd030_overdue_from()
returns date
language sql
stable
set search_path = chat, pg_temp
as $$
  select (value #>> '{}')::date from chat.config where key = 'subscription.overdue_from';
$$;

create or replace function chat.pd030_grace_lessons()
returns integer
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce((select (value #>> '{}')::integer from chat.config where key = 'subscription.grace_lessons'), 2);
$$;

-- Owner (2026-10-26): only the super admin, the Operations Manager and the
-- Sales Manager let a child go on past the lock -- an exception, or a
-- subscription added by hand with no payment behind it. The database refuses
-- anyone else, whatever called it (the API's canGrantSubscriptionException
-- asks the same question first, to answer 403).
create or replace function chat.can_grant_subscription_exception(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select exists (
    select 1 from chat.staff s
     where s.id = p_staff and s.is_active and s.left_at is null
       and (s.role = 'super_admin'
            or (s.role = 'manager' and chat.operations_department_role(s.id) = 'manager')
            or chat.sales_department_role(s.id) = 'manager'));
$$;

-- ===========================================================================
-- 2. The lesson ledger
-- ===========================================================================

create table chat.learner_subscription (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references chat.organization (id),
  learner_id        uuid not null references chat.learner (id) on delete restrict,
  family_id         uuid not null references chat.family (id) on delete restrict,
  plan_months       smallint check (plan_months in (1, 3, 6, 12)),
  -- 1..1000, as PD-15's package size: the backfill copies those.
  lessons_included  integer not null check (lessons_included between 1 and 1000),
  starts_on         date not null,
  source            text not null check (source in ('payment_request', 'instalment_plan', 'staff', 'backfill')),
  -- No foreign key: a request is never deleted (chat.guard_payment_request),
  -- the guard below checks it on insert, and the money tables stay truncatable
  -- on their own in the test suites.
  request_id        uuid,
  -- The instalment plan's id (or the single instalment's id).
  plan_ref          uuid,
  note              text check (note is null or length(btrim(note)) between 1 and 500),
  -- null: the system (a paid request, the backfill).
  created_by        uuid references chat.staff (id),
  created_at        timestamptz not null default now(),
  voided_at         timestamptz,
  -- null: the system (the payment that paid its request was voided).
  voided_by         uuid references chat.staff (id),
  void_reason       text check (void_reason is null or length(btrim(void_reason)) between 1 and 500),
  constraint learner_subscription_request_source check ((source = 'payment_request') = (request_id is not null)),
  constraint learner_subscription_plan_source check ((source = 'instalment_plan') = (plan_ref is not null)),
  constraint learner_subscription_staff_named check (source not in ('staff', 'instalment_plan') or created_by is not null),
  constraint learner_subscription_void_is_whole check (
    (voided_at is null) = (void_reason is null) and (voided_at is not null or voided_by is null))
);

comment on table chat.learner_subscription is
  'PD-30: a child''s subscriptions and the lessons each includes. Append-only (chat.guard_learner_subscription): voided with a reason, never edited or deleted.';

create index learner_subscription_learner_idx on chat.learner_subscription (learner_id, starts_on, created_at);
-- A request credits its lessons once while it stands; a void frees it.
create unique index learner_subscription_one_per_request on chat.learner_subscription (request_id)
  where request_id is not null and voided_at is null;
create unique index learner_subscription_one_per_plan on chat.learner_subscription (plan_ref)
  where plan_ref is not null and voided_at is null;

create or replace function chat.guard_learner_subscription()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_learner chat.learner%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'a subscription is voided, never deleted' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    select * into v_learner from chat.learner where id = new.learner_id;
    if v_learner.id is null then
      raise exception 'a subscription is for a child' using errcode = 'foreign_key_violation';
    end if;
    new.organization_id := v_learner.organization_id;
    new.family_id := v_learner.family_id;
    if new.created_by is not null and not chat.staff_of(new.created_by, new.organization_id) then
      raise exception 'a subscription is added by staff of its organization' using errcode = 'insufficient_privilege';
    end if;
    -- A subscription with no payment behind it is free lessons: the three
    -- roles only, with a reason, starting from a week ago to a month ahead.
    if new.source = 'staff' then
      if not chat.can_grant_subscription_exception(new.created_by) then
        raise exception 'a subscription with no payment is added by the super admin, the Operations Manager or the Sales Manager'
          using errcode = 'insufficient_privilege';
      end if;
      if new.note is null then
        raise exception 'a subscription with no payment says why' using errcode = 'check_violation';
      end if;
      if new.starts_on < chat.pd030_today() - 7 or new.starts_on > chat.pd030_today() + 30 then
        raise exception 'a subscription added by hand starts from a week ago to a month ahead' using errcode = 'check_violation';
      end if;
    end if;
    if new.request_id is not null and not exists (
      select 1 from chat.payment_request r
       where r.id = new.request_id and r.family_id = new.family_id and r.learner_id = new.learner_id) then
      raise exception 'a request credits the child it was made for' using errcode = 'check_violation';
    end if;
    if new.voided_at is not null then
      raise exception 'a subscription is added standing' using errcode = 'check_violation';
    end if;
    new.created_at := now();
    return new;
  end if;

  if (new.id, new.organization_id, new.learner_id, new.family_id, new.plan_months, new.lessons_included,
      new.starts_on, new.source, new.request_id, new.plan_ref, new.note, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.learner_id, old.family_id, old.plan_months, old.lessons_included,
      old.starts_on, old.source, old.request_id, old.plan_ref, old.note, old.created_by, old.created_at) then
    raise exception 'a subscription never changes; void it and add another' using errcode = 'check_violation';
  end if;
  if old.voided_at is not null then
    raise exception 'a voided subscription is final' using errcode = 'check_violation';
  end if;
  if new.voided_by is not null and not chat.staff_of(new.voided_by, new.organization_id) then
    raise exception 'a subscription is voided by staff of its organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger learner_subscription_guard
  before insert or update or delete on chat.learner_subscription
  for each row execute function chat.guard_learner_subscription();

-- A subscription / renewal request carries the lessons it buys.
alter table chat.payment_request add column lessons_included integer
  check (lessons_included is null or lessons_included between 1 and 1000);
alter table chat.payment_request add constraint payment_request_lessons_are_a_subscriptions
  check (lessons_included is null or purpose in ('subscription', 'renewal'));

create or replace function chat.pd030_request_lessons_fixed()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if new.lessons_included is distinct from old.lessons_included then
    raise exception 'a payment request''s terms never change; cancel it and make another'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger payment_request_lessons_fixed
  before update on chat.payment_request
  for each row execute function chat.pd030_request_lessons_fixed();

-- The report keeps the M of "Lesson N of M" it was written with.
alter table chat.lesson_report add column lesson_total integer
  check (lesson_total is null or lesson_total between 1 and 9999);

-- ===========================================================================
-- 3. Exceptions
-- ===========================================================================

create table chat.subscription_exception (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  learner_id       uuid not null references chat.learner (id) on delete restrict,
  family_id        uuid not null references chat.family (id) on delete restrict,
  kind             text not null check (kind in ('balance', 'overdue', 'both')),
  reason           text not null check (length(btrim(reason)) between 1 and 500),
  valid_until      date not null,
  granted_by       uuid not null references chat.staff (id),
  granted_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  revoked_by       uuid references chat.staff (id),
  revoke_reason    text check (revoke_reason is null or length(btrim(revoke_reason)) between 1 and 500),
  constraint subscription_exception_revoke_is_whole check (
    (revoked_at is null) = (revoked_by is null) and (revoked_at is null) = (revoke_reason is null))
);

comment on table chat.subscription_exception is
  'PD-30: a child may go on past the balance and / or an overdue instalment until valid_until (at most 90 days). Granted and revoked only by the super admin, the Operations Manager and the Sales Manager (the API decides; the audit log records). Append-only.';

create index subscription_exception_learner_idx on chat.subscription_exception (learner_id, granted_at desc);

create or replace function chat.guard_subscription_exception()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_learner chat.learner%rowtype;
  v_today date := chat.pd030_today();
begin
  if tg_op = 'DELETE' then
    raise exception 'an exception is revoked, never deleted' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    select * into v_learner from chat.learner where id = new.learner_id;
    if v_learner.id is null then
      raise exception 'an exception is for a child' using errcode = 'foreign_key_violation';
    end if;
    new.organization_id := v_learner.organization_id;
    new.family_id := v_learner.family_id;
    if not chat.staff_of(new.granted_by, new.organization_id)
       or not chat.can_grant_subscription_exception(new.granted_by) then
      raise exception 'an exception is granted by the super admin, the Operations Manager or the Sales Manager'
        using errcode = 'insufficient_privilege';
    end if;
    if new.valid_until < v_today or new.valid_until > v_today + 90 then
      raise exception 'an exception lasts until a day from today to 90 days ahead' using errcode = 'check_violation';
    end if;
    if new.revoked_at is not null then
      raise exception 'an exception is granted standing' using errcode = 'check_violation';
    end if;
    new.granted_at := now();
    return new;
  end if;

  if (new.id, new.organization_id, new.learner_id, new.family_id, new.kind, new.reason, new.valid_until,
      new.granted_by, new.granted_at)
     is distinct from
     (old.id, old.organization_id, old.learner_id, old.family_id, old.kind, old.reason, old.valid_until,
      old.granted_by, old.granted_at) then
    raise exception 'an exception never changes; revoke it and grant another' using errcode = 'check_violation';
  end if;
  if old.revoked_at is not null then
    raise exception 'a revoked exception is final' using errcode = 'check_violation';
  end if;
  if new.revoked_by is not null
     and (not chat.staff_of(new.revoked_by, new.organization_id)
          or not chat.can_grant_subscription_exception(new.revoked_by)) then
    raise exception 'an exception is revoked by the super admin, the Operations Manager or the Sales Manager'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger subscription_exception_guard
  before insert or update or delete on chat.subscription_exception
  for each row execute function chat.guard_subscription_exception();

-- ===========================================================================
-- 4. A child's state, and its history
-- ===========================================================================

create table chat.learner_access (
  learner_id             uuid primary key references chat.learner (id) on delete cascade,
  organization_id        uuid not null references chat.organization (id),
  family_id              uuid not null references chat.family (id) on delete cascade,
  state                  text not null default 'open' check (state in ('open', 'grace', 'locked')),
  -- Why it is locked: 'balance' and / or 'overdue'.
  reasons                text[] not null default '{}',
  -- Reasons an exception is holding off.
  excepted               text[] not null default '{}',
  -- Null: no subscription (no balance to run out).
  balance                integer,
  grace_left             integer,
  -- Derived each time; no foreign key (the instalment is never deleted).
  overdue_instalment_id  uuid,
  overdue_due_on         date,
  -- Set by the API when enforcement is on and the lessons are suspended; the
  -- materializer creates nothing for a held child.
  held                   boolean not null default false,
  changed_at             timestamptz not null default now(),
  computed_at            timestamptz not null default now(),
  constraint learner_access_reasons check (reasons <@ array['balance', 'overdue']::text[]),
  constraint learner_access_excepted check (excepted <@ array['balance', 'overdue']::text[]),
  constraint learner_access_locked_has_a_reason check ((state = 'locked') = (cardinality(reasons) > 0))
);

comment on table chat.learner_access is
  'PD-30: a child''s subscription state now (computed by chat.refresh_learner_access). held = lessons suspended for payment (the API sets it when enforcement is on).';

create index learner_access_family_idx on chat.learner_access (family_id);

create table chat.learner_access_event (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references chat.organization (id),
  learner_id             uuid not null references chat.learner (id) on delete cascade,
  family_id              uuid not null references chat.family (id) on delete cascade,
  from_state             text not null,
  to_state               text not null,
  reasons                text[] not null,
  grace_left             integer,
  overdue_instalment_id  uuid,
  overdue_due_on         date,
  at                     timestamptz not null default clock_timestamp(),
  -- Set once the API has posted its cards and pushes (or decided none are due).
  applied_at             timestamptz
);

comment on table chat.learner_access_event is
  'PD-30: every change of a child''s subscription state, in order. applied_at: the cards and pushes went out (exactly once).';

create index learner_access_event_pending_idx on chat.learner_access_event (at) where applied_at is null;
create index learner_access_event_learner_idx on chat.learner_access_event (learner_id, at desc);

-- ===========================================================================
-- 5. Counting and computing
-- ===========================================================================

create or replace function chat.learner_lessons_used(p_learner uuid, p_from date)
returns integer
language sql
stable
set search_path = chat, pg_temp
as $$
  select count(*)::integer from chat.lesson l
   where l.learner_id = p_learner
     and l.kind in ('regular', 'makeup')
     and l.outcome in ('held', 'student_no_show')
     and (l.starts_at at time zone chat.pd030_zone())::date >= p_from;
$$;

create or replace function chat.compute_learner_access(
  p_learner uuid,
  out state text,
  out reasons text[],
  out excepted text[],
  out balance integer,
  out grace_left integer,
  out overdue_instalment_id uuid,
  out overdue_due_on date)
language plpgsql
stable
security definer
set search_path = chat, pg_temp
as $$
declare
  v_today    date := chat.pd030_today();
  v_grace    integer := chat.pd030_grace_lessons();
  v_family   uuid;
  v_from     date;
  v_included integer;
  v_exc_bal  boolean;
  v_exc_due  boolean;
  v_in_grace boolean := false;
begin
  reasons := '{}';
  excepted := '{}';
  select l.family_id into v_family from chat.learner l where l.id = p_learner;

  select bool_or(e.kind in ('balance', 'both')), bool_or(e.kind in ('overdue', 'both'))
    into v_exc_bal, v_exc_due
    from chat.subscription_exception e
   where e.learner_id = p_learner and e.revoked_at is null and e.valid_until >= v_today;

  select min(s.starts_on), sum(s.lessons_included)::integer into v_from, v_included
    from chat.learner_subscription s
   where s.learner_id = p_learner and s.voided_at is null;

  if v_from is not null then
    balance := v_included - chat.learner_lessons_used(p_learner, v_from);
    if balance <= 0 then
      grace_left := greatest(v_grace + balance, 0);
      if grace_left > 0 then
        v_in_grace := true;
      elsif coalesce(v_exc_bal, false) then
        excepted := excepted || 'balance'::text;
      else
        reasons := reasons || 'balance'::text;
      end if;
    end if;
  end if;

  select i.id, i.due_date into overdue_instalment_id, overdue_due_on
    from chat.family_instalment i
   where i.family_id = v_family
     and (i.learner_id is null or i.learner_id = p_learner)
     and i.voided_at is null and i.paid_on is null
     and i.due_date < v_today
     and chat.pd030_overdue_from() is not null
     and i.due_date >= chat.pd030_overdue_from()
   order by i.due_date, i.created_at
   limit 1;
  if overdue_instalment_id is not null then
    if coalesce(v_exc_due, false) then
      excepted := excepted || 'overdue'::text;
      overdue_instalment_id := null;
      overdue_due_on := null;
    else
      reasons := reasons || 'overdue'::text;
    end if;
  end if;

  state := case when cardinality(reasons) > 0 then 'locked' when v_in_grace then 'grace' else 'open' end;
end;
$$;

-- Recompute one child's state; record a change as an event. Serialized per
-- child by the row lock, so the sweep and a payment arriving together leave
-- exactly the state the last of them computed, and one event per change.
create or replace function chat.refresh_learner_access(p_learner uuid)
returns text
language plpgsql
volatile
security definer
set search_path = chat, pg_temp
as $$
declare
  v_learner chat.learner%rowtype;
  cur       chat.learner_access%rowtype;
  c         record;
  v_changed boolean;
begin
  select * into v_learner from chat.learner where id = p_learner;
  if v_learner.id is null then
    return null;
  end if;
  insert into chat.learner_access (learner_id, organization_id, family_id)
  values (p_learner, v_learner.organization_id, v_learner.family_id)
  on conflict (learner_id) do nothing;
  select * into cur from chat.learner_access where learner_id = p_learner for update;
  select * into c from chat.compute_learner_access(p_learner);

  v_changed := cur.state is distinct from c.state
            or cur.reasons is distinct from c.reasons
            or (c.state = 'grace' and cur.grace_left is distinct from c.grace_left);

  -- Written only when something differs, so the minute's sweep over every
  -- child is reads, not a write per row.
  if v_changed
     or (cur.organization_id, cur.family_id, cur.excepted, cur.balance, cur.grace_left,
         cur.overdue_instalment_id, cur.overdue_due_on)
        is distinct from
        (v_learner.organization_id, v_learner.family_id, c.excepted, c.balance, c.grace_left,
         c.overdue_instalment_id, c.overdue_due_on) then
    update chat.learner_access
       set organization_id = v_learner.organization_id,
           family_id = v_learner.family_id,
           state = c.state,
           reasons = c.reasons,
           excepted = c.excepted,
           balance = c.balance,
           grace_left = c.grace_left,
           overdue_instalment_id = c.overdue_instalment_id,
           overdue_due_on = c.overdue_due_on,
           changed_at = case when v_changed then now() else cur.changed_at end,
           computed_at = now()
     where learner_id = p_learner;
  end if;

  if v_changed then
    insert into chat.learner_access_event
      (organization_id, learner_id, family_id, from_state, to_state, reasons, grace_left,
       overdue_instalment_id, overdue_due_on)
    values
      (v_learner.organization_id, p_learner, v_learner.family_id, cur.state, c.state, c.reasons,
       c.grace_left, c.overdue_instalment_id, c.overdue_due_on);
  end if;
  return c.state;
end;
$$;

-- Every child of a family (or one child), in id order so two writers never
-- lock two children in opposite orders.
create or replace function chat.refresh_family_access(p_family uuid, p_learner uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = chat, pg_temp
as $$
declare
  r record;
begin
  for r in select l.id from chat.learner l
            where l.family_id = p_family and (p_learner is null or l.id = p_learner)
            order by l.id loop
    perform chat.refresh_learner_access(r.id);
  end loop;
end;
$$;

-- THE ONE QUESTION other features ask (PD-31's moves and bookings, and this
-- PD's own enforcement): is this child's lesson-taking locked for payment, and
-- why? NULL = open (grace included); 'balance' or 'overdue' when locked --
-- 'overdue' wins when both apply. An active exception covering a reason has
-- already removed it (chat.compute_learner_access). The STATE, whatever
-- SUBSCRIPTION_LOCK_ENFORCED says; callers in the API apply the switch.
--
-- Computed NOW from the inputs (chat.compute_learner_access): an instalment
-- that fell overdue at midnight, or an exception that ran out, counts at
-- once, whether or not the worker has swept -- a stale or missing
-- chat.learner_access row never opens a group the inputs lock.
create or replace function chat.learner_lesson_lock(p_learner uuid)
returns text
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select case
           when c.state <> 'locked' then null
           when 'overdue' = any(c.reasons) then 'overdue'
           else 'balance'
         end
    from chat.compute_learner_access(p_learner) c
   where exists (select 1 from chat.learner l where l.id = p_learner);
$$;

revoke all on function chat.learner_lesson_lock(uuid) from public;
grant execute on function chat.learner_lesson_lock(uuid) to chat_app;

-- ===========================================================================
-- 6. Every writer refreshes the state, in its own transaction
-- ===========================================================================

create or replace function chat.pd030_lesson_refreshes_access()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
begin
  if new.learner_id is not null and new.kind <> 'trial' and new.outcome is distinct from old.outcome then
    perform chat.refresh_learner_access(new.learner_id);
  end if;
  return null;
end;
$$;

create trigger lesson_refreshes_access
  after update of outcome on chat.lesson
  for each row execute function chat.pd030_lesson_refreshes_access();

-- ONE LOCK ORDER: a child's chat.learner_access row, then its lesson rows.
-- The hold (SubscriptionEffects) locks the access row and then suspends
-- lessons; an outcome written on a lesson takes the access row here, in a
-- BEFORE trigger -- before the lesson's own row lock -- so the two can never
-- wait on each other in opposite orders.
create or replace function chat.pd030_lesson_locks_access_first()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
begin
  if new.learner_id is not null and new.kind <> 'trial' and new.outcome is distinct from old.outcome then
    insert into chat.learner_access (learner_id, organization_id, family_id)
    select l.id, l.organization_id, l.family_id from chat.learner l where l.id = new.learner_id
    on conflict (learner_id) do nothing;
    perform 1 from chat.learner_access where learner_id = new.learner_id for update;
  end if;
  return new;
end;
$$;

create trigger lesson_locks_access_first
  before update of outcome on chat.lesson
  for each row execute function chat.pd030_lesson_locks_access_first();

create or replace function chat.pd030_child_row_refreshes_access()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
begin
  perform chat.refresh_learner_access(new.learner_id);
  return null;
end;
$$;

create trigger learner_subscription_refreshes_access
  after insert or update on chat.learner_subscription
  for each row execute function chat.pd030_child_row_refreshes_access();

create trigger subscription_exception_refreshes_access
  after insert or update on chat.subscription_exception
  for each row execute function chat.pd030_child_row_refreshes_access();

create or replace function chat.pd030_instalment_refreshes_access()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
begin
  perform chat.refresh_family_access(new.family_id, new.learner_id);
  return null;
end;
$$;

create trigger family_instalment_refreshes_access
  after insert or update on chat.family_instalment
  for each row execute function chat.pd030_instalment_refreshes_access();

-- Owner decision (Q3): a link-paid subscription credits its lessons when it is
-- paid in full; a void that leaves it short takes them back. A request paid
-- before Assign credits the child once Assign attaches it (learner_id set).
create or replace function chat.pd030_request_credits_lessons()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
begin
  if new.lessons_included is null or new.learner_id is null or new.family_id is null then
    return null;
  end if;
  -- Only on the TRANSITION to paid in full -- or, for a request paid before
  -- Assign, when Assign names its child. Any later update of a paid request
  -- (a reminder stamp, a webhook retry) credits nothing: a voided credit
  -- stays voided until a new payment pays the request again.
  if new.paid_at is not null and new.cancelled_at is null
     and (tg_op = 'INSERT'
          or old.paid_at is null
          or (old.learner_id is null or old.family_id is null)) then
    insert into chat.learner_subscription
      (learner_id, organization_id, family_id, plan_months, lessons_included, starts_on, source, request_id)
    values
      (new.learner_id, new.organization_id, new.family_id, new.plan_months, new.lessons_included,
       coalesce(new.period_start, chat.pd030_today()), 'payment_request', new.id)
    on conflict (request_id) where request_id is not null and voided_at is null do nothing;
  elsif tg_op = 'UPDATE' and old.paid_at is not null and new.paid_at is null then
    update chat.learner_subscription
       set voided_at = now(), void_reason = 'the payment for it was voided'
     where request_id = new.id and voided_at is null;
  end if;
  return null;
end;
$$;

create trigger payment_request_credits_lessons
  after insert or update on chat.payment_request
  for each row execute function chat.pd030_request_credits_lessons();

-- ===========================================================================
-- 7. Lessons on hold
-- ===========================================================================
-- A lock suspends the child's lessons that have not started, as PD-11's
-- pause does -- recorded by the system (no staff member did it). Its
-- outcome_note names why ('subscription'). The system becomes a plausible
-- recorder of `suspended` only.

alter table chat.lesson drop constraint lesson_outcome_by_kind_check;
alter table chat.lesson add constraint lesson_outcome_by_kind_check
  check (outcome_by_kind in ('staff', 'teacher', 'contact', 'system'));

alter table chat.lesson drop constraint lesson_outcome_is_whole;
alter table chat.lesson add constraint lesson_outcome_is_whole check (
  (outcome is null) = (outcome_at is null)
  and (outcome is null) = (outcome_by_kind is null)
  and (outcome_by is null) = (outcome is null or outcome_by_kind = 'system'));

-- Rebuilt on top of PD-31's version (20261026110000: a family or a teacher
-- writes its own `rescheduled`); this migration sorts after it on purpose.
alter table chat.lesson drop constraint lesson_outcome_recorded_by_a_plausible_actor;
alter table chat.lesson add constraint lesson_outcome_recorded_by_a_plausible_actor
  check (outcome is null
      or (outcome in ('held', 'student_no_show') and outcome_by_kind in ('teacher', 'staff'))
      or (outcome = 'student_apology' and outcome_by_kind in ('contact', 'staff'))
      or (outcome = 'teacher_apology' and outcome_by_kind in ('teacher', 'staff'))
      or (outcome = 'rescheduled' and outcome_by_kind in ('contact', 'teacher', 'staff'))
      or (outcome in ('admin_cancelled', 'teacher_no_show', 'suspended', 'voided')
          and outcome_by_kind = 'staff')
      or (outcome = 'suspended' and outcome_by_kind = 'system' and outcome_note = 'subscription'));

create or replace function chat.learner_on_payment_hold(p_learner uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select exists (select 1 from chat.learner_access a where a.learner_id = p_learner and a.held);
$$;

-- The materializer's one question about a learner's day (PD-11) now also
-- asks PD-30: a child whose lessons are on hold for payment gets none.
create or replace function chat.learner_suspended_on(p_learner uuid, p_day date)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.learner_suspension s
     where s.learner_id = p_learner and s.status = 'active'
       and p_day >= s.starts_on
       and (s.return_on is null or p_day < s.return_on))
    or chat.learner_on_payment_hold(p_learner);
$$;

-- ===========================================================================
-- 8. A parent asks to renew
-- ===========================================================================

create table chat.renewal_request (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  learner_id       uuid not null references chat.learner (id) on delete restrict,
  family_id        uuid not null references chat.family (id) on delete restrict,
  requested_by     uuid not null references chat.contact (id),
  requested_on     date not null,
  requested_at     timestamptz not null default now(),
  constraint renewal_request_once_a_day unique (learner_id, requested_on)
);

comment on table chat.renewal_request is
  'PD-30: a parent asked to renew a child''s subscription from the locked banner. At most one per child per academy day.';

create index renewal_request_org_idx on chat.renewal_request (organization_id, requested_at desc);

create or replace function chat.guard_renewal_request()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_learner chat.learner%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'a renewal request is never changed or deleted' using errcode = 'insufficient_privilege';
  end if;
  select * into v_learner from chat.learner where id = new.learner_id;
  new.organization_id := v_learner.organization_id;
  new.family_id := v_learner.family_id;
  if not exists (select 1 from chat.contact c where c.id = new.requested_by and c.family_id = v_learner.family_id and c.is_active) then
    raise exception 'a parent asks to renew for their own child' using errcode = 'insufficient_privilege';
  end if;
  new.requested_on := chat.pd030_today();
  new.requested_at := now();
  return new;
end;
$$;

create trigger renewal_request_guard
  before insert or update or delete on chat.renewal_request
  for each row execute function chat.guard_renewal_request();

-- ===========================================================================
-- 9. What the parents are told
-- ===========================================================================

insert into chat.notification_template (key, locale, title, body) values
  ('subscription_grace', 'ar', 'جَوِّد',
   'انتهت حصص اشتراك {learner}. يتبقى {grace_left} من حصص السماح حتى التجديد.'),
  ('subscription_grace', 'en', 'Jawwid',
   '{learner}''s subscription lessons are used up. {grace_left} grace lesson(s) left until renewal.'),
  ('subscription_locked', 'ar', 'جَوِّد',
   'توقفت حصص {learner}: {reason}. جدّدوا الاشتراك من الاشتراكات.'),
  ('subscription_locked', 'en', 'Jawwid',
   '{learner}''s lessons are paused: {reason}. Renew in Subscriptions.'),
  ('subscription_unlocked', 'ar', 'جَوِّد',
   'عادت حصص {learner}. شكرًا لكم.'),
  ('subscription_unlocked', 'en', 'Jawwid',
   '{learner}''s lessons are back on. Thank you.'),
  ('subscription_renewal_requested', 'ar', 'جَوِّد',
   'طلب ولي الأمر تجديد اشتراك {learner}.'),
  ('subscription_renewal_requested', 'en', 'Jawwid',
   'A parent asked to renew {learner}''s subscription.')
on conflict (key, locale, version) do nothing;

-- The cards SubscriptionEffects posts (PD-4: the direct chat for what is
-- financial, the group only for "paused" / "back on").
insert into chat.message_card_kind (kind) values
  ('subscription_grace'), ('subscription_locked'), ('lessons_paused'),
  ('subscription_unlocked'), ('subscription_renewal_requested')
on conflict do nothing;

-- ===========================================================================
-- 10. Backfill: PD-15's package size becomes each child's first subscription
-- ===========================================================================
-- Starting today, so nothing already taught is counted and no group locks on
-- deploy. The triggers above create each child's state row.

insert into chat.learner_subscription (learner_id, organization_id, family_id, plan_months, lessons_included, starts_on, source, note)
select e.learner_id, l.organization_id, l.family_id, f.subscription_plan_months, e.package_lessons,
       chat.pd030_today(), 'backfill', 'PD-15 package size, carried over at go-live'
  from chat.learner_enrollment e
  join chat.learner l on l.id = e.learner_id
  join chat.family f on f.id = l.family_id
 where e.package_lessons is not null;

select chat.refresh_learner_access(l.id) from chat.learner l;

-- ===========================================================================
-- 11. Fail closed
-- ===========================================================================

alter table chat.learner_subscription enable row level security;
alter table chat.subscription_exception enable row level security;
alter table chat.learner_access enable row level security;
alter table chat.learner_access_event enable row level security;
alter table chat.renewal_request enable row level security;
revoke all on chat.learner_subscription, chat.subscription_exception, chat.learner_access,
  chat.learner_access_event, chat.renewal_request
  from public, anon, authenticated, chat_app;

revoke all on function chat.compute_learner_access(uuid) from public;
revoke all on function chat.refresh_learner_access(uuid) from public;
revoke all on function chat.refresh_family_access(uuid, uuid) from public;
revoke all on function chat.learner_on_payment_hold(uuid) from public;
revoke all on function chat.pd030_lesson_refreshes_access() from public;
revoke all on function chat.pd030_lesson_locks_access_first() from public;
revoke all on function chat.can_grant_subscription_exception(uuid) from public;
revoke all on function chat.pd030_child_row_refreshes_access() from public;
revoke all on function chat.pd030_instalment_refreshes_access() from public;
revoke all on function chat.pd030_request_credits_lessons() from public;
revoke all on function chat.guard_learner_subscription() from public;
revoke all on function chat.guard_subscription_exception() from public;
revoke all on function chat.guard_renewal_request() from public;
revoke all on function chat.pd030_request_lessons_fixed() from public;
