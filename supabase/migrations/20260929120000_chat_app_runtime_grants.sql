-- Least-privilege runtime grants for the API connection role.
--
-- WHY THIS EXISTS
-- ---------------
-- `chat_app` was created by 20260910120200 as "the API request path", and then
-- never granted anything. `chat.account` in particular had no grant to any role
-- at all -- not to `authenticated`, not to `service_role`, not to `chat_app` --
-- so the very first statement of every login (`select ... from chat.account
-- where subject = $1`) failed with 42501 for any non-owner connection. The
-- consequence was that the only identity the API could run as was the DATABASE
-- OWNER, which is a superuser-shaped role that bypasses row-level security and
-- can drop the schema it serves. A deployment cannot honestly be called
-- least-privileged while that is its runtime identity.
--
-- This migration enumerates exactly what the request path touches, and grants
-- exactly that. Nothing here is `grant all`, nothing here is `all tables in
-- schema`, and no role gains an attribute: `chat_app` remains NOBYPASSRLS and
-- owns nothing.
--
-- GRANTED TO chat_app DIRECTLY, NOT TO `authenticated`
-- ----------------------------------------------------
-- `authenticated` is the role the RLS policies are written against, and it is a
-- NOLOGIN group that `chat_app` inherits. Widening `authenticated` would widen
-- every future member of it, and 20260910120100 deliberately gives it nothing
-- on the credential tables. So the privileges the CONNECTION needs are attached
-- to the connection role, and the policy target keeps the meaning it was given.
-- `chat_app` still inherits `authenticated`, so the policies still apply to it.
--
-- WHAT chat_app CAN DO, AND CANNOT
-- --------------------------------
-- CAN: the DML enumerated below, and only in the directions the API uses it.
-- Together with the four story tables granted by 20260928120000 that comes to
-- 37 tables and 79 privileges, asserted by
-- `test/integration/runtime-role-grants.spec.ts` so that a later `grant all`
-- fails a build instead of passing a review.
--
-- CANNOT: create, alter or drop anything; TRUNCATE anything; reference or add
-- triggers to anything; touch the nine tables in this schema it never uses
-- (`task`, `subscription`, `family_note`, `family_state_cache`, `core_event`,
-- `core_parent_inbox`, `sync_state`, `handoff`, `schema_migrations`); DELETE
-- from anything except `message_reaction`, which is the one row a user
-- genuinely removes rather than tombstones; UPDATE `event_log` or `audit_log`,
-- which are append-only by design and whose triggers enforce it regardless; or
-- bypass row-level security, which is a role attribute it does not have and
-- this migration does not confer.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- -------------------------------
-- It does NOT make the API able to run as `chat_app` today, and it must not be
-- read as claiming so. Row-level security is enabled on most of this schema and
-- every policy on it is written for staff (`chat.staff_can_see_family`,
-- `chat.current_staff_id`) under a per-request actor context that no code sets;
-- a parent-authenticated connection therefore sees zero rows even WITH these
-- grants. Closing that is RLS-STRATEGY section 7 "Phase 1" -- per-request
-- context plus a family-facing policy set -- and it is tracked as the remaining
-- P0. This migration removes the half of the blocker that is a missing grant,
-- so that when the policies land the role is already shaped correctly.
--
-- BACKWARD COMPATIBLE: additive only. It adds privileges to one role that
-- previously had none, and changes no schema, no data and no existing grant.

-- The schema itself. Without USAGE, every grant below is unreachable.
grant usage on schema chat to chat_app;

-- ---------------------------------------------------------------------------
-- Identity and session (src/platform/auth)
-- ---------------------------------------------------------------------------
-- The login path: find the account, verify against its credential, record the
-- attempt, mint a session, remember the device.
--
-- account_credential is the sensitive one and is deliberately the narrowest:
-- select and update only. The API must read the hash to verify it and must
-- update the failed-attempt counter and lockout; it never creates or deletes a
-- credential, because provisioning is not a request-path operation.
grant select, update         on chat.account            to chat_app;
grant select, update         on chat.account_credential to chat_app;
grant select, insert, update on chat.session            to chat_app;
grant select, insert, update on chat.device             to chat_app;

-- ---------------------------------------------------------------------------
-- Principals (read-only)
-- ---------------------------------------------------------------------------
-- Resolving who the caller is, and naming the people they are already allowed
-- to see. The request path never writes a principal: staff, teachers, contacts
-- and learners are the academy's records, maintained by Admin Web and by Core
-- ingestion, not by anything a chat request can reach.
grant select on chat.staff        to chat_app;
grant select on chat.teacher      to chat_app;
grant select on chat.contact      to chat_app;
grant select on chat.family       to chat_app;
grant select on chat.learner      to chat_app;
grant select on chat.organization to chat_app;

-- The coverage engine. `chat.on_duty()` is not SECURITY DEFINER, so the caller
-- reads these itself to answer "who is on duty for this family right now".
grant select on chat.shift         to chat_app;
grant select on chat.absence       to chat_app;
grant select on chat.coverage_rule to chat_app;

-- ---------------------------------------------------------------------------
-- Conversations and messages (src/communication)
-- ---------------------------------------------------------------------------
-- No DELETE anywhere here on purpose. Deletion in this product is a tombstone:
-- `deleted_for_all` on the message, a row in `message_hidden_for` for delete
-- for-me, `left_at` on a membership. Nothing is removed, so nothing needs the
-- privilege to remove it, and a bug that tried would be refused by the database
-- rather than by a code review.
grant select, insert, update on chat.conversation                   to chat_app;
grant select, insert, update on chat.conversation_member            to chat_app;
grant select, insert, update on chat.conversation_participant_state to chat_app;
grant select, insert, update on chat.message                        to chat_app;
grant select, insert         on chat.message_attachment             to chat_app;
grant select, insert, update on chat.message_receipt                to chat_app;
grant select, insert         on chat.message_hidden_for             to chat_app;
grant select, insert, update on chat.message_approval               to chat_app;

-- The single exception to "no DELETE": removing your own reaction genuinely
-- removes it. There is no tombstone for an emoji and no audit interest in one.
grant select, insert, delete on chat.message_reaction to chat_app;

-- ---------------------------------------------------------------------------
-- Calls, stories, notifications
-- ---------------------------------------------------------------------------
grant select, insert, update on chat.call             to chat_app;
grant select, insert, update on chat.call_participant to chat_app;

-- Stories are already granted to chat_app by 20260928120000 (select, insert,
-- update on all four tables) -- the only part of this schema that was. Nothing
-- is repeated here, so this file does not appear to tighten or widen a grant it
-- did not make. The API needs no UPDATE on story_audience, story_recipient or
-- story_view; narrowing what that migration gave is a separate change and is
-- recorded rather than smuggled in here.

grant select, insert, update on chat.notification       to chat_app;
grant select                 on chat.notification_rule     to chat_app;
grant select                 on chat.notification_template to chat_app;
grant select, insert, update on chat.device_token         to chat_app;
grant select                 on chat.quiet_hours          to chat_app;

-- ---------------------------------------------------------------------------
-- Outbox and configuration
-- ---------------------------------------------------------------------------
-- The API enqueues; the worker drains, and the worker connects as
-- `chat_service`. Both need the table, for different halves of its life.
grant select, insert, update on chat.outbox_event to chat_app;
grant select                 on chat.config       to chat_app;

-- ---------------------------------------------------------------------------
-- Append-only logs
-- ---------------------------------------------------------------------------
-- INSERT and SELECT, never UPDATE and never DELETE. `chat.forbid_mutation()`
-- already refuses an amendment at the trigger; withholding the privilege means
-- a caller cannot even attempt one, which is the difference between an
-- invariant that is enforced and one that is merely checked.
grant select, insert on chat.event_log to chat_app;
grant select, insert on chat.audit_log to chat_app;

comment on schema chat is
  'Jawwid Chat. Runtime DML for the API is granted to chat_app by '
  '20260929120000_chat_app_runtime_grants.sql; chat_app is NOBYPASSRLS and owns nothing.';
