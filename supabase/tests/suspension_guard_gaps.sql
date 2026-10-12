-- pgTAP: 0085_suspension_guard_gaps.sql. A suspended account is refused on
-- place_order, submit_order_rating, register_rider, update_rider_bank_details
-- and (unless finishing a picked-up delivery) register_rider_push_token; an
-- active account is not; the deliberately open functions stay open; client
-- roles hold no TRUNCATE/TRIGGER/REFERENCES on our tables.
--
-- "Passes the guard" is asserted as "did not raise 42501" where the call would
-- otherwise need a full fixture to succeed.

begin;
select plan(17);

create function pg_temp.sqlstate_of(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (as the owner)
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('gg_customer');
select tests.create_supabase_user('gg_customer_susp');
select tests.create_supabase_user('gg_rider');
select tests.create_supabase_user('gg_rider_susp');
select tests.create_supabase_user('gg_rider_busy');
select tests.create_supabase_user('gg_vendor_owner');

insert into riders (user_id, kyc_status) values
  (tests.get_supabase_uid('gg_rider'), 'approved'),
  (tests.get_supabase_uid('gg_rider_susp'), 'approved'),
  (tests.get_supabase_uid('gg_rider_busy'), 'approved');

update profiles set status = 'suspended'
where id in (tests.get_supabase_uid('gg_customer_susp'), tests.get_supabase_uid('gg_rider_susp'), tests.get_supabase_uid('gg_rider_busy'));

insert into vendors (id, owner_user_id, name, slug, status)
values ('99000000-0000-7000-8000-000000000001', tests.get_supabase_uid('gg_vendor_owner'), 'GG Vendor', 'gg-vendor', 'active');

-- gg_rider_busy is suspended but carrying a picked-up order.
insert into orders (id, customer_id, vendor_id, rider_id, status, payment_status,
                    subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo,
                    delivery_address, delivery_location)
values ('99000000-0000-7000-8000-000000000011', tests.get_supabase_uid('gg_customer'), '99000000-0000-7000-8000-000000000001',
        tests.get_supabase_uid('gg_rider_busy'), 'picked_up', 'paid', 80000, 15000, 5000, 0, 100000,
        '{"line1": "1 GG Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int
   from information_schema.role_table_grants g
   join pg_tables t on t.schemaname = 'public' and t.tablename = g.table_name and t.tableowner = 'postgres'
   where g.grantee in ('anon', 'authenticated') and g.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')),
  0, 'anon and authenticated hold no TRUNCATE, TRIGGER or REFERENCES on any of our tables');

-- ---------------------------------------------------------------------------
-- Suspended accounts are refused
-- ---------------------------------------------------------------------------

select tests.authenticate_as('gg_customer_susp');
select throws_ok(
  $$ select place_order('99000000-0000-7000-8000-000000000099', '{"line1": "x"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)')) $$,
  '42501', null, 'suspended customer: place_order refused');
select throws_ok(
  $$ select submit_order_rating('99000000-0000-7000-8000-000000000011', 5::smallint) $$,
  '42501', null, 'suspended customer: submit_order_rating refused');
select isnt(pg_temp.sqlstate_of($$ select register_web_push_subscription('https://push.example.test/gg', 'p256dh-key', 'auth-key') $$),
  '42501', 'suspended customer: register_web_push_subscription stays open');

select tests.authenticate_as('gg_rider_susp');
select throws_ok($$ select register_rider('motorbike', 'GG-001') $$, '42501', null,
  'suspended user: register_rider refused');
select throws_ok($$ select update_rider_bank_details('GTBank', 'GG Rider', '0123456789') $$, '42501', null,
  'suspended rider: update_rider_bank_details refused');
select throws_ok($$ select register_rider_push_token('ExponentPushToken[gg-susp]', 'android') $$, '42501', null,
  'suspended rider with nothing in progress: register_rider_push_token refused');
select isnt(pg_temp.sqlstate_of($$ select unregister_rider_push_token('ExponentPushToken[gg-susp]') $$), '42501',
  'suspended rider: unregister_rider_push_token stays open');
select isnt(pg_temp.sqlstate_of($$ select get_rider_earnings() $$), '42501',
  'suspended rider: own-data reads stay open');

select tests.authenticate_as('gg_rider_busy');
select lives_ok($$ select register_rider_push_token('ExponentPushToken[gg-busy]', 'android') $$,
  'suspended rider finishing a picked-up delivery: register_rider_push_token allowed');
select throws_ok($$ select update_rider_bank_details('GTBank', 'GG Busy', '0123456789') $$, '42501', null,
  '... but still cannot change their payout account');

-- ---------------------------------------------------------------------------
-- Active accounts get through
-- ---------------------------------------------------------------------------

select tests.authenticate_as('gg_customer');
select isnt(pg_temp.sqlstate_of(
  $$ select place_order('99000000-0000-7000-8000-000000000099', '{"line1": "x"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)')) $$),
  '42501', 'active customer: place_order passes the guard');
select isnt(pg_temp.sqlstate_of($$ select submit_order_rating('99000000-0000-7000-8000-000000000011', 5::smallint) $$),
  '42501', 'active customer: submit_order_rating passes the guard');

select tests.authenticate_as('gg_rider');
select lives_ok($$ select register_rider('motorbike', 'GG-002') $$, 'active rider: register_rider works');
select lives_ok($$ select update_rider_bank_details('GTBank', 'GG Rider', '0123456789') $$,
  'active rider: update_rider_bank_details works');
select lives_ok($$ select register_rider_push_token('ExponentPushToken[gg-active]', 'android') $$,
  'active rider: register_rider_push_token works');

select tests.authenticate_as_service_role();
select is((select bank_account_number from riders where user_id = tests.get_supabase_uid('gg_rider_susp')), null,
  'the refused bank-details change wrote nothing');

select * from finish();
rollback;
