-- Rollback of 20261106140000_chat_pd057_block_notices.sql: the block_created_manager
-- texts. Entries and deliveries already written keep their template key and render
-- the generic line (inbox-render.ts falls back to inbox.generic).
delete from chat.notification_template
 where key in ('block_created_manager', 'inbox.block_created_manager');
