-- Jawwid Chat -- chat.teacher_parent_authorized: is this teacher and this family
-- contact an authorized pair? PD-6, step 1 of the voice-calls rollout.
--
-- WHY
-- ---
-- PD-6 permits direct Parent <-> Teacher communication, and direct calling,
-- ONLY where the relationship is authorized; an unauthorized pair stays denied.
-- Both the application and the database have to be able to answer that question
-- the same way, so the fact is defined once, here, in the database that owns the
-- rows -- rather than as two prose descriptions that drift.
--
-- This migration ADDS the predicate and changes NOTHING about how anything is
-- authorized today. BR-1 and its structural backstop
-- (20260905093300_chat_br1_structural_backstop.sql) are untouched: a teacher and
-- a contact still cannot share a `direct` conversation, and a group pairing them
-- still requires a live admin. Nothing calls this function yet. The switch is a
-- later, separate change, deliberately after this predicate has been proven on
-- its own.
--
-- WHAT MAKES A PAIR AUTHORIZED
-- ----------------------------
-- The teacher teaches a learner in the contact's family, and both sides are
-- currently permitted to communicate:
--
--   * a chat.learner row links the teacher to the contact's family
--   * the teacher is active AND has not left. Both, because a teacher who has
--     left is inactive even if nobody flipped is_active in the same statement --
--     the same rule identity.service.ts applies when it resolves a teacher
--   * the contact is active and holds can_message, which is what the
--     authorization model already means by "a family contact who may message"
--   * all three rows are in the same organization
--
-- FAIL CLOSED
-- -----------
-- Unknown ids, a null id, a learner with no teacher, or rows in different
-- organizations all produce no matching row, and `exists` answers false. There
-- is no branch here that can answer true by accident.
--
-- SECURITY DEFINER, like chat.staff_can_see_family and
-- chat.current_contact_family_ids. A control that reads its evidence under the
-- caller's RLS sees nothing and reports "not authorized" for a pair that is --
-- and, once a trigger depends on this, would reject legitimate writes. The
-- search_path is pinned so the body cannot be redirected at a schema the caller
-- controls.

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
  select exists (
    select 1
    from chat.teacher t
    join chat.learner l
      on  l.teacher_id       = t.id
      and l.organization_id  = t.organization_id
    join chat.contact c
      on  c.family_id        = l.family_id
      and c.organization_id  = t.organization_id
    where t.id        = p_teacher_id
      and c.id        = p_contact_id
      and t.is_active
      and t.left_at is null
      and c.is_active
      and c.can_message
  );
$$;

comment on function chat.teacher_parent_authorized(uuid, uuid) is
  'PD-6: true when this teacher teaches a learner in this contact''s family and '
  'both sides may currently communicate (teacher active and not left; contact '
  'active with can_message), all within one organization. Fails closed on '
  'unknown or null ids. Additive: nothing is authorized differently by its '
  'existence, and BR-1 is unchanged.';

revoke all on function chat.teacher_parent_authorized(uuid, uuid) from public;
grant execute on function chat.teacher_parent_authorized(uuid, uuid) to chat_app;
