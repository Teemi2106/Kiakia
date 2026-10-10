-- KiaKia - P0 fix: transition_order() lost three independently-shipped
-- security fixes when 0041_auto_refund_on_cancellation.sql and
-- 0042_fix_transition_order_stale_return.sql each redefined the function.
--
-- HOW THIS WAS FOUND - by reading every `create or replace function
-- transition_order(...)` in this migration set, in order:
--
--   0006_transition_order.sql   - original body.
--   0015_fix_transition_order_actor_forgery.sql - adds v_caller_uid/
--     v_caller_role, derives identity from auth.uid()/auth.role() instead
--     of trusting p_actor_id/p_actor_type.
--   0018_fix_transition_order_edge_restrictions.sql - adds a per-actor-type
--     allow-list of p_to_status values, plus an explicit final `else raise
--     'unknown actor_type'` branch.
--   0030_require_escrow_release_before_delivered.sql - adds a guard so a
--     transition INTO 'delivered' is refused unless this order's escrow has
--     already been released.
--   0041_auto_refund_on_cancellation.sql - `declare v_order orders;
--     v_from_status order_status; begin` - THAT IS THE ENTIRE DECLARE
--     BLOCK. No v_caller_uid, no v_caller_role. The authorization section
--     that follows is byte-for-byte 0006's `if p_actor_type = 'customer'
--     and p_actor_id is distinct from v_order.customer_id then raise ...`
--     shape - comparing the client-supplied p_actor_id against the order,
--     never against who actually holds the session. 0041 started from 0006,
--     not from 0030, and never noticed.
--   0042_fix_transition_order_stale_return.sql - same declare block, same
--     0006-shaped authorization section, confirmed by direct read of its
--     body (lines 24-113 of that file). 0042 started from 0041 (which had
--     already regressed to 0006's shape), so it inherited the same
--     regression and added nothing to fix it.
--
-- Both files were verified directly, not inferred: neither declares
-- v_caller_uid/v_caller_role, and the `if/elsif` chain in both has exactly
-- four branches (customer/vendor/rider/admin) with NO `elsif p_actor_type =
-- 'system'` branch and NO final `else raise`.
--
-- THE THREE REGRESSIONS, and their real-world impact on the version of
-- transition_order() live immediately before this migration (0042's):
--
--   1. ACTOR-FORGERY (0015 lost) - p_actor_id is trusted as a claim, not
--      verified against auth.uid()/auth.role(). Any authenticated session
--      can pass any p_actor_id it likes for actor_type in
--      (customer/vendor/rider), and the check only compares that untrusted
--      value against the order's own columns - never against who is
--      actually calling.
--
--   2. MISSING actor_type='system' BRANCH (0018 lost) - the if/elsif chain
--      has no branch at all for 'system' and no trailing `else raise`. In
--      PL/pgSQL, an if/elsif chain with no matching branch and no else
--      simply falls through with NO check performed. Since
--      `grant execute on function transition_order(...) to authenticated`
--      has never been narrowed, this means:
--
--        select transition_order(
--          '<any order id>', 'cancelled_by_platform', 'system', null
--        );
--
--      run by ANY authenticated user cancels ANY stranger's order - no
--      identity check, no relationship check, nothing. Worse:
--
--        select transition_order(
--          '<their own draft order>', 'placed', 'system', null
--        );
--
--      forces an unpaid draft order straight into the vendor's active
--      queue, completely bypassing capture_payment() (0010/0017) and the
--      Monnify webhook - the exact class of bug 0018's own header
--      describes closing, reopened by 0041/0042 never having read 0018 in
--      the first place.
--
--   3. ESCROW-BEFORE-DELIVERED GUARD (0030 lost) - the assigned rider can
--      call `transition_order(order, 'delivered', 'rider', <own uid>)`
--      directly. In the 0042-shaped function this passes every check: the
--      caller IS the assigned rider (checked against p_actor_id, which the
--      caller controls but happens to match here), and ('arrived',
--      'delivered') is a legal edge in order_status_transitions (0006).
--      This skips verify_delivery_and_release_escrow() entirely - no
--      delivery-code check - and PERMANENTLY STRANDS THE ORDER'S MONEY:
--      verify_delivery_and_release_escrow() refuses to run once status is
--      already 'delivered' (its own check requires status = 'arrived'), and
--      order_status_transitions has no outbound edge from 'delivered' at
--      all (0006) - so the order can never reach any other state, the
--      vendor and rider are never paid, and total_kobo sits in platform
--      escrow forever. This is exactly the P0 0030's own header describes,
--      reintroduced by 0041/0042 both starting from 0006's body instead of
--      0030's.
--
-- THE FIX - redefine transition_order() as the UNION of all of the above,
-- verified piece by piece rather than assembled from memory:
--
--   - The full authorization section (identity checks + per-actor-type
--     allow-lists) and the delivered-escrow guard are copied verbatim from
--     0030_require_escrow_release_before_delivered.sql (that file's own
--     function body, lines 81-246 as read directly from disk) - the most
--     recent migration to have gotten 0015+0018+its own fix all correct
--     together in one body.
--   - 0041's step 3a (the auto-refund block wrapped in its own exception
--     handler, firing only on rejected_by_vendor/cancelled_by_customer/
--     cancelled_by_platform) is layered on top, calling
--     _unwind_order_escrow_ledger(p_order_id, p_reason) - verified against
--     that function's CURRENT live signature, not assumed: grep across
--     every migration shows _unwind_order_escrow_ledger was defined in
--     0041 as (uuid, text), redefined in 0043_monnify_refund_tracking.sql
--     still as (uuid, text), then DROPPED and redefined in
--     0045_customer_wallet.sql (lines 205-302 as read directly) as
--     (uuid, text, text default 'wallet') - the two-argument original was
--     dropped outright (`drop function if exists
--     _unwind_order_escrow_ledger(uuid, text);`) specifically because a
--     defaulted third parameter beside it would have made a two-argument
--     call ambiguous. 0045's own comment confirms the intended call shape
--     explicitly: "the default, so 0042's existing two-argument call inside
--     transition_order() picks it up with no change to that function" - so
--     the two-argument call
--     `perform _unwind_order_escrow_ledger(p_order_id, format(...));` is
--     verified correct as-is against the live three-argument function,
--     resolving p_destination to its 'wallet' default. No change to that
--     call site was needed or made.
--   - 0042's post-unwind refresh (`select * into v_order from orders where
--     id = p_order_id;`, scoped to only the branch that can actually change
--     the row) is layered on top of that, so this function's own return
--     value is never stale for payment_status - unchanged reasoning from
--     0042's own header.
--
-- WHY THE UNION IS CORRECT, NOT JUST A GUESS - every piece above was read
-- directly from the migration that introduced it and is reproduced either
-- byte-for-byte (0030's authorization/edge-restriction/escrow-guard
-- sections, 0042's refresh) or with its one dependency re-verified against
-- what is actually live today (0041's unwind call, checked against 0045's
-- current three-argument signature and default). Nothing here is inferred
-- from the file headers' prose alone.
--
-- THIS SHOULD HAVE BEEN CAUGHT BY CI - pgTAP tests asserting exactly these
-- three guards already exist: supabase/tests/transition_order.sql (actor-
-- forgery + per-actor-type allow-lists, including a dedicated case for
-- `actor_type=system` being rejected for a non-service-role caller) and
-- supabase/tests/require_escrow_release_before_delivered.sql (the
-- escrow-before-delivered guard, including that the rejected direct call
-- does not move the order's status or write an order_events row, and that
-- the legitimate verify_delivery_and_release_escrow() path is unaffected).
-- Both files predate 0041/0042 and assert error message text that only
-- 0030's body (not 0006's, not 0041/0042's regressed body) produces -
-- meaning `supabase test db` would have failed the instant 0041 or 0042
-- was applied on top of a database that already had 0030. The fact that
-- both migrations shipped anyway means this pgTAP suite was evidently not
-- run against them in CI at the time. Nothing in this migration changes
-- CI wiring - that is a separate, non-database-schema fix this migration
-- does not attempt.
--
-- Convention note: this supersedes 0042 in place via `create or replace`
-- (return type and argument list are unchanged) - 0006/0015/0018/0030/
-- 0041/0042 are left untouched, per this repo's "never edit a migration
-- that already shipped" rule.

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
  -- S1 (independent security review, carried forward from 0018/0030):
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
  -- 0015/0018/0030 - this is the actor-forgery fix that 0041/0042 dropped.
  if p_actor_type = 'customer' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or v_caller_uid is distinct from v_order.customer_id then
      raise exception 'transition_order: actor is not the customer on order %', p_order_id;
    end if;
    -- Authorization, part 2: which edges this actor TYPE may drive,
    -- independent of whether the edge is legal for the order's current
    -- status. Restored from 0018/0030 - the per-actor-type allow-lists
    -- that 0041/0042 dropped.
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
  -- 0045_customer_wallet.sql, see this file's own header.
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

  -- 4. Insert the order_events row - same transaction, always.
  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (p_order_id, v_from_status, p_to_status, p_actor_type, p_actor_id, p_meta);

  -- 5. Return the new state; a Postgres Changes subscription on `orders`
  --    propagates it over Realtime.
  return v_order;
end;
$$;

comment on function transition_order(uuid, order_status, text, uuid, jsonb) is
  'The only writer of orders.status. Mirrors packages/domain/src/order-state-machine.ts - keep both in sync. Actor identity is derived from auth.uid()/auth.role(), never trusted from p_actor_id/p_actor_type alone (0015); each actor TYPE is restricted to the specific p_to_status values it may request, with actor_type=system/admin requiring the service-role key and every other actor_type value rejected outright (0018); a transition INTO delivered additionally requires this order''s escrow to already be released, with no admin/system override (0030); and rejected_by_vendor/cancelled_by_customer/cancelled_by_platform auto-unwind any captured-but-unreleased escrow (0041), with this function''s own return value refreshed afterward so it is never stale (0042). This migration (0050) restores all of the above after 0041 and 0042 each silently regressed to 0006''s original, unguarded body - see 0050_restore_transition_order_guards.sql''s own header for the full incident writeup.';

-- Grants are unchanged - still callable by `authenticated` for
-- customer/vendor/rider actor types; system/admin actor types are rejected
-- inside the function body for any caller whose role isn't service_role.
revoke execute on function transition_order(uuid, order_status, text, uuid, jsonb) from public;
grant execute on function transition_order(uuid, order_status, text, uuid, jsonb) to authenticated, service_role;
