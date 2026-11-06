-- =============================================================================
-- PD-57 ENG-04 · report escalation and notifications, to the 24 h SLA
-- (closure plan 2026-11-06 D-1, D-4; roadmap 2026-11-03 §5.2 for the rest)
--
--   1. chat.content_report_alert  one row per (report, stage): the sweep's
--      marker. `due_soon` at 18 h unresolved (the responsible managers;
--      child_safety: every Super Admin and holder of moderation.child_safety),
--      `overdue` at 24 h (every Super Admin; overdue_at is set in the same
--      transaction). Unique, so a restart or a second worker never re-notifies.
--      Insert-only, RLS on, no grant to any request role.
--   2. The notification rules and texts: report_received_staff,
--      report_child_safety, report_due_soon, report_overdue, report_answered.
--      Arabic and English, no placeholder: no reporter, reviewer, subject or
--      words of the report ever reaches a lock screen or the Center.
--   3. The PD-47 task `content_report`, one per report: due at due_at, held by
--      a live manager of the report's departments who holds moderation.view
--      and is not its subject, else the Super Admin; child_safety always the
--      Super Admin (D-4: never a department). Raised when the report is filed,
--      moved to the Super Admin when a duplicate raises it to child_safety,
--      completed (by the resolver) when it is resolved -- by triggers of its
--      own on chat.content_report, as the PD-47 sources do; the API's sweep
--      (ReportEscalationService) is the guarantee.
--
-- The API (ReportEscalationService, through the outbox and the PD-34
-- pipeline) chooses the recipients and sends; nothing here sends.
-- Needs 20261104100000 (chat.content_report) and the PD-47 task helpers.
-- Idempotent (G-19).
-- Rollback: db/rollback/20261106150000_chat_pd057_report_escalation.down.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. chat.content_report_alert
-- ---------------------------------------------------------------------------
create table if not exists chat.content_report_alert (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  report_id        uuid not null references chat.content_report (id),
  stage            text not null check (stage in ('due_soon', 'overdue')),
  created_at       timestamptz not null default now(),
  constraint content_report_alert_once unique (report_id, stage)
);

comment on table chat.content_report_alert is
  'PD-57 ENG-04: an SLA stage of a report that was alerted (due_soon at 18 h, overdue at 24 h), once each. '
  'Insert-only. The marker the 5-minute sweep writes in the transaction that queues the alert. No request role reads it.';

create or replace function chat.guard_content_report_alert()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a report alert is never changed or deleted' using errcode = 'check_violation';
  end if;
  new.created_at := now();
  if not exists (select 1 from chat.content_report r
                  where r.id = new.report_id and r.organization_id = new.organization_id
                    and r.status in ('open', 'in_review')) then
    raise exception 'an alert is for an unresolved report of its organization' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists content_report_alert_is_coherent on chat.content_report_alert;
create trigger content_report_alert_is_coherent
  before insert or update or delete on chat.content_report_alert
  for each row execute function chat.guard_content_report_alert();

alter table chat.content_report_alert enable row level security;
revoke all on chat.content_report_alert from public, anon, authenticated, chat_app;
revoke all on function chat.guard_content_report_alert() from public;

-- ---------------------------------------------------------------------------
-- 2. The rules and the texts
-- ---------------------------------------------------------------------------
-- recipient_role is not a filter (ReportEscalationService chooses who). A
-- child_safety report's alerts go as critical, past quiet hours and the cap,
-- whatever the rule row of their stage says: report_child_safety records it.
insert into chat.notification_rule
  (key, event_type, offset_seconds, template_key, recipient_role, channel, priority, respect_quiet_hours) values
  ('report_received_staff', 'report_received_staff', 0, 'report_received_staff', 'staff',  'push', 'normal',   true),
  ('report_child_safety',   'report_child_safety',   0, 'report_child_safety',   'staff',  'push', 'critical', false),
  ('report_due_soon',       'report_due_soon',       0, 'report_due_soon',       'staff',  'push', 'normal',   true),
  ('report_overdue',        'report_overdue',        0, 'report_overdue',        'staff',  'push', 'high',     true),
  ('report_answered',       'report_answered',       0, 'report_answered',       'sender', 'push', 'normal',   true)
on conflict (key) do nothing;

-- DRAFT copy for the owner's review. Arabic first.
insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('report_received_staff', 'ar', 'جَوِّد', 'وصل بلاغ جديد يحتاج إلى مراجعة.'),
    ('report_received_staff', 'en', 'Jawwid', 'A new report needs review.'),
    ('inbox.report_received_staff', 'ar', 'بلاغ جديد', 'وصل بلاغ جديد يحتاج إلى رد خلال 24 ساعة. افتحه في قائمة البلاغات.'),
    ('inbox.report_received_staff', 'en', 'New report', 'A new report needs an answer within 24 hours. Open it in the reports queue.'),
    ('report_child_safety', 'ar', 'جَوِّد · عاجل', 'بلاغ عاجل يتعلق بسلامة طفل يحتاج إلى مراجعة فورية.'),
    ('report_child_safety', 'en', 'Jawwid · urgent', 'An urgent child-safety report needs review now.'),
    ('inbox.report_child_safety', 'ar', 'بلاغ عاجل: سلامة طفل', 'بلاغ يتعلق بسلامة طفل يحتاج إلى مراجعة فورية. افتحه في قائمة البلاغات.'),
    ('inbox.report_child_safety', 'en', 'Urgent: a child''s safety', 'A child-safety report needs review now. Open it in the reports queue.'),
    ('report_due_soon', 'ar', 'جَوِّد', 'بلاغ لم يُرد عليه بعد، وتنتهي مهلة الرد خلال 6 ساعات.'),
    ('report_due_soon', 'en', 'Jawwid', 'A report is still unanswered; its deadline is in 6 hours.'),
    ('inbox.report_due_soon', 'ar', 'بلاغ تقترب مهلته', 'بلاغ لم يُرد عليه بعد، وتنتهي مهلة الرد البالغة 24 ساعة خلال 6 ساعات. افتحه في قائمة البلاغات.'),
    ('inbox.report_due_soon', 'en', 'Report due soon', 'A report is still unanswered; its 24-hour deadline is in 6 hours. Open it in the reports queue.'),
    ('report_overdue', 'ar', 'جَوِّد', 'تجاوز بلاغ مهلة الرد البالغة 24 ساعة.'),
    ('report_overdue', 'en', 'Jawwid', 'A report has passed its 24-hour deadline.'),
    ('inbox.report_overdue', 'ar', 'بلاغ متأخر', 'تجاوز بلاغ مهلة الرد البالغة 24 ساعة دون رد. افتحه في قائمة البلاغات.'),
    ('inbox.report_overdue', 'en', 'Report overdue', 'A report has passed its 24-hour deadline without an answer. Open it in the reports queue.'),
    ('report_answered', 'ar', 'جَوِّد', 'ردّت الأكاديمية على بلاغك.'),
    ('report_answered', 'en', 'Jawwid', 'The academy has answered your report.'),
    ('inbox.report_answered', 'ar', 'تم الرد على بلاغك', 'ردّت الأكاديمية على بلاغك. اقرأ الرد في بلاغاتي.'),
    ('inbox.report_answered', 'en', 'Your report was answered', 'The academy has answered your report. Read the answer in My reports.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);

-- ---------------------------------------------------------------------------
-- 3. The PD-47 task `content_report`
-- ---------------------------------------------------------------------------

-- The responsible managers of a report (closure plan §3, D-3): the live
-- managers of its departments who hold moderation.view (they can open it) and
-- are not its subject. None for child_safety (D-4).
create or replace function chat.content_report_managers(p_report uuid)
returns setof uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select distinct d.manager_id
    from chat.content_report r
    join chat.department d on d.organization_id = r.organization_id and d.id = any (r.department_ids)
    join chat.staff s on s.id = d.manager_id and s.organization_id = r.organization_id and s.is_active and s.left_at is null
   where r.id = p_report
     and r.reason <> 'child_safety'
     and not (r.subject_kind = 'staff' and r.subject_id = d.manager_id)
     and exists (select 1 from chat.staff_access_profile(s.id) p where 'moderation.view' = any (p.permissions));
$$;

-- Who holds a report's task: the first responsible manager, else the Super Admin.
create or replace function chat.content_report_task_assignee(p_report uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select x.id from chat.content_report_managers(p_report) as x(id) order by x.id limit 1),
    (select chat.work_task_super_admin(r.organization_id) from chat.content_report r where r.id = p_report));
$$;

-- Bring a report's task in line with the report: raised while unresolved,
-- moved to the Super Admin once child_safety, completed by the resolver.
create or replace function chat.work_task_sync_content_report(p_report uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  r     chat.content_report;
  v_key text;
  v_to  uuid;
  v_id  uuid;
begin
  select * into r from chat.content_report where id = p_report;
  if r.id is null then
    return null;
  end if;
  v_key := 'content_report:' || r.id;
  if r.status in ('actioned', 'dismissed') then
    perform chat.work_task_settle(r.organization_id, v_key, r.resolved_by);
    return null;
  end if;
  v_to := chat.content_report_task_assignee(r.id);
  if v_to is null then
    perform chat.work_task_note_issue(r.organization_id, v_key, 'no live Super Admin or department manager to hold the report''s task');
    return null;
  end if;
  v_id := chat.work_task_raise(r.organization_id, 'content_report', r.id, v_to, null, 'high', 'operational', 'generic', r.due_at);
  if v_id is null and r.reason = 'child_safety' then
    -- Raised to child_safety by a duplicate: D-4, no department holds it any more.
    perform chat.work_task_reroute(r.organization_id, v_key, v_to, null, null);
  end if;
  return v_id;
end;
$$;

create or replace function chat.work_task_from_content_report()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    perform chat.work_task_sync_content_report(new.id);
  exception when others then
    -- Never undoes the report; the sweep tries again.
    perform chat.work_task_note_issue(new.organization_id, 'content_report:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

drop trigger if exists content_report_raises_its_task on chat.content_report;
create trigger content_report_raises_its_task after insert on chat.content_report
  for each row execute function chat.work_task_from_content_report();
drop trigger if exists content_report_moves_its_task on chat.content_report;
create trigger content_report_moves_its_task after update of status, reason on chat.content_report
  for each row
  when (old.status is distinct from new.status or old.reason is distinct from new.reason)
  execute function chat.work_task_from_content_report();

revoke all on function chat.content_report_managers(uuid) from public;
revoke all on function chat.content_report_task_assignee(uuid) from public;
revoke all on function chat.work_task_sync_content_report(uuid) from public;
revoke all on function chat.work_task_from_content_report() from public;
