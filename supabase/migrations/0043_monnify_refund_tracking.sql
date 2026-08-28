-- KiaKia — closes the second half of the auto-refund gap
-- (0041_auto_refund_on_cancellation.sql only reversed KiaKia's OWN ledger;
-- the customer's card/account was never actually asked for the money back
-- through Monnify). This migration adds the columns the app layer needs to
-- track that separately, and keeps `payments.status` in sync with
-- `orders.payment_status` (the 'refunded' enum value has existed on
-- payments.status since 0005_ledger.sql but nothing ever set it).
--
-- The actual Monnify refund API call happens from the Next.js app
-- (lib/monnify.ts's initiateRefund(), wired into advanceOrderAction and
-- refundOrderEscrowAction) — Postgres has no HTTP client here (no pg_net),
-- so this migration only prepares the columns that call records itself
-- into; it does not and cannot call Monnify directly.

-- refund_reference: our own generated "<order.code>-refund" string, the
-- same one _unwind_order_escrow_ledger() already uses as the internal
-- transactions.reference anchor — reused here as Monnify's refundReference
-- too, so one string identifies "this order's refund" everywhere. Set only
-- once the app has actually asked Monnify (never by SQL) — its presence is
-- what the app checks to avoid asking Monnify twice for the same order.
--
-- refund_status: Monnify's own last-known status for that request —
-- 'pending' (accepted, still processing — Monnify's PENDING/IN_PROGRESS),
-- 'completed' (money actually moved), 'failed' (Monnify rejected or
-- couldn't complete it — needs a human, not a blind retry with the same
-- reference). NULL means no refund has ever been requested.
alter table payments
  add column refund_reference text,
  add column refund_status text check (refund_status in ('pending', 'completed', 'failed'));

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
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception '_unwind_order_escrow_ledger: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_refund_reference := v_order.code || '-refund';
  v_release_reference := v_order.code || '-escrow';

  if exists (select 1 from transactions where reference = v_refund_reference) then
    return 'already_refunded';
  end if;

  if exists (select 1 from transactions where reference = v_release_reference) then
    return 'already_released';
  end if;

  select id into v_gateway_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'gateway';
  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';

  if v_gateway_account_id is null or v_escrow_account_id is null then
    raise exception '_unwind_order_escrow_ledger: platform gateway/escrow accounts are not seeded';
  end if;

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

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_escrow_account_id, 'debit', v_captured_kobo, 'refund', p_order_id),
    (v_transaction_id, v_gateway_account_id, 'credit', v_captured_kobo, 'refund', p_order_id);

  update orders set payment_status = 'refunded' where id = p_order_id;

  -- Keep payments.status in sync — it has had the 'refunded' enum value
  -- since 0005_ledger.sql but nothing ever set it until now. Guarded by
  -- `status = 'success'` so a payment that never actually succeeded (or is
  -- somehow already marked refunded) is left alone.
  update payments set status = 'refunded' where idempotency_key = v_order.code and status = 'success';

  return 'refunded';
end;
$$;

comment on function _unwind_order_escrow_ledger(uuid, text) is
  'Internal primitive shared by refund_order_escrow() (admin-triggered) and transition_order() (automatic, on rejected_by_vendor/cancelled_by_customer/cancelled_by_platform) — reverses capture_payment()''s ledger entries (DR platform:escrow / CR platform:gateway) for an order''s captured-but-unreleased payment, and marks the matching payments row refunded too. No admin-role check — callers own their own authorization. Idempotent. Never grant to authenticated. Does NOT call Monnify — see lib/monnify.ts''s initiateRefund(), called from the app layer after this succeeds.';

revoke execute on function _unwind_order_escrow_ledger(uuid, text) from public, authenticated;
grant execute on function _unwind_order_escrow_ledger(uuid, text) to service_role;
