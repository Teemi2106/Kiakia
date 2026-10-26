-- 0105: dispatch metrics for the admin page (D11) + purge_dispatch_events caller check.
--
-- admin_dispatch_metrics(p_since): one jsonb document, service-role only (same
-- gate as admin_dispatch_status; the admin page calls it with the service role
-- after its own admin check). All windows are by the event's own timestamp:
--   offers      -> dispatch_offers.offered_at   (index dispatch_offers_offered_at_idx)
--   events      -> dispatch_events.at           (index dispatch_events_at_idx)
--   assignment  -> order_dispatch.assigned_at   (one row per order, small)
--   readiness   -> orders.ready_at
-- No new indexes are needed (measured, see docs/dispatch-design.md).
-- Rates are 0..1 rounded to 3 decimals; every aggregate is null when it has no samples.
--
-- Readiness split (orders with both ready_at and rider_arrived_vendor_at):
--   rider arrived BEFORE ready_at   -> the rider waited: wait_s = ready_at - arrived
--   rider arrived AT/AFTER ready_at -> the food waited: food_wait_s = arrived - ready_at
--
-- purge_dispatch_events: the old check `... and current_user <> 'postgres'` was always
-- false inside SECURITY DEFINER (current_user is the owner). Now it is the plain
-- service-role check; pg_cron runs `set local role service_role`, where
-- current_setting('role') = 'service_role', so the job still passes.

create or replace function admin_dispatch_metrics(p_since timestamptz default now() - interval '7 days')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
  v_since       timestamptz := coalesce(p_since, now() - interval '7 days');
  v_result      jsonb;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'admin_dispatch_metrics: requires the service-role key';
  end if;

  select jsonb_build_object(
    'since', v_since,
    'offers', (
      select jsonb_build_object(
        'made', n, 'accepted', a, 'declined', d, 'expired', e, 'cancelled', c, 'superseded', s,
        'accept_rate', round(a::numeric / nullif(n, 0), 3),
        'decline_rate', round(d::numeric / nullif(n, 0), 3),
        'expiry_rate', round(e::numeric / nullif(n, 0), 3))
      from (
        select count(*) n,
               count(*) filter (where status = 'accepted') a,
               count(*) filter (where status = 'declined') d,
               count(*) filter (where status = 'expired') e,
               count(*) filter (where status = 'cancelled') c,
               count(*) filter (where status = 'superseded') s
        from dispatch_offers where offered_at >= v_since) t
    ),
    'assignment', (
      select jsonb_build_object(
        'orders_assigned', count(*),
        'median_s', round((percentile_cont(0.5) within group (order by secs))::numeric, 1),
        'p90_s', round((percentile_cont(0.9) within group (order by secs))::numeric, 1),
        'median_offers_per_assigned_order',
          round((percentile_cont(0.5) within group (order by offers))::numeric, 1))
      from (
        select extract(epoch from od.assigned_at - o.accepted_at) as secs,
               (select count(*) from dispatch_offers d where d.order_id = od.order_id) as offers
        from order_dispatch od
        join orders o on o.id = od.order_id
        where od.assigned_at >= v_since and o.accepted_at is not null
      ) t
    ),
    'search', (
      select jsonb_build_object(
        'ring_expansions', (select count(*) from dispatch_events where at >= v_since and event = 'ring_expanded'),
        'orders_with_expansion', (select count(distinct order_id) from dispatch_events
                                  where at >= v_since and event = 'ring_expanded'),
        'beyond_rings_offers', count(*) filter (where ring is null),
        'median_ring', round((percentile_cont(0.5) within group (order by ring))::numeric, 1))
      from dispatch_offers where offered_at >= v_since
    ),
    'reliability', (
      select jsonb_build_object(
        'needs_attention_now', (select count(*) from order_dispatch where state = 'needs_attention'),
        'needs_attention_events', count(*) filter (where event = 'needs_attention'),
        'accept_conflicts', count(*) filter (where event = 'accept_conflict'),
        'stale_accepts', count(*) filter (where event = 'stale_accept_rejected'),
        'tick_lag_events', count(*) filter (where event = 'tick_lag'),
        'tick_errors', count(*) filter (where event = 'tick_error'),
        'push_failed', count(*) filter (where event = 'push_failed'))
      from dispatch_events
      where at >= v_since
        and event in ('needs_attention', 'accept_conflict', 'stale_accept_rejected', 'tick_lag', 'tick_error', 'push_failed')
    ),
    'readiness', (
      select jsonb_build_object(
        'samples', count(*),
        'rider_waited_share', round(count(*) filter (where d < 0)::numeric / nullif(count(*), 0), 3),
        'food_waited_share', round(count(*) filter (where d >= 0)::numeric / nullif(count(*), 0), 3),
        'median_rider_wait_s', round((percentile_cont(0.5) within group (order by -d) filter (where d < 0))::numeric, 1),
        'p90_rider_wait_s', round((percentile_cont(0.9) within group (order by -d) filter (where d < 0))::numeric, 1),
        'median_food_wait_s', round((percentile_cont(0.5) within group (order by d) filter (where d >= 0))::numeric, 1),
        'p90_food_wait_s', round((percentile_cont(0.9) within group (order by d) filter (where d >= 0))::numeric, 1))
      from (
        select extract(epoch from od.rider_arrived_vendor_at - o.ready_at) as d
        from order_dispatch od
        join orders o on o.id = od.order_id
        where o.ready_at >= v_since and od.rider_arrived_vendor_at is not null
      ) t
    ),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'service_area_id', s.service_area_id, 'name', sa.name,
        'speed_kmh', s.speed_kmh, 'speed_source', s.speed_source, 'speed_samples', s.speed_samples,
        'secure_buffer_s', s.secure_buffer_s, 'buffer_source', s.buffer_source,
        'buffer_samples', s.buffer_samples, 'refreshed_at', s.refreshed_at) order by sa.name)
      from dispatch_area_stats s join service_areas sa on sa.id = s.service_area_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function admin_dispatch_metrics(timestamptz) from public, anon, authenticated;
grant execute on function admin_dispatch_metrics(timestamptz) to service_role;

create or replace function purge_dispatch_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
  v_deleted     integer;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'purge_dispatch_events: requires the service-role key';
  end if;
  perform set_config('kiakia.dispatch_events_purge', 'on', true);
  delete from dispatch_events where at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  perform set_config('kiakia.dispatch_events_purge', 'off', true);
  return v_deleted;
end;
$$;
