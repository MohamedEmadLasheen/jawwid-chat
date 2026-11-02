-- Roll back 20261102200000_chat_teacher005_unpaid_leave (TEACHER-005: unpaid
-- leave beyond the allowance).
--
-- Drops the unpaid mark. Days recorded as unpaid become ordinary leave days
-- again, so a balance that ended at 0 may read negative, as it did before.
-- Roll back the API release with it: LeaveService and TeacherPayrollService
-- read the column.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102200000_teacher005_unpaid_leave.down.sql

alter table chat.teacher_day_off drop constraint if exists teacher_day_off_unpaid_is_leave;
alter table chat.teacher_day_off drop column if exists unpaid;

-- The ledger forgets it, so scripts/db/apply.sh applies it again on the way forward.
delete from chat.schema_migrations where version = '20261102200000_chat_teacher005_unpaid_leave';
