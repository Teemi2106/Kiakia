-- KiaKia - tell the vendor when no rider is near, and let them widen the search
-- to their own delivery radius or deliver the order themselves.
--
-- Builds on 0097 (admin-configurable dispatch). Three parts.
--
-- 1. WIDENING IS THE STORE'S OWN RADIUS (owner decision, replaces 0097's global
--    dispatch_widened_radius_m, which is removed here). When a rider search
--    widens - automatically after dispatch_widen_after_seconds, from
--    admin_redispatch_order(p_widen), or from vendor_expand_rider_search() - the
--    radius becomes
--        least(greatest(dispatch_radius_m, vendors.delivery_radius_m), 50000)
--    The 50000 m constant (in _dispatch_store_radius_m) is a hard safety cap so a
--    mistyped store radius cannot reach riders across the country. It only
--    matters once dispatch_radius_m is set; at its default 0 (no distance cap,
--    live behaviour since 0066) there is nothing to widen.
--
-- 2. VENDOR NOTIFICATION. _dispatch_offer_round() - the one place every sweep,
--    the ready trigger and early dispatch go through - inserts ONE vendor
--    notification per order (notifications.kind 'no_rider_nearby', unique per
--    order) once the order has waited dispatch_notify_vendor_after_seconds
--    (default 45, 0 = off), holds no live offer, and a round found zero available
--    riders within the radius in use. The existing notifications triggers carry it
--    to realtime and web push (0049/0069); no new job.
--
-- 3. VENDOR SELF-DELIVERY. orders.delivery_by ('rider' default | 'vendor').
--    vendor_start_self_delivery() marks it, revokes every open offer, tells the
--    customer; the vendor then drives ready_for_pickup -> picked_up -> in_transit
--    -> arrived with vendor_advance_self_delivery() and finishes with
--    vendor_complete_self_delivery(), which runs the SAME code check / 5-attempt
--    lockout / admin reset / escrow release as the rider path (shared
--    _complete_delivery(), extracted from verify_delivery_and_release_escrow()).
--    The delivery code is stored plain (0020), there is no hashing to reuse.
--    PAYOUT: vendor = (subtotal - commission) + the order's delivery_fee_kobo;
--    no rider is credited; platform = the residual, exactly as before. The
--    "vendor keeps the delivery fee" rule lives in ONE place,
--    _self_delivery_vendor_extra_kobo(); change that function to change the rule.
--    The legal state path adds ONE conditional edge (ready_for_pickup ->
--    picked_up) inside _transition_order_core() for delivery_by = 'vendor' orders
--    only, and forbids rider_assigned for them; order_status_transitions itself
--    is unchanged, so packages/domain's 20-edge parity test still holds.
--    Vendors may drive picked_up/in_transit/arrived/delivered through
--    transition_order() only for their own delivery_by = 'vendor' orders.
--    Rider-side: accept_dispatch_offer() refuses such an order; every other rider
--    function is keyed on orders.rider_id, which is null for them.
--    admin_reassign_order_rider() refuses them; sweeps, the ready trigger,
--    _dispatch_offer_round() and admin_dispatch_status() skip them. Refunds and
--    cancellations before delivery work unchanged (escrow is unwound by
--    _unwind_order_escrow_ledger(), which never looked at the rider).

-- ---------------------------------------------------------------------------
-- Columns / tables
-- ---------------------------------------------------------------------------

alter table orders add column delivery_by text not null default 'rider'
  check (delivery_by in ('rider', 'vendor'));

comment on column orders.delivery_by is
  'Who delivers the order: rider (default, dispatch) or vendor (vendor_start_self_delivery, 0098). Irreversible once set; a vendor-delivered order has no rider and its delivery fee is paid to the vendor.';

alter table notifications add column kind text;
create unique index notifications_order_kind_uidx on notifications (order_id, kind) where kind is not null;

comment on column notifications.kind is
  'Optional machine tag for system-generated notifications; unique per order when set (0098: no_rider_nearby), which is what makes them send-once.';

create table dispatch_expansions (
  id              uuid primary key default uuid_generate_v7(),
  order_id        uuid not null references orders (id) on delete cascade,
  vendor_user_id  uuid not null,
  expanded_at     timestamptz not null default now(),
  offers_created  integer not null default 0
);
create index dispatch_expansions_order_idx on dispatch_expansions (order_id, expanded_at desc);

comment on table dispatch_expansions is
  'One row per vendor_expand_rider_search() call, for its rate limit (max 3 per order, one per 120 s).';

alter table dispatch_expansions enable row level security;
revoke all on dispatch_expansions from public, anon, authenticated, service_role;
grant select on dispatch_expansions to service_role;

-- ---------------------------------------------------------------------------
-- Settings: drop the global widened radius, add the vendor-notification delay
-- ---------------------------------------------------------------------------

alter table platform_settings drop constraint platform_settings_known_key_and_bounds;
delete from platform_settings where key = 'dispatch_widened_radius_m';
alter table platform_settings add constraint platform_settings_known_key_and_bounds check (
  (key = 'service_fee_bps' and unit = 'bps' and value_int between 0 and 2000)
  or (key = 'default_vendor_commission_bps' and unit = 'bps' and value_int between 0 and 5000)
  or (key = 'dispatch_radius_m' and unit = 'm' and (value_int = 0 or value_int between 1000 and 50000))
  or (key = 'dispatch_max_riders' and unit = 'count' and value_int between 1 and 50)
  or (key = 'dispatch_widen_after_seconds' and unit = 'seconds' and value_int between 0 and 1800)
  or (key = 'dispatch_location_max_age_seconds' and unit = 'seconds' and value_int between 60 and 300)
  or (key = 'dispatch_notify_vendor_after_seconds' and unit = 'seconds' and value_int between 0 and 1800)
);
insert into platform_settings (key, value_int, unit) values ('dispatch_notify_vendor_after_seconds', 45, 'seconds');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The widened search radius for a vendor's orders. The cap is the safety limit.
create function _dispatch_store_radius_m(p_vendor_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select least(
           greatest(_platform_setting_int('dispatch_radius_m')::integer, coalesce(v.delivery_radius_m, 0)),
           50000)
  from vendors v where v.id = p_vendor_id
$$;

comment on function _dispatch_store_radius_m(uuid) is
  'The radius a widened rider search uses for a vendor: greatest(dispatch_radius_m, vendors.delivery_radius_m), capped at 50000 m. Internal.';

revoke all on function _dispatch_store_radius_m(uuid) from public, anon, authenticated, service_role;

-- THE product rule for a vendor-delivered order: on top of its own share
-- (subtotal - commission) the vendor receives this many kobo. Today: the whole
-- delivery fee, because no rider is paid. Change here only.
create function _self_delivery_vendor_extra_kobo(p_order orders)
returns bigint
language sql
immutable
as $$ select p_order.delivery_fee_kobo $$;

comment on function _self_delivery_vendor_extra_kobo(orders) is
  'Kobo paid to the vendor in addition to subtotal - commission when it delivers an order itself (0098). Currently the order''s delivery_fee_kobo. The single place to change that rule.';

revoke all on function _self_delivery_vendor_extra_kobo(orders) from public, anon, authenticated, service_role;

-- Vendor-delivered orders are never "waiting for a rider".
create or replace function _dispatch_waiting_orders()
returns table (order_id uuid, status order_status, waiting_since timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.status, _dispatch_wait_start(o, v.avg_prep_mins)
  from orders o
  join vendors v on v.id = o.vendor_id
  where o.status = 'ready_for_pickup' and o.rider_id is null and o.delivery_by = 'rider'
  union all
  select o.id, o.status, _dispatch_wait_start(o, v.avg_prep_mins)
  from orders o
  join vendors v on v.id = o.vendor_id
  where o.status in ('accepted', 'preparing') and o.rider_id is null and o.accepted_at is not null
    and o.delivery_by = 'rider'
    and now() >= _dispatch_wait_start(o, v.avg_prep_mins)
$$;

-- 0097's funnel counted per rider with correlated subqueries (profile lookup,
-- "has an active order") that, on a 5000-rider fleet, cost ~1 s per order and
-- made admin_dispatch_status() take minutes for 50 orders. Same results, set
-- based: the busy riders are computed once and anti-joined, profiles joined.
create or replace function _dispatch_rider_counts(p_order_id uuid, p_radius_m integer)
returns table (online_riders integer, eligible_riders integer, in_range_riders integer, fundable_riders integer, nearest_online_m integer)
language sql
stable
security definer
set search_path = public
as $$
  with params as materialized (
    select _platform_setting_int('dispatch_location_max_age_seconds')::integer as max_age
  ),
  o as materialized (
    select ord.id, ord.distance_m, v.location as vloc, sa.rider_base_fee_kobo as base_fee, sa.rider_per_km_fee_kobo as per_km,
           _max_rider_fee_kobo(ord.id) as max_fee
    from orders ord
    join vendors v on v.id = ord.vendor_id
    left join service_areas sa on sa.id = ord.service_area_id
    where ord.id = p_order_id
  ),
  busy as (
    select distinct x.rider_id
    from orders x
    where x.rider_id is not null
      and x.status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')
  ),
  r as (
    select st_distance(rd.current_location, o.vloc) as d,
           (rd.last_ping_at >= now() - make_interval(secs => params.max_age)
            and p.status = 'active'
            and b.rider_id is null) as avail,
           o.base_fee, o.per_km, o.max_fee, o.distance_m,
           (p_radius_m is null or st_dwithin(rd.current_location, o.vloc, p_radius_m)) as in_range
    from riders rd
    cross join o
    cross join params
    left join profiles p on p.id = rd.user_id
    left join busy b on b.rider_id = rd.user_id
    where rd.is_online and rd.kyc_status = 'approved' and rd.current_location is not null and o.vloc is not null
  )
  select count(*)::integer,
         (count(*) filter (where avail))::integer,
         (count(*) filter (where avail and in_range))::integer,
         (count(*) filter (where avail and in_range and base_fee is not null
                           and base_fee + per_km * ceil((d + coalesce(distance_m, 0)) / 1000.0)::bigint <= max_fee))::integer,
         round(min(d))::integer
  from r
$$;

-- NOTE both funnels need `params` and `o` MATERIALIZED: _platform_setting_int()
-- and _max_rider_fee_kobo() are functions the planner cannot inline, and an
-- inlined CTE would call them once per rider (~1 s per order at 5000 riders).
--
-- The same funnel at TWO radii in one pass (distance computed once per rider),
-- for admin_dispatch_status() which shows the base and the store radius.
create function _dispatch_rider_funnel(p_order_id uuid, p_radius1_m integer, p_radius2_m integer)
returns table (online_riders integer, eligible_riders integer,
               in_range1 integer, fundable1 integer, in_range2 integer, fundable2 integer, nearest_online_m integer)
language sql
stable
security definer
set search_path = public
as $$
  with params as materialized (
    select _platform_setting_int('dispatch_location_max_age_seconds')::integer as max_age
  ),
  o as materialized (
    select ord.id, ord.distance_m, v.location as vloc, sa.rider_base_fee_kobo as base_fee, sa.rider_per_km_fee_kobo as per_km,
           _max_rider_fee_kobo(ord.id) as max_fee
    from orders ord
    join vendors v on v.id = ord.vendor_id
    left join service_areas sa on sa.id = ord.service_area_id
    where ord.id = p_order_id
  ),
  busy as (
    select distinct x.rider_id
    from orders x
    where x.rider_id is not null
      and x.status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')
  ),
  -- Distances use the sphere (use_spheroid = false): ~10x cheaper than the
  -- spheroid the offer query uses and within ~0.5% of it - plenty for a
  -- diagnostic funnel, which must stay fast with thousands of riders online.
  r0 as (
    select st_distance(rd.current_location, o.vloc, false) as d,
           (rd.last_ping_at >= now() - make_interval(secs => params.max_age)
            and p.status = 'active'
            and b.rider_id is null) as avail,
           o.base_fee, o.per_km, o.max_fee, o.distance_m
    from riders rd
    cross join o
    cross join params
    left join profiles p on p.id = rd.user_id
    left join busy b on b.rider_id = rd.user_id
    where rd.is_online and rd.kyc_status = 'approved' and rd.current_location is not null and o.vloc is not null
  ),
  r as (
    select d, avail, base_fee is not null as priced,
           base_fee + per_km * ceil((d + coalesce(distance_m, 0)) / 1000.0)::bigint <= max_fee as fundable
    from r0
  )
  select count(*)::integer,
         (count(*) filter (where avail))::integer,
         (count(*) filter (where avail and (p_radius1_m is null or d <= p_radius1_m)))::integer,
         (count(*) filter (where avail and (p_radius1_m is null or d <= p_radius1_m) and priced and fundable))::integer,
         (count(*) filter (where avail and (p_radius2_m is null or d <= p_radius2_m)))::integer,
         (count(*) filter (where avail and (p_radius2_m is null or d <= p_radius2_m) and priced and fundable))::integer,
         round(min(d))::integer
  from r
$$;

comment on function _dispatch_rider_funnel(uuid, integer, integer) is
  'Rider funnel for one order at two radii (null = no cap) in one pass: online, available, available within radius 1 / radius 2, of those payable by the order, and the nearest online rider in metres. O(online riders) per call; used by admin_dispatch_status(). Internal; read-only.';

revoke all on function _dispatch_rider_funnel(uuid, integer, integer) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Dispatch paths: vendor-delivered orders are skipped; rider side refuses them
-- (bodies are the live ones with only the marked 0098 lines added)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dispatch_order_to_nearby_riders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- 0098: the vendor is delivering this order themselves; nothing to dispatch.
  if new.delivery_by = 'vendor' then
    return new;
  end if;

  -- 0064: a rider already claimed this order via an early accept. Cascade to
  -- rider_assigned; unchanged.
  if new.rider_id is not null then
    update orders
    set status = 'rider_assigned', assigned_at = now()
    where id = new.id;

    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (
      new.id, 'ready_for_pickup', 'rider_assigned', 'system', null,
      jsonb_build_object('reason', 'rider_pre_committed_via_early_accept')
    );

    return new;
  end if;

  -- The rider clock starts now, when the food is ready and a rider is truly
  -- needed - not at an earlier early-dispatch offer, which would eat into the
  -- 30 minute give-up window while the kitchen was still cooking. A new cycle
  -- starts too, so riders asked during early dispatch are eligible again.
  update orders
  set first_dispatched_at = now(),
      dispatch_cycle_started_at = now()
  where id = new.id;

  begin
    perform _dispatch_offer_batch(new.id, now());
  exception when others then
    -- Never abort the vendor's ready_for_pickup transition; the sweep retries.
    raise warning 'dispatch_order_to_nearby_riders: failed to create dispatch offers for order % - %', new.id, sqlerrm;
  end;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sweep_dispatch_offers()
 RETURNS TABLE(offers_expired integer, offers_created integer, orders_cancelled integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role     text := coalesce(auth.role(), current_setting('role', true));
  v_expired_count   integer := 0;
  v_created_count   integer := 0;
  v_cancelled_count integer := 0;
  v_offered         integer;
  v_candidate       record;
  v_order           orders;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'sweep_dispatch_offers: requires the service-role key';
  end if;

  with expired as (
    update dispatch_offers
    set status = 'expired', responded_at = now()
    where status = 'offered' and expires_at <= now()
    returning 1
  )
  select count(*)::integer into v_expired_count from expired;

  for v_candidate in
    select o.id as order_id
    from orders o
    where o.status = 'ready_for_pickup'
      and o.rider_id is null
      and o.delivery_by = 'rider'
      and not exists (
        select 1 from dispatch_offers d where d.order_id = o.id and d.status = 'offered'
      )
  loop
    select * into v_order from orders where id = v_candidate.order_id for update skip locked;
    if not found then
      continue;
    end if;

    if v_order.status <> 'ready_for_pickup' or v_order.rider_id is not null or v_order.delivery_by <> 'rider' then
      continue;
    end if;

    -- An order that reached ready_for_pickup before 0067 was never stamped;
    -- give it a real anchor so the give-up below can eventually fire.
    if v_order.first_dispatched_at is null then
      update orders set first_dispatched_at = now() where id = v_order.id;
      v_order.first_dispatched_at := now();
    end if;

    -- Attempt 1 offers whoever is still untried this cycle. If that finds
    -- nobody and the cycle really was used up, attempt 2 opens a fresh cycle
    -- and asks the same riders again, closest first.
    for v_attempt in 1..2 loop
      begin
        v_offered := _dispatch_offer_batch(
          v_order.id,
          coalesce(v_order.dispatch_cycle_started_at, v_order.first_dispatched_at)
        );
      exception when others then
        -- A failure here must not exempt the order from the give-up below,
        -- or a persistently failing order would be stuck forever.
        raise warning 'sweep_dispatch_offers: failed to create dispatch offers for order % - %', v_order.id, sqlerrm;
        v_offered := 0;
      end;

      v_created_count := v_created_count + v_offered;
      exit when v_offered > 0;

      -- Someone still holds a live offer: nothing more to do this tick.
      exit when exists (
        select 1 from dispatch_offers where order_id = v_order.id and status = 'offered'
      );

      -- Nobody left to ask. Give up once the order has waited 30 minutes.
      -- This covers an order nobody can be offered at all (no vendor
      -- location, no eligible rider online), not only a used-up cycle.
      if now() >= v_order.first_dispatched_at + interval '30 minutes' then
        begin
          perform transition_order(
            v_order.id, 'cancelled_by_platform', 'system', null,
            jsonb_build_object('reason', 'dispatch_exhausted_after_30_minutes')
          );
          v_cancelled_count := v_cancelled_count + 1;
        exception when others then
          raise warning 'sweep_dispatch_offers: failed to auto-cancel order % after 30 minutes with no rider - %', v_order.id, sqlerrm;
        end;
        exit;
      end if;

      -- Only restart the cycle if riders were actually asked in it. With none
      -- online, a restart would rewrite the order row (and wake every realtime
      -- subscriber on it) every 15 seconds for no reason.
      exit when v_attempt = 2 or not exists (
        select 1 from dispatch_offers
        where order_id = v_order.id
          and offered_at >= coalesce(v_order.dispatch_cycle_started_at, v_order.first_dispatched_at)
      );

      update orders set dispatch_cycle_started_at = now() where id = v_order.id;
      v_order.dispatch_cycle_started_at := now();
    end loop;
  end loop;

  return query select v_expired_count, v_created_count, v_cancelled_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_orders_nearing_prep_completion()
 RETURNS TABLE(offers_created integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role   text := coalesce(auth.role(), current_setting('role', true));
  v_created_count integer := 0;
  v_candidate     record;
  v_order         orders;
  v_cycle         timestamptz;
  v_offered       integer;
  -- Minutes before the vendor's own estimated prep completion to start
  -- offering. Still the unmeasured placeholder from 0064.
  c_lead_minutes constant integer := 8;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'dispatch_orders_nearing_prep_completion: requires the service-role key';
  end if;

  for v_candidate in
    select o.id as order_id
    from orders o
    join vendors v on v.id = o.vendor_id
    where o.status in ('accepted', 'preparing')
      and o.rider_id is null
      and o.accepted_at is not null
      and o.delivery_by = 'rider'
      and now() >= o.accepted_at + make_interval(mins => greatest(v.avg_prep_mins - c_lead_minutes, 0))
      and not exists (
        select 1 from dispatch_offers d where d.order_id = o.id and d.status = 'offered'
      )
  loop
    select * into v_order from orders where id = v_candidate.order_id for update skip locked;
    if not found then
      continue;
    end if;

    if v_order.status not in ('accepted', 'preparing') or v_order.rider_id is not null or v_order.delivery_by <> 'rider' then
      continue;
    end if;

    -- One cycle spans the whole early phase, so successive minute-ticks offer
    -- the NEXT-nearest riders instead of re-asking the same ones. Left alone
    -- when already set: ready_for_pickup starts its own fresh cycle.
    update orders
    set dispatch_cycle_started_at = coalesce(dispatch_cycle_started_at, now())
    where id = v_order.id
    returning dispatch_cycle_started_at into v_cycle;

    begin
      v_offered := _dispatch_offer_batch(v_order.id, v_cycle);
      v_created_count := v_created_count + v_offered;
    exception when others then
      raise warning 'dispatch_orders_nearing_prep_completion: failed to create dispatch offers for order % - %', v_order.id, sqlerrm;
    end;
  end loop;

  return query select v_created_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_dispatch_offer(p_order_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order                   orders;
  v_offer                   dispatch_offers;
  v_rider_location          geography(point, 4326);
  v_pickup_distance_m       integer;
  v_rider_fee_kobo          bigint;
  v_fundable                boolean;
begin
  perform _assert_active_caller();

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'accept_dispatch_offer: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- Relaxed from "= 'ready_for_pickup'" (0044) to also allow an early
  -- accept while the vendor is still preparing - see 0064's own header for the
  -- full reasoning. rider_id-null is still required either way: exactly one
  -- rider may ever claim an order.
  if v_order.delivery_by = 'vendor' then
    raise exception 'accept_dispatch_offer: this order is being delivered by the vendor and no longer needs a rider'
      using errcode = 'check_violation';
  end if;

  if v_order.status not in ('accepted', 'preparing', 'ready_for_pickup') or v_order.rider_id is not null then
    raise exception 'accept_dispatch_offer: order already assigned or not ready for pickup';
  end if;

  if not exists (
    select 1 from riders where user_id = auth.uid() and kyc_status = 'approved'
  ) then
    raise exception 'accept_dispatch_offer: rider is not kyc-approved';
  end if;

  -- 0083: one active order per rider. Locking the rider row (after the order,
  -- the same order admin_reassign_order_rider() takes them in) serialises this
  -- against an admin forcing the same rider onto another order.
  perform 1 from riders where user_id = auth.uid() for update;
  if exists (
    select 1 from orders
    where rider_id = auth.uid()
      and id <> p_order_id
      and status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')
  ) then
    raise exception 'accept_dispatch_offer: rider already has an active order'
      using errcode = 'check_violation';
  end if;

  select * into v_offer
  from dispatch_offers
  where order_id = p_order_id and rider_id = auth.uid() and status = 'offered';

  if not found then
    raise exception 'accept_dispatch_offer: no active offer for this rider on this order';
  end if;

  if v_offer.expires_at <= now() then
    update dispatch_offers
    set status = 'expired', responded_at = now()
    where order_id = p_order_id and rider_id = auth.uid() and status = 'offered';

    raise exception 'accept_dispatch_offer: offer has expired';
  end if;

  -- The fee is frozen from the rider's position, so it has to be a live one: a
  -- rider who is offline, or whose last ping is minutes old, is not where the
  -- stored coordinates say.
  select current_location into v_rider_location
  from riders
  where user_id = auth.uid()
    and is_online
    and last_ping_at >= now() - interval '5 minutes';
  if v_rider_location is null then
    raise exception 'accept_dispatch_offer: rider must be online with a location update from the last 5 minutes to accept';
  end if;

  -- rider_fee_kobo is computed identically on both paths, by the same helper
  -- the admin override uses (0083).
  select q.fee_kobo, q.pickup_distance_m, q.fundable
  into v_rider_fee_kobo, v_pickup_distance_m, v_fundable
  from _quote_rider_fee(p_order_id, auth.uid()) q;

  -- 0076: the payout has to be fundable. release refuses a negative platform
  -- share, so a rider far from the vendor could accept, complete the whole
  -- delivery, and only then find the order could not pay anyone out. Refuse
  -- here instead, before anything is promised.
  if not v_fundable then
    raise exception 'accept_dispatch_offer: order % is too far from this rider - the payout would exceed what the order can fund', p_order_id
      using errcode = 'check_violation';
  end if;

  if v_order.status = 'ready_for_pickup' then
    -- Unchanged from 0044: the normal, today's-behavior path. status moves
    -- straight to rider_assigned here because the order is already ready -
    -- there is no later ready_for_pickup transition left to cascade from.
    if not exists (
      select 1 from order_status_transitions
      where from_status = 'ready_for_pickup' and to_status = 'rider_assigned'
    ) then
      raise exception 'accept_dispatch_offer: ready_for_pickup -> rider_assigned is not a legal transition';
    end if;

    update orders
    set rider_id = auth.uid(),
        status = 'rider_assigned',
        assigned_at = now(),
        rider_fee_kobo = v_rider_fee_kobo,
        rider_pickup_distance_m = v_pickup_distance_m
    where id = p_order_id
    returning * into v_order;

    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (p_order_id, 'ready_for_pickup', 'rider_assigned', 'rider', auth.uid(), '{}'::jsonb);
  else
    -- An early accept, while the order is still 'accepted' or 'preparing'.
    -- Claims rider_id and freezes rider_fee_kobo right now (the rider's trip
    -- starts now, so their pay is set from where they actually are now) but
    -- deliberately leaves orders.status and assigned_at untouched - the
    -- vendor's own transition_order() calls are still the only thing that
    -- advances status through accepted -> preparing -> ready_for_pickup.
    -- dispatch_order_to_nearby_riders() detects rider_id already being set the
    -- moment ready_for_pickup is reached and cascades to rider_assigned itself.
    -- Until then, this rider shows up on their own active-order screen
    -- (useActiveOrder, kiakia-rider) exactly as any assigned rider would, since
    -- that query is keyed on orders.rider_id, not status.
    update orders
    set rider_id = auth.uid(),
        rider_fee_kobo = v_rider_fee_kobo,
        rider_pickup_distance_m = v_pickup_distance_m
    where id = p_order_id
    returning * into v_order;

    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (
      p_order_id, v_order.status, v_order.status, 'rider', auth.uid(),
      jsonb_build_object('early_accept', true, 'order_status_at_accept', v_order.status)
    );
  end if;

  update dispatch_offers
  set status = 'accepted', responded_at = now()
  where order_id = p_order_id and rider_id = auth.uid();

  -- Once this transaction commits, orders.rider_id is no longer null, so any
  -- concurrent/later accept attempt - on either path - fails the rider_id-null
  -- check at the top regardless of that rider's own offer status.
  update dispatch_offers
  set status = 'expired', responded_at = now()
  where order_id = p_order_id and rider_id <> auth.uid() and status = 'offered';

  return v_order;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reassign_order_rider(p_order_id uuid, p_rider_id uuid, p_reason text, p_actor_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason        text;
  v_order         orders;
  v_from_status   order_status;
  v_fee_before    bigint;
  v_previous      uuid;
  v_blocker       text;
  v_fee           bigint;
  v_pickup_m      integer;
  v_fundable      boolean;
  v_live_offers   integer;
  v_mode          text := case when p_rider_id is null then 'reoffer' else 'assign' end;
begin
  perform _assert_admin_actor('admin_reassign_order_rider', p_actor_id);
  v_reason := _admin_reason('admin_reassign_order_rider', p_reason, true);

  -- The order lock comes first: same as accept_dispatch_offer(), so an admin
  -- override and a rider accepting serialize on this row.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'admin_reassign_order_rider: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.status not in ('accepted', 'preparing', 'ready_for_pickup', 'rider_assigned') then
    raise exception 'admin_reassign_order_rider: order % is % - a rider can only be changed before pickup', v_order.code, v_order.status
      using errcode = 'check_violation';
  end if;

  if v_order.delivery_by = 'vendor' then
    raise exception 'admin_reassign_order_rider: order % is being delivered by the vendor themselves - it has no rider to change', v_order.code
      using errcode = 'check_violation';
  end if;

  v_from_status := v_order.status;
  v_fee_before := v_order.rider_fee_kobo;
  v_previous := v_order.rider_id;

  if p_rider_id is not null then
    -- Already theirs: nothing to do and nothing to audit.
    if v_previous = p_rider_id then
      return v_order;
    end if;

    perform 1 from riders where user_id = p_rider_id for update;
    if not found then
      raise exception 'admin_reassign_order_rider: rider % does not exist', p_rider_id
        using errcode = 'no_data_found';
    end if;

    v_blocker := _rider_assign_blocker(p_rider_id, p_order_id);
    if v_blocker is not null then
      raise exception 'admin_reassign_order_rider: this rider %', v_blocker
        using errcode = 'check_violation';
    end if;

    select q.fee_kobo, q.pickup_distance_m, q.fundable
    into v_fee, v_pickup_m, v_fundable
    from _quote_rider_fee(p_order_id, p_rider_id) q;
    if not v_fundable then
      raise exception 'admin_reassign_order_rider: this order is too far from that rider - the payout would exceed what the order can fund'
        using errcode = 'check_violation';
    end if;
  elsif v_previous is null and v_from_status <> 'rider_assigned' and exists (
    select 1 from dispatch_offers
    where order_id = p_order_id and status = 'offered' and expires_at > now()
  ) then
    -- Already on offer: nothing to do and nothing to audit.
    return v_order;
  end if;

  -- Take the current rider off the order.
  if v_previous is not null then
    update dispatch_offers
    set status = 'revoked', responded_at = now()
    where order_id = p_order_id and rider_id = v_previous and status = 'accepted';

    delete from order_rider_locations where order_id = p_order_id;

    insert into rider_notifications (rider_id, order_id, title, body)
    values (
      v_previous, p_order_id, 'Delivery reassigned',
      format('Order %s was taken off you by KiaKia support and no longer needs delivery from you.', v_order.code)
    );
  end if;

  if p_rider_id is not null then
    update orders
    set rider_id = p_rider_id,
        rider_fee_kobo = v_fee,
        rider_pickup_distance_m = v_pickup_m,
        status = case when status = 'ready_for_pickup' then 'rider_assigned'::order_status else status end,
        assigned_at = case when status in ('ready_for_pickup', 'rider_assigned') then now() else assigned_at end
    where id = p_order_id
    returning * into v_order;

    insert into dispatch_offers (order_id, rider_id, status, responded_at)
    values (p_order_id, p_rider_id, 'accepted', now())
    on conflict (order_id, rider_id) do update
      set status = 'accepted', responded_at = now();

    update dispatch_offers
    set status = 'expired', responded_at = now()
    where order_id = p_order_id and rider_id <> p_rider_id and status = 'offered';

    insert into rider_notifications (rider_id, order_id, title, body)
    values (
      p_rider_id, p_order_id, 'Delivery assigned to you',
      format('KiaKia support assigned order %s to you. Open it to see the pickup details.', v_order.code)
    );
  else
    if v_previous is not null or v_from_status = 'rider_assigned' then
      -- From rider_assigned the status moves back to ready_for_pickup in this
      -- same UPDATE; that fires the dispatch trigger, which restarts the rider
      -- clock and offers the order.
      update orders
      set rider_id = null,
          rider_fee_kobo = 0,
          rider_pickup_distance_m = null,
          assigned_at = null,
          status = case when status = 'rider_assigned' then 'ready_for_pickup'::order_status else status end
      where id = p_order_id
      returning * into v_order;
    end if;

    if v_order.status in ('accepted', 'preparing') then
      update orders set dispatch_cycle_started_at = now() where id = p_order_id;
      perform _dispatch_offer_batch(p_order_id, now());
    elsif v_from_status = 'ready_for_pickup' then
      perform _dispatch_offer_batch(p_order_id, coalesce(v_order.dispatch_cycle_started_at, now()));
    end if;
  end if;

  -- The triggers above may have rewritten the row (clock stamps).
  select * into v_order from orders where id = p_order_id;

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (
    p_order_id, v_from_status, v_order.status, 'admin', p_actor_id,
    jsonb_build_object('reason', v_reason, 'previous_rider_id', v_previous, 'admin_reassign', true)
      || case when p_rider_id is not null then jsonb_build_object('new_rider_id', p_rider_id) else '{}'::jsonb end
  );

  select count(*)::integer into v_live_offers
  from dispatch_offers where order_id = p_order_id and status = 'offered';

  perform _write_admin_audit(
    p_actor_id, 'order.reassign_rider', 'order', p_order_id, v_reason,
    jsonb_build_object(
      'mode', v_mode,
      'previous_rider_id', v_previous,
      'new_rider_id', p_rider_id,
      'from_status', v_from_status,
      'to_status', v_order.status,
      'rider_fee_kobo_before', v_fee_before,
      'rider_fee_kobo_after', v_order.rider_fee_kobo,
      'live_offers', v_live_offers
    )
  );

  return v_order;
end;
$function$;

CREATE OR REPLACE FUNCTION public._transition_order_core(p_order_id uuid, p_to_status order_status, p_actor_type text, p_actor_id uuid, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order       orders;
  v_from_status order_status;
  -- 0057 TASK 1 fix: p_meta as it will actually be written, after
  -- stripping the three reserved keys for any non-system actor. See this
  -- migration's header for the full reasoning and the one known,
  -- deliberate side effect on the 'delivered' transition's own audit tag.
  v_meta        jsonb := p_meta;
begin
  -- 1. Lock the row (§10 point 1) - this is also what makes concurrent
  --    transitions on the same order serialize instead of racing.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'transition_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_from_status := v_order.status;

  -- 2. Validate against the explicit allowed-transitions table - a second,
  --    independent gate: even an actor type cleared to request p_to_status
  --    in principle still can't skip the state machine.
  -- 0098: a vendor-delivered order (delivery_by = 'vendor') never gets a rider,
  -- so it may not take the rider_assigned edge, and it takes one extra edge a
  -- rider-delivered order may not: ready_for_pickup -> picked_up (the vendor
  -- leaves with the food). The shared table is unchanged.
  if not (
       (exists (
          select 1 from order_status_transitions
          where from_status = v_from_status and to_status = p_to_status
        ) and not (v_order.delivery_by = 'vendor' and p_to_status = 'rider_assigned'))
       or (v_order.delivery_by = 'vendor' and v_from_status = 'ready_for_pickup' and p_to_status = 'picked_up')
     ) then
    raise exception 'transition_order: illegal transition % -> % for order %',
      v_from_status, p_to_status, p_order_id
      using errcode = 'check_violation';
  end if;

  -- 2.5. Restored from 0030 - the guard that 0041/0042 dropped. A
  --      transition INTO 'delivered' is refused unless this order's escrow
  --      has already been released, i.e. unless the "<order.code>-escrow"-
  --      referenced transactions row already exists. Applies unconditionally
  --      to every actor_type, with no admin/system override - see 0030's
  --      own header for the full reasoning, unchanged here.
  --      verify_delivery_and_release_escrow() inserts exactly this row
  --      BEFORE its own internal call to transition_order(..., 'delivered',
  --      ...) in the same transaction (0020/0022/0025/0044), so the
  --      legitimate path always satisfies this check; any direct
  --      rider/vendor/admin/system call that hasn't gone through that
  --      function never has this row and is refused here.
  if p_to_status = 'delivered' and not exists (
    select 1 from transactions where reference = v_order.code || '-escrow'
  ) then
    raise exception 'transition_order: order % cannot be marked delivered before its escrow has been released - call verify_delivery_and_release_escrow() with the customer''s delivery code instead', p_order_id
      using errcode = 'check_violation';
  end if;

  -- 3. Update status + the matching timestamp column, same transaction.
  update orders set
    status        = p_to_status,
    placed_at     = case when p_to_status = 'placed' then now() else placed_at end,
    accepted_at   = case when p_to_status = 'accepted' then now() else accepted_at end,
    ready_at      = case when p_to_status = 'ready_for_pickup' then now() else ready_at end,
    assigned_at   = case when p_to_status = 'rider_assigned' then now() else assigned_at end,
    picked_up_at  = case when p_to_status = 'picked_up' then now() else picked_up_at end,
    in_transit_at = case when p_to_status = 'in_transit' then now() else in_transit_at end,
    arrived_at    = case when p_to_status = 'arrived' then now() else arrived_at end,
    delivered_at  = case when p_to_status = 'delivered' then now() else delivered_at end,
    cancelled_at  = case
                      when p_to_status in ('cancelled_by_customer', 'cancelled_by_platform', 'rejected_by_vendor', 'failed_delivery')
                      then now() else cancelled_at
                    end
  where id = p_order_id
  returning * into v_order;

  -- 3a. Auto-refund (0041, reproduced unchanged): this order is never
  -- going to be fulfilled from here - reverse its captured payment out of
  -- escrow immediately rather than leaving it stranded until an admin
  -- notices. Shares _unwind_order_escrow_ledger() with the manual admin
  -- path (refund_order_escrow()), so this can never double-refund or fight
  -- a concurrent admin action - both funnel through the same idempotency
  -- guards. Called with two arguments, resolving p_destination to its
  -- 'wallet' default on the live three-argument
  -- _unwind_order_escrow_ledger(uuid, text, text) - verified against
  -- 0045_customer_wallet.sql, see 0050's own header.
  --
  -- Deliberately NOT failed_delivery: a rider genuinely reached 'arrived'
  -- and attempted the handover there - whether the customer still owes for
  -- that attempt is a support/business judgment call, left on the existing
  -- manual admin path, not made automatic here.
  --
  -- Wrapped so a failure in the unwind can never block the status
  -- transition itself, which is the primary invariant this function exists
  -- to enforce - surfaced as a WARNING rather than silently swallowed, with
  -- refund_order_escrow() still available as a manual fallback.
  if p_to_status in ('rejected_by_vendor', 'cancelled_by_customer', 'cancelled_by_platform') then
    begin
      perform _unwind_order_escrow_ledger(p_order_id, format('Automatically refunded - order moved to %s', p_to_status));
    exception when others then
      raise warning 'transition_order: automatic escrow unwind failed for order % (transition to %): %', p_order_id, p_to_status, sqlerrm;
    end;

    -- Refresh (0042, reproduced unchanged): the unwind above may have
    -- updated this row (payment_status) in a statement separate from the
    -- RETURNING clause above, which would otherwise make the value this
    -- function returns stale.
    select * into v_order from orders where id = p_order_id;
  end if;

  -- 3b. 0057 TASK 1 fix: strip the three reserved delivery-code meta keys
  -- from what actually gets written, for every actor_type except 'system'.
  -- These three keys are read by verify_delivery_and_release_escrow() as
  -- proof of an admin-issued rate-limit reset or a genuine failed-attempt/
  -- verified marker; letting any client-reachable actor_type write them
  -- through p_meta would let that same actor forge the exact signal that
  -- function trusts. See this migration's header for the full reasoning,
  -- the current non-exploitability analysis, and the one known side effect
  -- (this function's own internal 'delivered' call, actor_type='rider',
  -- loses its delivery_code_verified audit tag - confirmed unread anywhere
  -- in this schema or app before accepting that tradeoff).
  if p_actor_type is distinct from 'system' then
    v_meta := v_meta - 'delivery_code_attempts_reset' - 'delivery_code_failed' - 'delivery_code_verified';
  end if;

  -- 4. Insert the order_events row - same transaction, always.
  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (p_order_id, v_from_status, p_to_status, p_actor_type, p_actor_id, v_meta);

  -- 5. Return the new state; a Postgres Changes subscription on `orders`
  --    propagates it over Realtime.
  return v_order;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transition_order(p_order_id uuid, p_to_status order_status, p_actor_type text, p_actor_id uuid, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order       orders;
  v_caller_uid  uuid := auth.uid();
  -- auth.role() is NULL for a direct pg_cron/psql connection with no JWT
  -- claims; comparing NULL <> 'service_role' is NULL, which `if` treats as
  -- false, so a plain `<>` would fail OPEN for exactly the callers that most
  -- need the service-role branches below. coalesce + `is distinct from`
  -- closes that (S1, 0018/0030/0050).
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'transition_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- Authorization, part 1: the actor must have a real relationship to the
  -- order, proven by the SESSION making the call (auth.uid()/auth.role()),
  -- never by the p_actor_id/p_actor_type arguments alone. Restored from
  -- 0015/0018/0030 - this is the actor-forgery fix that 0041/0042 dropped,
  -- and 0050 restored.
  if p_actor_type = 'customer' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or v_caller_uid is distinct from v_order.customer_id then
      raise exception 'transition_order: actor is not the customer on order %', p_order_id;
    end if;
    perform _assert_active_caller();
    -- Authorization, part 2: which edges this actor TYPE may drive,
    -- independent of whether the edge is legal for the order's current
    -- status. Restored from 0018/0030 - the per-actor-type allow-lists
    -- that 0041/0042 dropped, and 0050 restored.
    if p_to_status <> 'cancelled_by_customer' then
      raise exception 'transition_order: actor_type=customer may not drive an order to %- only cancelled_by_customer', p_to_status;
    end if;
  elsif p_actor_type = 'vendor' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or not exists (
      select 1 from vendor_staff where vendor_id = v_order.vendor_id and user_id = v_caller_uid
    ) then
      raise exception 'transition_order: actor is not staff on vendor %', v_order.vendor_id;
    end if;
    perform _assert_active_caller();
    if p_to_status not in ('accepted', 'rejected_by_vendor', 'preparing', 'ready_for_pickup')
       and not (v_order.delivery_by = 'vendor' and p_to_status in ('picked_up', 'in_transit', 'arrived', 'delivered')) then
      raise exception 'transition_order: actor_type=vendor may not drive an order to %', p_to_status;
    end if;
  elsif p_actor_type = 'rider' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or v_caller_uid is distinct from v_order.rider_id then
      raise exception 'transition_order: actor is not the assigned rider on order %', p_order_id;
    end if;
    perform _assert_active_caller(true, p_order_id);
    if p_to_status not in ('picked_up', 'in_transit', 'arrived', 'delivered', 'failed_delivery') then
      raise exception 'transition_order: actor_type=rider may not drive an order to %', p_to_status;
    end if;
  elsif p_actor_type = 'admin' then
    -- No `authenticated`-reachable admin surface: service role plus a real,
    -- active, platform-scoped admin row, checked by the same helper every
    -- admin RPC uses (0080).
    perform _assert_admin_actor('transition_order', p_actor_id);
    if p_to_status <> 'cancelled_by_platform' then
      raise exception 'transition_order: actor_type=admin may not drive an order to %- only cancelled_by_platform', p_to_status;
    end if;
  elsif p_actor_type = 'system' then
    -- Reserved for pg_cron / the dispatch orchestrator / capture_payment's
    -- internal call, all of which run with the service-role key. THIS
    -- BRANCH IS THE SHARPEST PART OF THE FIX: 0041/0042's if/elsif chain
    -- had no branch at all for 'system', which in PL/pgSQL means it fell
    -- through with ZERO checks performed for any p_actor_type value this
    -- chain does not explicitly name - restored here, plus the trailing
    -- `else raise` below so any FUTURE unhandled actor_type also fails
    -- closed instead of silently passing.
    if v_caller_role is distinct from 'service_role' then
      raise exception 'transition_order: actor_type=system requires the service-role key';
    end if;
    if p_to_status not in ('placed', 'cancelled_by_platform', 'rider_assigned') then
      raise exception 'transition_order: actor_type=system may not drive an order to %', p_to_status;
    end if;
  else
    raise exception 'transition_order: unknown actor_type %', p_actor_type;
  end if;

  return _transition_order_core(p_order_id, p_to_status, p_actor_type, p_actor_id, p_meta);
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_customer_of_order_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_title text;
  v_body  text;
  v_store text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_title := case new.status
    when 'placed'                then 'Order placed!'
    when 'accepted'               then 'Order accepted'
    when 'rejected_by_vendor'     then 'Order declined'
    when 'preparing'              then 'Order in the kitchen'
    when 'ready_for_pickup'       then 'Order ready'
    when 'rider_assigned'         then 'Rider assigned'
    when 'picked_up'              then 'Order picked up'
    when 'in_transit'             then 'On the way'
    when 'arrived'                then 'Rider has arrived'
    when 'delivered'              then 'Order delivered'
    when 'failed_delivery'        then 'Delivery failed'
    when 'cancelled_by_platform'  then 'Order cancelled'
    else null -- draft, cancelled_by_customer: nothing worth notifying about
  end;

  if v_title is null then
    return new;
  end if;

  v_body := case new.status
    when 'placed'               then format('Your order %s has been placed and sent to the vendor.', new.code)
    when 'accepted'              then format('Your order %s has been accepted and will be prepared shortly.', new.code)
    when 'rejected_by_vendor'    then format('Your order %s was declined by the vendor.', new.code)
    when 'preparing'             then format('Your order %s is being prepared.', new.code)
    when 'ready_for_pickup'      then format('Your order %s is ready and waiting for a rider.', new.code)
    when 'rider_assigned'        then format('A rider has been assigned to your order %s.', new.code)
    when 'picked_up'             then format('Your rider has picked up order %s.', new.code)
    when 'in_transit'            then format('Your order %s is on the way!', new.code)
    when 'arrived'               then format('Your rider has arrived with order %s.', new.code)
    when 'delivered'             then format('Your order %s has been delivered. Enjoy!', new.code)
    when 'failed_delivery'       then format('We could not complete delivery for order %s.', new.code)
    when 'cancelled_by_platform' then format('Your order %s was cancelled.', new.code)
  end;

  -- 0098: the vendor delivers it themselves - no rider wording.
  if new.delivery_by = 'vendor' then
    select name into v_store from vendors where id = new.vendor_id;
    v_title := case new.status
      when 'picked_up' then 'Order on its way'
      when 'arrived'   then 'Your order has arrived'
      else v_title
    end;
    v_body := case new.status
      when 'ready_for_pickup' then format('Your order %s is ready - %s will deliver it to you themselves.', new.code, v_store)
      when 'picked_up'        then format('%s has set off with your order %s.', v_store, new.code)
      when 'in_transit'       then format('Your order %s is on the way!', new.code)
      when 'arrived'          then format('%s has arrived with order %s.', v_store, new.code)
      else v_body
    end;
  end if;

  insert into notifications (customer_id, order_id, title, body)
  values (new.customer_id, new.id, v_title, v_body);

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_vendor_of_order_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_title text;
  v_body  text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.vendor_id is null then
    return new;
  end if;

  v_title := case new.status
    when 'placed'                 then 'New order'
    when 'cancelled_by_customer'  then 'Order cancelled'
    when 'cancelled_by_platform'  then 'Order cancelled'
    when 'rider_assigned'         then 'Rider on the way'
    when 'picked_up'              then 'Order picked up'
    when 'delivered'              then 'Order delivered'
    when 'failed_delivery'        then 'Delivery failed'
    else null
  end;

  if v_title is null then
    return new;
  end if;

  v_body := case new.status
    when 'placed'                then format('Order %s just came in. Accept it to start preparing.', new.code)
    when 'cancelled_by_customer' then format('The customer cancelled order %s.', new.code)
    when 'cancelled_by_platform' then format('Order %s was cancelled.', new.code)
    when 'rider_assigned'        then format('A rider is heading over to collect order %s.', new.code)
    when 'picked_up'             then format('A rider has collected order %s.', new.code)
    when 'delivered'             then format('Order %s was delivered. Your payout has been released.', new.code)
    when 'failed_delivery'       then format('Delivery could not be completed for order %s.', new.code)
  end;

  -- 0098: for a vendor-delivered order the vendor did the pickup themselves.
  if new.delivery_by = 'vendor' then
    if new.status = 'picked_up' then
      return new;
    elsif new.status = 'delivered' then
      v_body := format('Order %s was delivered. Your payout, including the delivery fee, has been released.', new.code);
    end if;
  end if;

  insert into notifications (vendor_id, order_id, title, body)
  values (new.vendor_id, new.id, v_title, v_body);

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public._complete_delivery(p_order_id uuid, p_delivery_code text, p_actor_type text, p_actor_id uuid)
 RETURNS delivery_verification_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order               orders;
  v_vendor              vendors;
  v_commission_kobo     bigint;
  v_vendor_kobo         bigint;
  v_rider_kobo          bigint;
  v_platform_kobo       bigint;
  v_vendor_account_id   uuid;
  v_rider_account_id    uuid;
  v_escrow_account_id   uuid;
  v_revenue_account_id  uuid;
  v_transaction_id      uuid;
  v_reference           text;
  v_stored_code         text;
  v_failed_attempts     integer;
  v_escrow_held_kobo    bigint;
  v_reset_marker_at     timestamptz;
  v_result              delivery_verification_result;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- The caller (verify_delivery_and_release_escrow for the rider, or
  -- vendor_complete_self_delivery for the vendor) has already authenticated the
  -- actor and holds the order lock. Whoever it is must be the party this order
  -- is delivered by.
  if (v_order.delivery_by = 'vendor') is distinct from (p_actor_type = 'vendor') then
    raise exception '_complete_delivery: % may not complete order % (delivered by %)', p_actor_type, p_order_id, v_order.delivery_by;
  end if;

  v_reference := v_order.code || '-escrow';

  if exists (select 1 from transactions where reference = v_reference) then
    select * into v_order from orders where id = p_order_id;
    v_result.code_matched := true;
    v_result.order_row := v_order;
    return v_result;
  end if;

  if v_order.status <> 'arrived' then
    raise exception 'verify_delivery_and_release_escrow: order is not yet marked arrived (status=%)', v_order.status;
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'verify_delivery_and_release_escrow: order % payment_status is not paid (status=%)',
      p_order_id, v_order.payment_status;
  end if;

  -- 0057 TASK 1 fix: require actor_type = 'admin' on the reset-marker row,
  -- matching what admin_reset_delivery_code_attempts() (0031) has always
  -- actually written, instead of trusting any order_events row carrying
  -- this meta key regardless of who wrote it. See this migration's header
  -- for the full reasoning and the current non-exploitability analysis.
  select max(at) into v_reset_marker_at
  from order_events
  where order_id = p_order_id
    and actor_type = 'admin'
    and (meta ->> 'delivery_code_attempts_reset')::boolean is true;

  select count(*) into v_failed_attempts
  from order_events
  where order_id = p_order_id
    and (meta ->> 'delivery_code_failed')::boolean is true
    and at >= v_order.arrived_at
    and at > coalesce(v_reset_marker_at, '-infinity'::timestamptz);

  if v_failed_attempts >= 5 then
    raise exception 'verify_delivery_and_release_escrow: too many incorrect delivery-code attempts for order %', p_order_id;
  end if;

  select code into v_stored_code from order_delivery_codes where order_id = p_order_id;
  if v_stored_code is null then
    raise exception 'verify_delivery_and_release_escrow: no delivery code exists for order %', p_order_id;
  end if;

  if p_delivery_code is distinct from v_stored_code then
    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (p_order_id, v_order.status, v_order.status, p_actor_type, p_actor_id, jsonb_build_object('delivery_code_failed', true));

    v_result.code_matched := false;
    v_result.order_row := v_order;
    return v_result;
  end if;

  select * into v_vendor from vendors where id = v_order.vendor_id;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: vendor % does not exist', v_order.vendor_id;
  end if;

  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';
  if v_escrow_account_id is null then
    raise exception 'verify_delivery_and_release_escrow: platform escrow account is not seeded';
  end if;

  select coalesce(sum(amount_kobo), 0) into v_escrow_held_kobo
  from ledger_entries
  where order_id = p_order_id
    and account_id = v_escrow_account_id
    and direction = 'credit'
    and entry_type = 'payment_capture';

  if v_escrow_held_kobo <> v_order.total_kobo then
    raise exception 'verify_delivery_and_release_escrow: escrow for order % holds % kobo but total_kobo is % - refusing to release',
      p_order_id, v_escrow_held_kobo, v_order.total_kobo;
  end if;

  -- v_rider_kobo comes from rider_fee_kobo (set by accept_dispatch_offer(),
  -- 0044) instead of delivery_fee_kobo - see 0044's own file header for
  -- why the two were conflated before. v_platform_kobo remains the
  -- RESIDUAL (total_kobo - vendor - rider), unchanged from 0020: this is
  -- what makes a free-delivery order (delivery_fee_kobo = 0, but
  -- rider_fee_kobo > 0) still balance - the platform's share simply
  -- absorbs the difference, exactly as it already absorbs discount_kobo.
  v_commission_kobo := round(v_order.subtotal_kobo * v_vendor.commission_bps / 10000.0)::bigint;
  v_vendor_kobo := v_order.subtotal_kobo - v_commission_kobo;
  if v_order.delivery_by = 'vendor' then
    -- No rider is paid; the vendor keeps the delivery fee (see
    -- _self_delivery_vendor_extra_kobo - the one place that rule lives).
    v_rider_kobo := 0;
    v_vendor_kobo := v_vendor_kobo + _self_delivery_vendor_extra_kobo(v_order);
  else
    v_rider_kobo := v_order.rider_fee_kobo;
  end if;
  v_platform_kobo := v_order.total_kobo - v_vendor_kobo - v_rider_kobo;

  if v_vendor_kobo < 0 or v_rider_kobo < 0 or v_platform_kobo < 0 then
    raise exception 'verify_delivery_and_release_escrow: computed a negative payout share for order % (vendor=%, rider=%, platform=%) - refusing to release',
      p_order_id, v_vendor_kobo, v_rider_kobo, v_platform_kobo;
  end if;

  select id into v_vendor_account_id from accounts where owner_type = 'vendor' and owner_id = v_order.vendor_id and kind = 'available';
  if v_vendor_account_id is null then
    insert into accounts (owner_type, owner_id, kind) values ('vendor', v_order.vendor_id, 'available')
    on conflict (owner_type, owner_id, kind) do nothing;
    select id into v_vendor_account_id from accounts where owner_type = 'vendor' and owner_id = v_order.vendor_id and kind = 'available';
  end if;

  if v_order.delivery_by = 'rider' then
    select id into v_rider_account_id from accounts where owner_type = 'rider' and owner_id = v_order.rider_id and kind = 'available';
    if v_rider_account_id is null then
      insert into accounts (owner_type, owner_id, kind) values ('rider', v_order.rider_id, 'available')
      on conflict (owner_type, owner_id, kind) do nothing;
      select id into v_rider_account_id from accounts where owner_type = 'rider' and owner_id = v_order.rider_id and kind = 'available';
    end if;
  end if;

  select id into v_revenue_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'revenue';
  if v_revenue_account_id is null then
    raise exception 'verify_delivery_and_release_escrow: platform revenue account is not seeded';
  end if;

  insert into transactions (kind, reference, order_id, description)
  values ('escrow_release', v_reference, p_order_id, case when v_order.delivery_by = 'vendor' then 'Escrow released on delivery-code verification (vendor self-delivery: delivery fee to vendor)' else 'Escrow released on delivery-code verification' end)
  returning id into v_transaction_id;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values (v_transaction_id, v_escrow_account_id, 'debit', v_order.total_kobo, 'escrow_release', p_order_id);

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_vendor_account_id, 'credit', v_vendor_kobo, 'escrow_release', p_order_id
  where v_vendor_kobo > 0;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_rider_account_id, 'credit', v_rider_kobo, 'escrow_release', p_order_id
  where v_rider_kobo > 0;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_revenue_account_id, 'credit', v_platform_kobo, 'escrow_release', p_order_id
  where v_platform_kobo > 0;

  v_order := transition_order(p_order_id, 'delivered', p_actor_type, p_actor_id, jsonb_build_object('delivery_code_verified', true));
  v_result.code_matched := true;
  v_result.order_row := v_order;
  return v_result;
end;
$function$;


-- ---------------------------------------------------------------------------
-- Delivery completion: shared core, rider entry point unchanged in behaviour
-- ---------------------------------------------------------------------------

revoke all on function _complete_delivery(uuid, text, text, uuid) from public, anon, authenticated, service_role;

comment on function _complete_delivery(uuid, text, text, uuid) is
  'Internal. Delivery-code check (5 failed attempts per arrival, admin reset marker honoured), escrow release and the delivered transition, extracted unchanged from verify_delivery_and_release_escrow() (0082) so the rider and vendor self-delivery paths cannot drift. The caller has authenticated the actor and holds the order lock. delivery_by vendor: no rider credit, vendor share + _self_delivery_vendor_extra_kobo(); otherwise exactly as before. Idempotent: an already-released order returns code_matched true.';

CREATE OR REPLACE FUNCTION public.verify_delivery_and_release_escrow(p_order_id uuid, p_delivery_code text)
 RETURNS delivery_verification_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order  orders;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if auth.uid() is null or v_order.rider_id is null or auth.uid() is distinct from v_order.rider_id then
    raise exception 'verify_delivery_and_release_escrow: actor is not the assigned rider on order %', p_order_id;
  end if;

  perform _assert_active_caller(true, p_order_id);

  -- 0098: attempt counting, lockout, code check and escrow release live in
  -- _complete_delivery(), shared with vendor_complete_self_delivery().
  return _complete_delivery(p_order_id, p_delivery_code, 'rider', auth.uid());
end;
$function$;

-- ---------------------------------------------------------------------------
-- get_order_tracking: + delivery_by, vendor_name (customer UI: "Delivered by {store}")
-- ---------------------------------------------------------------------------

drop function get_order_tracking(uuid);

CREATE OR REPLACE FUNCTION public.get_order_tracking(p_order_id uuid)
 RETURNS TABLE(status text, vendor_lat double precision, vendor_lng double precision, destination_lat double precision, destination_lng double precision, rider_lat double precision, rider_lng double precision, rider_updated_at timestamp with time zone, rider_name text, rider_phone text, rider_vehicle_type text, rider_plate_number text, delivery_by text, vendor_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order  orders;
  v_vendor vendors;
  v_rider  order_rider_locations;
  v_rider_profile profiles;
  v_rider_row riders;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'get_order_tracking: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- Authorization unchanged from 0029: the order's own customer, its
  -- vendor's staff, or an admin/superadmin.
  if auth.uid() is distinct from v_order.customer_id
    and not exists (
      select 1 from vendor_staff where vendor_id = v_order.vendor_id and user_id = auth.uid()
    )
    and not exists (
      select 1 from user_roles where user_id = auth.uid() and role in ('admin', 'superadmin')
    )
  then
    raise exception 'get_order_tracking: actor % is not authorized to view order %', auth.uid(), p_order_id;
  end if;

  select * into v_vendor from vendors where id = v_order.vendor_id;
  select * into v_rider from order_rider_locations where order_id = p_order_id;

  if v_order.rider_id is not null then
    select * into v_rider_profile from profiles where id = v_order.rider_id;
    select * into v_rider_row from riders where user_id = v_order.rider_id;
  end if;

  return query
  select
    v_order.status::text,
    st_y(v_vendor.location::geometry),
    st_x(v_vendor.location::geometry),
    st_y(v_order.delivery_location::geometry),
    st_x(v_order.delivery_location::geometry),
    v_rider.lat,
    v_rider.lng,
    v_rider.updated_at,
    v_rider_profile.full_name,
    v_rider_profile.phone,
    v_rider_row.vehicle_type,
    v_rider_row.plate_number,
    v_order.delivery_by,
    v_vendor.name;
end;
$function$;

revoke execute on function get_order_tracking(uuid) from public, anon;
grant execute on function get_order_tracking(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin_set_dispatch_setting: no widened-radius key, no cross-key rule any more
-- ---------------------------------------------------------------------------

create or replace function admin_set_dispatch_setting(
  p_key        text,
  p_value      integer,
  p_reason     text,
  p_actor_id   uuid
)
returns platform_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      platform_settings;
  v_before   bigint;
  v_reason   text;
begin
  perform _assert_admin_actor('admin_set_dispatch_setting', p_actor_id, 'admin');
  v_reason := _admin_reason('admin_set_dispatch_setting', p_reason, true);

  if p_key is null or p_value is null then
    raise exception 'admin_set_dispatch_setting: a setting and a value are required'
      using errcode = 'check_violation';
  end if;

  if p_key = 'dispatch_radius_m' then
    if p_value <> 0 and p_value not between 1000 and 50000 then
      raise exception 'admin_set_dispatch_setting: the first-round dispatch radius must be 0 (no limit) or between 1000 and 50000 metres, got %', p_value
        using errcode = 'check_violation';
    end if;
  elsif p_key = 'dispatch_max_riders' then
    if p_value not between 1 and 50 then
      raise exception 'admin_set_dispatch_setting: riders per round must be between 1 and 50, got %', p_value
        using errcode = 'check_violation';
    end if;
  elsif p_key = 'dispatch_widen_after_seconds' then
    if p_value not between 0 and 1800 then
      raise exception 'admin_set_dispatch_setting: the widen delay must be between 0 (never) and 1800 seconds, got %', p_value
        using errcode = 'check_violation';
    end if;
  elsif p_key = 'dispatch_notify_vendor_after_seconds' then
    if p_value not between 0 and 1800 then
      raise exception 'admin_set_dispatch_setting: the vendor-notification delay must be between 0 (off) and 1800 seconds, got %', p_value
        using errcode = 'check_violation';
    end if;
  elsif p_key = 'dispatch_location_max_age_seconds' then
    if p_value not between 60 and 300 then
      raise exception 'admin_set_dispatch_setting: the location freshness window must be between 60 and 300 seconds (a rider pinging over 5 minutes ago cannot accept an offer), got %', p_value
        using errcode = 'check_violation';
    end if;
  else
    raise exception 'admin_set_dispatch_setting: unknown dispatch setting %', p_key
      using errcode = 'check_violation';
  end if;

  select * into v_row from platform_settings where key = p_key for update;
  if not found then
    raise exception 'admin_set_dispatch_setting: setting % is not configured', p_key
      using errcode = 'no_data_found';
  end if;

  v_before := v_row.value_int;
  if v_before = p_value then
    return v_row;
  end if;

  update platform_settings
  set value_int = p_value, updated_at = now(), updated_by = p_actor_id
  where key = p_key
  returning * into v_row;

  perform _write_admin_audit(p_actor_id, 'dispatch_setting.set', 'platform_setting', v_row.id, v_reason,
    jsonb_build_object('key', p_key, 'unit', v_row.unit, 'from', v_before, 'to', p_value));

  return v_row;
end;
$$;

comment on function admin_set_dispatch_setting(text, integer, text, uuid) is
  'Sets a dispatch key in platform_settings: dispatch_radius_m (first-round radius, 0 = no limit, else 1000-50000), dispatch_max_riders (1-50), dispatch_widen_after_seconds (0-1800, 0 = never), dispatch_notify_vendor_after_seconds (0-1800, 0 = off), dispatch_location_max_age_seconds (60-300). A widened search uses the vendor''s own delivery radius (capped at 50000 m), not a setting. Admin tier (dispatch moves no money). Row-locked, audited (dispatch_setting.set, before/after), unchanged value is a no-op with no audit row. service_role only.';

-- ---------------------------------------------------------------------------
-- _dispatch_offer_round: widened radius = the store's radius; vendor notification
-- ---------------------------------------------------------------------------

create or replace function _dispatch_offer_round(
  p_order_id          uuid,
  p_cycle_started_at  timestamptz,
  p_batch_size        integer default null,
  p_widen             text default 'auto'
)
returns table (o_offers integer, o_in_range integer, o_radius_m integer, o_tier text)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order           orders;
  v_vendor_location geography(point, 4326);
  v_avg_prep        integer;
  v_area            service_areas;
  v_max_rider_fee   bigint;
  v_offered         integer;
  v_radius          integer := _platform_setting_int('dispatch_radius_m')::integer;
  v_widen_after     integer := _platform_setting_int('dispatch_widen_after_seconds')::integer;
  v_max_age         integer := _platform_setting_int('dispatch_location_max_age_seconds')::integer;
  v_notify_after    integer := _platform_setting_int('dispatch_notify_vendor_after_seconds')::integer;
  v_batch           integer;
  v_store_radius    integer;
  v_eff_radius      integer;   -- null = no cap
  v_tier            text := 'base';
  c                 record;
begin
  if p_widen not in ('auto', 'force', 'never') then
    raise exception '_dispatch_offer_round: unknown widen mode %', p_widen;
  end if;
  v_batch := coalesce(p_batch_size, _platform_setting_int('dispatch_max_riders')::integer);

  select * into v_order from orders where id = p_order_id;
  if not found or v_order.service_area_id is null or v_order.delivery_by = 'vendor' then
    return query select 0, 0, null::integer, 'base'::text;
    return;
  end if;

  select location, avg_prep_mins into v_vendor_location, v_avg_prep from vendors where id = v_order.vendor_id;
  if v_vendor_location is null then
    return query select 0, 0, null::integer, 'base'::text;
    return;
  end if;

  select * into v_area from service_areas where id = v_order.service_area_id;
  if not found then
    return query select 0, 0, null::integer, 'base'::text;
    return;
  end if;

  v_max_rider_fee := _max_rider_fee_kobo(p_order_id);

  -- Radius tier. No cap configured: everything is 'base' and unbounded. With a
  -- cap, the widened tier is the store's own delivery radius (0098).
  v_eff_radius := nullif(v_radius, 0);
  v_store_radius := _dispatch_store_radius_m(v_order.vendor_id);
  if v_radius > 0 and (
       p_widen = 'force'
       or (p_widen = 'auto' and v_widen_after > 0
           and now() >= _dispatch_wait_start(v_order, v_avg_prep) + make_interval(secs => v_widen_after))
     ) then
    v_tier := 'widened';
    v_eff_radius := v_store_radius;
  end if;

  -- The 0083 batch query; changes since: batch size / ping window from settings,
  -- radius predicate when a cap is set (0097).
  insert into dispatch_offers (order_id, rider_id)
  select p_order_id, r.user_id
  from riders r
  where r.is_online
    and r.kyc_status = 'approved'
    and r.current_location is not null
    and r.last_ping_at >= now() - make_interval(secs => v_max_age)
    and (v_eff_radius is null or st_dwithin(r.current_location, v_vendor_location, v_eff_radius))
    and exists (select 1 from profiles p where p.id = r.user_id and p.status = 'active')
    and not exists (
      select 1 from orders o
      where o.rider_id = r.user_id
        and o.status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')
    )
    and v_area.rider_base_fee_kobo
        + v_area.rider_per_km_fee_kobo
          * ceil((st_distance(r.current_location, v_vendor_location) + coalesce(v_order.distance_m, 0)) / 1000.0)::bigint
        <= v_max_rider_fee
    and not exists (
      select 1 from dispatch_offers d
      where d.order_id = p_order_id
        and d.rider_id = r.user_id
        and (d.status in ('declined', 'revoked', 'accepted', 'offered') or d.offered_at >= p_cycle_started_at)
    )
  order by r.current_location <-> v_vendor_location
  limit v_batch
  on conflict (order_id, rider_id) do update
    set status       = 'offered',
        offered_at   = now(),
        expires_at   = now() + _dispatch_offer_ttl(),
        responded_at = null
    where dispatch_offers.status = 'expired';

  get diagnostics v_offered = row_count;

  if v_offered = 0 then
    select * into c from _dispatch_rider_counts(p_order_id, v_eff_radius);
    insert into dispatch_attempts (order_id, tier, radius_m, online_riders, eligible_riders, riders_in_range, riders_fundable, offers_created)
    values (p_order_id, v_tier, v_eff_radius, c.online_riders, c.eligible_riders, c.in_range_riders, c.fundable_riders, 0)
    on conflict (order_id, tier) do update
      set attempted_at    = now(),
          attempts        = dispatch_attempts.attempts + 1,
          radius_m        = excluded.radius_m,
          online_riders   = excluded.online_riders,
          eligible_riders = excluded.eligible_riders,
          riders_in_range = excluded.riders_in_range,
          riders_fundable = excluded.riders_fundable,
          offers_created  = 0
      where dispatch_attempts.attempted_at < now() - interval '60 seconds'
         or (dispatch_attempts.radius_m, dispatch_attempts.online_riders, dispatch_attempts.eligible_riders,
             dispatch_attempts.riders_in_range, dispatch_attempts.riders_fundable)
            is distinct from
            (excluded.radius_m, excluded.online_riders, excluded.eligible_riders,
             excluded.riders_in_range, excluded.riders_fundable);

    -- 0098: tell the vendor, once per order, that nobody is near them.
    if v_notify_after > 0
       and c.in_range_riders = 0
       and now() >= _dispatch_wait_start(v_order, v_avg_prep) + make_interval(secs => v_notify_after)
       and not exists (select 1 from dispatch_offers d where d.order_id = p_order_id and d.status = 'offered' and d.expires_at > now()) then
      insert into notifications (vendor_id, order_id, kind, title, body)
      values (
        v_order.vendor_id, p_order_id, 'no_rider_nearby', 'No rider nearby',
        case
          when v_radius > 0 and v_store_radius > coalesce(v_eff_radius, 0)
            then format('No rider is near you right now for order %s. You can look for riders up to %s km away, or deliver it yourself.',
                        v_order.code, regexp_replace(round(v_store_radius / 1000.0, 1)::text, '\.0$', ''))
          else format('No rider is near you right now for order %s. You can wait for one, or deliver it yourself.', v_order.code)
        end)
      on conflict (order_id, kind) where kind is not null do nothing;
    end if;

    return query select 0, c.in_range_riders, v_eff_radius, v_tier;
  else
    return query select v_offered, null::integer, v_eff_radius, v_tier;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- admin_dispatch_status: store radius instead of the global widened radius
-- ---------------------------------------------------------------------------
-- Per order: store_radius_m (the widened radius), riders_within_store_radius
-- (was riders_within_widened_radius). settings.widened_radius_m is gone;
-- settings.notify_vendor_after_seconds is new.

create or replace function admin_dispatch_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
  v_radius      integer := _platform_setting_int('dispatch_radius_m')::integer;
  v_widen_after integer := _platform_setting_int('dispatch_widen_after_seconds')::integer;
  v_result      jsonb;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'admin_dispatch_status: requires the service-role key';
  end if;

  select jsonb_build_object(
    'settings', jsonb_build_object(
      'radius_m', v_radius,
      'max_riders', _platform_setting_int('dispatch_max_riders'),
      'widen_after_seconds', v_widen_after,
      'location_max_age_seconds', _platform_setting_int('dispatch_location_max_age_seconds'),
      'notify_vendor_after_seconds', _platform_setting_int('dispatch_notify_vendor_after_seconds')
    ),
    'online_riders', (select count(*) from riders where is_online and kyc_status = 'approved'),
    'stuck_orders', coalesce((
      select jsonb_agg(x.js order by x.waiting_since)
      from (
        select w.waiting_since,
          jsonb_build_object(
            'order_id', w.order_id,
            'code', o.code,
            'vendor_id', o.vendor_id,
            'vendor_name', v.name,
            'status', w.status,
            'waiting_since', w.waiting_since,
            'delivery_by', o.delivery_by,
            'offers_made', (select count(*) from dispatch_offers d where d.order_id = w.order_id),
            'offers_open', (select count(*) from dispatch_offers d where d.order_id = w.order_id and d.status = 'offered' and d.expires_at > now()),
            'nearest_online_rider_m', f.nearest_online_m,
            'riders_within_radius', f.in_range1,
            'store_radius_m', sr.store_radius_m,
            'riders_within_store_radius', f.in_range2,
            'last_attempt', (
              select jsonb_build_object('at', a.attempted_at, 'radius_m', a.radius_m,
                                        'riders_in_range', a.riders_in_range, 'offers_created', a.offers_created)
              from dispatch_attempts a where a.order_id = w.order_id
              order by a.attempted_at desc limit 1
            ),
            'reason', case
              when exists (select 1 from dispatch_offers d where d.order_id = w.order_id and d.status = 'offered' and d.expires_at > now())
                then 'offers_pending'
              when ce.eligible_riders = 0 then 'no_online_riders'
              when ce.in_range_riders = 0 then 'none_in_range'
              when ce.fundable_riders = 0 then 'fee_exceeds_order_budget'
              when exists (select 1 from dispatch_offers d where d.order_id = w.order_id) then 'all_declined_or_expired'
              else 'awaiting_dispatch'
            end,
            'widened', widened.is_widened,
            'eligible_riders', ce.eligible_riders,
            'fundable_riders_in_range', ce.fundable_riders
          ) as js
        from _dispatch_waiting_orders() w
        join orders o on o.id = w.order_id
        join vendors v on v.id = o.vendor_id
        cross join lateral (select _dispatch_store_radius_m(o.vendor_id) as store_radius_m) sr
        cross join lateral (select v_radius > 0 and v_widen_after > 0
                                   and now() >= w.waiting_since + make_interval(secs => v_widen_after) as is_widened) widened
        cross join lateral _dispatch_rider_funnel(w.order_id, nullif(v_radius, 0), sr.store_radius_m) f
        cross join lateral (select f.eligible_riders as eligible_riders,
                                   case when widened.is_widened then f.in_range2 else f.in_range1 end as in_range_riders,
                                   case when widened.is_widened then f.fundable2 else f.fundable1 end as fundable_riders) ce
        where w.waiting_since < now() - interval '60 seconds'
        order by w.waiting_since
        limit 50
      ) x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Redispatch: shared core, admin entry point
-- ---------------------------------------------------------------------------

-- Caller holds the order lock and has validated the state. Never resets
-- declined/revoked riders; a rider with a live offer is skipped by the batch.
create function _redispatch_core(p_order_id uuid, p_widen boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order    orders;
  v_cycle    timestamptz;
  v_mode     text := case when coalesce(p_widen, true) then 'force' else 'never' end;
  v_created  integer;
  v_in_range integer;
  v_radius   integer;
  v_tier     text;
  r          record;
begin
  select * into v_order from orders where id = p_order_id;

  -- Anchors for the 30 minute give-up and the cycle exclusion, same as the sweeps.
  if v_order.status = 'ready_for_pickup' and v_order.first_dispatched_at is null then
    update orders set first_dispatched_at = now() where id = p_order_id;
    v_order.first_dispatched_at := now();
  end if;
  v_cycle := coalesce(v_order.dispatch_cycle_started_at, v_order.first_dispatched_at);
  if v_cycle is null then
    update orders set dispatch_cycle_started_at = now() where id = p_order_id;
    v_cycle := now();
  end if;

  select * into r from _dispatch_offer_round(p_order_id, v_cycle, null, v_mode);
  v_created := r.o_offers; v_in_range := r.o_in_range; v_radius := r.o_radius_m; v_tier := r.o_tier;

  if v_created = 0
     and not exists (select 1 from dispatch_offers where order_id = p_order_id and status = 'offered')
     and exists (select 1 from dispatch_offers where order_id = p_order_id and offered_at >= v_cycle) then
    update orders set dispatch_cycle_started_at = now() where id = p_order_id;
    select * into r from _dispatch_offer_round(p_order_id, now(), null, v_mode);
    v_created := r.o_offers; v_in_range := r.o_in_range; v_radius := r.o_radius_m; v_tier := r.o_tier;
  end if;

  return jsonb_build_object(
    'offers_created', v_created,
    'riders_in_range', v_in_range,
    'radius_m', v_radius,
    'tier', v_tier
  );
end;
$function$;

revoke all on function _redispatch_core(uuid, boolean) from public, anon, authenticated, service_role;

create or replace function admin_redispatch_order(
  p_order_id  uuid,
  p_reason    text,
  p_actor_id  uuid,
  p_widen     boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_reason  text;
  v_order   orders;
  v_result  jsonb;
begin
  perform _assert_admin_actor('admin_redispatch_order', p_actor_id);
  v_reason := _admin_reason('admin_redispatch_order', p_reason, true);

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'admin_redispatch_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.status not in ('ready_for_pickup', 'accepted', 'preparing') then
    raise exception 'admin_redispatch_order: order % is % - only an order waiting for a rider (ready_for_pickup, accepted, preparing) can be re-dispatched', v_order.code, v_order.status
      using errcode = 'check_violation';
  end if;
  if v_order.rider_id is not null then
    raise exception 'admin_redispatch_order: order % already has a rider', v_order.code
      using errcode = 'check_violation';
  end if;
  if v_order.delivery_by = 'vendor' then
    raise exception 'admin_redispatch_order: order % is being delivered by the vendor themselves', v_order.code
      using errcode = 'check_violation';
  end if;

  v_result := _redispatch_core(p_order_id, p_widen);

  perform _write_admin_audit(
    p_actor_id, 'order.redispatch', 'order', p_order_id, v_reason,
    jsonb_build_object(
      'status', v_order.status,
      'widen', coalesce(p_widen, true),
      'tier', v_result -> 'tier',
      'radius_m', v_result -> 'radius_m',
      'offers_created', v_result -> 'offers_created',
      'riders_in_range', v_result -> 'riders_in_range'
    )
  );

  return v_result;
end;
$function$;

comment on function admin_redispatch_order(uuid, text, uuid, boolean) is
  'Re-runs dispatch for one stuck order now (ready_for_pickup, accepted or preparing; no rider; not vendor-delivered), with p_widen (default true) at the store''s own delivery radius (capped at 50000 m; no effect while dispatch_radius_m is 0). Row-locked. Never re-asks a rider who declined or was revoked, never double-offers a live offer. Reason required; one order.redispatch audit row. Returns {offers_created, riders_in_range (null when offers were created), radius_m (null = no cap), tier}. Admin tier, service_role only.';

-- ---------------------------------------------------------------------------
-- Vendor RPCs
-- ---------------------------------------------------------------------------

-- Staff of the order's vendor, active account. Looks the vendor up WITHOUT the
-- row lock first, so another vendor's order is refused (with the same message as
-- a missing one) before anything is locked.
create function _vendor_order_guard(p_caller text, p_order_id uuid, p_lock boolean)
returns orders
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid     uuid := auth.uid();
  v_vendor  uuid;
  v_order   orders;
begin
  if v_uid is null then
    raise exception '%: sign in first', p_caller using errcode = 'insufficient_privilege';
  end if;
  select vendor_id into v_vendor from orders where id = p_order_id;
  if v_vendor is null or not exists (select 1 from vendor_staff where vendor_id = v_vendor and user_id = v_uid) then
    raise exception '%: order not found', p_caller using errcode = 'insufficient_privilege';
  end if;
  perform _assert_active_caller();
  if p_lock then
    select * into v_order from orders where id = p_order_id for update;
  else
    select * into v_order from orders where id = p_order_id;
  end if;
  return v_order;
end;
$function$;

revoke all on function _vendor_order_guard(text, uuid, boolean) from public, anon, authenticated, service_role;

-- Where the vendor's rider search stands, shared by vendor_dispatch_state() and
-- vendor_expand_rider_search().
create function _vendor_dispatch_view(p_order orders)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_radius        integer := _platform_setting_int('dispatch_radius_m')::integer;
  v_widen_after   integer := _platform_setting_int('dispatch_widen_after_seconds')::integer;
  v_notify_after  integer := _platform_setting_int('dispatch_notify_vendor_after_seconds')::integer;
  v_avg_prep      integer;
  v_waiting_since timestamptz;
  v_store         integer;
  v_eff           integer;
  v_widened       boolean;
  v_can_widen     boolean;
  v_count         integer;
  v_last          timestamptz;
  v_state         text;
  v_in_range      integer := 0;
  v_open          boolean;
  v_wait_s        integer;
  c               record;
begin
  select avg_prep_mins into v_avg_prep from vendors where id = p_order.vendor_id;
  v_store := _dispatch_store_radius_m(p_order.vendor_id);

  if p_order.delivery_by = 'vendor' then
    v_state := 'self_delivery';
  elsif p_order.rider_id is not null then
    v_state := 'rider_assigned';
  elsif p_order.status not in ('ready_for_pickup', 'accepted', 'preparing') then
    v_state := 'not_applicable';
  end if;

  if v_state is not null then
    return jsonb_build_object('state', v_state, 'can_expand', false, 'expand_available_in_seconds', null,
                              'riders_in_range', 0, 'radius_m', nullif(v_radius, 0), 'base_radius_m', v_radius, 'store_radius_m', v_store);
  end if;

  v_waiting_since := _dispatch_wait_start(p_order, v_avg_prep);
  v_widened := v_radius > 0 and v_widen_after > 0 and now() >= v_waiting_since + make_interval(secs => v_widen_after);
  v_eff := case when v_radius = 0 then null when v_widened then v_store else v_radius end;
  -- A wider radius exists only when a cap is set and the store's radius exceeds
  -- the one in use.
  v_can_widen := v_radius > 0 and v_store > coalesce(v_eff, 0);

  select * into c from _dispatch_rider_counts(p_order.id, v_eff);
  v_in_range := c.in_range_riders;
  v_open := exists (select 1 from dispatch_offers d where d.order_id = p_order.id and d.status = 'offered' and d.expires_at > now());

  v_state := case
    when not v_open and v_in_range = 0 and now() >= v_waiting_since + make_interval(secs => v_notify_after) then 'no_rider_nearby'
    else 'offers_pending'
  end;

  select count(*), max(expanded_at) into v_count, v_last from dispatch_expansions where order_id = p_order.id;
  v_wait_s := case when v_last is null then 0 else greatest(0, ceil(extract(epoch from (v_last + interval '120 seconds' - now())))::integer) end;

  return jsonb_build_object(
    'state', v_state,
    'can_expand', v_can_widen and v_count < 3 and v_wait_s = 0,
    'expand_available_in_seconds', case when v_can_widen and v_count < 3 and v_wait_s > 0 then v_wait_s end,
    'riders_in_range', v_in_range,
    'radius_m', v_eff,
    'base_radius_m', v_radius,
    'store_radius_m', v_store,
    'expansions_used', v_count
  );
end;
$function$;

revoke all on function _vendor_dispatch_view(orders) from public, anon, authenticated, service_role;

create function vendor_dispatch_state(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_order orders;
begin
  v_order := _vendor_order_guard('vendor_dispatch_state', p_order_id, false);
  return _vendor_dispatch_view(v_order);
end;
$function$;

comment on function vendor_dispatch_state(uuid) is
  'For vendor staff of the order''s vendor: {state: offers_pending | no_rider_nearby | rider_assigned | self_delivery | not_applicable, can_expand, expand_available_in_seconds (null = now or never), riders_in_range (available riders within radius_m), radius_m (in use; null = no limit), base_radius_m (0 = no limit), store_radius_m (what expanding searches, capped at 50000), expansions_used}. authenticated only.';

create function vendor_expand_rider_search(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order   orders;
  v_view    jsonb;
  v_result  jsonb;
begin
  v_order := _vendor_order_guard('vendor_expand_rider_search', p_order_id, true);

  if v_order.delivery_by = 'vendor' or v_order.rider_id is not null
     or v_order.status not in ('ready_for_pickup', 'accepted', 'preparing') then
    raise exception 'vendor_expand_rider_search: this order is not waiting for a rider'
      using errcode = 'check_violation';
  end if;

  v_view := _vendor_dispatch_view(v_order);

  if (v_view ->> 'expansions_used')::integer >= 3 then
    raise exception 'rate_limited: the rider search for this order can only be widened 3 times'
      using errcode = 'P0429';
  end if;
  if (v_view ->> 'expand_available_in_seconds') is not null then
    raise exception 'rate_limited: try again in % seconds', v_view ->> 'expand_available_in_seconds'
      using errcode = 'P0429';
  end if;
  if not (v_view ->> 'can_expand')::boolean then
    raise exception 'vendor_expand_rider_search: riders are already being searched up to your full delivery radius'
      using errcode = 'check_violation';
  end if;

  v_result := _redispatch_core(p_order_id, true);

  insert into dispatch_expansions (order_id, vendor_user_id, offers_created)
  values (p_order_id, auth.uid(), (v_result ->> 'offers_created')::integer);

  return v_result;
end;
$function$;

comment on function vendor_expand_rider_search(uuid) is
  'Vendor staff widen the rider search for one of their orders to the store''s own delivery radius (capped at 50000 m; the vendor supplies no distance). Same logic as admin_redispatch_order(widen true). At most 3 per order, one per 120 s (SQLSTATE P0429, message starts rate_limited:). Refuses an order that is not waiting for a rider, or when there is nothing wider to search. Returns {offers_created, riders_in_range, radius_m, tier}. Idempotent against duplicates. authenticated only.';

create function vendor_start_self_delivery(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order  orders;
  v_store  text;
  v_closed integer;
begin
  v_order := _vendor_order_guard('vendor_start_self_delivery', p_order_id, true);

  if v_order.delivery_by = 'vendor' then
    return jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'delivery_by', 'vendor', 'changed', false);
  end if;
  if v_order.rider_id is not null then
    raise exception 'vendor_start_self_delivery: a rider is already assigned to order %', v_order.code
      using errcode = 'check_violation';
  end if;
  if v_order.status not in ('accepted', 'preparing', 'ready_for_pickup') then
    raise exception 'vendor_start_self_delivery: order % is % - you can only choose to deliver it yourself before it is picked up', v_order.code, v_order.status
      using errcode = 'check_violation';
  end if;
  if v_order.payment_status <> 'paid' then
    raise exception 'vendor_start_self_delivery: order % is not paid', v_order.code
      using errcode = 'check_violation';
  end if;

  update orders set delivery_by = 'vendor' where id = p_order_id returning * into v_order;

  -- Close every open offer. 'revoked' is the status the rest of the system
  -- treats as final: accept needs status 'offered', the batch never re-offers a
  -- revoked rider, riders' offer lists only show live offers.
  with closed as (
    update dispatch_offers set status = 'revoked', responded_at = now()
    where order_id = p_order_id and status = 'offered'
    returning id
  ), sms as (
    update message_outbox m
    set status = 'suppressed', suppress_reason = 'expired'
    from closed c
    where m.dedupe_key = 'offer:' || c.id::text || ':sms' and m.status = 'queued'
    returning 1
  )
  select count(*)::integer into v_closed from closed;

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (p_order_id, v_order.status, v_order.status, 'vendor', auth.uid(),
          jsonb_build_object('delivery_by', 'vendor', 'offers_closed', v_closed));

  select name into v_store from vendors where id = v_order.vendor_id;
  insert into notifications (customer_id, order_id, title, body)
  values (v_order.customer_id, p_order_id, 'Delivery update',
          format('%s will deliver your order %s themselves.', v_store, v_order.code));

  return jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'delivery_by', 'vendor', 'changed', true, 'offers_closed', v_closed);
end;
$function$;

comment on function vendor_start_self_delivery(uuid) is
  'Vendor staff choose to deliver their own order (accepted / preparing / ready_for_pickup, no rider, paid). Sets orders.delivery_by = vendor (irreversible), revokes every open offer (and cancels their queued SMS), writes an order_events row, tells the customer. Replay is a no-op. The vendor then marks it ready as usual and uses vendor_advance_self_delivery / vendor_complete_self_delivery. authenticated only.';

create function vendor_advance_self_delivery(p_order_id uuid, p_to_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order orders;
  v_from  order_status;
begin
  v_order := _vendor_order_guard('vendor_advance_self_delivery', p_order_id, true);

  if v_order.delivery_by <> 'vendor' then
    raise exception 'vendor_advance_self_delivery: order % is not being delivered by the vendor', v_order.code
      using errcode = 'check_violation';
  end if;
  if p_to_status is null or p_to_status not in ('picked_up', 'in_transit', 'arrived') then
    raise exception 'vendor_advance_self_delivery: status must be picked_up, in_transit or arrived'
      using errcode = 'check_violation';
  end if;
  v_from := case p_to_status when 'picked_up' then 'ready_for_pickup' when 'in_transit' then 'picked_up' else 'in_transit' end;
  if v_order.status <> v_from then
    raise exception 'vendor_advance_self_delivery: order % is % - it must be % to move to %', v_order.code, v_order.status, v_from, p_to_status
      using errcode = 'check_violation';
  end if;

  v_order := transition_order(p_order_id, p_to_status::order_status, 'vendor', auth.uid(), '{"delivery_by": "vendor"}'::jsonb);
  return jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'delivery_by', v_order.delivery_by);
end;
$function$;

comment on function vendor_advance_self_delivery(uuid, text) is
  'Vendor staff move their own self-delivered order ready_for_pickup -> picked_up -> in_transit -> arrived (customer notifications come from the normal status triggers, worded for a vendor delivery). authenticated only.';

create function vendor_complete_self_delivery(p_order_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order  orders;
  v_result delivery_verification_result;
begin
  v_order := _vendor_order_guard('vendor_complete_self_delivery', p_order_id, true);

  if v_order.delivery_by <> 'vendor' then
    raise exception 'vendor_complete_self_delivery: order % is not being delivered by the vendor', v_order.code
      using errcode = 'check_violation';
  end if;

  v_result := _complete_delivery(p_order_id, p_code, 'vendor', auth.uid());
  return jsonb_build_object('code_matched', v_result.code_matched, 'status', (v_result.order_row).status, 'delivery_by', 'vendor');
end;
$function$;

comment on function vendor_complete_self_delivery(uuid, text) is
  'Vendor staff finish a self-delivered order (status arrived) with the customer''s delivery code: same code check, 5-attempt lockout and admin reset as the rider path, then releases escrow once - vendor gets subtotal - commission + delivery fee, nobody else is credited, platform keeps the residual. Wrong code returns code_matched false (and counts an attempt); the 6th attempt raises. Replay returns code_matched true without a second release. authenticated only.';

revoke execute on function vendor_dispatch_state(uuid), vendor_expand_rider_search(uuid), vendor_start_self_delivery(uuid),
  vendor_advance_self_delivery(uuid, text), vendor_complete_self_delivery(uuid, text) from public, anon;
grant execute on function vendor_dispatch_state(uuid), vendor_expand_rider_search(uuid), vendor_start_self_delivery(uuid),
  vendor_advance_self_delivery(uuid, text), vendor_complete_self_delivery(uuid, text) to authenticated;
