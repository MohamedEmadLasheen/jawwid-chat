-- Jawwid Chat -- the API stops connecting as the database owner.
--
-- ORDERING NOTE. This migration grants chat_app privileges on an EXPLICIT list
-- of tables, which is what makes it least privilege. It is therefore numbered
-- to run after the migrations that exist when it lands, and a table added by a
-- later migration gets NO privilege until it is added to the list here (or by a
-- migration of its own). That is the intended failure mode -- a new table is
-- unreachable to the application until somebody decides it should be reachable
-- -- and test/integration/runtime-rls.spec.ts is what makes it loud rather than
-- mysterious.
--
-- WHAT WAS STILL WRONG AFTER PHASE 1
--   RLS was enabled on every table and the policies were correct, but the API
--   connected as the owner -- and an owner bypasses RLS. The control existed
--   and did not apply. `chat_app` and `chat_service` were created but neither
--   could actually run the application: `authenticated` had SELECT on the
--   communication tables and no write policies at all, and the identity tables
--   had no policies whatsoever, so a switch would have produced a total,
--   fail-closed outage rather than a security improvement.
--
-- THIS MIGRATION MAKES chat_app A ROLE THE APPLICATION CAN ACTUALLY RUN AS.
--
--   * it is NOT the owner, so it cannot ALTER or DROP anything, cannot disable
--     RLS, and cannot create or change a policy;
--   * it is NOBYPASSRLS, so every policy in the schema applies to it;
--   * it holds exactly the DML the application performs, and nothing else --
--     no CREATE, no TRUNCATE, no privilege on tables it never touches;
--   * it can complete every operation the application actually makes, which is
--     what the write policies below establish.
--
-- WHAT RLS IS AND IS NOT DOING HERE
--   AuthorizationService remains the decision point. These policies are the
--   second layer: their job is that a missing `where`, an unscoped list or a
--   new endpoint that forgot returns NOTHING instead of everything. They are
--   deliberately no wider than the service-layer rule they mirror, and no
--   narrower -- a policy stricter than the service would turn a correct request
--   into a silent empty result, which is a worse failure than a loud one.

-- ---------------------------------------------------------------------------
-- 1. Authentication cannot be policed by the thing it bootstraps
-- ---------------------------------------------------------------------------
--
-- Every policy resolves the caller through chat.current_subject(). The login
-- path runs BEFORE there is a subject: it has to find the account in order to
-- establish one. So chat.account, chat.account_credential, chat.session,
-- chat.device and chat.account_token are reachable by `chat_app` directly, and
-- by nothing else.
--
-- This is a real and bounded concession, so it is stated rather than hidden:
-- the API process can read password hashes, because verifying a password is
-- what it is for. What it buys is that `authenticated` -- the role any future
-- direct-to-database client would adopt -- holds NO privilege on these tables,
-- so no policy mistake can ever widen them, and the concession does not travel.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'chat_app') then
    create role chat_app nologin nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'chat_service') then
    create role chat_service nologin bypassrls;
  end if;
end
$$;

-- INHERIT is not cosmetic here, and 20260907100300 got it wrong: it created
-- both roles NOINHERIT, which means membership of `authenticated` confers
-- neither its grants nor its POLICIES -- a policy `to authenticated` is matched
-- with pg_has_role(..., 'USAGE'), which is false for a non-inheriting member.
-- The symptom was total, silent invisibility: chat_app resolved its own
-- identity correctly and then read zero rows from every table.
alter role chat_app     inherit nobypassrls;
alter role chat_service inherit bypassrls;

-- The membership has to be RE-granted after the INHERIT change. PostgreSQL 16
-- records an inherit option on the membership itself, taken from the member's
-- rolinherit AT GRANT TIME -- so a membership granted while the role was
-- NOINHERIT stays non-inheriting for ever, and pg_has_role(..., 'USAGE')
-- (which is how a policy `to authenticated` is matched) stays false. Revoking
-- and re-granting is the version-independent way to say what is meant.
revoke authenticated from chat_app;
grant authenticated to chat_app;
revoke service_role from chat_service;
grant service_role to chat_service;

grant usage on schema chat to chat_app;

grant select, insert, update, delete
  on chat.account, chat.account_credential, chat.session, chat.device, chat.account_token
  to chat_app;

-- The restrictive tenant policy on chat.account would refuse the login lookup,
-- because the caller's organization is exactly what that lookup establishes.
-- The carve-out is narrow: it applies only when NO organization is resolvable
-- (the pre-authentication window) and only to a caller that is chat_app.
drop policy if exists account_organization_isolation on chat.account;
create policy account_organization_isolation on chat.account
  as restrictive for all
  using (
    organization_id = chat.current_organization_id()
    or (chat.current_organization_id() is null
        and pg_has_role(current_user, 'chat_app', 'member'))
  )
  with check (
    organization_id = chat.current_organization_id()
    or (chat.current_organization_id() is null
        and pg_has_role(current_user, 'chat_app', 'member'))
  );

comment on policy account_organization_isolation on chat.account is
  'Tenant isolation, with one carve-out: the API may reach an account while no '
  'organization is resolvable, because authenticating is how an organization '
  'becomes resolvable. Once a session exists the ordinary rule applies.';

-- The five identity tables: reachable by chat_app, by nobody else. There is no
-- policy `to authenticated` here and no grant to it either, so the tables are
-- unreadable to a domain caller by construction rather than by a rule.
do $identity$
declare t text;
begin
  foreach t in array array['account', 'account_credential', 'session', 'device', 'account_token']
  loop
    execute format('drop policy if exists %I on chat.%I', t || '_runtime', t);
    execute format(
      'create policy %I on chat.%I for all to chat_app using (true) with check (true)',
      t || '_runtime', t);
  end loop;
end
$identity$;

-- ---------------------------------------------------------------------------
-- 2. Domain privileges
-- ---------------------------------------------------------------------------
-- Exactly the tables the application writes (enumerated from the Prisma call
-- sites), and SELECT on the reference tables it reads. Anything absent is a
-- table the application does not touch, and chat_app cannot touch it either.

grant select, insert, update, delete on
  chat.conversation, chat.conversation_member, chat.conversation_participant_state,
  chat.message, chat.message_attachment, chat.message_reaction, chat.message_receipt,
  chat.message_hidden_for, chat.message_approval,
  chat.call, chat.call_participant,
  chat.notification, chat.device_token, chat.quiet_hours,
  chat.outbox_event, chat.event_log, chat.audit_log,
  chat.account_permission_override, chat.family_assignment
  to chat_app;

grant select on
  chat.family, chat.contact, chat.learner, chat.staff, chat.teacher, chat.organization,
  chat.config, chat.permission, chat.role_permission,
  chat.notification_rule, chat.notification_template
  to chat_app;

-- The sequences behind the two bigint identity logs.
grant usage, select on all sequences in schema chat to chat_app;

-- Deliberately NOT granted: CREATE on the schema, TRUNCATE on anything, and any
-- privilege on chat.schema_migrations, chat.core_event, chat.sync_state or the
-- deprecated coverage machinery. The application never writes them; the worker
-- and the migration runner do, as chat_service.
grant usage on schema chat to chat_service;
grant select, insert, update, delete on all tables in schema chat to chat_service;
grant usage, select on all sequences in schema chat to chat_service;

-- ---------------------------------------------------------------------------
-- 3. Write policies -- the second layer, mirroring the service rule
-- ---------------------------------------------------------------------------
--
-- Reads are already scoped (20260907100300). Writes were not policed at all,
-- so a service-layer bug could have written into any conversation in the
-- tenant. Each policy below asks the SAME question canRead asks:
-- chat.can_read_conversation(). A row the actor could not read is a row they
-- cannot write.

drop policy if exists conversation_written_in_scope on chat.conversation;
create policy conversation_written_in_scope on chat.conversation
  for insert to authenticated
  -- A conversation is created before anyone is a member of it, so scope is the
  -- family's; a family-less conversation (Teacher <-> Admin) is checked by
  -- canOpenDirect and by the BR-1 triggers.
  with check (family_id is null or chat.staff_in_scope(family_id)
              or family_id in (select chat.current_family_ids()));

drop policy if exists conversation_updated_in_scope on chat.conversation;
create policy conversation_updated_in_scope on chat.conversation
  for update to authenticated
  using (chat.can_read_conversation(id))
  with check (chat.can_read_conversation(id));

drop policy if exists conversation_member_written_in_scope on chat.conversation_member;
create policy conversation_member_written_in_scope on chat.conversation_member
  for all to authenticated
  using (chat.can_read_conversation(conversation_id))
  with check (chat.can_read_conversation(conversation_id));

drop policy if exists message_written_in_scope on chat.message;
create policy message_written_in_scope on chat.message
  for insert to authenticated
  with check (chat.can_read_conversation(conversation_id));

drop policy if exists message_updated_in_scope on chat.message;
create policy message_updated_in_scope on chat.message
  for update to authenticated
  using (chat.can_read_conversation(conversation_id))
  with check (chat.can_read_conversation(conversation_id));

do $writes$
declare
  r record;
begin
  -- Message satellites: reachable exactly when their message's conversation is.
  for r in
    select * from (values
      ('message_attachment', 'message_id'),
      ('message_reaction',   'message_id'),
      ('message_receipt',    'message_id'),
      ('message_hidden_for', 'message_id')
    ) as v(child, col)
  loop
    execute format('drop policy if exists %I on chat.%I', r.child || '_written_in_scope', r.child);
    execute format($p$
      create policy %I on chat.%I for all to authenticated
        using (exists (select 1 from chat.message m
                        where m.id = %I and chat.can_read_conversation(m.conversation_id)))
        with check (exists (select 1 from chat.message m
                        where m.id = %I and chat.can_read_conversation(m.conversation_id)))
    $p$, r.child || '_written_in_scope', r.child, r.col, r.col);
  end loop;

  -- Conversation satellites.
  for r in
    select * from (values
      ('message_approval',                'conversation_id'),
      ('conversation_participant_state',  'conversation_id'),
      ('call',                            'conversation_id')
    ) as v(child, col)
  loop
    execute format('drop policy if exists %I on chat.%I', r.child || '_written_in_scope', r.child);
    execute format($p$
      create policy %I on chat.%I for all to authenticated
        using (chat.can_read_conversation(%I))
        with check (chat.can_read_conversation(%I))
    $p$, r.child || '_written_in_scope', r.child, r.col, r.col);
  end loop;
end
$writes$;

drop policy if exists call_participant_written_in_scope on chat.call_participant;
create policy call_participant_written_in_scope on chat.call_participant
  for all to authenticated
  using (exists (select 1 from chat.call c
                  where c.id = call_id and chat.can_read_conversation(c.conversation_id)))
  with check (exists (select 1 from chat.call c
                  where c.id = call_id and chat.can_read_conversation(c.conversation_id)));

-- A notification is addressed to somebody else by design -- the sender writes
-- the recipient's row -- so the scope question is about the CONVERSATION it
-- concerns, not about the recipient.
drop policy if exists notification_written_in_scope on chat.notification;
create policy notification_written_in_scope on chat.notification
  for all to authenticated
  using (conversation_id is null or chat.can_read_conversation(conversation_id))
  with check (conversation_id is null or chat.can_read_conversation(conversation_id));

-- A person registers and retires their own devices, and nobody else's.
drop policy if exists device_token_written_by_owner on chat.device_token;
create policy device_token_written_by_owner on chat.device_token
  for all to authenticated
  using (actor_id in (select chat.current_actor_ids()))
  with check (actor_id in (select chat.current_actor_ids()));

drop policy if exists quiet_hours_written_by_owner on chat.quiet_hours;
create policy quiet_hours_written_by_owner on chat.quiet_hours
  for all to authenticated
  using (actor_id in (select chat.current_actor_ids()))
  with check (actor_id in (select chat.current_actor_ids()));

-- Plumbing and history. The append-only triggers already forbid UPDATE and
-- DELETE on the two logs; these policies only admit the INSERT.
drop policy if exists outbox_event_written_by_app on chat.outbox_event;
create policy outbox_event_written_by_app on chat.outbox_event
  for all to authenticated using (true) with check (true);

drop policy if exists audit_log_written_by_app on chat.audit_log;
create policy audit_log_written_by_app on chat.audit_log
  for insert to authenticated with check (true);

drop policy if exists event_log_written_by_app on chat.event_log;
create policy event_log_written_by_app on chat.event_log
  for insert to authenticated with check (true);

-- Only user management writes an override, and the service checks users.manage
-- before it does. The tenant restriction still ANDs with this.
drop policy if exists account_permission_override_managed on chat.account_permission_override;
create policy account_permission_override_managed on chat.account_permission_override
  for all to authenticated
  using (chat.current_has_permission('users.manage'))
  with check (chat.current_has_permission('users.manage'));

drop policy if exists family_assignment_managed on chat.family_assignment;
create policy family_assignment_managed on chat.family_assignment
  for all to authenticated
  using (chat.current_has_permission('families.assign'))
  with check (chat.current_has_permission('families.assign'));

-- ---------------------------------------------------------------------------
-- 4. The gate
-- ---------------------------------------------------------------------------
-- Reported by /health/ready and asserted at startup outside local environments.
-- A connection that owns the schema, bypasses RLS, or is a superuser can
-- silently ignore every policy above, so the application refuses to pretend
-- otherwise.

create or replace function chat.runtime_role_report()
returns table (
  role_name text,
  is_superuser boolean,
  bypasses_rls boolean,
  owns_schema boolean,
  can_create_in_schema boolean
)
language sql
stable
as $$
  select current_user::text,
         coalesce((select rolsuper from pg_roles where rolname = current_user), false),
         coalesce((select rolbypassrls from pg_roles where rolname = current_user), false),
         pg_get_userbyid((select nspowner from pg_namespace where nspname = 'chat')) = current_user,
         has_schema_privilege(current_user, 'chat', 'create')
$$;

comment on function chat.runtime_role_report is
  'What the connected role can do to the schema itself. RLS is only a control '
  'when every column of this comes back false except role_name.';

grant execute on function chat.runtime_role_report() to authenticated, chat_app, chat_service;

-- ---------------------------------------------------------------------------
-- 5. INSERT ... RETURNING and the read policy
-- ---------------------------------------------------------------------------
--
-- PostgreSQL applies a table's SELECT policy to the RETURNING clause of an
-- INSERT. chat.conversation's read policy called chat.can_read_conversation(),
-- which looks the row up in chat.conversation -- and a function called during
-- the inserting statement cannot see the row that statement is inserting. Every
-- conversation creation therefore failed under a NOBYPASSRLS role with
--
--   new row violates row-level security policy for table "conversation"
--
-- even though the row was perfectly in scope. The predicate is the same one; it
-- is expressed against the row's OWN columns so it can be evaluated without
-- reading the table back.
--
-- The satellite policies (message, member, receipt, call ...) keep calling
-- can_read_conversation(), and are unaffected: their parent conversation
-- already exists by the time they are written.

drop policy if exists conversation_readable_in_scope on chat.conversation;
create policy conversation_readable_in_scope on chat.conversation
  for select to authenticated
  using (
    case
      -- A conversation with no family (Teacher <-> Admin direct) belongs to its
      -- participants. `direct_key` IS the participant set -- it is the sorted
      -- pair of actor ids -- so it answers "is this mine" without a membership
      -- row, which matters because the membership rows are written after the
      -- conversation and do not exist yet at RETURNING time.
      when family_id is null then
        exists (select 1 from chat.current_actor_ids() a
                 where chat.is_live_member(id, a)
                    or direct_key like '%' || a::text || '%')
      -- Staff: scope, and scope alone. A membership row survives a
      -- reassignment, so allowing it to grant access would leave every previous
      -- supervisor reading the family for ever.
      when chat.current_staff_id() is not null then
        chat.staff_in_scope(family_id)
      -- Contacts and teachers: live membership.
      else
        exists (select 1 from chat.current_actor_ids() a where chat.is_live_member(id, a))
    end
  );

-- ---------------------------------------------------------------------------
-- 6. Resolving a principal
-- ---------------------------------------------------------------------------
--
-- Under a NOBYPASSRLS role, IdentityService's very first query is subject to
-- policy -- and the policies inherited from Phase 0 assumed a STAFF reader:
-- chat.contact and chat.learner were visible only through
-- chat.staff_can_see_family(), so a parent could not read their OWN contact row
-- and every request from a family device failed with `unknown actor`.
--
-- Two reads have to work for anybody, and they are narrow:
--
--   1. YOUR OWN principal row. It is how the server learns who you are, and it
--      is your own record.
--   2. The principal rows of people you SHARE A CONVERSATION with. A group
--      needs names on its roster, and the C-4 admin-presence check has to
--      resolve whether the admin in the group is still active -- evaluated when
--      a parent or a teacher posts, so it is their query that must succeed.
--
-- Neither widens what anyone can reach: a co-member is somebody whose messages
-- you can already read, and these tables carry no contact channel by
-- construction (BR-2).

create or replace function chat.shares_a_conversation(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select exists (
    select 1
      from chat.conversation_member m
     where m.actor_id = p_actor_id
       and m.left_at is null
       and chat.can_read_conversation(m.conversation_id))
$$;

comment on function chat.shares_a_conversation is
  'Is this actor a live member of a conversation the caller may read? The '
  'question a group roster asks, and the narrowest form of "you may see this '
  'person exists".';

drop policy if exists contact_visible_to_self_or_co_member on chat.contact;
create policy contact_visible_to_self_or_co_member on chat.contact
  for select to authenticated
  using (account_id = chat.current_account_id() or chat.shares_a_conversation(id));

drop policy if exists staff_visible_to_co_member on chat.staff;
create policy staff_visible_to_co_member on chat.staff
  for select to authenticated
  using (account_id = chat.current_account_id() or chat.shares_a_conversation(id));

drop policy if exists teacher_visible_to_self_or_co_member on chat.teacher;
create policy teacher_visible_to_self_or_co_member on chat.teacher
  for select to authenticated
  using (account_id = chat.current_account_id() or chat.shares_a_conversation(id));

-- A family reads its own record and its own learners; a teacher reads the
-- learners they teach. Both are additive to the staff policy, which is
-- assignment-scoped.
drop policy if exists family_visible_to_its_own_people on chat.family;
create policy family_visible_to_its_own_people on chat.family
  for select to authenticated
  using (id in (select chat.current_family_ids()));

drop policy if exists learner_visible_to_its_own_people on chat.learner;
create policy learner_visible_to_its_own_people on chat.learner
  for select to authenticated
  using (
    family_id in (select chat.current_family_ids())
    or teacher_id in (select t.id from chat.teacher t
                       where t.account_id = chat.current_account_id() and t.is_active)
  );

-- chat.config carries the thresholds every engine reads (page sizes, call token
-- TTL, the device limit). It is not secret -- the client is shown these numbers
-- -- and the read policy was staff-only, which stopped a parent's own send from
-- resolving its page size.
drop policy if exists config_readable_by_staff on chat.config;
create policy config_readable_by_authenticated on chat.config
  for select to authenticated using (true);
