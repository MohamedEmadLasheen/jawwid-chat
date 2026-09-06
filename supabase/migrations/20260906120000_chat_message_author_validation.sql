-- Jawwid Chat -- re-express message author validation against the canonical
-- conversation model.
--
-- WHY
-- chat.assert_message_author_exists(), as written in
-- 20260905090400_chat_conversation_domain.sql, resolved the author's family
-- through chat.thread:
--
--     and c.family_id = (select family_id from chat.thread where id = new.thread_id)
--
-- Every message written through the conversation model carries thread_id = NULL,
-- so that subselect is NULL, the comparison is NULL, NOT EXISTS is true, and the
-- trigger rejected the insert. POST /messages was therefore impossible: it
-- failed with SQLSTATE 23503 and surfaced as HTTP 500.
--
-- The original migration is left untouched (it is AI #1's file and it is
-- already applied); this migration supersedes the function definition.
--
-- WHAT CHANGES
--   * chat.conversation becomes the canonical container for author validation.
--     chat.thread remains supported for legacy thread-scoped rows but is no
--     longer required, and is never reintroduced as a dependency of a
--     conversation message.
--   * 'teacher' becomes a permitted author_type. It was absent from the check
--     constraint, so a teacher could not author a message at all -- which makes
--     the Student Group, the ONLY channel through which a teacher may reach a
--     parent (PRD §12.5), unusable by the teacher.
--   * Teacher authorship is validated explicitly, which the previous function
--     did not do at all: 'teacher' fell through every branch unchecked.
--
-- ENFORCEMENT IS STRENGTHENED, NOT RELAXED
-- Customer-side authors (contact, teacher) must now be members of the
-- conversation they are writing to, which is strictly stronger than the family
-- check it replaces. Staff are validated by existence and active status rather
-- than membership, because coverage and handoff both let an on-duty staff
-- member answer a conversation they are not a listed member of; requiring
-- membership there would break the coverage model (PRD §9).

-- ---------------------------------------------------------------------------
-- 1. Permit 'teacher' as an author kind
-- ---------------------------------------------------------------------------
alter table chat.message drop constraint if exists message_author_type_check;
alter table chat.message
  add constraint message_author_type_check
  check (author_type in ('contact', 'staff', 'teacher', 'system'));

-- on_behalf_mode stays staff-only: a teacher never writes on behalf of anyone.
-- (Restated here only as documentation; the existing constraints already say so.)

-- ---------------------------------------------------------------------------
-- 2. Author validation against the canonical model
-- ---------------------------------------------------------------------------
create or replace function chat.assert_message_author_exists()
returns trigger
language plpgsql
as $$
declare
  fam uuid;
  is_member boolean;
begin
  -- A message must live in exactly one container. Without this, a row with
  -- neither a conversation nor a thread would skip every check below.
  if new.conversation_id is null and new.thread_id is null then
    raise exception 'message % belongs to no conversation or thread', new.id
      using errcode = 'check_violation';
  end if;

  -- Resolve the owning family from whichever container is set. The conversation
  -- is canonical; the thread branch exists only for legacy rows.
  select coalesce(
           (select c.family_id from chat.conversation c where c.id = new.conversation_id),
           (select t.family_id from chat.thread       t where t.id = new.thread_id))
    into fam;

  if fam is null then
    raise exception 'message container % has no family', coalesce(new.conversation_id, new.thread_id)
      using errcode = 'foreign_key_violation';
  end if;

  -- Membership of the conversation, when there is one. Used for the two
  -- customer-side author kinds.
  is_member := new.conversation_id is not null and exists (
    select 1 from chat.conversation_member m
     where m.conversation_id = new.conversation_id
       and m.actor_id        = new.author_id
       and m.actor_kind      = new.author_type
  );

  if new.author_type = 'system' then
    -- A system message is authored by the product, not by a person.
    if new.author_id is not null then
      raise exception 'system message % must not name an author', new.id
        using errcode = 'check_violation';
    end if;

  elsif new.author_type = 'staff' then
    if not exists (select 1 from chat.staff s
                    where s.id = new.author_id and s.is_active and s.left_at is null) then
      raise exception 'message author % is not an active staff member', new.author_id
        using errcode = 'foreign_key_violation';
    end if;

  elsif new.author_type = 'contact' then
    -- Both conditions, deliberately: the contact must belong to this family AND
    -- be a member of this conversation. Family alone would let any contact of
    -- the family post into a conversation they were never added to.
    if not exists (select 1 from chat.contact c
                    where c.id = new.author_id and c.family_id = fam and c.is_active) then
      raise exception 'message author % is not an active contact on this family', new.author_id
        using errcode = 'foreign_key_violation';
    end if;
    if new.conversation_id is not null and not is_member then
      raise exception 'message author % is not a member of conversation %',
        new.author_id, new.conversation_id
        using errcode = 'foreign_key_violation';
    end if;

  elsif new.author_type = 'teacher' then
    -- There is no chat.teacher table yet (QA correction C-1, owned by AI #1).
    -- Until there is, conversation membership IS the assertion that this actor
    -- is a teacher here -- and it is the assertion BR-1 depends on, because a
    -- teacher can only ever be a member of a group, never of a parent direct.
    if new.conversation_id is null then
      raise exception 'a teacher may only author messages in a conversation'
        using errcode = 'check_violation';
    end if;
    if not is_member then
      raise exception 'message author % is not a teacher member of conversation %',
        new.author_id, new.conversation_id
        using errcode = 'foreign_key_violation';
    end if;
    -- Defence in depth against BR-1: even if a teacher were somehow added to a
    -- direct conversation, they cannot write to it. The structural backstop in
    -- 20260905093300 prevents the membership; this prevents the message.
    if exists (select 1 from chat.conversation c
                where c.id = new.conversation_id and c.type = 'direct') then
      raise exception 'BR-1: a teacher may not post in a direct conversation'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function chat.assert_message_author_exists() is
  'Validates a message author against the canonical conversation model. '
  'Customer-side authors (contact, teacher) must be members of the conversation; '
  'staff are validated by existence and active status so coverage still works.';
