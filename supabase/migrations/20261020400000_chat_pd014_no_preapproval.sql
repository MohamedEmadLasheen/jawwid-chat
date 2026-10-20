-- =============================================================================
-- PD-14: messages publish immediately; admins moderate after sending
-- (product owner, 2026-10-20)
-- =============================================================================
--
-- Until now a Student Group (and every other group) held teacher and parent
-- messages for the supervisor's approval: chat.conversation's two
-- *_requires_approval flags defaulted to true and the API stored such a message
-- as moderation = 'pending' with a chat.message_approval row.
--
-- PD-14 retires that. Every message is published when it is sent, for every
-- role and every conversation type. The API no longer reads the two flags
-- (AuthorizationService.canSend always publishes); this migration makes the
-- stored data say the same, so a DTO or a report reading them is not stale.
--
-- Moderation now happens AFTER sending: whoever is in charge of the
-- conversation on a PD-8 basis may edit or delete-for-everyone a teacher's or
-- parent's message; a department manager or the super admin also a staff
-- member's (AuthorizationService.moderatableAuthorKinds).
--
-- MESSAGES ALREADY PENDING are left exactly as they are. They are not
-- published by this migration -- nobody reviewed them, and publishing them here
-- would bypass receipts, ordering events and the audit trail. The approval
-- queue keeps working for them alone, so an admin can still release or reject
-- each one; no new row will ever join it.

-- ---------------------------------------------------------------------------
-- 1. The group approval flags: off everywhere, and off by default.
-- ---------------------------------------------------------------------------

-- The defaults change BEFORE the rows: updating chat.conversation queues its
-- deferred constraint triggers, and Postgres refuses an ALTER TABLE on a table
-- with pending trigger events in the same transaction.
alter table chat.conversation alter column teacher_requires_approval set default false;
alter table chat.conversation alter column parent_requires_approval  set default false;

comment on column chat.conversation.teacher_requires_approval is
  'Retired by PD-14 (2026-10-20): always false; nothing is held for approval.';
comment on column chat.conversation.parent_requires_approval is
  'Retired by PD-14 (2026-10-20): always false; nothing is held for approval.';

update chat.conversation
   set teacher_requires_approval = false,
       parent_requires_approval  = false
 where teacher_requires_approval or parent_requires_approval;

update chat.config
   set value = 'false'::jsonb,
       description = 'Retired by PD-14 (2026-10-20): messages are never held for approval.'
 where key in ('approval.student_group_teacher_default', 'approval.student_group_parent_default');

-- ---------------------------------------------------------------------------
-- 2. The body-immutability floor: an approved message may now be edited.
-- ---------------------------------------------------------------------------
--
-- 20261020130000 refused any edit of a message that had ever gone through
-- approval ("an approver can never edit a message"). With approval retired, a
-- message approved before PD-14 is an ordinary published message, and an admin
-- may correct it like any other. Everything else is unchanged: only a recorded
-- edit of a published text message, with a chat.message_revision row holding
-- the replaced wording, may change a body -- whoever makes it.

create or replace function chat.forbid_message_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.body is distinct from old.body
     and old.deleted_for_all = false and new.deleted_for_all = false then
    -- The one lawful rewrite: a recorded edit of a published text.
    if not (
      new.edited_at is not null
      and new.edited_at is distinct from old.edited_at
      and old.type = 'text'
      and old.moderation = 'published'
      and new.moderation = 'published'
      and new.body is not null
      and exists (
        select 1 from chat.message_revision r
         where r.message_id = old.id
           and r.edited_at = new.edited_at
           and r.previous_body is not distinct from old.body
      )
    ) then
      raise exception 'chat.message.body is immutable once sent'
        using errcode = 'restrict_violation';
    end if;
  end if;
  if new.author_id is distinct from old.author_id
     or new.author_type is distinct from old.author_type
     or new.conversation_id is distinct from old.conversation_id
     or new.seq is distinct from old.seq then
    raise exception 'chat.message identity columns are immutable'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

update chat.config
   set description = '[hypothesis] How long after sending an AUTHOR may edit a text message. '
                     'A group admin moderating it (PD-14) has no window.'
 where key = 'communication.edit_window_minutes';
