-- =============================================================================
-- PD-57 ENG-03 · Block: the managers' notification texts (roadmap 2026-11-03
-- §6.3, A-2a; closure plan 2026-11-06 §5)
--
--   block_created_manager   sent by the API (OutboxWorker, through the PD-34
--                           pipeline) to each responsible manager whose
--                           chat.actor_block_manager_notice row was just written:
--                           in-app and push, under the normal quiet hours.
--
-- The push names nobody (a lock screen is not behind sign-in). The Notification
-- Center entry names the blocker, the blocked person and the family or teacher
-- ({blocker_name}, {blocked_name}, {party_name}); an entry whose variables are
-- missing falls back to the push text (inbox-render.ts). DRAFT copy for the
-- owner's review. Being told grants nothing: the case is opened in the
-- moderation queue with the permissions the manager already has.
--
-- Needs 20261104100000 (chat.actor_block_manager_notice). No table, no grant.
-- Rollback: db/rollback/20261106140000_chat_pd057_block_notices.down.sql.
-- =============================================================================

insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('block_created_manager', 'ar', 'جَوِّد',
     'قام أحد أفراد الأكاديمية بحظر شخص. افتح قائمة البلاغات لمراجعة الحالة.'),
    ('block_created_manager', 'en', 'Jawwid',
     'Someone in the academy blocked a person. Open the reports queue to review the case.'),
    ('inbox.block_created_manager', 'ar', 'حظر جديد',
     'قام {blocker_name} ({party_name}) بحظر {blocked_name}. راجع الحالة في قائمة البلاغات.'),
    ('inbox.block_created_manager', 'en', 'New block',
     '{blocker_name} ({party_name}) blocked {blocked_name}. Review the case in the reports queue.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);
