-- =============================================================================
-- PD-59 · A Sales member does not administer family login accounts
--
-- Owner decision 2026-11-21: a Sales representative has no accounts.administer
-- access to converted families merely because they originally owned the lead;
-- family login administration (reset password, devices, sessions) stays with
-- Operations and the super admin. The Sales manager's access was reviewed
-- separately and is removed too: docs/admin/pd059-sales-accounts-administer.md.
--
-- The TypeScript bundles (apps/api/src/platform/permissions/legacy-bundles.ts)
-- and chat.legacy_permission_bundle agree row for row (PD-40, tested by
-- pd040-access-roles.spec.ts and pd040-catalogue-seed.spec.ts), so the two
-- Sales rows seeded by 20261027190000 are removed here. 20261027190000 is
-- frozen: its generated block keeps inserting them and this one deletes them.
--
-- Data only: two rows. No table, column, function or policy changes. Idempotent:
-- applying it again deletes nothing. A staff member's permissions are read from
-- the bundle on every call, so there is nothing to backfill.
-- Rollback: db/rollback/20261121140000_chat_pd059_sales_no_accounts_administer.down.sql
-- =============================================================================

select set_config('chat.pd040_catalogue_change', 'on', true);

-- BEGIN GENERATED pd059acct catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
delete from chat.legacy_permission_bundle where (tier, department_kind, permission_key) in (
  ('manager', 'sales', 'accounts.administer'),
  ('supervisor', 'sales', 'accounts.administer')
);
-- END GENERATED pd059acct catalogue rows

select set_config('chat.pd040_catalogue_change', 'off', true);
