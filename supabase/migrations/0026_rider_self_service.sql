-- KiaKia — the missing rider backend surface, part 1/3: rider self-service
-- RPCs and the live-location plumbing that feeds the customer's tracking
-- map. The rider mobile app is a SEPARATE application built outside this
-- repo — it calls Supabase directly via the client SDK with a rider's own
-- JWT — so no rider UI belongs here; this migration only builds the backend
-- contract it consumes.
--
-- WHY THIS MIGRATION HAS TO EXIST — dispatch_order_to_nearby_riders()
-- (0019_rider_dispatch.sql, hardened in 0023) selects riders `where
-- r.is_online and r.kyc_status = 'approved' and r.current_location is not
-- null`, and all three of those were previously unreachable: 0007_rls.sql
-- does `revoke insert, update, delete on riders from authenticated` and no
-- RPC anywhere created a rider row, flipped is_online, or wrote
-- current_location. Dispatch could therefore never offer an order to
-- anyone — the entire rider half of the product was inert. The four RPCs
-- below are the only writers of those columns, each re-deriving/guarding
-- exactly the invariant that matters (a rider can only ever write their OWN
-- row; kyc_status is admin-only; going online requires prior KYC approval).

-- ---------------------------------------------------------------------------
-- register_rider() — upsert semantics on the CALLER'S OWN riders row.
-- Deliberately has no p_kyc_status / p_is_online parameters at all: a rider
-- must never be able to self-approve or self-activate, and the simplest way
-- to guarantee that is to never accept those values as input in the first
-- place, rather than accepting-then-ignoring them.
-- ---------------------------------------------------------------------------

create or replace function register_rider(
  p_vehicle_type text,
  p_plate_number text
)
returns riders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider riders;
begin
  -- Upsert on the caller's own row (user_id = auth.uid(), the table's
  -- primary key — see 0002_identity.sql). kyc_status and is_online are
  -- OMITTED from both the insert column list's overridable values and the
  -- ON CONFLICT DO UPDATE SET clause: on first insert they take their
  -- column defaults ('pending' / false — 0002_identity.sql), and on a
  -- repeat call (safe to call twice, e.g. the rider app re-submitting
  -- vehicle details) they are left completely untouched at whatever an
  -- admin RPC (approve_rider/reject_rider, 0028) or set_rider_online (below)
  -- last set them to.
  insert into riders (user_id, vehicle_type, plate_number)
  values (auth.uid(), p_vehicle_type, p_plate_number)
  on conflict (user_id) do update set
    vehicle_type = excluded.vehicle_type,
    plate_number = excluded.plate_number
  returning * into v_rider;

  -- Mirrors register_vendor()'s own elevation step (0009_register_vendor.sql):
  -- holding the 'rider' role is what the permission model (§13) expects to
  -- exist alongside a riders row, even though nothing in this repo currently
  -- checks user_roles for rider-ness (authorization here is entirely via the
  -- riders table itself). on conflict do nothing makes this safe to call
  -- every time register_rider() is, not just the first.
  insert into user_roles (user_id, role)
  values (auth.uid(), 'rider')
  on conflict do nothing;

  return v_rider;
end;
$$;

comment on function register_rider(text, text) is
  'Creates/updates the caller''s OWN riders row. kyc_status stays ''pending'' on first insert and is untouched on every later call — this function has no parameter that could ever set it, so a rider can never self-approve. Safe to call repeatedly (upsert on user_id).';

revoke execute on function register_rider(text, text) from public;
grant execute on function register_rider(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- set_rider_online() — the caller's own is_online flag. Going online
-- requires kyc_status = 'approved'; going offline is always allowed
-- (a rider must always be able to take themselves out of rotation,
-- regardless of KYC state).
-- ---------------------------------------------------------------------------

create or replace function set_rider_online(p_is_online boolean)
returns riders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider riders;
begin
  select * into v_rider from riders where user_id = auth.uid() for update;
  if not found then
    raise exception 'set_rider_online: no rider row for the caller — call register_rider() first'
      using errcode = 'no_data_found';
  end if;

  if p_is_online and v_rider.kyc_status <> 'approved' then
    raise exception 'set_rider_online: rider % is not kyc-approved (status=%) — cannot go online', auth.uid(), v_rider.kyc_status;
  end if;

  update riders set is_online = p_is_online where user_id = auth.uid()
  returning * into v_rider;

  return v_rider;
end;
$$;

comment on function set_rider_online(boolean) is
  'Sets the caller''s OWN riders.is_online. Going online (true) requires kyc_status = ''approved'' — the same gate dispatch_order_to_nearby_riders() and accept_dispatch_offer() already enforce on read (0023_rider_dispatch_kyc_hardening.sql), enforced here too so a pending/rejected rider cannot even flip the flag that would otherwise make them dispatch-eligible the moment KYC is later approved. Going offline is always allowed.';

revoke execute on function set_rider_online(boolean) from public;
grant execute on function set_rider_online(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- decline_dispatch_offer() — the CALLER's own 'offered' row only. Mirrors
-- accept_dispatch_offer()'s authorization shape (0019/0023) but touches only
-- dispatch_offers, never orders — declining never assigns or unassigns
-- anything, another rider's offer for the same order is untouched.
-- ---------------------------------------------------------------------------

create or replace function decline_dispatch_offer(p_order_id uuid)
returns dispatch_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer dispatch_offers;
begin
  update dispatch_offers
  set status = 'declined', responded_at = now()
  where order_id = p_order_id and rider_id = auth.uid() and status = 'offered'
  returning * into v_offer;

  if not found then
    raise exception 'decline_dispatch_offer: no active offer for rider % on order %', auth.uid(), p_order_id
      using errcode = 'no_data_found';
  end if;

  return v_offer;
end;
$$;

comment on function decline_dispatch_offer(uuid) is
  'Marks the CALLER''S OWN ''offered'' dispatch_offers row as ''declined''. Scoped by rider_id = auth.uid() in the UPDATE''s WHERE clause itself (not just checked-then-updated), so this can never affect another rider''s offer for the same order, and never touches orders — accept_dispatch_offer() (0019/0023) remains the only path that assigns a rider.';

revoke execute on function decline_dispatch_offer(uuid) from public;
grant execute on function decline_dispatch_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- order_rider_locations — the map's data source. A deliberate separate
-- table rather than reading riders.current_location directly, for two
-- independent reasons:
--
--   1. riders.current_location is a PostGIS geography, which serializes as
--      raw WKB hex over PostgREST/Realtime — unusable by a map client
--      without a server-side decode step that doesn't exist anywhere in
--      this stack yet. This table stores plain `double precision` lat/lng
--      instead, exactly what a map SDK wants.
--   2. riders RLS (0007_rls.sql) is "read own rider row" only — a customer
--      can never read the assigned rider's row directly, by design (a
--      rider's identity/location shouldn't be broadly queryable). A
--      dedicated per-ORDER table solves both problems: it's scoped to
--      exactly the one order in flight, not to every rider's live position,
--      and it's shaped for a map client already.
--
-- TERMINAL-ORDER VISIBILITY — chosen approach: DELETE the row on terminal
-- transition (trigger below), not an RLS predicate that filters by order
-- status. Reasoning: update_rider_location() (below) already only writes
-- rows for orders in an in-flight status, so the delete-on-terminal trigger
-- is the only piece needed to stop a stale position from remaining visible
-- once an order reaches delivered/cancelled/failed_delivery/rejected —
-- after which get_order_tracking() (0027) naturally returns NULL rider_lat/
-- rider_lng via its LEFT JOIN, same as "no rider assigned yet". This also
-- keeps the table from accumulating one permanent row per historical order
-- forever, which a status-filtered-read-only RLS policy would not prevent.
-- ---------------------------------------------------------------------------

create table order_rider_locations (
  order_id    uuid primary key references orders (id),
  rider_id    uuid not null references riders (user_id),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  updated_at  timestamptz not null default now()
);

comment on table order_rider_locations is
  'One row per order currently being tracked, holding the assigned rider''s last-known plain lat/lng (not a PostGIS geography — see this migration''s header for why). Written only by update_rider_location() (SECURITY DEFINER, this migration) and deleted by a trigger the moment the order reaches a terminal status — no authenticated-reachable write path exists at all.';

create index order_rider_locations_rider_id_idx on order_rider_locations (rider_id);

alter table order_rider_locations enable row level security;

create policy "customer reads own order's rider location" on order_rider_locations for select
  using (exists (
    select 1 from orders
    where orders.id = order_rider_locations.order_id and orders.customer_id = auth.uid()
  ));

create policy "vendor staff read their order's rider location" on order_rider_locations for select
  using (exists (
    select 1 from orders
    join vendor_staff on vendor_staff.vendor_id = orders.vendor_id
    where orders.id = order_rider_locations.order_id and vendor_staff.user_id = auth.uid()
  ));

create policy "admin reads any order's rider location" on order_rider_locations for select
  using (exists (
    select 1 from user_roles where user_id = auth.uid() and role in ('admin', 'superadmin')
  ));

revoke insert, update, delete on order_rider_locations from authenticated;

-- ---------------------------------------------------------------------------
-- update_rider_location() — the only writer of riders.current_location /
-- last_ping_at and of order_rider_locations. Called by the rider app on
-- every location ping (typically every few seconds while online / while an
-- order is in progress).
-- ---------------------------------------------------------------------------

create or replace function update_rider_location(
  p_lat double precision,
  p_lng double precision
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lat < -90 or p_lat > 90 then
    raise exception 'update_rider_location: lat % is out of range [-90, 90]', p_lat
      using errcode = 'check_violation';
  end if;
  if p_lng < -180 or p_lng > 180 then
    raise exception 'update_rider_location: lng % is out of range [-180, 180]', p_lng
      using errcode = 'check_violation';
  end if;

  -- NOTE the argument order: st_point(x, y) = st_point(lng, lat). Passing
  -- (lat, lng) here would be the classic PostGIS longitude/latitude swap
  -- bug — silently placing every rider at the antipode-ish wrong spot for
  -- most of the globe rather than erroring, so it's called out explicitly.
  -- st_setsrid(..., 4326) is explicit rather than relying on st_point's
  -- default SRID-0-is-treated-as-4326 behavior on cast to geography — same
  -- WGS84 SRID every other geography column in this schema uses
  -- (geography(point, 4326), see 0002/0003/0004_*.sql).
  update riders
  set current_location = st_setsrid(st_point(p_lng, p_lat), 4326)::geography,
      last_ping_at = now()
  where user_id = auth.uid();

  if not found then
    raise exception 'update_rider_location: no rider row for the caller — call register_rider() first'
      using errcode = 'no_data_found';
  end if;

  -- Fan the same ping out to every order this rider currently has in
  -- flight — this is what makes the customer's live map work (see this
  -- migration's order_rider_locations header comment). A rider is not
  -- expected to have more than one such order in the normal flow, but this
  -- is written to not assume that: it upserts one row per matching order,
  -- not just the most recent one.
  insert into order_rider_locations (order_id, rider_id, lat, lng, updated_at)
  select o.id, auth.uid(), p_lat, p_lng, now()
  from orders o
  where o.rider_id = auth.uid()
    and o.status in ('rider_assigned', 'picked_up', 'in_transit', 'arrived')
  on conflict (order_id) do update set
    rider_id   = excluded.rider_id,
    lat        = excluded.lat,
    lng        = excluded.lng,
    updated_at = excluded.updated_at;
end;
$$;

comment on function update_rider_location(double precision, double precision) is
  'Validates lat/lng range (raises, never clamps), sets the caller''s OWN riders.current_location + last_ping_at, and upserts order_rider_locations for every order currently assigned to this rider with status in (rider_assigned, picked_up, in_transit, arrived) — this fan-out is what feeds the customer tracking map (get_order_tracking, 0027). Never touches another rider''s row.';

revoke execute on function update_rider_location(double precision, double precision) from public;
grant execute on function update_rider_location(double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- Cleanup trigger — deletes an order's order_rider_locations row the
-- instant that order reaches a terminal status, per this migration's
-- header ("TERMINAL-ORDER VISIBILITY"). Terminal set mirrors
-- packages/domain/src/order-state-machine.ts's TERMINAL_STATUSES exactly —
-- keep both in sync, same convention as transition_order()/
-- order_status_transitions already follow.
-- ---------------------------------------------------------------------------

create or replace function clear_order_rider_location_on_terminal_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from order_rider_locations where order_id = new.id;
  return new;
end;
$$;

comment on function clear_order_rider_location_on_terminal_status() is
  'AFTER UPDATE OF status trigger on orders: deletes this order''s order_rider_locations row (if any) the moment it reaches a terminal status, so a delivered/cancelled/failed/rejected order never keeps exposing a rider''s live position. SECURITY DEFINER because order_rider_locations has no authenticated-reachable write path at all.';

create trigger orders_clear_rider_location_on_terminal
  after update of status on orders
  for each row
  when (
    new.status in ('delivered', 'rejected_by_vendor', 'failed_delivery', 'cancelled_by_customer', 'cancelled_by_platform')
    and old.status is distinct from new.status
  )
  execute function clear_order_rider_location_on_terminal_status();

-- ---------------------------------------------------------------------------
-- Realtime — no prior migration configures supabase_realtime at all,
-- despite 0006_transition_order.sql's own comment ("a Postgres Changes
-- subscription on `orders` propagates it over Realtime, §8") assuming it
-- would be. Adds `orders` (live status) and `order_rider_locations` (live
-- position) so the customer's tracking page can subscribe to both. Written
-- defensively idempotent: a bare `alter publication ... add table` errors
-- if the table is already a member, which would break a second run of this
-- migration set against an environment where the publication was configured
-- some other way already (e.g. the Supabase dashboard, or a future
-- `supabase db push` re-run).
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table orders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_rider_locations'
  ) then
    alter publication supabase_realtime add table order_rider_locations;
  end if;
end $$;
