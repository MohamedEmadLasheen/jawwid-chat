-- PD-34 QA fix (Android smoke test on systest, 2026-10-27).
--
-- A) The Notification Center showed a literal "{child}": lesson-reminder
--    entries written before PD-34 carry {"startsAt"} only, while their in-app
--    templates name the child. The renderer now never shows an unfilled
--    placeholder (inbox-render.ts); this backfills `child` on those entries
--    from the lesson's learner (or a trial's prospect), the same value the
--    scheduler writes today (scheduling.service.ts).
-- B) A PD-36 mention is its own Center entry ("X mentioned you"), under
--    Conversations: the in-app templates. The push keeps its generic wording.
--
-- Idempotent (G-19): templates insert once; the backfill touches only entries
-- still without `child` and can be run again.

insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('inbox.mention', 'en', 'You were mentioned', '{by} mentioned you in a conversation.'),
    ('inbox.mention', 'ar', 'إشارة إليك', 'أشار إليك {by} في محادثة.'),
    ('inbox.mention_group', 'en', 'You were mentioned', '{by} mentioned you in the family group.'),
    ('inbox.mention_group', 'ar', 'إشارة إليك', 'أشار إليك {by} في مجموعة العائلة.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);

create or replace function chat.pd034_backfill_child()
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  n integer;
  m integer;
begin
  -- Lesson reminders: the subject is the lesson.
  update chat.notification_item i
     set variables = i.variables || jsonb_build_object('child', named.child),
         updated_at = now()
    from (select l.id::text as lesson_id, coalesce(le.name, p.display_name) as child
            from chat.lesson l
            left join chat.learner le on le.id = l.learner_id
            left join chat.trial_prospect p on p.id = l.prospect_id) named
   where i.template_key in ('inbox.lesson_reminder_tomorrow', 'inbox.lesson_reminder_soon', 'inbox.lesson_reminder_teacher')
     and not (i.variables ? 'child')
     and named.lesson_id = coalesce(i.refs ->> 'lessonId', i.subject_id)
     and named.child is not null;
  get diagnostics n = row_count;

  -- PD-22 clock-shift warnings: the subject is `<slot id>:<date>`.
  update chat.notification_item i
     set variables = i.variables || jsonb_build_object('child', le.name),
         updated_at = now()
    from chat.learner_schedule_slot s
    join chat.learner le on le.id = s.learner_id
   where i.template_key = 'inbox.lesson_clock_shift'
     and not (i.variables ? 'child')
     and s.id::text = split_part(i.subject_id, ':', 1);
  get diagnostics m = row_count;

  return n + m;
end;
$$;

comment on function chat.pd034_backfill_child() is
  'PD-34 QA fix: names the child on lesson entries written before PD-34. Touches only entries without one; safe to run again.';

revoke all on function chat.pd034_backfill_child() from public;

select chat.pd034_backfill_child();
