-- PD-45 (review of #294): a contact key gained only through a COUNTRY re-key is
-- superseded by the family's next country change.
--
-- Record: docs/product/pd045-parent-location-plan.md §9. PD-42 S1 keys every
-- family's parents (chat.family_contact_key) so one parent can never become two
-- families, and a key is never removed while its family exists. PD-45 adds
-- keys for a stored LOCAL number as the family's country reads it ("050 765
-- 3333" is +971... in the UAE, +20... in Egypt). If that country was a mistake,
-- the key would block a stranger's number forever; so such a key -- and only
-- such a key -- is replaced when the same family's country changes again.
--
--   source 'record'  a number or e-mail as recorded: intake, PD-16 Assign, the
--                    backfill CLI, a number changed on the Parent Profile.
--                    Every key before this migration. Never removed while the
--                    family exists (PD-42 S1, unchanged).
--   source 'rekey'   the reading of a recorded local number in the family's
--                    current country. Removed only inside that family's own
--                    country change: the API names the family in the
--                    transaction-local setting chat.rekeying_family. That is a
--                    routing aid, not a security boundary -- no request role can
--                    touch the table at all (20261028110000).

set local lock_timeout = '5s';

alter table chat.family_contact_key add column source text not null default 'record';
alter table chat.family_contact_key add constraint family_contact_key_source_check
  check (source in ('record', 'rekey'));
alter table chat.family_contact_key add constraint family_contact_key_rekey_is_a_phone
  check (source = 'record' or kind = 'phone');

comment on column chat.family_contact_key.source is
  'PD-45: record (a value as recorded; never removed while the family exists) or rekey (a recorded local number as the family''s current country reads it; replaced by that family''s next country change).';

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

do $assert$
begin
  if exists (select 1 from chat.family_contact_key where source <> 'record') then
    raise exception 'PD-45: an existing contact key is not a recorded one';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'family_contact_key_is_coherent') then
    raise exception 'PD-45: the contact-key guard is missing';
  end if;
end
$assert$;
