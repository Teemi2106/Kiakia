-- KiaKia — Phase 3/4 build-out, part 2/3: delivery-code verification and
-- the escrow release (the 3-way vendor/rider/platform payout split) it
-- triggers. verify_delivery_and_release_escrow() is the only writer of
-- these ledger entries and the only path that moves an order from
-- 'arrived' to 'delivered'.

-- The platform's revenue account is not pre-seeded anywhere (unlike
-- gateway/escrow, seeded in 0010_capture_payment.sql) — this is the first
-- migration that ever needs it. Seeded here for the same reason
-- gateway/escrow are seeded in 0010: production needs it too, not just
-- local dev, so supabase/seed.sql is the wrong place. Idempotent via
-- accounts' own unique constraint.
--
-- NOTE for a future pass: gateway/escrow/revenue being seeded in two
-- different migrations (0010 and here) rather than all three together is a
-- direct consequence of Phase 0/4 not existing at the same time — worth
-- consolidating into one seeding statement next time any of these three
-- migrations is touched, but not rewritten here per this round's "don't
-- touch what's already reviewed" constraint.
insert into accounts (owner_type, owner_id, kind)
values ('platform', null, 'revenue')
on conflict (owner_type, owner_id, kind) do nothing;

create or replace function verify_delivery_and_release_escrow(
  p_order_id      uuid,
  p_delivery_code text
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order               orders;
  v_vendor              vendors;
  v_commission_kobo     bigint;
  v_vendor_kobo         bigint;
  v_rider_kobo          bigint;
  v_platform_kobo       bigint;
  v_vendor_account_id   uuid;
  v_rider_account_id    uuid;
  v_escrow_account_id   uuid;
  v_revenue_account_id  uuid;
  v_transaction_id      uuid;
  v_reference           text;
begin
  -- 1. Lock the row — same reasoning as transition_order()'s own first step.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- 2. Only the assigned rider may do this.
  if auth.uid() is null or v_order.rider_id is null or auth.uid() is distinct from v_order.rider_id then
    raise exception 'verify_delivery_and_release_escrow: actor is not the assigned rider on order %', p_order_id;
  end if;

  v_reference := v_order.code || '-escrow';

  -- 3. Idempotency FIRST, before the status/code checks below — deliberately
  --    reordered from a literal reading of "verify status, verify code,
  --    then check idempotency": by the time a retried call arrives, the
  --    first (successful) call has already moved the order to 'delivered',
  --    so a status check ahead of the idempotency check would reject the
  --    retry with "not yet arrived" instead of treating it as the no-op it
  --    actually is. Checking transactions.reference first makes this
  --    correctly idempotent regardless of what orders.status already is by
  --    the time the retry lands.
  if exists (select 1 from transactions where reference = v_reference) then
    select * into v_order from orders where id = p_order_id;
    return v_order;
  end if;

  -- 4. Must be 'arrived' — don't silently allow verifying from an earlier
  --    status.
  if v_order.status <> 'arrived' then
    raise exception 'verify_delivery_and_release_escrow: order is not yet marked arrived (status=%)', v_order.status;
  end if;

  -- 5. The code itself. Never reveal the correct code in the error, and no
  --    attempt-count lockout at the DB level — that's an app-level concern
  --    for later.
  if p_delivery_code is distinct from v_order.delivery_code then
    raise exception 'verify_delivery_and_release_escrow: incorrect delivery code';
  end if;

  select * into v_vendor from vendors where id = v_order.vendor_id;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: vendor % does not exist', v_order.vendor_id;
  end if;

  -- The payout split. v_platform_kobo is DELIBERATELY the residual
  -- (total_kobo - vendor - rider), not commission_kobo + service_fee_kobo
  -- computed independently. Reasoning, preserved from the spec: total_kobo
  -- = subtotal_kobo + delivery_fee_kobo + service_fee_kobo - discount_kobo
  -- (orders_total_is_consistent, 0004_ordering.sql), so
  -- subtotal + delivery_fee + service_fee can exceed total_kobo whenever
  -- discount_kobo > 0 — and the escrow account only ever holds total_kobo
  -- per order (that's what capture_payment credited it with). If vendor and
  -- rider each take their full share independently and the platform ALSO
  -- takes commission + service_fee independently, the three shares would
  -- sum to more than what's actually in escrow whenever there's a discount,
  -- releasing money that was never captured. Computing the platform's share
  -- as the residual guarantees vendor + rider + platform = total_kobo
  -- exactly, by construction, no matter what discount_kobo is (currently
  -- always 0 — there is no promo-code redemption flow yet — but this stays
  -- safe if that changes later).
  v_commission_kobo := round(v_order.subtotal_kobo * v_vendor.commission_bps / 10000.0)::bigint;
  v_vendor_kobo := v_order.subtotal_kobo - v_commission_kobo;
  v_rider_kobo := v_order.delivery_fee_kobo;
  v_platform_kobo := v_order.total_kobo - v_vendor_kobo - v_rider_kobo;

  -- Should be unreachable given commission_bps between 0 and 10000
  -- (0003_catalog.sql) and the total_kobo check constraint, but a negative
  -- ledger credit must never silently happen.
  if v_vendor_kobo < 0 or v_rider_kobo < 0 or v_platform_kobo < 0 then
    raise exception 'verify_delivery_and_release_escrow: computed a negative payout share for order % (vendor=%, rider=%, platform=%) — refusing to release',
      p_order_id, v_vendor_kobo, v_rider_kobo, v_platform_kobo;
  end if;

  -- Get-or-create the vendor's and rider's `available` accounts — unlike
  -- gateway/escrow/revenue (platform-wide, pre-seeded), these are per-owner
  -- and this is the first place either is ever needed. Re-select after a
  -- no-op ON CONFLICT insert to cover the race where two concurrent releases
  -- for the same vendor/rider both attempt to create the account at once —
  -- the row-level lock on `orders` above prevents that for the SAME order,
  -- but not across two different orders for the same vendor/rider.
  select id into v_vendor_account_id from accounts where owner_type = 'vendor' and owner_id = v_order.vendor_id and kind = 'available';
  if v_vendor_account_id is null then
    insert into accounts (owner_type, owner_id, kind) values ('vendor', v_order.vendor_id, 'available')
    on conflict (owner_type, owner_id, kind) do nothing;
    select id into v_vendor_account_id from accounts where owner_type = 'vendor' and owner_id = v_order.vendor_id and kind = 'available';
  end if;

  select id into v_rider_account_id from accounts where owner_type = 'rider' and owner_id = v_order.rider_id and kind = 'available';
  if v_rider_account_id is null then
    insert into accounts (owner_type, owner_id, kind) values ('rider', v_order.rider_id, 'available')
    on conflict (owner_type, owner_id, kind) do nothing;
    select id into v_rider_account_id from accounts where owner_type = 'rider' and owner_id = v_order.rider_id and kind = 'available';
  end if;

  -- Platform escrow — pre-seeded in 0010_capture_payment.sql, same lookup
  -- that function already does; raise if missing, same as it does.
  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';
  if v_escrow_account_id is null then
    raise exception 'verify_delivery_and_release_escrow: platform escrow account is not seeded';
  end if;

  -- Platform revenue — seeded at the top of this migration (was not
  -- previously seeded anywhere, unlike gateway/escrow).
  select id into v_revenue_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'revenue';
  if v_revenue_account_id is null then
    raise exception 'verify_delivery_and_release_escrow: platform revenue account is not seeded';
  end if;

  insert into transactions (kind, reference, order_id, description)
  values ('escrow_release', v_reference, p_order_id, 'Escrow released on delivery-code verification')
  returning id into v_transaction_id;

  -- One debit (escrow, the full amount that was actually captured for this
  -- order) and up to three credits. Credits with a zero amount are
  -- deliberately skipped rather than inserted, because ledger_entries.
  -- amount_kobo has a `> 0` check constraint (0005_ledger.sql) — a
  -- legitimately free-delivery order (service_areas.free_above_kobo) makes
  -- v_rider_kobo exactly 0, which would otherwise violate that constraint
  -- and make this function unusable for a free-delivery order. Omitting a
  -- zero-amount row does not break the "debits = credits = total_kobo"
  -- invariant: v_platform_kobo is computed as the residual specifically so
  -- vendor + rider + platform always sums to total_kobo regardless of which
  -- of the three (if any) happens to be zero.
  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values (v_transaction_id, v_escrow_account_id, 'debit', v_order.total_kobo, 'escrow_release', p_order_id);

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_vendor_account_id, 'credit', v_vendor_kobo, 'escrow_release', p_order_id
  where v_vendor_kobo > 0;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_rider_account_id, 'credit', v_rider_kobo, 'escrow_release', p_order_id
  where v_rider_kobo > 0;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_revenue_account_id, 'credit', v_platform_kobo, 'escrow_release', p_order_id
  where v_platform_kobo > 0;

  -- arrived -> delivered legitimately reuses transition_order() here —
  -- unlike accept_dispatch_offer()'s edge, by this point
  -- auth.uid() = v_order.rider_id genuinely holds (rider was already
  -- assigned earlier) and 'delivered' is already in the rider's allowed
  -- list (0018_fix_transition_order_edge_restrictions.sql).
  return transition_order(p_order_id, 'delivered', 'rider', auth.uid(), jsonb_build_object('delivery_code_verified', true));
end;
$$;

comment on function verify_delivery_and_release_escrow(uuid, text) is
  'The only writer of escrow_release ledger entries and the only path from arrived to delivered. Only the assigned rider may call it; idempotent on retry via the "<order.code>-escrow" transactions.reference anchor. See file header for the payout-split reasoning.';

revoke execute on function verify_delivery_and_release_escrow(uuid, text) from public;
grant execute on function verify_delivery_and_release_escrow(uuid, text) to authenticated;
