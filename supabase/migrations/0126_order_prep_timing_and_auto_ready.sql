-- Persist one expected-ready timestamp for the customer, vendor, dispatch and rider.
-- The existing dispatch-tick worker handles elapsed prep deadlines; no new cron job.

alter table public.orders
  add column prep_minutes integer,
  add column expected_ready_at timestamptz;

alter table public.orders
  add constraint orders_prep_minutes_bounds
  check (prep_minutes is null or prep_minutes between 1 and 180);

-- Keep existing in-progress orders on the timestamp already used by dispatch.
update public.orders o
set prep_minutes = coalesce(o.prep_minutes, greatest(1, least(180, coalesce(v.avg_prep_mins, 30)))),
    expected_ready_at = coalesce(
      (select od.expected_ready_at from public.order_dispatch od where od.order_id = o.id),
      o.expected_ready_at,
      coalesce(o.accepted_at, o.created_at)
        + make_interval(mins => greatest(1, least(180, coalesce(v.avg_prep_mins, 30))))
    )
from public.vendors v
where o.vendor_id = v.id
  and o.status in ('accepted', 'preparing');

create or replace function public._orders_seed_prep_deadline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg integer;
  v_entered_accepted boolean;
begin
  if tg_op = 'INSERT' then
    v_entered_accepted := new.status = 'accepted';
  else
    v_entered_accepted := new.status = 'accepted' and old.status is distinct from 'accepted';
  end if;

  if v_entered_accepted then
    select avg_prep_mins into v_avg from vendors where id = new.vendor_id;
    new.prep_minutes := coalesce(new.prep_minutes, greatest(1, least(180, coalesce(v_avg, 30))));
    new.expected_ready_at := coalesce(
      new.expected_ready_at,
      coalesce(new.accepted_at, now()) + make_interval(mins => new.prep_minutes)
    );
  end if;

  return new;
end;
$$;

revoke all on function public._orders_seed_prep_deadline() from public, anon, authenticated, service_role;

create trigger orders_seed_prep_deadline
  before insert or update on public.orders
  for each row execute function public._orders_seed_prep_deadline();

-- Existing dispatch scheduling is still authoritative for rider timing. Mirror any
-- dispatch ETA adjustment back to orders so both client surfaces publish one value.
create or replace function public._dispatch_mirror_expected_ready_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.expected_ready_at is not null and tg_op = 'INSERT' then
    update orders
    set expected_ready_at = new.expected_ready_at
    where id = new.order_id
      and expected_ready_at is distinct from new.expected_ready_at;
  elsif new.expected_ready_at is not null and new.expected_ready_at is distinct from old.expected_ready_at then
    update orders
    set expected_ready_at = new.expected_ready_at
    where id = new.order_id
      and expected_ready_at is distinct from new.expected_ready_at;
  end if;
  return new;
end;
$$;

revoke all on function public._dispatch_mirror_expected_ready_at() from public, anon, authenticated, service_role;

create trigger order_dispatch_mirror_expected_ready_at
  after insert or update on public.order_dispatch
  for each row execute function public._dispatch_mirror_expected_ready_at();

-- Use the order's seeded duration/deadline when rider dispatch is first scheduled.
create or replace function public._dispatch_sync_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ready timestamptz;
  v_start timestamptz;
  v_basis jsonb;
  v_travel integer;
  v_buf integer;
  v_err text;
  v_state text;
begin
  if new.status = 'accepted' then
    if new.delivery_by = 'rider' then
      select coalesce(
        new.expected_ready_at,
        coalesce(new.accepted_at, now()) + make_interval(mins => coalesce(new.prep_minutes, v.avg_prep_mins))
      ) into v_ready
      from vendors v where v.id = new.vendor_id;
      -- Preserve 0109's best-effort start estimate: a dispatch calculation
      -- failure must never make the vendor's Accept action fail.
      begin
        select c.start_at, c.basis into v_start, v_basis from _dispatch_start_calc(new, v_ready) c;
      exception when others then
        v_state := sqlstate;
        v_err := left(sqlerrm, 200);
        begin
          v_travel := _platform_setting_int('dispatch_default_travel_seconds')::integer;
          v_buf := least(900, greatest(45, _platform_setting_int('dispatch_secure_buffer_seconds')::integer));
        exception when others then
          v_travel := 600;
          v_buf := 150;
        end;
        v_start := greatest(v_ready - make_interval(secs => v_travel + v_buf), coalesce(new.accepted_at, now()));
        v_basis := jsonb_build_object('travel_s', v_travel, 'travel_source', 'default', 'buffer_s', v_buf,
                                      'buffer_source', 'default', 'candidates_used', 0, 'fallback', true,
                                      'expected_ready_at', v_ready, 'computed_at', now());
        begin
          perform _dispatch_log(new.id, 'start_calc_failed', jsonb_build_object('sqlstate', v_state, 'error', v_err));
        exception when others then
          raise warning '_dispatch_sync_status: could not log start_calc_failed for order %', new.id;
        end;
        raise warning '_dispatch_sync_status: start estimate failed for order %, used the default formula', new.id;
      end;
      insert into order_dispatch (order_id, state, expected_ready_at, start_at, start_basis, next_check_at)
      values (new.id, case when new.rider_id is null then 'scheduled' else 'assigned' end, v_ready, v_start, v_basis,
              case when new.rider_id is null then least(v_start, now() + interval '60 seconds') end)
      on conflict (order_id) do update
        set state = excluded.state, expected_ready_at = excluded.expected_ready_at, start_at = excluded.start_at,
            start_basis = excluded.start_basis, next_check_at = excluded.next_check_at;
      perform _dispatch_log(new.id, 'scheduled', jsonb_build_object('expected_ready_at', v_ready, 'start_at', v_start));
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

-- The rider offer payload omitted this timing field before 0126. Include the
-- order's mirrored timestamp while keeping the existing offer/holder privacy
-- checks in get_dispatch_offer() unchanged.
create or replace function public._rider_offer_detail_json(p_order orders, p_rider uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vendor vendors;
  v_area service_areas;
  v_loc geography(point, 4326);
  v_pickup_m double precision;
  v_estimate bigint;
  v_customer profiles;
begin
  select * into v_vendor from vendors where id = p_order.vendor_id;
  if p_order.rider_id = p_rider then
    select * into v_customer from profiles where id = p_order.customer_id;
  end if;
  select current_location into v_loc from riders where user_id = p_rider;
  if v_loc is not null and v_vendor.location is not null and p_order.service_area_id is not null then
    select * into v_area from service_areas where id = p_order.service_area_id;
    if found then
      v_pickup_m := st_distance(v_loc, v_vendor.location);
      v_estimate := v_area.rider_base_fee_kobo
        + v_area.rider_per_km_fee_kobo * ceil((v_pickup_m + coalesce(p_order.distance_m, 0)) / 1000.0)::bigint;
    end if;
  end if;
  return jsonb_build_object(
    'order_code', p_order.code,
    'status', p_order.status::text,
    'expected_ready_at', p_order.expected_ready_at,
    'vendor_name', v_vendor.name,
    'vendor_address_line', v_vendor.address_line,
    'vendor_landmark', v_vendor.landmark,
    'pickup_lat', st_y(v_vendor.location::geometry),
    'pickup_lng', st_x(v_vendor.location::geometry),
    'dropoff_lat', st_y(p_order.delivery_location::geometry),
    'dropoff_lng', st_x(p_order.delivery_location::geometry),
    'delivery_address', p_order.delivery_address,
    'delivery_note', p_order.delivery_note,
    'item_count', (select coalesce(sum(qty), 0)::integer from order_items where order_id = p_order.id),
    'total_kobo', p_order.total_kobo,
    'delivery_fee_kobo', p_order.delivery_fee_kobo,
    'distance_m', p_order.distance_m,
    'pickup_distance_m', round(v_pickup_m)::integer,
    'rider_fee_estimate_kobo', v_estimate,
    'customer_name', v_customer.full_name,
    'customer_phone', v_customer.phone);
end;
$$;

revoke all on function public._rider_offer_detail_json(public.orders, uuid) from public, anon, authenticated, service_role;

-- Vendor prep edits are server-checked, bounded, and retained per order. For rider
-- delivery they also update the dispatch row used by rider APIs and dispatch timing.
create or replace function public.vendor_update_prep_estimate(p_order_id uuid, p_ready_in_minutes integer)
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
  v_start timestamptz;
  v_notified boolean := false;
begin
  if p_ready_in_minutes is null or p_ready_in_minutes < 1 or p_ready_in_minutes > 180 then
    raise exception 'vendor_update_prep_estimate: ready_in_minutes must be between 1 and 180' using errcode = 'check_violation';
  end if;

  o := _vendor_order_guard('vendor_update_prep_estimate', p_order_id, true);
  if o.status not in ('accepted', 'preparing') then
    raise exception 'vendor_update_prep_estimate: the order is not being prepared' using errcode = 'check_violation';
  end if;

  select count(*)::integer into v_n
  from dispatch_events where order_id = o.id and event = 'prep_estimate_changed';
  if v_n >= 10 then
    raise exception 'vendor_update_prep_estimate: too many changes for this order' using errcode = 'P0429';
  end if;

  v_old := coalesce(
    o.expected_ready_at,
    coalesce(o.accepted_at, o.created_at)
      + make_interval(mins => coalesce(o.prep_minutes, (select avg_prep_mins from vendors where id = o.vendor_id)))
  );
  v_new := now() + make_interval(mins => p_ready_in_minutes);

  update orders
  set prep_minutes = p_ready_in_minutes,
      expected_ready_at = v_new
  where id = o.id;

  if o.delivery_by = 'rider' then
    select * into od from order_dispatch where order_id = o.id for update;
    if not found then
      insert into order_dispatch (order_id, state)
      values (o.id, case when o.rider_id is null then 'scheduled' else 'assigned' end)
      returning * into od;
    end if;
    update order_dispatch set expected_ready_at = v_new where order_id = o.id;
    perform _dispatch_recompute_start(o.id, true);
    select start_at into v_start from order_dispatch where order_id = o.id;
  end if;

  perform _dispatch_log(o.id, 'prep_estimate_changed',
    jsonb_build_object('old', v_old, 'new', v_new, 'ready_in_minutes', p_ready_in_minutes), null, o.rider_id);

  if o.delivery_by = 'rider' and o.rider_id is not null and abs(extract(epoch from (v_new - v_old))) >= 180 then
    perform _dispatch_notify_rider(o.id, o.rider_id,
      case when v_new > v_old then 'Food will be ready later' else 'Food will be ready sooner' end,
      format('Order %s: food should be ready at about %s.', o.code, to_char(v_new at time zone 'Africa/Lagos', 'HH24:MI')),
      'order_prep_update', 'order:' || o.id::text || ':prep:' || (v_n + 1)::text);
    v_notified := true;
  end if;

  return jsonb_build_object('order_id', o.id, 'expected_ready_at', v_new, 'start_at', v_start,
                            'rider_notified', v_notified);
end;
$$;

revoke all on function public.vendor_update_prep_estimate(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.vendor_update_prep_estimate(uuid, integer) to authenticated;

-- Move elapsed prep orders through the ordinary order-state transition core, so
-- timestamps, order_events, customer notifications and Realtime all follow the
-- same path as a manual vendor action. This helper is callable only by the
-- existing dispatch worker identity.
create or replace function public._dispatch_auto_ready_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  if not _dispatch_worker_caller_ok() then
    raise exception '_dispatch_auto_ready_order: requires the service-role key' using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from orders where id = p_order_id for update skip locked;
  if not found
     or v_order.status not in ('accepted', 'preparing')
     or v_order.payment_status <> 'paid'
     or v_order.expected_ready_at is null
     or v_order.expected_ready_at > now() then
    return false;
  end if;

  begin
    if v_order.status = 'accepted' then
      perform _transition_order_core(v_order.id, 'preparing', 'system', null,
        jsonb_build_object('reason', 'prep_deadline_elapsed', 'expected_ready_at', v_order.expected_ready_at));
    end if;
    perform _transition_order_core(v_order.id, 'ready_for_pickup', 'system', null,
      jsonb_build_object('reason', 'prep_deadline_elapsed', 'expected_ready_at', v_order.expected_ready_at));
    return true;
  exception when others then
    raise warning '_dispatch_auto_ready_order: order % failed - % (%)', p_order_id, sqlerrm, sqlstate;
    perform _dispatch_log(p_order_id, 'tick_error',
      jsonb_build_object('stage', 'automatic_prep_ready', 'sqlstate', sqlstate, 'error', left(sqlerrm, 400)));
    return false;
  end;
end;
$$;

revoke all on function public._dispatch_auto_ready_order(uuid) from public, anon, authenticated;
grant execute on function public._dispatch_auto_ready_order(uuid) to service_role;

-- Keep the existing five-second dispatch-tick cron and extend its procedure with
-- one bounded due-prep pass. Each order commits independently, as before.
create or replace procedure public.dispatch_tick(p_batch integer default 200)
language plpgsql
as $$
declare
  v_order_id uuid;
  v_row record;
begin
  if not public._dispatch_worker_caller_ok() then
    raise exception 'dispatch_tick: requires the service-role key' using errcode = 'insufficient_privilege';
  end if;

  for v_order_id in
    select id
    from public.orders
    where status in ('accepted', 'preparing')
      and payment_status = 'paid'
      and expected_ready_at <= now()
    order by expected_ready_at, id
    limit greatest(1, least(coalesce(p_batch, 200), 1000))
  loop
    perform public._dispatch_auto_ready_order(v_order_id);
    commit;
  end loop;

  for v_row in select * from public._dispatch_tick_claim(p_batch) loop
    perform public._dispatch_tick_order(v_row.order_id, 'tick', v_row.due);
    commit;
  end loop;
end;
$$;

comment on column public.orders.prep_minutes is
  'Per-order vendor preparation duration in minutes (1-180). Used to seed expected_ready_at when the vendor accepts; edits are persisted through vendor_update_prep_estimate().';
comment on column public.orders.expected_ready_at is
  'Persisted customer-facing expected-ready timestamp. Mirrored from order_dispatch so customer and rider surfaces share the same ETA.';
comment on function public._dispatch_auto_ready_order(uuid) is
  'Runs only from the existing dispatch_tick worker. Moves paid accepted/preparing orders to ready_for_pickup once their persisted expected_ready_at is due, using _transition_order_core so normal order events and notifications fire.';
