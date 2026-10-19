-- Jawwid Chat -- push privacy (RT-037 / W8-W1 reopen, owner decision 2026-10-14):
-- no sender or caller name on the lock screen.
--
-- The four push templates that named a person (`new_message` title, the call
-- bodies) get a NEW VERSION with generic text. Nothing is deleted or rewritten:
-- TemplateService renders the highest ACTIVE version, so the earlier versions
-- stay as history and come back if these are deactivated (the rollback).
-- Also fixes a pre-existing defect in passing: `group_call_started` named
-- {student_name}, which no caller ever supplied, so the placeholder was shown
-- literally.
--
-- Idempotent: a version is added only when an identical active one is not
-- already there. Reversible: db/rollback/20261014160000_push_privacy.down.sql.

do $pre$
begin
  if to_regclass('chat.notification_template') is null then
    raise exception 'push privacy precondition failed: chat.notification_template missing';
  end if;
end
$pre$;

insert into chat.notification_template (key, locale, version, title, body)
select v.key, v.locale,
       coalesce((select max(t.version) from chat.notification_template t where t.key = v.key and t.locale = v.locale), 0) + 1,
       v.title, v.body
  from (values
    ('new_message',        'en', 'Jawwid',         'You have a new message.'),
    ('new_message',        'ar', 'جوّيد',          'لديك رسالة جديدة.'),
    ('incoming_call',      'en', 'Incoming call',  'Incoming call on Jawwid.'),
    ('incoming_call',      'ar', 'مكالمة واردة',   'مكالمة واردة على جوّيد.'),
    ('missed_call',        'en', 'Missed call',    'You missed a call on Jawwid.'),
    ('missed_call',        'ar', 'مكالمة فائتة',   'فاتتك مكالمة على جوّيد.'),
    ('group_call_started', 'en', 'Jawwid',         'A call started in your group.'),
    ('group_call_started', 'ar', 'جوّيد',          'بدأت مكالمة في مجموعتك.')
  ) as v(key, locale, title, body)
 where not exists (
   select 1 from chat.notification_template t
    where t.key = v.key and t.locale = v.locale and t.title = v.title and t.body = v.body and t.is_active);

-- Prove it: the version each of these keys now renders names nobody.
do $assert$
declare
  v_bad text;
begin
  select string_agg(t.key || '/' || t.locale, ', ') into v_bad
    from (select distinct on (key, locale) key, locale, title, body
            from chat.notification_template
           where is_active and key in ('new_message', 'incoming_call', 'missed_call', 'group_call_started')
           order by key, locale, version desc) t
   where t.title ~ '\{(sender_name|caller_name|student_name|preview)\}'
      or t.body  ~ '\{(sender_name|caller_name|student_name|preview)\}';
  if v_bad is not null then
    raise exception 'push privacy: active template still names a person: %', v_bad;
  end if;
end
$assert$;
