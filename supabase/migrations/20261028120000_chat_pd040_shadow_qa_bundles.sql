-- =============================================================================
-- PD-40 · legacy-bundle rows from the shadow QA pass (2026-10-28)
--
-- The system-test QA pass ran every parameter-free Admin Web GET per seeded
-- persona with PermissionGuard in shadow mode (main a547b0e2). Three bundles
-- lacked a key for a route their service serves today; enforcing would have
-- refused them. Decided route by route in docs/product/pd040-admin-accounts-plan.md
-- §14 and pinned by test/unit/authorization/pd040-shadow-qa.spec.ts:
--
--   manager / supervisor of Sales   lessons.view  GET /courses, /lessons, /correction-requests
--                                   cases.view    GET /cases (empty for Sales today)
--   supervisor of Teachers          reports.view  GET /stats/teachers (StatsService.isStatsReader)
--
-- The catalogue and the bundles change only by migration: this transaction
-- opens chat.pd040_catalogue_change for its own writes. The rows are generated
-- from legacy-bundles.ts by pd040-catalogue-seed.spec.ts.
-- =============================================================================

select set_config('chat.pd040_catalogue_change', 'on', true);

-- BEGIN GENERATED pd040qa catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'sales', 'cases.view'),
  ('manager', 'sales', 'lessons.view'),
  ('supervisor', 'teachers', 'reports.view'),
  ('supervisor', 'sales', 'cases.view'),
  ('supervisor', 'sales', 'lessons.view');
-- END GENERATED pd040qa catalogue rows

select set_config('chat.pd040_catalogue_change', 'off', true);
