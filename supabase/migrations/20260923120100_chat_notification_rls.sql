-- Jawwid Chat -- row level security for the notification platform.
--
-- WHY THIS IS A SEPARATE MIGRATION AND WHY IT IS OVERDUE
-- -----------------------------------------------------
-- 20260905091200_chat_rls.sql runs BEFORE 20260905093000_chat_communication.sql
-- creates chat.notification, chat.device_token and chat.quiet_hours. Those
-- tables have therefore had no row level security at all since they were
-- created. The API connects as its own role and enforces authorization in
-- AuthorizationService, so nothing was exposed in practice -- but "the only
-- thing standing between one family and another is application code" is not a
-- posture this product accepts anywhere else, and it must not accept it for a
-- table whose rows say what is happening to a named child.
--
-- THE MODEL, unchanged from 091200:
--   staff            have a chat.staff row and reach tables directly, narrowed
--                    by policy.
--   family contacts  and teachers reach only their OWN rows.
--   service_role     is NOLOGIN BYPASSRLS; the worker acts for the system.
--
-- Notifications are strictly personal. There is no "my family's notifications"
-- policy and there must not be one: a notification is addressed to one actor.

-- ---------------------------------------------------------------------------
-- Who is calling, as an ACTOR
-- ---------------------------------------------------------------------------
-- chat.current_staff_id() answers this for staff only. A notification's
-- recipient_id may be a staff id, a contact id or a teacher id, so the policies
-- below need the actor behind the account whichever kind it is.
--
-- SECURITY DEFINER because it reads chat.staff / chat.contact / chat.teacher,
-- each of which has (or will have) its own policy that would otherwise be
-- evaluated as the caller -- the same recursion 20260905091300 solved for the
-- staff helpers. It answers only "which actor is the caller", which exposes
-- nothing the caller does not already know about themselves.

create or replace function chat.current_actor_id()
returns uuid
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select s.id from chat.staff s
      where s.account_id = chat.current_account_id() and s.is_active and s.left_at is null),
    (select c.id from chat.contact c
      where c.account_id = chat.current_account_id() and c.is_active),
    (select t.id from chat.teacher t
      where t.account_id = chat.current_account_id() and t.is_active and t.left_at is null),
    nullif(current_setting('chat.actor_id', true), '')::uuid
  )
$$;

comment on function chat.current_actor_id() is
  'The actor behind the current account, whichever kind it is. The session '
  'override exists for the worker and for integration harnesses, mirroring '
  'chat.current_staff_id().';

-- ---------------------------------------------------------------------------
-- chat.notification -- you see your own, and only your own
-- ---------------------------------------------------------------------------

alter table chat.notification             enable row level security;
alter table chat.notification_delivery    enable row level security;
alter table chat.notification_preference  enable row level security;
alter table chat.notification_category    enable row level security;
alter table chat.device_token             enable row level security;
alter table chat.quiet_hours              enable row level security;
alter table chat.announcement             enable row level security;

grant select, update on chat.notification to authenticated;
grant select on chat.notification_delivery, chat.notification_category to authenticated;
grant select, insert, update, delete on chat.notification_preference to authenticated;
grant select, insert, update, delete on chat.device_token to authenticated;
grant select, insert, update on chat.quiet_hours to authenticated;
grant select on chat.announcement to authenticated;

-- Deliberately NO insert grant on chat.notification. A client cannot create a
-- notification, for itself or for anybody else: notifications are produced by
-- the engine from system events, and a client that could write one could
-- impersonate the academy.
--
-- Deliberately NO delete grant either. History is not the recipient's to erase;
-- retention is a policy the system applies (see 20260923120200).

drop policy if exists notification_own_read on chat.notification;
create policy notification_own_read on chat.notification
  for select to authenticated
  using (recipient_id = chat.current_actor_id());

-- The ONE thing a recipient may change about their own notification: whether
-- they have read or opened it. WITH CHECK re-asserts ownership so an UPDATE
-- cannot hand the row to somebody else.
drop policy if exists notification_own_read_state on chat.notification;
create policy notification_own_read_state on chat.notification
  for update to authenticated
  using (recipient_id = chat.current_actor_id())
  with check (recipient_id = chat.current_actor_id());

comment on policy notification_own_read_state on chat.notification is
  'Column-level privilege, not this policy, is what limits the update to '
  'read_at/opened_at: see the REVOKE + column GRANT below. A policy cannot '
  'restrict which columns change.';

-- A recipient may mark their own notification read or opened, and nothing else.
-- Without this, notification_own_read_state would let them rewrite their own
-- notification's title, priority or deep link.
revoke update on chat.notification from authenticated;
grant update (read_at, opened_at, status, delivered_at) on chat.notification to authenticated;

-- ---------------------------------------------------------------------------
-- Deliveries -- readable, never writable
-- ---------------------------------------------------------------------------
-- A recipient may see that a push failed. They may not edit delivery history:
-- it is the operational record support reads back, and a self-reported
-- "delivered" that the client can forge is worse than no record at all.
-- Client-reported delivery goes through POST /notifications/:id/delivered,
-- which the service writes as the system.

drop policy if exists notification_delivery_own_read on chat.notification_delivery;
create policy notification_delivery_own_read on chat.notification_delivery
  for select to authenticated
  using (recipient_id = chat.current_actor_id());

-- ---------------------------------------------------------------------------
-- Preferences, devices, quiet hours -- yours, fully
-- ---------------------------------------------------------------------------

drop policy if exists notification_preference_own on chat.notification_preference;
create policy notification_preference_own on chat.notification_preference
  for all to authenticated
  using (actor_id = chat.current_actor_id())
  with check (actor_id = chat.current_actor_id());

drop policy if exists notification_category_readable on chat.notification_category;
create policy notification_category_readable on chat.notification_category
  for select to authenticated
  using (true);

-- A device token is a routing address for one actor. Another actor must not be
-- able to read it (it would let them see how many devices someone has) or
-- register one against somebody else's id (it would redirect their pushes).
drop policy if exists device_token_own on chat.device_token;
create policy device_token_own on chat.device_token
  for all to authenticated
  using (actor_id = chat.current_actor_id())
  with check (actor_id = chat.current_actor_id());

drop policy if exists quiet_hours_own on chat.quiet_hours;
create policy quiet_hours_own on chat.quiet_hours
  for all to authenticated
  using (actor_id = chat.current_actor_id())
  with check (actor_id = chat.current_actor_id());

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
-- A parent never reads chat.announcement to find out about an announcement --
-- they read their own notification, which carries the rendered text. This
-- policy exists for the deep link: tapping the notification opens the
-- announcement, and that read must be authorized in the database rather than
-- by the fact that they happened to have the id.
--
-- Only a PUBLISHED, in-window announcement is readable. A draft is invisible;
-- an expired one is invisible; and neither is decided by the client.

drop policy if exists announcement_published_read on chat.announcement;
create policy announcement_published_read on chat.announcement
  for select to authenticated
  using (
    status = 'published'
    and publish_at <= now()
    and (expires_at is null or expires_at > now())
    -- and the caller is actually in the audience
    and exists (
      select 1 from chat.notification n
      where n.announcement_id = chat.announcement.id
        and n.recipient_id = chat.current_actor_id()
    )
  );

comment on policy announcement_published_read on chat.announcement is
  'Membership of the audience is proved by the notification row the fan-out '
  'created, not by target_type/target_ids. Reading the targeting of an '
  'announcement would tell a parent which other families were addressed.';

-- Staff who may act on the academy's behalf manage announcements. Writing one
-- is an admin/manager act; the urgent-priority guard in 20260923120000 narrows
-- it further and is enforced by trigger regardless of role here.
grant insert, update on chat.announcement to authenticated;

drop policy if exists announcement_staff_read on chat.announcement;
create policy announcement_staff_read on chat.announcement
  for select to authenticated
  using (chat.current_staff_role() in ('admin', 'manager', 'coverage'));

drop policy if exists announcement_staff_write on chat.announcement;
create policy announcement_staff_write on chat.announcement
  for insert to authenticated
  with check (
    chat.current_staff_role() in ('admin', 'manager')
    and created_by = chat.current_staff_id()
  );

drop policy if exists announcement_staff_update on chat.announcement;
create policy announcement_staff_update on chat.announcement
  for update to authenticated
  using (chat.current_staff_role() in ('admin', 'manager'))
  with check (chat.current_staff_role() in ('admin', 'manager'));

-- ---------------------------------------------------------------------------
-- Tenant isolation -- RESTRICTIVE, ANDed with everything above
-- ---------------------------------------------------------------------------
-- Same shape as 20260906120000: a NULL organization means "see nothing".

do $rls$
declare
  t text;
begin
  foreach t in array array['notification', 'announcement', 'notification_category'] loop
    execute format('drop policy if exists %I on chat.%I', t || '_organization_isolation', t);
    execute format(
      'create policy %I on chat.%I as restrictive to authenticated, service_role '
      'using (organization_id = chat.current_organization_id()) '
      'with check (organization_id = chat.current_organization_id())',
      t || '_organization_isolation', t);
  end loop;
end;
$rls$;
