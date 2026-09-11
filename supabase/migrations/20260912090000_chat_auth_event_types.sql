-- Jawwid Chat -- chat.event_log admits the two authentication event types the
-- API contract names. PR-B of the authentication rollout.
--
-- WHY
-- ---
-- `docs/contracts/API-CONTRACT.md` §3.1 specifies, verbatim:
--
--   POST /auth/login    "event_log `auth.login_failed` with {username hash,
--                        reason code} -- never the password, never the raw
--                        username."
--   POST /auth/refresh  "event_log `auth.refresh_reuse_detected` on reuse."
--
-- and `docs/architecture/IDENTITY-MODEL.md` §6 requires that every login,
-- refresh, logout and revocation be recorded durably, in the same transaction
-- as the state change it describes.
--
-- `event_log.type` is a CLOSED check constraint. It admits 43 values and
-- neither of those two is among them, so the canonical writes are impossible
-- until the constraint admits them. That is the whole reason this migration
-- exists: it is a dependency of the audit trail, not a schema change in its
-- own right.
--
-- HOW
-- ---
-- Drop and re-add, keeping EVERY existing value. This is the established
-- pattern in this schema, not a new one: `20260905093000_chat_communication`
-- did exactly this when it added the eight communication types, and
-- `docs/communication/ai1-dependencies.md` records it as
-- "event_log_type_check extended | 8 communication event types added; every
-- existing value kept".
--
-- Widening a CHECK cannot invalidate an existing row, so this is safe on a
-- populated database and re-running it is a no-op.
--
-- NAMING. `auth.login_failed` and `auth.refresh_reuse_detected` carry a dot
-- while every older value is bare snake_case. The dotted form is what
-- API-CONTRACT names literally, and inventing `auth_login_failed` to match the
-- older style would mean the contract and the database disagree about the name
-- of the same event. The contract wins.
--
-- NOT ADDED: a successful-login event type. A successful login is recorded in
-- chat.audit_log as `session.created` (§3.1), which is where the contract puts
-- it; event_log carries the FAILURE, because that is the row a calibration or
-- an incident review reads.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'event_log_type_check') then
    alter table chat.event_log drop constraint event_log_type_check;
  end if;

  alter table chat.event_log add constraint event_log_type_check check (type in (
    -- communication (20260905093000 and earlier) -- every value kept
    'message_received',
    'message_sent',
    'internal_note_added',
    'case_opened',
    'case_status_changed',
    'case_resolved',
    'case_closed',
    'case_reopened',
    'case_escalated',
    'case_auto_resolved',
    'task_created',
    'task_completed',
    'task_cancelled',
    'handoff_created',
    'handoff_acknowledged',
    'coverage_started',
    'coverage_ended',
    'sticky_started',
    'sticky_expired',
    'absence_activated',
    'absence_auto_detected',
    'unattended_detected',
    'ownership_transferred',
    'family_state_changed',
    'family_flagged',
    'payment_failed',
    'payment_succeeded',
    'renewal_due',
    'subscription_synced',
    'class_reminder_due',
    'class_attended',
    'class_missed',
    'attention_order_disputed',
    'family_opened',
    'assist_requested',
    'conversation_created',
    'conversation_archived',
    'student_group_created',
    'student_group_membership_synced',
    'message_approved',
    'message_rejected',
    'call_started',
    'call_ended',

    -- authentication (PR-B). API-CONTRACT §3.1.
    'auth.login_failed',
    'auth.refresh_reuse_detected'
  ));
end $$;

comment on column chat.event_log.type is
  'Closed vocabulary. Extending it is a migration, so a typo in an event name '
  'fails at the database rather than becoming a row nobody queries. The auth.* '
  'values are written by the authentication runtime (API-CONTRACT §3.1) and '
  'carry a HASHED subject only -- event_log never holds a raw login identifier.';
