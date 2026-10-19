-- Roll back 20261018170000_chat_pd010_teacher_file (PD-10 Teacher File, step 1).
--
-- REFUSES while any Teacher File row or complaint resolution exists: teachers'
-- contact details and resolutions are records the academy entered by hand, and
-- a rollback never drops them. Export them first, confirm the export, delete
-- them by a reviewed statement, or do not roll back.
--
-- chat.teacher_supervision_entry itself is PD-11's (20261018160000) and stays;
-- only what this migration added to it is removed.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261018170000_pd010.down.sql

do $$
begin
  if exists (select 1 from chat.teacher_file)
     or exists (select 1 from chat.teacher_supervision_entry
                 where kind = 'complaint_resolution' or source_message_id is not null) then
    raise exception 'PD-10 rollback refused: Teacher File rows exist (export them first; history is never dropped)';
  end if;
end;
$$;

drop trigger teacher_supervision_entry_followup_is_coherent on chat.teacher_supervision_entry;
drop function chat.guard_teacher_supervision_followup();
drop index chat.teacher_supervision_entry_one_resolution;
alter table chat.teacher_supervision_entry drop constraint teacher_supervision_entry_followup_shape;
alter table chat.teacher_supervision_entry drop column source_message_id, drop column refers_to;
alter table chat.teacher_supervision_entry drop constraint teacher_supervision_entry_kind_check;
alter table chat.teacher_supervision_entry add constraint teacher_supervision_entry_kind_check
  check (kind in ('bonus', 'complaint', 'monthly_comment', 'note'));
drop table chat.teacher_file;
drop function chat.guard_teacher_file();

delete from chat.schema_migrations where version = '20261018170000_chat_pd010_teacher_file';
