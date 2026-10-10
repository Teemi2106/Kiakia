-- KiaKia - close the gap 0066 left open: once every currently-eligible
-- rider has a dispatch_offers row on an order (the unbounded-radius nearest-
-- 10 pool from 0066 fully exhausted), sweep_dispatch_offers() (0055) simply
-- stopped inserting anything - not because anyone decided to give up, but
-- because "not exists ANY row for this rider on this order" permanently
-- excludes every rider once they've been through one round. With a small
-- rider fleet (this project has exactly one online rider as of this
-- session), that exhausts after a SINGLE round: the order goes quiet after
-- ~2 minutes, forever, with no cancellation and no further attempt - it
-- just silently stops being offered to anyone. That silent stop is "that
-- stuff that removes the order" - nothing ever explicitly cancels it, it
-- just drops out of active dispatch. Product decision: an order must keep
-- being actively retried, not go quiet, and must only be genuinely given up
-- on (cancelled, with the existing auto-refund unwind, 0041) once BOTH (a)
-- every eligible rider has already been asked at least once in the current
-- attempt and nobody took it, AND (b) at least 30 minutes have passed since
-- the order first entered dispatch.
--
-- Two schema columns, both on orders, both nullable, both system-managed
-- (never user-writable - same posture as placed_at/accepted_at/etc.):
--
--   first_dispatched_at    - stamped once, the moment dispatch_order_to_
--                            nearby_riders() (0019/0023/0064) first tries to
--                            offer this order to anyone. Never reset. This
--                            is what "for at least 30 minutes" counts from.
--
--   dispatch_cycle_started_at - reset to now() every time a fresh notify-
--                            everyone cycle begins. sweep_dispatch_offers()
--                            below only excludes a rider from re-offer for
--                            rows offered SINCE this timestamp (current
--                            cycle), not forever - so once the whole
--                            eligible pool has been asked and the 30-minute
--                            floor hasn't been reached yet, the cycle resets
--                            and the SAME riders (minus anyone who
--                            explicitly declined - that exclusion stays
--                            permanent) get asked again, closest first, same
--                            as the very first round. "The order should
--                            still be there" - kept actively cycling,
--                            not going dark.
--
-- Nothing changes about how a single round looks or behaves: still nearest-
-- 10, still a 2-minute TTL (0066), still no distance cap (0066). What
-- changes is what happens when a round finds nobody left to ask.

alter table orders add column first_dispatched_at timestamptz;
alter table orders add column dispatch_cycle_started_at timestamptz;

comment on column orders.first_dispatched_at is
  'Stamped once, the first time this order is ever dispatched to any rider (dispatch_order_to_nearby_riders(), 0019/0023/0064/0067). Never reset. The anchor for the 30-minute give-up SLA in sweep_dispatch_offers() (0067) - an order is only auto-cancelled once now() - first_dispatched_at >= 30 minutes AND the current cycle has already offered every eligible rider with no accept.';

comment on column orders.dispatch_cycle_started_at is
  'Reset to now() whenever a fresh "offer everyone eligible" cycle begins - by dispatch_order_to_nearby_riders() when the order first reaches ready_for_pickup, and by sweep_dispatch_offers() (0067) whenever a cycle is exhausted with no accept and the 30-minute floor has not yet been reached. sweep_dispatch_offers() only treats a rider as "already tried" (excluded from re-offer) for dispatch_offers rows offered at or after this timestamp - an explicit decline is excluded permanently regardless of this column, everything else (expired, unresponded) is only excluded for the current cycle.';

-- ---------------------------------------------------------------------------
-- dispatch_order_to_nearby_riders() - stamps first_dispatched_at (once) and
-- starts a fresh cycle every time the order reaches ready_for_pickup. The
-- 0064 early-accept cascade branch and every filter are reproduced
-- unchanged from 0066 except for this one addition.
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

  -- NEW (0067): the order is genuinely entering active dispatch right now -
  -- start (or continue) the 30-minute SLA clock and open a fresh cycle,
  -- regardless of whether the insert below actually finds any rider to
  -- offer. An order with zero eligible riders online still needs its clock
  -- running, or it would never become eligible for auto-cancellation later.
  update orders
  set first_dispatched_at = coalesce(first_dispatched_at, now()),
      dispatch_cycle_started_at = now()
  where id = new.id;

  begin
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
  'AFTER UPDATE OF status trigger on orders: when an order becomes ready_for_pickup, either cascades straight to rider_assigned if a rider already pre-committed via an early accept (0064), or stamps first_dispatched_at/dispatch_cycle_started_at (0067) and offers it to the 10 nearest online, KYC-approved riders with a known location - no distance cap (0066). If nobody accepts within the 2-minute offer TTL, sweep_dispatch_offers() (0055/0066/0067) keeps cycling through the eligible pool, closest first, until either a rider accepts or 30 minutes have passed with the whole pool exhausted, at which point the order is auto-cancelled. SECURITY DEFINER because riders/dispatch_offers/orders writes must bypass RLS.';

-- The trigger itself (created in 0019) is unchanged.

-- ---------------------------------------------------------------------------
-- sweep_dispatch_offers() (0055/0066) - cycle-scoped exclusion instead of
-- permanent, plus the 30-minute give-up. Every other filter (is_online,
-- kyc_status, current_location, the 5-minute last_ping_at staleness guard,
-- the 0066 no-distance-cap) is reproduced unchanged.
-- ---------------------------------------------------------------------------

-- Postgres refuses `create or replace` when a `returns table(...)` function's
-- OUT columns change shape (adding orders_cancelled here) - "cannot change
-- return type of existing function" (SQLSTATE 42P13). Drop first, same as
-- any other OUT-signature change would require.
drop function if exists sweep_dispatch_offers();

create function sweep_dispatch_offers()
returns table (
  offers_expired    integer,
  offers_created     integer,
  orders_cancelled  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role       text := coalesce(auth.role(), current_setting('role', true));
  v_expired_count     integer := 0;
  v_created_count     integer := 0;
  v_cancelled_count   integer := 0;
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

    -- Every order this sweep ever touches gets a real SLA anchor, even one
    -- left over from before 0067 that dispatch_order_to_nearby_riders()
    -- never stamped (e.g. an order that reached ready_for_pickup on an
    -- older migration and has sat undispatched since - exactly the
    -- "Kunfat" order found stuck for hours this session, now out-of-range
    -- under the pre-0066 5km cap).
    if v_order.first_dispatched_at is null then
      update orders set first_dispatched_at = now() where id = v_order.id;
      v_order.first_dispatched_at := now();
    end if;

    select location into v_vendor_location from vendors where id = v_order.vendor_id;
    if v_vendor_location is null then
      continue;
    end if;

    -- Up to two attempts per sweep tick for this order: attempt 1 offers
    -- whoever is left untried in the CURRENT cycle; if that finds nobody
    -- and the cycle is genuinely exhausted (below), attempt 2 resets the
    -- cycle and retries the SAME insert immediately, rather than waiting
    -- for the next ~15-second tick to do it. One insert statement, reused
    -- both times, so the two attempts can never drift apart from each
    -- other - only dispatch_cycle_started_at changes between them.
    for v_attempt in 1..2 loop
      begin
        -- Permanently excludes an explicit decline; otherwise only
        -- excludes "already tried this cycle" - rows offered at or after
        -- dispatch_cycle_started_at. See this migration's own header.
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
            where d2.order_id = v_order.id and d2.rider_id = r.user_id and d2.status = 'declined'
          )
          and not exists (
            select 1 from dispatch_offers d3
            where d3.order_id = v_order.id and d3.rider_id = r.user_id
              and d3.offered_at >= coalesce(v_order.dispatch_cycle_started_at, v_order.first_dispatched_at)
          )
        order by st_distance(r.current_location, v_vendor_location) asc
        limit 10
        on conflict (order_id, rider_id) do nothing;

        get diagnostics v_inserted = row_count;
        v_created_count := v_created_count + v_inserted;
      exception when others then
        raise warning 'sweep_dispatch_offers: failed to create dispatch offers for order % - %', v_order.id, sqlerrm;
        exit; -- this order is done for this tick either way
      end;

      exit when v_inserted > 0; -- offered someone - done for this tick

      -- Nothing new. If an earlier, still-live offer is already pending,
      -- there is nothing more to do this tick.
      exit when exists (
        select 1 from dispatch_offers where order_id = v_order.id and status = 'offered'
      );

      -- Cycle exhausted: every eligible rider has already been asked this
      -- cycle (or declined outright) and nobody is currently pending.
      -- Either give up for good, or start a fresh cycle and loop once more
      -- to retry it immediately.
      if now() >= v_order.first_dispatched_at + interval '30 minutes' then
        begin
          perform transition_order(
            v_order.id, 'cancelled_by_platform', 'system', null,
            jsonb_build_object('reason', 'dispatch_exhausted_after_30_minutes')
          );
          v_cancelled_count := v_cancelled_count + 1;
        exception when others then
          -- Never let a failed cancellation abort the sweep for every
          -- other order still waiting on it - same posture as every other
          -- exception handler in this function.
          raise warning 'sweep_dispatch_offers: failed to auto-cancel order % after 30 minutes with no rider - %', v_order.id, sqlerrm;
        end;
        exit;
      end if;

      update orders set dispatch_cycle_started_at = now() where id = v_order.id;
      v_order.dispatch_cycle_started_at := now();
      -- loop repeats once more (attempt 2) with the reset cycle window
    end loop;
  end loop;

  return query select v_expired_count, v_created_count, v_cancelled_count;
end;
$$;

comment on function sweep_dispatch_offers() is
  'Re-dispatch sweep (0055/0066/0067): expires every stale ''offered'' dispatch_offers row past its 2-minute TTL, then for every order still ready_for_pickup with no assigned rider and no live offer, re-offers the next-nearest eligible riders not yet tried in the CURRENT cycle (dispatch_offers rows offered since orders.dispatch_cycle_started_at) - no distance cap. An explicit decline excludes a rider permanently; a mere expiry only excludes them for the current cycle. Once every eligible rider has been tried this cycle with no accept: if 30+ minutes have passed since orders.first_dispatched_at, auto-cancels the order via transition_order(..., ''cancelled_by_platform'', ''system'', ...) (which auto-refunds any captured payment, 0041); otherwise starts a fresh cycle and immediately retries so the same eligible riders get asked again, closest first. Run every 15 seconds via cron (0055). service_role only.';

revoke execute on function sweep_dispatch_offers() from public, authenticated;
grant execute on function sweep_dispatch_offers() to service_role;
