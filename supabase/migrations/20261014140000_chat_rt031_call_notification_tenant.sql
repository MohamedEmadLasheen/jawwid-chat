-- Jawwid Chat -- RT-031: calls and notifications stay inside one organization.
--
-- THE DEFECT. chat.call and chat.notification were created without an
-- organization_id, so every row took the column default (organization A),
-- whatever tenant its conversation and recipient belonged to; and no guard
-- covered either table or chat.call_participant, so a call or notification row
-- could point across a tenant boundary and be routed on.
--
-- THE API FIX (same change): CallService.start files a call under its
-- conversation's organization; NotificationService.schedule files a
-- notification under the recipient's organization and refuses one whose
-- conversation is in another; the outbox worker delivers call events and call
-- pushes only to participants in the call's organization.
--
-- THIS FILE is the database half -- the backstop that holds with the API
-- bypassed. Additive only: four triggers and one function. No row is read,
-- moved, rewritten or deleted.
--
-- EXISTING ROWS. The guards fire on INSERT and on an UPDATE that changes a
-- tenant-bearing column (organization_id / conversation_id / actor) -- never on
-- the lifecycle updates calls and notifications receive (status, answered_at,
-- ended_at, sent_at, attempts). So a historical row filed under the default
-- organization before this fix can still be ended, sent or failed; it cannot be
-- re-pointed. On the single-tenant deployments that exist today every row is in
-- the default organization already and the guards change nothing observable.
--
-- REVERSIBLE: drop the four triggers and chat.enforce_actor_same_organization()
-- (db/rollback/20261014140000_rt031.down.sql; procedure in docs/db/rollback-20261014.md). No data is involved either way.

-- PRECONDITION: the organization columns and the shared guard this file builds on
-- (20260906120000_chat_organization). Refuse rather than half-guard.
do $pre$
begin
  if to_regprocedure('chat.enforce_same_organization()') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'chat' and table_name = 'call' and column_name = 'organization_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'chat' and table_name = 'notification' and column_name = 'organization_id') then
    raise exception 'RT-031 precondition failed: chat organization columns / chat.enforce_same_organization() missing';
  end if;
end
$pre$;

-- A call is in its conversation's organization.
drop trigger if exists call_same_organization on chat.call;
create trigger call_same_organization
  before insert or update of organization_id, conversation_id on chat.call
  for each row execute function chat.enforce_same_organization('conversation', 'conversation_id');

-- A notification about a conversation is in that conversation's organization.
drop trigger if exists notification_same_organization on chat.notification;
create trigger notification_same_organization
  before insert or update of organization_id, conversation_id on chat.notification
  for each row execute function chat.enforce_same_organization('conversation', 'conversation_id');

-- Actor columns are polymorphic (a contact, a staff member or a teacher), so
-- chat.enforce_same_organization's single parent table cannot express them.
-- TG_ARGV[0]: the column naming the actor. TG_ARGV[1]: how to find the row's
-- own organization -- 'self' (the row has organization_id) or a parent
-- '<table>.<fk column>' to read it from.
create or replace function chat.enforce_actor_same_organization()
returns trigger
language plpgsql
as $$
declare
  v_actor_col text := TG_ARGV[0];
  v_org_from  text := TG_ARGV[1];
  v_actor     uuid;
  v_row_org   uuid;
  v_actor_org uuid;
  v_parent_id uuid;
begin
  execute format('select ($1).%I', v_actor_col) into v_actor using new;
  if v_actor is null then
    return new;
  end if;

  if v_org_from = 'self' then
    execute 'select ($1).organization_id' into v_row_org using new;
  else
    execute format('select ($1).%I', split_part(v_org_from, '.', 2)) into v_parent_id using new;
    execute format('select organization_id from chat.%I where id = $1', split_part(v_org_from, '.', 1))
       into v_row_org using v_parent_id;
  end if;

  select organization_id into v_actor_org from (
    select organization_id from chat.contact where id = v_actor
    union all select organization_id from chat.staff where id = v_actor
    union all select organization_id from chat.teacher where id = v_actor
  ) a limit 1;

  -- An actor that resolves nowhere, or resolves to another organization, is
  -- refused. (SYSTEM never appears in these columns.)
  if v_actor_org is null or v_row_org is null or v_actor_org <> v_row_org then
    raise exception
      'cross-organization reference: chat.%.% names actor % of organization %, row belongs to %',
      TG_TABLE_NAME, v_actor_col, v_actor, coalesce(v_actor_org::text, '<unknown>'), coalesce(v_row_org::text, '<unknown>')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function chat.enforce_actor_same_organization() is
  'RT-031: a polymorphic actor reference (contact | staff | teacher) must resolve '
  'to an actor of the same organization as the row (or its parent). Unknown '
  'actors are refused.';

-- A call participant is an actor of the call's organization.
drop trigger if exists call_participant_same_organization on chat.call_participant;
create trigger call_participant_same_organization
  before insert or update of actor_id, call_id on chat.call_participant
  for each row execute function chat.enforce_actor_same_organization('actor_id', 'call.call_id');

-- A notification's recipient is an actor of the notification's organization.
drop trigger if exists notification_recipient_same_organization on chat.notification;
create trigger notification_recipient_same_organization
  before insert or update of recipient_id, organization_id on chat.notification
  for each row execute function chat.enforce_actor_same_organization('recipient_id', 'self');
