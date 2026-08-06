-- KiaKia — Phase 0 foundation migration 4/7.
-- Ordering: single-vendor carts (§9), orders, order_items (price-snapshotted),
-- order_events (append-only audit trail written only by transition_order()).
--
-- order_status here is the exact set from packages/domain/src/order-state-machine.ts.
-- If you change one, change the other in the same commit — see that file's header comment.

create type order_status as enum (
  'draft', 'placed', 'accepted', 'rejected_by_vendor', 'preparing',
  'ready_for_pickup', 'rider_assigned', 'picked_up', 'in_transit', 'arrived',
  'delivered', 'failed_delivery', 'cancelled_by_customer', 'cancelled_by_platform'
);

-- ---------------------------------------------------------------------------
-- carts / cart_items — §9 "Single-vendor cart"
-- ---------------------------------------------------------------------------

create table carts (
  id           uuid primary key default uuid_generate_v7(),
  customer_id  uuid not null references auth.users (id) on delete cascade,
  vendor_id    uuid references vendors (id), -- set on first item add; nullable until then
  status       text not null default 'open' check (status in ('open', 'converted', 'abandoned')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table carts is
  'vendor_id is nullable until the first item is added, then fixed. Adding a different vendor''s item is rejected at the RPC layer (§9), not by a DB constraint, so the app can surface "Clear your cart to order from X?" instead of a raw error.';

-- One open cart per customer.
create unique index carts_one_open_per_customer
  on carts (customer_id)
  where status = 'open';

create trigger carts_set_updated_at
  before update on carts
  for each row execute function set_updated_at();

create table cart_items (
  id                uuid primary key default uuid_generate_v7(),
  cart_id           uuid not null references carts (id) on delete cascade,
  menu_item_id      uuid not null references menu_items (id),
  name_snapshot     text not null,
  unit_price_kobo   bigint not null check (unit_price_kobo >= 0),
  qty                integer not null check (qty > 0),
  options_snapshot  jsonb not null default '[]'::jsonb,
  line_total_kobo   bigint not null check (line_total_kobo >= 0)
);

create index cart_items_cart_id_idx on cart_items (cart_id);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

create sequence order_code_seq;

create or replace function next_order_code()
returns text
language sql
as $$
  select 'KK-' || to_char(nextval('order_code_seq'), 'FM000000');
$$;

create table orders (
  id                 uuid primary key default uuid_generate_v7(),
  code               text not null unique default next_order_code(),
  customer_id        uuid not null references auth.users (id),
  vendor_id          uuid not null references vendors (id),
  rider_id           uuid references riders (user_id),
  service_area_id    uuid references service_areas (id),
  status             order_status not null default 'draft',

  subtotal_kobo      bigint not null check (subtotal_kobo >= 0),
  delivery_fee_kobo  bigint not null default 0 check (delivery_fee_kobo >= 0),
  service_fee_kobo   bigint not null default 0 check (service_fee_kobo >= 0),
  discount_kobo      bigint not null default 0 check (discount_kobo >= 0),
  total_kobo         bigint not null check (total_kobo >= 0),

  payment_method     text check (payment_method in ('card', 'bank_transfer', 'ussd')), -- COD excluded from v1, §12
  payment_status     text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  promo_code         text,

  delivery_address   jsonb not null,
  delivery_location  geography(point, 4326) not null,
  delivery_note      text,
  distance_m         integer check (distance_m >= 0),

  placed_at          timestamptz,
  accepted_at        timestamptz,
  ready_at           timestamptz,
  assigned_at        timestamptz,
  picked_up_at       timestamptz,
  in_transit_at      timestamptz,
  arrived_at         timestamptz,
  delivered_at       timestamptz,
  cancelled_at       timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint orders_total_is_consistent
    check (total_kobo = subtotal_kobo + delivery_fee_kobo + service_fee_kobo - discount_kobo)
);

comment on table orders is
  'status is written ONLY by transition_order() (0006_transition_order.sql) — writes are revoked from authenticated in 0007_rls.sql. §10: "No other code path may write orders.status."';

create index orders_customer_id_idx on orders (customer_id);
create index orders_vendor_id_idx on orders (vendor_id);
create index orders_rider_id_idx on orders (rider_id);
create index orders_status_idx on orders (status);
create index orders_service_area_id_idx on orders (service_area_id);

create trigger orders_set_updated_at
  before update on orders
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- order_items — price/option snapshot at purchase time (§9)
-- ---------------------------------------------------------------------------

create table order_items (
  id                uuid primary key default uuid_generate_v7(),
  order_id          uuid not null references orders (id) on delete cascade,
  menu_item_id      uuid not null references menu_items (id),
  name_snapshot     text not null,
  unit_price_kobo   bigint not null check (unit_price_kobo >= 0),
  qty                integer not null check (qty > 0),
  options_snapshot  jsonb not null default '[]'::jsonb,
  line_total_kobo   bigint not null check (line_total_kobo >= 0)
);

create index order_items_order_id_idx on order_items (order_id);

-- ---------------------------------------------------------------------------
-- order_events — append-only, written only inside transition_order()
-- ---------------------------------------------------------------------------

create table order_events (
  id           uuid primary key default uuid_generate_v7(),
  order_id     uuid not null references orders (id) on delete cascade,
  from_status  order_status,
  to_status    order_status not null,
  actor_type   text not null check (actor_type in ('customer', 'vendor', 'rider', 'system', 'admin')),
  actor_id     uuid,
  at           timestamptz not null default now(),
  meta         jsonb not null default '{}'::jsonb
);

comment on table order_events is
  'Append-only audit trail. No update or delete policy exists for any role, including service-role callers, by convention — see §10.';

create index order_events_order_id_idx on order_events (order_id, at);
