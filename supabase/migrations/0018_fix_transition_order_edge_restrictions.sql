-- KiaKia — fix: 0015_fix_transition_order_actor_forgery.sql closed the
-- identity-forgery hole (p_actor_id/p_actor_type must match the real
-- session, not just be a truthful-looking claim) but left every actor type
-- free to drive an order to ANY p_to_status that happens to be a legal edge
-- for the order's CURRENT status in order_status_transitions — that table
-- only encodes "what status can a draft/placed/... order become", not "who
-- is allowed to make it become that". Since ('draft', 'placed') is a legal
-- edge (0006_transition_order.sql — payment capture moves an order from
-- draft to placed), a customer could call:
--
--   transition_order(their_own_draft_order, 'placed', 'customer', their_own_uid)
--
-- and it would pass every check 0015 added: the caller IS the customer on
-- the order, the edge IS legal — forcing an unpaid draft order straight into
-- the vendor's active queue, bypassing capture_payment() (0010/0017) and the
-- Monnify webhook entirely. This is the exact bug 0015's own header claimed
-- to close.
--
-- Fix: layer a per-actor-type allow-list of p_to_status values on top of the
-- existing identity + relationship checks. Every edge below is verified
-- against packages/domain/src/order-state-machine.ts (the specification —
-- see its own header comment) and against every real caller in this
-- codebase today, not invented:
--
--   customer — may only request 'cancelled_by_customer'. There is no
--     legitimate customer-initiated edge other than cancelling their own
--     order; draft -> placed is exclusively capture_payment()'s job (actor
--     'system', service-role only), never the customer's.
--
--   vendor — may only request 'accepted', 'rejected_by_vendor', 'preparing',
--     'ready_for_pickup' (placed -> accepted/rejected_by_vendor,
--     accepted -> preparing, preparing -> ready_for_pickup in
--     ALLOWED_TRANSITIONS). Matches the only four values
--     advanceOrderAction (app/actions/orders.ts) ever passes today.
--     'cancelled_by_platform' is deliberately NOT in this list even though
--     it's a legal edge from every vendor-reachable status — despite the
--     name suggesting an operational actor, no Server Action lets a vendor
--     drive that edge, and it should stay that way (a stalled-order refund
--     is an admin/system decision, not a vendor one).
--
--   rider — may only request 'picked_up', 'in_transit', 'arrived',
--     'delivered', 'failed_delivery' (rider_assigned -> picked_up ->
--     in_transit -> arrived -> delivered/failed_delivery). No rider-facing
--     Server Action exists yet (Phase 3/dispatch), but this is the exact
--     rider-driven slice of ALLOWED_TRANSITIONS and nothing more.
--
--   system (service_role only, per 0015) — may only request 'placed'
--     (draft -> placed, capture_payment()'s call, 0010/0017 — verified
--     against what that function actually invokes today: p_actor_id is
--     always null, p_actor_type is always 'system', p_to_status is always
--     'placed'), 'cancelled_by_platform' (the SLA-timeout auto-cancel and
--     stalled-order paths §10/§22 describe as automated/ops-driven, from
--     any status that legally allows it per order_status_transitions), and
--     'rider_assigned' (ready_for_pickup -> rider_assigned is a legal edge
--     with no vendor/rider/customer actor authorized to drive it above —
--     it's the dispatch orchestrator's job, also 'system').
--
--   admin (service_role caller + a real admin/superadmin row, per 0015) —
--     may only request 'cancelled_by_platform' — the one admin-ops edge
--     §22 actually describes ("a stalled-order cancel-and-refund path").
--     No admin Server Action is reachable yet; this is deliberately the
--     narrowest grant that doesn't invent authority the architecture doc
--     never described.
--
-- Every one of these allow-lists is strictly narrower than (a subset of)
-- what order_status_transitions already permits for that actor's
-- authenticated relationship — this is a second, independent gate, not a
-- replacement for the existing one. A transition that isn't in
-- order_status_transitions at all is still rejected by check 2 below
-- regardless of actor type.

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
  v_caller_uid  uuid := auth.uid();
  -- S1 (independent security review): auth.role() returns NULL when there
  -- are no JWT claims at all (a direct psql/pg_cron connection using its
  -- Postgres role rather than a PostgREST-issued JWT) — comparing NULL
  -- <> 'service_role' is also NULL, which `if` treats as false, so the old
  -- `if v_caller_role <> 'service_role' then raise` guard FAILED OPEN for
  -- exactly the callers (pg_cron, a raw psql session authenticated as the
  -- service_role Postgres role) that most need this branch to work, not a
  -- forged 'system'/'admin' claim to be silently accepted. Falling back to
  -- current_setting('role', true) — the actual Postgres role of the current
  -- session, always non-null — and using `is distinct from` (which, unlike
  -- <>, treats NULL as a real, non-matching value instead of propagating it)
  -- closes that gap without changing behavior for any PostgREST-authenticated
  -- caller (where auth.role() already reflects the JWT's role claim).
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
begin
  -- 1. Lock the row (§10 point 1) — this is also what makes concurrent
  --    transitions on the same order serialize instead of racing.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'transition_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_from_status := v_order.status;

  -- Authorization, part 1: the actor must have a real relationship to the
  -- order, proven by the SESSION making the call (auth.uid()/auth.role()),
  -- never by the p_actor_id/p_actor_type arguments alone.
  if p_actor_type = 'customer' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or v_caller_uid is distinct from v_order.customer_id then
      raise exception 'transition_order: actor is not the customer on order %', p_order_id;
    end if;
    -- Authorization, part 2 (this migration's fix): which edges this actor
    -- TYPE may drive, independent of whether the edge is legal for the
    -- order's current status. See file header.
    if p_to_status <> 'cancelled_by_customer' then
      raise exception 'transition_order: actor_type=customer may not drive an order to %— only cancelled_by_customer', p_to_status;
    end if;
  elsif p_actor_type = 'vendor' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or not exists (
      select 1 from vendor_staff where vendor_id = v_order.vendor_id and user_id = v_caller_uid
    ) then
      raise exception 'transition_order: actor is not staff on vendor %', v_order.vendor_id;
    end if;
    if p_to_status not in ('accepted', 'rejected_by_vendor', 'preparing', 'ready_for_pickup') then
      raise exception 'transition_order: actor_type=vendor may not drive an order to %', p_to_status;
    end if;
  elsif p_actor_type = 'rider' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or v_caller_uid is distinct from v_order.rider_id then
      raise exception 'transition_order: actor is not the assigned rider on order %', p_order_id;
    end if;
    if p_to_status not in ('picked_up', 'in_transit', 'arrived', 'delivered', 'failed_delivery') then
      raise exception 'transition_order: actor_type=rider may not drive an order to %', p_to_status;
    end if;
  elsif p_actor_type = 'admin' then
    -- No `authenticated`-reachable admin surface exists yet — reserved for
    -- a future service-role-fronted admin tool, same trust boundary as
    -- 'system' below. Never let a plain authenticated session claim this.
    if v_caller_role is distinct from 'service_role' then
      raise exception 'transition_order: actor_type=admin requires the service-role key';
    end if;
    if p_actor_id is null or not exists (
      select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
    ) then
      raise exception 'transition_order: actor % is not an admin', p_actor_id;
    end if;
    if p_to_status <> 'cancelled_by_platform' then
      raise exception 'transition_order: actor_type=admin may not drive an order to %— only cancelled_by_platform', p_to_status;
    end if;
  elsif p_actor_type = 'system' then
    -- Reserved for pg_cron / the dispatch orchestrator / capture_payment's
    -- internal call, all of which run with the service-role key.
    if v_caller_role is distinct from 'service_role' then
      raise exception 'transition_order: actor_type=system requires the service-role key';
    end if;
    if p_to_status not in ('placed', 'cancelled_by_platform', 'rider_assigned') then
      raise exception 'transition_order: actor_type=system may not drive an order to %', p_to_status;
    end if;
  else
    raise exception 'transition_order: unknown actor_type %', p_actor_type;
  end if;

  -- 2. Validate against the explicit allowed-transitions table — a second,
  --    independent gate: even an actor type cleared to request p_to_status
  --    in principle still can't skip the state machine (e.g. a vendor
  --    can't request 'preparing' on an order still sitting in 'placed'
  --    without going through 'accepted' first — 'preparing' is only a
  --    legal edge FROM 'accepted').
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
  'The only writer of orders.status. Mirrors packages/domain/src/order-state-machine.ts — keep both in sync. §10. Actor identity is derived from auth.uid()/auth.role(), not trusted from p_actor_id/p_actor_type alone (0015), and each actor TYPE is further restricted to the specific p_to_status values it is legitimately allowed to request (0018) — see 0018_fix_transition_order_edge_restrictions.sql.';

-- Grants are unchanged — still callable by `authenticated` for
-- customer/vendor/rider actor types; system/admin actor types are rejected
-- inside the function body for any caller whose role isn't service_role.
revoke execute on function transition_order(uuid, order_status, text, uuid, jsonb) from public;
grant execute on function transition_order(uuid, order_status, text, uuid, jsonb) to authenticated, service_role;
