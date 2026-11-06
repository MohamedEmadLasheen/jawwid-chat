-- Roll back 20261106130000_chat_pd030_lock_lesson_instalments: every overdue
-- instalment of the child (or of the family, naming no child) locks again, as in
-- 20261028110000. The stored chat.learner_access rows follow on the effects
-- worker's next pass.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261106130000_chat_pd030_lock_lesson_instalments.down.sql

set local lock_timeout = '5s';

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
  v_before   integer;
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

  select min(s.starts_on), sum(s.lessons_included)::integer, sum(s.lessons_used_before)::integer
    into v_from, v_included, v_before
    from chat.learner_subscription s
   where s.learner_id = p_learner and s.voided_at is null;

  if v_from is not null then
    balance := v_included - v_before - chat.learner_lessons_used(p_learner, v_from);
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


revoke all on function chat.compute_learner_access(uuid) from public;

delete from chat.schema_migrations where version = '20261106130000_chat_pd030_lock_lesson_instalments';
