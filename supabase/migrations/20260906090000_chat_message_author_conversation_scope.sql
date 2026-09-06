-- Jawwid Chat -- resolve a message author's family through the CONVERSATION.
--
-- NF-06. chat.assert_message_author_exists() validated a contact author with:
--
--   c.family_id = (select family_id from chat.thread where id = new.thread_id)
--
-- Under the canonical PRD v0.1 conversation model a message belongs to a
-- chat.conversation and new.thread_id is NULL, so the subquery yields NULL, the
-- comparison is never true, and EVERY contact-authored message is rejected. The
-- trigger raised with errcode 'foreign_key_violation', which is why the failure
-- surfaced as a Prisma P2003 with no constraint name -- it was never a foreign
-- key.
--
-- The fix resolves the family from the conversation when there is one and keeps
-- the thread path for legacy rows that predate chat.conversation. The rule is
-- unchanged: a family contact may only author a message on their own family's
-- channel.
--
-- Deliberately NOT changed here:
--   * staff authors stay an existence check. A coverage admin legitimately
--     writes into a family conversation they are not a member of, so requiring
--     conversation membership for staff would break the coverage model.
--   * teacher authors remain unchecked, as before. Teacher identity does not
--     exist yet (CF-08); inventing a check for it here would encode a rule the
--     PRD has not settled.
--   * no constraint is weakened or dropped to make a request pass.

create or replace function chat.assert_message_author_exists()
returns trigger
language plpgsql
as $$
declare
  v_family_id uuid;
begin
  if new.author_type = 'staff' then
    if not exists (select 1 from chat.staff s where s.id = new.author_id) then
      raise exception 'message author % is not a staff member', new.author_id
        using errcode = 'foreign_key_violation';
    end if;
    return new;
  end if;

  if new.author_type = 'contact' then
    -- Canonical model first, legacy thread second. A message carries one or the
    -- other (constraint message_has_conversation).
    if new.conversation_id is not null then
      select family_id into v_family_id
        from chat.conversation where id = new.conversation_id;
    else
      select family_id into v_family_id
        from chat.thread where id = new.thread_id;
    end if;

    if v_family_id is null then
      raise exception
        'message % has no family context: neither its conversation nor its thread resolves a family',
        coalesce(new.id::text, '(new)')
        using errcode = 'foreign_key_violation';
    end if;

    if not exists (
      select 1 from chat.contact c
       where c.id = new.author_id
         and c.family_id = v_family_id
    ) then
      raise exception 'message author % is not a contact of family %',
        new.author_id, v_family_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function chat.assert_message_author_exists() is
  'Existence and family-scope check for a message author. Resolves the family '
  'through chat.conversation, falling back to chat.thread for legacy rows. It '
  'is an integrity backstop, not an authorization check: who may send is '
  'decided by AuthorizationService and chat.conversation_member.';
