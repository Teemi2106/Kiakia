-- KiaKia — closes the gap 0031_refund_and_escrow_unwind.sql's own header
-- flagged but didn't fix: "If an order is captured and then cancelled — or
-- simply abandoned before delivery — the customer's money sits in escrow
-- forever" unless an admin happens to notice and manually runs
-- refund_order_escrow(). This migration makes that automatic for the three
-- pre-delivery "this order is never going to be fulfilled" transitions —
-- rejected_by_vendor, cancelled_by_customer, cancelled_by_platform — by
-- having transition_order() itself trigger the same ledger unwind the
-- instant one of those transitions lands, rather than waiting on a human.
--
-- Deliberately NOT failed_delivery: that status means a rider genuinely
-- reached 'arrived' and attempted the handover — whether the customer still
-- owes for that attempt is a support/business judgment call, not a
-- mechanical one, so it stays on the existing manual admin path.
--
-- The ledger-reversal core of refund_order_escrow() is extracted into
-- _unwind_order_escrow_ledger() so both the admin-triggered path and this
-- new automatic path share one implementation instead of two that could
-- drift — refund_order_escrow()'s own external behavior (error messages,
-- error codes, idempotency, its own transition_order()-triggering side
-- effect) is unchanged, it just delegates its core mutation to the shared
-- function now.

-- ---------------------------------------------------------------------------
-- 1. _unwind_order_escrow_ledger(p_order_id, p_reason)
-- ---------------------------------------------------------------------------
--
-- No admin-role check here (unlike refund_order_escrow()) — this is an
-- internal primitive; each caller owns its own authorization
-- (refund_order_escrow()'s existing admin check, or transition_order()'s
-- own actor/transition validation that already ran before this is reached).
-- Never granted to `authenticated` — same idiom as capture_payment().
--
-- Returns a status instead of raising for the "nothing to do" cases
-- ('already_refunded' / 'already_released' / 'nothing_captured') so callers
-- can decide for themselves whether that's an error (refund_order_escrow()
-- still raises, preserving its existing contract) or a silent no-op
-- (transition_order() — a failed/impossible auto-refund must never block
-- the status transition itself, which is the primary invariant here).
create or replace function _unwind_order_escrow_ledger(
  p_order_id uuid,
  p_reason   text
)
returns text -- 'refunded' | 'already_refunded' | 'already_released' | 'nothing_captured'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order              orders;
  v_refund_reference    text;
  v_release_reference   text;
  v_gateway_account_id  uuid;
  v_escrow_account_id   uuid;
  v_transaction_id      uuid;
  v_captured_kobo       bigint;
begin
  -- Same row lock transition_order()/refund_order_escrow() each already take
  -- before ever reaching this function — re-locking a row this transaction
  -- already holds is a no-op, not a deadlock.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception '_unwind_order_escrow_ledger: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_refund_reference := v_order.code || '-refund';
  v_release_reference := v_order.code || '-escrow';

  -- Idempotent: already refunded (this call, an earlier admin call, or a
  -- nested transition_order() call triggered by refund_order_escrow()
  -- itself further down its own body — see that function below) is a no-op.
  if exists (select 1 from transactions where reference = v_refund_reference) then
    return 'already_refunded';
  end if;

  -- THE guard: never refund on top of an already-released payout.
  if exists (select 1 from transactions where reference = v_release_reference) then
    return 'already_released';
  end if;

  select id into v_gateway_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'gateway';
  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';

  if v_gateway_account_id is null or v_escrow_account_id is null then
    raise exception '_unwind_order_escrow_ledger: platform gateway/escrow accounts are not seeded';
  end if;

  -- Derive the captured amount from the ledger itself — never total_kobo,
  -- never a caller-supplied amount. See refund_order_escrow()'s own header
  -- for why (0017's amount-mismatch tolerance means captured != total_kobo
  -- is a real, expected case).
  select coalesce(sum(amount_kobo), 0) into v_captured_kobo
  from ledger_entries
  where order_id = p_order_id
    and account_id = v_escrow_account_id
    and direction = 'credit'
    and entry_type = 'payment_capture';

  if v_captured_kobo = 0 then
    return 'nothing_captured';
  end if;

  insert into transactions (kind, reference, order_id, description)
  values ('refund', v_refund_reference, p_order_id, coalesce('Escrow refunded: ' || p_reason, 'Escrow refunded'))
  returning id into v_transaction_id;

  -- Exact mirror of capture_payment()'s two entries, reversed: DR escrow, CR gateway.
  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_escrow_account_id, 'debit', v_captured_kobo, 'refund', p_order_id),
    (v_transaction_id, v_gateway_account_id, 'credit', v_captured_kobo, 'refund', p_order_id);

  update orders set payment_status = 'refunded' where id = p_order_id;

  return 'refunded';
end;
$$;

comment on function _unwind_order_escrow_ledger(uuid, text) is
  'Internal primitive shared by refund_order_escrow() (admin-triggered) and transition_order() (automatic, on rejected_by_vendor/cancelled_by_customer/cancelled_by_platform) — reverses capture_payment()''s ledger entries (DR platform:escrow / CR platform:gateway) for an order''s captured-but-unreleased payment. No admin-role check — callers own their own authorization. Idempotent. Never grant to authenticated.';

revoke execute on function _unwind_order_escrow_ledger(uuid, text) from public, authenticated;
grant execute on function _unwind_order_escrow_ledger(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. refund_order_escrow() — redefined to delegate to the shared primitive.
--    External behavior (signature, error messages/codes, idempotency, the
--    cancelled_by_platform side effect) is UNCHANGED — reproduced here only
--    because CREATE OR REPLACE needs the full body.
-- ---------------------------------------------------------------------------

create or replace function refund_order_escrow(
  p_order_id uuid,
  p_actor_id uuid,
  p_reason   text
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order         orders;
  v_caller_role   text := coalesce(auth.role(), current_setting('role', true));
  v_unwind_result text;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'refund_order_escrow: requires the service-role key';
  end if;

  if p_actor_id is null or not exists (
    select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
  ) then
    raise exception 'refund_order_escrow: actor % is not an admin', p_actor_id;
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'refund_order_escrow: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_unwind_result := _unwind_order_escrow_ledger(p_order_id, p_reason);

  if v_unwind_result = 'already_refunded' then
    select * into v_order from orders where id = p_order_id;
    return v_order;
  end if;

  if v_unwind_result = 'already_released' then
    raise exception 'refund_order_escrow: order % escrow has already been released to vendor/rider/platform — refusing to refund and pay out twice', p_order_id
      using errcode = 'check_violation';
  end if;

  if v_unwind_result = 'nothing_captured' then
    raise exception 'refund_order_escrow: order % has no captured payment held in escrow to refund (payment_status=%)', p_order_id, v_order.payment_status
      using errcode = 'check_violation';
  end if;

  -- v_unwind_result = 'refunded' from here on.
  -- Move the order to a terminal state if the state machine allows an edge
  -- from wherever it currently sits — never invent one. See this function's
  -- own comment (unchanged from 0031) for the full reasoning.
  if exists (
    select 1 from order_status_transitions
    where from_status = v_order.status and to_status = 'cancelled_by_platform'
  ) then
    v_order := transition_order(
      p_order_id, 'cancelled_by_platform', 'admin', p_actor_id,
      jsonb_build_object('reason', p_reason, 'refund_transaction', v_order.code || '-refund')
    );
  else
    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (
      p_order_id, v_order.status, v_order.status, 'admin', p_actor_id,
      jsonb_build_object('reason', p_reason, 'refund_transaction', v_order.code || '-refund', 'escrow_refunded', true)
    );
    select * into v_order from orders where id = p_order_id;
  end if;

  return v_order;
end;
$$;

comment on function refund_order_escrow(uuid, uuid, text) is
  'Reverses capture_payment()''s ledger entries for an order whose escrow has NOT yet been released (via _unwind_order_escrow_ledger()) — refuses outright if escrow was already released (never pay out AND refund the same order). Idempotent. Moves the order to cancelled_by_platform if a legal edge exists from its current status; otherwise records the refund on order_events without inventing a status transition. service_role callers only, with a real admin/superadmin user_roles row for p_actor_id. Never grant to authenticated.';

revoke execute on function refund_order_escrow(uuid, uuid, text) from public, authenticated;
grant execute on function refund_order_escrow(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. transition_order() — redefined to auto-unwind escrow on the three
--    pre-delivery "never fulfilled" transitions. Everything else about
--    this function (locking, actor authorization, the allowed-transitions
--    check, the timestamp columns, order_events) is UNCHANGED from
--    0006/0015/0018 — reproduced in full only because CREATE OR REPLACE
--    needs the whole body.
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

  -- 3a. Auto-refund: this order is never going to be fulfilled from here —
  -- reverse its captured payment out of escrow immediately rather than
  -- leaving it stranded until an admin notices (0031's own header flagged
  -- exactly this gap). Shares _unwind_order_escrow_ledger() with the manual
  -- admin path (refund_order_escrow()), so this can never double-refund or
  -- fight a concurrent admin action — both funnel through the same
  -- idempotency guards.
  --
  -- Deliberately NOT failed_delivery: a rider genuinely reached 'arrived'
  -- and attempted the handover there — whether the customer still owes for
  -- that attempt is a support/business judgment call, left on the existing
  -- manual admin path, not made automatic here.
  --
  -- Wrapped so a failure in the unwind (e.g. platform accounts somehow not
  -- seeded) can never block the status transition itself, which is the
  -- primary invariant this function exists to enforce — surfaced as a
  -- WARNING rather than silently swallowed, with refund_order_escrow()
  -- still available as a manual fallback.
  if p_to_status in ('rejected_by_vendor', 'cancelled_by_customer', 'cancelled_by_platform') then
    begin
      perform _unwind_order_escrow_ledger(p_order_id, format('Automatically refunded — order moved to %s', p_to_status));
    exception when others then
      raise warning 'transition_order: automatic escrow unwind failed for order % (transition to %): %', p_order_id, p_to_status, sqlerrm;
    end;
  end if;

  -- 4. Insert the order_events row — same transaction, always.
  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (p_order_id, v_from_status, p_to_status, p_actor_type, p_actor_id, p_meta);

  -- 5. Return the new state; a Postgres Changes subscription on `orders`
  --    propagates it over Realtime (§8).
  return v_order;
end;
$$;

comment on function transition_order(uuid, order_status, text, uuid, jsonb) is
  'The only writer of orders.status. Mirrors packages/domain/src/order-state-machine.ts — keep both in sync. Also auto-refunds a captured payment out of escrow on rejected_by_vendor/cancelled_by_customer/cancelled_by_platform (0041_auto_refund_on_cancellation.sql) — never on failed_delivery, which stays a manual admin call. §10.';

revoke execute on function transition_order(uuid, order_status, text, uuid, jsonb) from public;
grant execute on function transition_order(uuid, order_status, text, uuid, jsonb) to authenticated, service_role;
