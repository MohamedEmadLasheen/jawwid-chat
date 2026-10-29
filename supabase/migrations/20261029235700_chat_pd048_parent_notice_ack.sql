-- =============================================================================
-- PD-48 · the parent's acknowledgement of a notice (the lesson-audio notice)
--
-- The owner approved the parent notice on 2026-10-29
-- (docs/product/pd048-lesson-voice-over-design.md §17 Q7): families already
-- enrolled acknowledge it ONCE, at their next sign-in; a parent who signs up
-- acknowledges it at sign-up and is never asked again.
--
--   chat.parent_notice_ack   one row per (parent contact, notice, version).
--                            Written only by chat.acknowledge_parent_notice,
--                            idempotently (a second acknowledgement adds nothing).
--                            Never updated; removed only with its contact.
--
-- Bumping a notice's version (apps/api/src/lesson-audio/parent-notices.ts) is
-- the ONLY way to ask everyone again. A parent reads only their own rows (RLS);
-- no request role writes, updates or deletes.
-- =============================================================================

create table chat.parent_notice_ack (
  contact_id       uuid not null references chat.contact (id) on delete cascade,
  notice_key       text not null check (notice_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  notice_version   integer not null check (notice_version between 1 and 1000),
  acknowledged_at  timestamptz not null default now(),
  primary key (contact_id, notice_key, notice_version)
);

comment on table chat.parent_notice_ack is
  'PD-48: a parent acknowledged a notice (lesson_audio: the computer-voice pronunciation notice), at sign-up or once at a later sign-in. Written only by chat.acknowledge_parent_notice; never updated; removed only with its contact.';

create function chat.guard_parent_notice_ack()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'an acknowledgement is a record; it is never changed' using errcode = 'check_violation';
  end if;
  -- A DELETE is the contact's own removal cascading (depth 2: the foreign key's
  -- action, then this trigger), never a statement aimed at the table itself.
  if tg_op = 'DELETE' and pg_trigger_depth() < 2 then
    raise exception 'an acknowledgement is removed only with its contact' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.acknowledged_at := now();
    return new;
  end if;
  return old;
end;
$$;

create function chat.guard_parent_notice_ack_truncate()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if coalesce(current_setting('chat.test_truncate', true), '') = 'on' then
    return null;
  end if;
  raise exception 'acknowledgements are never truncated' using errcode = 'check_violation';
end;
$$;

create trigger parent_notice_ack_is_a_record before insert or update or delete on chat.parent_notice_ack
  for each row execute function chat.guard_parent_notice_ack();
create trigger parent_notice_ack_no_truncate before truncate on chat.parent_notice_ack
  for each statement execute function chat.guard_parent_notice_ack_truncate();

-- The ONE write. The API passes the AUTHENTICATED contact (the token's actor),
-- never an id from a request body; no request role may execute it. Idempotent:
-- true when this call recorded the acknowledgement, false when it was already there.
create function chat.acknowledge_parent_notice(p_contact_id uuid, p_notice_key text, p_notice_version integer)
returns boolean
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  v_added integer;
begin
  if not exists (select 1 from chat.contact c where c.id = p_contact_id and c.is_active) then
    raise exception 'no such active parent' using errcode = 'no_data_found';
  end if;
  insert into chat.parent_notice_ack (contact_id, notice_key, notice_version)
  values (p_contact_id, p_notice_key, p_notice_version)
  on conflict (contact_id, notice_key, notice_version) do nothing;
  get diagnostics v_added = row_count;
  return v_added = 1;
end;
$$;

-- --- Grants: a parent reads their own rows; nobody else, and nobody writes ------------

alter table chat.parent_notice_ack enable row level security;
revoke all on chat.parent_notice_ack from public, anon, authenticated, chat_app;
grant select on chat.parent_notice_ack to authenticated;
create policy parent_notice_ack_own on chat.parent_notice_ack
  for select to authenticated
  using (contact_id in (select chat.current_actor_ids()));

revoke all on function chat.guard_parent_notice_ack() from public;
revoke all on function chat.guard_parent_notice_ack_truncate() from public;
revoke all on function chat.acknowledge_parent_notice(uuid, text, integer) from public;
