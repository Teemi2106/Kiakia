-- 0100: dispatch schema and constraints for the sequential-offer engine.
--
-- Design: docs/dispatch-design.md (decisions C1-C15, D1-D12, section 4). This
-- migration is SCHEMA ONLY: columns, constraints, indexes, tables, the
-- transition guard, the settings keys and the minimum patches that keep the OLD
-- dispatch functions from crashing on the new constraints. The new engine
-- (_dispatch_advance, candidate discovery, wrappers) is 0101; the rider/admin/
-- vendor RPCs are 0102.
--
-- WHAT CHANGES
--   1. dispatch_offers: cycle/attempt/ring/radius/distance/ETA/close_reason,
--      statuses superseded + cancelled, ONE live and ONE accepted offer per
--      order (partial unique indexes), UNIQUE (order_id, cycle_no, attempt_no),
--      the pair unique (order_id, rider_id) is dropped (offers are never
--      re-opened any more), transition guard trigger.
--   2. order_dispatch (1:1 with orders): dispatch state kept off `orders` so the
--      engine's frequent writes do not wake every realtime subscriber.
--   3. dispatch_events (append-only log) + _dispatch_log() + purge_dispatch_events().
--   4. riders.h3_cell (resolution 9) kept by a trigger, only when the location moves.
--   5. platform_settings: the D10 keys (two new units: kmh, pct) and
--      _dispatch_offer_ttl() reading dispatch_offer_timeout_seconds.
--
-- THE OLD FUNCTIONS BETWEEN 0100 AND 0101 (read this before touching them)
-- The 0098 functions below depend on `unique (order_id, rider_id)` (upsert that
-- re-opens an expired row) and on several simultaneous live offers. They are
-- patched IN PLACE at the end of this file, textually and with an assertion that
-- each replacement matched, so the patch fails loudly if their bodies ever
-- differ from 0098:
--   _dispatch_offer_round      expires its own lapsed offer, returns without
--                              doing anything while a live offer exists, and
--                              inserts at most ONE new row: the nearest eligible
--                              rider (the batch size p_batch_size / the
--                              dispatch_max_riders setting no longer fan out in
--                              this path; the setting still exists). No upsert:
--                              a rider whose offer lapsed in an earlier cycle
--                              simply gets a NEW row.
--   accept_dispatch_offer      marks only the caller's LIVE offer accepted (it
--                              used to update every row of the pair) and closes
--                              other live offers as 'superseded'.
--   admin_reassign_order_rider supersedes live offers, then inserts a fresh
--                              'accepted' row (no upsert).
--   vendor_start_self_delivery closes live offers as 'cancelled' (offered ->
--                              revoked is not a legal transition), as D C5 says.
-- decline_dispatch_offer, sweep_dispatch_offers, _redispatch_core,
-- dispatch_order_to_nearby_riders, dispatch_orders_nearing_prep_completion and
-- the SMS/push triggers need no change: they only update rows that are
-- 'offered' or insert rows without conflict handling.
-- cycle_no / attempt_no on INSERT are filled by a BEFORE INSERT shim trigger
-- (dispatch_offers_default_numbers) for any writer that does not set them; the
-- 0101 engine sets them explicitly and may drop the shim.

-- ===========================================================================
-- 1. dispatch_offers
-- ===========================================================================

alter table dispatch_offers
  add column cycle_no     integer,
  add column attempt_no   integer,
  add column ring         integer,
  add column radius_m     integer,
  add column distance_m   integer,
  add column eta_seconds  integer,
  add column close_reason text;

comment on column dispatch_offers.cycle_no is
  'Search round (cycle) this offer belongs to, 1-based. Part of the idempotency key (order_id, cycle_no, attempt_no).';
comment on column dispatch_offers.attempt_no is
  'Per-order offer sequence number, 1-based and increasing across cycles: the generation of the offer.';
comment on column dispatch_offers.ring is 'H3 grid ring the rider was found in (null for non-H3 stages).';
comment on column dispatch_offers.radius_m is 'Search radius in use when the offer was made (null = no cap).';
comment on column dispatch_offers.distance_m is 'Straight-line distance rider -> vendor at offer time, metres.';
comment on column dispatch_offers.eta_seconds is 'Estimated rider -> vendor travel time at offer time, seconds.';
comment on column dispatch_offers.close_reason is
  'Why a non-accepted offer was closed (timeout, declined, rider_offline, order_assigned, vendor_self_delivery, admin_assign, migration_sequential, ...). Free text, for operators.';

-- Backfill: every existing offer belongs to cycle 1; attempts follow offer order.
update dispatch_offers d
set cycle_no = 1, attempt_no = s.n
from (
  select id, row_number() over (partition by order_id order by offered_at, id)::integer as n
  from dispatch_offers
) s
where s.id = d.id;

-- New statuses (C5). Must exist before the cleanup below uses 'superseded'.
alter table dispatch_offers drop constraint dispatch_offers_status_check;
alter table dispatch_offers add constraint dispatch_offers_status_check
  check (status in ('offered', 'accepted', 'expired', 'declined', 'revoked', 'superseded', 'cancelled'));

comment on column dispatch_offers.status is
  'offered: live until expires_at (at most one per order). accepted: the rider holds the order (at most one per order). expired: lapsed. declined: the rider refused (never re-offered). revoked: an operator took an ACCEPTED order off the rider (never re-offered, 0083). superseded: the order was claimed by someone else or an operator replaced the offer. cancelled: the offer was invalidated (rider offline/ineligible, order cancelled, vendor self-delivery). Terminal states never change; see dispatch_offers_guard.';
comment on column dispatch_offers.expires_at is
  'Offer expiry. Defaults to now() + _dispatch_offer_ttl() (platform setting dispatch_offer_timeout_seconds).';

-- Close extra live offers BEFORE the partial unique index exists: keep the
-- earliest-expiring one per order (ties: earliest offered, then id), supersede the
-- rest. Their queued SMS are suppressed like any other closed offer.
do $$
declare
  v_closed   integer;
  v_orders   integer;
  v_dup_acc  integer;
begin
  with ranked as (
    select id, order_id,
           row_number() over (partition by order_id order by expires_at, offered_at, id) as rn
    from dispatch_offers
    where status = 'offered'
  ), closed as (
    update dispatch_offers d
    set status = 'superseded', close_reason = 'migration_sequential', responded_at = now()
    from ranked r
    where r.id = d.id and r.rn > 1
    returning d.id, d.order_id
  ), sms as (
    update message_outbox m
    set status = 'suppressed', suppress_reason = 'expired'
    from closed c
    where m.dedupe_key = 'offer:' || c.id::text || ':sms' and m.status = 'queued'
    returning 1
  )
  select count(*)::integer, count(distinct order_id)::integer into v_closed, v_orders from closed;
  raise notice '0100: closed % extra live offers on % orders as superseded (migration_sequential)', v_closed, v_orders;

  -- More than one accepted offer on an order cannot be real (orders.rider_id is
  -- single-valued). Keep the one that matches orders.rider_id (else the latest),
  -- mark the others revoked so the accepted-unique index can be built.
  with ranked as (
    select d.id,
           row_number() over (
             partition by d.order_id
             order by (d.rider_id = o.rider_id) desc nulls last, d.responded_at desc nulls last, d.id desc
           ) as rn
    from dispatch_offers d join orders o on o.id = d.order_id
    where d.status = 'accepted'
  ), fixed as (
    update dispatch_offers d
    set status = 'revoked', close_reason = 'migration_duplicate_accepted', responded_at = now()
    from ranked r
    where r.id = d.id and r.rn > 1
    returning 1
  )
  select count(*)::integer into v_dup_acc from fixed;
  raise notice '0100: resolved % duplicate accepted offers (revoked)', v_dup_acc;
end
$$;

alter table dispatch_offers
  alter column cycle_no set not null,
  alter column attempt_no set not null;

-- The pair unique goes: one row per OFFER now, never re-opened (C4).
alter table dispatch_offers drop constraint dispatch_offers_order_id_rider_id_key;

create unique index dispatch_offers_one_live_per_order
  on dispatch_offers (order_id) where status = 'offered';
create unique index dispatch_offers_one_accepted_per_order
  on dispatch_offers (order_id) where status = 'accepted';
alter table dispatch_offers
  add constraint dispatch_offers_order_cycle_attempt_key unique (order_id, cycle_no, attempt_no);

-- dispatch_offers_order_id_idx is now a strict prefix of the unique above.
drop index dispatch_offers_order_id_idx;
-- The rider app lists its live offers by rider_id + status = 'offered'.
create index dispatch_offers_rider_live_idx on dispatch_offers (rider_id) where status = 'offered';
-- kept: dispatch_offers_live_expiry_idx (expiry sweep), dispatch_offers_rider_id_idx (history).

-- Nothing re-opens an expired row any more (C4): drop the 0076 re-open push.
-- dispatch_offers_notify_rider (AFTER INSERT) stays; the outbox step replaces it.
drop trigger dispatch_offers_notify_rider_reopened on dispatch_offers;

-- Shim for writers that do not set cycle/attempt (old engine, tests, admin
-- assignment): next attempt number of the order, cycle of its latest offer or 1.
-- Callers hold the orders row lock (D2); a race ends in a unique violation, not
-- in a duplicate.
create function _dispatch_offers_default_numbers()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.attempt_no is null then
    select coalesce(max(attempt_no), 0) + 1 into new.attempt_no
    from dispatch_offers where order_id = new.order_id;
  end if;
  if new.cycle_no is null then
    select coalesce(max(cycle_no), 1) into new.cycle_no
    from dispatch_offers where order_id = new.order_id;
  end if;
  return new;
end;
$$;
create trigger dispatch_offers_default_numbers
  before insert on dispatch_offers
  for each row execute function _dispatch_offers_default_numbers();

-- Transition guard (D2). Allowed: offered -> accepted | declined | expired |
-- superseded | cancelled, and accepted -> revoked. Everything else, including any
-- change to a row whose status does not change, raises check_violation.
-- Immutable: order_id, rider_id, offered_at, expires_at, cycle_no, attempt_no.
-- responded_at is stamped by the database on every transition.
create function _dispatch_offers_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_id is distinct from old.order_id
     or new.rider_id is distinct from old.rider_id
     or new.offered_at is distinct from old.offered_at
     or new.expires_at is distinct from old.expires_at
     or new.cycle_no is distinct from old.cycle_no
     or new.attempt_no is distinct from old.attempt_no then
    raise exception 'dispatch_offers: order_id, rider_id, offered_at, expires_at, cycle_no and attempt_no are immutable'
      using errcode = 'check_violation';
  end if;

  if new.status is not distinct from old.status then
    if new is distinct from old then
      raise exception 'dispatch_offers: a % offer cannot be changed without a status transition', old.status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if not (
    (old.status = 'offered' and new.status in ('accepted', 'declined', 'expired', 'superseded', 'cancelled'))
    or (old.status = 'accepted' and new.status = 'revoked')
  ) then
    raise exception 'dispatch_offers: illegal transition % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  new.responded_at := now();
  return new;
end;
$$;
create trigger dispatch_offers_guard
  before update on dispatch_offers
  for each row execute function _dispatch_offers_guard();

-- ===========================================================================
-- 2. order_dispatch (D3)
-- ===========================================================================

create table order_dispatch (
  order_id                uuid primary key references orders(id) on delete cascade,
  state                   text not null default 'scheduled'
    check (state in ('scheduled', 'searching', 'offered', 'assigned', 'needs_attention', 'stopped')),
  cycle_no                integer not null default 0,
  attempt_no              integer not null default 0,
  ring                    integer,
  next_check_at           timestamptz,
  expected_ready_at       timestamptz,
  start_at                timestamptz,
  start_basis             jsonb not null default '{}'::jsonb,
  dispatch_started_at     timestamptz,
  assigned_at             timestamptz,
  assigned_eta_at         timestamptz,
  current_eta_at          timestamptz,
  eta_updated_at          timestamptz,
  rider_arrived_vendor_at timestamptz,
  needs_attention_since   timestamptz,
  attention_reason        text,
  error_count             integer not null default 0,
  last_error              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table order_dispatch is
  'Dispatch state of an order, 1:1 with orders (D3). Kept off orders so frequent engine writes do not wake every realtime subscriber on the order. Written only by SECURITY DEFINER dispatch functions; service_role may select; no client role has any access.';
comment on column order_dispatch.next_check_at is 'When the worker must look at this order next (offer expiry, predicted start, retry). Null = nothing scheduled.';
comment on column order_dispatch.attempt_no is 'Highest attempt_no issued for the order (generation). 0 = no offer yet.';

create index order_dispatch_next_check_idx on order_dispatch (next_check_at)
  where state not in ('assigned', 'stopped');

create trigger order_dispatch_set_updated_at
  before update on order_dispatch
  for each row execute function set_updated_at();

alter table order_dispatch enable row level security;
revoke all on order_dispatch from public, anon, authenticated, service_role;
grant select on order_dispatch to service_role;

-- Backfill in-flight rider-delivery orders so the worker adopts them.
insert into order_dispatch (
  order_id, state, cycle_no, attempt_no, next_check_at, expected_ready_at,
  dispatch_started_at, assigned_at
)
select o.id,
       case
         when o.rider_id is not null then 'assigned'
         when exists (select 1 from dispatch_offers d where d.order_id = o.id and d.status = 'offered') then 'offered'
         else 'searching'
       end,
       coalesce((select max(d.cycle_no) from dispatch_offers d where d.order_id = o.id), 0),
       coalesce((select max(d.attempt_no) from dispatch_offers d where d.order_id = o.id), 0),
       case when o.rider_id is null then now() end,
       coalesce(o.accepted_at, now()) + make_interval(mins => coalesce(v.avg_prep_mins, 0)),
       coalesce(o.first_dispatched_at, (select min(d.offered_at) from dispatch_offers d where d.order_id = o.id)),
       case when o.rider_id is not null then o.assigned_at end
from orders o
join vendors v on v.id = o.vendor_id
where o.delivery_by = 'rider'
  and o.status in ('accepted', 'preparing', 'ready_for_pickup', 'rider_assigned');

-- ===========================================================================
-- 3. dispatch_events (D11): append-only log
-- ===========================================================================

-- No foreign keys on purpose: a log must outlive and never block the rows it
-- describes (offers, riders, orders), and its only deletion path is the
-- retention purge.
create table dispatch_events (
  id         uuid primary key default uuid_generate_v7(),
  at         timestamptz not null default now(),
  order_id   uuid not null,
  cycle_no   integer not null default 0,
  attempt_no integer not null default 0,
  offer_id   uuid,
  rider_id   uuid,
  event      text not null check (event in (
    'scheduled', 'start_recomputed', 'cycle_started', 'ring_expanded', 'offer_created',
    'offer_accepted', 'offer_declined', 'offer_expired', 'offer_cancelled', 'offer_superseded',
    'accept_conflict', 'stale_accept_rejected', 'no_candidates', 'needs_attention', 'tick_error',
    'prep_estimate_changed', 'ready_early', 'prep_overrun', 'eta_increased', 'rider_at_vendor',
    'push_failed'
  )),
  data       jsonb not null default '{}'::jsonb
);

comment on table dispatch_events is
  'Append-only dispatch log (D11). Correlation: order_id + cycle_no + attempt_no. Ids only, no personal data. Rows older than 90 days are removed by purge_dispatch_events(); nothing else can update or delete.';

create index dispatch_events_order_at_idx on dispatch_events (order_id, at);
create index dispatch_events_at_idx on dispatch_events (at);

alter table dispatch_events enable row level security;
revoke all on dispatch_events from public, anon, authenticated, service_role;
grant select on dispatch_events to service_role;

-- Append-only guard. The purge function opens a transaction-local switch; the
-- table's DELETE privilege is held by its owner alone, so the switch is not a
-- client-reachable bypass.
create function _dispatch_events_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and current_setting('kiakia.dispatch_events_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'dispatch_events is append-only (% refused)', tg_op
    using errcode = 'check_violation';
end;
$$;
create trigger dispatch_events_no_change
  before update or delete on dispatch_events
  for each row execute function _dispatch_events_guard();
create trigger dispatch_events_no_truncate
  before truncate on dispatch_events
  for each statement execute function _dispatch_events_guard();

-- Internal writer: cycle/attempt come from order_dispatch (0 when it has no row).
create function _dispatch_log(
  p_order uuid,
  p_event text,
  p_data  jsonb default '{}'::jsonb,
  p_offer uuid default null,
  p_rider uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into dispatch_events (order_id, cycle_no, attempt_no, offer_id, rider_id, event, data)
  select p_order, coalesce(od.cycle_no, 0), coalesce(od.attempt_no, 0), p_offer, p_rider, p_event,
         coalesce(p_data, '{}'::jsonb)
  from (select 1) one
  left join order_dispatch od on od.order_id = p_order;
end;
$$;
revoke all on function _dispatch_log(uuid, text, jsonb, uuid, uuid) from public, anon, authenticated;

-- Retention (90 days). Scheduling (pg_cron) comes with the worker migration.
create function purge_dispatch_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
  v_deleted     integer;
begin
  if v_caller_role is distinct from 'service_role' and current_user <> 'postgres' then
    raise exception 'purge_dispatch_events: requires the service-role key';
  end if;
  perform set_config('kiakia.dispatch_events_purge', 'on', true);
  delete from dispatch_events where at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  perform set_config('kiakia.dispatch_events_purge', 'off', true);
  return v_deleted;
end;
$$;
revoke all on function purge_dispatch_events() from public, anon, authenticated;
grant execute on function purge_dispatch_events() to service_role;

-- ===========================================================================
-- 4. riders.h3_cell (D6)
-- ===========================================================================

alter table riders add column h3_cell bigint;
comment on column riders.h3_cell is
  'H3 cell (resolution 9) of current_location, maintained by riders_set_h3_cell only when the location changes. Discovery aid for dispatch; current_location stays the source of truth. Null when there is no location.';

create function _riders_set_h3_cell()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A ping that does not move the rider does no H3 work at all.
  if tg_op = 'INSERT' or new.current_location is distinct from old.current_location then
    if new.current_location is null then
      new.h3_cell := null;
    else
      new.h3_cell := h3_latlng_to_cell(
        st_y(new.current_location::geometry), st_x(new.current_location::geometry), 9);
    end if;
  end if;
  return new;
end;
$$;
create trigger riders_set_h3_cell
  before insert or update of current_location on riders
  for each row execute function _riders_set_h3_cell();

-- Backfill without bumping updated_at.
alter table riders disable trigger riders_set_updated_at;
update riders
set h3_cell = h3_latlng_to_cell(st_y(current_location::geometry), st_x(current_location::geometry), 9)
where current_location is not null;
alter table riders enable trigger riders_set_updated_at;

-- Partial: riders without a location are never discoverable. One btree serves
-- every search resolution through descendant range scans (D6).
create index riders_h3_cell_idx on riders (h3_cell) where h3_cell is not null;

-- ===========================================================================
-- 5. platform_settings (D10)
-- ===========================================================================

-- Two new units for the speed and road-factor keys, so admin screens can label
-- them correctly instead of calling them 'count'.
alter table platform_settings drop constraint platform_settings_unit_check;
alter table platform_settings add constraint platform_settings_unit_check
  check (unit in ('bps', 'kobo', 'm', 'count', 'seconds', 'kmh', 'pct'));

alter table platform_settings drop constraint platform_settings_known_key_and_bounds;
alter table platform_settings add constraint platform_settings_known_key_and_bounds check (
  (key = 'service_fee_bps' and unit = 'bps' and value_int between 0 and 2000)
  or (key = 'default_vendor_commission_bps' and unit = 'bps' and value_int between 0 and 5000)
  or (key = 'dispatch_radius_m' and unit = 'm' and (value_int = 0 or value_int between 1000 and 50000))
  or (key = 'dispatch_max_riders' and unit = 'count' and value_int between 1 and 50)
  or (key = 'dispatch_widen_after_seconds' and unit = 'seconds' and value_int between 0 and 1800)
  or (key = 'dispatch_location_max_age_seconds' and unit = 'seconds' and value_int between 60 and 300)
  or (key = 'dispatch_notify_vendor_after_seconds' and unit = 'seconds' and value_int between 0 and 1800)
  or (key = 'dispatch_offer_timeout_seconds' and unit = 'seconds' and value_int between 15 and 120)
  or (key = 'dispatch_h3_resolution' and unit = 'count' and value_int between 7 and 9)
  or (key = 'dispatch_h3_initial_ring' and unit = 'count' and value_int between 0 and 10)
  or (key = 'dispatch_h3_max_ring' and unit = 'count' and value_int between 1 and 30)
  or (key = 'dispatch_secure_buffer_seconds' and unit = 'seconds' and value_int between 45 and 900)
  or (key = 'dispatch_default_travel_seconds' and unit = 'seconds' and value_int between 60 and 3600)
  or (key = 'dispatch_default_speed_kmh' and unit = 'kmh' and value_int between 5 and 60)
  or (key = 'dispatch_road_factor_pct' and unit = 'pct' and value_int between 100 and 250)
  or (key = 'dispatch_min_history_samples' and unit = 'count' and value_int between 5 and 1000)
  or (key = 'dispatch_vendor_arrival_radius_m' and unit = 'm' and value_int between 30 and 500)
);
-- dispatch_h3_initial_ring <= dispatch_h3_max_ring spans two rows: a CHECK cannot
-- see that. admin_set_dispatch_setting (0102) must enforce it.

insert into platform_settings (key, value_int, unit) values
  ('dispatch_offer_timeout_seconds', 45, 'seconds'),
  ('dispatch_h3_resolution', 8, 'count'),
  ('dispatch_h3_initial_ring', 1, 'count'),
  ('dispatch_h3_max_ring', 8, 'count'),
  ('dispatch_secure_buffer_seconds', 150, 'seconds'),
  ('dispatch_default_travel_seconds', 600, 'seconds'),
  ('dispatch_default_speed_kmh', 18, 'kmh'),
  ('dispatch_road_factor_pct', 135, 'pct'),
  ('dispatch_min_history_samples', 20, 'count'),
  ('dispatch_vendor_arrival_radius_m', 100, 'm');

-- Was a constant 60 s (IMMUTABLE, 0078). Now the admin-editable timeout. STABLE
-- (it reads a table) and SECURITY DEFINER like _platform_setting_int, since it is
-- also the column default of dispatch_offers.expires_at.
create or replace function _dispatch_offer_ttl()
returns interval
language sql
stable
security definer
set search_path = public
as $$ select make_interval(secs => _platform_setting_int('dispatch_offer_timeout_seconds')::integer) $$;

-- ===========================================================================
-- 6. Minimal in-place patches of the 0098 functions (see header)
-- ===========================================================================

create function pg_temp._patch(p_sig regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $$
declare
  -- Some 0083/0098 bodies were stored with CRLF line endings; normalise.
  v_def text := replace(pg_get_functiondef(p_sig), E'
', E'
');
  v_new text := replace(v_def, p_old, p_new);
begin
  if v_new = v_def then
    raise exception '0100 patch: expected text not found in %', p_sig;
  end if;
  execute v_new;
end;
$$;

-- _dispatch_offer_round: at most one live offer per order, one new row per call.
select pg_temp._patch(
  '_dispatch_offer_round(uuid, timestamptz, integer, text)'::regprocedure,
  $old$  v_batch := coalesce(p_batch_size, _platform_setting_int('dispatch_max_riders')::integer);
$old$,
  $new$  v_batch := coalesce(p_batch_size, _platform_setting_int('dispatch_max_riders')::integer);

  -- 0100 (sequential offers): serialise on the order, retire a lapsed live offer,
  -- and do nothing while a live one remains. The caller already holds the lock.
  perform 1 from orders where id = p_order_id for update;
  update dispatch_offers
  set status = 'expired', close_reason = 'timeout', responded_at = now()
  where order_id = p_order_id and status = 'offered' and expires_at <= now();
  if exists (select 1 from dispatch_offers where order_id = p_order_id and status = 'offered') then
    return query select 0, null::integer, null::integer, 'base'::text;
    return;
  end if;
$new$);

select pg_temp._patch(
  '_dispatch_offer_round(uuid, timestamptz, integer, text)'::regprocedure,
  $old$  limit v_batch
  on conflict (order_id, rider_id) do update
    set status       = 'offered',
        offered_at   = now(),
        expires_at   = now() + _dispatch_offer_ttl(),
        responded_at = null
    where dispatch_offers.status = 'expired';
$old$,
  $new$  limit 1;   -- 0100: ONE offer (the nearest), never a batch, never a re-opened row
$new$);

-- accept_dispatch_offer: only the caller's LIVE offer becomes accepted (there can
-- now be older closed rows for the same rider and order); others are superseded.
select pg_temp._patch(
  'accept_dispatch_offer(uuid)'::regprocedure,
  $old$  set status = 'accepted', responded_at = now()
  where order_id = p_order_id and rider_id = auth.uid();$old$,
  $new$  set status = 'accepted', responded_at = now()
  where order_id = p_order_id and rider_id = auth.uid() and status = 'offered';$new$);

select pg_temp._patch(
  'accept_dispatch_offer(uuid)'::regprocedure,
  $old$  set status = 'expired', responded_at = now()
  where order_id = p_order_id and rider_id <> auth.uid() and status = 'offered';$old$,
  $new$  set status = 'superseded', close_reason = 'order_assigned', responded_at = now()
  where order_id = p_order_id and rider_id <> auth.uid() and status = 'offered';$new$);

-- admin_reassign_order_rider: supersede live offers, then a plain insert.
select pg_temp._patch(
  'admin_reassign_order_rider(uuid, uuid, text, uuid)'::regprocedure,
  $old$    insert into dispatch_offers (order_id, rider_id, status, responded_at)
    values (p_order_id, p_rider_id, 'accepted', now())
    on conflict (order_id, rider_id) do update
      set status = 'accepted', responded_at = now();

    update dispatch_offers
    set status = 'expired', responded_at = now()
    where order_id = p_order_id and rider_id <> p_rider_id and status = 'offered';
$old$,
  $new$    update dispatch_offers
    set status = 'superseded', close_reason = 'admin_assign', responded_at = now()
    where order_id = p_order_id and status = 'offered';

    insert into dispatch_offers (order_id, rider_id, status, responded_at)
    values (p_order_id, p_rider_id, 'accepted', now());
$new$);

-- vendor_start_self_delivery: offered -> revoked is no longer a legal transition.
select pg_temp._patch(
  'vendor_start_self_delivery(uuid)'::regprocedure,
  $old$    update dispatch_offers set status = 'revoked', responded_at = now()$old$,
  $new$    update dispatch_offers set status = 'cancelled', close_reason = 'vendor_self_delivery', responded_at = now()$new$);
