-- =============================================================================
-- PD-43 · what the Teachers manager is told (plan §3.4, §3.7; PD-34 pipeline)
--
--   teacher_added_unsupervised   the API, when a teacher is added with no
--                                supervisor by anyone but the manager.
--   teacher_duplicate_hidden     the API, when a sign-in or contact is refused
--                                because it is on a teacher out of the adder's
--                                reach (the adder's answer stays identical).
--   teacher_supervisor_left      HERE: a trigger on chat.staff, because a
--                                supervisor is deactivated on several paths
--                                (Accounts, the staff profile,
--                                chat.deactivate_principal, the CLI). It writes
--                                the chat.notification row the dispatcher sends.
--
-- The recipient is the Teachers department's manager; with none, the super
-- admin. Names only: never an e-mail or a phone.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Texts: the push and the Notification Center entry, Arabic and English
-- ---------------------------------------------------------------------------
insert into chat.notification_template (key, locale, title, body) values
  ('teacher_added_unsupervised', 'ar', 'جَوِّد',
   'أضاف {addedBy} المعلم {teacher} بلا مشرف. أنت مسؤول عنه حتى يُعيَّن مشرف.'),
  ('teacher_added_unsupervised', 'en', 'Jawwid',
   '{addedBy} added {teacher} with no supervisor. You cover them until one is set.'),
  ('inbox.teacher_added_unsupervised', 'ar', 'معلم بلا مشرف',
   'أضاف {addedBy} المعلم {teacher} بلا مشرف. أنت مسؤول عنه حتى يُعيَّن مشرف.'),
  ('inbox.teacher_added_unsupervised', 'en', 'A teacher without a supervisor',
   '{addedBy} added {teacher} with no supervisor. You cover them until one is set.'),
  ('teacher_duplicate_hidden', 'ar', 'جَوِّد',
   'حاول {addedBy} إضافة {name}، لكن بيانات الدخول أو التواصل مسجّلة في ملف {holder}.'),
  ('teacher_duplicate_hidden', 'en', 'Jawwid',
   '{addedBy} tried to add {name}, but the sign-in or contact is already on {holder}''s file.'),
  ('inbox.teacher_duplicate_hidden', 'ar', 'معلم مكرر محتمل',
   'حاول {addedBy} إضافة {name}، لكن بيانات الدخول أو التواصل مسجّلة في ملف {holder}.'),
  ('inbox.teacher_duplicate_hidden', 'en', 'A possible duplicate teacher',
   '{addedBy} tried to add {name}, but the sign-in or contact is already on {holder}''s file.'),
  ('teacher_supervisor_left', 'ar', 'جَوِّد',
   'لم يعد {supervisor} نشطًا وكان يشرف على {teachers} من المعلمين. عيّن لهم مشرفًا جديدًا.'),
  ('teacher_supervisor_left', 'en', 'Jawwid',
   '{supervisor} is no longer active and still supervised {teachers} teacher(s). Assign them a new supervisor.'),
  ('inbox.teacher_supervisor_left', 'ar', 'معلمون بحاجة إلى مشرف',
   'لم يعد {supervisor} نشطًا وكان يشرف على {teachers} من المعلمين. عيّن لهم مشرفًا جديدًا.'),
  ('inbox.teacher_supervisor_left', 'en', 'Teachers need a supervisor',
   '{supervisor} is no longer active and still supervised {teachers} teacher(s). Assign them a new supervisor.')
on conflict (key, locale, version) do nothing;

-- ---------------------------------------------------------------------------
-- 2. A supervisor leaves with teachers still assigned
-- ---------------------------------------------------------------------------
-- The ONE entry point, SECURITY DEFINER with a pinned search_path and PUBLIC
-- revoked: the deactivating writer (service_role among them) need not be able
-- to write chat.notification, and it calls no helper a writer might not be
-- allowed to EXECUTE -- only tables, read and written by the owner.
-- It never blocks a deactivation: any error writing the notification is
-- swallowed (a warning in the log) and the deactivation stands. The dedupe
-- key (supervisor, transaction, recipient) makes it one per deactivation.
create function chat.notify_teacher_supervisor_left()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_teachers integer;
begin
  begin
    select count(*) into v_teachers
      from chat.teacher_supervisor_assignment a
      join chat.teacher t on t.id = a.teacher_id and t.is_active and t.left_at is null
     where a.supervisor_id = new.id;
    if v_teachers = 0 then
      return new;
    end if;

    insert into chat.notification
      (organization_id, dedupe_key, template_key, event_type, recipient_id, locale, channel, priority, variables, status, scheduled_at)
    select new.organization_id,
           'teacher_supervisor_left:' || new.id || ':' || txid_current() || ':' || r.id,
           'teacher_supervisor_left', 'teacher_supervisor_left', r.id, 'ar', 'push', 'normal',
           jsonb_build_object('supervisor', new.name, 'teachers', v_teachers),
           'scheduled', now()
      from (
        select s.id from chat.department d join chat.staff s on s.id = d.manager_id
         where d.organization_id = new.organization_id and d.kind = 'teachers'
           and s.is_active and s.left_at is null and s.id <> new.id
        union all
        select s.id from chat.staff s
         where s.organization_id = new.organization_id and s.role = 'super_admin'
           and s.is_active and s.left_at is null and s.id <> new.id
           and not exists (select 1 from chat.department d join chat.staff m on m.id = d.manager_id
                            where d.organization_id = new.organization_id and d.kind = 'teachers'
                              and m.is_active and m.left_at is null and m.id <> new.id)
      ) r
    on conflict (dedupe_key) do nothing;
  exception when others then
    raise warning 'PD-43: teacher_supervisor_left for staff % not written: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

create trigger teacher_supervisor_left_tells_the_manager
  after update of is_active, left_at on chat.staff
  for each row
  when ((old.is_active and old.left_at is null) and not (new.is_active and new.left_at is null))
  execute function chat.notify_teacher_supervisor_left();

revoke all on function chat.notify_teacher_supervisor_left() from public;
