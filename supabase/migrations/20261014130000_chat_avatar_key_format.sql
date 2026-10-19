-- =============================================================================
-- One avatar object-key format, enforced by the database
-- =============================================================================
--
-- Depends on 20261005140000 / 20261005160000 (the avatar columns) and
-- 20261014100000 (guard_staff_request_writes). Forward-only; constraints and
-- privileges only, no data rewritten.
--
-- THE FORMAT: avatars/<kind>/<id of the row>/<uuid>
--   kind = staff | contact | learner | teacher
--
-- WHY: a key is a name, not a capability -- the signing call is the access
-- decision -- but a signer can only check "this key belongs to this row" if the
-- key says so. The staff-profile pipeline issues avatars/staff/<staff id>/<uuid>
-- and guard_staff_request_writes requires it on the request role.
-- feat/account-avatar's API issued flat avatars/<name> keys, which tie a photo
-- to no one: any row could be pointed at any upload. That API is not
-- integrated; this makes the flat shape impossible for EVERY writer (owner and
-- service paths included), so a later port cannot bring it back silently.
--
-- REQUEST ROLES: contact, learner and teacher photos have no request-role
-- writer (their API is not integrated), so those avatar_object_key columns are
-- server-side only, like chat.contact.account_id (20261014100300).
-- chat.staff.avatar_object_key keeps its guarded grant.
--
-- EXISTING DATA: main never had these columns, so a main-derived database holds
-- no keys. A database that ran feat/account-avatar's API may hold flat keys; the
-- migration then stops and names the table instead of rewriting anyone's photo.
-- =============================================================================

do $format$
declare
  v_kind text;
  v_bad  bigint;
begin
  foreach v_kind in array array['staff', 'contact', 'learner', 'teacher'] loop
    execute format(
      'select count(*) from chat.%I where avatar_object_key is not null and avatar_object_key !~ (''^avatars/%s/'' || id::text || ''/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'')',
      v_kind, v_kind) into v_bad;
    if v_bad > 0 then
      raise exception 'chat.% has % avatar key(s) outside avatars/%/<id>/<uuid>; re-issue those photos before applying this migration',
        v_kind, v_bad, v_kind;
    end if;
    execute format('alter table chat.%I drop constraint if exists %I', v_kind, v_kind || '_avatar_key_format');
    execute format(
      'alter table chat.%I add constraint %I check (avatar_object_key is null or avatar_object_key ~ (''^avatars/%s/'' || id::text || ''/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''))',
      v_kind, v_kind || '_avatar_key_format', v_kind);
  end loop;
end
$format$;

revoke insert (avatar_object_key), update (avatar_object_key) on chat.contact from public, anon, authenticated, chat_app;
revoke insert (avatar_object_key), update (avatar_object_key) on chat.learner from public, anon, authenticated, chat_app;
revoke insert (avatar_object_key), update (avatar_object_key) on chat.teacher from public, anon, authenticated, chat_app;

do $assert$
declare
  v_role text;
  v_kind text;
begin
  foreach v_kind in array array['staff', 'contact', 'learner', 'teacher'] loop
    if not exists (select 1 from pg_constraint
                    where conrelid = ('chat.' || v_kind)::regclass
                      and conname = v_kind || '_avatar_key_format' and convalidated) then
      raise exception 'chat.% lacks a validated avatar key format constraint', v_kind;
    end if;
  end loop;
  foreach v_role in array array['anon', 'authenticated', 'chat_app'] loop
    foreach v_kind in array array['contact', 'learner', 'teacher'] loop
      if has_column_privilege(v_role, 'chat.' || v_kind, 'avatar_object_key', 'UPDATE')
         or has_column_privilege(v_role, 'chat.' || v_kind, 'avatar_object_key', 'INSERT') then
        raise exception '% can still write chat.%.avatar_object_key', v_role, v_kind;
      end if;
    end loop;
  end loop;
end
$assert$;
