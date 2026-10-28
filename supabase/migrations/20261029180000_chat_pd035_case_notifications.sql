-- PD-35 B5 follow-up (2026-10-28) -- escalation cases reach the people they are for.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-35 (B5).
--
-- case.opened / case.assigned / case.due_soon were enqueued since B5 (#155)
-- but delivered to no one: they carry no conversationId, so the outbox
-- worker's default branch dropped them (found by the PD-47 Tasks audit). The
-- worker now routes them (outbox.worker.ts) through PD-34's pipeline as 'task'
-- entries. These are their texts:
--
--   case_*         the push: generic, never the case's title, body or subject
--                  (a lock screen is not behind sign-in)
--   inbox.case_*   the Notification Center entry, behind sign-in; still
--                  generic -- the case itself is read in Escalations, which
--                  re-checks who may see it
--
-- Idempotent (G-19): each template inserts once.

insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('case_opened', 'en', 'Jawwid', 'A case was escalated to you.'),
    ('case_opened', 'ar', 'جَوِّد', 'صُعِّدت إليك حالة.'),
    ('case_assigned', 'en', 'Jawwid', 'A case was assigned to you.'),
    ('case_assigned', 'ar', 'جَوِّد', 'أُسندت إليك حالة.'),
    ('case_due_soon', 'en', 'Jawwid', 'A case of yours is due tomorrow.'),
    ('case_due_soon', 'ar', 'جَوِّد', 'موعد إحدى حالاتك غدًا.'),
    ('inbox.case_opened', 'en', 'New escalation', 'A case was escalated to you. Open it in Escalations.'),
    ('inbox.case_opened', 'ar', 'تصعيد جديد', 'صُعِّدت إليك حالة. افتحها في التصعيدات.'),
    ('inbox.case_assigned', 'en', 'Case assigned to you', 'A case was assigned to you. Open it in Escalations.'),
    ('inbox.case_assigned', 'ar', 'أُسندت إليك حالة', 'أُسندت إليك حالة. افتحها في التصعيدات.'),
    ('inbox.case_due_soon', 'en', 'Case due tomorrow', 'A case of yours is due tomorrow. Open it in Escalations.'),
    ('inbox.case_due_soon', 'ar', 'حالة موعدها غدًا', 'موعد إحدى حالاتك غدًا. افتحها في التصعيدات.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);
