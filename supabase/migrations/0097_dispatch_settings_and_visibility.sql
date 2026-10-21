-- KiaKia - admin-configurable dispatch (radius, rider cap, widening, location
-- freshness), a record of why an order got no offers, and admin visibility /
-- re-dispatch for stuck orders.
--
-- WHAT THE INCIDENT REALLY WAS. A paid, ready_for_pickup order got no dispatch
-- offer while the only online approved rider was 8.5 km from the vendor. The
-- brief assumed a hard-coded 5 km radius. THERE IS NONE IN THE LIVE CODE: 0066
-- removed the st_dwithin(..., 5000) cutoff from all three dispatch paths on
-- purpose ("never leaving an order stranded is worth more than bounding how far
-- a rider might be asked to travel"), and nothing re-added it. The one place that
-- decides who is offered an order is _dispatch_offer_batch() (0076, last
-- redefined by 0083); dispatch_order_to_nearby_riders() (the ready trigger),
-- sweep_dispatch_offers() and dispatch_orders_nearing_prep_completion() only call
-- it, so their bodies are NOT changed here. What can silently exclude an 8.5 km
-- rider today is, in the batch query: (a) the FEE-FUNDING rule - the rider's
-- payout (area base + per-km * ceil(rider->vendor + vendor->customer km)) must be
-- <= what the order can fund (_max_rider_fee_kobo: total minus vendor payout), so
-- a small order simply cannot afford a far rider; (b) a location ping older than
-- 5 minutes (a rider whose app is closed stays is_online); (c) an active order
-- already. Nobody was told in any of those cases. admin_dispatch_status() now
-- says which one it is.
--
-- DEFAULTS KEEP TODAY'S BEHAVIOUR (deviation from the brief, deliberately):
--   dispatch_radius_m                    0   = no distance cap (live behaviour;
--                                              1000-50000 turns a cap on)
--   dispatch_max_riders                  10  = riders asked per round (was the
--                                              literal 10)
--   dispatch_widen_after_seconds         60  = wait before the widened radius
--                                              applies (0 = never); inert while
--                                              the radius is 0
--   dispatch_widened_radius_m            10000  must be >= the radius when one
--                                              is set; inert while radius is 0
--   dispatch_location_max_age_seconds    300 = a rider's last ping must be this
--                                              fresh (was the literal 5 minutes;
--                                              60-300: accept_dispatch_offer()
--                                              and _rider_assign_blocker() still
--                                              refuse a ping over 5 minutes old,
--                                              so offering past 300 would offer
--                                              riders who cannot accept; 0 =
--                                              "off" is therefore not allowed)
-- Seeding the radius at 5000 (as briefed) would have been a regression: it would
-- have excluded the very 8.5 km rider that the live code does offer.
--
-- WIDENING. Only meaningful once a radius cap is set. An order is "widened" when
-- it has no rider and has waited >= dispatch_widen_after_seconds since it became
-- dispatchable: ready_at for ready_for_pickup, or accepted_at + (vendor prep time
-- - 8 min) for an early-dispatch accepted/preparing order (the instant 0064's
-- sweep starts offering it). From then every round uses the widened radius
-- instead of the base one. Rounds only happen when the order holds no live offer
-- (the sweep's and early-dispatch's own condition), so "all current offers are
-- declined/expired" holds by construction; riders already declined/revoked/
-- offered this cycle are skipped by the batch's existing exclusions, the 30
-- minute give-up (0067/0076) and the offer TTL (0078) are untouched.
--
-- WHY AN ORDER HAS NO OFFERS: dispatch_attempts, one row per (order, tier
-- 'base'|'widened'), written ONLY when a round creates zero offers and only
-- refreshed when 60 s have passed or the numbers changed - so a stuck order costs
-- at most one small write a minute, not one per 15 s sweep.
--
-- RIDER PUSH / SMS. notify_rider_of_new_offer() (0065) and
-- enqueue_rider_offer_sms() (0096) work off dispatch_offers rows (insert of an
-- 'offered' row / open offered rows), so widened offers get the same push and SMS
-- fallback with no change. Neither assumes any distance.
--
-- Additive and non-destructive: one new table, new functions, one
-- CREATE OR REPLACE of _dispatch_offer_batch and of admin_dashboard_metrics.
-- Grants of replaced functions are preserved.

-- ---------------------------------------------------------------------------
-- platform_settings: more units, the dispatch keys
-- ---------------------------------------------------------------------------

alter table platform_settings drop constraint platform_settings_known_key_and_bounds;
alter table platform_settings drop constraint platform_settings_unit_check;

alter table platform_settings add constraint platform_settings_unit_check
  check (unit in ('bps', 'kobo', 'm', 'count', 'seconds'));

alter table platform_settings add constraint platform_settings_known_key_and_bounds check (
  (key = 'service_fee_bps' and unit = 'bps' and value_int between 0 and 2000)
  or (key = 'default_vendor_commission_bps' and unit = 'bps' and value_int between 0 and 5000)
  or (key = 'dispatch_radius_m' and unit = 'm' and (value_int = 0 or value_int between 1000 and 50000))
  or (key = 'dispatch_max_riders' and unit = 'count' and value_int between 1 and 50)
  or (key = 'dispatch_widen_after_seconds' and unit = 'seconds' and value_int between 0 and 1800)
  or (key = 'dispatch_widened_radius_m' and unit = 'm' and value_int between 1000 and 50000)
  or (key = 'dispatch_location_max_age_seconds' and unit = 'seconds' and value_int between 60 and 300)
);

comment on table platform_settings is
  'Admin-configurable platform-level settings, one row per key: fees (admin_set_platform_fee) and dispatch (admin_set_dispatch_setting, 0097). Written only by those audited functions. Read via _platform_setting_int(). service_role may select; no client role has any access.';

insert into platform_settings (key, value_int, unit) values
  ('dispatch_radius_m', 0, 'm'),
  ('dispatch_max_riders', 10, 'count'),
  ('dispatch_widen_after_seconds', 60, 'seconds'),
  ('dispatch_widened_radius_m', 10000, 'm'),
  ('dispatch_location_max_age_seconds', 300, 'seconds');

-- ---------------------------------------------------------------------------
-- admin_set_dispatch_setting
-- ---------------------------------------------------------------------------
-- TIER: 'admin' (not finance). Dispatch decides who is asked to deliver, never
-- how much anyone is paid: rider fees, the fundability rule and the ledger are
-- untouched, so no money moves. A wrong value is visible at once
-- (admin_dispatch_status) and reversible by the same call, and every change is
-- audited with before/after. Finance tier would only slow the on-call admin who
-- needs to widen the net during an incident.

create function admin_set_dispatch_setting(
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
  v_radius   bigint;
  v_widened  bigint;
begin
  perform _assert_admin_actor('admin_set_dispatch_setting', p_actor_id, 'admin');
  v_reason := _admin_reason('admin_set_dispatch_setting', p_reason, true);

  if p_key is null or p_value is null then
    raise exception 'admin_set_dispatch_setting: a setting and a value are required'
      using errcode = 'check_violation';
  end if;

  if p_key = 'dispatch_radius_m' then
    if p_value <> 0 and p_value not between 1000 and 50000 then
      raise exception 'admin_set_dispatch_setting: the dispatch radius must be 0 (no limit) or between 1000 and 50000 metres, got %', p_value
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
  elsif p_key = 'dispatch_widened_radius_m' then
    if p_value not between 1000 and 50000 then
      raise exception 'admin_set_dispatch_setting: the widened radius must be between 1000 and 50000 metres, got %', p_value
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

  -- Both radius rows are locked, in key order, so two admins editing the pair
  -- cannot interleave into radius > widened; the edited row is among them or a
  -- different key's own row is locked next.
  perform 1 from platform_settings
  where key in ('dispatch_radius_m', 'dispatch_widened_radius_m')
  order by key
  for update;

  select * into v_row from platform_settings where key = p_key for update;
  if not found then
    raise exception 'admin_set_dispatch_setting: setting % is not configured', p_key
      using errcode = 'no_data_found';
  end if;

  v_before := v_row.value_int;
  if v_before = p_value then
    return v_row;
  end if;

  if p_key in ('dispatch_radius_m', 'dispatch_widened_radius_m') then
    select value_int into v_radius from platform_settings where key = 'dispatch_radius_m';
    select value_int into v_widened from platform_settings where key = 'dispatch_widened_radius_m';
    if p_key = 'dispatch_radius_m' then v_radius := p_value; else v_widened := p_value; end if;
    if v_radius > 0 and v_widened < v_radius then
      raise exception 'admin_set_dispatch_setting: the widened radius (% m) must be at least the dispatch radius (% m)', v_widened, v_radius
        using errcode = 'check_violation';
    end if;
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
  'Sets a dispatch key in platform_settings: dispatch_radius_m (0 = no limit, else 1000-50000), dispatch_max_riders (1-50), dispatch_widen_after_seconds (0-1800, 0 = never), dispatch_widened_radius_m (1000-50000, must be >= the radius when one is set), dispatch_location_max_age_seconds (60-300). Admin tier (dispatch moves no money). Row-locked, audited (dispatch_setting.set, before/after), unchanged value is a no-op with no audit row. Takes effect on the next dispatch round. service_role only.';

revoke execute on function admin_set_dispatch_setting(text, integer, text, uuid) from public, anon, authenticated;
grant execute on function admin_set_dispatch_setting(text, integer, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- dispatch_attempts: why an order got no offers
-- ---------------------------------------------------------------------------

create table dispatch_attempts (
  order_id          uuid not null references orders (id) on delete cascade,
  tier              text not null check (tier in ('base', 'widened')),
  first_attempt_at  timestamptz not null default now(),
  attempted_at      timestamptz not null default now(),
  attempts          integer not null default 1,
  radius_m          integer,
  online_riders     integer not null default 0,
  eligible_riders   integer not null default 0,
  riders_in_range   integer not null default 0,
  riders_fundable   integer not null default 0,
  offers_created    integer not null default 0,
  primary key (order_id, tier)
);

comment on table dispatch_attempts is
  'One row per (order, radius tier) recording the latest dispatch round that created ZERO offers: when, the radius used (null = no cap), and how many riders were online / eligible (fresh, active, free) / in range / able to be paid by the order. Refreshed at most once a minute. Written by _dispatch_offer_round(); read by admin_dispatch_status().';

alter table dispatch_attempts enable row level security;
revoke all on dispatch_attempts from public, anon, authenticated, service_role;
grant select on dispatch_attempts to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- When an order became dispatchable (the start of its "waiting" clock). 8 is the
-- same early-dispatch lead as dispatch_orders_nearing_prep_completion() (0064).
create function _dispatch_wait_start(p_order orders, p_avg_prep_mins integer)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when p_order.status = 'ready_for_pickup'
      then coalesce(p_order.ready_at, p_order.first_dispatched_at, p_order.accepted_at, p_order.created_at)
    else p_order.accepted_at + make_interval(mins => greatest(coalesce(p_avg_prep_mins, 0) - 8, 0))
  end
$$;

revoke all on function _dispatch_wait_start(orders, integer) from public, anon, authenticated, service_role;

-- The one definition of "an order waiting for a rider": ready_for_pickup, or
-- accepted/preparing once inside its early-dispatch window, with no rider.
create function _dispatch_waiting_orders()
returns table (order_id uuid, status order_status, waiting_since timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.status, _dispatch_wait_start(o, v.avg_prep_mins)
  from orders o
  join vendors v on v.id = o.vendor_id
  where o.status = 'ready_for_pickup' and o.rider_id is null
  union all
  select o.id, o.status, _dispatch_wait_start(o, v.avg_prep_mins)
  from orders o
  join vendors v on v.id = o.vendor_id
  where o.status in ('accepted', 'preparing') and o.rider_id is null and o.accepted_at is not null
    and now() >= _dispatch_wait_start(o, v.avg_prep_mins)
$$;

comment on function _dispatch_waiting_orders() is
  'Orders waiting for a rider: ready_for_pickup, or accepted/preparing inside the early-dispatch window, rider_id null. waiting_since is when they became dispatchable. Shared by admin_dispatch_status() and admin_dashboard_metrics(). Read-only.';

revoke all on function _dispatch_waiting_orders() from public, anon, authenticated;
grant execute on function _dispatch_waiting_orders() to service_role;

-- Funnel of riders for one order at a radius (null = no cap): who is online, who
-- could be offered (the same availability rules _dispatch_offer_round() applies),
-- who of those is within the radius, and who of those the order can pay.
create function _dispatch_rider_counts(p_order_id uuid, p_radius_m integer)
returns table (online_riders integer, eligible_riders integer, in_range_riders integer, fundable_riders integer, nearest_online_m integer)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select _platform_setting_int('dispatch_location_max_age_seconds')::integer as max_age
  ),
  o as (
    select ord.id, ord.distance_m, v.location as vloc, sa.rider_base_fee_kobo as base_fee, sa.rider_per_km_fee_kobo as per_km,
           _max_rider_fee_kobo(ord.id) as max_fee
    from orders ord
    join vendors v on v.id = ord.vendor_id
    left join service_areas sa on sa.id = ord.service_area_id
    where ord.id = p_order_id
  ),
  r as (
    select st_distance(rd.current_location, o.vloc) as d,
           (rd.last_ping_at >= now() - make_interval(secs => params.max_age)
            and exists (select 1 from profiles p where p.id = rd.user_id and p.status = 'active')
            and not exists (
              select 1 from orders x
              where x.rider_id = rd.user_id
                and x.status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')
            )) as avail,
           (p_radius_m is null or st_dwithin(rd.current_location, o.vloc, p_radius_m)) as in_range,
           (o.base_fee is not null
            and o.base_fee + o.per_km * ceil((st_distance(rd.current_location, o.vloc) + coalesce(o.distance_m, 0)) / 1000.0)::bigint <= o.max_fee) as fundable
    from riders rd
    cross join o
    cross join params
    where rd.is_online and rd.kyc_status = 'approved' and rd.current_location is not null and o.vloc is not null
  )
  select count(*)::integer,
         (count(*) filter (where avail))::integer,
         (count(*) filter (where avail and in_range))::integer,
         (count(*) filter (where avail and in_range and fundable))::integer,
         round(min(d))::integer
  from r
$$;

comment on function _dispatch_rider_counts(uuid, integer) is
  'Rider funnel for one order at a radius (null = no cap): online+approved with a location, of those available (fresh ping, active, no active order), of those in range, of those the order can fund. Plus the distance in metres to the nearest online rider. Internal; read-only.';

revoke all on function _dispatch_rider_counts(uuid, integer) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- _dispatch_offer_round(): the batch query, now settings-driven
-- ---------------------------------------------------------------------------
-- The INSERT is _dispatch_offer_batch() as 0083 left it, with exactly three
-- changes: the batch size and the ping-freshness window come from settings
-- instead of the literals 10 and '5 minutes', and a radius predicate is added
-- when a cap is configured. Everything else (eligibility, fundability, the
-- declined/revoked/accepted/offered/this-cycle exclusions, nearest-first, the
-- expired re-open) is verbatim.
--
-- p_widen: 'auto' widens once the order has waited long enough, 'force' always
-- uses the widened radius, 'never' always the base radius. Only matters when a
-- radius cap is set.

create function _dispatch_offer_round(
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
  v_widened         integer := _platform_setting_int('dispatch_widened_radius_m')::integer;
  v_widen_after     integer := _platform_setting_int('dispatch_widen_after_seconds')::integer;
  v_max_age         integer := _platform_setting_int('dispatch_location_max_age_seconds')::integer;
  v_batch           integer;
  v_eff_radius      integer;   -- null = no cap
  v_tier            text := 'base';
  c                 record;
begin
  if p_widen not in ('auto', 'force', 'never') then
    raise exception '_dispatch_offer_round: unknown widen mode %', p_widen;
  end if;
  v_batch := coalesce(p_batch_size, _platform_setting_int('dispatch_max_riders')::integer);

  select * into v_order from orders where id = p_order_id;
  if not found or v_order.service_area_id is null then
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

  -- Radius tier. No cap configured: everything is 'base' and unbounded.
  v_eff_radius := nullif(v_radius, 0);
  if v_radius > 0 and (
       p_widen = 'force'
       or (p_widen = 'auto' and v_widen_after > 0
           and now() >= _dispatch_wait_start(v_order, v_avg_prep) + make_interval(secs => v_widen_after))
     ) then
    v_tier := 'widened';
    v_eff_radius := v_widened;
  end if;

  -- Closest first, within the radius when one is set (0066 had dropped the cap;
  -- it is now an admin setting, off by default), but only riders who are really
  -- available (online, approved, active account, pinged within the freshness
  -- window, not already on an order - the same rules accept enforces, 0083) and
  -- whose fee the order can actually fund. A rider is skipped if they declined,
  -- were revoked by an admin (0083), already hold a live or accepted offer, or
  -- were already asked in the current cycle; one whose earlier offer merely
  -- EXPIRED (and was not asked this cycle) is re-opened rather than skipped
  -- forever.
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

  -- Zero offers: leave a trace of why (one row per order+tier, refreshed at most
  -- once a minute unless the numbers moved).
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
    return query select 0, c.in_range_riders, v_eff_radius, v_tier;
  else
    return query select v_offered, null::integer, v_eff_radius, v_tier;
  end if;
end;
$function$;

comment on function _dispatch_offer_round(uuid, timestamptz, integer, text) is
  'One dispatch round for one order: offers it to the nearest eligible riders within the configured radius (none = no cap; widened tier after dispatch_widen_after_seconds), up to dispatch_max_riders, using the 0083 eligibility/exclusion rules unchanged. Returns offers created, riders in range (only computed when zero offers were created, and then recorded in dispatch_attempts), the radius used and the tier. p_widen: auto | force | never. Internal.';

revoke all on function _dispatch_offer_round(uuid, timestamptz, integer, text) from public, anon, authenticated, service_role;

-- The batch keeps its name and signature (the three dispatch paths and the 0083
-- override call it with two arguments); only the default batch size is now the
-- setting.
create or replace function _dispatch_offer_batch(
  p_order_id          uuid,
  p_cycle_started_at  timestamptz,
  p_batch_size        integer default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_created integer;
begin
  select r.o_offers into v_created
  from _dispatch_offer_round(p_order_id, p_cycle_started_at, p_batch_size, 'auto') r;
  return coalesce(v_created, 0);
end;
$function$;

comment on function _dispatch_offer_batch(uuid, timestamptz, integer) is
  'Offers an order to the nearest eligible riders and returns how many offers were created or re-opened. Shared by the ready_for_pickup trigger, the early-dispatch sweep and the re-dispatch sweep. Since 0097 a thin wrapper over _dispatch_offer_round(): batch size, radius cap, widening and ping freshness come from platform_settings. Returns 0 for an order with no vendor location or service area. Internal.';

-- ---------------------------------------------------------------------------
-- admin_redispatch_order
-- ---------------------------------------------------------------------------
-- Re-runs offering for ONE stuck order now. Locks the order first (the lock
-- accept_dispatch_offer() and 0083 take), refuses an order that has a rider or is
-- not waiting for one (ready_for_pickup, or accepted/preparing), then does what a
-- sweep tick does: one round; if that found nobody and riders had already been
-- asked this cycle, start a fresh cycle (re-opening riders whose offer merely
-- EXPIRED) and try once more. Declined and revoked riders are never re-asked, and
-- riders who hold a live offer are skipped by the same on-conflict mechanism, so
-- calling it twice cannot double-offer anyone.
-- p_widen true uses the widened radius immediately (when a radius cap is set);
-- false uses the base radius regardless of how long the order has waited.

create function admin_redispatch_order(
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
  v_reason   text;
  v_order    orders;
  v_cycle    timestamptz;
  v_mode     text := case when coalesce(p_widen, true) then 'force' else 'never' end;
  v_created  integer;
  v_in_range integer;
  v_radius   integer;
  v_tier     text;
  r          record;
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

  perform _write_admin_audit(
    p_actor_id, 'order.redispatch', 'order', p_order_id, v_reason,
    jsonb_build_object(
      'status', v_order.status,
      'widen', coalesce(p_widen, true),
      'tier', v_tier,
      'radius_m', v_radius,
      'offers_created', v_created,
      'riders_in_range', v_in_range
    )
  );

  return jsonb_build_object(
    'offers_created', v_created,
    'riders_in_range', v_in_range,   -- null when offers were created (not computed)
    'radius_m', v_radius,            -- null = no distance cap
    'tier', v_tier
  );
end;
$function$;

comment on function admin_redispatch_order(uuid, text, uuid, boolean) is
  'Re-runs dispatch for one stuck order now (ready_for_pickup, accepted or preparing; no rider), using the current dispatch settings and, with p_widen (default true), the widened radius at once. Row-locked; refuses an order with a rider or in another status. Never re-asks a rider who declined or was revoked, and never double-offers a rider with a live offer. Reason required; one order.redispatch audit row. Returns {offers_created, riders_in_range (null when offers were created), radius_m (null = no cap), tier}. Admin tier, service_role only.';

revoke execute on function admin_redispatch_order(uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function admin_redispatch_order(uuid, text, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- admin_dispatch_status
-- ---------------------------------------------------------------------------
-- reason, in this order:
--   offers_pending               an offer is live right now
--   no_online_riders             no rider is available at all (online+approved+
--                                fresh ping+active+free); online_riders / the
--                                per-order eligible_riders show how many are
--                                online but stale or busy
--   none_in_range                available riders exist, none within the radius
--                                the order currently uses (base, or widened once
--                                it has waited long enough)
--   fee_exceeds_order_budget     riders in range, but the order cannot fund any
--                                of their payouts (the 0076 rule) - the likeliest
--                                cause of "a rider 8 km away was never asked"
--   all_declined_or_expired      offers were made and none is open
--   awaiting_dispatch            fundable riders exist and nothing has been
--                                offered yet (the next 15 s sweep will)

create function admin_dispatch_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
  v_radius      integer := _platform_setting_int('dispatch_radius_m')::integer;
  v_widened     integer := _platform_setting_int('dispatch_widened_radius_m')::integer;
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
      'widened_radius_m', v_widened,
      'location_max_age_seconds', _platform_setting_int('dispatch_location_max_age_seconds')
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
            'offers_made', (select count(*) from dispatch_offers d where d.order_id = w.order_id),
            'offers_open', (select count(*) from dispatch_offers d where d.order_id = w.order_id and d.status = 'offered' and d.expires_at > now()),
            'nearest_online_rider_m', cb.nearest_online_m,
            'riders_within_radius', cb.in_range_riders,
            'riders_within_widened_radius', cw.in_range_riders,
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
            -- additive detail
            'widened', widened.is_widened,
            'eligible_riders', ce.eligible_riders,
            'fundable_riders_in_range', ce.fundable_riders
          ) as js
        from _dispatch_waiting_orders() w
        join orders o on o.id = w.order_id
        join vendors v on v.id = o.vendor_id
        cross join lateral (select v_radius > 0 and v_widen_after > 0
                                   and now() >= w.waiting_since + make_interval(secs => v_widen_after) as is_widened) widened
        cross join lateral _dispatch_rider_counts(w.order_id, nullif(v_radius, 0)) cb
        cross join lateral _dispatch_rider_counts(w.order_id, v_widened) cw
        cross join lateral (select case when widened.is_widened then cw.eligible_riders else cb.eligible_riders end as eligible_riders,
                                   case when widened.is_widened then cw.in_range_riders else cb.in_range_riders end as in_range_riders,
                                   case when widened.is_widened then cw.fundable_riders else cb.fundable_riders end as fundable_riders) ce
        where w.waiting_since < now() - interval '60 seconds'
        order by w.waiting_since
        limit 50
      ) x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

comment on function admin_dispatch_status() is
  'Read-only dispatch overview: current dispatch settings, riders online, and up to 50 orders (ready_for_pickup, or accepted/preparing inside the early-dispatch window) with no rider that have waited over 60 s, oldest first, each with offers made/open, nearest online rider, riders within the base and widened radius, the last zero-offer attempt, and a reason (offers_pending | no_online_riders | none_in_range | fee_exceeds_order_budget | all_declined_or_expired | awaiting_dispatch). service_role only.';

revoke execute on function admin_dispatch_status() from public, anon, authenticated;
grant execute on function admin_dispatch_status() to service_role;

-- ---------------------------------------------------------------------------
-- admin_dashboard_metrics: stuck_orders.ready_without_rider now uses the same
-- definition (plus the 0092-shaped additive ready_without_rider_over_15m with
-- the old meaning). Body is the live 0090-era definition, only that block changed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_dashboard_metrics()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with
  delivered as (
    select total_kobo, delivered_at
    from orders
    where status = 'delivered' and delivered_at >= now() - interval '30 days'
  ),
  gateway_refunds as (
    select p.refund_reference, p.refund_status
    from payments p
    join transactions t on t.reference = p.idempotency_key || '-refund'
    where exists (
      select 1
      from ledger_entries le
      join accounts a on a.id = le.account_id
      where le.transaction_id = t.id and le.direction = 'credit'
        and a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway'
    )
  )
  select jsonb_build_object(
    'generated_at', now(),
    'orders_by_status', (
      select jsonb_object_agg(s.status, coalesce(c.n, 0))
      from unnest(array['placed', 'accepted', 'preparing', 'ready_for_pickup', 'rider_assigned',
                        'picked_up', 'in_transit', 'arrived']) as s(status)
      left join (
        select status::text as status, count(*) as n
        from orders
        where status in ('placed', 'accepted', 'preparing', 'ready_for_pickup', 'rider_assigned',
                         'picked_up', 'in_transit', 'arrived')
        group by status
      ) c on c.status = s.status
    ),
    'delivered', jsonb_build_object(
      'last_24h', (select jsonb_build_object('orders', count(*), 'gmv_kobo', coalesce(sum(total_kobo), 0))
                   from delivered where delivered_at >= now() - interval '24 hours'),
      'last_7d',  (select jsonb_build_object('orders', count(*), 'gmv_kobo', coalesce(sum(total_kobo), 0))
                   from delivered where delivered_at >= now() - interval '7 days'),
      'last_30d', (select jsonb_build_object('orders', count(*), 'gmv_kobo', coalesce(sum(total_kobo), 0))
                   from delivered)
    ),
    'platform_revenue_30d_kobo', (
      select coalesce(sum(case when le.direction = 'credit' then le.amount_kobo else -le.amount_kobo end), 0)
      from ledger_entries le
      join accounts a on a.id = le.account_id
      where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'revenue'
        and le.created_at >= now() - interval '30 days'
    ),
    'riders', jsonb_build_object(
      'online', (select count(*) from riders where is_online and kyc_status = 'approved'),
      'pending_kyc', (select count(*) from riders where kyc_status = 'pending'),
      'documents_pending', (select count(*) from rider_documents where status = 'pending')
    ),
    'vendors_suspended', (select count(*) from vendors where status = 'suspended'),
    'stuck_orders', jsonb_build_object(
      -- 0097: the same definition admin_dispatch_status() lists - ready, or
      -- accepted/preparing inside the early-dispatch window, no rider, waiting
      -- over 60 s. (Was: ready_for_pickup only, ready_at over 15 minutes; that
      -- number is kept below as ready_without_rider_over_15m.)
      'ready_without_rider', (
        select count(*) from _dispatch_waiting_orders() w
        where w.waiting_since < now() - interval '60 seconds'
      ),
      'ready_without_rider_over_15m', (
        select count(*) from orders
        where status = 'ready_for_pickup' and rider_id is null and ready_at < now() - interval '15 minutes'
      ),
      'delivery_code_locked', (
        select count(*) from orders o
        where o.status = 'arrived'
          and (
            select count(*) from order_events e
            where e.order_id = o.id
              and (e.meta ->> 'delivery_code_failed')::boolean is true
              and e.at >= o.arrived_at
              and e.at > coalesce((
                select max(r.at) from order_events r
                where r.order_id = o.id and r.actor_type = 'admin'
                  and (r.meta ->> 'delivery_code_attempts_reset')::boolean is true
              ), '-infinity'::timestamptz)
          ) >= 5
      ),
      'failed_delivery_escrow_held', (
        select count(*) from orders where status = 'failed_delivery' and payment_status = 'paid'
      )
    ),
    'capture_anomalies_7d', jsonb_build_object(
      'duplicate_capture', (select count(*) from order_events
                            where meta ? 'duplicate_capture_attempt' and at >= now() - interval '7 days'),
      'underpaid_capture', (select count(*) from order_events
                            where meta ? 'underpaid_capture' and at >= now() - interval '7 days'),
      'amount_mismatch',   (select count(*) from order_events
                            where meta @> '{"amount_mismatch": true}' and at >= now() - interval '7 days')
    ),
    'gateway_refunds', jsonb_build_object(
      'not_requested', (select count(*) from gateway_refunds where refund_reference is null),
      'pending',       (select count(*) from gateway_refunds where refund_status = 'pending'),
      'failed',        (select count(*) from gateway_refunds where refund_status = 'failed')
    )
  );
$function$;
