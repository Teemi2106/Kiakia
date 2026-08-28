-- KiaKia — fixes a bug caught while manually verifying
-- 0041_auto_refund_on_cancellation.sql end-to-end: transition_order()'s
-- step 3 captures `v_order` from `UPDATE ... RETURNING *`, but step 3a's
-- auto-refund unwind (when it fires) updates orders.payment_status to
-- 'refunded' in a SEPARATE statement afterward — so the row transition_order()
-- returns to its caller still shows the pre-refund payment_status, even
-- though the row actually committed to the database is correct. Confirmed
-- by direct RPC testing: the response body said payment_status: "paid",
-- but a fresh SELECT immediately after showed "refunded".
--
-- No caller in this app currently reads payment_status off transition_order()'s
-- return value (advanceOrderAction only checks for an error, then
-- revalidatePath()s — a fresh Server Component read), so this had no
-- observed user-facing symptom. Still a real correctness bug in the
-- function's own contract ("returns orders" implies the current row, not a
-- pre-side-effect snapshot of it) and worth closing before anything does
-- come to rely on it.
--
-- Fix: re-select the row after the auto-refund block, only on the branch
-- that can actually change it — every other transition (the overwhelming
-- majority) still returns straight from the UPDATE...RETURNING with no
-- extra round trip.

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
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'transition_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_from_status := v_order.status;

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

  if not exists (
    select 1 from order_status_transitions
    where from_status = v_from_status and to_status = p_to_status
  ) then
    raise exception 'transition_order: illegal transition % -> % for order %',
      v_from_status, p_to_status, p_order_id
      using errcode = 'check_violation';
  end if;

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

  if p_to_status in ('rejected_by_vendor', 'cancelled_by_customer', 'cancelled_by_platform') then
    begin
      perform _unwind_order_escrow_ledger(p_order_id, format('Automatically refunded — order moved to %s', p_to_status));
    exception when others then
      raise warning 'transition_order: automatic escrow unwind failed for order % (transition to %): %', p_order_id, p_to_status, sqlerrm;
    end;

    -- Refresh: the unwind above may have updated this row (payment_status)
    -- in a statement separate from the RETURNING clause above, which would
    -- otherwise make the value this function returns stale — see this
    -- migration's own header.
    select * into v_order from orders where id = p_order_id;
  end if;

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (p_order_id, v_from_status, p_to_status, p_actor_type, p_actor_id, p_meta);

  return v_order;
end;
$$;

comment on function transition_order(uuid, order_status, text, uuid, jsonb) is
  'The only writer of orders.status. Mirrors packages/domain/src/order-state-machine.ts — keep both in sync. Also auto-refunds a captured payment out of escrow on rejected_by_vendor/cancelled_by_customer/cancelled_by_platform (0041_auto_refund_on_cancellation.sql) — never on failed_delivery, which stays a manual admin call. Re-reads the row after that unwind so its own return value is never stale for payment_status (0042). §10.';

revoke execute on function transition_order(uuid, order_status, text, uuid, jsonb) from public;
grant execute on function transition_order(uuid, order_status, text, uuid, jsonb) to authenticated, service_role;
