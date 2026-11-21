-- Roll back 20261121140000_chat_pd059_sales_no_accounts_administer (PD-59).
--
-- Gives the Sales manager and Sales supervisors accounts.administer back, exactly as 20261027190000
-- seeded it. Roll back the API with it (legacy-bundles.ts and account-admin-policy.ts): the database
-- mirror must equal the TypeScript bundles or pd040-access-roles.spec.ts fails.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261121140000_chat_pd059_sales_no_accounts_administer.down.sql
--
-- Then delete the ledger row: delete from chat.schema_migrations where version =
-- '20261121140000_chat_pd059_sales_no_accounts_administer';

select set_config('chat.pd040_catalogue_change', 'on', true);

insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'sales', 'accounts.administer'),
  ('supervisor', 'sales', 'accounts.administer')
on conflict do nothing;

select set_config('chat.pd040_catalogue_change', 'off', true);
