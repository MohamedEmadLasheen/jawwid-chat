-- Jawwid Chat -- PD-6: the authorized teacher<->parent relationship predicate.
--
-- WHAT THIS IS
-- ------------
-- PD-6 (2026-09-23, docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md section 4)
-- re-versioned BR-1. A teacher and a parent may now hold a direct 1:1
-- conversation and call -- but ONLY where an authorized relationship exists.
-- This migration adds the database's own, independent answer to "does that
-- relationship exist?".
--
-- WHAT THIS IS NOT
-- ----------------
-- This migration changes NO behaviour. It adds a function and an index and
-- nothing else. Every BR-1 trigger still enforces the OLD rule: a direct
-- teacher<->parent channel is still refused by
-- chat.enforce_direct_conversation_rules, chat.enforce_call_participant_rules,
-- chat.assert_conversation_br1 and chat.assert_call_br1, exactly as before.
--
-- That is deliberate and is the point of the sequence: define the relationship,
-- prove the relationship, and only then switch the decision that consumes it.
-- A later migration redirects the backstops onto this function. Until then the
-- function is dead weight that can be tested in isolation, which is the only
-- way to be sure the replacement is right before the old control is removed.
--
-- WHY SECURITY DEFINER
-- --------------------
-- chat.teacher has RLS enabled with a restrictive organization policy and NO
-- permissive policy, so an ordinary caller reads zero rows from it. A predicate
-- that reads under the caller's own RLS would therefore answer "no relationship"
-- for every legitimate pair -- and, worse, would make the answer depend on WHO
-- is asking rather than on what is true. Authorization facts must not vary by
-- reader.
--
-- So this runs as its owner, with a pinned search_path, exactly like
-- chat.current_staff_id() and chat.current_organization_id() (see
-- 20260905091300_chat_policy_helper_privileges.sql for the same reasoning).
--
-- Elevating it exposes nothing: it returns one boolean about one pair of ids
-- the caller already named, and reads no column it could return.
--
-- FAIL CLOSED
-- -----------
-- Every unknown answers false: a NULL argument, an id that matches no row, a
-- contact or teacher that cannot be read, a family with no learners. There is
-- no branch that returns true without a complete, live, same-organization chain
-- of real rows. A predicate that guards a channel must never answer "yes"
-- because it could not establish "no".

-- ---------------------------------------------------------------------------
-- 1. The predicate
-- ---------------------------------------------------------------------------

create or replace function chat.teacher_parent_authorized(
  p_teacher_id uuid,
  p_contact_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  -- The chain, and the whole chain:
  --   contact -> family -> learner -> assigned teacher
  --
  -- EXISTS, not a count: a family with two learners taught by the same teacher
  -- is one relationship, not two, and duplicate paths must not change the
  -- answer.
  select exists (
    select 1
      from chat.contact c
      join chat.learner l on l.family_id = c.family_id
      join chat.teacher t on t.id = l.teacher_id
     where c.id = p_contact_id
       and t.id = p_teacher_id
       -- The parent side must be a live participant in communication.
       -- can_message is the capability flag the messaging path already
       -- honours; a contact without it is a relative on the record, not a
       -- correspondent.
       and c.is_active
       and c.can_message
       -- The teacher side must be live. is_active and left_at are separate
       -- facts in this schema (a teacher can be deactivated without an
       -- offboarding date, and vice versa), so both are required.
       and t.is_active
       and t.left_at is null
       -- Tenant isolation, stated here rather than inherited. This function is
       -- SECURITY DEFINER and therefore NOT subject to the restrictive
       -- organization policies that would otherwise separate these rows, so it
       -- must carry the boundary itself or it would become the one place where
       -- two organizations can touch.
       and c.organization_id = t.organization_id
       and l.organization_id = c.organization_id
  );
$$;

comment on function chat.teacher_parent_authorized(uuid, uuid) is
  'PD-6. True when this teacher and this family contact are linked by a learner '
  'in the contact''s family, both sides live, within one organization. The '
  'database''s independent answer: it reads only server-owned rows synchronized '
  'from Jawwid Core and takes nothing from the application, so it still holds '
  'when the API is bypassed entirely. Fails closed -- every unknown is false. '
  'Adding this function changes no behaviour; the BR-1 triggers are redirected '
  'onto it in a later migration.';

-- Revoke the default PUBLIC execute grant that a new function carries. A
-- SECURITY DEFINER function runs as its owner, so who may call it is a decision
-- to make explicitly rather than inherit.
revoke all on function chat.teacher_parent_authorized(uuid, uuid) from public;
grant execute on function chat.teacher_parent_authorized(uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The index the predicate needs
-- ---------------------------------------------------------------------------
--
-- The existing indexes are learner_family_idx (family_id) and
-- learner_teacher_idx (teacher_id) WHERE teacher_id is not null. The predicate
-- drives from BOTH ends at once -- "is this teacher assigned to any learner in
-- this family" -- so a composite serves it with one lookup instead of an
-- index scan plus a filter.
--
-- Justified by an actual query pattern, not by speculation: once PD-6's
-- authorization switch lands, this runs on every message send, every call
-- start and every media-token issue between a teacher and a parent.
create index if not exists learner_teacher_family_idx
  on chat.learner (teacher_id, family_id)
  where teacher_id is not null;

comment on index chat.learner_teacher_family_idx is
  'Serves chat.teacher_parent_authorized(): the (teacher, family) direction of '
  'the PD-6 relationship chain.';
