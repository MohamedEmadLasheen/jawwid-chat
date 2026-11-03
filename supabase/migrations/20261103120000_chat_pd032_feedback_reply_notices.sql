-- =============================================================================
-- PD-32 amendment · the parent is told when the administration answers
--
--   feedback_replied             staff write the FIRST reply to a parent's
--                                praise, suggestion or complaint. Changing a
--                                reply already sent tells no one.
--   feedback_complaint_in_review a parent's app complaint moves received ->
--                                in review (taken, replied to, or followed up)
--   feedback_complaint_resolved  a parent's app complaint is resolved (its
--                                PD-26 resolution on the Teacher File)
--
-- Told: the parent who filed it (chat.parent_feedback.contact_id), once per
-- feedback and kind (the dedupe key). A Notification Center entry that opens
-- that one feedback item, and a push through the PD-34 pipeline: the parent's
-- own push preference (category 'conversation') and quiet hours are kept. The
-- texts are generic: never the teacher, the child, the parent's words or the
-- reply -- a lock screen is not behind sign-in. OutboxWorker delivers them; a
-- push that fails is retried by the dispatcher and never undoes the reply.
--
--   chat.parent_feedback_reply_seen  per feedback, per parent account: the
--                                moment that account opened the reply. No row
--                                (and a reply) = the reply is unread for it.
--                                Written and read only by the API (src/teacher-
--                                file); no request role is granted anything.
--
-- The complaint lifecycle and its resolution rules are unchanged.
-- Idempotent (G-19).
-- =============================================================================

create table if not exists chat.parent_feedback_reply_seen (
  feedback_id  uuid not null references chat.parent_feedback (id),
  -- The parent account (contact) that opened the reply.
  contact_id   uuid not null references chat.contact (id),
  seen_at      timestamptz not null default now(),
  primary key (feedback_id, contact_id)
);

comment on table chat.parent_feedback_reply_seen is
  'PD-32: which parent accounts have opened the administration''s reply to a feedback item. Drives the parent app''s unread dot.';

alter table chat.parent_feedback_reply_seen enable row level security;
revoke all on chat.parent_feedback_reply_seen from public, anon, authenticated, chat_app;

insert into chat.notification_rule
  (key, event_type, offset_seconds, template_key, recipient_role, channel, priority, respect_quiet_hours) values
  ('feedback_replied',             'feedback_replied',             0, 'feedback_replied',             'parent', 'push', 'normal', true),
  ('feedback_complaint_in_review', 'feedback_complaint_in_review', 0, 'feedback_complaint_in_review', 'parent', 'push', 'normal', true),
  ('feedback_complaint_resolved',  'feedback_complaint_resolved',  0, 'feedback_complaint_resolved',  'parent', 'push', 'normal', true)
on conflict (key) do nothing;

-- The wording the owner approved (2026-11-03). The push and the Center entry say the same.
insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('feedback_replied', 'en', 'Jawwid', 'The administration has replied to your feedback.'),
    ('feedback_replied', 'ar', 'جَوِّد', 'ردّت الإدارة على ملاحظتك.'),
    ('feedback_complaint_in_review', 'en', 'Jawwid', 'Your complaint has been received and is being reviewed.'),
    ('feedback_complaint_in_review', 'ar', 'جَوِّد', 'تم استلام شكواك، ويجري العمل على مراجعتها.'),
    ('feedback_complaint_resolved', 'en', 'Jawwid', 'Your complaint has been resolved. You can view the administration''s reply.'),
    ('feedback_complaint_resolved', 'ar', 'جَوِّد', 'تم التعامل مع شكواك، يمكنك الاطلاع على رد الإدارة.'),
    ('inbox.feedback_replied', 'en', 'Jawwid', 'The administration has replied to your feedback.'),
    ('inbox.feedback_replied', 'ar', 'جَوِّد', 'ردّت الإدارة على ملاحظتك.'),
    ('inbox.feedback_complaint_in_review', 'en', 'Jawwid', 'Your complaint has been received and is being reviewed.'),
    ('inbox.feedback_complaint_in_review', 'ar', 'جَوِّد', 'تم استلام شكواك، ويجري العمل على مراجعتها.'),
    ('inbox.feedback_complaint_resolved', 'en', 'Jawwid', 'Your complaint has been resolved. You can view the administration''s reply.'),
    ('inbox.feedback_complaint_resolved', 'ar', 'جَوِّد', 'تم التعامل مع شكواك، يمكنك الاطلاع على رد الإدارة.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);
