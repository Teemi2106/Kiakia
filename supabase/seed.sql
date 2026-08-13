-- Local development seed data only. Run automatically by `supabase db reset`.
-- Never applied to staging/production (those get real vendor/rider data
-- through normal onboarding, not this file).
--
-- Intentionally NOT seeding the real Jabi-Utako polygon here: real launch
-- geography needs the §15 validation gate (five vendor commitments, ten
-- rider interviews, three timed deliveries) run first, and the actual
-- surveyed coordinates. Seeding a fabricated polygon under that name would
-- be worse than seeding nothing — it would look authoritative and isn't.
-- What follows is a clearly-synthetic square so local development has
-- something to test area-containment checkout logic against.

insert into service_areas (name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, free_above_kobo)
values (
  'Synthetic Dev Area (not a real launch polygon)',
  st_geogfromtext('POLYGON((7.4 9.0, 7.5 9.0, 7.5 9.1, 7.4 9.1, 7.4 9.0))'),
  true,
  50000,  -- ₦500 base delivery fee
  15000,  -- ₦150 per km
  1000000 -- free delivery above ₦10,000
);

-- ---------------------------------------------------------------------------
-- Dummy vendors — apps/web's (customer)/home/page.tsx currently renders
-- DUMMY_VENDORS (a hardcoded mock array, `useDummyData = true`) instead of
-- querying `vendors`, so every card on /home links to a /vendors/[slug]
-- that has never existed in the database and 404s. This block gives those
-- exact slugs real, active rows so the links resolve locally. It is a
-- workaround for that mock flag, not new fixture data in its own right —
-- delete this block (and flip `useDummyData` to false) together.
--
-- vendors.owner_user_id is `not null references auth.users`, so each vendor
-- needs a backing auth user first; `handle_new_auth_user()` (0002_identity.sql)
-- fires on that insert and provisions the matching profiles/user_roles rows
-- automatically. auth.identities is seeded too, alongside auth.users —
-- without it GoTrue has nothing to match on password grant and email/password
-- sign-in fails even though the row in auth.users looks right.
--
-- A temp table (not a chained CTE) holds the fixture rows here on purpose:
-- every downstream insert below needs to re-read it, and a writable CTE's
-- row can only be RETURNING'd once.
--
-- No `on commit drop`: `supabase db reset` runs this file through psql in
-- autocommit mode, so every top-level statement is its own transaction —
-- `on commit drop` would drop the table right after the `create` statement
-- commits, before the next `insert` ever ran. Left at its default (session
-- scoped), it lives for the rest of this psql connection and is cleaned up
-- automatically when that connection closes at the end of the script.
-- ---------------------------------------------------------------------------

create temporary table tmp_dummy_vendors (
  owner_id            uuid,
  vendor_id           uuid,
  category_id         uuid,
  name                text,
  slug                text,
  category            text,
  avg_prep_mins       integer,
  is_accepting_orders boolean,
  rating_avg          numeric,
  rating_count        integer
);

insert into tmp_dummy_vendors (owner_id, vendor_id, category_id, name, slug, category, avg_prep_mins, is_accepting_orders, rating_avg, rating_count)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'The Place',     'the-place',     'Jollof',  25, true,  4.8, 234),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Mama Cass',     'mama-cass',     'Soups',   20, true,  4.6, 189),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Kitchen Muse',  'kitchen-muse',  'Grills',  30, true,  4.7, 156),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', 'Iyan Aladuke',  'iyan-aladuke',  'Swallow', 15, true,  4.9, 312),
  ('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', 'Tasty Bites',   'tasty-bites',   'Sides',   10, false, 4.3, 98),
  ('10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000006', 'Spice Haven',   'spice-haven',   'Drinks',  12, true,  4.5, 145),
  ('10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000007', 'Naija Kitchen', 'naija-kitchen', 'Jollof',  28, true,  4.4, 201),
  ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000008', 'Soul Food',     'soul-food',     'Grills',  22, false, 4.2, 87);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000', dv.owner_id, 'authenticated', 'authenticated',
  dv.slug || '@dev-vendors.kiakia.local',
  crypt('dev-seed-only', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', dv.name || ' Owner'),
  now(), now(),
  '', '', '', ''
from tmp_dummy_vendors dv
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), dv.owner_id, dv.owner_id::text,
  jsonb_build_object('sub', dv.owner_id::text, 'email', dv.slug || '@dev-vendors.kiakia.local', 'email_verified', true),
  'email', now(), now(), now()
from tmp_dummy_vendors dv
on conflict (provider_id, provider) do nothing;

insert into vendors (id, owner_user_id, service_area_id, name, slug, category, status, is_accepting_orders, avg_prep_mins, rating_avg, rating_count)
select
  dv.vendor_id, dv.owner_id,
  (select id from service_areas where name = 'Synthetic Dev Area (not a real launch polygon)'),
  dv.name, dv.slug, dv.category, 'active', dv.is_accepting_orders, dv.avg_prep_mins, dv.rating_avg, dv.rating_count
from tmp_dummy_vendors dv
on conflict (id) do nothing;

insert into menu_categories (id, vendor_id, name, sort_order)
select dv.category_id, dv.vendor_id, 'Menu', 0
from tmp_dummy_vendors dv
on conflict (id) do nothing;

insert into menu_items (vendor_id, category_id, name, description, price_kobo, sort_order)
select dv.vendor_id, dv.category_id, item.name, item.description, item.price_kobo, item.sort_order
from tmp_dummy_vendors dv
join (
  values
    ('Jollof',  'Jollof Rice',     'Smoky party-style jollof rice',             250000, 0),
    ('Jollof',  'Fried Rice',      'Mixed vegetable fried rice',                250000, 1),
    ('Jollof',  'Coconut Rice',    'Rice cooked in coconut milk',               270000, 2),
    ('Soups',   'Egusi Soup',      'Ground melon seed soup with assorted meat', 300000, 0),
    ('Soups',   'Ogbono Soup',     'Draw soup with stockfish',                  300000, 1),
    ('Soups',   'Afang Soup',      'Vegetable soup, Cross River style',         320000, 2),
    ('Grills',  'Suya',            'Spiced grilled beef skewers',               200000, 0),
    ('Grills',  'Grilled Chicken', 'Half chicken, pepper-grilled',              350000, 1),
    ('Grills',  'Peppered Beef',   'Beef chunks in pepper sauce',               280000, 2),
    ('Swallow', 'Pounded Yam',     'Served with a soup of your choice',         150000, 0),
    ('Swallow', 'Eba',             'Garri swallow',                             100000, 1),
    ('Swallow', 'Amala',           'Yam flour swallow',                         120000, 2),
    ('Sides',   'Moin Moin',       'Steamed bean pudding',                      100000, 0),
    ('Sides',   'Puff Puff',       'Sweet fried dough balls',                    80000, 1),
    ('Sides',   'Fried Plantain',  'Ripe plantain, fried',                      100000, 2),
    ('Drinks',  'Chapman',         'Nigerian mocktail',                         150000, 0),
    ('Drinks',  'Zobo',            'Hibiscus drink',                            100000, 1),
    ('Drinks',  'Fresh Juice',     'Seasonal fruit juice',                      150000, 2)
) as item(category, name, description, price_kobo, sort_order)
  on item.category = dv.category;

-- ---------------------------------------------------------------------------
-- Dev customer login — every (customer)/* route (including the vendor pages
-- above) sits behind `verifySession()` (apps/web/src/lib/auth/dal.ts), which
-- round-trips to Supabase Auth and redirects to /login when there's no real
-- session. None of the fixture data above is reachable in a browser without
-- an actual account to log into, so this is that account:
--
--   email:    dev@kiakia.local
--   password: dev-seed-only
--
-- It also gets one saved address inside the Synthetic Dev Area polygon
-- above. Checkout's place_order() (0008_place_order.sql) rejects any
-- delivery location that ST_Contains doesn't place inside an active
-- service_area — and a real machine's actual geolocation (what the
-- checkout form's "use my location" button reports) almost certainly isn't
-- inside that tiny synthetic square, so testing checkout without a
-- preseeded in-polygon address means checkout can never succeed locally.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated',
  'dev@kiakia.local',
  crypt('dev-seed-only', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Dev Customer"}'::jsonb,
  now(), now(),
  '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  gen_random_uuid(), '10000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000009',
  '{"sub":"10000000-0000-0000-0000-000000000009","email":"dev@kiakia.local","email_verified":true}'::jsonb,
  'email', now(), now(), now()
)
on conflict (provider_id, provider) do nothing;

insert into addresses (customer_id, label, line1, landmark, city, state, location, is_default)
values (
  '10000000-0000-0000-0000-000000000009',
  'Home',
  '12 Test Close',
  'Near the synthetic dev polygon',
  'Abuja',
  'FCT',
  st_geogfromtext('POINT(7.45 9.05)'), -- inside the (7.4 9.0)-(7.5 9.1) square above
  true
)
on conflict do nothing;