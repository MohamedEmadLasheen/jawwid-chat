-- Jawwid Chat -- event types for the Jawwid Core boundary.
--
-- Widening a CHECK rather than migrating an ENUM is the seam ADR-003 exists
-- for; this is the third time it has been used and it stays a one-line ALTER.

alter table chat.event_log drop constraint event_log_type_check;
alter table chat.event_log add constraint event_log_type_check check (type in (
  'message_received', 'message_sent', 'internal_note_added',
  'case_opened', 'case_status_changed', 'case_resolved', 'case_closed',
  'case_reopened', 'case_escalated', 'case_auto_resolved',
  'task_created', 'task_completed', 'task_cancelled',
  'handoff_created', 'handoff_acknowledged', 'coverage_started',
  'coverage_ended', 'sticky_started', 'sticky_expired',
  'absence_activated', 'absence_auto_detected', 'unattended_detected',
  'ownership_transferred', 'family_state_changed', 'family_flagged',
  'payment_failed', 'payment_succeeded', 'renewal_due', 'subscription_synced',
  'class_reminder_due', 'class_attended', 'class_missed',
  'attention_order_disputed',
  'family_opened', 'assist_requested',
  -- The Jawwid Core integration boundary.
  'core_event_received', 'core_event_applied', 'core_event_failed',
  'core_event_rejected', 'core_event_duplicate'));
