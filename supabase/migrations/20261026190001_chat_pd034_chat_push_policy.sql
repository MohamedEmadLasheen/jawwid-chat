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
--   held_push_drop_chat    a HELD push can stand for several chats; muting,
--                          leaving or losing the seat of ONE of them takes only
--                          that chat out (review P1-1, P2-7).
--   leave triggers         use it, and withdraw that chat's own Center entry.
--   an index               one person's pending chat pushes (review P2-9).
--
-- Idempotent (G-19).

insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('new_messages_summary', 'en', 'Jawwid', 'You have {count} new messages.'),
    ('new_messages_summary', 'ar', 'جَوِّد', 'لديك رسائل جديدة: {count}.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);

-- One person's pending chat pushes, for the pipeline's lookups (review P2-9).
create index if not exists notification_chat_pending_idx
  on chat.notification (recipient_id)
  where status = 'scheduled' and event_type in ('message_published', 'mention_created');

-- Take ONE chat out of a person's held push(es): when they mute it, leave it,
-- or lose its seat. The rest of the summary stays; an empty one is withdrawn
-- with p_reason. Under the same per-person advisory lock the pipeline takes
-- (hashtext('<recipient>:chat')), so it never races a fold or a read. A held
-- push carries no item_id: each chat's Center entry stands on its own.
create or replace function chat.held_push_drop_chat(p_recipient uuid, p_conversation uuid, p_reason text)
returns void
language plpgsql
as $$
declare
  r       record;
  v_chats jsonb;
  v_count integer;
  v_first uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_recipient::text || ':chat'));
  for r in
    select id, variables, conversation_id from chat.notification
     where recipient_id = p_recipient
       and event_type = 'message_published'
       and status = 'scheduled'
       and coalesce((variables ->> 'held')::boolean, false)
       and (variables -> 'chats') ? p_conversation::text
     for update
  loop
    v_chats := (r.variables -> 'chats') - p_conversation::text;
    select coalesce(sum((value ->> 'n')::integer), 0), min(key)::uuid
      into v_count, v_first
      from jsonb_each(v_chats);
    if v_count = 0 then
      update chat.notification set status = 'cancelled', failure_code = p_reason where id = r.id;
    else
      update chat.notification
         set variables = r.variables || jsonb_build_object('chats', v_chats, 'count', v_count),
             template_key = case when v_count <= 1 then 'new_message' else 'new_messages_summary' end,
             conversation_id = case when r.conversation_id = p_conversation then v_first else r.conversation_id end
       where id = r.id;
    end if;
  end loop;
end;
$$;

-- Leaving withdraws that chat's waiting push (a held one loses only that chat)
-- and that chat's own unread Center entry -- never another chat's.
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
       and event_type in ('message_published', 'mention_created')
       and status = 'scheduled'
       and coalesce((variables ->> 'held')::boolean, false) = false;
    perform chat.held_push_drop_chat(new.actor_id, new.conversation_id, 'AUDIENCE');
    update chat.notification_item
       set cancelled_at = now(), cancel_reason = 'AUDIENCE', updated_at = now()
     where recipient_id = new.actor_id
       and group_key = 'conversation:' || new.conversation_id::text
       and cancelled_at is null;
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
       and event_type in ('message_published', 'mention_created')
       and status = 'scheduled'
       and coalesce((variables ->> 'held')::boolean, false) = false;
    perform chat.held_push_drop_chat(new.staff_id, new.conversation_id, 'AUDIENCE');
    update chat.notification_item
       set cancelled_at = now(), cancel_reason = 'AUDIENCE', updated_at = now()
     where recipient_id = new.staff_id
       and group_key = 'conversation:' || new.conversation_id::text
       and cancelled_at is null;
  end if;
  return new;
end;
$$;

revoke all on function chat.cancel_message_pushes_on_member_left() from public;
revoke all on function chat.cancel_message_pushes_on_seat_left() from public;
revoke all on function chat.held_push_drop_chat(uuid, uuid, text) from public;
