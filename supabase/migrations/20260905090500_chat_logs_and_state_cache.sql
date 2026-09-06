-- Jawwid Chat -- event_log, audit_log, family_state_cache (brief SS3 "Logs & config").
--
-- Brief SS3: "event_log and audit_log exist from day one. Audit write happens in
-- the same transaction as the sensitive action." Both are append-only at the
-- database level, so no application bug and no admin session can rewrite
-- history.
--
-- event_log is the calibration substrate. Brief SS7: after 60-90 days the
-- workload weights are re-derived from these rows rather than guessed again.

create table chat.event_log (
  id         bigint generated always as identity primary key,
  family_id  uuid references chat.family (id) on delete cascade,
  case_id    uuid references chat.support_case (id) on delete set null,
  actor_type text not null check (actor_type in ('contact', 'staff', 'system')),
  actor_id   uuid,
  type       text not null check (type in (
               -- conversation
               'message_received', 'message_sent', 'internal_note_added',
               -- cases
               'case_opened', 'case_status_changed', 'case_resolved', 'case_closed',
               'case_reopened', 'case_escalated', 'case_auto_resolved',
               -- tasks
               'task_created', 'task_completed', 'task_cancelled',
               -- coverage
               'handoff_created', 'handoff_acknowledged', 'coverage_started',
               'coverage_ended', 'sticky_started', 'sticky_expired',
               'absence_activated', 'absence_auto_detected', 'unattended_detected',
               -- relationship
               'ownership_transferred', 'family_state_changed', 'family_flagged',
               -- billing, mirrored from Jawwid Core
               'payment_failed', 'payment_succeeded', 'renewal_due', 'subscription_synced',
               -- scheduling
               'class_reminder_due', 'class_attended', 'class_missed',
               -- calibration (brief SS6 "this order is wrong")
               'attention_order_disputed')),
  payload    jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now(),

  constraint event_log_payload_is_object check (jsonb_typeof(payload) = 'object')
);

comment on table chat.event_log is
  'Append-only. Each `type` has a documented payload shape in '
  'docs/architecture/backend-contract.md; the shape is not enforced here so '
  'that logging can never fail a business transaction.';

create index event_log_family_idx on chat.event_log (family_id, at desc);
create index event_log_type_idx on chat.event_log (type, at desc);
create index event_log_case_idx on chat.event_log (case_id) where case_id is not null;

create trigger event_log_is_append_only
  before update or delete on chat.event_log
  for each row execute function chat.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create table chat.audit_log (
  id        bigint generated always as identity primary key,
  actor_id  uuid references chat.staff (id) on delete set null,
  action    text not null,
  entity    text not null,
  entity_id uuid,
  before    jsonb,
  after     jsonb,
  -- Brief SS3: reason is NOT NULL. A sensitive action without a stated reason
  -- cannot be recorded, and therefore cannot be performed.
  reason    text not null check (length(btrim(reason)) > 0),
  at        timestamptz not null default now()
);

comment on table chat.audit_log is
  'Append-only, manager-only read (enforced by RLS). Written in the same '
  'transaction as the action it describes.';

create index audit_log_entity_idx on chat.audit_log (entity, entity_id, at desc);
create index audit_log_actor_idx on chat.audit_log (actor_id, at desc);

create trigger audit_log_is_append_only
  before update or delete on chat.audit_log
  for each row execute function chat.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Writers
-- ---------------------------------------------------------------------------

create or replace function chat.log_event(
  p_type       text,
  p_family_id  uuid default null,
  p_case_id    uuid default null,
  p_actor_type text default 'system',
  p_actor_id   uuid default null,
  p_payload    jsonb default '{}'::jsonb
) returns bigint
language sql
as $$
  insert into chat.event_log (family_id, case_id, actor_type, actor_id, type, payload)
  values (p_family_id, p_case_id, p_actor_type, p_actor_id, p_type, coalesce(p_payload, '{}'::jsonb))
  returning id;
$$;

create or replace function chat.write_audit(
  p_actor_id  uuid,
  p_action    text,
  p_entity    text,
  p_entity_id uuid,
  p_reason    text,
  p_before    jsonb default null,
  p_after     jsonb default null
) returns bigint
language sql
as $$
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (p_actor_id, p_action, p_entity, p_entity_id, p_before, p_after, p_reason)
  returning id;
$$;

-- ---------------------------------------------------------------------------
-- Family state cache
-- ---------------------------------------------------------------------------
-- Brief SS3: recomputed on every family event and every minute for the
-- now/today buckets. Purely derived -- safe to truncate and rebuild.

create table chat.family_state_cache (
  family_id   uuid primary key references chat.family (id) on delete cascade,
  on_duty_id  uuid references chat.staff (id) on delete set null,
  attention   numeric(10, 2) not null default 0,
  bucket      text not null check (bucket in ('now', 'today', 'waiting_on_family', 'quiet')),
  top_reason  text,
  computed_at timestamptz not null default now()
);

comment on column chat.family_state_cache.on_duty_id is
  'Null means nobody is on duty: the family is Unattended and belongs in the '
  'manager''s list (brief SS4). It is never silently assigned to someone.';

create index family_state_cache_inbox_idx
  on chat.family_state_cache (on_duty_id, bucket, attention desc);
create index family_state_cache_unattended_idx
  on chat.family_state_cache (computed_at) where on_duty_id is null;
