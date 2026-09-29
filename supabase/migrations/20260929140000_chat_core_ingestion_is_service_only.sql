-- ---------------------------------------------------------------------------
-- Core ingestion functions are service-only, like their class siblings.
--
-- 20260924090000 locked the class/attendance projections down correctly:
--
--     ingest_core_class_session   public=f auth=f anon=f svc=t
--     cancel_core_class_session   public=f auth=f anon=f svc=t
--     ingest_core_attendance      public=f auth=f anon=f svc=t
--
-- The three identity-mirroring ingestion functions from 20260905090900 never
-- got the same treatment. Measured on a migrated database they are:
--
--     ingest_core_learner         public=t auth=t anon=t svc=t
--     ingest_core_parent          public=t auth=t anon=t svc=t
--     ingest_core_subscription    public=t auth=t anon=t svc=t
--
-- WHY THIS MATTERS FOR CLASS NOTIFICATIONS
--
-- `ingest_core_learner` upserts chat.learner ON CONFLICT (core_child_id), and
-- core_child_id is exactly what the class projection resolves a family through:
--
--     select id into v_learner_id from chat.learner where core_child_id = ...
--
-- So an end-user role able to execute it could point a learner row at another
-- family and redirect that learner's class-session and attendance
-- notifications. The ordering and atomicity work says nothing about this; it is
-- a privilege gap, and it is the same shape as the one 20260929120000 closed.
--
-- WHAT CHANGES
--
-- EXECUTE is withdrawn from public, authenticated and anon. service_role KEEPS
-- it: these are real ingestion functions that a later Core phase will call for
-- parent/learner/subscription events, exactly as the class functions are called
-- today. Nothing in apps/ calls them yet (measured: 0 references), and no other
-- database function calls them, so no behaviour changes.
--
-- The grant to service_role is explicit rather than left implicit, because
-- `revoke ... from public` also removes the privilege service_role was relying
-- on implicitly.
--
-- No table, no data, no index, no function body is touched.
-- ---------------------------------------------------------------------------

revoke all on function chat.ingest_core_learner(jsonb)      from public, authenticated, anon;
revoke all on function chat.ingest_core_parent(jsonb)       from public, authenticated, anon;
revoke all on function chat.ingest_core_subscription(jsonb) from public, authenticated, anon;

grant execute on function chat.ingest_core_learner(jsonb)      to service_role;
grant execute on function chat.ingest_core_parent(jsonb)       to service_role;
grant execute on function chat.ingest_core_subscription(jsonb) to service_role;
