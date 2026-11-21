-- Roll back 20261121120000_chat_pd059_sales_prospect_ids_owner (PD-59).
--
-- Restores chat.sales_prospect_ids to 20261031190000's body: every prospect with a lesson in the
-- window, for any Sales member. A representative can then again record about another
-- representative's trial family at the database. Roll back the application only if it needs the
-- wide rule.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261121120000_chat_pd059_sales_prospect_ids_owner.down.sql
--
-- Then delete the ledger row: delete from chat.schema_migrations where version =
-- '20261121120000_chat_pd059_sales_prospect_ids_owner';

create or replace function chat.sales_prospect_ids(p_staff uuid, p_at timestamptz default now())
returns setof uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select distinct le.prospect_id
    from chat.lesson le
    join chat.staff s on s.id = p_staff and s.organization_id = le.organization_id
   where chat.sales_basis(p_staff) is not null
     and le.prospect_id is not null
     and le.starts_at >= p_at - chat.operations_lesson_window();
$$;

-- 20261031190000 defined this function without a comment.
comment on function chat.sales_prospect_ids(uuid, timestamptz) is null;
