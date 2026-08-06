-- pgTAP: register_vendor() — one atomic vendor + vendor_staff + user_roles
-- elevation (0009_register_vendor.sql). Same caveat as the other files in
-- this directory: not executed here (no Docker/Supabase CLI in this
-- environment), run via `supabase test db` or CI's `pgtap` job.

begin;
select plan(5);

select tests.create_supabase_user('customer_a');

select tests.authenticate_as('customer_a');

-- A fresh account can register a vendor, and gets all three rows in one
-- shot: the vendor itself, a vendor_owner vendor_staff row, and the
-- vendor_owner user_roles grant.
select is(
  (select name from register_vendor('Mama Put Kitchen', 'mama-put-kitchen-rv', 'food')),
  'Mama Put Kitchen',
  'register_vendor creates the vendor row'
);

select is(
  (select role from vendor_staff where vendor_id = (select id from vendors where slug = 'mama-put-kitchen-rv') and user_id = tests.get_supabase_uid('customer_a')),
  'vendor_owner',
  'register_vendor also creates the vendor_staff row, atomically'
);

select is(
  (select count(*)::int from user_roles where user_id = tests.get_supabase_uid('customer_a') and role = 'vendor_owner'),
  1,
  'register_vendor also grants the vendor_owner role, atomically'
);

-- One vendor per account in this release (documented limit) — a second
-- call by the same already-staffed account must be rejected, not create a
-- second vendor.
select throws_ok(
  $$ select register_vendor('Second Store', 'second-store-rv', 'food') $$,
  'an account that already staffs a vendor cannot register a second one'
);

select is(
  (select count(*)::int from vendors where owner_user_id = tests.get_supabase_uid('customer_a')),
  1,
  'the rejected second attempt did not create a second vendor row'
);

select * from finish();
rollback;
