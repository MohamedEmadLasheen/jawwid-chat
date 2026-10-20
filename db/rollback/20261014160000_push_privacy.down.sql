-- Roll back 20261014160000_chat_push_privacy_templates: DEACTIVATE (never
-- delete) the generic versions that migration added, so the previous versions
-- -- which name the sender / caller -- render again. No other row is touched.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261014160000_push_privacy.down.sql

update chat.notification_template t
   set is_active = false
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
 where t.key = v.key and t.locale = v.locale
   -- 20261020300000 corrected the Arabic brand name in place, so a row may
   -- carry either spelling; both are the version this migration added.
   and t.title in (v.title, replace(v.title, 'جوّيد', 'جَوِّد'))
   and t.body  in (v.body,  replace(v.body,  'جوّيد', 'جَوِّد'));

delete from chat.schema_migrations where version = '20261014160000_chat_push_privacy_templates';
