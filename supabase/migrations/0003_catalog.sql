-- KiaKia — Phase 0 foundation migration 3/7.
-- Catalog: service_areas (§15, first-class per v0.3), vendors, menu.

-- ---------------------------------------------------------------------------
-- service_areas — §15. Checkout validates delivery addresses against this
-- with ST_Contains; vendors are also scoped to one area.
-- ---------------------------------------------------------------------------

create table service_areas (
  id                       uuid primary key default uuid_generate_v7(),
  name                     text not null,
  polygon                  geography(polygon, 4326) not null,
  is_active                boolean not null default false,
  base_delivery_fee_kobo   bigint not null check (base_delivery_fee_kobo >= 0),
  per_km_fee_kobo          bigint not null check (per_km_fee_kobo >= 0),
  free_above_kobo          bigint check (free_above_kobo >= 0),
  launched_at              timestamptz,
  created_at               timestamptz not null default now()
);

comment on table service_areas is
  'First-class launch geography object per §15. Jabi-Utako corridor is seeded in supabase/seed.sql once real coordinates are surveyed (§15 validation gate) — placeholder-free by design, so an empty table is the honest state until that survey happens.';

create index service_areas_polygon_idx on service_areas using gist (polygon);

-- ---------------------------------------------------------------------------
-- vendors
-- ---------------------------------------------------------------------------

create table vendors (
  id                   uuid primary key default uuid_generate_v7(),
  owner_user_id        uuid not null references auth.users (id),
  service_area_id      uuid references service_areas (id),
  name                 text not null,
  slug                 text not null unique,
  description          text,
  category             text not null default 'food', -- generic on purpose, §23: "ship food only, schema allows the pivot"
  address_line         text,
  landmark             text,
  location             geography(point, 4326),
  logo_url             text,
  banner_url           text,
  status               text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  kyc_status           text not null default 'pending' check (kyc_status in ('pending', 'approved', 'rejected')),
  opening_hours        jsonb not null default '{}'::jsonb,
  avg_prep_mins        integer not null default 20 check (avg_prep_mins > 0),
  min_order_kobo       bigint not null default 0 check (min_order_kobo >= 0),
  delivery_radius_m    integer not null default 3000 check (delivery_radius_m > 0),
  commission_bps       integer not null default 1500 check (commission_bps between 0 and 10000),
  is_accepting_orders  boolean not null default false,
  rating_avg           numeric(3, 2) not null default 0 check (rating_avg between 0 and 5),
  rating_count         integer not null default 0 check (rating_count >= 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table vendors is
  'A vendor outside every active service_area cannot be listed — enforced by application logic reading is_accepting_orders + service_areas.is_active, per §15.';

create index vendors_service_area_id_idx on vendors (service_area_id);
create index vendors_location_idx on vendors using gist (location);
create index vendors_slug_idx on vendors (slug);

create trigger vendors_set_updated_at
  before update on vendors
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- vendor_staff
-- ---------------------------------------------------------------------------

create table vendor_staff (
  vendor_id   uuid not null references vendors (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('vendor_staff', 'vendor_manager', 'vendor_owner')),
  created_at  timestamptz not null default now(),
  primary key (vendor_id, user_id)
);

create index vendor_staff_user_id_idx on vendor_staff (user_id);

-- ---------------------------------------------------------------------------
-- menu_categories / menu_items / option_groups / options
-- ---------------------------------------------------------------------------

create table menu_categories (
  id          uuid primary key default uuid_generate_v7(),
  vendor_id   uuid not null references vendors (id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true
);

create index menu_categories_vendor_id_idx on menu_categories (vendor_id);

create table menu_items (
  id            uuid primary key default uuid_generate_v7(),
  vendor_id     uuid not null references vendors (id) on delete cascade,
  category_id   uuid references menu_categories (id) on delete set null,
  name          text not null,
  description   text,
  image_url     text,
  price_kobo    bigint not null check (price_kobo >= 0),
  prep_mins     integer check (prep_mins > 0),
  is_available  boolean not null default true,
  sort_order    integer not null default 0,
  tags          text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table menu_items is
  'price_kobo here is the current price. order_items snapshots it at purchase time — §9: "a vendor editing a menu must never mutate a historical receipt."';

create index menu_items_vendor_id_idx on menu_items (vendor_id);
create index menu_items_category_id_idx on menu_items (category_id);

create trigger menu_items_set_updated_at
  before update on menu_items
  for each row execute function set_updated_at();

create table option_groups (
  id            uuid primary key default uuid_generate_v7(),
  menu_item_id  uuid not null references menu_items (id) on delete cascade,
  name          text not null,
  min_select    integer not null default 0 check (min_select >= 0),
  max_select    integer not null default 1 check (max_select >= 1),
  is_required   boolean not null default false,
  check (max_select >= min_select)
);

create index option_groups_menu_item_id_idx on option_groups (menu_item_id);

create table options (
  id                uuid primary key default uuid_generate_v7(),
  group_id          uuid not null references option_groups (id) on delete cascade,
  name              text not null,
  price_delta_kobo  bigint not null default 0,
  is_available      boolean not null default true
);

create index options_group_id_idx on options (group_id);
