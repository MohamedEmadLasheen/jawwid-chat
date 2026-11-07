-- Roll back 20261106100000_chat_pd027_lesson_package_link: instalments and balance requests
-- forget their lesson package. Deploy the API without the R-4 change first (it writes the columns);
-- with this rolled back, no instalment or balance is payable in the app.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261106100000_chat_pd027_lesson_package_link.down.sql

set local lock_timeout = '5s';

drop trigger if exists payment_request_lesson_package on chat.payment_request;
drop trigger if exists family_instalment_lesson_package on chat.family_instalment;
drop function if exists chat.pd027_request_lesson_package();
drop function if exists chat.pd027_instalment_lesson_package();
alter table chat.payment_request drop constraint if exists payment_request_lesson_package_is_a_balance;
alter table chat.payment_request drop column if exists lesson_subscription_id;
drop index if exists chat.family_instalment_lesson_package;
alter table chat.family_instalment drop column if exists lesson_subscription_id;

delete from chat.schema_migrations where version = '20261106100000_chat_pd027_lesson_package_link';
