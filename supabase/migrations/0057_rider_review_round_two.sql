-- KiaKia - fixes from the SECOND independent security review of the
-- 0049-0056 rider KYC / push notification / earnings history / dispatch
-- offer sweep batch, returned APPROVE WITH CONDITIONS. 0049-0056 are
-- treated as already shipped and reviewed, per this repo's "never edit a
-- migration that already shipped" convention (see 0050's own convention
-- note) - every fix below is applied on top, never by editing those files.
--
-- Eight findings, in the order the reviewer raised them:
--
--   TASK 1 (condition) - the delivery-code rate-limit reset marker trusted
--     any order_events row with meta->>'delivery_code_attempts_reset', not
--     specifically one written by an admin.
--   TASK 2 (condition) - get_rider_offer_details() authorized on
--     status in ('offered', 'accepted') with no expires_at check, so an
--     'offered' row nobody ever accepts or declines grants indefinite read
--     access to the customer's dropoff details.
--   TASK 3 - sweep_dispatch_offers() (0055) is built but scheduled nowhere;
--     make a best-effort attempt to schedule it via pg_cron, degrading
--     gracefully, and state the operational requirement plainly either way.
--   TASK 4 - service_areas' column-level revoke on the rider payout-rate
--     columns was a documented no-op against a table-level grant.
--   TASK 5 - notifications was missed by 0056's anon-revoke /
--     explicit-select-grant sweep despite 0049 touching it in the same
--     round.
--   TASK 6 - register_rider_push_token()'s cross-rider token takeover
--     (0056 task 3) is unaudited.
--   TASK 7 - the four rider-kyc storage.objects policies are not
--     role-scoped, letting a non-rider authenticated account upload into
--     the bucket.
--   TASK 8 - packages/db/src/generated.ts over-declares three write models
--     (handled as a separate, non-SQL change to that file, described here
--     for completeness of the record; see that file's own inline comments
--     added alongside this migration).
--
-- Convention note: this migration touches transition_order(),
-- verify_delivery_and_release_escrow(), get_rider_offer_details(), and
-- register_rider_push_token() via `create or replace function` - each
-- reproduces its prior definition (0050, 0044, 0044, 0056 respectively)
-- byte for byte except for the one specific change called out in that
-- task's own section below. `create or replace function` does not reset a
-- function's ACL, so the existing `revoke ... from public` / `grant
-- execute ... to <role>` grants already survive unchanged - re-asserted
-- below anyway, for readability, the same way 0056 already does.

-- ---------------------------------------------------------------------------
-- TASK 1 - the reset-marker query trusted WHAT the meta key said, not WHO
-- wrote it, plus closing the write path that made that fixable-but-latent.
-- ---------------------------------------------------------------------------
--
-- verify_delivery_and_release_escrow()'s failed-attempt rate limit (0022,
-- made effective by 0025, made resettable by 0031, unchanged in shape since
-- 0044) finds the start of its counting window with:
--
--   select max(at) into v_reset_marker_at
--   from order_events
--   where order_id = p_order_id
--     and (meta ->> 'delivery_code_attempts_reset')::boolean is true;
--
-- with no filter on who wrote that row. The legitimate writer,
-- admin_reset_delivery_code_attempts() (0031), always stamps
-- actor_type = 'admin' - the reader never checked that discriminator.
--
-- Reproducing the reviewer's own exploitability analysis here rather than
-- overstating it: transition_order() (0050) inserts caller-supplied p_meta
-- into this same order_events.meta column for every actor_type, and a
-- rider actor_type may drive an order to picked_up/in_transit/arrived/
-- delivered/failed_delivery (0050's own per-actor-type allow-list). From
-- 'arrived' specifically - the only status where the rate limit actually
-- matters - the rider's only two reachable edges today are 'delivered'
-- (rejected by 0050's escrow-before-delivered guard BEFORE the
-- order_events insert even runs, so no row is ever written on that
-- attempt) and 'failed_delivery' (a row IS written, but the order becomes
-- terminal there, and verify_delivery_and_release_escrow() then refuses
-- every future call on status alone). A marker planted at any EARLIER,
-- non-terminal transition (picked_up/in_transit) is harmless too: the
-- failed-attempt count filter is `at > v_reset_marker_at AND
-- at >= v_order.arrived_at`, and an earlier marker's `at` necessarily
-- precedes arrived_at, so it excludes nothing a genuine post-arrival guess
-- would otherwise count.
--
-- So today, NOTHING actually lets a rider exploit this - not because the
-- reader checks who wrote the marker (it doesn't), but only because no
-- non-terminal, non-escrow-guarded rider-drivable edge currently exists out
-- of 'arrived'. That is an incidental property of the current state
-- machine, not a designed protection, and it is exactly the kind of
-- invariant a later, entirely reasonable product change could break
-- silently - e.g. a "rider went to the wrong address, send them back to
-- in_transit" edge, which would let a rider embed
-- {"delivery_code_attempts_reset": true} in that transition's own p_meta,
-- return to 'arrived', and keep guessing past the 5-attempt limit
-- indefinitely, forging exactly the marker only an admin should be able to
-- write.
--
-- Fix, two independent layers rather than one:
--
--   (a) verify_delivery_and_release_escrow() now also requires
--       actor_type = 'admin' on the marker row it reads - this alone would
--       already close the hole, and matches what
--       admin_reset_delivery_code_attempts() has always actually written.
--   (b) transition_order() additionally strips the three reserved keys
--       (delivery_code_attempts_reset, delivery_code_failed,
--       delivery_code_verified) out of p_meta before ever writing it,
--       whenever p_actor_type is not 'system' - so a client-supplied
--       p_meta can never place these keys into order_events at all,
--       regardless of what verify_delivery_and_release_escrow() later
--       chooses to trust. Belt and braces: (a) alone is sufficient given
--       the reset marker is the only one of the three actually re-read
--       with any actor_type filter, but (b) also protects
--       delivery_code_failed (read by the same function with no
--       actor_type filter at all, though it is written today only by
--       verify_delivery_and_release_escrow() itself via a direct insert
--       that never goes through transition_order(), not by any client
--       p_meta path) against the same class of future-edge risk, with one
--       change instead of two narrower ones.
--
-- KNOWN, DELIBERATE SIDE EFFECT of (b): verify_delivery_and_release_escrow()
-- itself calls `transition_order(p_order_id, 'delivered', 'rider',
-- auth.uid(), jsonb_build_object('delivery_code_verified', true))` as its
-- own final step - actor_type = 'rider', not 'system'. transition_order()
-- cannot distinguish "this p_meta was constructed by a trusted internal
-- caller" from "this p_meta was supplied by whatever RPC call reached me"
-- - both arrive as the same actor_type with the same shape, and adding a
-- side channel to tell them apart would reopen exactly the kind of
-- unauditable trust bond this fix exists to remove. So after this
-- migration, the order_events row for that final 'delivered' transition no
-- longer carries delivery_code_verified = true in its meta. Confirmed
-- before writing this migration that nothing reads that key anywhere in
-- this schema or app (grepped supabase/ and apps/web/src) - it exists as an
-- audit tag with no functional consumer, so losing it costs an inspector
-- one fewer breadcrumb on that one row, not a broken guard. delivery_code_
-- failed is unaffected by this specific call site (it is written by a
-- separate, direct order_events insert inside
-- verify_delivery_and_release_escrow(), never through transition_order()'s
-- p_meta), and delivery_code_attempts_reset is unaffected the same way
-- (admin_reset_delivery_code_attempts() also writes it via a direct
-- insert, never through transition_order()).
--
-- Every other check in both functions below - the row lock, the actor
-- forgery fix, the per-actor-type allow-lists, the transitions-table
-- check, the escrow-before-delivered guard, the auto-refund block, the
-- post-unwind refresh (transition_order(), all from 0050), and the
-- idempotency-first ordering, the arrived/paid checks, the delivery-code
-- check, the escrow-held re-derivation, the payout-split math
-- (verify_delivery_and_release_escrow(), all from 0044) - is reproduced
-- byte for byte, unchanged.
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
  v_caller_uid  uuid := auth.uid();
  -- S1 (independent security review, carried forward from 0018/0030/0050):
  -- auth.role() returns NULL when there are no JWT claims at all (a direct
  -- psql/pg_cron connection using its Postgres role rather than a
  -- PostgREST-issued JWT) - comparing NULL <> 'service_role' is also NULL,
  -- which `if` treats as false, so a plain `<>` guard FAILS OPEN for
  -- exactly the callers (pg_cron, a raw psql session authenticated as the
  -- service_role Postgres role) that most need this branch to work.
  -- Falling back to current_setting('role', true) and using `is distinct
  -- from` (which treats NULL as a real, non-matching value) closes that
  -- gap without changing behavior for any PostgREST-authenticated caller.
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
  -- 0057 TASK 1 fix: p_meta as it will actually be written, after
  -- stripping the three reserved keys for any non-system actor. See this
  -- migration's header for the full reasoning and the one known,
  -- deliberate side effect on the 'delivered' transition's own audit tag.
  v_meta        jsonb := p_meta;
begin
  -- 1. Lock the row (§10 point 1) - this is also what makes concurrent
  --    transitions on the same order serialize instead of racing.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'transition_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_from_status := v_order.status;

  -- Authorization, part 1: the actor must have a real relationship to the
  -- order, proven by the SESSION making the call (auth.uid()/auth.role()),
  -- never by the p_actor_id/p_actor_type arguments alone. Restored from
  -- 0015/0018/0030 - this is the actor-forgery fix that 0041/0042 dropped,
  -- and 0050 restored.
  if p_actor_type = 'customer' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or v_caller_uid is distinct from v_order.customer_id then
      raise exception 'transition_order: actor is not the customer on order %', p_order_id;
    end if;
    -- Authorization, part 2: which edges this actor TYPE may drive,
    -- independent of whether the edge is legal for the order's current
    -- status. Restored from 0018/0030 - the per-actor-type allow-lists
    -- that 0041/0042 dropped, and 0050 restored.
    if p_to_status <> 'cancelled_by_customer' then
      raise exception 'transition_order: actor_type=customer may not drive an order to %- only cancelled_by_customer', p_to_status;
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
    -- No `authenticated`-reachable admin surface exists yet - reserved for
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
      raise exception 'transition_order: actor_type=admin may not drive an order to %- only cancelled_by_platform', p_to_status;
    end if;
  elsif p_actor_type = 'system' then
    -- Reserved for pg_cron / the dispatch orchestrator / capture_payment's
    -- internal call, all of which run with the service-role key. THIS
    -- BRANCH IS THE SHARPEST PART OF THE FIX: 0041/0042's if/elsif chain
    -- had no branch at all for 'system', which in PL/pgSQL means it fell
    -- through with ZERO checks performed for any p_actor_type value this
    -- chain does not explicitly name - restored here, plus the trailing
    -- `else raise` below so any FUTURE unhandled actor_type also fails
    -- closed instead of silently passing.
    if v_caller_role is distinct from 'service_role' then
      raise exception 'transition_order: actor_type=system requires the service-role key';
    end if;
    if p_to_status not in ('placed', 'cancelled_by_platform', 'rider_assigned') then
      raise exception 'transition_order: actor_type=system may not drive an order to %', p_to_status;
    end if;
  else
    raise exception 'transition_order: unknown actor_type %', p_actor_type;
  end if;

  -- 2. Validate against the explicit allowed-transitions table - a second,
  --    independent gate: even an actor type cleared to request p_to_status
  --    in principle still can't skip the state machine.
  if not exists (
    select 1 from order_status_transitions
    where from_status = v_from_status and to_status = p_to_status
  ) then
    raise exception 'transition_order: illegal transition % -> % for order %',
      v_from_status, p_to_status, p_order_id
      using errcode = 'check_violation';
  end if;

  -- 2.5. Restored from 0030 - the guard that 0041/0042 dropped. A
  --      transition INTO 'delivered' is refused unless this order's escrow
  --      has already been released, i.e. unless the "<order.code>-escrow"-
  --      referenced transactions row already exists. Applies unconditionally
  --      to every actor_type, with no admin/system override - see 0030's
  --      own header for the full reasoning, unchanged here.
  --      verify_delivery_and_release_escrow() inserts exactly this row
  --      BEFORE its own internal call to transition_order(..., 'delivered',
  --      ...) in the same transaction (0020/0022/0025/0044), so the
  --      legitimate path always satisfies this check; any direct
  --      rider/vendor/admin/system call that hasn't gone through that
  --      function never has this row and is refused here.
  if p_to_status = 'delivered' and not exists (
    select 1 from transactions where reference = v_order.code || '-escrow'
  ) then
    raise exception 'transition_order: order % cannot be marked delivered before its escrow has been released - call verify_delivery_and_release_escrow() with the customer''s delivery code instead', p_order_id
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

  -- 3a. Auto-refund (0041, reproduced unchanged): this order is never
  -- going to be fulfilled from here - reverse its captured payment out of
  -- escrow immediately rather than leaving it stranded until an admin
  -- notices. Shares _unwind_order_escrow_ledger() with the manual admin
  -- path (refund_order_escrow()), so this can never double-refund or fight
  -- a concurrent admin action - both funnel through the same idempotency
  -- guards. Called with two arguments, resolving p_destination to its
  -- 'wallet' default on the live three-argument
  -- _unwind_order_escrow_ledger(uuid, text, text) - verified against
  -- 0045_customer_wallet.sql, see 0050's own header.
  --
  -- Deliberately NOT failed_delivery: a rider genuinely reached 'arrived'
  -- and attempted the handover there - whether the customer still owes for
  -- that attempt is a support/business judgment call, left on the existing
  -- manual admin path, not made automatic here.
  --
  -- Wrapped so a failure in the unwind can never block the status
  -- transition itself, which is the primary invariant this function exists
  -- to enforce - surfaced as a WARNING rather than silently swallowed, with
  -- refund_order_escrow() still available as a manual fallback.
  if p_to_status in ('rejected_by_vendor', 'cancelled_by_customer', 'cancelled_by_platform') then
    begin
      perform _unwind_order_escrow_ledger(p_order_id, format('Automatically refunded - order moved to %s', p_to_status));
    exception when others then
      raise warning 'transition_order: automatic escrow unwind failed for order % (transition to %): %', p_order_id, p_to_status, sqlerrm;
    end;

    -- Refresh (0042, reproduced unchanged): the unwind above may have
    -- updated this row (payment_status) in a statement separate from the
    -- RETURNING clause above, which would otherwise make the value this
    -- function returns stale.
    select * into v_order from orders where id = p_order_id;
  end if;

  -- 3b. 0057 TASK 1 fix: strip the three reserved delivery-code meta keys
  -- from what actually gets written, for every actor_type except 'system'.
  -- These three keys are read by verify_delivery_and_release_escrow() as
  -- proof of an admin-issued rate-limit reset or a genuine failed-attempt/
  -- verified marker; letting any client-reachable actor_type write them
  -- through p_meta would let that same actor forge the exact signal that
  -- function trusts. See this migration's header for the full reasoning,
  -- the current non-exploitability analysis, and the one known side effect
  -- (this function's own internal 'delivered' call, actor_type='rider',
  -- loses its delivery_code_verified audit tag - confirmed unread anywhere
  -- in this schema or app before accepting that tradeoff).
  if p_actor_type is distinct from 'system' then
    v_meta := v_meta - 'delivery_code_attempts_reset' - 'delivery_code_failed' - 'delivery_code_verified';
  end if;

  -- 4. Insert the order_events row - same transaction, always.
  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (p_order_id, v_from_status, p_to_status, p_actor_type, p_actor_id, v_meta);

  -- 5. Return the new state; a Postgres Changes subscription on `orders`
  --    propagates it over Realtime.
  return v_order;
end;
$$;

comment on function transition_order(uuid, order_status, text, uuid, jsonb) is
  'The only writer of orders.status. Mirrors packages/domain/src/order-state-machine.ts - keep both in sync. Actor identity is derived from auth.uid()/auth.role(), never trusted from p_actor_id/p_actor_type alone (0015); each actor TYPE is restricted to the specific p_to_status values it may request, with actor_type=system/admin requiring the service-role key and every other actor_type value rejected outright (0018); a transition INTO delivered additionally requires this order''s escrow to already be released, with no admin/system override (0030); rejected_by_vendor/cancelled_by_customer/cancelled_by_platform auto-unwind any captured-but-unreleased escrow (0041), with this function''s own return value refreshed afterward so it is never stale (0042); all restored together after 0041/0042 each silently regressed to 0006''s original body (0050). As of 0057, p_meta additionally has delivery_code_attempts_reset/delivery_code_failed/delivery_code_verified stripped out before being written, for every actor_type except system - see 0057_rider_review_round_two.sql''s own header for why.';

revoke execute on function transition_order(uuid, order_status, text, uuid, jsonb) from public;
grant execute on function transition_order(uuid, order_status, text, uuid, jsonb) to authenticated, service_role;

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
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if auth.uid() is null or v_order.rider_id is null or auth.uid() is distinct from v_order.rider_id then
    raise exception 'verify_delivery_and_release_escrow: actor is not the assigned rider on order %', p_order_id;
  end if;

  v_reference := v_order.code || '-escrow';

  if exists (select 1 from transactions where reference = v_reference) then
    select * into v_order from orders where id = p_order_id;
    v_result.code_matched := true;
    v_result.order_row := v_order;
    return v_result;
  end if;

  if v_order.status <> 'arrived' then
    raise exception 'verify_delivery_and_release_escrow: order is not yet marked arrived (status=%)', v_order.status;
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'verify_delivery_and_release_escrow: order % payment_status is not paid (status=%)',
      p_order_id, v_order.payment_status;
  end if;

  -- 0057 TASK 1 fix: require actor_type = 'admin' on the reset-marker row,
  -- matching what admin_reset_delivery_code_attempts() (0031) has always
  -- actually written, instead of trusting any order_events row carrying
  -- this meta key regardless of who wrote it. See this migration's header
  -- for the full reasoning and the current non-exploitability analysis.
  select max(at) into v_reset_marker_at
  from order_events
  where order_id = p_order_id
    and actor_type = 'admin'
    and (meta ->> 'delivery_code_attempts_reset')::boolean is true;

  select count(*) into v_failed_attempts
  from order_events
  where order_id = p_order_id
    and (meta ->> 'delivery_code_failed')::boolean is true
    and at >= v_order.arrived_at
    and at > coalesce(v_reset_marker_at, '-infinity'::timestamptz);

  if v_failed_attempts >= 5 then
    raise exception 'verify_delivery_and_release_escrow: too many incorrect delivery-code attempts for order %', p_order_id;
  end if;

  select code into v_stored_code from order_delivery_codes where order_id = p_order_id;
  if v_stored_code is null then
    raise exception 'verify_delivery_and_release_escrow: no delivery code exists for order %', p_order_id;
  end if;

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

  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';
  if v_escrow_account_id is null then
    raise exception 'verify_delivery_and_release_escrow: platform escrow account is not seeded';
  end if;

  select coalesce(sum(amount_kobo), 0) into v_escrow_held_kobo
  from ledger_entries
  where order_id = p_order_id
    and account_id = v_escrow_account_id
    and direction = 'credit'
    and entry_type = 'payment_capture';

  if v_escrow_held_kobo <> v_order.total_kobo then
    raise exception 'verify_delivery_and_release_escrow: escrow for order % holds % kobo but total_kobo is % - refusing to release',
      p_order_id, v_escrow_held_kobo, v_order.total_kobo;
  end if;

  -- v_rider_kobo comes from rider_fee_kobo (set by accept_dispatch_offer(),
  -- 0044) instead of delivery_fee_kobo - see 0044's own file header for
  -- why the two were conflated before. v_platform_kobo remains the
  -- RESIDUAL (total_kobo - vendor - rider), unchanged from 0020: this is
  -- what makes a free-delivery order (delivery_fee_kobo = 0, but
  -- rider_fee_kobo > 0) still balance - the platform's share simply
  -- absorbs the difference, exactly as it already absorbs discount_kobo.
  v_commission_kobo := round(v_order.subtotal_kobo * v_vendor.commission_bps / 10000.0)::bigint;
  v_vendor_kobo := v_order.subtotal_kobo - v_commission_kobo;
  v_rider_kobo := v_order.rider_fee_kobo;
  v_platform_kobo := v_order.total_kobo - v_vendor_kobo - v_rider_kobo;

  if v_vendor_kobo < 0 or v_rider_kobo < 0 or v_platform_kobo < 0 then
    raise exception 'verify_delivery_and_release_escrow: computed a negative payout share for order % (vendor=%, rider=%, platform=%) - refusing to release',
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
  'The only writer of escrow_release ledger entries and the only path from arrived to delivered. Only the assigned rider may call it; idempotent on retry via the "<order.code>-escrow" transactions.reference anchor. Reads the delivery code from order_delivery_codes (0022), refuses to release unless escrow actually holds exactly total_kobo (0022 BLOCKING 2), requires payment_status=paid (0022 SHOULD-FIX 5), and rate-limits failed attempts to 5 within a window starting at the LATER of arrived_at or the most recent ADMIN-AUTHORED admin_reset_delivery_code_attempts() marker (0022 SHOULD-FIX 7, made actually effective by 0025, resettable by an admin as of 0031, the reset marker now filtered to actor_type=admin as of 0057 - see that migration''s header). As of 0044, the rider''s payout share comes from orders.rider_fee_kobo (set by accept_dispatch_offer()) instead of delivery_fee_kobo. Returns delivery_verification_result (code_matched, order_row): a wrong code is a NORMAL non-raising result as of 0025, not an exception. See 0020 for the payout-split reasoning, 0022/0025 for everything else, 0031 for the reset-window change, 0044 for the rider-fee change, and 0057 for the actor_type=admin filter on the reset marker.';

revoke execute on function verify_delivery_and_release_escrow(uuid, text) from public;
grant execute on function verify_delivery_and_release_escrow(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- TASK 2 - get_rider_offer_details() never checked expires_at.
-- ---------------------------------------------------------------------------
--
-- 0044 authorized this read on `status in ('offered', 'accepted')` with no
-- TTL check at all, while accept_dispatch_offer() (0044) does check
-- expires_at before honoring an accept. Because sweep_dispatch_offers()
-- (0055) is not scheduled by any migration (see TASK 3 below), an
-- 'offered' row that nobody ever accepts or declines stays 'offered'
-- forever - the only things that ever flip it are accept_dispatch_offer()'s
-- own lazy self-expiry and its "expire every other rider's offer" step,
-- both of which require SOMEBODY to accept. An order offered to up to 10
-- riders (dispatch_order_to_nearby_riders(), 0019/0023) that nobody ever
-- accepts therefore left all 10 riders with INDEFINITE read access, via
-- this function, to the customer's delivery_address, dropoff_lat/lng,
-- delivery_note, and total_kobo - for a job none of them ever took.
--
-- Fix: the authorization predicate is now `status = 'accepted' OR
-- (status = 'offered' AND expires_at > now())`, still OR'd with
-- `auth.uid() = v_order.rider_id` for the assigned rider. The assigned-
-- rider branch is untouched and must stay that way: the rider who actually
-- accepted needs to keep reading these details for the length of the whole
-- trip, long after their own dispatch_offers.expires_at (a 60-second
-- acceptance window, not a trip-length one) has passed - that branch does
-- not consult expires_at at all, by design, both before and after this
-- fix.
--
-- No `drop function` needed - the OUT-parameter row type (returns table
-- (...)) is unchanged from 0044, only the WHERE clause inside the body
-- changes, so `create or replace` applies cleanly. Every other check
-- (the order lookup, the auth.uid() is null guard, the vendor lookup, the
-- NULL-tolerant live fee estimate, the returned column shape) is
-- reproduced byte for byte from 0044.
-- ---------------------------------------------------------------------------

create or replace function get_rider_offer_details(p_order_id uuid)
returns table (
  order_code              text,
  status                  text,
  vendor_name             text,
  vendor_address_line     text,
  vendor_landmark         text,
  pickup_lat              double precision,
  pickup_lng              double precision,
  dropoff_lat             double precision,
  dropoff_lng             double precision,
  delivery_address        jsonb,
  delivery_note           text,
  item_count              integer,
  total_kobo              bigint,
  delivery_fee_kobo       bigint,
  distance_m              integer,
  pickup_distance_m       integer,
  rider_fee_estimate_kobo bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order              orders;
  v_vendor             vendors;
  v_rider_location     geography(point, 4326);
  v_area               service_areas;
  v_pickup_distance_m  double precision;
  v_rider_fee_estimate bigint;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'get_rider_offer_details: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if auth.uid() is null then
    raise exception 'get_rider_offer_details: no authenticated caller';
  end if;

  -- 0057 TASK 2 fix: an 'offered' row only authorizes this read while it
  -- has not yet passed expires_at - a stale, never-accepted-or-declined
  -- offer no longer does. 'accepted' still authorizes unconditionally
  -- (deliberately no expires_at check on that branch - see this
  -- migration's header for why the assigned rider must keep reading these
  -- details for the whole trip). The `auth.uid() is distinct from
  -- v_order.rider_id` branch is untouched, for the same reason.
  if not exists (
    select 1 from dispatch_offers
    where order_id = p_order_id
      and rider_id = auth.uid()
      and (status = 'accepted' or (status = 'offered' and expires_at > now()))
  ) and auth.uid() is distinct from v_order.rider_id then
    raise exception 'get_rider_offer_details: actor % has no active offer or assignment on order %', auth.uid(), p_order_id;
  end if;

  select * into v_vendor from vendors where id = v_order.vendor_id;

  -- Best-effort live estimate. Left NULL (never raised) whenever any input
  -- it needs is missing - the caller's own current_location, the vendor's
  -- location, or the order's service area rates - since this is advisory
  -- only. Unchanged from 0044.
  select current_location into v_rider_location from riders where user_id = auth.uid();

  if v_rider_location is not null and v_vendor.location is not null and v_order.service_area_id is not null then
    select * into v_area from service_areas where id = v_order.service_area_id;
    if found then
      v_pickup_distance_m := st_distance(v_rider_location, v_vendor.location);
      v_rider_fee_estimate := v_area.rider_base_fee_kobo
        + v_area.rider_per_km_fee_kobo * ceil((v_pickup_distance_m + coalesce(v_order.distance_m, 0)) / 1000.0)::bigint;
    end if;
  end if;

  return query
  select
    v_order.code,
    v_order.status::text,
    v_vendor.name,
    v_vendor.address_line,
    v_vendor.landmark,
    st_y(v_vendor.location::geometry),
    st_x(v_vendor.location::geometry),
    st_y(v_order.delivery_location::geometry),
    st_x(v_order.delivery_location::geometry),
    v_order.delivery_address,
    v_order.delivery_note,
    (select coalesce(sum(qty), 0)::integer from order_items where order_id = v_order.id),
    v_order.total_kobo,
    v_order.delivery_fee_kobo,
    v_order.distance_m,
    round(v_pickup_distance_m)::integer,
    v_rider_fee_estimate;
end;
$$;

comment on function get_rider_offer_details(uuid) is
  'Lets a rider see what a dispatch offer is FOR before deciding whether to accept it, and lets the assigned rider re-read the same details afterward. Deliberately NOT `returns orders` - see 0032''s own header for why. Also returns pickup_distance_m/rider_fee_estimate_kobo (0044): a live, non-authoritative estimate of what accepting would pay, NULL whenever the rider''s own location, the vendor''s location, or the order''s service area rates are missing (never raises for this part - it is advisory only). Authorization: a live ''accepted'' dispatch_offers row (no expiry check - the assigned rider must keep reading this for the whole trip), OR a live ''offered'' row that has NOT yet passed expires_at (0057 - an expired, never-accepted offer no longer grants access, closing an indefinite-read hole that existed while sweep_dispatch_offers() (0055) is unscheduled), OR already being the assigned rider via orders.rider_id. Re-checked on every call.';

revoke execute on function get_rider_offer_details(uuid) from public;
grant execute on function get_rider_offer_details(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- TASK 3 - schedule sweep_dispatch_offers(), or state plainly why it
-- cannot be done from a migration.
-- ---------------------------------------------------------------------------
--
-- 0055_dispatch_offer_sweep.sql built sweep_dispatch_offers() and
-- deliberately scheduled nothing - its own header explains that pg_cron is
-- not installed by this or any prior migration (0001_extensions.sql only
-- installs pgcrypto/postgis), confirmed again here by grepping every
-- migration file for cron.schedule: no call exists anywhere before this
-- one.
--
-- Whether pg_cron CAN successfully be enabled from a migration in THIS
-- specific project is not something a SQL file can prove ahead of time:
-- pg_cron must be loaded via shared_preload_libraries at server start, a
-- postgresql.conf-level setting that `create extension` cannot retroactively
-- arrange for an already-running Postgres process - if the running server
-- was not started with pg_cron preloaded, `create extension pg_cron` fails
-- outright, no matter what this migration does. Supabase's hosted platform
-- preloads pg_cron for every project (it is one of the extensions offered
-- under Database -> Extensions in the dashboard), and this repository's own
-- supabase/config.toml (hand-authored, per its own header comment) has no
-- shared-preload-libraries setting either way to confirm or rule this out
-- for local/CI runs. Rather than assert either outcome as fact, this
-- migration ATTEMPTS both the extension and the schedule, with every step
-- wrapped so that a project where pg_cron genuinely is not preloaded gets a
-- clear NOTICE instead of an aborted `supabase db reset` - the graceful-
-- degradation this task asked for.
--
-- OPERATIONAL REQUIREMENT, stated plainly regardless of which branch below
-- actually fires: dispatch_offers rows have a 60-second expires_at TTL
-- (0028). Every order whose only offers all expire or get declined sits at
-- ready_for_pickup with no rider until something calls
-- sweep_dispatch_offers() with the service-role key. If the automatic
-- schedule below did not take effect in your environment (check for a
-- NOTICE in this migration's own output, or query
-- `select * from cron.job where jobname = 'sweep-dispatch-offers'`), an
-- operator MUST set one of these up manually:
--
--   (a) pg_cron, if available, by running exactly:
--
--         select cron.schedule(
--           'sweep-dispatch-offers',
--           '15 seconds',
--           $$ set role service_role; select sweep_dispatch_offers(); reset role; $$
--         );
--
--       Two things easy to get wrong, both noted in 0055's own header: the
--       'N seconds' scheduling syntax needs pg_cron >= 1.4 with N dividing
--       60 evenly, and the explicit `set role service_role` / `reset role`
--       wrapping is required because a plain pg_cron job otherwise runs as
--       whichever role scheduled it (typically the 'postgres' superuser),
--       NOT service_role - sweep_dispatch_offers() checks the caller's
--       actual Postgres role and raises "requires the service-role key"
--       without it.
--
--   (b) an external scheduler (a Vercel Cron job, a GitHub Actions
--       workflow, a systemd timer) calling sweep_dispatch_offers() over
--       PostgREST's /rpc endpoint with the service-role key, roughly every
--       15-30 seconds - the service-role JWT already sets the Postgres role
--       correctly per request, so this avoids the SET ROLE subtlety in (a)
--       entirely, and is probably the simpler operational choice for a
--       project with no other pg_cron job today.
-- ---------------------------------------------------------------------------

do $$
declare
  v_pg_cron_enabled boolean := false;
begin
  begin
    create extension if not exists pg_cron;
    v_pg_cron_enabled := true;
  exception when others then
    raise notice 'sweep_dispatch_offers: pg_cron extension could not be enabled (%). This is expected if the running Postgres server was not started with pg_cron in shared_preload_libraries. sweep_dispatch_offers() is NOT scheduled - see 0057_rider_review_round_two.sql''s own header (TASK 3) for the operational requirement and the exact statement or external-scheduler alternative an operator must set up.', sqlerrm;
  end;

  if v_pg_cron_enabled then
    begin
      -- cron.schedule() upserts by job name when one is given as the first
      -- argument (pg_cron's own documented behavior as of 1.0+), so
      -- re-running this migration on a database that already has this job
      -- scheduled is idempotent, not a duplicate-job error.
      perform cron.schedule(
        'sweep-dispatch-offers',
        '15 seconds',
        $sql$ set role service_role; select sweep_dispatch_offers(); reset role; $sql$
      );
      raise notice 'sweep_dispatch_offers: scheduled via pg_cron as job "sweep-dispatch-offers", every 15 seconds.';
    exception when others then
      raise notice 'sweep_dispatch_offers: pg_cron is enabled but scheduling the job failed (%) - the ''15 seconds'' syntax requires pg_cron >= 1.4, and an older pg_cron only accepts a 5-field cron expression, which cannot express a sub-minute interval at all. sweep_dispatch_offers() is NOT scheduled - see this migration''s header (TASK 3) for the manual statement or external-scheduler alternative.', sqlerrm;
    end;
  else
    raise notice 'sweep_dispatch_offers: pg_cron is not available in this database. sweep_dispatch_offers() is NOT scheduled - see 0057_rider_review_round_two.sql''s own header (TASK 3) for the operational requirement and the exact statement or external-scheduler alternative an operator must set up.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- TASK 4 - service_areas' column-level revoke on the two rider payout-rate
-- columns was a no-op against the table-level grant, leaving them readable
-- to every anon/authenticated caller.
-- ---------------------------------------------------------------------------
--
-- 0044:75 ran `revoke select (rider_base_fee_kobo, rider_per_km_fee_kobo)
-- on service_areas from anon, authenticated;`. 0034:26 had already granted
-- SELECT on the whole table to anon/authenticated. In PostgreSQL a column
-- read is permitted if EITHER the table-level ACL or the column-level ACL
-- allows it - REVOKE SELECT (col) only edits the column-level ACL, so this
-- statement emitted `WARNING: no privileges could be revoked for column
-- ...` and both columns stayed readable to every authenticated user (and
-- to anon, through the "read active service areas" policy, 0007:102, which
-- admits any is_active row with no relationship check at all) the entire
-- time - leaking the platform's rider payout rate card.
--
-- Fix, the idiom 0049/0056 already use correctly elsewhere in this batch:
-- revoke SELECT at the table level entirely, then grant back SELECT on an
-- explicit column list that excludes exactly the two rider-payout columns.
-- Column list below is service_areas' full current set - 0003 (creation)
-- plus every later `alter table service_areas` (only 0044, which added the
-- two rider columns being excluded here; grepped the whole migration set to
-- confirm no other file has ever altered this table's columns) - minus
-- rider_base_fee_kobo/rider_per_km_fee_kobo. SECURITY DEFINER functions
-- (accept_dispatch_offer(), get_rider_offer_details()) are unaffected -
-- they read as their owner, not the caller, so this narrowing never blocks
-- the one legitimate reader of the excluded columns.
-- ---------------------------------------------------------------------------

revoke select on service_areas from anon, authenticated;

grant select (
  id,
  name,
  polygon,
  is_active,
  base_delivery_fee_kobo,
  per_km_fee_kobo,
  free_above_kobo,
  launched_at,
  created_at
) on service_areas to anon, authenticated;

-- ---------------------------------------------------------------------------
-- TASK 5 - notifications was missed by 0056's anon-revoke /
-- explicit-select-grant sweep, despite 0049 touching this exact table in
-- the same review round.
-- ---------------------------------------------------------------------------
--
-- 0049:65 ran `revoke update on notifications from authenticated;` with
-- anon absent - so anon still holds the table-wide UPDATE grant 0034's
-- default privileges gave it on this table. Not currently exploitable (no
-- RLS policy on notifications is satisfiable with a null auth.uid()), but
-- it is exactly the belt-without-braces gap 0056 closed on
-- rider_documents/rider_push_tokens in this same round.
--
-- notifications was created in 0038, after 0034's `alter default
-- privileges`, so it also has no explicit `grant select` anywhere - it
-- relies entirely on that default-privileges side effect having applied to
-- whichever database role ran 0038, exactly the fragility 0056's own header
-- (0056:225-242) argues against for rider_documents/rider_push_tokens/
-- rider_notifications. Mirrored here for the same reason.
-- ---------------------------------------------------------------------------

revoke update on notifications from anon;
grant select on notifications to authenticated;

-- ---------------------------------------------------------------------------
-- TASK 6 - register_rider_push_token()'s cross-rider token takeover
-- (0056 task 3) is unaudited.
-- ---------------------------------------------------------------------------
--
-- 0056 made register_rider_push_token() delete any OTHER rider's row for
-- the same token before upserting the caller's own - correct for the
-- sign-out/sign-in handoff it targets (an Expo push token identifies a
-- device, and a device has one signed-in rider at a time), but it requires
-- no proof the caller actually possesses that device: rider B calling
-- register_rider_push_token('<rider A''s token>', 'android') silently
-- deletes A's row, with nothing recorded anywhere that it happened. Expo
-- push tokens are not high-entropy secrets - they can leak through client
-- logs, crash reports, or a support ticket - so this is a real takeover
-- primitive, not just a theoretical one.
--
-- CHOICE: write an audit row to rider_notifications for the LOSING rider,
-- rather than scoping the cross-rider delete to rows whose device_id also
-- matches (the task's other offered option). Scoping by device_id was
-- considered and rejected: device_id is explicitly optional on
-- rider_push_tokens (0053's own header - "Expo's own device-id APIs are
-- not universally available on every platform/permission state"), so
-- requiring a device_id match before allowing the cross-rider delete would
-- make the takeover-prevention silently useless on exactly the devices
-- that cannot report one - reintroducing 0056 task 3's original bug (two
-- riders sharing one physical phone's token) for that whole class of
-- device, while doing nothing to stop a genuine takeover via a leaked
-- token used from a DIFFERENT device (which would have a different, and
-- therefore non-matching, device_id anyway - the scoping option does not
-- even fully close the leaked-token case it might appear to address). An
-- audit notification degrades neither the intended handoff behavior nor
-- the leaked-token case: the transfer still happens (a device must be able
-- to hand off cleanly), but the rider who lost the token now has a durable,
-- visible record of it, exactly the way this schema already surfaces every
-- other order-affecting event a rider did not personally cause (see
-- notify_rider_of_order_status_change(), 0053).
--
-- Every other check and the delete-then-upsert shape itself is reproduced
-- byte for byte from 0056 - the only change is capturing which rider(s), if
-- any, actually lost a row, and writing one rider_notifications row each
-- when that set is non-empty.
-- ---------------------------------------------------------------------------

create or replace function register_rider_push_token(
  p_token     text,
  p_platform  text,
  p_device_id text default null
)
returns rider_push_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token             rider_push_tokens;
  v_reassigned_riders  uuid[];
begin
  if auth.uid() is null then
    raise exception 'register_rider_push_token: no authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from riders where user_id = auth.uid()) then
    raise exception 'register_rider_push_token: no rider row for the caller - call register_rider() first'
      using errcode = 'no_data_found';
  end if;

  if p_platform not in ('ios', 'android') then
    raise exception 'register_rider_push_token: unknown platform %', p_platform
      using errcode = 'check_violation';
  end if;

  if p_token is null or length(p_token) = 0 then
    raise exception 'register_rider_push_token: p_token must not be empty'
      using errcode = 'check_violation';
  end if;

  -- 0056 fix, unchanged shape: an Expo push token identifies a DEVICE, and
  -- a device has exactly one signed-in rider at a time. Remove any row a
  -- DIFFERENT rider holds for this exact token before upserting the
  -- caller's own, so a sign-out/sign-in handoff on the same phone
  -- transfers ownership instead of leaving the token registered under
  -- both riders.
  --
  -- 0057 TASK 6 fix: capture which rider(s) actually lost a row here, so
  -- an audit notification can be written for each one below - see this
  -- migration's header for why an audit trail was chosen over scoping the
  -- delete to a device_id match.
  with reassigned as (
    delete from rider_push_tokens
    where token = p_token
      and rider_id is distinct from auth.uid()
    returning rider_id
  )
  select coalesce(array_agg(distinct rider_id), array[]::uuid[])
  into v_reassigned_riders
  from reassigned;

  if array_length(v_reassigned_riders, 1) > 0 then
    insert into rider_notifications (rider_id, title, body)
    select
      lost_rider_id,
      'Push notifications moved to another sign-in',
      'This device signed in with a different rider account, so push notifications for it now go to that account instead. If this was not you, contact support.'
    from unnest(v_reassigned_riders) as lost_rider_id;
  end if;

  insert into rider_push_tokens (rider_id, token, platform, device_id)
  values (auth.uid(), p_token, p_platform, p_device_id)
  on conflict (rider_id, token) do update set
    platform   = excluded.platform,
    device_id  = excluded.device_id
  returning * into v_token;

  return v_token;
end;
$$;

comment on function register_rider_push_token(text, text, text) is
  'Upserts the CALLER''S OWN rider_push_tokens row on (rider_id, token) - rider_id is always auth.uid(), never a parameter, so this can never register a token against another rider. Before the upsert (0056), deletes any row a DIFFERENT rider holds for this same token: an Expo push token identifies a device, and a device has one signed-in rider at a time, so without this a sign-out/sign-in handoff on the same phone would leave the token registered under both riders. As of 0057, that cross-rider delete also writes a rider_notifications audit row for each rider who lost a row this way, so a token takeover (a leaked token registered from another account, not just a legitimate handoff) is always visible to the rider who lost it - see 0057_rider_review_round_two.sql''s own header for why an audit trail was chosen over scoping the delete to a device_id match. Call again on every app foreground/token-refresh event; harmless to call repeatedly with the same token.';

revoke execute on function register_rider_push_token(text, text, text) from public;
grant execute on function register_rider_push_token(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- TASK 7 - the four rider-kyc storage.objects policies are not
-- role-scoped, letting any authenticated account (including a customer who
-- is not a rider) upload into rider-kyc/<their own uid>/.
-- ---------------------------------------------------------------------------
--
-- 0052:86-97 created all four policies implicitly `TO PUBLIC` (no `TO`
-- clause at all). No cross-tenant READ is possible this way - anon fails
-- on a null auth.uid(), and (storage.foldername(name))[1] = auth.uid()::text
-- still pins every operation to the caller's own uid-named folder - so this
-- is storage-quota abuse by a non-rider account, not a data leak. Still
-- worth closing: nothing today stops a customer or vendor-staff-only
-- account from uploading arbitrary files into this bucket under their own
-- uid, consuming the same storage budget meant for rider KYC documents.
--
-- Fix: drop and recreate all four policies scoped `TO authenticated`, with
-- an added `exists (select 1 from riders where user_id = auth.uid())`
-- clause requiring the caller to actually have a riders row. The existing
-- `bucket_id = 'rider-kyc' and (storage.foldername(name))[1] =
-- auth.uid()::text` conditions are kept exactly as they were - this only
-- narrows who can reach that condition at all, it does not change the
-- own-folder scoping itself.
-- ---------------------------------------------------------------------------

drop policy "riders read own kyc objects" on storage.objects;
drop policy "riders upload own kyc objects" on storage.objects;
drop policy "riders update own kyc objects" on storage.objects;
drop policy "riders delete own kyc objects" on storage.objects;

create policy "riders read own kyc objects" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'rider-kyc'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from riders where user_id = auth.uid())
  );

create policy "riders upload own kyc objects" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'rider-kyc'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from riders where user_id = auth.uid())
  );

create policy "riders update own kyc objects" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'rider-kyc'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from riders where user_id = auth.uid())
  )
  with check (
    bucket_id = 'rider-kyc'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from riders where user_id = auth.uid())
  );

create policy "riders delete own kyc objects" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'rider-kyc'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from riders where user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- TASK 8 note - packages/db/src/generated.ts over-declared three write
-- models (rider_notifications.Update, notifications.Update,
-- notifications.Insert) relative to what 0049/0056 actually granted at the
-- database. That is a TypeScript-only change, made directly in that file
-- alongside this migration, not a SQL statement - recorded here only so
-- this migration's own header list of eight tasks has a home for it. All
-- three drifted in the SAFE direction (the type permitted what SQL denies,
-- producing a caught runtime permission error rather than an actual write
-- hole) - see that file's own inline comments, added in the same change,
-- for the corrected shapes and the exact grants each now matches.
-- ---------------------------------------------------------------------------
