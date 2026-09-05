-- Jawwid Chat -- break the RLS recursion in the policy helper functions.
--
-- chat.current_staff_id() reads chat.staff, and chat.staff's own policy calls
-- chat.current_staff_id(). chat.staff_can_see_family() reads chat.task, and
-- chat.task's policy calls chat.staff_can_see_family(). Evaluated as the
-- querying user, each pair recurses until the stack limit.
--
-- These four functions therefore run as their owner, so their internal reads
-- are not themselves subject to RLS. They are the smallest possible set: every
-- other helper reaches its tables through one of these and needs no elevation.
-- Each is pinned to an explicit search_path, which SECURITY DEFINER requires.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'chat'
      and p.proname in ('current_staff_id', 'current_staff_role',
                        'staff_can_see_family', 'current_contact_family_ids')
  loop
    execute format('alter function %s security definer', r.signature);
    execute format('alter function %s set search_path = chat, public, pg_temp', r.signature);
  end loop;
end;
$$;

comment on function chat.staff_can_see_family(uuid, uuid) is
  'Runs as owner to avoid recursing through chat.task''s own policy. It answers '
  'only a boolean about the caller''s own role, so elevating it exposes nothing '
  'a staff member could not already read.';
