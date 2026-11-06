-- Store payments policy (App Store 3.1.3(d), Google Play 1:1 online services; R-4 of
-- docs/release/app-review-notes-payments.md).
--
-- The app takes a card or bank-transfer payment only for live one-to-one lessons. A
-- subscription or renewal request proves that itself (a child and the lessons it buys).
-- An instalment and a balance request did not: a free-text label and an optional child.
-- Each now names the lesson package it pays for, a chat.learner_subscription of the
-- same family (and of the same child, when it names one). The API refuses an in-app
-- payment for one that names none (COMM.PAYMENT_NOT_IN_APP); staff still collect it
-- outside the app. The link is written with the row and never changes.

set local lock_timeout = '5s';

alter table chat.family_instalment
  add column if not exists lesson_subscription_id uuid references chat.learner_subscription (id) on delete restrict;
comment on column chat.family_instalment.lesson_subscription_id is
  'Store payments policy: the lesson package this instalment pays for. Null: not verified as lessons, so not payable in the app. Set on insert only.';
create index if not exists family_instalment_lesson_package on chat.family_instalment (lesson_subscription_id)
  where lesson_subscription_id is not null;

alter table chat.payment_request
  add column if not exists lesson_subscription_id uuid references chat.learner_subscription (id) on delete restrict;
comment on column chat.payment_request.lesson_subscription_id is
  'Store payments policy: the lesson package a balance request is owed for. Balance requests only. Set on insert only.';
alter table chat.payment_request drop constraint if exists payment_request_lesson_package_is_a_balance;
alter table chat.payment_request add constraint payment_request_lesson_package_is_a_balance
  check (lesson_subscription_id is null or purpose = 'balance');

-- Backfill: a plan made with its lessons (PD-30) already has its package, by plan_ref
-- (the plan's id, or the single instalment's id). A voided instalment is final and is
-- left alone; it is never payable anyway.
update chat.family_instalment i
   set lesson_subscription_id = s.id
  from chat.learner_subscription s
 where i.lesson_subscription_id is null
   and i.voided_at is null
   and s.source = 'instalment_plan'
   and s.voided_at is null
   and s.plan_ref = coalesce(i.plan_id, i.id)
   and s.family_id = i.family_id
   and (i.learner_id is null or s.learner_id = i.learner_id);

create or replace function chat.pd027_instalment_lesson_package()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_sub chat.learner_subscription%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.lesson_subscription_id is distinct from old.lesson_subscription_id then
      raise exception 'an instalment''s lesson package never changes; void it and write a new one'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.lesson_subscription_id is not null then
    select * into v_sub from chat.learner_subscription where id = new.lesson_subscription_id;
    if v_sub.id is null or v_sub.family_id is distinct from new.family_id
       or (new.learner_id is not null and v_sub.learner_id is distinct from new.learner_id) then
      raise exception 'an instalment pays for a lesson package of its own family and child'
        using errcode = 'check_violation';
    end if;
    if v_sub.voided_at is not null then
      raise exception 'a voided lesson package takes no new instalments' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists family_instalment_lesson_package on chat.family_instalment;
create trigger family_instalment_lesson_package
  before insert or update on chat.family_instalment
  for each row execute function chat.pd027_instalment_lesson_package();

create or replace function chat.pd027_request_lesson_package()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_sub chat.learner_subscription%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.lesson_subscription_id is distinct from old.lesson_subscription_id then
      raise exception 'a payment request''s terms never change; cancel it and make another'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.lesson_subscription_id is not null then
    select * into v_sub from chat.learner_subscription where id = new.lesson_subscription_id;
    if v_sub.id is null or v_sub.family_id is distinct from new.family_id
       or (new.learner_id is not null and v_sub.learner_id is distinct from new.learner_id) then
      raise exception 'a balance is owed for a lesson package of its own family and child'
        using errcode = 'check_violation';
    end if;
    if v_sub.voided_at is not null then
      raise exception 'a voided lesson package takes no new balance' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payment_request_lesson_package on chat.payment_request;
create trigger payment_request_lesson_package
  before insert or update on chat.payment_request
  for each row execute function chat.pd027_request_lesson_package();

revoke all on function chat.pd027_instalment_lesson_package() from public;
revoke all on function chat.pd027_request_lesson_package() from public;
