-- Jawwid Chat -- the lifecycle of organization_id.
--
-- 095000 gave every tenant table the column and made cross-organization
-- references unrepresentable. This migration answers the four questions that
-- make it a policy rather than a column:
--
--   How is the first organization created?   In 095000, as data. A second one
--                                            goes through chat.bootstrap_organization().
--   How do Core-originated rows get one?     From the caller's organization, via
--                                            the column default. The Jawwid Core
--                                            boundary never accepts one in a
--                                            payload -- see §4 below.
--   Is it immutable?                         Yes. Enforced by trigger on every
--                                            tenant table.
--   How is cross-organization access stopped? Structurally by the composite keys
--                                            in 095000, and by RLS in 095200.

-- 1. Identity resolution runs as owner ---------------------------------------
-- chat.current_organization_id() reads chat.account, which no caller may read
-- (it has RLS enabled and no policy at all -- ADR-013). Since it is also the
-- DEFAULT on 42 columns, it is evaluated as whoever is inserting, and would fail
-- for every one of them. It joins the same small set of elevated identity
-- helpers, and like them it answers only a question about the caller itself.

alter function chat.current_organization_id() security definer;
alter function chat.current_organization_id() set search_path = chat, pg_temp;

-- 2. organization_id is immutable --------------------------------------------
-- Moving a row between tenants is never a legitimate update. It is how a
-- mis-scoped write becomes a cross-tenant read, so the database refuses it
-- outright rather than leaving it to a policy that has to be right everywhere.

create or replace function chat.forbid_organization_change()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception
      'chat.%.organization_id is immutable; a row cannot change tenant', tg_table_name
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger absence_organization_is_immutable
  before update of organization_id on chat.absence
  for each row execute function chat.forbid_organization_change();
create trigger account_organization_is_immutable
  before update of organization_id on chat.account
  for each row execute function chat.forbid_organization_change();
create trigger audit_log_organization_is_immutable
  before update of organization_id on chat.audit_log
  for each row execute function chat.forbid_organization_change();
create trigger call_organization_is_immutable
  before update of organization_id on chat.call
  for each row execute function chat.forbid_organization_change();
create trigger call_participant_organization_is_immutable
  before update of organization_id on chat.call_participant
  for each row execute function chat.forbid_organization_change();
create trigger class_session_organization_is_immutable
  before update of organization_id on chat.class_session
  for each row execute function chat.forbid_organization_change();
create trigger config_organization_is_immutable
  before update of organization_id on chat.config
  for each row execute function chat.forbid_organization_change();
create trigger contact_organization_is_immutable
  before update of organization_id on chat.contact
  for each row execute function chat.forbid_organization_change();
create trigger conversation_organization_is_immutable
  before update of organization_id on chat.conversation
  for each row execute function chat.forbid_organization_change();
create trigger conversation_member_organization_is_immutable
  before update of organization_id on chat.conversation_member
  for each row execute function chat.forbid_organization_change();
create trigger conversation_participant_state_organization_is_immutable
  before update of organization_id on chat.conversation_participant_state
  for each row execute function chat.forbid_organization_change();
create trigger core_event_organization_is_immutable
  before update of organization_id on chat.core_event
  for each row execute function chat.forbid_organization_change();
create trigger core_parent_inbox_organization_is_immutable
  before update of organization_id on chat.core_parent_inbox
  for each row execute function chat.forbid_organization_change();
create trigger coverage_rule_organization_is_immutable
  before update of organization_id on chat.coverage_rule
  for each row execute function chat.forbid_organization_change();
create trigger device_token_organization_is_immutable
  before update of organization_id on chat.device_token
  for each row execute function chat.forbid_organization_change();
create trigger enrollment_organization_is_immutable
  before update of organization_id on chat.enrollment
  for each row execute function chat.forbid_organization_change();
create trigger event_log_organization_is_immutable
  before update of organization_id on chat.event_log
  for each row execute function chat.forbid_organization_change();
create trigger family_organization_is_immutable
  before update of organization_id on chat.family
  for each row execute function chat.forbid_organization_change();
create trigger family_note_organization_is_immutable
  before update of organization_id on chat.family_note
  for each row execute function chat.forbid_organization_change();
create trigger family_state_cache_organization_is_immutable
  before update of organization_id on chat.family_state_cache
  for each row execute function chat.forbid_organization_change();
create trigger handoff_organization_is_immutable
  before update of organization_id on chat.handoff
  for each row execute function chat.forbid_organization_change();
create trigger learner_organization_is_immutable
  before update of organization_id on chat.learner
  for each row execute function chat.forbid_organization_change();
create trigger message_organization_is_immutable
  before update of organization_id on chat.message
  for each row execute function chat.forbid_organization_change();
create trigger message_approval_organization_is_immutable
  before update of organization_id on chat.message_approval
  for each row execute function chat.forbid_organization_change();
create trigger message_attachment_organization_is_immutable
  before update of organization_id on chat.message_attachment
  for each row execute function chat.forbid_organization_change();
create trigger message_hidden_for_organization_is_immutable
  before update of organization_id on chat.message_hidden_for
  for each row execute function chat.forbid_organization_change();
create trigger message_reaction_organization_is_immutable
  before update of organization_id on chat.message_reaction
  for each row execute function chat.forbid_organization_change();
create trigger message_receipt_organization_is_immutable
  before update of organization_id on chat.message_receipt
  for each row execute function chat.forbid_organization_change();
create trigger notification_organization_is_immutable
  before update of organization_id on chat.notification
  for each row execute function chat.forbid_organization_change();
create trigger notification_rule_organization_is_immutable
  before update of organization_id on chat.notification_rule
  for each row execute function chat.forbid_organization_change();
create trigger notification_template_organization_is_immutable
  before update of organization_id on chat.notification_template
  for each row execute function chat.forbid_organization_change();
create trigger outbox_event_organization_is_immutable
  before update of organization_id on chat.outbox_event
  for each row execute function chat.forbid_organization_change();
create trigger payment_organization_is_immutable
  before update of organization_id on chat.payment
  for each row execute function chat.forbid_organization_change();
create trigger quiet_hours_organization_is_immutable
  before update of organization_id on chat.quiet_hours
  for each row execute function chat.forbid_organization_change();
create trigger shift_organization_is_immutable
  before update of organization_id on chat.shift
  for each row execute function chat.forbid_organization_change();
create trigger staff_organization_is_immutable
  before update of organization_id on chat.staff
  for each row execute function chat.forbid_organization_change();
create trigger subscription_organization_is_immutable
  before update of organization_id on chat.subscription
  for each row execute function chat.forbid_organization_change();
create trigger support_case_organization_is_immutable
  before update of organization_id on chat.support_case
  for each row execute function chat.forbid_organization_change();
create trigger sync_state_organization_is_immutable
  before update of organization_id on chat.sync_state
  for each row execute function chat.forbid_organization_change();
create trigger task_organization_is_immutable
  before update of organization_id on chat.task
  for each row execute function chat.forbid_organization_change();
create trigger teacher_organization_is_immutable
  before update of organization_id on chat.teacher
  for each row execute function chat.forbid_organization_change();
create trigger thread_organization_is_immutable
  before update of organization_id on chat.thread
  for each row execute function chat.forbid_organization_change();

-- 3. Configuration is per-organization ---------------------------------------
-- PRD §5.3 and §5.4 make every weight, threshold and window manager-tunable.
-- Two academies would tune them differently, so the key alone cannot identify a
-- row. The accessors keep their signature, so no engine function changes.

alter table chat.config drop constraint config_pkey;
alter table chat.config add constraint config_pkey primary key (organization_id, key);

create or replace function chat.config_num(p_key text)
returns numeric
language plpgsql
stable
as $$
declare
  v jsonb;
begin
  select value into v from chat.config
   where key = p_key and organization_id = chat.current_organization_id();
  if v is null then
    raise exception 'chat.config key % is not set for this organization', p_key
      using errcode = 'no_data_found';
  end if;
  return (v #>> '{}')::numeric;
end;
$$;

create or replace function chat.config_text(p_key text)
returns text
language plpgsql
stable
as $$
declare
  v jsonb;
begin
  select value into v from chat.config
   where key = p_key and organization_id = chat.current_organization_id();
  if v is null then
    raise exception 'chat.config key % is not set for this organization', p_key
      using errcode = 'no_data_found';
  end if;
  return v #>> '{}';
end;
$$;

create or replace function chat.config_json(p_key text)
returns jsonb
language plpgsql
stable
as $$
declare
  v jsonb;
begin
  select value into v from chat.config
   where key = p_key and organization_id = chat.current_organization_id();
  if v is null then
    raise exception 'chat.config key % is not set for this organization', p_key
      using errcode = 'no_data_found';
  end if;
  return v;
end;
$$;

-- Reading config must not depend on the caller holding a grant on chat.account.
alter function chat.config_num(text)  security definer;
alter function chat.config_text(text) security definer;
alter function chat.config_json(text) security definer;
alter function chat.config_num(text)  set search_path = chat, pg_temp;
alter function chat.config_text(text) set search_path = chat, pg_temp;
alter function chat.config_json(text) set search_path = chat, pg_temp;

-- 4. Creating a further organization -----------------------------------------
-- Deliberately not reachable from the API. Onboarding a second academy is an
-- operator action with a migration-shaped blast radius (every config key has to
-- be seeded for it), not something a request can trigger.

create or replace function chat.bootstrap_organization(
  p_slug text, p_display_name text, p_copy_config_from text default 'jawwid'
) returns uuid
language plpgsql
as $$
declare
  v_id     uuid;
  v_source uuid;
begin
  insert into chat.organization (slug, display_name)
  values (p_slug, p_display_name)
  returning id into v_id;

  -- A new organization with no config would fail on the first engine call, so
  -- the defaults are copied rather than left to be discovered at runtime.
  select id into v_source from chat.organization where slug = p_copy_config_from;
  if v_source is not null then
    insert into chat.config (organization_id, key, value, scope, description)
    select v_id, key, value, scope, description
    from chat.config where organization_id = v_source;
  end if;

  return v_id;
end;
$$;

comment on function chat.bootstrap_organization is
  'The only way a second tenant comes into existence. Note that from the moment '
  'it returns, chat.current_organization_id() no longer falls back to "the only '
  'organization": every caller must then establish its own tenant, and anything '
  'that did not will fail loudly.';
