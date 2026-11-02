-- Roll back 20261102210000_chat_account_erasure (store compliance PR-A, account deletion).
--
-- Drops the two functions. An erasure already done is NOT undone (the data is
-- gone by design); its tasks stay and can be removed by their manager. Roll
-- back the API release with it: AccountDeletionService calls chat.erase_account
-- and TaskService.sweep calls chat.work_task_sweep_erasure.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102210000_account_erasure.down.sql

drop function if exists chat.work_task_sweep_erasure(integer);
drop function if exists chat.erase_account(uuid, text);
