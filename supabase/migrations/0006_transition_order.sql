-- KiaKia — Phase 0 foundation migration 6/7.
-- transition_order(): the ONLY code path allowed to write orders.status
-- (§10). This is the SQL twin of packages/domain/src/order-state-machine.ts
-- — the transitions table below must match ALLOWED_TRANSITIONS there
-- exactly. A pgTAP test in supabase/tests asserts every edge.

-- ---------------------------------------------------------------------------
-- The explicit allowed-transitions table (§10 point 2: "Validates against
-- an explicit allowed-transitions table").
-- ---------------------------------------------------------------------------

create table order_status_transitions (
  from_status  order_status not null,
  to_status    order_status not null,
  primary key (from_status, to_status)
);

insert into order_status_transitions (from_status, to_status) values
  ('draft',             'placed'),
  ('placed',            'accepted'),
  ('placed',            'rejected_by_vendor'),
  ('placed',            'cancelled_by_customer'),
  ('placed',            'cancelled_by_platform'),
  ('accepted',          'preparing'),
  ('accepted',          'cancelled_by_platform'),
  ('preparing',         'ready_for_pickup'),
  ('preparing',         'cancelled_by_platform'),
  ('ready_for_pickup',  'rider_assigned'),
  ('ready_for_pickup',  'cancelled_by_platform'),
  ('rider_assigned',    'picked_up'),
  ('rider_assigned',    'cancelled_by_platform'),
  ('picked_up',         'in_transit'),
  ('picked_up',         'cancelled_by_platform'),
  ('in_transit',        'arrived'),
  ('in_transit',        'cancelled_by_platform'),
  ('arrived',           'delivered'),
  ('arrived',           'failed_delivery'),
  ('arrived',           'cancelled_by_platform');

revoke all on order_status_transitions from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- transition_order()
-- ---------------------------------------------------------------------------

create or replace function transition_order(
  p_order_id   uuid,
  p_to_status  order_status,
  p_actor_type text,
  p_actor_id   uuid,
  p_meta       jsonb default '{}'::jsonb
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       orders;
  v_from_status order_status;
begin
  -- 1. Lock the row (§10 point 1) — this is also what makes concurrent
  --    transitions on the same order serialize instead of racing.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'transition_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_from_status := v_order.status;

  -- Authorization: the actor must have a real relationship to the order.
  -- This is a base guard, not the full per-transition role matrix (e.g.
  -- "only the vendor may accept, only the assigned rider may mark
  -- picked_up") — that mapping is layered on top by the Server Actions
  -- calling this function in Phase 1-3, once real UI flows exist to test
  -- it against. What this prevents today: a stranger with a valid session
  -- moving an order they have no connection to.
  if p_actor_type = 'customer' and p_actor_id is distinct from v_order.customer_id then
    raise exception 'transition_order: actor % is not the customer on order %', p_actor_id, p_order_id;
  elsif p_actor_type = 'vendor' and not exists (
    select 1 from vendor_staff where vendor_id = v_order.vendor_id and user_id = p_actor_id
  ) then
    raise exception 'transition_order: actor % is not staff on vendor %', p_actor_id, v_order.vendor_id;
  elsif p_actor_type = 'rider' and p_actor_id is distinct from v_order.rider_id then
    raise exception 'transition_order: actor % is not the assigned rider on order %', p_actor_id, p_order_id;
  elsif p_actor_type = 'admin' and not exists (
    select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
  ) then
    raise exception 'transition_order: actor % is not an admin', p_actor_id;
  end if;
  -- actor_type = 'system' is reserved for pg_cron / the dispatch
  -- orchestrator calling with the service-role key and is not further
  -- restricted here — that caller is already trusted infrastructure.

  -- 2. Validate against the explicit allowed-transitions table.
  if not exists (
    select 1 from order_status_transitions
    where from_status = v_from_status and to_status = p_to_status
  ) then
    raise exception 'transition_order: illegal transition % -> % for order %',
      v_from_status, p_to_status, p_order_id
      using errcode = 'check_violation';
  end if;

  -- 3. Update status + the matching timestamp column, same transaction.
  update orders set
    status        = p_to_status,
    placed_at     = case when p_to_status = 'placed' then now() else placed_at end,
    accepted_at   = case when p_to_status = 'accepted' then now() else accepted_at end,
    ready_at      = case when p_to_status = 'ready_for_pickup' then now() else ready_at end,
    assigned_at   = case when p_to_status = 'rider_assigned' then now() else assigned_at end,
    picked_up_at  = case when p_to_status = 'picked_up' then now() else picked_up_at end,
    in_transit_at = case when p_to_status = 'in_transit' then now() else in_transit_at end,
    arrived_at    = case when p_to_status = 'arrived' then now() else arrived_at end,
    delivered_at  = case when p_to_status = 'delivered' then now() else delivered_at end,
    cancelled_at  = case
                      when p_to_status in ('cancelled_by_customer', 'cancelled_by_platform', 'rejected_by_vendor', 'failed_delivery')
                      then now() else cancelled_at
                    end
  where id = p_order_id
  returning * into v_order;

  -- 4. Insert the order_events row — same transaction, always.
  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (p_order_id, v_from_status, p_to_status, p_actor_type, p_actor_id, p_meta);

  -- 5. Return the new state; a Postgres Changes subscription on `orders`
  --    propagates it over Realtime (§8).
  return v_order;
end;
$$;

comment on function transition_order(uuid, order_status, text, uuid, jsonb) is
  'The only writer of orders.status. Mirrors packages/domain/src/order-state-machine.ts — keep both in sync. §10.';

revoke execute on function transition_order(uuid, order_status, text, uuid, jsonb) from public;
grant execute on function transition_order(uuid, order_status, text, uuid, jsonb) to authenticated, service_role;
