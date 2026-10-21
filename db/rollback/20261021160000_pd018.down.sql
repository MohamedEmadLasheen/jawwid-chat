-- Roll back 20261021160000_chat_pd018_teacher_payroll (PD-18 teacher payroll).
--
-- REFUSES while any payroll row or teaching market exists: salary terms, payout
-- accounts and amounts are records the academy entered by hand, and a rollback
-- never drops them. Export them first (the payout details stay sealed in an
-- export; keep TEACHER_PAYOUT_KEY with it), or do not roll back.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261021160000_pd018.down.sql

do $$
begin
  if exists (select 1 from chat.teacher_pay_terms)
     or exists (select 1 from chat.teacher_payout_account)
     or exists (select 1 from chat.teacher_pay_adjustment)
     or exists (select 1 from chat.teacher_file where teaching_market is not null) then
    raise exception 'PD-18 rollback refused: payroll rows exist (export them first; history is never dropped)';
  end if;
end;
$$;

drop table chat.teacher_pay_adjustment;
drop table chat.teacher_payout_account;
drop table chat.teacher_pay_terms;
drop function chat.forbid_payroll_rewrite();
drop function chat.guard_teacher_payroll_row();
alter table chat.teacher_file drop column teaching_market;

delete from chat.schema_migrations where version = '20261021160000_chat_pd018_teacher_payroll';
