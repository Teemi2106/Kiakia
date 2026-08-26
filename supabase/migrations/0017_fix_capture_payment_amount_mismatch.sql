-- KiaKia — fix: capture_payment() (0010_capture_payment.sql) credited the
-- ledger with whatever amount the caller passed as p_amount_kobo, with no
-- check against the order's own total_kobo. If the Naira-vs-kobo unit
-- assumption in lib/monnify.ts is ever wrong, or a payment is shortpaid /
-- overpaid, nothing detects it — the capture just silently "succeeds" with
-- a mismatched amount.
--
-- Fix, deliberately minimal (detectability, not a reconciliation
-- subsystem): compare p_amount_kobo against orders.total_kobo and record
-- the outcome on the order_events row that's already written by the
-- transition_order() call at the end of this function — no new column,
-- no new table, reusing the existing "append an order_events row with a
-- meta payload" convention (0006_transition_order.sql). Money still moves
-- (the ledger entries below are unconditional — funds already left the
-- customer via Monnify, refusing to record that would just make the
-- mismatch harder to find, not prevent it), but a mismatch is now visible
-- to anyone reading order_events instead of being invisible.

create or replace function capture_payment(
  p_order_id        uuid,
  p_provider        text,
  p_provider_ref    text,
  p_amount_kobo     bigint,
  p_raw             jsonb,
  p_idempotency_key text,
  p_channel         text default null
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment             payments;
  v_gateway_account_id  uuid;
  v_escrow_account_id   uuid;
  v_transaction_id      uuid;
  v_order               orders;
  v_amount_mismatch     boolean;
begin
  select * into v_payment from payments where idempotency_key = p_idempotency_key for update;
  if not found then
    raise exception 'capture_payment: no payment row found for idempotency_key % — placeOrderAction should have inserted one at checkout time', p_idempotency_key;
  end if;

  if v_payment.status = 'success' then
    -- Idempotent: a duplicate webhook delivery (§6.3) is a no-op, not a
    -- second capture — the same provider_ref redelivered is expected and
    -- silent.
    --
    -- SHOULD-FIX (independent security review, second pass): a DIFFERENT
    -- provider_ref for this idempotency_key means a genuinely separate
    -- payment was captured against an order that's already paid — routine
    -- now that the retry flow deliberately allows multiple live Monnify
    -- checkout sessions per order (see initializePaymentForOrder,
    -- app/actions/orders.ts). That second payment's money isn't credited to
    -- the ledger here (no double-credit — this function still returns
    -- without touching ledger_entries/transactions), but it must not
    -- disappear silently. Flag it on order_events, reusing the existing
    -- "append an event with a meta payload" convention rather than a new
    -- table/column.
    if p_provider_ref is distinct from v_payment.provider_ref then
      raise warning 'capture_payment: a second payment (provider_ref %) was captured for order % which is already paid via provider_ref % (idempotency_key=%) — funds may need manual reconciliation',
        p_provider_ref, p_order_id, v_payment.provider_ref, p_idempotency_key;

      insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
      select id, status, status, 'system', null, jsonb_build_object(
        'duplicate_capture_attempt', true,
        'existing_provider_ref', v_payment.provider_ref,
        'new_provider_ref', p_provider_ref,
        'new_amount_kobo', p_amount_kobo
      )
      from orders where id = p_order_id;
    end if;

    select * into v_order from orders where id = p_order_id;
    return v_order;
  end if;

  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'capture_payment: order % does not exist', p_order_id;
  end if;

  -- Detectability check (this migration's fix) — never trust that the
  -- amount Monnify says was paid equals what this order actually costs.
  -- The webhook handler already re-verifies against Monnify's API rather
  -- than the webhook body (lib/monnify.ts's verifyTransaction), but that
  -- only proves Monnify's own number is genuine, not that it matches this
  -- order's total_kobo.
  v_amount_mismatch := p_amount_kobo <> v_order.total_kobo;
  if v_amount_mismatch then
    raise warning 'capture_payment: paid amount % kobo does not match order %''s total of % kobo (idempotency_key=%)',
      p_amount_kobo, p_order_id, v_order.total_kobo, p_idempotency_key;
  end if;

  update payments
  set status = 'success', channel = p_channel, raw = p_raw, provider_ref = p_provider_ref
  where id = v_payment.id;

  select id into v_gateway_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'gateway';
  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';

  if v_gateway_account_id is null or v_escrow_account_id is null then
    raise exception 'capture_payment: platform gateway/escrow accounts are not seeded';
  end if;

  insert into transactions (kind, reference, order_id, description)
  values ('payment_capture', p_idempotency_key, p_order_id, 'Payment captured via ' || p_provider)
  returning id into v_transaction_id;

  -- Ledger entries reflect the amount actually paid (p_amount_kobo) —
  -- money already moved at that amount; the order's own total_kobo is
  -- unaffected, and the mismatch (if any) is recorded on order_events
  -- below rather than silently reconciled here.
  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_gateway_account_id, 'debit', p_amount_kobo, 'payment_capture', p_order_id),
    (v_transaction_id, v_escrow_account_id, 'credit', p_amount_kobo, 'payment_capture', p_order_id);

  update orders set payment_status = 'paid', payment_method = p_channel where id = p_order_id;

  -- draft -> placed only happens once payment is confirmed (§12), not at
  -- placement time — reusing transition_order() rather than duplicating
  -- its row-lock/allowed-transition/order_events logic. amount_mismatch/
  -- paid_amount_kobo/expected_total_kobo ride along in the event's meta —
  -- this migration's fix.
  return transition_order(p_order_id, 'placed', 'system', null, jsonb_build_object(
    'provider', p_provider,
    'provider_ref', p_provider_ref,
    'amount_mismatch', v_amount_mismatch,
    'paid_amount_kobo', p_amount_kobo,
    'expected_total_kobo', v_order.total_kobo
  ));
end;
$$;

comment on function capture_payment(uuid, text, text, bigint, jsonb, text, text) is
  'Called only from the Monnify webhook handler via the service-role client. Never grant to authenticated — see file header. Flags a paid-amount/order-total mismatch on the resulting order_events row, and a same-idempotency-key/different-provider_ref duplicate capture attempt on its own order_events row — see 0017_fix_capture_payment_amount_mismatch.sql.';

revoke execute on function capture_payment(uuid, text, text, bigint, jsonb, text, text) from public, authenticated;
grant execute on function capture_payment(uuid, text, text, bigint, jsonb, text, text) to service_role;
