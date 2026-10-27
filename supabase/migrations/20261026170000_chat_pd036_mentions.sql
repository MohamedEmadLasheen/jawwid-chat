-- PD-36 (2026-10-26) -- @mentions, including mentions that SUMMON a staff
-- member who is not a member of the conversation (an admin, a manager, the
-- super admin) so they can step in.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-36.
--
-- A MENTION NEVER WIDENS AUTHORIZATION. Whoever may be summoned is exactly
-- whoever already STANDS in this conversation under PD-8 --
-- chat.staff_conversation_standing(), PD-35's basis that no seat supplies: the
-- supervisor, an active backup or PD-33 cover, the department manager, the
-- super admin. Those people can already read the whole thread and reply on
-- that basis; a summons only points them at it. Taking a VISIBLE seat -- a
-- member row in a group, an effective seat in a family 1:1 -- is PD-35's
-- primitive (chat.conversation_seat, reason 'mention'), not anything here.
--
-- So the database floor here is: a summons row may only name a live staff
-- member with a PD-8 basis on this conversation, in a conversation type that
-- takes summonses, and a ROLE mention (a parent's "@supervisor" / "@admin")
-- never names the super admin. The API decides first; this refuses anyway.

create table chat.message_mention (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references chat.organization (id),
  conversation_id   uuid not null references chat.conversation (id),
  message_id        uuid not null references chat.message (id) on delete cascade,
  mentioned_by      uuid not null,
  mentioned_by_kind text not null check (mentioned_by_kind in ('staff', 'teacher', 'contact')),
  target_actor_id   uuid not null,
  target_kind       text not null check (target_kind in ('staff', 'teacher', 'contact')),
  -- A parent's role mention, expanded to the people it resolved to. NULL for a
  -- mention of a named person.
  via_role          text check (via_role in ('supervisor', 'admin')),
  -- The target was NOT a live member when mentioned: a summons. A member's
  -- mention is a highlight and a notification, nothing more.
  is_summons        boolean not null,
  -- Where the "@..." sits in message.body, in UTF-16 code units (what JS and
  -- Dart strings index by), so both clients draw the same chip.
  span_start        integer not null check (span_start >= 0),
  span_length       integer not null check (span_length between 2 and 200),
  --   notified    a member's mention (terminal)
  --   pending     a summons not yet answered
  --   joined      the summoned person took a seat (PD-35: a member row in a
  --               group, an effective seat in a family 1:1)
  --   dismissed   the summoned person declined it
  --   expired     nobody answered within mention.expiry_days
  --   void        the person lost their standing before answering
  --   removed     the mentioning message was edited or deleted away
  state             text not null check (state in
                      ('notified', 'pending', 'joined', 'dismissed', 'expired', 'void', 'removed')),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz,
  -- When the target first opened the conversation after the mention: the chat
  -- list's "Mentioned" badge goes; the summons itself stays until answered.
  seen_at           timestamptz,
  resolved_at       timestamptz,
  resolved_by       uuid,
  constraint message_mention_one_per_span unique (message_id, target_actor_id, span_start),
  constraint message_mention_summons_shape check (
    (is_summons and target_kind = 'staff' and expires_at is not null and state <> 'notified')
    or (not is_summons and state in ('notified', 'removed'))
  ),
  constraint message_mention_resolution_is_complete check (
    (state in ('notified', 'pending')) = (resolved_at is null)
  )
);

comment on table chat.message_mention is
  'PD-36: one @mention of one person in one message. A role mention (via_role) is expanded to one row per person. is_summons rows name a non-member staff member with PD-8 standing; their state runs pending -> joined | dismissed | expired | void.';

create index message_mention_message on chat.message_mention (message_id);
create index message_mention_target_open on chat.message_mention (target_actor_id, conversation_id)
  where state = 'pending';
create index message_mention_target_unseen on chat.message_mention (target_actor_id)
  where seen_at is null and state in ('notified', 'pending');
create index message_mention_due on chat.message_mention (expires_at)
  where state = 'pending';
-- The rate limits count recent rows per (conversation, sender).
create index message_mention_rate on chat.message_mention (conversation_id, mentioned_by, created_at);

insert into chat.config (key, value, scope, description) values
('mention.per_sender_hour', '5'::jsonb, 'org',
 'PD-36: how many people one sender may mention in one conversation per hour. '
 'Mentions over the cap are kept as plain text; the message is still sent.'),
('mention.super_admin_day', '3'::jsonb, 'org',
 'PD-36: how many times the super admin may be mentioned in one conversation per day.'),
('mention.parent_role_day', '3'::jsonb, 'org',
 'PD-36: how many "@supervisor" / "@admin" role mentions one parent may send in one conversation per day.'),
('mention.expiry_days', '7'::jsonb, 'org',
 'PD-36: an unanswered summons expires after this many days.')
on conflict (key) do nothing;

-- The conversation types that take a summons: the family-facing groups, the
-- staff-only groups around one teacher, and a FAMILY 1:1 (a parent and the
-- staff in charge). A Teacher <-> Admin 1:1 does not: membership is the only
-- authority to speak there (DEF-001). Class and official groups do not
-- (PD-35's primitive refuses them).
create or replace function chat.conversation_takes_summons(p_conversation uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.conversation c
     where c.id = p_conversation
       and (c.type in ('student_group', 'family_group', 'teacher_supervision', 'trial_group')
            or (c.type = 'direct' and c.family_id is not null))
  );
$$;

-- Everyone who may be summoned into p_conversation at p_at: every live
-- conversation-staff member of its organization who STANDS in it under PD-8
-- (never on a seat alone). The @ picker and the send path both read this;
-- neither has its own rule.
create or replace function chat.mention_eligible_staff(p_conversation uuid, p_at timestamptz default now())
returns table (staff_id uuid, basis text)
language sql
stable
as $$
  select x.staff_id, x.basis
    from (
      select s.id as staff_id, chat.staff_conversation_standing(s.id, c.id, p_at) as basis
        from chat.conversation c
        join chat.staff s on s.organization_id = c.organization_id
       where c.id = p_conversation
         and chat.conversation_takes_summons(c.id)
         and s.is_active and s.left_at is null
         and s.role in ('admin', 'coverage', 'manager', 'super_admin')
    ) x
   where x.basis is not null;
$$;

-- A parent's role mention, resolved:
--   'supervisor'  the supervisor(s) of the children this conversation is about,
--                 or -- while a PD-33 cover is live -- the backup covering them;
--   'admin'       the same people, plus the manager of each one's department.
-- NEVER the super admin, and never anybody without a PD-8 basis on this
-- conversation (the final filter): a role resolves to people, not to access.
create or replace function chat.mention_role_targets(
  p_conversation uuid,
  p_role         text,
  p_at           timestamptz default now()
) returns setof uuid
language plpgsql
stable
as $$
declare
  c record;
begin
  if p_role not in ('supervisor', 'admin') then
    raise exception 'unknown role mention %', p_role using errcode = 'check_violation';
  end if;
  select id, type, family_id, learner_id, organization_id into c
    from chat.conversation where id = p_conversation;
  if c.id is null or not chat.conversation_takes_summons(c.id) then return; end if;

  return query
  with learners as (
    select c.learner_id as learner_id where c.type = 'student_group'
    union
    select cl.learner_id from chat.conversation_learner cl
     where c.type = 'family_group' and cl.conversation_id = c.id
    union
    select l.id from chat.learner l
     where c.type = 'direct' and l.family_id = c.family_id
  ),
  supervisors as (
    select distinct ls.supervisor_id as id
      from chat.learner_supervision ls
      join learners on learners.learner_id = ls.learner_id
  ),
  acting as (
    select coalesce(chat.cover_of(s.id, p_at), s.id) as id from supervisors s
  ),
  wanted as (
    select a.id from acting a
    union
    select d.manager_id
      from supervisors s
      join chat.department_member m on m.staff_id = s.id
      join chat.department d on d.id = m.department_id
     where p_role = 'admin' and d.manager_id is not null
  )
  select w.id
    from wanted w
    join chat.staff st on st.id = w.id
   where st.role <> 'super_admin'
     and st.is_active and st.left_at is null
     and chat.staff_conversation_standing(w.id, c.id, p_at) is not null;
end;
$$;

-- The floor under every row, whatever the API decided.
create or replace function chat.guard_message_mention()
returns trigger
language plpgsql
as $$
declare
  v_msg  record;
  v_conv record;
  v_role text;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.conversation_id <> old.conversation_id
       or new.message_id <> old.message_id or new.mentioned_by <> old.mentioned_by
       or new.target_actor_id <> old.target_actor_id or new.target_kind <> old.target_kind
       or new.via_role is distinct from old.via_role or new.is_summons <> old.is_summons
       or new.span_start <> old.span_start or new.span_length <> old.span_length
       or new.created_at <> old.created_at then
      raise exception 'a mention never changes who, where or whom; only its state moves'
        using errcode = 'check_violation';
    end if;
    if new.state <> old.state and not (
         (old.state = 'pending' and new.state in ('joined', 'dismissed', 'expired', 'void', 'removed'))
      or (old.state = 'notified' and new.state = 'removed')
    ) then
      raise exception 'a mention cannot move from % to %', old.state, new.state
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select m.id, m.conversation_id, m.organization_id, m.author_id into v_msg
    from chat.message m where m.id = new.message_id;
  if v_msg.id is null or v_msg.conversation_id is distinct from new.conversation_id then
    raise exception 'a mention belongs to a message of its conversation' using errcode = 'check_violation';
  end if;
  if v_msg.author_id is distinct from new.mentioned_by then
    raise exception 'a mention is made by the message''s author' using errcode = 'check_violation';
  end if;
  select id, organization_id into v_conv from chat.conversation where id = new.conversation_id;
  if new.state not in ('notified', 'pending') then
    raise exception 'a mention starts as notified or pending' using errcode = 'check_violation';
  end if;

  if new.is_summons then
    if not chat.conversation_takes_summons(new.conversation_id) then
      raise exception 'this conversation takes no summons' using errcode = 'insufficient_privilege';
    end if;
    -- The whole rule: PD-8 standing on THIS conversation, now (a seat is no
    -- standing). A mention grants nothing; it may only name someone who has it.
    if chat.staff_conversation_standing(new.target_actor_id, new.conversation_id, now()) is null then
      raise exception 'only staff in charge of this conversation can be summoned'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.via_role is not null then
    select role into v_role from chat.staff where id = new.target_actor_id;
    if v_role is null or v_role = 'super_admin' then
      raise exception 'a role mention reaches the operations chain, never the super admin'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  new.organization_id := v_conv.organization_id;
  return new;
end;
$$;

create trigger message_mention_guard before insert or update on chat.message_mention
  for each row execute function chat.guard_message_mention();

revoke all on function chat.conversation_takes_summons(uuid) from public;
revoke all on function chat.mention_eligible_staff(uuid, timestamptz) from public;
revoke all on function chat.mention_role_targets(uuid, text, timestamptz) from public;
revoke all on function chat.guard_message_mention() from public;

alter table chat.message_mention enable row level security;
revoke all on chat.message_mention from public, anon, authenticated, chat_app;

-- Push: lock-screen safe, no name and no text (owner decision 2026-10-14). A
-- family group gets its own wording; everything else is "a conversation".
-- A mention is HIGH priority and still waits out quiet hours.
insert into chat.notification_template (key, locale, version, title, body) values
  ('mention',       'en', 1, 'Jawwid', 'You were mentioned in a conversation.'),
  ('mention',       'ar', 1, 'جَوِّد',  'تمت الإشارة إليك في محادثة.'),
  ('mention_group', 'en', 1, 'Jawwid', 'You were mentioned in a family group.'),
  ('mention_group', 'ar', 1, 'جَوِّد',  'تمت الإشارة إليك في مجموعة العائلة.')
on conflict (key, locale, version) do nothing;

insert into chat.notification_rule
  (key, event_type, offset_seconds, template_key, recipient_role, channel, priority, respect_quiet_hours) values
  ('mention',       'mention_created', 0, 'mention',       'participant', 'push', 'high', true),
  ('mention_group', 'mention_created', 0, 'mention_group', 'participant', 'push', 'high', true)
on conflict (key) do nothing;
