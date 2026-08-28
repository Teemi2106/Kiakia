-- 0034_fix_missing_table_grants.sql fixed the missing anon/authenticated
-- baseline but missed that `service_role` had the exact same problem:
-- `rolbypassrls = true` only skips RLS *policies* — it does not exempt a
-- role from needing the base table GRANT, and this project's `service_role`
-- had zero grants on any table, same as anon/authenticated did. This is
-- what createAdminClient() (lib/supabase/admin.ts) uses everywhere it's
-- meant to bypass RLS entirely (vendor earnings/dashboard, admin actions,
-- vendor settings) — every one of those reads/writes was failing with
-- "permission denied" too.

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select, update on sequences to service_role;
