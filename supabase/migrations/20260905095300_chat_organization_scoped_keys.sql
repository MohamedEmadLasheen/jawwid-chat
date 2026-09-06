-- Jawwid Chat -- scope every externally-supplied key to its organization.
--
-- Surrogate keys are uuids and are globally unique by construction; they are
-- left alone. What must change are the NATURAL keys, the ones whose values come
-- from outside this database:
--
--   * identifiers minted by a Jawwid Core instance (core_*_id),
--   * subjects minted by an identity provider,
--   * push tokens, room names and dedupe keys.
--
-- Each organization has its own Jawwid Core and its own identity provider. Two
-- of them can perfectly well mint the same id. Left globally unique, the second
-- organization's parent would collide with the first's -- either rejected, or
-- worse, merged into another tenant's family. That is a cross-tenant data leak
-- reachable through ordinary, correct use of the boundary.
--
-- Uniqueness therefore becomes (organization_id, <natural key>) everywhere.

-- Jawwid Core identifiers ---------------------------------------------------
alter table chat.family        drop constraint family_core_parent_id_key;
alter table chat.family        add constraint family_core_parent_uniq
  unique (organization_id, core_parent_id);

alter table chat.learner       drop constraint learner_core_child_id_key;
alter table chat.learner       add constraint learner_core_child_uniq
  unique (organization_id, core_child_id);

alter table chat.teacher       drop constraint teacher_core_teacher_id_key;
alter table chat.teacher       add constraint teacher_core_teacher_uniq
  unique (organization_id, core_teacher_id);

alter table chat.enrollment    drop constraint enrollment_core_enrollment_id_key;
alter table chat.enrollment    add constraint enrollment_core_enrollment_uniq
  unique (organization_id, core_enrollment_id);

alter table chat.class_session drop constraint class_session_core_class_session_id_key;
alter table chat.class_session add constraint class_session_core_session_uniq
  unique (organization_id, core_class_session_id);

alter table chat.subscription  drop constraint subscription_core_subscription_id_key;
alter table chat.subscription  add constraint subscription_core_subscription_uniq
  unique (organization_id, core_subscription_id);

alter table chat.payment       drop constraint payment_core_payment_id_key;
alter table chat.payment       add constraint payment_core_payment_uniq
  unique (organization_id, core_payment_id);

-- Integration bookkeeping ---------------------------------------------------
alter table chat.core_parent_inbox drop constraint core_parent_inbox_pkey;
alter table chat.core_parent_inbox add constraint core_parent_inbox_pkey
  primary key (organization_id, core_parent_id);

alter table chat.core_event drop constraint core_event_is_unique;
alter table chat.core_event add constraint core_event_is_unique
  unique (organization_id, source, external_event_id);

comment on constraint core_event_is_unique on chat.core_event is
  'The idempotency key is per organization. Two Jawwid Core instances may use '
  'the same event id; they are different events.';

alter table chat.sync_state drop constraint sync_state_pkey;
alter table chat.sync_state add constraint sync_state_pkey
  primary key (organization_id, source);

-- Identity ------------------------------------------------------------------
alter table chat.account drop constraint account_subject_key;
alter table chat.account add constraint account_subject_uniq
  unique (organization_id, subject);

comment on constraint account_subject_uniq on chat.account is
  'Each organization has its own identity provider, so a subject is only unique '
  'within one. chat.current_organization_id() resolves an account by subject '
  'AND organization for exactly this reason.';

-- Notification configuration and delivery -----------------------------------
alter table chat.notification_rule drop constraint notification_rule_pkey;
alter table chat.notification_rule add constraint notification_rule_pkey
  primary key (organization_id, key);

alter table chat.notification_template drop constraint notification_template_key_locale_version_key;
alter table chat.notification_template add constraint notification_template_key_uniq
  unique (organization_id, key, locale, version);

alter table chat.notification drop constraint notification_dedupe_key_key;
alter table chat.notification add constraint notification_dedupe_uniq
  unique (organization_id, dedupe_key);

comment on constraint notification_dedupe_uniq on chat.notification is
  'PRD §11.2 requires the reminder engine to be exactly-once per dedupe key. '
  'Per organization: two academies both reminding about "class:123" are two '
  'different reminders.';

-- Devices and call rooms ----------------------------------------------------
alter table chat.device_token drop constraint device_token_token_key;
alter table chat.device_token add constraint device_token_token_uniq
  unique (organization_id, token);

alter table chat.call drop constraint call_room_name_key;
alter table chat.call add constraint call_room_name_uniq
  unique (organization_id, room_name);

-- With subjects unique only within an organization, resolving an account by
-- subject alone could match two rows once a second tenant exists. The lookup
-- becomes deterministic: an explicit organization setting wins, and otherwise
-- there is only one organization for the fallback to find.
create or replace function chat.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select coalesce(
    nullif(current_setting('chat.organization_id', true), '')::uuid,
    -- Exactly one match, or none. With per-organization subjects two tenants
    -- can mint the same one; picking either would be a coin toss that decides
    -- which tenant's data the caller sees, so ambiguity resolves to NULL and the
    -- caller is forced to name its organization explicitly.
    (select a.organization_id from chat.account a
      where a.subject = chat.current_subject() and a.is_active
        and (select count(*) from chat.account b
              where b.subject = chat.current_subject() and b.is_active) = 1),
    (select o.id from chat.organization o
      where o.is_active
        and (select count(*) from chat.organization where is_active) = 1)
  )
$$;

create or replace function chat.current_account_id()
returns uuid
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select a.id
  from chat.account a
  where a.subject = chat.current_subject()
    and a.is_active
    and a.organization_id = coalesce(
          nullif(current_setting('chat.organization_id', true), '')::uuid,
          a.organization_id)
  limit 1
$$;
