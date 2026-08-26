-- KiaKia — independent security review (round 3), BLOCKING finding 4, plus
-- two of the cheap nits from the same review.
--
-- BLOCKING 4 — neither the rider-dispatch trigger nor accept_dispatch_offer()
-- ever checked riders.kyc_status. Nothing can set riders.is_online yet (no
-- rider-onboarding-goes-online flow exists in this repo), so this is
-- currently inert in practice, but it's a one-line omission in a brand-new
-- authorization query and must be fixed at the source — not deferred to
-- whatever migration eventually lets riders go online, by which point it
-- would already be exploitable by a pending/rejected-KYC rider. Fix: add
-- `and r.kyc_status = 'approved'` to dispatch_order_to_nearby_riders()'s
-- eligibility query, AND check the caller's own riders row inside
-- accept_dispatch_offer() itself — don't just trust that only kyc-approved
-- riders were ever offered, since an offer could have been made before a
-- later KYC rejection (dispatch_offers rows aren't retracted on rejection).
--
-- Nits:
--   - riders.current_location had no index at all; the dispatch trigger's
--     st_dwithin/st_distance query has nothing to use. Added a GIST index.
--   - The dispatch trigger's offer-insert logic is now wrapped in an
--     exception handler so a failure there (anything beyond the
--     already-handled null-vendor-location case) can never abort the
--     vendor's ready_for_pickup transition that fired it.

create index riders_current_location_gix on riders using gist (current_location);

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

  -- Wrapped in its own sub-block (this migration's nit fix): a failure
  -- anywhere in here must never abort the vendor's ready_for_pickup
  -- transition — that transition already happened and is correct
  -- regardless of whether any rider ends up offered the order.
  begin
    insert into dispatch_offers (order_id, rider_id)
    select new.id, r.user_id
    from riders r
    where r.is_online
      -- BLOCKING 4 fix: a pending/rejected-KYC rider must never receive a
      -- dispatch offer, online or not.
      and r.kyc_status = 'approved'
      and r.current_location is not null
      and st_dwithin(r.current_location, v_vendor_location, 5000) -- 5km radius
    order by st_distance(r.current_location, v_vendor_location) asc
    limit 10
    on conflict (order_id, rider_id) do nothing;
  exception when others then
    raise warning 'dispatch_order_to_nearby_riders: failed to create dispatch offers for order % — %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function dispatch_order_to_nearby_riders() is
  'AFTER UPDATE OF status trigger on orders: when an order becomes ready_for_pickup, offers it to the 10 nearest online, KYC-approved riders within 5km of the vendor''s location. SECURITY DEFINER because riders/dispatch_offers writes must bypass RLS — neither table has an authenticated-reachable write path. The offer-insert itself is wrapped in an exception handler so a failure there can never abort the ready_for_pickup transition that fired this trigger — see 0023_rider_dispatch_kyc_hardening.sql.';

-- The trigger itself (created in 0019) is unchanged — CREATE OR REPLACE
-- FUNCTION above is sufficient; no need to drop/recreate the trigger.

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

  -- BLOCKING 4 fix: check the CALLER's own current kyc_status, not just
  -- trust that only kyc-approved riders were ever offered — an offer could
  -- have been made before a later KYC rejection, and dispatch_offers rows
  -- aren't retracted when that happens.
  if not exists (
    select 1 from riders where user_id = auth.uid() and kyc_status = 'approved'
  ) then
    -- Deliberately not interpolating auth.uid() here (unlike other messages
    -- in this function that interpolate a fixed p_order_id) — the caller
    -- already knows who they are, and keeping the message static makes it
    -- exactly matchable by pgTAP's throws_ok() 4-arg form even though the
    -- rider's own uid is generated at test-fixture time, not a fixed literal.
    raise exception 'accept_dispatch_offer: rider is not kyc-approved';
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
  'The only way a dispatch offer becomes an assignment. Deliberately not routed through transition_order() — see 0019_rider_dispatch.sql''s file header for why orders.rider_id being NULL at this exact moment breaks that function''s rider-authorization check. Any authenticated rider may call this; the offered-row + ready_for_pickup/rider_id-null + kyc_status=approved checks are what actually gate it. The kyc_status check was added in 0023_rider_dispatch_kyc_hardening.sql (independent security review, round 3, blocking finding 4) — checked against the CALLER''s live riders row, not merely trusted from having received an offer.';

revoke execute on function accept_dispatch_offer(uuid) from public;
grant execute on function accept_dispatch_offer(uuid) to authenticated;
