-- KiaKia — Phase 3 build-out, part 1/3: rider dispatch. The rider mobile
-- app itself is a SEPARATE application; this migration only builds the
-- Supabase backend surface (schema + RPCs) it calls directly via the
-- Supabase client SDK with a rider's own JWT — no rider UI belongs in this
-- repo.
--
-- Flow: an order becomes 'ready_for_pickup' (vendor-driven, via
-- transition_order()) -> a trigger offers it to the nearest online riders
-- by inserting dispatch_offers rows -> the rider app detects a new offer by
-- subscribing to postgres_changes on dispatch_offers filtered to its own
-- rider_id (or polling) -> the rider calls accept_dispatch_offer().
--
-- accept_dispatch_offer() is deliberately NOT routed through
-- transition_order(): that function's rider branch (0018) authorizes by
-- checking auth.uid() = orders.rider_id, but at the moment of accepting an
-- offer, orders.rider_id is still NULL — that's the whole point, no rider
-- is assigned yet, so that check can never pass for this edge. The real
-- authorization predicate here is "does an 'offered' dispatch_offers row
-- exist for this rider on this order", which is fundamentally different
-- from "is this rider already the assigned rider" — it needs its own
-- function, not a special case bolted onto transition_order's
-- already-reviewed logic.

-- ---------------------------------------------------------------------------
-- dispatch_offers
-- ---------------------------------------------------------------------------

create table dispatch_offers (
  id            uuid primary key default uuid_generate_v7(),
  order_id      uuid not null references orders (id),
  rider_id      uuid not null references riders (user_id),
  status        text not null default 'offered' check (status in ('offered', 'accepted', 'expired', 'declined')),
  offered_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique (order_id, rider_id)
);

comment on table dispatch_offers is
  'One row per (order, rider) dispatch attempt, written only by dispatch_order_to_nearby_riders() (the trigger below) and accept_dispatch_offer() — no authenticated-reachable write path exists. The rider app detects "you have a new offer" by subscribing to postgres_changes on this table filtered to rider_id = its own auth.uid(), or by polling its own rows.';

create index dispatch_offers_order_id_idx on dispatch_offers (order_id);
create index dispatch_offers_rider_id_idx on dispatch_offers (rider_id);

alter table dispatch_offers enable row level security;

create policy "rider reads own offers" on dispatch_offers for select
  using (rider_id = auth.uid());

revoke insert, update, delete on dispatch_offers from authenticated;

-- ---------------------------------------------------------------------------
-- Dispatch trigger — fires when an order transitions INTO ready_for_pickup,
-- offers it to the nearest online riders within range.
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
  select location into v_vendor_location from vendors where id = new.vendor_id;

  if v_vendor_location is null then
    -- No location to dispatch from — same silent-skip posture place_order()
    -- takes when a vendor has no location set. Nothing useful can be
    -- computed, and this must never block the underlying status transition
    -- that fired this trigger.
    return new;
  end if;

  insert into dispatch_offers (order_id, rider_id)
  select new.id, r.user_id
  from riders r
  where r.is_online
    and r.current_location is not null
    and st_dwithin(r.current_location, v_vendor_location, 5000) -- 5km radius
  order by st_distance(r.current_location, v_vendor_location) asc
  limit 10
  on conflict (order_id, rider_id) do nothing;

  return new;
end;
$$;

comment on function dispatch_order_to_nearby_riders() is
  'AFTER UPDATE OF status trigger on orders: when an order becomes ready_for_pickup, offers it to the 10 nearest online riders within 5km of the vendor''s location. SECURITY DEFINER because riders/dispatch_offers writes must bypass RLS — neither table has an authenticated-reachable write path.';

create trigger orders_dispatch_to_riders
  after update of status on orders
  for each row
  when (new.status = 'ready_for_pickup' and old.status is distinct from 'ready_for_pickup')
  execute function dispatch_order_to_nearby_riders();

-- ---------------------------------------------------------------------------
-- accept_dispatch_offer() — see file header for why this does not reuse
-- transition_order().
-- ---------------------------------------------------------------------------

create or replace function accept_dispatch_offer(p_order_id uuid)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  -- Lock the row first — same reasoning as transition_order()'s own first
  -- step: this is also what makes two riders racing to accept the same
  -- offer serialize instead of racing.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'accept_dispatch_offer: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.status <> 'ready_for_pickup' or v_order.rider_id is not null then
    raise exception 'accept_dispatch_offer: order already assigned or not ready for pickup';
  end if;

  if not exists (
    select 1 from dispatch_offers
    where order_id = p_order_id and rider_id = auth.uid() and status = 'offered'
  ) then
    raise exception 'accept_dispatch_offer: no active offer for this rider on this order';
  end if;

  -- Defensive, mirrors transition_order()'s own style: don't skip the
  -- explicit allowed-transitions check even though this specific edge is
  -- known to exist in order_status_transitions (0006_transition_order.sql).
  if not exists (
    select 1 from order_status_transitions
    where from_status = 'ready_for_pickup' and to_status = 'rider_assigned'
  ) then
    raise exception 'accept_dispatch_offer: ready_for_pickup -> rider_assigned is not a legal transition';
  end if;

  update orders
  set rider_id = auth.uid(), status = 'rider_assigned', assigned_at = now()
  where id = p_order_id
  returning * into v_order;

  -- Mirrors transition_order()'s own order_events insert shape exactly.
  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (p_order_id, 'ready_for_pickup', 'rider_assigned', 'rider', auth.uid(), '{}'::jsonb);

  update dispatch_offers
  set status = 'accepted', responded_at = now()
  where order_id = p_order_id and rider_id = auth.uid();

  update dispatch_offers
  set status = 'expired', responded_at = now()
  where order_id = p_order_id and rider_id <> auth.uid() and status = 'offered';

  return v_order;
end;
$$;

comment on function accept_dispatch_offer(uuid) is
  'The only way a dispatch offer becomes an assignment. Deliberately not routed through transition_order() — see this migration''s file header for why orders.rider_id being NULL at this exact moment breaks that function''s rider-authorization check. Any authenticated rider may call this; the offered-row + ready_for_pickup/rider_id-null checks are what actually gate it, same trust model as transition_order().';

revoke execute on function accept_dispatch_offer(uuid) from public;
grant execute on function accept_dispatch_offer(uuid) to authenticated;
