-- pgTAP: customer_events (0084_customer_events.sql) - own-read RLS, no
-- direct write path, log_customer_event() validation / dedupe / rate limit,
-- and the cart_items -> cart_add / cart_remove triggers.
--
-- NOT executed when authored (no Docker/Supabase CLI available). Run with:
--   supabase start
--   supabase test db

begin;
select plan(74);

select tests.create_supabase_user('ce_customer_a');
select tests.create_supabase_user('ce_customer_b');
select tests.create_supabase_user('ce_owner');
select tests.create_supabase_user('ce_staff');
select tests.create_supabase_user('ce_rider');
select tests.create_supabase_user('ce_customer_c');
select tests.create_supabase_user('ce_customer_d');
select tests.create_supabase_user('ce_customer_e');
select tests.create_supabase_user('ce_suspended');

-- Fixtures (as the migration role, bypassing RLS): one active vendor with a
-- menu item, one pending vendor with a menu item.
insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values
  ('00000000-0000-7000-8000-0000000000a1', tests.get_supabase_uid('ce_owner'), 'CE Active Vendor', 'ce-active-vendor', 'active', 1500),
  ('00000000-0000-7000-8000-0000000000a2', tests.get_supabase_uid('ce_owner'), 'CE Pending Vendor', 'ce-pending-vendor', 'pending', 1500);

insert into menu_items (id, vendor_id, name, price_kobo)
values
  ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000a1', 'CE Jollof', 150000),
  ('00000000-0000-7000-8000-0000000000b2', '00000000-0000-7000-8000-0000000000a2', 'CE Hidden Dish', 90000),
  ('00000000-0000-7000-8000-0000000000b3', '00000000-0000-7000-8000-0000000000a1', 'CE Moi Moi', 50000);

-- A vendor owner + staff member of the ACTIVE vendor, and a rider: the roles
-- that RLS elsewhere lets read OTHER customers' orders. They must not be able
-- to read a customer's behavioural events.
insert into vendor_staff (vendor_id, user_id, role)
values
  ('00000000-0000-7000-8000-0000000000a1', tests.get_supabase_uid('ce_owner'), 'vendor_owner'),
  ('00000000-0000-7000-8000-0000000000a1', tests.get_supabase_uid('ce_staff'), 'vendor_staff')
on conflict do nothing;
insert into riders (user_id, kyc_status) values (tests.get_supabase_uid('ce_rider'), 'approved');

-- ---------------------------------------------------------------------------
-- RPC: happy path, derived vendor, forced customer_id
-- ---------------------------------------------------------------------------

select tests.authenticate_as('ce_customer_a');

-- A mismatching client-supplied vendor id (the PENDING vendor) must be
-- ignored: the vendor is derived from the menu item.
select lives_ok(
  $$ select log_customer_event('view_item', '00000000-0000-7000-8000-0000000000a2', '00000000-0000-7000-8000-0000000000b1') $$,
  'view_item for an active vendor''s item is accepted'
);

select is(
  (select vendor_id from customer_events where event_type = 'view_item'),
  '00000000-0000-7000-8000-0000000000a1'::uuid,
  'vendor_id is derived from the menu item; a mismatching client vendor id is ignored'
);

select is(
  (select customer_id from customer_events where event_type = 'view_item'),
  tests.get_supabase_uid('ce_customer_a'),
  'the RPC forces customer_id = auth.uid() (it has no customer parameter)'
);

select is(
  (select count(*)::int from customer_events),
  1,
  'a customer can read their own events'
);

-- Dedupe: identical event inside 5 minutes is a no-op.
select lives_ok(
  $$ select log_customer_event('view_item', null, '00000000-0000-7000-8000-0000000000b1') $$,
  'repeating an identical event does not error'
);
select is(
  (select count(*)::int from customer_events where event_type = 'view_item'),
  1,
  'an identical event within 5 minutes is deduplicated'
);

-- Search normalisation: trim, lower-case, collapse whitespace.
select lives_ok(
  $$ select log_customer_event('search', null, null, E'  Jollof \t  RICE  ') $$,
  'a search event is accepted'
);
select is(
  (select search_query from customer_events where event_type = 'search'),
  'jollof rice',
  'search_query is trimmed, lower-cased and whitespace-collapsed'
);

-- A blank search is dropped, not stored.
select lives_ok(
  $$ select log_customer_event('search', null, null, '    ') $$,
  'a blank search is a silent no-op, not an error'
);
select is(
  (select count(*)::int from customer_events where event_type = 'search'),
  1,
  'an empty search query is dropped'
);

-- ---------------------------------------------------------------------------
-- RPC: rejections
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select log_customer_event('cart_add', null, '00000000-0000-7000-8000-0000000000b1') $$,
  '23514',
  null,
  'a client cannot forge cart_add through the RPC'
);

select throws_ok(
  $$ select log_customer_event('view_vendor', '00000000-0000-7000-8000-0000000000a2') $$,
  '23514',
  null,
  'view_vendor on a non-active vendor is rejected'
);

select throws_ok(
  $$ select log_customer_event('view_item', null, '00000000-0000-7000-8000-0000000000b2') $$,
  '23514',
  null,
  'view_item on an item of a non-active vendor is rejected'
);

-- More rejections: unknown / null type, and the per-type required references.
select throws_ok(
  $$ select log_customer_event('purchase', null, '00000000-0000-7000-8000-0000000000b1') $$,
  '23514', null, 'an unknown event type is rejected'
);
select throws_ok(
  $$ select log_customer_event(null, null, '00000000-0000-7000-8000-0000000000b1') $$,
  '23514', null, 'a null event type is rejected'
);
select throws_ok(
  $$ select log_customer_event('view_vendor') $$,
  '23514', null, 'view_vendor without a vendor id is rejected'
);
select throws_ok(
  $$ select log_customer_event('recommendation_click') $$,
  '23514', null, 'recommendation_click without a menu item id is rejected'
);

-- Search: stored query is capped at 80 chars; ids passed with a search are ignored.
select lives_ok(
  $$ select log_customer_event('search', null, null, repeat('a', 100)) $$,
  'an over-long search is accepted (truncated)'
);
select is(
  (select char_length(search_query) from customer_events where search_query like 'aaaa%'),
  80,
  'search_query is truncated to 80 characters'
);
select lives_ok(
  $$ select log_customer_event('search', '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000b1', 'ids ignored') $$,
  'a search carrying vendor/item ids is accepted'
);
select is(
  (select count(*)::int from customer_events
   where search_query = 'ids ignored' and vendor_id is null and menu_item_id is null),
  1,
  'a search event never stores a vendor or menu item id'
);

-- Dedupe works on the NORMALISED query, not the raw text.
select lives_ok(
  $$ select log_customer_event('search', null, null, 'JOLLOF    Rice') $$,
  'a differently-spaced/cased repeat of a search does not error'
);
select is(
  (select count(*)::int from customer_events where search_query = 'jollof rice'),
  1,
  'a search that normalises to an existing one within 5 minutes is deduplicated'
);

-- Dedupe is per (type, item): a DIFFERENT item is a new event.
select lives_ok(
  $$ select log_customer_event('view_item', null, '00000000-0000-7000-8000-0000000000b3') $$,
  'viewing a different item is accepted'
);
select is(
  (select count(*)::int from customer_events where event_type = 'view_item'),
  2,
  'dedupe does not swallow an event for a different item'
);

-- Dedupe window expires: age the first view_item to 6 minutes ago.
reset role;
update customer_events set created_at = now() - interval '6 minutes'
where event_type = 'view_item' and menu_item_id = '00000000-0000-7000-8000-0000000000b1';
select tests.authenticate_as('ce_customer_a');
select lives_ok(
  $$ select log_customer_event('view_item', null, '00000000-0000-7000-8000-0000000000b1') $$,
  'repeating an event older than 5 minutes is accepted'
);
select is(
  (select count(*)::int from customer_events
   where event_type = 'view_item' and menu_item_id = '00000000-0000-7000-8000-0000000000b1'),
  2,
  'an identical event older than the 5-minute window is recorded again'
);

-- ---------------------------------------------------------------------------
-- Visibility and the absence of any direct write path
-- ---------------------------------------------------------------------------

select tests.authenticate_as('ce_customer_b');
select is(
  (select count(*)::int from customer_events),
  0,
  'another customer cannot read customer_a''s events'
);

-- Roles that can read OTHER customers' orders via RLS must not read events.
select tests.authenticate_as('ce_owner');
select is(
  (select count(*)::int from customer_events),
  0,
  'a vendor owner cannot read a customer''s events (own-select only, even for that vendor''s customers)'
);
select tests.authenticate_as('ce_staff');
select is(
  (select count(*)::int from customer_events),
  0,
  'vendor staff cannot read a customer''s events'
);
select tests.authenticate_as('ce_rider');
select is(
  (select count(*)::int from customer_events),
  0,
  'a rider cannot read a customer''s events'
);

select tests.authenticate_as('ce_customer_a');
select throws_ok(
  $$ insert into customer_events (customer_id, event_type, vendor_id)
     values (auth.uid(), 'view_vendor', '00000000-0000-7000-8000-0000000000a1') $$,
  '42501',
  null,
  'direct INSERT as authenticated is denied (revoked)'
);
select throws_ok(
  $$ update customer_events set search_query = 'x' $$,
  '42501',
  null,
  'direct UPDATE as authenticated is denied (revoked)'
);
select throws_ok(
  $$ delete from customer_events $$,
  '42501',
  null,
  'direct DELETE as authenticated is denied (revoked)'
);

select throws_ok(
  $$ truncate customer_events $$,
  '42501',
  null,
  'TRUNCATE as authenticated is denied (revoked)'
);

select tests.clear_authentication(); -- role anon
select throws_ok(
  $$ select count(*) from customer_events $$,
  '42501',
  null,
  'anon cannot read customer_events'
);
select throws_ok(
  $$ select log_customer_event('view_vendor', '00000000-0000-7000-8000-0000000000a1') $$,
  '42501',
  null,
  'anon cannot execute log_customer_event'
);

-- Table/function privileges (RLS alone would also deny the INSERT, so assert the
-- GRANT layer directly - this is what the revokes in 0084 actually guarantee).
select ok(
  not has_table_privilege('authenticated', 'public.customer_events', 'INSERT, UPDATE, DELETE'),
  'authenticated holds no INSERT/UPDATE/DELETE privilege on customer_events'
);
select ok(
  has_table_privilege('authenticated', 'public.customer_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.customer_events', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.customer_events', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.customer_events', 'TRIGGER'),
  'authenticated holds SELECT only (no TRUNCATE/REFERENCES/TRIGGER either) on customer_events'
);
select ok(
  not has_table_privilege('anon', 'public.customer_events', 'SELECT, INSERT, UPDATE, DELETE'),
  'anon holds no privilege at all on customer_events'
);
select ok(
  not has_function_privilege('anon', 'public.log_customer_event(text, uuid, uuid, text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.log_customer_event(text, uuid, uuid, text)', 'EXECUTE'),
  'log_customer_event is executable by authenticated and not by anon'
);
select ok(
  not has_function_privilege('authenticated', 'public.log_cart_item_event()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.log_cart_item_event()', 'EXECUTE'),
  'the cart trigger function cannot be called directly by clients'
);

-- ---------------------------------------------------------------------------
-- cart_items triggers (cart_add / cart_remove, cascade-skip)
-- ---------------------------------------------------------------------------

select tests.authenticate_as('ce_customer_a');
insert into carts (id, customer_id, vendor_id, status)
values ('00000000-0000-7000-8000-0000000000c1', tests.get_supabase_uid('ce_customer_a'), '00000000-0000-7000-8000-0000000000a1', 'open');

insert into cart_items (id, cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, line_total_kobo)
values ('00000000-0000-7000-8000-0000000000d1', '00000000-0000-7000-8000-0000000000c1',
        '00000000-0000-7000-8000-0000000000b1', 'CE Jollof', 150000, 1, 150000);

select is(
  (select count(*)::int from customer_events
   where event_type = 'cart_add'
     and customer_id = tests.get_supabase_uid('ce_customer_a')
     and menu_item_id = '00000000-0000-7000-8000-0000000000b1'
     and vendor_id = '00000000-0000-7000-8000-0000000000a1'),
  1,
  'inserting a cart item records cart_add for the cart''s owner with the item''s vendor'
);

-- Attribution: the event belongs to the cart's OWNER; another customer can
-- neither see it nor write a cart item into someone else's cart.
select tests.authenticate_as('ce_customer_b');
select is(
  (select count(*)::int from customer_events where event_type = 'cart_add'),
  0,
  'customer_b cannot see customer_a''s cart_add'
);
select throws_ok(
  $$ insert into cart_items (cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, line_total_kobo)
     values ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-0000000000b3', 'CE Moi Moi', 50000, 1, 50000) $$,
  '42501',
  null,
  'customer_b cannot add an item to customer_a''s cart (so no cart_add can be attributed to a cart they do not own)'
);
select tests.authenticate_as('ce_customer_a');
select is(
  (select count(*)::int from customer_events where event_type = 'cart_add'),
  1,
  'customer_a still has exactly one cart_add (nothing was attributed from customer_b''s attempt)'
);

delete from cart_items where id = '00000000-0000-7000-8000-0000000000d1';
select is(
  (select count(*)::int from customer_events where event_type = 'cart_remove'),
  1,
  'deleting a cart item records cart_remove'
);

-- Re-add, then delete the whole cart: the cart_items rows go via FK cascade
-- (trigger depth 2) and must NOT fabricate a cart_remove.
insert into cart_items (id, cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, line_total_kobo)
values ('00000000-0000-7000-8000-0000000000d2', '00000000-0000-7000-8000-0000000000c1',
        '00000000-0000-7000-8000-0000000000b1', 'CE Jollof', 150000, 1, 150000);
delete from carts where id = '00000000-0000-7000-8000-0000000000c1';
select is(
  (select count(*)::int from customer_events where event_type = 'cart_remove'),
  1,
  'cart_items removed by an FK cascade do not fabricate cart_remove events'
);

-- Same for a cascade from the MENU ITEM side: the cart survives, its line is
-- removed because the dish was deleted by the vendor, not by the customer.
reset role;
insert into carts (id, customer_id, vendor_id, status)
values ('00000000-0000-7000-8000-0000000000c2', tests.get_supabase_uid('ce_customer_a'), '00000000-0000-7000-8000-0000000000a1', 'open');
insert into cart_items (id, cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, line_total_kobo)
values ('00000000-0000-7000-8000-0000000000d3', '00000000-0000-7000-8000-0000000000c2',
        '00000000-0000-7000-8000-0000000000b3', 'CE Moi Moi', 50000, 1, 50000);
delete from menu_items where id = '00000000-0000-7000-8000-0000000000b3';
select is(
  (select count(*)::int from customer_events where event_type = 'cart_remove'),
  1,
  'a cart line removed by the dish being deleted (FK cascade) does not fabricate cart_remove'
);

-- ---------------------------------------------------------------------------
-- cart trigger: dedupe, per-cart cap, rate limit, failure isolation
-- ---------------------------------------------------------------------------

reset role;
-- Earlier in this file d2 re-added the same item within 5 minutes of d1: the
-- cart_add for it was deduplicated, so customer_a still has ONE cart_add for b1.
select is(
  (select count(*)::int from customer_events
   where event_type = 'cart_add' and menu_item_id = '00000000-0000-7000-8000-0000000000b1'
     and customer_id = tests.get_supabase_uid('ce_customer_a')),
  1,
  'an identical cart_add within 5 minutes is deduplicated'
);

-- ...but once the window has passed, the same item is recorded again.
update customer_events set created_at = now() - interval '6 minutes'
where event_type = 'cart_add' and customer_id = tests.get_supabase_uid('ce_customer_a');
insert into cart_items (id, cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, line_total_kobo)
values ('00000000-0000-7000-8000-0000000000d4', '00000000-0000-7000-8000-0000000000c2',
        '00000000-0000-7000-8000-0000000000b1', 'CE Jollof', 150000, 1, 150000);
select is(
  (select count(*)::int from customer_events
   where event_type = 'cart_add' and menu_item_id = '00000000-0000-7000-8000-0000000000b1'
     and customer_id = tests.get_supabase_uid('ce_customer_a')),
  2,
  'a cart_add older than the 5-minute window is recorded again'
);

-- Per-cart cap: cart c2 already holds 1 line; 49 more reach 50, the 51st is refused.
select lives_ok(
  $$ insert into cart_items (cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, line_total_kobo)
     select '00000000-0000-7000-8000-0000000000c2', '00000000-0000-7000-8000-0000000000b1', 'CE Jollof', 150000, 1, 150000
     from generate_series(1, 49) $$,
  'a cart can be filled to 50 lines'
);
select throws_ok(
  $$ insert into cart_items (cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, line_total_kobo)
     values ('00000000-0000-7000-8000-0000000000c2', '00000000-0000-7000-8000-0000000000b1', 'CE Jollof', 150000, 1, 150000) $$,
  '23514',
  null,
  'the 51st line in a cart is rejected'
);

-- Trigger rate limit: at 300 events/hour a cart write succeeds but logs nothing.
insert into customer_events (customer_id, event_type, search_query)
select tests.get_supabase_uid('ce_customer_e'), 'search', 'e' || g from generate_series(1, 300) g;
insert into carts (id, customer_id, vendor_id, status)
values ('00000000-0000-7000-8000-0000000000c3', tests.get_supabase_uid('ce_customer_e'), '00000000-0000-7000-8000-0000000000a1', 'open');
select lives_ok(
  $$ insert into cart_items (cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, line_total_kobo)
     values ('00000000-0000-7000-8000-0000000000c3', '00000000-0000-7000-8000-0000000000b1', 'CE Jollof', 150000, 1, 150000) $$,
  'a cart write succeeds while the owner is rate limited'
);
select is(
  (select count(*)::int from customer_events where customer_id = tests.get_supabase_uid('ce_customer_e')),
  300,
  'the cart trigger honours the 300/hour ceiling (no cart_add logged)'
);

-- Erasure: marking the profile deleted removes only that user's events.
-- profiles.status is service-role-writable only (protect_profile_status, 0007).
select tests.authenticate_as_service_role();
update profiles set status = 'deleted' where id = tests.get_supabase_uid('ce_customer_e');
reset role;
select is(
  (select count(*)::int from customer_events where customer_id = tests.get_supabase_uid('ce_customer_e')),
  0,
  'marking a profile deleted erases that user''s customer_events'
);
select ok(
  (select count(*) from customer_events where customer_id = tests.get_supabase_uid('ce_customer_a')) > 0,
  'erasure leaves other users'' events alone'
);

-- Retention purge: >180d anything, >30d search; recent rows survive.
insert into customer_events (customer_id, event_type, vendor_id, search_query, created_at)
values
  (tests.get_supabase_uid('ce_customer_a'), 'view_vendor', '00000000-0000-7000-8000-0000000000a1', null, now() - interval '181 days'),
  (tests.get_supabase_uid('ce_customer_a'), 'view_vendor', '00000000-0000-7000-8000-0000000000a1', null, now() - interval '100 days'),
  (tests.get_supabase_uid('ce_customer_a'), 'search', null, 'purge-old-search', now() - interval '31 days'),
  (tests.get_supabase_uid('ce_customer_a'), 'search', null, 'purge-recent-search', now() - interval '29 days');
select tests.authenticate_as('ce_customer_a');
select throws_ok($$ select purge_customer_events() $$, '42501', null, 'authenticated cannot run the retention purge');
select tests.clear_authentication();
select throws_ok($$ select purge_customer_events() $$, '42501', null, 'anon cannot run the retention purge');
select tests.authenticate_as_service_role();
select cmp_ok(purge_customer_events(), '>=', 2::bigint, 'the purge reports the rows it deleted');
reset role;
select is(
  (select count(*)::int from customer_events
   where customer_id = tests.get_supabase_uid('ce_customer_a')
     and (created_at < now() - interval '180 days'
          or search_query = 'purge-old-search')),
  0,
  'events older than 180 days (and searches older than 30) are purged'
);
select is(
  (select count(*)::int from customer_events
   where customer_id = tests.get_supabase_uid('ce_customer_a')
     and (search_query = 'purge-recent-search'
          or (event_type = 'view_vendor' and created_at < now() - interval '99 days'))),
  2,
  'a 29-day-old search and a 100-day-old non-search event survive the purge'
);

-- Suspended caller (0082 guard) cannot log events.
select tests.authenticate_as_service_role();
update profiles set status = 'suspended' where id = tests.get_supabase_uid('ce_suspended');
reset role;
select tests.authenticate_as('ce_suspended');
select throws_ok(
  $$ select log_customer_event('view_vendor', '00000000-0000-7000-8000-0000000000a1') $$,
  '42501',
  null,
  'a suspended account cannot log events (_assert_active_caller)'
);
reset role;

-- A failing analytics write must never fail the cart write. Force the trigger's
-- insert to violate a CHECK (the handler downgrades it to a WARNING).
alter table customer_events add constraint ce_test_boom check (event_type = 'zzz') not valid;
select lives_ok(
  $$ delete from cart_items where id = '00000000-0000-7000-8000-0000000000d4' $$,
  'a cart DELETE survives a failing cart_remove event write'
);
select lives_ok(
  $$ insert into cart_items (id, cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, line_total_kobo)
     values ('00000000-0000-7000-8000-0000000000d5', '00000000-0000-7000-8000-0000000000c2',
             '00000000-0000-7000-8000-0000000000b1', 'CE Jollof', 150000, 1, 150000) $$,
  'a cart INSERT survives a failing cart_add event write'
);
select is(
  (select count(*)::int from cart_items where id = '00000000-0000-7000-8000-0000000000d5')
    - (select count(*)::int from cart_items where id = '00000000-0000-7000-8000-0000000000d4'),
  1,
  'the cart rows were really written/removed despite the trigger failure'
);
alter table customer_events drop constraint ce_test_boom;

-- ---------------------------------------------------------------------------
-- Rate limit: >= 300 events in the last hour -> silent no-op
-- ---------------------------------------------------------------------------

reset role;
insert into customer_events (customer_id, event_type, search_query)
select tests.get_supabase_uid('ce_customer_b'), 'search', 'q' || g
from generate_series(1, 300) g;

select tests.authenticate_as('ce_customer_b');
select lives_ok(
  $$ select log_customer_event('view_vendor', '00000000-0000-7000-8000-0000000000a1') $$,
  'a rate-limited call does not error'
);
select is(
  (select count(*)::int from customer_events),
  300,
  'once a caller has 300 events in the last hour further events are silently dropped'
);

-- Boundary: 299 events -> the next one is still logged (300th); the one after is dropped.
reset role;
insert into customer_events (customer_id, event_type, search_query)
select tests.get_supabase_uid('ce_customer_c'), 'search', 'q' || g
from generate_series(1, 299) g;
select tests.authenticate_as('ce_customer_c');
select lives_ok(
  $$ select log_customer_event('view_vendor', '00000000-0000-7000-8000-0000000000a1') $$,
  'at 299 events in the last hour a new event is still accepted'
);
select is((select count(*)::int from customer_events), 300, 'the 300th event was recorded');
select lives_ok(
  $$ select log_customer_event('search', null, null, 'one too many') $$,
  'the call after the 300th does not error'
);
select is((select count(*)::int from customer_events), 300, 'the 301st event within the hour is dropped');

-- Events older than an hour do not count toward the limit.
reset role;
insert into customer_events (customer_id, event_type, search_query, created_at)
select tests.get_supabase_uid('ce_customer_d'), 'search', 'old' || g, now() - interval '2 hours'
from generate_series(1, 300) g;
select tests.authenticate_as('ce_customer_d');
select lives_ok(
  $$ select log_customer_event('view_vendor', '00000000-0000-7000-8000-0000000000a1') $$,
  'with 300 events older than an hour a new event is accepted'
);
select is((select count(*)::int from customer_events), 301, 'events older than an hour do not count toward the rate limit');

select * from finish();
rollback;
