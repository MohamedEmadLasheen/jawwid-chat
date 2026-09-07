-- Jawwid Chat -- Phase 1: row-level security becomes a live control.
--
-- Canonical design: docs/security/RLS-STRATEGY.md.
--
-- THE FINDING IT CLOSES
--   RLS was defined but inert. Seventeen tables -- every table the
--   communication engine writes (conversation, conversation_member, message_*,
--   message_approval, call, call_participant, notification*, device_token,
--   quiet_hours, outbox_event, conversation_participant_state) -- had RLS
--   DISABLED, so the restrictive organization policies added for them in
--   20260906120000 constrained nothing at all. A policy on a table with RLS off
--   is documentation, not a control.
--
-- WHAT RLS IS FOR HERE
--   It is the second layer, never the first. AuthorizationService decides; RLS
--   catches a service-layer bug -- a missing WHERE, an unscoped list, a new
--   endpoint that forgot -- by making the row invisible. It is never the reason
--   a request is ALLOWED.

-- ---------------------------------------------------------------------------
-- 1. Tenancy on the logs (TENANCY-MODEL.md M-1)
-- ---------------------------------------------------------------------------

do $mig$
declare t text;
begin
  foreach t in array array['event_log', 'audit_log', 'outbox_event', 'core_event'] loop
    if to_regclass('chat.' || quote_ident(t)) is null then continue; end if;

    if not exists (select 1 from information_schema.columns
                    where table_schema='chat' and table_name=t and column_name='organization_id') then
      execute format('alter table chat.%I add column organization_id uuid', t);
    end if;
    execute format('update chat.%I set organization_id = chat.default_organization_id()
                     where organization_id is null', t);
    execute format('alter table chat.%I alter column organization_id set default chat.default_organization_id()', t);
    execute format('alter table chat.%I alter column organization_id set not null', t);
    execute format('create index if not exists %I on chat.%I (organization_id)',
                   t || '_organization_idx', t);
  end loop;
end
$mig$;

-- The two logs are read through policies, so they take the same restrictive
-- isolation every root table carries. outbox_event and core_event are reachable
-- only by the service role and get the column for provenance, not for a policy.
drop policy if exists event_log_organization_isolation on chat.event_log;
create policy event_log_organization_isolation on chat.event_log
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

drop policy if exists audit_log_organization_isolation on chat.audit_log;
create policy audit_log_organization_isolation on chat.audit_log
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- ---------------------------------------------------------------------------
-- 2. RLS on, everywhere
-- ---------------------------------------------------------------------------
-- Every table in the schema, with no exception list. A table added later
-- without a policy is then invisible rather than world-readable, which is the
-- correct direction for a mistake to fail in.

do $rls$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'chat' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table chat.%I enable row level security', r.relname);
  end loop;
end
$rls$;

-- The tenant table itself: readable by anyone authenticated within it, written
-- by nobody through the API.
grant select on chat.organization to authenticated;
drop policy if exists organization_self on chat.organization;
create policy organization_self on chat.organization for select to authenticated
  using (id = chat.current_organization_id());

-- ---------------------------------------------------------------------------
-- 3. Membership and scope, in SQL
-- ---------------------------------------------------------------------------
-- These mirror AuthorizationService.canRead exactly. Where the two could drift,
-- db/tests/rls_scope_parity.sql and the unit scope matrix assert they do not.

create or replace function chat.is_live_member(p_conversation_id uuid, p_actor_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.conversation_member m
     where m.conversation_id = p_conversation_id
       and m.actor_id = p_actor_id
       and m.left_at is null)
$$;

-- The actor ids the current caller may act as. A caller is exactly one of
-- these; the union avoids three near-identical policies per table.
create or replace function chat.current_actor_ids()
returns setof uuid
language sql
stable
as $$
  select s.id from chat.staff s
   where s.account_id = chat.current_account_id() and s.is_active
  union
  select t.id from chat.teacher t
   where t.account_id = chat.current_account_id() and t.is_active
  union
  select c.id from chat.contact c
   where c.account_id = chat.current_account_id() and c.is_active
$$;

-- THE conversation predicate.
--
--   staff  -> the conversation's family is in their assignment scope, or they
--             are a live member (Teacher <-> Admin directs carry no family)
--   others -> live membership, and nothing else
--
-- A staff member with no assignments therefore sees no family conversation,
-- which is the whole of red-team A-1 / RT-011.
create or replace function chat.can_read_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from chat.conversation c
     where c.id = p_conversation_id
       and case
         -- No family to be in scope of (a Teacher <-> Admin direct). Membership
         -- is the only thing that can make such a channel someone's.
         when c.family_id is null then
           exists (select 1 from chat.current_actor_ids() a where chat.is_live_member(c.id, a))
         -- STAFF: scope, and scope alone. Membership deliberately does NOT
         -- rescue them -- a member row survives a reassignment (it is history,
         -- and the messages they wrote stay attributed), so allowing membership
         -- as an alternative would leave every previous supervisor reading the
         -- family for ever. This is the exact rule AuthorizationService.canRead
         -- applies.
         when chat.current_staff_id() is not null then
           chat.staff_in_scope(c.family_id)
         -- Contacts and teachers: live membership.
         else
           exists (select 1 from chat.current_actor_ids() a where chat.is_live_member(c.id, a))
       end)
$$;

comment on function chat.can_read_conversation is
  'The database half of AuthorizationService.canRead. Scope first, membership '
  'second; a family-facing role alone grants nothing.';

-- ---------------------------------------------------------------------------
-- 4. Communication policies
-- ---------------------------------------------------------------------------
-- Reads only. Every write on these tables goes through the API, which connects
-- as the service role for writes it has already authorized; granting INSERT to
-- `authenticated` would make RLS the decision point, which RLS-STRATEGY.md §2
-- explicitly refuses.

grant select on chat.conversation, chat.conversation_member, chat.message,
                chat.message_attachment, chat.message_reaction, chat.message_receipt,
                chat.message_hidden_for, chat.message_approval,
                chat.conversation_participant_state, chat.call, chat.call_participant,
                chat.notification, chat.device_token, chat.quiet_hours,
                chat.notification_template, chat.notification_rule
  to authenticated;

grant select, insert, update, delete on
  chat.conversation, chat.conversation_member, chat.message,
  chat.message_attachment, chat.message_reaction, chat.message_receipt,
  chat.message_hidden_for, chat.message_approval,
  chat.conversation_participant_state, chat.call, chat.call_participant,
  chat.notification, chat.notification_rule, chat.notification_template,
  chat.device_token, chat.quiet_hours, chat.outbox_event, chat.organization
  to service_role;

drop policy if exists conversation_readable_in_scope on chat.conversation;
create policy conversation_readable_in_scope on chat.conversation for select to authenticated
  using (chat.can_read_conversation(id));

drop policy if exists conversation_member_readable_in_scope on chat.conversation_member;
create policy conversation_member_readable_in_scope on chat.conversation_member
  for select to authenticated
  using (chat.can_read_conversation(conversation_id));

-- Internal notes are not merely hidden by a client: a contact or a teacher
-- cannot select the row at all.
drop policy if exists message_readable_in_scope on chat.message;
create policy message_readable_in_scope on chat.message for select to authenticated
  using (
    chat.can_read_conversation(conversation_id)
    and (visibility = 'customer' or chat.current_has_permission('messages.internal'))
  );

drop policy if exists message_attachment_readable on chat.message_attachment;
create policy message_attachment_readable on chat.message_attachment for select to authenticated
  using (exists (select 1 from chat.message m
                  where m.id = message_id
                    and chat.can_read_conversation(m.conversation_id)
                    and (m.visibility = 'customer'
                         or chat.current_has_permission('messages.internal'))));

drop policy if exists message_reaction_readable on chat.message_reaction;
create policy message_reaction_readable on chat.message_reaction for select to authenticated
  using (exists (select 1 from chat.message m
                  where m.id = message_id and chat.can_read_conversation(m.conversation_id)));

-- RT-012: the receipt roster is a list of who read what and when. A family
-- contact sees only their own; staff see the roster for conversations in scope.
drop policy if exists message_receipt_readable on chat.message_receipt;
create policy message_receipt_readable on chat.message_receipt for select to authenticated
  using (
    actor_id in (select a from chat.current_actor_ids() a)
    or (chat.current_staff_id() is not null
        and exists (select 1 from chat.message m
                     where m.id = message_id and chat.can_read_conversation(m.conversation_id)))
  );

drop policy if exists message_hidden_for_own on chat.message_hidden_for;
create policy message_hidden_for_own on chat.message_hidden_for for select to authenticated
  using (actor_id in (select a from chat.current_actor_ids() a));

drop policy if exists conversation_participant_state_own on chat.conversation_participant_state;
create policy conversation_participant_state_own on chat.conversation_participant_state
  for select to authenticated
  using (actor_id in (select a from chat.current_actor_ids() a));

-- A-2: the moderation queue was globally visible. It is now the queue for
-- conversations in scope, and nothing else.
drop policy if exists message_approval_readable_in_scope on chat.message_approval;
create policy message_approval_readable_in_scope on chat.message_approval
  for select to authenticated
  using (chat.can_read_conversation(conversation_id));

drop policy if exists call_readable_in_scope on chat.call;
create policy call_readable_in_scope on chat.call for select to authenticated
  using (chat.can_read_conversation(conversation_id));

drop policy if exists call_participant_readable_in_scope on chat.call_participant;
create policy call_participant_readable_in_scope on chat.call_participant
  for select to authenticated
  using (exists (select 1 from chat.call c
                  where c.id = call_id and chat.can_read_conversation(c.conversation_id)));

-- Notifications and devices are addressed to a person. Nobody reads another
-- person's, including a manager: a notification carries message content.
drop policy if exists notification_own on chat.notification;
create policy notification_own on chat.notification for select to authenticated
  using (recipient_id in (select a from chat.current_actor_ids() a));

drop policy if exists device_token_own on chat.device_token;
create policy device_token_own on chat.device_token for select to authenticated
  using (actor_id in (select a from chat.current_actor_ids() a));

drop policy if exists quiet_hours_own on chat.quiet_hours;
create policy quiet_hours_own on chat.quiet_hours for select to authenticated
  using (actor_id in (select a from chat.current_actor_ids() a));

drop policy if exists notification_template_readable on chat.notification_template;
create policy notification_template_readable on chat.notification_template
  for select to authenticated using (true);
drop policy if exists notification_rule_readable on chat.notification_rule;
create policy notification_rule_readable on chat.notification_rule
  for select to authenticated using (true);

-- outbox_event has no policy for `authenticated`: it is system plumbing, drained
-- by the worker as the service role, and nothing a user does should read it.

-- ---------------------------------------------------------------------------
-- 5. Staff, teacher and account visibility
-- ---------------------------------------------------------------------------

drop policy if exists staff_readable_by_staff on chat.staff;
create policy staff_readable_by_staff on chat.staff for select to authenticated
  using (chat.current_staff_id() is not null
         and organization_id = chat.current_organization_id());

drop policy if exists staff_managed_by_manager on chat.staff;
create policy staff_managed_by_manager on chat.staff for update to authenticated
  using (chat.is_manager() or id = chat.current_staff_id())
  with check (chat.is_manager() or id = chat.current_staff_id());

-- A teacher row is a name and an activity flag; a supervisor needs to render
-- the group roster. It carries no contact channel, by construction.
drop policy if exists teacher_readable on chat.teacher;
create policy teacher_readable on chat.teacher for select to authenticated
  using (organization_id = chat.current_organization_id());

-- chat.account, chat.account_credential, chat.session, chat.device and
-- chat.account_token deliberately have NO policy for `authenticated` and no
-- grant. Credentials and sessions are unreadable by construction rather than by
-- a policy that could be widened.

-- ---------------------------------------------------------------------------
-- 6. The two connection roles (RLS-STRATEGY.md §3)
-- ---------------------------------------------------------------------------
-- chat_app runs the request path and MUST NOT bypass RLS. chat_service runs the
-- worker, migrations and ingestion, and does. Both are created NOLOGIN here;
-- deployment grants LOGIN and a password from the secret store, so a migration
-- never contains a credential.

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'chat_app') then
    create role chat_app nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'chat_service') then
    create role chat_service nologin noinherit bypassrls;
  end if;
end
$roles$;

grant authenticated to chat_app;
grant service_role  to chat_service;

comment on role chat_app is
  'API request path. NOBYPASSRLS: every request runs with the actor context set '
  'by PrismaService.withActor(), so a service-layer scope bug is caught by the '
  'database instead of leaking.';
comment on role chat_service is
  'Worker, migrations and Core ingestion. Acts for the system, never for a user.';

-- ---------------------------------------------------------------------------
-- 7. Readiness
-- ---------------------------------------------------------------------------
-- RLS-STRATEGY.md §7 acceptance item 1: the readiness probe must be able to
-- state whether the connected role bypasses RLS.

create or replace function chat.connection_bypasses_rls()
returns boolean
language sql
stable
as $$ select rolbypassrls from pg_roles where rolname = current_user $$;

grant execute on function chat.connection_bypasses_rls() to authenticated, service_role;
