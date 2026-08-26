-- KiaKia — closes two independently-found gaps:
--
-- GAP 1 (P1) — vendor location can never be set after registration.
-- `vendors.location` (geography(point,4326), 0003_catalog.sql) is nullable,
-- register_vendor() (0009_register_vendor.sql) only sets it if the caller
-- happens to pass p_location at signup time, and nothing else can ever write
-- it afterward: updateVendorSettingsAction (app/actions/vendor.ts) doesn't
-- touch it, and 0007_rls.sql revokes `update` on vendors from `authenticated`
-- outright, so no client write path exists at all. The consequence is silent
-- and severe: dispatch_order_to_nearby_riders() (0023) does
-- `select location into v_vendor_location from vendors where id =
-- new.vendor_id` and returns early, offering the ready_for_pickup order to
-- NOBODY, if that's null — no error, no visible log to anyone. place_order()
-- (0016/0022) already refuses outright with a raised exception when
-- v_vendor.location is null, so the very first order for a location-less
-- vendor never gets placed either. Fix: set_vendor_location(), a narrowly
-- scoped SECURITY DEFINER RPC mirroring register_vendor()/
-- update_rider_location()'s own conventions.
--
-- GAP 2 (P1) — riders can't read what they need to do their job.
--
-- (a) A rider cannot see what a dispatch offer is actually FOR before
-- deciding to accept it. dispatch_offers has "rider reads own offers"
-- (0019_rider_dispatch.sql) — a rider can see an offer row exists — but
-- `orders` RLS (0007_rls.sql) only covers the customer, the vendor's staff,
-- and the ALREADY-ASSIGNED rider (`rider_id = auth.uid()`); at offer time
-- orders.rider_id is still NULL by design (0019's own header), so that last
-- policy never matches for the very moment it would matter. Fix:
-- get_rider_offer_details(p_order_id), a SECURITY DEFINER RPC — deliberately
-- NOT a broadened `orders` RLS policy, see "Design guidance" reasoning below.
--
-- (b) A rider cannot read their own earnings. `accounts` and
-- `ledger_entries` have `revoke all ... from authenticated` (0007_rls.sql),
-- and `account_balances` additionally has `revoke all from anon,
-- authenticated` (0024_lock_down_account_balances_view.sql) after it was
-- found to leak every account's balance, platform included, to any
-- authenticated caller. verify_delivery_and_release_escrow() (0020/0022)
-- credits a rider's own `available` account on every completed delivery, but
-- the rider has no way to ever see that balance. Fix: get_rider_earnings(),
-- a SECURITY DEFINER RPC scoped to `owner_id = auth.uid()` rows only.
--
-- DESIGN GUIDANCE FOLLOWED — both rider-facing reads are narrowly-scoped
-- SECURITY DEFINER RPCs that hand back a bespoke row shape, NOT a broadened
-- table-level RLS policy on `orders`/`accounts`/`ledger_entries`/
-- `account_balances`. A blanket "riders can read orders" policy would let a
-- rider read the FULL orders row for any order they've ever been offered —
-- forever, even after losing/declining the offer — including customer_id,
-- payment_status, promo_code, and every other rider's dead offers on the
-- same order via a self-join. The RPCs below instead: (1) re-check
-- authorization on every call rather than relying on a row having ever
-- existed, (2) return only the columns operationally necessary to do the
-- job, (3) never return `order_delivery_codes.code` at all — that table's
-- own RLS (0022_delivery_code_off_orders.sql, "customer reads own order's
-- delivery code") is untouched by this migration, still scoped to the
-- customer alone, and neither RPC below even references that table.
-- `get_rider_earnings()` similarly returns only the CALLER's own
-- `owner_type = 'rider'` account balances, never another rider's, a
-- vendor's, or the platform's.

-- ---------------------------------------------------------------------------
-- set_vendor_location() — the only writer of vendors.location. Mirrors
-- update_rider_location()'s (0026_rider_self_service.sql) validate-then-
-- st_setsrid(st_point(lng, lat), 4326) shape exactly, and mirrors
-- transition_order()'s vendor branch / updateVendorSettingsAction's own
-- authorization idiom for "is this caller vendor staff on this vendor":
-- `exists (select 1 from vendor_staff where vendor_id = ... and user_id =
-- auth.uid())`, with no additional role-tier filter — neither of those two
-- existing call sites distinguishes vendor_staff/vendor_manager/vendor_owner
-- for its own write, so this doesn't invent a new authorization idiom by
-- adding one here either.
-- ---------------------------------------------------------------------------

create or replace function set_vendor_location(
  p_vendor_id uuid,
  p_lat       double precision,
  p_lng       double precision
)
returns vendors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor vendors;
begin
  -- Authorization: caller must be vendor_staff on this vendor. Same
  -- membership-existence check transition_order()'s vendor branch
  -- (0006/0018/0030) and updateVendorSettingsAction (app/actions/vendor.ts)
  -- already use — not re-deriving a new predicate for this write.
  if not exists (
    select 1 from vendor_staff where vendor_id = p_vendor_id and user_id = auth.uid()
  ) then
    raise exception 'set_vendor_location: actor % is not staff on vendor %', auth.uid(), p_vendor_id;
  end if;

  -- Validate, never clamp — same posture update_rider_location() takes on
  -- the exact same lat/lng domain.
  if p_lat < -90 or p_lat > 90 then
    raise exception 'set_vendor_location: lat % is out of range [-90, 90]', p_lat
      using errcode = 'check_violation';
  end if;
  if p_lng < -180 or p_lng > 180 then
    raise exception 'set_vendor_location: lng % is out of range [-180, 180]', p_lng
      using errcode = 'check_violation';
  end if;

  -- NOTE the argument order: st_point(x, y) = st_point(lng, lat). Passing
  -- (lat, lng) here would be the classic PostGIS longitude/latitude swap
  -- bug — silently placing the vendor at the wrong spot for most of the
  -- globe rather than erroring. st_setsrid(..., 4326) explicit, same
  -- reasoning update_rider_location() (0026) already documents: every other
  -- geography column in this schema is WGS84 (geography(point, 4326)) and
  -- this must match it exactly, not rely on an implicit-SRID cast.
  update vendors
  set location = st_setsrid(st_point(p_lng, p_lat), 4326)::geography
  where id = p_vendor_id
  returning * into v_vendor;

  if not found then
    -- Can only happen if p_vendor_id was deleted between the vendor_staff
    -- check above and this update, inside the same statement's snapshot —
    -- included for the same defensive reasons other functions in this set
    -- check `not found` after their own UPDATE ... RETURNING.
    raise exception 'set_vendor_location: vendor % does not exist', p_vendor_id
      using errcode = 'no_data_found';
  end if;

  return v_vendor;
end;
$$;

comment on function set_vendor_location(uuid, double precision, double precision) is
  'The only writer of vendors.location outside register_vendor()''s own optional p_location argument at signup. Authorization is vendor_staff membership on p_vendor_id (any role tier), same idiom transition_order()''s vendor branch and updateVendorSettingsAction already use. Validates lat/lng range (raises, never clamps) and uses the lng-then-lat st_point argument order explicitly, same convention as update_rider_location() (0026_rider_self_service.sql). Closes the gap where dispatch_order_to_nearby_riders() (0023) silently offers a location-less vendor''s ready_for_pickup order to nobody, and place_order() (0016/0022) refuses to place an order at all for such a vendor.';

revoke execute on function set_vendor_location(uuid, double precision, double precision) from public;
grant execute on function set_vendor_location(uuid, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- get_rider_offer_details() — lets a rider see what a dispatch offer is FOR
-- before deciding whether to accept it, and lets the assigned rider re-read
-- the same details afterward (e.g. app restart). Deliberately NOT
-- `returns orders` (unlike accept_dispatch_offer/transition_order/
-- place_order/capture_payment) — this function owns its own narrow return
-- shape precisely so it can never accidentally hand back a column nobody
-- reviewed for rider-exposure, the same trap 0022's file header describes
-- for `returns orders` more generally.
-- ---------------------------------------------------------------------------

create or replace function get_rider_offer_details(p_order_id uuid)
returns table (
  order_code          text,
  status              text,
  vendor_name         text,
  vendor_address_line text,
  vendor_landmark     text,
  pickup_lat          double precision,
  pickup_lng          double precision,
  dropoff_lat         double precision,
  dropoff_lng         double precision,
  delivery_address    jsonb,
  delivery_note       text,
  item_count          integer,
  total_kobo          bigint,
  delivery_fee_kobo   bigint,
  distance_m          integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  orders;
  v_vendor vendors;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'get_rider_offer_details: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- Authorization: the caller must either (a) hold a live dispatch_offers
  -- row on this order that is still 'offered' or has become 'accepted', or
  -- (b) already be the assigned rider on the order itself. (b) is normally
  -- implied by (a) (accept_dispatch_offer always flips the accepting
  -- rider's own row to 'accepted' in the same transaction it sets
  -- orders.rider_id — 0019/0023/0028), but is checked independently anyway,
  -- same defensive-redundancy style transition_order()'s explicit
  -- transitions-table check already follows even where an edge is "known to
  -- exist". A rider whose offer has expired/been declined, or who was never
  -- offered this order at all, gets neither — that's the whole point: this
  -- is NOT "any rider may read any order", it's scoped per-row and
  -- re-checked on every call, never cached from having once had an offer.
  --
  -- auth.uid() IS NULL is rejected FIRST, explicitly — an unauthenticated
  -- caller on an order that has no rider assigned yet (v_order.rider_id also
  -- NULL, the normal state at offer time) would otherwise slip through: `NULL
  -- IS DISTINCT FROM NULL` is FALSE, which would make the second half of an
  -- `... and auth.uid() is distinct from v_order.rider_id` check pass by
  -- accident for a caller with no session at all. Same NULL-safety reasoning
  -- verify_delivery_and_release_escrow() (0020/0022) already applies with its
  -- own explicit `auth.uid() is null or v_order.rider_id is null or ...`
  -- guard.
  if auth.uid() is null then
    raise exception 'get_rider_offer_details: no authenticated caller';
  end if;

  if not exists (
    select 1 from dispatch_offers
    where order_id = p_order_id and rider_id = auth.uid() and status in ('offered', 'accepted')
  ) and auth.uid() is distinct from v_order.rider_id then
    raise exception 'get_rider_offer_details: actor % has no active offer or assignment on order %', auth.uid(), p_order_id;
  end if;

  select * into v_vendor from vendors where id = v_order.vendor_id;

  return query
  select
    v_order.code,
    v_order.status::text,
    v_vendor.name,
    v_vendor.address_line,
    v_vendor.landmark,
    st_y(v_vendor.location::geometry),
    st_x(v_vendor.location::geometry),
    st_y(v_order.delivery_location::geometry),
    st_x(v_order.delivery_location::geometry),
    v_order.delivery_address,
    v_order.delivery_note,
    (select coalesce(sum(qty), 0)::integer from order_items where order_id = v_order.id),
    v_order.total_kobo,
    v_order.delivery_fee_kobo,
    v_order.distance_m;
end;
$$;

comment on function get_rider_offer_details(uuid) is
  'What a rider may see about an order they have been offered (or are assigned to) BEFORE the customer''s delivery_code is ever relevant: order code/status, the vendor''s name/address/landmark and pickup coordinates, the customer''s delivery_address/delivery_note/dropoff coordinates (no customer name/email/phone — that jsonb shape is exactly {line1,landmark,city,state}, already readable in full by vendor staff via the plain orders RLS policy, see 0007_rls.sql), item count, total_kobo, delivery_fee_kobo, and distance_m. Deliberately excludes customer_id, payment_status, promo_code, and every column of order_delivery_codes — the delivery-code table is not referenced here at all and its RLS (0022_delivery_code_off_orders.sql) is untouched, still scoped to the customer alone. Authorized to a rider with a live (offered/accepted) dispatch_offers row on this order, or the order''s assigned rider — nobody else, and not derived from RLS on orders/dispatch_offers directly (see this migration''s header on why an RPC was chosen over broadening table RLS).';

revoke execute on function get_rider_offer_details(uuid) from public;
grant execute on function get_rider_offer_details(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_rider_earnings() — the only read path for a rider's own ledger
-- balances. Reads account_balances (locked down to service_role only by
-- 0024_lock_down_account_balances_view.sql) from inside a SECURITY DEFINER
-- function, which is exactly the "vendor/rider-facing earnings surfaces...
-- will get their own narrowly-scoped read policy or RPC" 0024's own comment
-- anticipated, not a reopening of that view's grants.
-- ---------------------------------------------------------------------------

create or replace function get_rider_earnings()
returns table (
  account_kind  text,
  balance_kobo  bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'get_rider_earnings: no authenticated caller';
  end if;

  -- Scoped by owner_id = auth.uid() in the query itself, not merely
  -- checked-then-queried — this can never return another rider's, a
  -- vendor's, or the platform's account balance regardless of how the
  -- function is called. Zero rows (not an error) when the caller has never
  -- had a ledger entry yet (e.g. hasn't completed a delivery) — same
  -- "absence is a normal, non-exceptional state" posture
  -- get_order_tracking()'s NULL rider_lat/rider_lng already takes.
  return query
  select a.kind, coalesce(b.balance_kobo, 0)
  from accounts a
  left join account_balances b on b.account_id = a.id
  where a.owner_type = 'rider' and a.owner_id = auth.uid();
end;
$$;

comment on function get_rider_earnings() is
  'The only path by which a rider can read their own ledger balance(s) — accounts/ledger_entries/account_balances all revoke every grant from authenticated (0007_rls.sql, 0024_lock_down_account_balances_view.sql) by design, since a blanket read grant on any of those would expose every other rider''s, every vendor''s, and the platform''s money. Scoped to `owner_type = ''rider'' and owner_id = auth.uid()` in the query itself. Today this returns at most one row (kind = ''available'' — the only rider-owned account kind any function creates, in verify_delivery_and_release_escrow(), 0020/0022) since no payout-execution flow exists yet to ever populate a rider ''pending_payout'' account; returned as a set rather than fixed columns so a future payout migration adding that kind needs no change here.';

revoke execute on function get_rider_earnings() from public;
grant execute on function get_rider_earnings() to authenticated;
