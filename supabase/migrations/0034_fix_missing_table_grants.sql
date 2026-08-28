-- Every prior migration's `revoke insert, update, delete on <table> from
-- authenticated` (0007, 0019, 0022, 0024, 0026, ...) was written assuming
-- the Supabase-standard baseline already existed: `anon`/`authenticated`
-- get full SELECT/INSERT/UPDATE/DELETE on every `public` table by default,
-- narrowed from there by explicit revokes plus RLS policies. This project
-- never actually had that baseline — `information_schema.role_table_grants`
-- shows zero grants to `anon`/`authenticated` on any table, and
-- `pg_default_acl` has no rule for schema `public` at all. Every RLS
-- policy in this codebase has therefore been unreachable: PostgREST always
-- needs the base table grant *and* a passing RLS policy, and every direct
-- client query (`supabase.from(...)`) has been failing with "permission
-- denied" since project inception, silently, because the app's own
-- Supabase wrapper calls treat a query error as empty data rather than
-- surfacing it. SECURITY DEFINER RPCs (place_order, transition_order, ...)
-- were unaffected — they run as the function owner, not the caller — which
-- is exactly why those flows appeared to work while direct-table reads
-- (getRoles(), the profile name save, cart/address writes) silently did
-- not.
--
-- Fix: restore the missing baseline, including `alter default privileges`
-- so a future migration that adds a table without an explicit grant gets
-- the same safety net every other Supabase project has out of the box.
-- Then re-apply every narrowing revoke already established by 0006-0032,
-- verbatim, so the net effect matches what each one already intended.

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;

-- 0006_transition_order.sql: reference table read only by the
-- SECURITY DEFINER transition_order() function — no direct client access.
revoke all on order_status_transitions from public, authenticated, anon;

-- 0007_rls.sql: writes to identity/catalog/order tables go through
-- SECURITY DEFINER RPCs or an admin-client Server Action, never a direct
-- authenticated-role write.
revoke insert, delete on profiles from authenticated;
revoke insert, update, delete on user_roles from authenticated;
revoke insert, update, delete on riders from authenticated;
revoke insert, update, delete on service_areas from authenticated;
revoke insert, update, delete on vendors from authenticated;
revoke insert, update, delete on vendor_staff from authenticated;
revoke insert, update, delete on menu_categories from authenticated;
revoke insert, update, delete on menu_items from authenticated;
revoke insert, update, delete on option_groups from authenticated;
revoke insert, update, delete on options from authenticated;
revoke insert, update, delete on orders from authenticated;
revoke insert, update, delete on order_items from authenticated;
revoke insert, update, delete on order_events from authenticated;
-- Ledger tables are walled off from both roles outright — read only
-- through admin-client Server Actions (e.g. the vendor earnings page).
revoke all on accounts, transactions, ledger_entries, payments from authenticated, anon;

-- 0019_rider_dispatch.sql / 0026_rider_self_service.sql: dispatch and
-- rider-location rows are written only through their SECURITY DEFINER
-- RPCs (accept/decline_dispatch_offer, update_rider_location).
revoke insert, update, delete on dispatch_offers from authenticated;
revoke insert, update, delete on order_rider_locations from authenticated;

-- 0022_delivery_code_off_orders.sql: the delivery code is written once by
-- place_order() and read only by the customer via RLS.
revoke insert, update, delete on order_delivery_codes from authenticated;

-- 0024_lock_down_account_balances_view.sql: security_invoker view over
-- the ledger tables above — must stay walled off the same way.
revoke all on account_balances from anon, authenticated;
