-- KiaKia - predictive dispatch timing (design D7, D8, D11), part A: timing.
--
-- 1. D7 travel time. _estimate_travel_seconds keeps its signature and formula
--    (metres x road factor / speed + 60 s) but the speed now comes from a per-
--    service-area cache, dispatch_area_stats, instead of always being the default.
--    The cache holds the median observed speed (pickup distance / (arrived at
--    vendor - assigned), last 30 days, clamped 8-40 km/h) once at least
--    dispatch_min_history_samples observations exist. The estimate only READS the
--    cache (one primary-key lookup); it never aggregates, so the per-candidate call
--    stays cheap. The tick refreshes a row at most every 10 minutes.
--    Observed speed is "straight-line metres per total second", so applying the
--    road factor and overhead on top makes the estimate slightly conservative.
-- 2. D8 start time. start_at = expected_ready_at - travel - secure_buffer, never
--    before accepted_at. travel = median ETA of the top 3 currently eligible
--    candidates (the engine's own ring/radius rules), else the default travel
--    time. secure_buffer = (1/acceptance_rate - 1) x mean failed-offer seconds +
--    mean accept seconds over the last 14 days (>= min samples), else the setting;
--    clamped to [45, 900] s. The basis is stored in order_dispatch.start_basis.
--    While 'scheduled' the tick recomputes at most every 60 s and logs
--    start_recomputed only when start_at moves by more than 30 s.
-- 3. vendor_update_prep_estimate(order, minutes): the vendor revises the ready time.
-- 4. Ready early / prep overrun notifications and events.
-- 5. update_rider_location: extra work only for a rider holding a pre-pickup order
--    (ETA refresh every 30 s, eta_increased, vendor arrival stamp).

-- ---------------------------------------------------------------------------
-- Cache table + supporting indexes
-- ---------------------------------------------------------------------------

create table dispatch_area_stats (
  service_area_id uuid primary key references service_areas (id) on delete cascade,
  speed_kmh       numeric(5, 2) not null,
  speed_source    text not null check (speed_source in ('history', 'default')),
  speed_samples   integer not null default 0,
  secure_buffer_s integer not null,
  buffer_source   text not null check (buffer_source in ('history', 'default')),
  buffer_samples  integer not null default 0,
  refreshed_at    timestamptz not null default now()
);
alter table dispatch_area_stats enable row level security;
revoke all on dispatch_area_stats from anon, authenticated, service_role;
grant select on dispatch_area_stats to service_role;

create index order_dispatch_arrived_idx on order_dispatch (rider_arrived_vendor_at) where rider_arrived_vendor_at is not null;
create index dispatch_offers_offered_at_idx on dispatch_offers (offered_at);
-- update_rider_location: "does this rider hold a pre-pickup order" in one index probe.
create index orders_rider_prepickup_idx on orders (rider_id)
  where status in ('accepted', 'preparing', 'ready_for_pickup', 'rider_assigned');

-- ---------------------------------------------------------------------------
-- Cache refresh (tick only; staleness check first, one aggregate per area)
-- ---------------------------------------------------------------------------

create function _dispatch_area_stats_refresh(p_area uuid, p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min    integer := _platform_setting_int('dispatch_min_history_samples')::integer;
  v_sn     integer;
  v_med    numeric;
  v_speed  numeric;
  v_ssrc   text;
  v_bn     integer;
  v_ba     integer;
  v_fail   numeric;
  v_acc    numeric;
  v_buf    numeric;
  v_bsrc   text;
begin
  if p_area is null then
    return;
  end if;
  if not p_force and exists (select 1 from dispatch_area_stats where service_area_id = p_area
                             and refreshed_at > now() - interval '10 minutes') then
    return;
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('dispatch_area_stats:' || p_area::text, 0)) then
    return;   -- another session is refreshing this area
  end if;

  select count(*), percentile_cont(0.5) within group (order by s.v) into v_sn, v_med
  from (
    select coalesce(o.rider_pickup_distance_m, ao.distance_m)::numeric
           / extract(epoch from (od.rider_arrived_vendor_at - od.assigned_at)) * 3.6 as v
    from order_dispatch od
    join orders o on o.id = od.order_id
    left join lateral (select d.distance_m from dispatch_offers d
                       where d.order_id = o.id and d.status = 'accepted' order by d.attempt_no desc limit 1) ao on true
    where o.service_area_id = p_area
      and od.rider_arrived_vendor_at >= now() - interval '30 days'
      and od.assigned_at is not null
      and od.rider_arrived_vendor_at > od.assigned_at
      and coalesce(o.rider_pickup_distance_m, ao.distance_m) > 0
  ) s;
  if v_sn >= v_min then
    v_speed := least(40, greatest(8, round(v_med, 2)));
    v_ssrc := 'history';
  else
    v_speed := _platform_setting_int('dispatch_default_speed_kmh');
    v_ssrc := 'default';
  end if;

  select count(*), count(*) filter (where d.status = 'accepted'),
         avg(extract(epoch from (d.responded_at - d.offered_at))) filter (where d.status <> 'accepted'),
         avg(extract(epoch from (d.responded_at - d.offered_at))) filter (where d.status = 'accepted')
    into v_bn, v_ba, v_fail, v_acc
  from dispatch_offers d
  join orders o on o.id = d.order_id
  where o.service_area_id = p_area
    and d.offered_at >= now() - interval '14 days'
    and d.status in ('accepted', 'declined', 'expired')
    and d.responded_at is not null;
  if v_bn >= v_min then
    -- acceptance rate = accepted / answered; no accept at all means the worst case.
    v_buf := case when v_ba = 0 then 900
                  else (v_bn::numeric / v_ba - 1) * coalesce(v_fail, extract(epoch from _dispatch_offer_ttl())) + coalesce(v_acc, 0) end;
    v_buf := least(900, greatest(45, round(v_buf)));
    v_bsrc := 'history';
  else
    v_buf := _platform_setting_int('dispatch_secure_buffer_seconds');
    v_bsrc := 'default';
  end if;

  insert into dispatch_area_stats (service_area_id, speed_kmh, speed_source, speed_samples, secure_buffer_s, buffer_source, buffer_samples, refreshed_at)
  values (p_area, v_speed, v_ssrc, v_sn, v_buf::integer, v_bsrc, v_bn, now())
  on conflict (service_area_id) do update
    set speed_kmh = excluded.speed_kmh, speed_source = excluded.speed_source, speed_samples = excluded.speed_samples,
        secure_buffer_s = excluded.secure_buffer_s, buffer_source = excluded.buffer_source,
        buffer_samples = excluded.buffer_samples, refreshed_at = excluded.refreshed_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- D7: the ETA seam (same signature; reads the cache only)
-- ---------------------------------------------------------------------------

create or replace function _estimate_travel_seconds(p_from geography, p_to geography, p_service_area_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when p_from is null or p_to is null then null
    else (round(st_distance(p_from, p_to)
                * _platform_setting_int('dispatch_road_factor_pct') / 100.0
                / (coalesce((select s.speed_kmh from dispatch_area_stats s
                             where s.service_area_id = p_service_area_id and s.speed_source = 'history'),
                            _platform_setting_int('dispatch_default_speed_kmh')) * 1000.0 / 3600.0)) + 60)::integer
  end
$$;

-- ---------------------------------------------------------------------------
-- D8: start time with its basis
-- ---------------------------------------------------------------------------

create function _dispatch_start_calc(p_order orders, p_expected_ready_at timestamptz default null)
returns table (start_at timestamptz, basis jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_od       order_dispatch;
  v_accepted timestamptz := coalesce(p_order.accepted_at, p_order.created_at);
  v_ready    timestamptz;
  v_max      integer := _platform_setting_int('dispatch_h3_max_ring')::integer;
  v_ring     integer := least(_platform_setting_int('dispatch_h3_initial_ring')::integer, v_max);
  v_radius   integer := nullif(_platform_setting_int('dispatch_radius_m')::integer, 0);
  v_etas     integer[];
  v_travel   integer;
  v_tsrc     text;
  v_buf      integer;
  v_bsrc     text;
  v_st       dispatch_area_stats;
begin
  select * into v_od from order_dispatch where order_id = p_order.id;
  v_ready := coalesce(p_expected_ready_at, v_od.expected_ready_at,
                      v_accepted + make_interval(mins => (select avg_prep_mins from vendors where id = p_order.vendor_id)));

  -- The engine's own discovery: rings outwards from the first ring, then the KNN fallback.
  loop
    v_etas := array(select c.eta_seconds from _dispatch_candidates(p_order.id, v_ring, v_radius, coalesce(v_od.cycle_no, 0), 3) c);
    exit when cardinality(v_etas) > 0 or v_ring >= v_max;
    v_ring := v_ring + 1;
  end loop;
  if cardinality(v_etas) = 0 then
    v_etas := array(select c.eta_seconds from _dispatch_candidates(p_order.id, null, v_radius, coalesce(v_od.cycle_no, 0), 3) c);
  end if;
  if cardinality(v_etas) > 0 then
    select round(percentile_cont(0.5) within group (order by e))::integer into v_travel from unnest(v_etas) e;
    v_tsrc := 'candidates';
  else
    v_travel := _platform_setting_int('dispatch_default_travel_seconds')::integer;
    v_tsrc := 'default';
  end if;

  select * into v_st from dispatch_area_stats s where s.service_area_id = p_order.service_area_id and s.buffer_source = 'history';
  if found then
    v_buf := v_st.secure_buffer_s;
    v_bsrc := 'history';
  else
    v_buf := _platform_setting_int('dispatch_secure_buffer_seconds')::integer;
    v_bsrc := 'default';
  end if;
  v_buf := least(900, greatest(45, v_buf));

  return query select greatest(v_ready - make_interval(secs => v_travel + v_buf), v_accepted),
    jsonb_build_object('travel_s', v_travel, 'travel_source', v_tsrc, 'buffer_s', v_buf, 'buffer_source', v_bsrc,
                       'candidates_used', cardinality(v_etas), 'expected_ready_at', v_ready, 'computed_at', now());
end;
$$;

create or replace function _dispatch_start_at(p_order orders, p_expected_ready_at timestamptz default null)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select c.start_at from _dispatch_start_calc(p_order, p_expected_ready_at) c
$$;

-- Recompute start_at/start_basis of a scheduled order. Throttled to once a minute unless forced;
-- start_recomputed is logged only when start_at moves by more than 30 s.
create function _dispatch_recompute_start(p_order_id uuid, p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders;
  od order_dispatch;
  s record;
begin
  select * into o from orders where id = p_order_id;
  select * into od from order_dispatch where order_id = p_order_id for update;
  if not found or od.state <> 'scheduled' or o.rider_id is not null or o.delivery_by <> 'rider'
     or o.status not in ('accepted', 'preparing') then
    return;
  end if;
  if not p_force and od.start_basis ? 'computed_at'
     and (od.start_basis ->> 'computed_at')::timestamptz > now() - interval '55 seconds' then
    return;
  end if;
  -- Once the start time has passed the tick dispatches; it never pushes a due start back (only the vendor can, forced).
  if not p_force and od.start_at <= now() then
    return;
  end if;
  select * into s from _dispatch_start_calc(o, od.expected_ready_at);
  update order_dispatch
  set start_at = s.start_at, start_basis = s.basis,
      next_check_at = least(s.start_at, now() + interval '60 seconds')
  where order_id = p_order_id;
  if od.start_at is null or abs(extract(epoch from (s.start_at - od.start_at))) > 30 then
    perform _dispatch_log(p_order_id, 'start_recomputed',
      jsonb_build_object('old', od.start_at, 'new', s.start_at, 'travel_s', s.basis -> 'travel_s',
                         'buffer_s', s.basis -> 'buffer_s', 'candidates_used', s.basis -> 'candidates_used'));
  end if;
end;
$$;

-- Tick hook: overrun slide (no rider message), then the throttled start_at recompute.
create function _dispatch_tick_timing(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders;
  od order_dispatch;
  v_new timestamptz;
begin
  select * into o from orders where id = p_order_id;
  select * into od from order_dispatch where order_id = p_order_id;
  if not found or o.rider_id is not null or o.delivery_by <> 'rider' or o.status not in ('accepted', 'preparing')
     or od.state not in ('scheduled', 'searching', 'offered', 'needs_attention') then
    return;
  end if;
  if od.expected_ready_at is not null and now() > od.expected_ready_at + interval '5 minutes' then
    v_new := now() + interval '5 minutes';
    update order_dispatch set expected_ready_at = v_new where order_id = p_order_id;
    perform _dispatch_log(p_order_id, 'prep_overrun', jsonb_build_object('old', od.expected_ready_at, 'new', v_new));
    perform _dispatch_recompute_start(p_order_id, true);
  else
    perform _dispatch_recompute_start(p_order_id, false);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rider messages (row + transactional push), ready early
-- ---------------------------------------------------------------------------

create function _dispatch_notify_rider(p_order uuid, p_rider uuid, p_title text, p_body text, p_type text, p_dedupe text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into rider_notifications (rider_id, order_id, title, body) values (p_rider, p_order, p_title, p_body);
  begin
    insert into message_outbox (kind, channel, category, recipient_user_id, subject, body, data, expires_at, dedupe_key)
    values ('system', 'push', 'transactional', p_rider, p_title, p_body,
            jsonb_build_object('type', p_type, 'orderId', p_order), now() + interval '1 hour', p_dedupe)
    on conflict (dedupe_key) do nothing;
    perform invoke_message_worker();
  exception when others then
    raise warning '_dispatch_notify_rider: order % - %', p_order, sqlerrm;
    perform _dispatch_log(p_order, 'push_failed', jsonb_build_object('stage', 'enqueue', 'sqlstate', sqlstate), null, p_rider);
  end;
end;
$$;

create function _dispatch_ready_early(p_order orders)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp timestamptz;
begin
  select expected_ready_at into v_exp from order_dispatch where order_id = p_order.id;
  if v_exp is null or v_exp - now() < interval '2 minutes' then
    return;
  end if;
  begin
    perform _dispatch_notify_rider(p_order.id, p_order.rider_id, 'Food is ready now',
      format('Order %s: the food is ready for pickup.', p_order.code), 'order_ready', 'order:' || p_order.id::text || ':ready');
    perform _dispatch_log(p_order.id, 'ready_early',
      jsonb_build_object('expected_ready_at', v_exp, 'early_seconds', round(extract(epoch from (v_exp - now())))), null, p_order.rider_id);
  exception when others then
    raise warning '_dispatch_ready_early: order % - %', p_order.id, sqlerrm;   -- never block ready_for_pickup
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vendor: revise the ready time
-- ---------------------------------------------------------------------------

create function vendor_update_prep_estimate(p_order_id uuid, p_ready_in_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders;
  od order_dispatch;
  v_old timestamptz;
  v_new timestamptz;
  v_n integer;
  v_notified boolean := false;
begin
  if p_ready_in_minutes is null or p_ready_in_minutes < 1 or p_ready_in_minutes > 180 then
    raise exception 'vendor_update_prep_estimate: ready_in_minutes must be between 1 and 180' using errcode = 'check_violation';
  end if;
  o := _vendor_order_guard('vendor_update_prep_estimate', p_order_id, true);
  if o.delivery_by <> 'rider' then
    raise exception 'vendor_update_prep_estimate: only rider deliveries have a ready time to share' using errcode = 'check_violation';
  end if;
  if o.status not in ('accepted', 'preparing') then
    raise exception 'vendor_update_prep_estimate: the order is not being prepared' using errcode = 'check_violation';
  end if;
  select count(*)::integer into v_n from dispatch_events where order_id = o.id and event = 'prep_estimate_changed';
  if v_n >= 10 then
    raise exception 'vendor_update_prep_estimate: too many changes for this order' using errcode = 'P0429';
  end if;

  select * into od from order_dispatch where order_id = o.id for update;
  if not found then
    insert into order_dispatch (order_id, state) values (o.id, case when o.rider_id is null then 'scheduled' else 'assigned' end)
    returning * into od;
  end if;
  v_old := coalesce(od.expected_ready_at,
                    coalesce(o.accepted_at, o.created_at) + make_interval(mins => (select avg_prep_mins from vendors where id = o.vendor_id)));
  v_new := now() + make_interval(mins => p_ready_in_minutes);
  update order_dispatch set expected_ready_at = v_new where order_id = o.id;
  perform _dispatch_log(o.id, 'prep_estimate_changed',
    jsonb_build_object('old', v_old, 'new', v_new, 'ready_in_minutes', p_ready_in_minutes), null, o.rider_id);
  perform _dispatch_recompute_start(o.id, true);   -- no-op unless still 'scheduled'

  if o.rider_id is not null and abs(extract(epoch from (v_new - v_old))) >= 180 then
    perform _dispatch_notify_rider(o.id, o.rider_id,
      case when v_new > v_old then 'Food will be ready later' else 'Food will be ready sooner' end,
      format('Order %s: food should be ready at about %s.', o.code, to_char(v_new at time zone 'Africa/Lagos', 'HH24:MI')),
      'order_prep_update', 'order:' || o.id::text || ':prep:' || (v_n + 1)::text);
    v_notified := true;
  end if;

  select * into od from order_dispatch where order_id = o.id;
  return jsonb_build_object('order_id', o.id, 'expected_ready_at', od.expected_ready_at, 'start_at', od.start_at,
                            'rider_notified', v_notified);
end;
$$;

-- ---------------------------------------------------------------------------
-- Rider ping: ETA refresh, eta_increased, arrival stamp
-- ---------------------------------------------------------------------------

create function _dispatch_rider_ping(p_rider uuid, p_lat double precision, p_lng double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_loc  geography;
  v_new  timestamptz;
  v_when timestamptz;
  v_step integer;
  v_last integer;
begin
  select o.id as order_id, o.ready_at, o.service_area_id, v.location as vloc, od.assigned_eta_at, od.expected_ready_at,
         od.rider_arrived_vendor_at, od.eta_updated_at
    into r
  from orders o
  join order_dispatch od on od.order_id = o.id
  join vendors v on v.id = o.vendor_id
  where o.rider_id = p_rider and o.status in ('accepted', 'preparing', 'ready_for_pickup', 'rider_assigned')
  limit 1;
  if not found then
    return;
  end if;

  begin   -- a failure here must never fail the location ping itself
    v_loc := st_setsrid(st_point(p_lng, p_lat), 4326)::geography;

    if r.rider_arrived_vendor_at is null and r.vloc is not null
       and st_distance(v_loc, r.vloc) <= _platform_setting_int('dispatch_vendor_arrival_radius_m') then
      update order_dispatch set rider_arrived_vendor_at = now() where order_id = r.order_id and rider_arrived_vendor_at is null;
      if found then
        perform _dispatch_log(r.order_id, 'rider_at_vendor',
          jsonb_build_object('wait_seconds', case when r.ready_at is not null then round(extract(epoch from (now() - r.ready_at))) end),
          null, p_rider);
      end if;
    end if;

    if r.eta_updated_at is null or r.eta_updated_at <= now() - interval '30 seconds' then
      v_new := now() + make_interval(secs => coalesce(_estimate_travel_seconds(v_loc, r.vloc, r.service_area_id), 0));
      update order_dispatch set current_eta_at = v_new, eta_updated_at = now() where order_id = r.order_id;
      v_when := coalesce(r.ready_at, r.expected_ready_at);
      if r.assigned_eta_at is not null and v_when is not null
         and v_new > r.assigned_eta_at + interval '5 minutes' and v_new > v_when then
        v_step := floor(extract(epoch from (v_new - r.assigned_eta_at)) / 300)::integer;
        select coalesce(max((e.data ->> 'step')::integer), 0) into v_last
        from dispatch_events e where e.order_id = r.order_id and e.event = 'eta_increased';
        if v_step > v_last then
          perform _dispatch_log(r.order_id, 'eta_increased',
            jsonb_build_object('step', v_step, 'assigned_eta_at', r.assigned_eta_at, 'current_eta_at', v_new,
                               'increase_seconds', round(extract(epoch from (v_new - r.assigned_eta_at))), 'ready_at', v_when),
            null, p_rider);
        end if;
      end if;
    end if;
  exception when others then
    raise warning '_dispatch_rider_ping: rider % - %', p_rider, sqlerrm;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hooks into existing functions
-- ---------------------------------------------------------------------------

-- Vendor accept: store the basis with the first start_at; recompute within a minute.
create or replace function _dispatch_sync_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ready timestamptz;
  s record;
begin
  if new.status = 'accepted' then
    if new.delivery_by = 'rider' then
      select coalesce(new.accepted_at, now()) + make_interval(mins => v.avg_prep_mins) into v_ready
      from vendors v where v.id = new.vendor_id;
      select * into s from _dispatch_start_calc(new, v_ready);
      insert into order_dispatch (order_id, state, expected_ready_at, start_at, start_basis, next_check_at)
      values (new.id, case when new.rider_id is null then 'scheduled' else 'assigned' end, v_ready, s.start_at, s.basis,
              case when new.rider_id is null then least(s.start_at, now() + interval '60 seconds') end)
      on conflict (order_id) do update
        set state = excluded.state, expected_ready_at = excluded.expected_ready_at, start_at = excluded.start_at,
            start_basis = excluded.start_basis, next_check_at = excluded.next_check_at;
      perform _dispatch_log(new.id, 'scheduled', jsonb_build_object('expected_ready_at', v_ready, 'start_at', s.start_at));
    end if;
  else
    perform _dispatch_close_live_offer(new.id, 'cancelled',
      case when new.status in ('delivered', 'failed_delivery') then 'order_closed' else 'order_cancelled' end);
    update order_dispatch set state = 'stopped', next_check_at = null
    where order_id = new.id and state <> 'stopped';
  end if;
  return new;
end;
$$;

-- In-place patches of live bodies (single-line anchors, each asserted to match once).
do $$
declare
  v_def text;
  v_new text;
  v_hook record;
begin
  for v_hook in
    select * from (values
      ('_dispatch_tick_order(uuid, text, timestamptz)',
       '    v_res := _dispatch_advance(p_order_id, p_trigger);',
       E'    begin\n      perform _dispatch_area_stats_refresh(v_order.service_area_id);\n      perform _dispatch_tick_timing(p_order_id);\n'
       '    exception when others then\n      raise warning ''_dispatch_tick_order: timing for order % - %'', p_order_id, sqlerrm;\n    end;\n'
       '    v_res := _dispatch_advance(p_order_id, p_trigger);\n'
       '    -- a scheduled order is looked at least once a minute so start_at follows rider availability\n'
       '    update order_dispatch set next_check_at = now() + interval ''60 seconds''\n'
       '    where order_id = p_order_id and state = ''scheduled'' and next_check_at > now() + interval ''60 seconds'';'),
      ('dispatch_order_to_nearby_riders()',
       E'  if new.rider_id is not null then',
       E'  if new.rider_id is not null then\n    perform _dispatch_ready_early(new);   -- 0104: tell the rider the food is ready early'),
      ('update_rider_location(double precision, double precision)',
       E'    updated_at = excluded.updated_at;',
       E'    updated_at = excluded.updated_at;\n\n  -- 0104: ETA / arrival bookkeeping, only does work for a rider holding a pre-pickup order\n'
       '  perform _dispatch_rider_ping(auth.uid(), p_lat, p_lng);')
    ) t(sig, anchor, replacement)
  loop
    v_def := replace(pg_get_functiondef(v_hook.sig::regprocedure), E'\r', '');
    if (length(v_def) - length(replace(v_def, v_hook.anchor, ''))) <> length(v_hook.anchor) then
      raise exception '0104: anchor for % does not match exactly once', v_hook.sig;
    end if;
    v_new := replace(v_def, v_hook.anchor, v_hook.replacement);
    execute v_new;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function _dispatch_area_stats_refresh(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function _dispatch_start_calc(orders, timestamptz) from public, anon, authenticated, service_role;
revoke all on function _dispatch_recompute_start(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function _dispatch_tick_timing(uuid) from public, anon, authenticated, service_role;
revoke all on function _dispatch_notify_rider(uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function _dispatch_ready_early(orders) from public, anon, authenticated, service_role;
revoke all on function _dispatch_rider_ping(uuid, double precision, double precision) from public, anon, authenticated, service_role;
revoke all on function vendor_update_prep_estimate(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function vendor_update_prep_estimate(uuid, integer) to authenticated;
