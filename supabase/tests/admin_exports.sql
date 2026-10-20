-- pgTAP: the audited CSV export RPCs (0088_admin_exports.sql).
--
-- What this protects:
-- (1) WHO. Both RPCs are service_role only, and each re-checks the actor in SQL:
--     'admin' for an orders export, 'finance' (superadmin or admin+finance) for
--     the ledger, on every ledger page as well as on the audit call, so a
--     caller that skips admin_log_export() still cannot read the ledger.
-- (2) AUDIT. A successful admin_log_export() writes exactly one row (action
--     export.<kind>, target_type 'export', target_id = the returned id) and the
--     details carry only whitelisted keys; a refused call writes none. The log
--     stays append-only with the widened target_type check.
-- (3) PAGING. admin_export_ledger_page() and admin_export_orders_page() are
--     strict keysets on (created_at, id): rows strictly after the cursor (ties
--     on created_at broken by id), never repeated or skipped; p_limit is
--     clamped to 1..2000. The orders page also filters by status / vendor and
--     returns the vendor name from a join.
--
-- Fixture isolation: every ledger fixture is dated in 2020 (orders: 2021) and addressed by a
-- narrow [from, to) window, and the audit assertions filter on this file's
-- actors, so rows that already exist cannot change a result. The ledger
-- balance trigger is DEFERRED to COMMIT and this script never commits, so the
-- bulk fixture does not need to be balanced.

begin;
select plan(75);

-- ---------------------------------------------------------------------------
-- Fixtures (written as the owner, before any role is assumed).
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('ex_admin');
select tests.create_supabase_user('ex_finance');
select tests.create_supabase_user('ex_super');
select tests.create_supabase_user('ex_suspended');
select tests.create_supabase_user('ex_customer');

insert into user_roles (user_id, role) values
  (tests.get_supabase_uid('ex_admin'), 'admin'),
  (tests.get_supabase_uid('ex_finance'), 'admin'),
  (tests.get_supabase_uid('ex_finance'), 'finance'),
  (tests.get_supabase_uid('ex_super'), 'superadmin'),
  (tests.get_supabase_uid('ex_suspended'), 'admin');

update profiles set status = 'suspended' where id = tests.get_supabase_uid('ex_suspended');

-- Two accounts and two transactions. Window A (2020-03-01): e1 and e2 share a
-- created_at (the keyset tie-break), e3 and e4 follow. e1 < e2 < e3 < e4 by id.
insert into accounts (id, owner_type, owner_id, kind) values
  ('ee000000-0000-7000-8000-0000000000a1', 'vendor', 'ee000000-0000-7000-8000-0000000000c1', 'available'),
  ('ee000000-0000-7000-8000-0000000000a2', 'vendor', 'ee000000-0000-7000-8000-0000000000c1', 'pending_payout');

insert into transactions (id, kind, reference, description) values
  ('ee000000-0000-7000-8000-0000000000b1', 'adjustment', 'EX-TXN-A', 'export fixture A'),
  ('ee000000-0000-7000-8000-0000000000b2', 'adjustment', 'EX-TXN-B', 'export fixture B');

insert into ledger_entries (id, transaction_id, account_id, direction, amount_kobo, entry_type, created_at) values
  ('ee000000-0000-7000-8000-0000000000e1', 'ee000000-0000-7000-8000-0000000000b1', 'ee000000-0000-7000-8000-0000000000a2', 'debit',  7000, 'adjustment', '2020-03-01 10:00:00+00'),
  ('ee000000-0000-7000-8000-0000000000e2', 'ee000000-0000-7000-8000-0000000000b1', 'ee000000-0000-7000-8000-0000000000a1', 'credit', 7000, 'adjustment', '2020-03-01 10:00:00+00'),
  ('ee000000-0000-7000-8000-0000000000e3', 'ee000000-0000-7000-8000-0000000000b2', 'ee000000-0000-7000-8000-0000000000a2', 'debit',  500,  'adjustment', '2020-03-01 11:00:00+00'),
  ('ee000000-0000-7000-8000-0000000000e4', 'ee000000-0000-7000-8000-0000000000b2', 'ee000000-0000-7000-8000-0000000000a1', 'credit', 500,  'adjustment', '2020-03-01 12:00:00+00');

-- Window B (2020-04-01): 2005 rows, more than the 2000 page cap.
insert into ledger_entries (id, transaction_id, account_id, direction, amount_kobo, entry_type, created_at)
select ('ee000000-0000-7000-8001-' || lpad(i::text, 12, '0'))::uuid,
       'ee000000-0000-7000-8000-0000000000b1', 'ee000000-0000-7000-8000-0000000000a1', 'credit', 1, 'adjustment',
       timestamptz '2020-04-01 00:00:00+00' + (i || ' seconds')::interval
from generate_series(1, 2005) i;

insert into vendors (id, owner_user_id, name, slug, status, commission_bps) values
  ('ee000000-0000-7000-8000-0000000000d1', tests.get_supabase_uid('ex_admin'), 'Export Vendor One', 'export-vendor-one', 'active', 1500),
  ('ee000000-0000-7000-8000-0000000000d2', tests.get_supabase_uid('ex_finance'), 'Export Vendor Two', 'export-vendor-two', 'active', 1500);

-- Orders window (2021-03-01): o1 and o2 tie on created_at (o1 < o2 by id), o3
-- belongs to the second vendor, o4 is last. o2 is the only cancelled order.
insert into orders (id, code, customer_id, vendor_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo,
                    delivery_address, delivery_location, created_at) values
  ('ee000000-0000-7000-8000-0000000000f1', 'EX-ORD-1', tests.get_supabase_uid('ex_customer'), 'ee000000-0000-7000-8000-0000000000d1', 'delivered', 'paid',
   1000, 200, 50, 0, 1250, '{"line1": "1 Export Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'), '2021-03-01 10:00:00+00'),
  ('ee000000-0000-7000-8000-0000000000f2', 'EX-ORD-2', tests.get_supabase_uid('ex_customer'), 'ee000000-0000-7000-8000-0000000000d1', 'cancelled_by_platform', 'refunded',
   1000, 200, 50, 0, 1250, '{"line1": "1 Export Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'), '2021-03-01 10:00:00+00'),
  ('ee000000-0000-7000-8000-0000000000f3', 'EX-ORD-3', tests.get_supabase_uid('ex_customer'), 'ee000000-0000-7000-8000-0000000000d2', 'delivered', 'paid',
   1000, 200, 50, 0, 1250, '{"line1": "1 Export Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'), '2021-03-01 11:00:00+00'),
  ('ee000000-0000-7000-8000-0000000000f4', 'EX-ORD-4', tests.get_supabase_uid('ex_customer'), 'ee000000-0000-7000-8000-0000000000d1', 'delivered', 'paid',
   1000, 200, 50, 0, 1250, '{"line1": "1 Export Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'), '2021-03-01 12:00:00+00');

-- Ids returned by admin_log_export, written from the service_role session.
create temp table ex_ids (label text primary key, id uuid not null);
grant all on ex_ids to service_role;

-- ---------------------------------------------------------------------------
-- (1) Who may call: anon and authenticated (even an admin) cannot execute.
-- ---------------------------------------------------------------------------

select tests.clear_authentication(); -- role anon
select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'orders', '{"from": "2026-01-01", "to": "2026-01-02"}'::jsonb) $$, tests.get_supabase_uid('ex_admin')),
  '42501', null, 'anon cannot call admin_log_export');
select throws_ok(
  format($$ select * from admin_export_ledger_page(%L::uuid, '2020-03-01'::timestamptz, '2020-03-02'::timestamptz) $$, tests.get_supabase_uid('ex_finance')),
  '42501', null, 'anon cannot call admin_export_ledger_page');

select throws_ok(
  format($$ select * from admin_export_orders_page(%L::uuid, '2021-03-01'::timestamptz, '2021-03-02'::timestamptz) $$, tests.get_supabase_uid('ex_admin')),
  '42501', null, 'anon cannot call admin_export_orders_page');

select tests.authenticate_as('ex_finance');
select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'ledger', '{"from": "2026-01-01", "to": "2026-01-02"}'::jsonb) $$, tests.get_supabase_uid('ex_finance')),
  '42501', null, 'an authenticated finance admin (user JWT) cannot call admin_log_export directly');
select throws_ok(
  format($$ select * from admin_export_ledger_page(%L::uuid, '2020-03-01'::timestamptz, '2020-03-02'::timestamptz) $$, tests.get_supabase_uid('ex_finance')),
  '42501', null, 'an authenticated finance admin (user JWT) cannot call admin_export_ledger_page directly');

select throws_ok(
  format($$ select * from admin_export_orders_page(%L::uuid, '2021-03-01'::timestamptz, '2021-03-02'::timestamptz) $$, tests.get_supabase_uid('ex_admin')),
  '42501', null, 'an authenticated admin (user JWT) cannot call admin_export_orders_page directly');

select ok(
  has_function_privilege('service_role', 'admin_export_orders_page(uuid, timestamptz, timestamptz, order_status, uuid, timestamptz, uuid, int)', 'execute')
    and not has_function_privilege('anon', 'admin_export_orders_page(uuid, timestamptz, timestamptz, order_status, uuid, timestamptz, uuid, int)', 'execute')
    and not has_function_privilege('authenticated', 'admin_export_orders_page(uuid, timestamptz, timestamptz, order_status, uuid, timestamptz, uuid, int)', 'execute'),
  'admin_export_orders_page is executable by service_role only');

-- ---------------------------------------------------------------------------
-- (2) admin_log_export: actor checks.
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'orders', '{"from": "2026-01-01", "to": "2026-01-02"}'::jsonb) $$, tests.get_supabase_uid('ex_customer')),
  'P0001', null, 'a non-admin actor is refused');
select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'orders', '{"from": "2026-01-01", "to": "2026-01-02"}'::jsonb) $$, tests.get_supabase_uid('ex_suspended')),
  '42501', null, 'a suspended admin is refused (42501)');
select throws_ok(
  $$ select admin_log_export(null, 'orders', '{"from": "2026-01-01", "to": "2026-01-02"}'::jsonb) $$,
  'P0001', null, 'a null actor is refused');
select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'ledger', '{"from": "2026-01-01", "to": "2026-01-02"}'::jsonb) $$, tests.get_supabase_uid('ex_admin')),
  '42501', null, 'a plain admin cannot start a ledger export (42501)');

select is(
  (select count(*)::int from admin_audit_log where target_type = 'export'
     and actor_id in (select tests.get_supabase_uid(u) from unnest(array['ex_admin', 'ex_finance', 'ex_super', 'ex_suspended', 'ex_customer']) u)),
  0, 'refused calls wrote no audit row');

-- Success paths. The first orders call also carries keys that are not on the whitelist.
select lives_ok(
  format($$ insert into ex_ids select 'orders', admin_log_export(%L::uuid, 'orders',
      '{"from": "2026-01-01", "to": "2026-01-31", "status": "delivered", "vendor_id": "ee000000-0000-7000-8000-0000000000c1", "evil": "x", "p_actor_id": "y"}'::jsonb) $$,
    tests.get_supabase_uid('ex_admin')),
  'a plain admin can start an orders export');
select lives_ok(
  format($$ insert into ex_ids select 'ledger', admin_log_export(%L::uuid, 'ledger',
      '{"from": "2026-01-01", "to": "2026-03-01", "status": "delivered", "vendor_id": "ee000000-0000-7000-8000-0000000000c1", "evil": "x"}'::jsonb) $$,
    tests.get_supabase_uid('ex_finance')),
  'an admin with the finance role can start a ledger export');
select lives_ok(
  format($$ insert into ex_ids select 'ledger_super', admin_log_export(%L::uuid, 'ledger', '{"from": "2026-01-01", "to": "2026-01-01"}'::jsonb) $$,
    tests.get_supabase_uid('ex_super')),
  'a superadmin can start a ledger export (a one-day range is valid)');

-- ---------------------------------------------------------------------------
-- (3) admin_log_export: validation (all 23514), none writes a row.
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'users', '{"from": "2026-01-01", "to": "2026-01-02"}'::jsonb) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'an unknown kind is rejected');
select throws_ok(
  format($$ select admin_log_export(%L::uuid, null, '{"from": "2026-01-01", "to": "2026-01-02"}'::jsonb) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'a null kind is rejected');
select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'orders', '{"from": "2026-01-31", "to": "2026-01-01"}'::jsonb) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'to before from is rejected');
select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'orders', '{"from": "2026-01-01", "to": "2026-04-03"}'::jsonb) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'a 93-day range is rejected');
select lives_ok(
  format($$ insert into ex_ids select 'orders_92', admin_log_export(%L::uuid, 'orders', '{"from": "2026-01-01", "to": "2026-04-02"}'::jsonb) $$, tests.get_supabase_uid('ex_admin')),
  'a 92-day range is accepted');
select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'orders', '{"from": "2026-01-01"}'::jsonb) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'a missing date is rejected');
select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'orders', '{"from": "not-a-date", "to": "2026-01-02"}'::jsonb) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'an unparseable date is rejected');
select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'orders', '{"from": "2026-01-01", "to": "2026-01-02", "vendor_id": "nope"}'::jsonb) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'a malformed vendor_id is rejected');
select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'orders', '{"from": "2026-01-01", "to": "2026-01-02", "status": "not_a_status"}'::jsonb) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'an unknown order status is rejected rather than audited as free text');
select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'orders', '[]'::jsonb) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'a non-object filters payload is rejected');
select throws_ok(
  format($$ select admin_log_export(%L::uuid, 'orders', null) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'null filters are rejected');

select is(
  (select count(*)::int from admin_audit_log where target_type = 'export' and details ->> 'status' = 'not_a_status'
     and actor_id in (select tests.get_supabase_uid(u) from unnest(array['ex_admin', 'ex_finance', 'ex_super', 'ex_suspended', 'ex_customer']) u)),
  0, 'the bad status wrote no audit row');

-- ---------------------------------------------------------------------------
-- (4) The audit rows themselves.
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from admin_audit_log where target_type = 'export'
     and actor_id in (select tests.get_supabase_uid(u) from unnest(array['ex_admin', 'ex_finance', 'ex_super', 'ex_suspended', 'ex_customer']) u)),
  4, 'exactly the four successful exports wrote an audit row (rejections wrote none)');

select is(
  (select count(*)::int from admin_audit_log a join ex_ids i on i.label = 'orders' and i.id = a.target_id
   where a.action = 'export.orders' and a.target_type = 'export' and a.actor_id = tests.get_supabase_uid('ex_admin') and a.reason is null),
  1, 'the orders export row has action export.orders, target_type export and target_id = the returned id');

select is(
  (select a.details from admin_audit_log a join ex_ids i on i.label = 'orders' and i.id = a.target_id),
  '{"kind": "orders", "from": "2026-01-01", "to": "2026-01-31", "status": "delivered", "vendor_id": "ee000000-0000-7000-8000-0000000000c1"}'::jsonb,
  'orders details hold only the whitelisted keys (the extra keys passed in are absent)');

select is(
  (select a.details from admin_audit_log a join ex_ids i on i.label = 'ledger' and i.id = a.target_id),
  '{"kind": "ledger", "from": "2026-01-01", "to": "2026-03-01"}'::jsonb,
  'ledger details drop the orders-only status and vendor_id keys as well');

select is(
  (select a.action from admin_audit_log a join ex_ids i on i.label = 'ledger_super' and i.id = a.target_id),
  'export.ledger', 'a superadmin ledger export is audited as export.ledger');

select throws_ok(
  $$ update admin_audit_log set reason = 'rewritten' where target_type = 'export' $$,
  '42501', null, 'service_role cannot UPDATE an export audit row');
select throws_ok(
  $$ delete from admin_audit_log where target_type = 'export' $$,
  '42501', null, 'service_role cannot DELETE an export audit row');

-- ---------------------------------------------------------------------------
-- (5) admin_export_ledger_page.
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select * from admin_export_ledger_page(%L::uuid, '2020-03-01'::timestamptz, '2020-03-02'::timestamptz) $$, tests.get_supabase_uid('ex_admin')),
  '42501', null, 'a plain admin cannot read the ledger export');
select throws_ok(
  format($$ select * from admin_export_ledger_page(%L::uuid, '2020-03-01'::timestamptz, '2020-03-02'::timestamptz) $$, tests.get_supabase_uid('ex_customer')),
  'P0001', null, 'a non-admin cannot read the ledger export');
select throws_ok(
  format($$ select * from admin_export_ledger_page(%L::uuid, '2020-03-01'::timestamptz, '2020-03-02'::timestamptz) $$, tests.get_supabase_uid('ex_suspended')),
  '42501', null, 'a suspended admin cannot read the ledger export');

select is(
  array(select id from admin_export_ledger_page(tests.get_supabase_uid('ex_finance'), '2020-03-01'::timestamptz, '2020-03-02'::timestamptz)),
  array['ee000000-0000-7000-8000-0000000000e1', 'ee000000-0000-7000-8000-0000000000e2', 'ee000000-0000-7000-8000-0000000000e3', 'ee000000-0000-7000-8000-0000000000e4']::uuid[],
  'finance gets the window in (created_at, id) order');

select is(
  array(select id from admin_export_ledger_page(tests.get_supabase_uid('ex_super'), '2020-03-01'::timestamptz, '2020-03-02'::timestamptz)),
  array['ee000000-0000-7000-8000-0000000000e1', 'ee000000-0000-7000-8000-0000000000e2', 'ee000000-0000-7000-8000-0000000000e3', 'ee000000-0000-7000-8000-0000000000e4']::uuid[],
  'a superadmin can read it too');

select is(
  array(select id from admin_export_ledger_page(
    tests.get_supabase_uid('ex_finance'), '2020-03-01'::timestamptz, '2020-03-02'::timestamptz,
    '2020-03-01 10:00:00+00', 'ee000000-0000-7000-8000-0000000000e1')),
  array['ee000000-0000-7000-8000-0000000000e2', 'ee000000-0000-7000-8000-0000000000e3', 'ee000000-0000-7000-8000-0000000000e4']::uuid[],
  'the cursor is strict and breaks a created_at tie by id (e2 follows e1 at the same instant)');

select is(
  array(select id from admin_export_ledger_page(
    tests.get_supabase_uid('ex_finance'), '2020-03-01'::timestamptz, '2020-03-02'::timestamptz,
    '2020-03-01 10:00:00+00', 'ee000000-0000-7000-8000-0000000000e2')),
  array['ee000000-0000-7000-8000-0000000000e3', 'ee000000-0000-7000-8000-0000000000e4']::uuid[],
  'a cursor on the second tied row skips both tied rows');

select is(
  (select count(*)::int from admin_export_ledger_page(
    tests.get_supabase_uid('ex_finance'), '2020-03-01'::timestamptz, '2020-03-02'::timestamptz,
    '2020-03-01 12:00:00+00', 'ee000000-0000-7000-8000-0000000000e4')),
  0, 'a cursor on the last row returns nothing');

select is(
  array(select id from admin_export_ledger_page(
    tests.get_supabase_uid('ex_finance'), '2020-03-01 10:30:00+00'::timestamptz, '2020-03-01 12:00:00+00'::timestamptz)),
  array['ee000000-0000-7000-8000-0000000000e3']::uuid[],
  'the range is [from, to): the lower bound is included and the upper bound excluded');

select results_eq(
  format($$ select transaction_reference, transaction_kind, entry_type, account_owner_type, account_kind, account_owner_id,
                   direction, amount_kobo, order_code
            from admin_export_ledger_page(%L::uuid, '2020-03-01'::timestamptz, '2020-03-02'::timestamptz, null, null, 1) $$,
         tests.get_supabase_uid('ex_finance')),
  $$ values ('EX-TXN-A'::text, 'adjustment'::text, 'adjustment'::text, 'vendor'::text, 'pending_payout'::text,
             'ee000000-0000-7000-8000-0000000000c1'::uuid, 'debit'::text, 7000::bigint, null::text) $$,
  'a row carries the joined transaction and account context and no order code when there is no order');

select is(
  (select count(*)::int from admin_export_ledger_page(tests.get_supabase_uid('ex_finance'), '2020-04-01'::timestamptz, '2020-04-02'::timestamptz, null, null, 100000)),
  2000, 'p_limit is clamped to 2000');
select is(
  (select count(*)::int from admin_export_ledger_page(tests.get_supabase_uid('ex_finance'), '2020-04-01'::timestamptz, '2020-04-02'::timestamptz, null, null, 0)),
  1, 'p_limit below 1 is raised to 1');
select is(
  (select count(*)::int from admin_export_ledger_page(tests.get_supabase_uid('ex_finance'), '2020-04-01'::timestamptz, '2020-04-02'::timestamptz, null, null, null)),
  1000, 'a null p_limit means the default page of 1000');

select throws_ok(
  format($$ select * from admin_export_ledger_page(%L::uuid, '2020-03-02'::timestamptz, '2020-03-02'::timestamptz) $$, tests.get_supabase_uid('ex_finance')),
  '23514', null, 'an empty range is rejected');
select throws_ok(
  format($$ select * from admin_export_ledger_page(%L::uuid, '2020-03-02'::timestamptz, '2020-03-01'::timestamptz) $$, tests.get_supabase_uid('ex_finance')),
  '23514', null, 'a descending range is rejected');
select throws_ok(
  format($$ select * from admin_export_ledger_page(%L::uuid, null, '2020-03-01'::timestamptz) $$, tests.get_supabase_uid('ex_finance')),
  '23514', null, 'a null bound is rejected');

select throws_ok(
  format($$ select * from admin_export_ledger_page(%L::uuid, '2020-03-01'::timestamptz, '2020-03-02'::timestamptz, '2020-03-01 10:00:00+00', null) $$, tests.get_supabase_uid('ex_finance')),
  '23514', null, 'a cursor with created_at but no id is rejected');
select throws_ok(
  format($$ select * from admin_export_ledger_page(%L::uuid, '2020-03-01'::timestamptz, '2020-03-02'::timestamptz, null, 'ee000000-0000-7000-8000-0000000000e1') $$, tests.get_supabase_uid('ex_finance')),
  '23514', null, 'a cursor with id but no created_at is rejected');
select throws_ok(
  format($$ select * from admin_export_ledger_page(%L::uuid, '2020-01-01'::timestamptz, '2020-04-05'::timestamptz) $$, tests.get_supabase_uid('ex_finance')),
  '23514', null, 'a range longer than 93 days is rejected');
select lives_ok(
  format($$ select * from admin_export_ledger_page(%L::uuid, '2020-01-01'::timestamptz, '2020-04-03'::timestamptz) $$, tests.get_supabase_uid('ex_finance')),
  'a range of exactly 93 days is accepted');

-- ---------------------------------------------------------------------------
-- (6) admin_export_orders_page.
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select * from admin_export_orders_page(%L::uuid, '2021-03-01'::timestamptz, '2021-03-02'::timestamptz) $$, tests.get_supabase_uid('ex_customer')),
  'P0001', null, 'a non-admin cannot read the orders export');
select throws_ok(
  format($$ select * from admin_export_orders_page(%L::uuid, '2021-03-01'::timestamptz, '2021-03-02'::timestamptz) $$, tests.get_supabase_uid('ex_suspended')),
  '42501', null, 'a suspended admin cannot read the orders export');

select is(
  array(select id from admin_export_orders_page(tests.get_supabase_uid('ex_admin'), '2021-03-01'::timestamptz, '2021-03-02'::timestamptz)),
  array['ee000000-0000-7000-8000-0000000000f1', 'ee000000-0000-7000-8000-0000000000f2', 'ee000000-0000-7000-8000-0000000000f3', 'ee000000-0000-7000-8000-0000000000f4']::uuid[],
  'a plain admin (no finance role) gets the window in (created_at, id) order');

select is(
  array(select id from admin_export_orders_page(tests.get_supabase_uid('ex_admin'), '2021-03-01'::timestamptz, '2021-03-02'::timestamptz, 'delivered')),
  array['ee000000-0000-7000-8000-0000000000f1', 'ee000000-0000-7000-8000-0000000000f3', 'ee000000-0000-7000-8000-0000000000f4']::uuid[],
  'the status filter is applied');
select is(
  array(select id from admin_export_orders_page(tests.get_supabase_uid('ex_admin'), '2021-03-01'::timestamptz, '2021-03-02'::timestamptz, null, 'ee000000-0000-7000-8000-0000000000d2')),
  array['ee000000-0000-7000-8000-0000000000f3']::uuid[],
  'the vendor filter is applied');
select is(
  array(select id from admin_export_orders_page(tests.get_supabase_uid('ex_admin'), '2021-03-01'::timestamptz, '2021-03-02'::timestamptz, 'delivered', 'ee000000-0000-7000-8000-0000000000d1')),
  array['ee000000-0000-7000-8000-0000000000f1', 'ee000000-0000-7000-8000-0000000000f4']::uuid[],
  'status and vendor filters combine');

select is(
  array(select id from admin_export_orders_page(tests.get_supabase_uid('ex_admin'), '2021-03-01'::timestamptz, '2021-03-02'::timestamptz, null, null, '2021-03-01 10:00:00+00', 'ee000000-0000-7000-8000-0000000000f1')),
  array['ee000000-0000-7000-8000-0000000000f2', 'ee000000-0000-7000-8000-0000000000f3', 'ee000000-0000-7000-8000-0000000000f4']::uuid[],
  'the cursor is strict and breaks a created_at tie by id (f2 follows f1 at the same instant)');
select is(
  array(select id from admin_export_orders_page(tests.get_supabase_uid('ex_admin'), '2021-03-01'::timestamptz, '2021-03-02'::timestamptz, null, null, '2021-03-01 10:00:00+00', 'ee000000-0000-7000-8000-0000000000f2')),
  array['ee000000-0000-7000-8000-0000000000f3', 'ee000000-0000-7000-8000-0000000000f4']::uuid[],
  'a cursor on the second tied row skips both tied rows');
select is(
  (select count(*)::int from admin_export_orders_page(tests.get_supabase_uid('ex_admin'), '2021-03-01'::timestamptz, '2021-03-02'::timestamptz, null, null, '2021-03-01 12:00:00+00', 'ee000000-0000-7000-8000-0000000000f4')),
  0, 'a cursor on the last order returns nothing');
select is(
  array(select id from admin_export_orders_page(tests.get_supabase_uid('ex_admin'), '2021-03-01 10:30:00+00'::timestamptz, '2021-03-01 12:00:00+00'::timestamptz)),
  array['ee000000-0000-7000-8000-0000000000f3']::uuid[],
  'the range is [from, to): the lower bound is included and the upper bound excluded');

select results_eq(
  format($$ select code, status::text, payment_status, vendor_id, vendor_name, customer_id, rider_id, subtotal_kobo, delivery_fee_kobo,
                   service_fee_kobo, discount_kobo, total_kobo, placed_at, delivered_at
            from admin_export_orders_page(%L::uuid, '2021-03-01'::timestamptz, '2021-03-02'::timestamptz, null, null, null, null, 1) $$,
         tests.get_supabase_uid('ex_admin')),
  format($$ values ('EX-ORD-1'::text, 'delivered'::text, 'paid'::text, 'ee000000-0000-7000-8000-0000000000d1'::uuid, 'Export Vendor One'::text,
                    %L::uuid, null::uuid, 1000::bigint, 200::bigint, 50::bigint, 0::bigint, 1250::bigint, null::timestamptz, null::timestamptz) $$,
         tests.get_supabase_uid('ex_customer')),
  'a row carries the joined vendor name and the export columns');

select is(
  (select count(*)::int from admin_export_orders_page(tests.get_supabase_uid('ex_admin'), '2021-03-01'::timestamptz, '2021-03-02'::timestamptz, null, null, null, null, 100000)),
  4, 'a huge p_limit is clamped (to 2000) and still returns the window');
select is(
  (select count(*)::int from admin_export_orders_page(tests.get_supabase_uid('ex_admin'), '2021-03-01'::timestamptz, '2021-03-02'::timestamptz, null, null, null, null, 0)),
  1, 'p_limit below 1 is raised to 1');
select is(
  (select count(*)::int from admin_export_orders_page(tests.get_supabase_uid('ex_admin'), '2021-03-01'::timestamptz, '2021-03-02'::timestamptz, null, null, null, null, null)),
  4, 'a null p_limit means the default page');

select throws_ok(
  format($$ select * from admin_export_orders_page(%L::uuid, '2021-03-02'::timestamptz, '2021-03-02'::timestamptz) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'an empty orders range is rejected');
select throws_ok(
  format($$ select * from admin_export_orders_page(%L::uuid, '2021-03-02'::timestamptz, '2021-03-01'::timestamptz) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'a descending orders range is rejected');
select throws_ok(
  format($$ select * from admin_export_orders_page(%L::uuid, null, '2021-03-01'::timestamptz) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'a null orders bound is rejected');
select throws_ok(
  format($$ select * from admin_export_orders_page(%L::uuid, '2021-03-01'::timestamptz, '2021-03-02'::timestamptz, null, null, '2021-03-01 10:00:00+00', null) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'an orders cursor with created_at but no id is rejected');
select throws_ok(
  format($$ select * from admin_export_orders_page(%L::uuid, '2021-03-01'::timestamptz, '2021-03-02'::timestamptz, null, null, null, 'ee000000-0000-7000-8000-0000000000f1') $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'an orders cursor with id but no created_at is rejected');
select throws_ok(
  format($$ select * from admin_export_orders_page(%L::uuid, '2021-01-01'::timestamptz, '2021-04-05'::timestamptz) $$, tests.get_supabase_uid('ex_admin')),
  '23514', null, 'an orders range longer than 93 days is rejected');
select lives_ok(
  format($$ select * from admin_export_orders_page(%L::uuid, '2021-01-01'::timestamptz, '2021-04-03'::timestamptz) $$, tests.get_supabase_uid('ex_admin')),
  'an orders range of exactly 93 days is accepted');

select * from finish();
rollback;
