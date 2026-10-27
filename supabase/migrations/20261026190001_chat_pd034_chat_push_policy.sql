-- PD-34 amendment (owner, 2026-10-27) -- the chat push policy.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-34 (6, 8).
--
-- Chat-message pushes only: quiet hours ON by default and at most 6 per person
-- per rolling hour, the excess HELD into one summary push rather than dropped.
-- The policy itself is code and chat.config (notification.chat.*); this adds
-- what the database needs for it:
--
--   new_messages_summary   the generic, lock-screen-safe text a held push
--                          shows once it stands for more than one message.
--   leave triggers         a HELD push can stand for several chats; leaving
--                          one of them must not withdraw the others, so the
--                          triggers now skip held pushes (the send-time
--                          audience check trims them chat by chat instead).
--
-- Idempotent (G-19).

insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('new_messages_summary', 'en', 'Jawwid', 'You have {count} new messages.'),
    ('new_messages_summary', 'ar', 'جَوِّد', 'لديك رسائل جديدة: {count}.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);

create or replace function chat.cancel_message_pushes_on_member_left()
returns trigger
language plpgsql
as $$
begin
  if old.left_at is null and new.left_at is not null then
    update chat.notification
       set status = 'cancelled', failure_code = 'AUDIENCE'
     where recipient_id = new.actor_id
       and conversation_id = new.conversation_id
       and event_type = 'message_published'
       and status = 'scheduled'
       and coalesce((variables ->> 'held')::boolean, false) = false;
  end if;
  return new;
end;
$$;

create or replace function chat.cancel_message_pushes_on_seat_left()
returns trigger
language plpgsql
as $$
begin
  if old.left_at is null and new.left_at is not null then
    update chat.notification
       set status = 'cancelled', failure_code = 'AUDIENCE'
     where recipient_id = new.staff_id
       and conversation_id = new.conversation_id
       and event_type = 'message_published'
       and status = 'scheduled'
       and coalesce((variables ->> 'held')::boolean, false) = false;
  end if;
  return new;
end;
$$;

revoke all on function chat.cancel_message_pushes_on_member_left() from public;
revoke all on function chat.cancel_message_pushes_on_seat_left() from public;
