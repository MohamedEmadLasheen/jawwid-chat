-- Roll back 20261102210000_chat_account_erasure (store compliance PR-A, account deletion).
--
-- Drops the two functions. An erasure already done is NOT undone (the data is
-- gone by design); its tasks stay and can be removed by their manager. Roll
-- back the API release with it: AccountDeletionService calls chat.erase_account
-- and TaskService.sweep calls chat.work_task_sweep_erasure.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102210000_account_erasure.down.sql

drop function if exists chat.work_task_sweep_erasure(integer);
drop function if exists chat.erase_account(uuid, text, text[]);

-- The contact-key guard as 20261030050000 left it (without the PD-56 erasure branch).
create or replace function chat.guard_family_contact_key()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_org uuid;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from chat.family f where f.id = old.family_id) then
      return old;
    end if;
    -- PD-45: a re-keyed reading goes only within its own family's country change.
    if old.source = 'rekey' and current_setting('chat.rekeying_family', true) = old.family_id::text then
      return old;
    end if;
    raise exception 'a contact key is never removed while its family exists' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'a contact key never changes' using errcode = 'check_violation';
  end if;
  select organization_id into v_org from chat.family where id = new.family_id;
  if v_org is null then
    raise exception 'a contact key is for a family' using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  -- Said in words before the primary key would (Prisma drops 23505's message).
  if exists (select 1 from chat.family_contact_key k where k.organization_id = v_org and k.key_hash = new.key_hash) then
    raise exception 'this parent is already in Chat' using errcode = 'check_violation';
  end if;
  if new.created_by is not null and not chat.staff_of(new.created_by, v_org) then
    raise exception 'a contact key is added by staff of the family''s organization' using errcode = 'insufficient_privilege';
  end if;
  new.created_at := now();
  return new;
end;
$$;
