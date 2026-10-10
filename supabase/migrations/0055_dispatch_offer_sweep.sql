-- KiaKia - re-dispatch sweep.
--
-- 0028_dispatch_offer_lifecycle.sql's own "SCOPE NOTE" explicitly deferred
-- this: when every offer on an order expires or is declined, the order
-- sits at ready_for_pickup with no rider forever - nothing re-offers it to
-- the next-nearest riders. Past the very first 60-second offer round
-- (dispatch_offers.expires_at, 0028), the product simply stops working for
-- that order: no rider app ever sees it again, and no existing RPC/trigger
-- fixes that. This migration builds the sweep 0028 deferred.
--
-- NOT SCHEDULED BY THIS MIGRATION - sweep_dispatch_offers() (below) is a
-- plain SECURITY DEFINER function; nothing in this file calls
-- cron.schedule() or enables the pg_cron extension. Running it on a
-- schedule requires EITHER pg_cron (not installed by this or any prior
-- migration - 0001_extensions.sql only installs pgcrypto/postgis) OR an
-- external scheduler (a small Vercel Cron job / GitHub Actions workflow /
-- systemd timer) calling it over PostgREST's /rpc endpoint with the
-- service-role key, roughly every 15-30 seconds - offers have a 60-second
-- TTL (0028), so a sweep interval much longer than that leaves an order
-- sitting unnecessarily long between the moment its last offer round
-- expires and the moment it gets re-offered.
--
-- IF USING pg_cron - the exact statement an operator should run, given
-- here so nobody has to guess (left commented out; this migration does not
-- run it):
--
--   select cron.schedule(
--     'sweep-dispatch-offers',
--     '15 seconds',
--     $$ set role service_role; select sweep_dispatch_offers(); reset role; $$
--   );
--
-- Two things about that statement that are easy to get wrong: (1) pg_cron's
-- 'N seconds' scheduling syntax (as opposed to a 5-field cron expression,
-- which cannot express sub-minute intervals at all) requires pg_cron >=
-- 1.4 and N must evenly divide 60 (5/10/15/20/30/60) - Supabase's managed
-- pg_cron supports this, but a self-hosted older pg_cron may not. (2)
-- sweep_dispatch_offers() (below) checks the CALLER'S ACTUAL POSTGRES ROLE
-- for 'service_role' (current_setting('role', true), same idiom
-- approve_rider()/refund_order_escrow() already use, not a JWT claim - see
-- 0018/0027's own headers for why), and a pg_cron job otherwise runs as
-- whichever role scheduled it (typically the 'postgres' superuser, on both
-- self-hosted and Supabase-managed pg_cron) - NOT 'service_role'. Without
-- the explicit `set role service_role` / `reset role` wrapping shown above,
-- the scheduled call would fail every single run with "requires the
-- service-role key". The external-scheduler-over-PostgREST alternative
-- avoids this subtlety entirely (the service-role JWT already sets the
-- role correctly per-request) and is probably the simpler operational
-- choice for a project with no other pg_cron job today.

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

  -- 1. Expire every offer whose TTL has passed. accept_dispatch_offer()
  -- (0028/0044) already does this lazily for the one row a rider actually
  -- tries to act on after its expiry, but nothing proactively expires a row
  -- nobody ever touches again - this step is what makes "no live offered
  -- row" in step 2 below actually true, instead of stuck on a phantom
  -- 'offered' row that has silently passed its expires_at.
  with expired as (
    update dispatch_offers
    set status = 'expired', responded_at = now()
    where status = 'offered' and expires_at <= now()
    returning 1
  )
  select count(*)::integer into v_expired_count from expired;

  -- 2. Re-offer every order stuck at ready_for_pickup with no assigned
  -- rider and no live 'offered' row, one order at a time, each under its
  -- own row lock - so this never races a concurrent
  -- accept_dispatch_offer() (a rider accepting a last-second offer) or an
  -- admin cancellation that changes the order out from under this sweep
  -- mid-run.
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
      -- Locked by a concurrent transaction (e.g. a rider accepting a
      -- last-second offer on this exact order, or an admin cancelling it) -
      -- leave it for the next sweep run rather than blocking on it.
      continue;
    end if;

    -- Re-verify under the lock: the cursor above is a snapshot taken before
    -- this specific order's lock was acquired, and could be stale by now.
    if v_order.status <> 'ready_for_pickup' or v_order.rider_id is not null then
      continue;
    end if;

    select location into v_vendor_location from vendors where id = v_order.vendor_id;
    if v_vendor_location is null then
      -- Same silent-skip posture dispatch_order_to_nearby_riders() (0019/
      -- 0023) already takes for a location-less vendor - nothing useful can
      -- be computed, and this must never abort the sweep for other orders.
      continue;
    end if;

    begin
      insert into dispatch_offers (order_id, rider_id)
      select v_order.id, r.user_id
      from riders r
      where r.is_online
        and r.kyc_status = 'approved'
        and r.current_location is not null
        -- STALENESS GUARD - deliberately stricter than
        -- dispatch_order_to_nearby_riders() (0019/0023), which trusts
        -- is_online alone on an order's FIRST dispatch attempt (reasonable
        -- there: the order was JUST marked ready_for_pickup, so any online
        -- rider's last known position is necessarily recent). By the time
        -- an order reaches this sweep, at least one full 60-second offer
        -- round (0028) has already played out with no acceptance at all -
        -- long enough that a rider whose app crashed or lost connectivity
        -- without ever calling set_rider_online(false) could still show
        -- is_online = true indefinitely, forever "eligible" for a sweep
        -- that will keep failing to reach them. 5 minutes is generous next
        -- to update_rider_location()'s "typically every few seconds while
        -- online" ping cadence (0026_rider_self_service.sql's own comment),
        -- so it comfortably tolerates a normal network hiccup while still
        -- excluding a rider who has genuinely gone dark. Not added to
        -- dispatch_order_to_nearby_riders() itself - that migration is
        -- already shipped and is not touched here, and the reasoning above
        -- is specific to a rider who has had five-plus minutes to respond
        -- and hasn't, which does not describe a fresh ready_for_pickup
        -- event at all.
        and r.last_ping_at is not null
        and r.last_ping_at >= now() - interval '5 minutes'
        and st_dwithin(r.current_location, v_vendor_location, 5000) -- 5km radius, same as 0019/0023
        -- Never re-offer a rider who already has ANY row for this order -
        -- accepted/declined/expired included, not just a currently-'offered'
        -- one. This is what stops a rider who explicitly declined from
        -- being offered the exact same order again, and it is what
        -- guarantees this insert can never hit dispatch_offers' own
        -- unique (order_id, rider_id) constraint (the on conflict clause
        -- below is retained anyway as defense in depth against two
        -- overlapping sweep runs, not because this exclusion is expected to
        -- ever miss).
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
      -- Same posture as dispatch_order_to_nearby_riders() (0023): a failure
      -- offering ONE order must never abort the sweep for every other order
      -- still waiting on it.
      raise warning 'sweep_dispatch_offers: failed to create dispatch offers for order % - %', v_order.id, sqlerrm;
    end;
  end loop;

  return query select v_expired_count, v_created_count;
end;
$$;

comment on function sweep_dispatch_offers() is
  'Re-dispatch sweep, deferred by 0028_dispatch_offer_lifecycle.sql''s own scope note: expires every stale ''offered'' dispatch_offers row, then re-offers every order still ready_for_pickup with no assigned rider and no live offer to the next-nearest eligible riders, applying the same is_online/kyc_status/current_location/5km-radius/nearest-10 filters dispatch_order_to_nearby_riders() (0019/0023) applies, PLUS a 5-minute last_ping_at staleness filter (deliberately stricter than the initial dispatch - see the inline comment) and an exclusion of any rider who already has any dispatch_offers row on that order (never re-offers a decliner, never hits the unique(order_id, rider_id) constraint). service_role only. NOT scheduled by this migration - requires pg_cron or an external scheduler calling it with the service-role key roughly every 15-30 seconds; see this file''s header for the exact (commented-out) cron.schedule() statement and why a plain pg_cron job needs an explicit SET ROLE.';

revoke execute on function sweep_dispatch_offers() from public, authenticated;
grant execute on function sweep_dispatch_offers() to service_role;
