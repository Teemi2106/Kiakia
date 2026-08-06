-- KiaKia — capture_payment(): the only writer of a payment's 'success'
-- transition and the ledger entries that come with it. Called exclusively
-- by the Monnify webhook Route Handler, using the service-role client —
-- `grant execute` below is to `service_role` only, deliberately NOT
-- `authenticated`, since a customer must never be able to fabricate
-- "my payment succeeded".
--
-- Reproduces §9's worked "Payment captured" ledger row exactly: one
-- transaction, two ledger_entries (DR platform:gateway / CR
-- platform:escrow). Escrow *release* (the vendor/rider split at delivery)
-- is Phase 4 — no rider exists yet to release to — and isn't built here,
-- same boundary Phase 0 already drew.

-- The two platform accounts this needs to exist, seeded once here (not
-- supabase/seed.sql — production needs these too, they're not dev-only
-- fixtures). Idempotent via the accounts table's own unique constraint.
insert into accounts (owner_type, owner_id, kind)
values
  ('platform', null, 'gateway'),
  ('platform', null, 'escrow')
on conflict (owner_type, owner_id, kind) do nothing;

create or replace function capture_payment(
  p_order_id        uuid,
  p_provider        text,
  p_provider_ref    text,
  p_amount_kobo     bigint,
  p_raw             jsonb,
  p_idempotency_key text,
  -- Already mapped to our 'card'/'bank_transfer'/'ussd'/null by the caller
  -- — Monnify's own channel names differ. Defaulted (and last) so it can
  -- be omitted; every other param is mandatory.
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
begin
  select * into v_payment from payments where idempotency_key = p_idempotency_key for update;
  if not found then
    raise exception 'capture_payment: no payment row found for idempotency_key % — placeOrderAction should have inserted one at checkout time', p_idempotency_key;
  end if;

  if v_payment.status = 'success' then
    -- Idempotent: a duplicate webhook delivery (§6.3) is a no-op, not a
    -- second capture.
    select * into v_order from orders where id = p_order_id;
    return v_order;
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

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_gateway_account_id, 'debit', p_amount_kobo, 'payment_capture', p_order_id),
    (v_transaction_id, v_escrow_account_id, 'credit', p_amount_kobo, 'payment_capture', p_order_id);

  update orders set payment_status = 'paid', payment_method = p_channel where id = p_order_id;

  -- draft -> placed only happens once payment is confirmed (§12), not at
  -- placement time — reusing transition_order() rather than duplicating
  -- its row-lock/allowed-transition/order_events logic.
  return transition_order(p_order_id, 'placed', 'system', null, jsonb_build_object('provider', p_provider, 'provider_ref', p_provider_ref));
end;
$$;

comment on function capture_payment(uuid, text, text, bigint, jsonb, text, text) is
  'Called only from the Monnify webhook handler via the service-role client. Never grant to authenticated — see file header.';

revoke execute on function capture_payment(uuid, text, text, bigint, jsonb, text, text) from public, authenticated;
grant execute on function capture_payment(uuid, text, text, bigint, jsonb, text, text) to service_role;
