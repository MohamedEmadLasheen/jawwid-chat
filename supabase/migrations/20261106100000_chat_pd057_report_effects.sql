-- =============================================================================
-- PD-57 ENG-02 · what two report resolutions do (closure plan 2026-11-06 §4)
--
--   warned      the reported person receives a `conduct_warning` notification:
--               a fixed, bilingual Code of Conduct reminder. It never names a
--               report, a reporter or a message. The texts are here; the API
--               (ModerationService, through the outbox and the PD-34 pipeline)
--               sends it.
--   reassigned  a PD-47 work task `report_reassignment` for each manager of the
--               report's departments (the Super Admin when there is none, and
--               always for child_safety, which no department sees: D-4). One
--               chat.report_reassignment_task row per (report, manager) is the
--               task's source, so each manager has a task of their own; the task
--               reads the report's id and its resolution note through it.
--
-- Needs 20261104100000 (chat.content_report) and the PD-47 task helpers
-- (chat.work_task_raise, chat.work_task_super_admin).
-- Rollback: db/rollback/20261106100000_chat_pd057_report_effects.down.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. conduct_warning: the push and the Notification Center entry
-- ---------------------------------------------------------------------------
-- DRAFT copy for the owner's review (N-3 owns the Code of Conduct's wording;
-- this is only a reminder of it). No placeholder: nothing about the person,
-- the report or the message can reach a lock screen or the Center.
insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('conduct_warning', 'ar', 'جَوِّد',
     'تذكير بميثاق السلوك في الأكاديمية: نرجو أن تبقى جميع المحادثات محترمة ولائقة.'),
    ('conduct_warning', 'en', 'Jawwid',
     'A reminder of the academy''s Code of Conduct: please keep every conversation respectful and appropriate.'),
    ('inbox.conduct_warning', 'ar', 'تذكير بميثاق السلوك',
     'نرجو أن تبقى جميع المحادثات في الأكاديمية محترمة ولائقة، وفق ميثاق السلوك.'),
    ('inbox.conduct_warning', 'en', 'Code of Conduct reminder',
     'Please keep every conversation in the academy respectful and appropriate, as the Code of Conduct asks.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);

-- ---------------------------------------------------------------------------
-- 2. report_reassignment: the task's source
-- ---------------------------------------------------------------------------
create table if not exists chat.report_reassignment_task (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references chat.organization (id),
  report_id         uuid not null references chat.content_report (id),
  manager_staff_id  uuid not null references chat.staff (id),
  created_at        timestamptz not null default now(),
  constraint report_reassignment_task_once unique (report_id, manager_staff_id)
);

comment on table chat.report_reassignment_task is
  'PD-57 (closure plan §4): one manager asked to follow up a report resolved as reassigned; the source of their '
  'PD-47 work task report_reassignment. Insert-only. Grants nothing: the report itself stays behind the moderation scope.';

create or replace function chat.guard_report_reassignment_task()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a report reassignment is never changed or deleted' using errcode = 'check_violation';
  end if;
  new.created_at := now();
  if not exists (select 1 from chat.content_report r
                  where r.id = new.report_id and r.organization_id = new.organization_id and r.resolution = 'reassigned') then
    raise exception 'a reassignment follows a report of its organization resolved as reassigned' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.staff s where s.id = new.manager_staff_id and s.organization_id = new.organization_id) then
    raise exception 'a reassignment names staff of the report''s organization' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists report_reassignment_task_is_coherent on chat.report_reassignment_task;
create trigger report_reassignment_task_is_coherent
  before insert or update or delete on chat.report_reassignment_task
  for each row execute function chat.guard_report_reassignment_task();

alter table chat.report_reassignment_task enable row level security;
revoke all on chat.report_reassignment_task from public, anon, authenticated, chat_app;
revoke all on function chat.guard_report_reassignment_task() from public;

-- The managers of the report's departments (live), or the Super Admin when
-- there is none. child_safety: the Super Admin only (D-4: no department sees
-- it). One task each; returns how many were raised. Called by the API in the
-- transaction that closes the report, after the report row says `reassigned`.
create or replace function chat.work_task_raise_report_reassignment(p_report uuid)
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  r          chat.content_report;
  v_managers uuid[];
  v_manager  uuid;
  v_source   uuid;
  v_n        integer := 0;
begin
  select * into r from chat.content_report where id = p_report;
  if r.id is null or r.resolution is distinct from 'reassigned' then
    raise exception 'only a report resolved as reassigned raises reassignment tasks' using errcode = 'check_violation';
  end if;
  if r.reason <> 'child_safety' then
    select coalesce(array_agg(distinct d.manager_id order by d.manager_id), '{}') into v_managers
      from chat.department d
      join chat.staff s on s.id = d.manager_id and s.is_active and s.left_at is null
     where d.organization_id = r.organization_id and d.id = any (r.department_ids);
  end if;
  if coalesce(cardinality(v_managers), 0) = 0 then
    v_managers := array_remove(array[chat.work_task_super_admin(r.organization_id)], null);
  end if;
  foreach v_manager in array v_managers loop
    insert into chat.report_reassignment_task (organization_id, report_id, manager_staff_id)
    values (r.organization_id, r.id, v_manager)
    on conflict (report_id, manager_staff_id) do nothing
    returning id into v_source;
    if v_source is not null
       and chat.work_task_raise(r.organization_id, 'report_reassignment', v_source, v_manager, null,
                                'high', 'operational', 'generic', now() + interval '24 hours') is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke all on function chat.work_task_raise_report_reassignment(uuid) from public;
