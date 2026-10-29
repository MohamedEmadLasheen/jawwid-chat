-- PD-35 (2026-10-29) -- the notification rules behind the escalation-case pushes.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-35 (B5).
--
-- 20261029180000 (#223) added the case texts and OutboxWorker.deliverCase
-- emits case_opened / case_assigned / case_due_soon through the PD-34
-- pipeline with those rule keys. chat.notification.rule_key references
-- chat.notification_rule (notification_rule_key_fkey), and the three rules
-- were never seeded: every case push insert failed the foreign key after the
-- Center entry was written, and the outbox retried the event (found by the
-- PD-47 audit). These are the rows, in the shape of the existing ones: sent at
-- once, as a push, normal priority, quiet hours respected.
--
-- recipient_role 'staff': the worker chooses the recipients (the owner, the
-- target department's manager); the role is not a filter for these rules.
--
-- Idempotent (G-19).

insert into chat.notification_rule
  (key, event_type, offset_seconds, template_key, recipient_role, channel, priority, respect_quiet_hours) values
  ('case_opened',   'case_opened',   0, 'case_opened',   'staff', 'push', 'normal', true),
  ('case_assigned', 'case_assigned', 0, 'case_assigned', 'staff', 'push', 'normal', true),
  ('case_due_soon', 'case_due_soon', 0, 'case_due_soon', 'staff', 'push', 'normal', true)
on conflict (key) do nothing;
