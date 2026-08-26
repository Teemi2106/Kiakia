-- KiaKia — independent audit finding: the escrow-split math, the
-- double-entry ledger invariant, and the Monnify webhook trust boundary are
-- all confirmed correct (untouched by this migration). But there is no way
-- to ever get money back OUT of escrow except a successful delivery:
--
-- (a) NO REFUND/UNWIND PATH EXISTS AT ALL. capture_payment() (0010, amount-
--     mismatch handling superseded by 0017) debits platform:gateway and
--     credits platform:escrow. verify_delivery_and_release_escrow() (0020,
--     hardened by 0022/0025/0030) is the ONLY thing that ever debits escrow.
--     If an order is captured and then cancelled — or simply abandoned
--     before delivery — the customer's money sits in escrow forever, with
--     no `refund`/`reversal` ledger entries and no RPC to produce them.
--
-- (b) THE DELIVERY-CODE LOCKOUT IS PERMANENT AND UNRECOVERABLE. 0022/0025's
--     rate limit counts failed-attempt order_events rows with
--     at >= orders.arrived_at; once 5 accumulate,
--     verify_delivery_and_release_escrow() refuses every future call for
--     that order, forever (order_events is append-only, so nothing before
--     this migration could ever reduce that count back down). That order
--     can never reach 'delivered' and its escrow is stranded permanently —
--     no admin override, no reset.
--
-- This migration adds exactly two RPCs to close both gaps, plus the
-- narrowest possible change to verify_delivery_and_release_escrow() needed
-- to make (2) actually take effect. Everything else already reviewed
-- correct (the payout split, the escrow-held re-derivation, the delivery-
-- code check itself) is reproduced byte-for-byte, unchanged.
--
-- Both new RPCs mirror 0021_admin_vendor_approval.sql's admin authorization
-- predicate EXACTLY — service_role callers only, with a real admin/
-- superadmin user_roles row for the caller-supplied p_actor_id. Never
-- granted to `authenticated`; called only from an admin Server Action via
-- createAdminClient(), after that action's own requireAdminContext() check.

-- ---------------------------------------------------------------------------
-- 1. refund_order_escrow(p_order_id, p_actor_id, p_reason)
-- ---------------------------------------------------------------------------
--
-- Reverses capture_payment()'s ledger entries: capture_payment DEBITS
-- platform:gateway and CREDITS platform:escrow (money arriving from the
-- customer, held by the platform pending delivery — see 0010's own header,
-- "Reproduces §9's worked 'Payment captured' ledger row exactly: one
-- transaction, two ledger_entries (DR platform:gateway / CR
-- platform:escrow)"). A refund is the exact mirror: DEBIT platform:escrow,
-- CREDIT platform:gateway — money leaving the platform's custody back
-- toward the payment provider. (The actual money movement at Monnify is a
-- separate, out-of-band operational step — e.g. a manual Monnify refund
-- initiated by ops — this RPC only records the ledger truth that the
-- platform no longer holds this order's funds in escrow.)
--
-- Idempotent via a "<order.code>-refund" transactions.reference anchor,
-- the same technique 0020/0025 use for release (their anchor is
-- "<order.code>-escrow" — deliberately a different suffix here so the two
-- can never collide and so "has this order been released" and "has this
-- order been refunded" remain independently checkable).
--
-- THE SINGLE MOST IMPORTANT GUARD: refuses outright if a
-- "<order.code>-escrow" transactions row already exists (i.e. escrow has
-- already been released to vendor/rider/platform). Releasing AND refunding
-- the same order would pay the platform out twice for money it no longer
-- holds — this function must never let that happen.
--
-- The refunded amount is derived from the ledger itself (the sum of
-- payment_capture credits to platform:escrow for this order), never from
-- v_order.total_kobo and never from a caller-supplied amount — total_kobo
-- and what was actually captured can diverge (0017's amount-mismatch
-- tolerance, the same reason 0022 BLOCKING 2 re-derives the escrow-held
-- amount before release rather than trusting total_kobo). Refunding
-- anything other than what escrow actually holds for this order would
-- either under-refund the customer or imbalance the ledger.
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
  v_order              orders;
  -- Same NULL-safe role check as 0021/0030's admin branches — auth.role()
  -- returns NULL for a direct (non-PostgREST) service-role session;
  -- current_setting is the non-null fallback, `is distinct from` treats NULL
  -- as a real mismatch rather than failing open.
  v_caller_role        text := coalesce(auth.role(), current_setting('role', true));
  v_refund_reference    text;
  v_release_reference   text;
  v_gateway_account_id  uuid;
  v_escrow_account_id   uuid;
  v_transaction_id      uuid;
  v_captured_kobo       bigint;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'refund_order_escrow: requires the service-role key';
  end if;

  if p_actor_id is null or not exists (
    select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
  ) then
    raise exception 'refund_order_escrow: actor % is not an admin', p_actor_id;
  end if;

  -- Lock the row — same reasoning as transition_order()'s own first step,
  -- and what makes this serialize correctly against a concurrent
  -- verify_delivery_and_release_escrow() call racing to release the same
  -- order's escrow (both functions take this same row lock first).
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'refund_order_escrow: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_refund_reference := v_order.code || '-refund';
  v_release_reference := v_order.code || '-escrow';

  -- Idempotent: a retried call (e.g. a double-submitted admin action) is a
  -- no-op, not a second refund credit.
  if exists (select 1 from transactions where reference = v_refund_reference) then
    select * into v_order from orders where id = p_order_id;
    return v_order;
  end if;

  -- THE guard: refuse outright if escrow has already been released.
  if exists (select 1 from transactions where reference = v_release_reference) then
    raise exception 'refund_order_escrow: order % escrow has already been released to vendor/rider/platform — refusing to refund and pay out twice', p_order_id
      using errcode = 'check_violation';
  end if;

  select id into v_gateway_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'gateway';
  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';

  if v_gateway_account_id is null or v_escrow_account_id is null then
    raise exception 'refund_order_escrow: platform gateway/escrow accounts are not seeded';
  end if;

  -- Derive the captured amount from the ledger itself — never total_kobo,
  -- never caller-supplied. See file header.
  select coalesce(sum(amount_kobo), 0) into v_captured_kobo
  from ledger_entries
  where order_id = p_order_id
    and account_id = v_escrow_account_id
    and direction = 'credit'
    and entry_type = 'payment_capture';

  if v_captured_kobo = 0 then
    raise exception 'refund_order_escrow: order % has no captured payment held in escrow to refund (payment_status=%)', p_order_id, v_order.payment_status
      using errcode = 'check_violation';
  end if;

  insert into transactions (kind, reference, order_id, description)
  values ('refund', v_refund_reference, p_order_id, coalesce('Escrow refunded: ' || p_reason, 'Escrow refunded'))
  returning id into v_transaction_id;

  -- Exact mirror of capture_payment's two entries, reversed: DR escrow,
  -- CR gateway.
  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_escrow_account_id, 'debit', v_captured_kobo, 'refund', p_order_id),
    (v_transaction_id, v_gateway_account_id, 'credit', v_captured_kobo, 'refund', p_order_id);

  update orders set payment_status = 'refunded' where id = p_order_id;

  -- Move the order to a terminal state if the state machine allows an edge
  -- from wherever it currently sits — never invent one. 'cancelled_by_platform'
  -- is a legal edge from every active pre-delivery status (placed, accepted,
  -- preparing, ready_for_pickup, rider_assigned, picked_up, in_transit,
  -- arrived — see order_status_transitions, 0006_transition_order.sql). An
  -- order already sitting in a terminal status (rejected_by_vendor,
  -- cancelled_by_customer, cancelled_by_platform, failed_delivery — exactly
  -- the money-stranding scenario this migration exists to fix: captured then
  -- cancelled, with no ledger reversal ever having happened) has no outbound
  -- edge in that table at all, and 'delivered' is unreachable here anyway
  -- (the guard above already refused any order whose escrow was released,
  -- and 0030 guarantees 'delivered' implies released escrow) — for all of
  -- those, this function does not force a status change, it only reverses
  -- the ledger and records the refund on order_events directly.
  if exists (
    select 1 from order_status_transitions
    where from_status = v_order.status and to_status = 'cancelled_by_platform'
  ) then
    v_order := transition_order(
      p_order_id, 'cancelled_by_platform', 'admin', p_actor_id,
      jsonb_build_object('reason', p_reason, 'refund_transaction', v_refund_reference)
    );
  else
    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (
      p_order_id, v_order.status, v_order.status, 'admin', p_actor_id,
      jsonb_build_object('reason', p_reason, 'refund_transaction', v_refund_reference, 'escrow_refunded', true)
    );
    select * into v_order from orders where id = p_order_id;
  end if;

  return v_order;
end;
$$;

comment on function refund_order_escrow(uuid, uuid, text) is
  'Reverses capture_payment()''s ledger entries (DR platform:escrow / CR platform:gateway) for an order whose escrow has NOT yet been released — refuses outright if a "<order.code>-escrow" transactions row already exists (the single most important guard: never pay out AND refund the same order). Idempotent via "<order.code>-refund". Refunds exactly what the ledger shows was captured, not total_kobo. Moves the order to cancelled_by_platform if a legal edge exists from its current status; otherwise records the refund on order_events without inventing a status transition. service_role callers only, with a real admin/superadmin user_roles row for p_actor_id — mirrors approve_vendor/reject_vendor (0021_admin_vendor_approval.sql). Never grant to authenticated.';

revoke execute on function refund_order_escrow(uuid, uuid, text) from public, authenticated;
grant execute on function refund_order_escrow(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. admin_reset_delivery_code_attempts(p_order_id, p_actor_id)
-- ---------------------------------------------------------------------------
--
-- 0022/0025's rate limit counts order_events rows where
-- (meta ->> 'delivery_code_failed')::boolean is true and
-- at >= orders.arrived_at. order_events is append-only by convention (no
-- update/delete policy for any role, including service-role callers — see
-- 0004_ordering.sql's comment on that table) — so the fix here is NOT to
-- delete or edit any existing order_events row, and NOT to mutate
-- orders.arrived_at (that timestamp is customer-visible product data — the
-- tracking page reads it — and repurposing it as a rate-limit reset knob
-- would be an abuse of a column that means something else).
--
-- Instead: this function inserts its own order_events marker row with
-- meta->>'delivery_code_attempts_reset' = true, and
-- verify_delivery_and_release_escrow() (redefined below, in this same
-- migration, via create-or-replace — same "supersede in place" convention
-- 0025/0030 already use, return type unchanged so no drop is needed) now
-- ignores any failed attempt that happened at or before the most recent such
-- reset marker, on top of the unchanged arrived_at floor. Every check in
-- that function is otherwise byte-for-byte unchanged from 0025.
create or replace function admin_reset_delivery_code_attempts(
  p_order_id uuid,
  p_actor_id uuid
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order        orders;
  v_caller_role  text := coalesce(auth.role(), current_setting('role', true));
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'admin_reset_delivery_code_attempts: requires the service-role key';
  end if;

  if p_actor_id is null or not exists (
    select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
  ) then
    raise exception 'admin_reset_delivery_code_attempts: actor % is not an admin', p_actor_id;
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'admin_reset_delivery_code_attempts: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- The rate limit only ever matters while an order is 'arrived' — that's
  -- the only status verify_delivery_and_release_escrow() will proceed past
  -- its status check for. Refuse elsewhere rather than silently writing a
  -- marker that can never do anything, which would otherwise look like a
  -- successful reset to whoever called this.
  if v_order.status <> 'arrived' then
    raise exception 'admin_reset_delivery_code_attempts: order % is not awaiting delivery-code verification (status=%)', p_order_id, v_order.status
      using errcode = 'check_violation';
  end if;

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (
    p_order_id, v_order.status, v_order.status, 'admin', p_actor_id,
    jsonb_build_object('delivery_code_attempts_reset', true)
  );

  return v_order;
end;
$$;

comment on function admin_reset_delivery_code_attempts(uuid, uuid) is
  'Clears the delivery-code failed-attempt lockout (0022/0025) for a legitimately stuck order, after a support call, WITHOUT touching order_events (append-only by convention) or orders.arrived_at (customer-visible product data). Writes an order_events marker (delivery_code_attempts_reset=true) that verify_delivery_and_release_escrow() (redefined in this same migration) now treats as the start of a fresh rate-limit window. service_role callers only, with a real admin/superadmin user_roles row for p_actor_id — mirrors approve_vendor/reject_vendor (0021_admin_vendor_approval.sql). Never grant to authenticated.';

revoke execute on function admin_reset_delivery_code_attempts(uuid, uuid) from public, authenticated;
grant execute on function admin_reset_delivery_code_attempts(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- verify_delivery_and_release_escrow() — redefined ONLY to make the reset
-- marker above actually effective. Return type (delivery_verification_result,
-- 0025) is unchanged, so `create or replace` works with no drop needed.
-- Every check, the payout-split math, the idempotency-first ordering, and
-- the escrow-held re-derivation are reproduced byte-for-byte from 0025 —
-- the ONLY change is the failed-attempts count query, which now floors its
-- window at the latest delivery_code_attempts_reset marker (if any) instead
-- of arrived_at alone.
-- ---------------------------------------------------------------------------

create or replace function verify_delivery_and_release_escrow(
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
  v_reset_marker_at     timestamptz;
  v_result              delivery_verification_result;
begin
  -- 1. Lock the row — unchanged from 0020/0022/0025.
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

  -- 3. Idempotency FIRST — unchanged from 0020/0022/0025, see 0020's own
  --    comment for why this must stay ahead of the status/code checks below.
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

  -- THIS MIGRATION's change: a failed attempt now only counts toward the
  -- rate limit if it happened strictly AFTER the most recent
  -- admin_reset_delivery_code_attempts() marker for this order (if none
  -- exists yet, this condition is trivially true via the '-infinity'
  -- fallback). The `at >= v_order.arrived_at` clause is byte-for-byte
  -- unchanged from 0022/0025 — this adds a second, independent condition
  -- rather than folding the reset marker into a single `greatest(...)`
  -- bound, deliberately: a strict `>` against the reset marker (rather than
  -- `>=`) is required because a failed attempt and a subsequent reset can
  -- share the exact same instant under a test harness that wraps an entire
  -- scenario in one transaction (`now()` is constant for the lifetime of a
  -- transaction in Postgres, i.e. transaction_timestamp() — see
  -- supabase/tests/refund_and_escrow_unwind.sql's own header note on this).
  -- In real production usage every RPC call is its own separate transaction
  -- (0025's own header: "each HTTP request is one implicit transaction"),
  -- so a failed attempt and a reset can never genuinely tie — this is
  -- purely a defensive, always-correct strictness choice, not a behavior
  -- change for any real caller.
  select max(at) into v_reset_marker_at
  from order_events
  where order_id = p_order_id
    and (meta ->> 'delivery_code_attempts_reset')::boolean is true;

  select count(*) into v_failed_attempts
  from order_events
  where order_id = p_order_id
    and (meta ->> 'delivery_code_failed')::boolean is true
    and at >= v_order.arrived_at
    and at > coalesce(v_reset_marker_at, '-infinity'::timestamptz);

  if v_failed_attempts >= 5 then
    -- Still a hard raise — see 0025's header ("NEW CONTRACT"). Once the
    -- limit is hit there's nothing further to log, so this stays a
    -- stop-the-call-cold precondition like the checks above it.
    raise exception 'verify_delivery_and_release_escrow: too many incorrect delivery-code attempts for order %', p_order_id;
  end if;

  -- SHOULD-FIX 6 (0022) — unchanged.
  select code into v_stored_code from order_delivery_codes where order_id = p_order_id;
  if v_stored_code is null then
    raise exception 'verify_delivery_and_release_escrow: no delivery code exists for order %', p_order_id;
  end if;

  -- 5. The code itself — unchanged from 0025. A wrong guess is recorded on
  -- order_events and the function returns normally (code_matched = false)
  -- rather than raising, so this insert survives regardless of what the
  -- caller does afterward (0025's own fix).
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

  -- The payout split — unchanged from 0020/0022/0025 (independently
  -- reviewed and confirmed exact by direct execution). v_platform_kobo is
  -- deliberately the residual; see 0020's own comment for the full
  -- reasoning.
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
  'The only writer of escrow_release ledger entries and the only path from arrived to delivered. Only the assigned rider may call it; idempotent on retry via the "<order.code>-escrow" transactions.reference anchor. Reads the delivery code from order_delivery_codes (0022), refuses to release unless escrow actually holds exactly total_kobo (0022 BLOCKING 2), requires payment_status=paid (0022 SHOULD-FIX 5), and rate-limits failed attempts to 5 within a window starting at the LATER of arrived_at or the most recent admin_reset_delivery_code_attempts() marker (0022 SHOULD-FIX 7, made actually effective by 0025, resettable by an admin as of 0031_refund_and_escrow_unwind.sql). Returns delivery_verification_result (code_matched, order_row): a wrong code is a NORMAL non-raising result as of 0025, not an exception. See 0020 for the payout-split reasoning, 0022/0025 for everything else, and 0031 for the reset-window change.';

revoke execute on function verify_delivery_and_release_escrow(uuid, text) from public;
grant execute on function verify_delivery_and_release_escrow(uuid, text) to authenticated;
