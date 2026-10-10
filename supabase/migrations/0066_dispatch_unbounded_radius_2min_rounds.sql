-- KiaKia - remove the fixed 5km dispatch radius, replace with an unbounded
-- expanding-ring model: every dispatch round always offers the 10 CLOSEST
-- still-eligible riders, however far away they are, and if a round gets no
-- accept within its TTL, the next round (sweep_dispatch_offers(), 0055,
-- already runs every 15 seconds via cron - see that migration's header)
-- naturally reaches further out, because it excludes every rider already
-- offered and re-sorts by distance over whoever is left. There was never a
-- literal "radius that grows" variable to introduce - nearest-first
-- ordering over a shrinking eligible pool already produces exactly that
-- shape once the hard 5km cutoff is gone. Product decision, not a
-- placeholder: an order with no rider within 5km used to simply never
-- dispatch at all (silently zero eligible rows, see the live order dispatch
-- history inspected this session - vendor "Kunfat"'s order sat undispatched
-- for hours for exactly this reason with only one, too-distant, rider in
-- the system). Never leaving an order stranded is worth more right now than
-- bounding how far a rider might be asked to travel - revisit if the fleet
-- grows large enough that "unbounded" starts meaning "the next rider is
-- genuinely an hour away."
--
-- Two changes, together:
--
--   1. dispatch_offers.expires_at's default TTL: 60 seconds (0028) -> 120
--      seconds. This is the "2 minutes" in "no response after 2 minutes" -
--      sweep_dispatch_offers() already expires any 'offered' row past
--      expires_at and re-offers the order to the next-nearest excluded
--      riders on its very next tick (<=15s later), so bumping this one
--      column default is what turns "round 1 nearest 10" into "round 2
--      offered ~2 minutes after round 1, to the next 10 out" without
--      touching any function body for this part.
--
--   2. The st_dwithin(..., 5000) 5km filter is dropped from all three
--      dispatch call sites - dispatch_order_to_nearby_riders() (0019/0023,
--      last touched 0064), sweep_dispatch_offers() (0055), and
--      dispatch_orders_nearing_prep_completion() (0064). Each keeps its
--      existing "order by st_distance(...) asc limit 10" exactly as before
--      - nearest-first was already correct, only the cutoff is removed.
--      Every other filter (is_online, kyc_status = 'approved',
--      current_location is not null, sweep's extra last_ping_at staleness
--      guard, the not-already-offered exclusion) is untouched.
--
-- Performance note, stated plainly: st_dwithin let Postgres use riders'
-- GiST index on current_location to avoid computing st_distance against
-- every eligible rider. Without a bound, each dispatch call now scans every
-- online/kyc-approved/located rider and sorts all of them by distance. Not
-- a concern at this project's current rider-fleet size; worth revisiting
-- (e.g. reintroducing a much larger soft cap, or a widening-rings query)
-- if that fleet grows into the thousands.

alter table dispatch_offers alter column expires_at set default (now() + interval '120 seconds');

comment on column dispatch_offers.expires_at is
  'Offer TTL, default 120 seconds (2 minutes) from offered_at - widened from the original 60 seconds by 0066_dispatch_unbounded_radius_2min_rounds.sql so a round has a genuine 2-minute window before sweep_dispatch_offers() (0055) expires it and offers the next-nearest riders out. accept_dispatch_offer() (0028, relaxed by 0064) refuses to honor an offer once this has passed.';

-- ---------------------------------------------------------------------------
-- dispatch_order_to_nearby_riders() - drop the 5km cap. Everything else,
-- including 0064's early-accept cascade guard, is reproduced unchanged.
-- ---------------------------------------------------------------------------

create or replace function dispatch_order_to_nearby_riders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor_location geography(point, 4326);
begin
  -- 0064: a rider already claimed this order via an early accept before the
  -- vendor ever reached ready_for_pickup. Don't dispatch fresh offers -
  -- cascade straight to rider_assigned instead. Unchanged by this migration.
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

  select location into v_vendor_location from vendors where id = new.vendor_id;

  if v_vendor_location is null then
    return new;
  end if;

  begin
    -- No distance cap as of 0066 - offers the 10 closest eligible riders
    -- regardless of how far away the nearest one is. See this migration's
    -- own header for why, and for the performance tradeoff being accepted.
    insert into dispatch_offers (order_id, rider_id)
    select new.id, r.user_id
    from riders r
    where r.is_online
      and r.kyc_status = 'approved'
      and r.current_location is not null
    order by st_distance(r.current_location, v_vendor_location) asc
    limit 10
    on conflict (order_id, rider_id) do nothing;
  exception when others then
    raise warning 'dispatch_order_to_nearby_riders: failed to create dispatch offers for order % - %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function dispatch_order_to_nearby_riders() is
  'AFTER UPDATE OF status trigger on orders: when an order becomes ready_for_pickup, either cascades straight to rider_assigned if a rider already pre-committed via an early accept (0064 - new.rider_id is not null), or offers it to the 10 nearest online, KYC-approved riders with a known location - no distance cap as of 0066 (was a 5km st_dwithin filter, 0019/0023). If none of those 10 accept within the 2-minute offer TTL (dispatch_offers.expires_at, widened by 0066), sweep_dispatch_offers() (0055, cron every 15s) offers the next-nearest 10 excluded riders, and so on - an unbounded expanding ring by construction, not a literal radius variable. SECURITY DEFINER because riders/dispatch_offers/orders writes must bypass RLS.';

-- The trigger itself (created in 0019) is unchanged.

-- ---------------------------------------------------------------------------
-- sweep_dispatch_offers() (0055) - drop the 5km cap. Everything else,
-- including the 5-minute last_ping_at staleness guard and the
-- never-re-offer-a-rider-who-already-has-any-row-on-this-order exclusion,
-- is reproduced unchanged.
-- ---------------------------------------------------------------------------

create or replace function sweep_dispatch_offers()
returns table (
  offers_expired  integer,
  offers_created  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role       text := coalesce(auth.role(), current_setting('role', true));
  v_expired_count     integer := 0;
  v_created_count     integer := 0;
  v_inserted          integer;
  v_candidate         record;
  v_order             orders;
  v_vendor_location   geography(point, 4326);
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
      and not exists (
        select 1 from dispatch_offers d where d.order_id = o.id and d.status = 'offered'
      )
  loop
    select * into v_order from orders where id = v_candidate.order_id for update skip locked;
    if not found then
      continue;
    end if;

    if v_order.status <> 'ready_for_pickup' or v_order.rider_id is not null then
      continue;
    end if;

    select location into v_vendor_location from vendors where id = v_order.vendor_id;
    if v_vendor_location is null then
      continue;
    end if;

    begin
      -- No distance cap as of 0066 - see this migration's own header. This
      -- is the step that actually implements "the next-nearest riders out":
      -- the exclusion below already keeps every previously-offered rider
      -- (any status, not just currently-'offered') out of the running, so
      -- with no radius bound, whoever sorts nearest among what's left is,
      -- by definition, farther away than every rider from the round(s)
      -- before it.
      insert into dispatch_offers (order_id, rider_id)
      select v_order.id, r.user_id
      from riders r
      where r.is_online
        and r.kyc_status = 'approved'
        and r.current_location is not null
        and r.last_ping_at is not null
        and r.last_ping_at >= now() - interval '5 minutes'
        and not exists (
          select 1 from dispatch_offers d2
          where d2.order_id = v_order.id and d2.rider_id = r.user_id
        )
      order by st_distance(r.current_location, v_vendor_location) asc
      limit 10
      on conflict (order_id, rider_id) do nothing;

      get diagnostics v_inserted = row_count;
      v_created_count := v_created_count + v_inserted;
    exception when others then
      raise warning 'sweep_dispatch_offers: failed to create dispatch offers for order % - %', v_order.id, sqlerrm;
    end;
  end loop;

  return query select v_expired_count, v_created_count;
end;
$$;

comment on function sweep_dispatch_offers() is
  'Re-dispatch sweep (0055): expires every stale ''offered'' dispatch_offers row past its now-2-minute TTL (dispatch_offers.expires_at, widened by 0066), then re-offers every order still ready_for_pickup with no assigned rider and no live offer to the next-nearest eligible riders - no distance cap as of 0066 (was a 5km st_dwithin filter). Applies is_online/kyc_status/current_location, a 5-minute last_ping_at staleness filter, and excludes any rider who already has any dispatch_offers row on that order (never re-offers a decliner). Run every 15 seconds via cron - see this function''s own prior header (0055) for the pg_cron SET ROLE requirement. service_role only.';

-- ---------------------------------------------------------------------------
-- dispatch_orders_nearing_prep_completion() (0064) - drop the 5km cap.
-- Everything else is reproduced unchanged.
-- ---------------------------------------------------------------------------

create or replace function dispatch_orders_nearing_prep_completion()
returns table (
  offers_created  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role       text := coalesce(auth.role(), current_setting('role', true));
  v_created_count     integer := 0;
  v_inserted          integer;
  v_candidate         record;
  v_order             orders;
  v_vendor_location   geography(point, 4326);
  v_avg_prep_mins     integer;
  c_lead_minutes constant integer := 8;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'dispatch_orders_nearing_prep_completion: requires the service-role key';
  end if;

  for v_candidate in
    select o.id as order_id, o.vendor_id, o.accepted_at
    from orders o
    join vendors v on v.id = o.vendor_id
    where o.status in ('accepted', 'preparing')
      and o.rider_id is null
      and o.accepted_at is not null
      and now() >= o.accepted_at + make_interval(mins => greatest(v.avg_prep_mins - 8, 0))
      and not exists (
        select 1 from dispatch_offers d where d.order_id = o.id and d.status = 'offered'
      )
  loop
    select * into v_order from orders where id = v_candidate.order_id for update skip locked;
    if not found then
      continue;
    end if;

    if v_order.status not in ('accepted', 'preparing') or v_order.rider_id is not null then
      continue;
    end if;

    select location into v_vendor_location from vendors where id = v_order.vendor_id;
    if v_vendor_location is null then
      continue;
    end if;

    begin
      -- No distance cap as of 0066 - see this migration's own header.
      insert into dispatch_offers (order_id, rider_id)
      select v_order.id, r.user_id
      from riders r
      where r.is_online
        and r.kyc_status = 'approved'
        and r.current_location is not null
      order by st_distance(r.current_location, v_vendor_location) asc
      limit 10
      on conflict (order_id, rider_id) do nothing;

      get diagnostics v_inserted = row_count;
      v_created_count := v_created_count + v_inserted;
    exception when others then
      raise warning 'dispatch_orders_nearing_prep_completion: failed to create dispatch offers for order % - %', v_order.id, sqlerrm;
    end;
  end loop;

  return query select v_created_count;
end;
$$;

comment on function dispatch_orders_nearing_prep_completion() is
  'Early-dispatch sweep (0064): offers an order to the nearest 10 eligible riders once the vendor''s own estimated prep time (avg_prep_mins) is within c_lead_minutes (8) of being done, rather than waiting for ready_for_pickup. No distance cap as of 0066 (was a 5km st_dwithin filter) - same is_online/kyc_status/current_location filters otherwise. service_role only. NOT scheduled by this migration - see 0064_early_dispatch_before_ready.sql''s own header for the pg_cron attempt and the operational requirement if that attempt does not succeed on this server.';

revoke execute on function dispatch_orders_nearing_prep_completion() from public, authenticated;
grant execute on function dispatch_orders_nearing_prep_completion() to service_role;

revoke execute on function sweep_dispatch_offers() from public, authenticated;
grant execute on function sweep_dispatch_offers() to service_role;
