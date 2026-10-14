-- Roll back 20261014140000_chat_rt031_call_notification_tenant (RT-031 database guards).
--
-- Drops the four triggers and the one function that migration added. No table
-- data is read, changed or deleted. The API half of RT-031 (calls and
-- notifications filed under their tenant, cross-tenant participants never
-- delivered to) is unaffected and keeps working without these guards; what is
-- lost is the backstop for writes that bypass the API.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261014140000_rt031.down.sql

drop trigger if exists call_same_organization on chat.call;
drop trigger if exists notification_same_organization on chat.notification;
drop trigger if exists call_participant_same_organization on chat.call_participant;
drop trigger if exists notification_recipient_same_organization on chat.notification;
drop function if exists chat.enforce_actor_same_organization();

delete from chat.schema_migrations where version = '20261014140000_chat_rt031_call_notification_tenant';
