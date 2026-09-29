-- ---------------------------------------------------------------------------
-- chat.mark_core_event_processed is not an end-user function.
--
-- THE PATH BEING CLOSED
--
-- The ledger claim is now part of the same transaction as the projection and
-- the outbox (20260929093000 made the ordering atomic; the application made the
-- claim atomic). A Core event therefore cannot become durably processed unless
-- the work it authorises committed with it.
--
-- One path sat outside that guarantee. `chat.mark_core_event_processed` was
-- created in 20260905090900 with no explicit ACL, which in PostgreSQL means
-- IMPLICIT PUBLIC EXECUTE -- measured on a migrated database as:
--
--     proacl = NULL   ->   authenticated = t, anon = t, service_role = t
--
-- Its body is an unguarded
--
--     update chat.core_event set processed_at = now(), error = p_error
--      where source = ... and external_event_id = ...
--
-- with no `processed_at is null` predicate, no projection and no outbox. A
-- single call would recreate exactly the state the atomicity work removed: an
-- event durably marked processed with no Chat projection, which Core's retry
-- then sees as a duplicate, drain() skips (it filters on processed_at is null),
-- and no sweeper recovers. Silent, permanent loss of a class session or an
-- attendance fact.
--
-- WHY REVOKE AND NOT DROP
--
-- Nothing in apps/, test/ or scripts/ calls it -- but docs/recovery and
-- docs/product-operations both describe it as part of the integration boundary
-- and mark it KEEP. Dropping a function another document still names is a
-- larger decision than this fix needs, and the privilege is the whole risk.
-- The function stays; nobody who is not the owner may execute it.
--
-- service_role is INCLUDED in the revoke. It is the role the API runs as, and
-- the API is precisely the component the atomic claim constrains; leaving the
-- bypass executable by it would defeat the point. Nothing calls the function,
-- so no application behaviour changes.
--
-- Revoking from PUBLIC alone would be enough today (the grants are implicit),
-- but the named roles are revoked explicitly as well so that a later migration
-- re-granting to PUBLIC, or an explicit grant to one of these roles, does not
-- quietly reopen the path. Repeating a revoke is a no-op, so this is idempotent.
--
-- No table, no data, no index, no function body is touched.
-- ---------------------------------------------------------------------------

revoke all on function chat.mark_core_event_processed(text, text, text) from public;
revoke all on function chat.mark_core_event_processed(text, text, text) from authenticated;
revoke all on function chat.mark_core_event_processed(text, text, text) from anon;
revoke all on function chat.mark_core_event_processed(text, text, text) from service_role;

comment on function chat.mark_core_event_processed(text, text, text) is
  'Owner-only. Marking a Core event processed outside the atomic claim + '
  'projection + outbox transaction recreates the permanent-loss state that '
  'transaction exists to prevent. Not executable by service_role, authenticated '
  'or anon; see 20260929120000.';
