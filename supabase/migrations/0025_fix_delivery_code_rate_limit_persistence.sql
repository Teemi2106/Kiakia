-- KiaKia — fix: the delivery-code rate limit added in
-- 0022_delivery_code_off_orders.sql (SHOULD-FIX 7) never actually worked.
--
-- Found by directly executing this repo's full migration set and pgTAP
-- suite against a real local Postgres 17 + PostGIS instance for the first
-- time (previously never run end-to-end — no Docker in prior environments).
-- 43 of 44 real assertions passed; this is the one genuine functional bug
-- that surfaced, as opposed to two unrelated test-fixture bugs (fixed
-- separately, not touched here).
--
-- THE BUG — verify_delivery_and_release_escrow(), on an incorrect delivery
-- code, used to do:
--
--   insert into order_events (..., meta) values (..., jsonb_build_object('delivery_code_failed', true));
--   raise exception 'verify_delivery_and_release_escrow: incorrect delivery code';
--
-- That insert can never persist. When a RAISE EXCEPTION unwinds — whether
-- it's caught by the CALLER's own exception handler (a plpgsql `exception
-- when` block runs under an implicit savepoint that gets rolled back to) or
-- left completely uncaught, which is what happens on a real PostgREST/
-- Supabase RPC call (each HTTP request is one implicit transaction with
-- nothing wrapping it, so an uncaught raise aborts that ENTIRE transaction)
-- — every statement executed since the last commit is undone, including
-- this insert, which ran only moments earlier in the SAME function
-- invocation. Proven by direct execution: 5 wrong-code attempts through a
-- caller that catches each exception (exactly how a rider-app retry loop
-- would behave), then a 6th attempt with the CORRECT code, sailed straight
-- through to the escrow-amount check instead of hitting the rate limit —
-- zero of the 5 failed-attempt rows had actually persisted.
--
-- Practical impact: the rate limit that exists specifically to stop the
-- assigned rider — 0022's own header names them "exactly the adversary this
-- code exists to stop" — from brute-forcing the 4-digit code was completely
-- inert in production. Unlimited guesses, always, no matter how many wrong
-- attempts happened.
--
-- THE FIX (chosen over a dblink autonomous-transaction workaround): redesign
-- the wrong-code path to not raise an exception at all, so this function's
-- own transaction commits normally — taking the failed-attempt insert with
-- it — regardless of what the caller does afterward.
--
-- Considered and rejected: dblink_exec() for a true autonomous transaction.
-- It would work — Supabase's hosted Postgres does ship dblink and it's a
-- documented pattern there for exactly this "must survive the caller's
-- rollback" audit-log case — but it was rejected here because (a) it adds a
-- second physical libpq connection on every wrong guess, i.e. real latency
-- and connection-limit pressure concentrated on exactly the hot path an
-- attacker is hammering; (b) the "loopback auth just works because it's the
-- same instance" assumption is untestable from this environment (no live
-- Supabase project, no Docker) against Supabase's actual pooled topology
-- (Supavisor/PgBouncer in front of the primary) — shipping an unverified
-- assumption into a security-hardening migration is exactly the kind of
-- thing this round of fixes exists to stop doing; and (c) it doesn't fix
-- the more basic problem, which is that "wrong code, otherwise a legitimate
-- attempt" was never actually exceptional to begin with — it's an expected,
-- frequent outcome of ordinary use (a rider fat-fingering 4 digits), not a
-- precondition failure like "wrong rider" or "order not paid". Modeling it
-- as a normal return value fixes the persistence bug and is the more honest
-- data model for what's actually happening.
--
-- NEW CONTRACT — breaking change to this function's return shape. No caller
-- exists in this repo today (verify_delivery_and_release_escrow is called
-- by the rider app, which per README's Phase 0 note lives outside this
-- repo); packages/db/src/generated.ts is updated in the same round to match.
--
--   returns delivery_verification_result — (code_matched boolean, order_row orders)
--
--   * Wrong rider, wrong status, unpaid, no code exists, escrow doesn't hold
--     exactly total_kobo, rate limit already exceeded — ALL UNCHANGED, still
--     raise. These remain genuinely exceptional preconditions; none of them
--     need a row to survive the exception, they just need to stop the call
--     cold before anything is attempted.
--   * Wrong code, otherwise a legitimate attempt — NO LONGER RAISES. Records
--     the failed attempt on order_events exactly as before (now durable,
--     since nothing downstream can roll it back within this same call), and
--     returns (code_matched = false, order_row = the order UNCHANGED, still
--     'arrived'). The caller MUST check code_matched explicitly — Postgres
--     no longer signals this case as an error at all.
--   * Rate limit exceeded (5th+ wrong guess) — STILL raises. Once the limit
--     is hit there is nothing further to log (the 5 attempts that mattered
--     already persisted), so this stays a hard stop like the other
--     precondition checks, not a per-guess outcome.
--   * Correct code — unchanged behavior underneath (escrow released, order
--     transitioned to 'delivered' via transition_order()), now wrapped as
--     (code_matched = true, order_row = the delivered order).
--   * Idempotent retry (already released, same "<order.code>-escrow"
--     reference) — unchanged early-return behavior, now wrapped as
--     (code_matched = true, order_row = the already-delivered order).
--
-- Nothing else in this function changes: the actor-authorization check, the
-- idempotency-first ordering, the escrow-held re-derivation (BLOCKING 2),
-- the payout-split math, and the KYC/status/payment checks are all
-- independently verified correct by direct execution already and are
-- reproduced here byte-for-byte except where the return type forces a
-- different final statement shape.

create type delivery_verification_result as (
  code_matched  boolean,
  order_row     orders
);

comment on type delivery_verification_result is
  'Return type for verify_delivery_and_release_escrow() (0025_fix_delivery_code_rate_limit_persistence.sql). code_matched=false is a normal, non-exceptional outcome (the rider mistyped the 4-digit code) — order_row is unchanged in that case, still ''arrived''. Everything that is still exceptional (wrong rider, wrong status, unpaid, no code, escrow mismatch, rate limit exceeded) still raises, unchanged from 0022/0020.';

-- Return-type changes are not `create or replace`-able — must drop first.
drop function verify_delivery_and_release_escrow(uuid, text);

create function verify_delivery_and_release_escrow(
  p_order_id      uuid,
  p_delivery_code text
)
returns delivery_verification_result
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
  v_stored_code         text;
  v_failed_attempts     integer;
  v_escrow_held_kobo    bigint;
  v_result              delivery_verification_result;
begin
  -- 1. Lock the row — unchanged from 0020/0022.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- 2. Only the assigned rider may do this — unchanged. A wrong actor is a
  --    genuinely exceptional precondition, not a per-guess outcome.
  if auth.uid() is null or v_order.rider_id is null or auth.uid() is distinct from v_order.rider_id then
    raise exception 'verify_delivery_and_release_escrow: actor is not the assigned rider on order %', p_order_id;
  end if;

  v_reference := v_order.code || '-escrow';

  -- 3. Idempotency FIRST — unchanged from 0020/0022, see that migration's
  --    own comment for why this must stay ahead of the status/code checks
  --    below. Wrapped in the new result type: an already-released order
  --    matched its code the first time, by definition.
  if exists (select 1 from transactions where reference = v_reference) then
    select * into v_order from orders where id = p_order_id;
    v_result.code_matched := true;
    v_result.order_row := v_order;
    return v_result;
  end if;

  -- 4. Must be 'arrived' — unchanged.
  if v_order.status <> 'arrived' then
    raise exception 'verify_delivery_and_release_escrow: order is not yet marked arrived (status=%)', v_order.status;
  end if;

  -- SHOULD-FIX 5 (0022) — unchanged.
  if v_order.payment_status <> 'paid' then
    raise exception 'verify_delivery_and_release_escrow: order % payment_status is not paid (status=%)',
      p_order_id, v_order.payment_status;
  end if;

  -- SHOULD-FIX 7 (0022) — counting logic unchanged. What changes in THIS
  -- migration is only that the count this reads is now actually reliable,
  -- because the insert that feeds it (below) can no longer be rolled back
  -- by a raise later in the same call.
  select count(*) into v_failed_attempts
  from order_events
  where order_id = p_order_id
    and (meta ->> 'delivery_code_failed')::boolean is true
    and at >= v_order.arrived_at;

  if v_failed_attempts >= 5 then
    -- Still a hard raise — see this migration's header ("NEW CONTRACT").
    -- Once the limit is hit there's nothing further to log, so this stays a
    -- stop-the-call-cold precondition like the checks above it.
    raise exception 'verify_delivery_and_release_escrow: too many incorrect delivery-code attempts for order %', p_order_id;
  end if;

  -- SHOULD-FIX 6 (0022) — unchanged.
  select code into v_stored_code from order_delivery_codes where order_id = p_order_id;
  if v_stored_code is null then
    raise exception 'verify_delivery_and_release_escrow: no delivery code exists for order %', p_order_id;
  end if;

  -- 5. The code itself. THIS is what this migration changes — see the
  -- header's "THE FIX" / "NEW CONTRACT" for the full reasoning. A wrong
  -- guess is recorded on order_events exactly as before, but the function
  -- now returns normally afterward instead of raising, so this transaction
  -- commits and the insert actually survives. The bug this migration fixes
  -- was that a raise immediately after this insert, in the SAME
  -- transaction, undid it every single time. The caller must check
  -- `code_matched` on the returned row; false is the expected, frequent
  -- "rider mistyped the 4 digits" outcome, not an error.
  if p_delivery_code is distinct from v_stored_code then
    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (p_order_id, v_order.status, v_order.status, 'rider', auth.uid(), jsonb_build_object('delivery_code_failed', true));

    v_result.code_matched := false;
    v_result.order_row := v_order;
    return v_result;
  end if;

  select * into v_vendor from vendors where id = v_order.vendor_id;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: vendor % does not exist', v_order.vendor_id;
  end if;

  -- Platform escrow — pre-seeded in 0010_capture_payment.sql. Unchanged.
  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';
  if v_escrow_account_id is null then
    raise exception 'verify_delivery_and_release_escrow: platform escrow account is not seeded';
  end if;

  -- BLOCKING 2 (0022) — unchanged. Re-derive what escrow actually holds and
  -- refuse to release rather than trusting total_kobo unconditionally.
  select coalesce(sum(amount_kobo), 0) into v_escrow_held_kobo
  from ledger_entries
  where order_id = p_order_id
    and account_id = v_escrow_account_id
    and direction = 'credit'
    and entry_type = 'payment_capture';

  if v_escrow_held_kobo <> v_order.total_kobo then
    raise exception 'verify_delivery_and_release_escrow: escrow for order % holds % kobo but total_kobo is % — refusing to release',
      p_order_id, v_escrow_held_kobo, v_order.total_kobo;
  end if;

  -- The payout split — unchanged from 0020/0022 (independently reviewed and
  -- confirmed exact by direct execution). v_platform_kobo is deliberately
  -- the residual; see 0020's own comment for the full reasoning.
  v_commission_kobo := round(v_order.subtotal_kobo * v_vendor.commission_bps / 10000.0)::bigint;
  v_vendor_kobo := v_order.subtotal_kobo - v_commission_kobo;
  v_rider_kobo := v_order.delivery_fee_kobo;
  v_platform_kobo := v_order.total_kobo - v_vendor_kobo - v_rider_kobo;

  if v_vendor_kobo < 0 or v_rider_kobo < 0 or v_platform_kobo < 0 then
    raise exception 'verify_delivery_and_release_escrow: computed a negative payout share for order % (vendor=%, rider=%, platform=%) — refusing to release',
      p_order_id, v_vendor_kobo, v_rider_kobo, v_platform_kobo;
  end if;

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

  select id into v_revenue_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'revenue';
  if v_revenue_account_id is null then
    raise exception 'verify_delivery_and_release_escrow: platform revenue account is not seeded';
  end if;

  insert into transactions (kind, reference, order_id, description)
  values ('escrow_release', v_reference, p_order_id, 'Escrow released on delivery-code verification')
  returning id into v_transaction_id;

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

  v_order := transition_order(p_order_id, 'delivered', 'rider', auth.uid(), jsonb_build_object('delivery_code_verified', true));
  v_result.code_matched := true;
  v_result.order_row := v_order;
  return v_result;
end;
$$;

comment on function verify_delivery_and_release_escrow(uuid, text) is
  'The only writer of escrow_release ledger entries and the only path from arrived to delivered. Only the assigned rider may call it; idempotent on retry via the "<order.code>-escrow" transactions.reference anchor. Reads the delivery code from order_delivery_codes (0022), refuses to release unless escrow actually holds exactly total_kobo (0022 BLOCKING 2), requires payment_status=paid (0022 SHOULD-FIX 5), and rate-limits failed attempts to 5 per arrived_at window (0022 SHOULD-FIX 7, made actually effective by 0025 — the counting insert used to be lost to the wrong-code exception''s own rollback). Returns delivery_verification_result (code_matched, order_row): a wrong code is a NORMAL non-raising result as of 0025, not an exception — see that migration''s header for the full contract change. See 0020_verify_delivery_and_release_escrow.sql for the payout-split reasoning and 0022_delivery_code_off_orders.sql for everything added on top of that.';

revoke execute on function verify_delivery_and_release_escrow(uuid, text) from public;
grant execute on function verify_delivery_and_release_escrow(uuid, text) to authenticated;
