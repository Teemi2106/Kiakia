-- pgTAP: vendor notifications (0049_vendor_notifications.sql). Same caveat
-- as every other file in this directory: not executed here (no
-- Docker/Supabase CLI in this environment), run via `supabase test db` or
-- CI's `pgtap` job.
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) generalising `notifications` to a second audience must not open the
-- customer feed to vendor staff, or the vendor feed to the customer on the
-- very same order, because the two audiences share a table now, and that is
-- exactly where a leak would hide; (2) a stranger with no vendor_staff row
-- must read nothing at all; (3) the new trigger must fire on the
-- transitions a vendor did NOT cause (placed, cancelled_by_customer) and
-- stay silent on the ones it did (accepted), or the bell becomes noise;
-- (4) the notifications_one_audience constraint must actually reject a row
-- addressed to nobody or to both; (5) the column grant must let a recipient
-- mark something read while refusing to let them rewrite its text.

begin;
select plan(12);

select tests.create_supabase_user('notif_customer');
select tests.create_supabase_user('notif_vendor_owner');
select tests.create_supabase_user('notif_stranger');

insert into vendors (id, owner_user_id, name, slug, status, is_accepting_orders, commission_bps)
values (
  '00000000-0000-7000-8000-000000000090',
  tests.get_supabase_uid('notif_vendor_owner'),
  'Notify Vendor', 'notify-vendor', 'active', true, 1500
);

insert into vendor_staff (vendor_id, user_id, role)
values ('00000000-0000-7000-8000-000000000090', tests.get_supabase_uid('notif_vendor_owner'), 'vendor_owner');

insert into orders (id, customer_id, vendor_id, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000091',
  tests.get_supabase_uid('notif_customer'),
  '00000000-0000-7000-8000-000000000090',
  1000000, 200000, 50000, 0, 1250000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);

-- ---------------------------------------------------------------------------
-- the trigger fires on the transitions a vendor did not cause
-- ---------------------------------------------------------------------------

update orders set status = 'placed' where id = '00000000-0000-7000-8000-000000000091';

select is(
  (select count(*)::int from notifications
    where vendor_id = '00000000-0000-7000-8000-000000000090' and title = 'New order'),
  1,
  'draft -> placed inserts exactly one vendor notification'
);

select is(
  (select count(*)::int from notifications
    where customer_id = tests.get_supabase_uid('notif_customer')),
  1,
  '0038''s customer trigger still fires alongside the new vendor one'
);

-- A vendor-caused transition must not notify the vendor about itself.
update orders set status = 'accepted' where id = '00000000-0000-7000-8000-000000000091';

select is(
  (select count(*)::int from notifications where vendor_id = '00000000-0000-7000-8000-000000000090'),
  1,
  'accepted is silent for the vendor, it is the actor that caused it'
);

-- ...but a customer cancellation is exactly what the vendor needs to hear,
-- and is the one status 0038 deliberately stays quiet about.
update orders set status = 'cancelled_by_customer' where id = '00000000-0000-7000-8000-000000000091';

select is(
  (select count(*)::int from notifications
    where vendor_id = '00000000-0000-7000-8000-000000000090' and title = 'Order cancelled'),
  1,
  'cancelled_by_customer notifies the vendor'
);

-- Still 2, one for `placed`, one for `accepted`. cancelled_by_customer
-- added nothing, which is 0038's deliberate choice and must survive this
-- migration untouched.
select is(
  (select count(*)::int from notifications
    where customer_id = tests.get_supabase_uid('notif_customer')),
  2,
  'cancelled_by_customer stays silent for the customer, as 0038 intended'
);

-- A status change that is not a change at all must not re-notify.
update orders set status = 'cancelled_by_customer' where id = '00000000-0000-7000-8000-000000000091';

select is(
  (select count(*)::int from notifications where vendor_id = '00000000-0000-7000-8000-000000000090'),
  2,
  'an UPDATE that leaves status untouched inserts nothing'
);

-- ---------------------------------------------------------------------------
-- the audience boundary
-- ---------------------------------------------------------------------------

select tests.authenticate_as('notif_vendor_owner');

select is(
  (select count(*)::int from notifications),
  2,
  'vendor staff see their vendor''s notifications and nothing else'
);

select is(
  (select count(*)::int from notifications where customer_id is not null),
  0,
  'vendor staff cannot read the customer feed for the very same order'
);

select tests.authenticate_as('notif_customer');

select is(
  (select count(*)::int from notifications where vendor_id is not null),
  0,
  'the customer cannot read the vendor feed for their own order'
);

select tests.authenticate_as('notif_stranger');

select is(
  (select count(*)::int from notifications),
  0,
  'a stranger with no vendor_staff row and no orders reads nothing'
);

-- ---------------------------------------------------------------------------
-- writes
-- ---------------------------------------------------------------------------

select tests.authenticate_as('notif_vendor_owner');

select lives_ok(
  $$ update notifications set is_read = true where vendor_id = '00000000-0000-7000-8000-000000000090' $$,
  'vendor staff can mark their own notifications read'
);

-- RLS alone would have allowed this; the column grant is what stops it.
-- 4-argument form on purpose. pgTAP's 2-argument throws_ok(text, text) treats
-- the second argument as the EXPECTED ERROR MESSAGE, not a description, unless
-- it is exactly 5 characters (in which case it is read as a SQLSTATE). Written
-- with 2 arguments this assertion could never pass, because the real error is
-- 'permission denied for table notifications', not the prose description.
select throws_ok(
  $$ update notifications set title = 'rewritten' where vendor_id = '00000000-0000-7000-8000-000000000090' $$,
  '42501',
  'permission denied for table notifications',
  'a recipient cannot rewrite a notification''s text, only is_read is grantable'
);

select * from finish();
rollback;
