-- KiaKia — fix: transition_order() (0006_transition_order.sql) authorized
-- every transition by comparing the order's real relationships against
-- p_actor_id — a plain client-suppliable argument, never validated against
-- who actually holds the session. Combined with p_actor_type = 'system'
-- falling through the if/elsif chain with NO check at all, any logged-in
-- `authenticated` caller could invoke this SECURITY DEFINER function
-- (grant execute ... to authenticated) with p_actor_type => 'system', or
-- with a forged vendor/customer/rider p_actor_id, and drive ANY order
-- through ANY legal state transition — e.g. pushing their own unpaid draft
-- straight to 'placed', or forging vendor staff status to accept/reject a
-- stranger's order.
--
-- Fix: p_actor_id is now only a *claim*, checked against the real caller —
-- auth.uid() for customer/vendor/rider actor types (the exact identity a
-- normal `authenticated` session can prove), auth.role() = 'service_role'
-- for system/admin actor types (mirrors how capture_payment,
-- 0010_capture_payment.sql, restricts itself to the service-role caller —
-- there is no `authenticated`-reachable path that should ever claim to be
-- "the system" or "an admin"). A customer/vendor/rider actor_type call
-- whose p_actor_id doesn't match the caller's own auth.uid() is rejected
-- outright, even before checking the order relationship, so a forged id
-- can no longer be used to impersonate someone else's relationship to the
-- order.
--
-- Signature is unchanged (uuid, order_status, text, uuid, jsonb) — every
-- existing caller (advanceOrderAction, capture_payment's internal call)
-- keeps working; p_actor_id is still required from customer/vendor/rider
-- callers as a redundant-but-harmless claim so the audit trail
-- (order_events.actor_id) stays populated without an extra auth.uid()
-- lookup inside the function.

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
  v_caller_role text := auth.role();
begin
  -- 1. Lock the row (§10 point 1) — this is also what makes concurrent
  --    transitions on the same order serialize instead of racing.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'transition_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_from_status := v_order.status;

  -- Authorization: the actor must have a real relationship to the order,
  -- proven by the SESSION making the call (auth.uid()/auth.role()), never
  -- by the p_actor_id/p_actor_type arguments alone — those are untrusted
  -- client input like every other RPC parameter. This is a base guard, not
  -- the full per-transition role matrix (e.g. "only the vendor may accept,
  -- only the assigned rider may mark picked_up") — that mapping is layered
  -- on top by the Server Actions calling this function. What this
  -- prevents: a stranger with a valid session moving an order they have no
  -- connection to, or claiming to be the system/an admin without the
  -- service-role key.
  if p_actor_type = 'customer' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or v_caller_uid is distinct from v_order.customer_id then
      raise exception 'transition_order: actor is not the customer on order %', p_order_id;
    end if;
  elsif p_actor_type = 'vendor' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or not exists (
      select 1 from vendor_staff where vendor_id = v_order.vendor_id and user_id = v_caller_uid
    ) then
      raise exception 'transition_order: actor is not staff on vendor %', v_order.vendor_id;
    end if;
  elsif p_actor_type = 'rider' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or v_caller_uid is distinct from v_order.rider_id then
      raise exception 'transition_order: actor is not the assigned rider on order %', p_order_id;
    end if;
  elsif p_actor_type = 'admin' then
    -- No `authenticated`-reachable admin surface exists yet — reserved for
    -- a future service-role-fronted admin tool, same trust boundary as
    -- 'system' below. Never let a plain authenticated session claim this.
    if v_caller_role <> 'service_role' then
      raise exception 'transition_order: actor_type=admin requires the service-role key';
    end if;
    if p_actor_id is null or not exists (
      select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
    ) then
      raise exception 'transition_order: actor % is not an admin', p_actor_id;
    end if;
  elsif p_actor_type = 'system' then
    -- Reserved for pg_cron / the dispatch orchestrator / capture_payment's
    -- internal call, all of which run with the service-role key — this
    -- used to fall through with NO check at all, the sharpest version of
    -- the forgery bug this migration fixes.
    if v_caller_role <> 'service_role' then
      raise exception 'transition_order: actor_type=system requires the service-role key';
    end if;
  else
    raise exception 'transition_order: unknown actor_type %', p_actor_type;
  end if;

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
  'The only writer of orders.status. Mirrors packages/domain/src/order-state-machine.ts — keep both in sync. §10. Actor identity is derived from auth.uid()/auth.role(), not trusted from p_actor_id/p_actor_type alone — see 0015_fix_transition_order_actor_forgery.sql.';

-- Grants are unchanged from 0006 — still callable by `authenticated` for
-- customer/vendor/rider actor types; system/admin actor types are now
-- rejected inside the function body for any caller whose auth.role() isn't
-- service_role, so the grant no longer needs to (and shouldn't) be
-- narrowed to service_role only.
revoke execute on function transition_order(uuid, order_status, text, uuid, jsonb) from public;
grant execute on function transition_order(uuid, order_status, text, uuid, jsonb) to authenticated, service_role;
