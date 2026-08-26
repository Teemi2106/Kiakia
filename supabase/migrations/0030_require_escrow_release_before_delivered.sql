-- KiaKia — fix (P0, money loss): transition_order() (redefined most
-- recently by 0018_fix_transition_order_edge_restrictions.sql) lets the
-- actor_type='rider' branch drive an order straight from 'arrived' to
-- 'delivered' — ('arrived', 'delivered') is a legal edge in
-- order_status_transitions (0006_transition_order.sql) and 'delivered' is in
-- the rider allow-list 0018 added, because the ONLY intended way to reach
-- 'delivered' is verify_delivery_and_release_escrow()'s own internal call to
-- transition_order() (0020_verify_delivery_and_release_escrow.sql, return
-- type since changed by 0025_fix_delivery_code_rate_limit_persistence.sql,
-- but its internal call shape — insert the escrow_release transaction row
-- FIRST, then call transition_order(..., 'delivered', 'rider', ...) LAST,
-- same transaction — is unchanged since 0020 and confirmed by reading
-- 0025's current body directly, line for line).
--
-- Nothing before this migration stops the ASSIGNED RIDER from skipping that
-- whole function and calling transition_order() directly:
--
--   transition_order(order_id, 'delivered', 'rider', auth.uid())
--
-- from the Supabase client SDK on an order they are legitimately assigned
-- to and that is legitimately 'arrived' — every check 0015/0018 added
-- passes (real session, real assignment, 'delivered' is on the rider
-- allow-list, ('arrived','delivered') is a legal edge). This bypasses the
-- customer's delivery-code check entirely and, far worse, permanently stops
-- money moving: verify_delivery_and_release_escrow() refuses to run
-- afterward because it requires status = 'arrived' (its own check 4), and
-- the order is now 'delivered' with no other function able to move it
-- anywhere (order_status_transitions has no outbound edge at all from
-- 'delivered' — see 0006). The vendor and rider are never paid and the
-- captured total_kobo sits in the platform escrow account forever. This is
-- simultaneously a delivery-code authorization bypass and a permanent
-- fund-stranding bug.
--
-- THE FIX — guard on the actual invariant, not on session/transaction-local
-- state: a transition INTO 'delivered' is refused unless this order's
-- escrow has already been released, i.e. unless the
-- "<order.code>-escrow"-referenced transactions row already exists.
-- verify_delivery_and_release_escrow() inserts exactly that row (kind =
-- 'escrow_release', reference = v_order.code || '-escrow') BEFORE its own
-- final call to transition_order() in the same transaction — visible to
-- this check via ordinary read-your-own-writes visibility within one
-- transaction, no cross-transaction race — so the legitimate path is
-- unaffected while every direct call is refused. This was evaluated against
-- a set_config()/session-flag alternative and rejected: a flag is
-- transaction-local mutable state that has to be set correctly by every
-- legitimate caller and cleared/scoped correctly everywhere else, is
-- invisible to anyone reading this function in isolation, and encodes "did
-- the right function set the right flag" rather than the real business
-- rule. Requiring the ledger row to exist instead encodes "an order is only
-- delivered once its money has actually moved" directly and declaratively,
-- self-evidently correct by reading this function alone, with nothing
-- transaction-local to get wrong.
--
-- ADMIN AND SYSTEM ACTORS — decided explicitly, not left ambiguous: this
-- guard applies UNCONDITIONALLY, to every actor_type, with NO override for
-- 'admin' or 'system'. An admin force-marking an order 'delivered' without
-- the escrow having been released would strand the exact same money the
-- exact same way — there is nothing about the caller being an admin that
-- makes skipping the payout split safe. Practically, this costs nothing
-- today: 0018's own per-actor-type allow-lists already restrict 'delivered'
-- to actor_type='rider' only (admin may only request
-- 'cancelled_by_platform'; system may only request 'placed',
-- 'cancelled_by_platform', 'rider_assigned' — neither lists 'delivered'),
-- so this guard is presently unreachable for admin/system and is added
-- here purely as defense in depth against a future migration widening
-- either allow-list to include 'delivered' without re-deriving this
-- reasoning. If a genuine "admin needs to force-complete a stuck order"
-- operational need ever appears, the correct fix is a dedicated
-- SECURITY DEFINER RPC (mirroring approve_vendor/reject_vendor,
-- 0021_admin_vendor_approval.sql) that performs the escrow release (or an
-- explicit documented refund/write-off) AND the transition atomically —
-- never a bare status flip that leaves the ledger inconsistent with
-- orders.status.
--
-- Convention note: this supersedes 0018 in place via `create or replace`
-- (the return type and argument list are unchanged), the same pattern
-- 0023_rider_dispatch_kyc_hardening.sql and other superseding migrations in
-- this set already use — 0018 itself is left untouched, per this repo's
-- "never edit a migration that already shipped" rule.

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
  -- S1 (independent security review): auth.role() returns NULL when there
  -- are no JWT claims at all (a direct psql/pg_cron connection using its
  -- Postgres role rather than a PostgREST-issued JWT) — comparing NULL
  -- <> 'service_role' is also NULL, which `if` treats as false, so the old
  -- `if v_caller_role <> 'service_role' then raise` guard FAILED OPEN for
  -- exactly the callers (pg_cron, a raw psql session authenticated as the
  -- service_role Postgres role) that most need this branch to work, not a
  -- forged 'system'/'admin' claim to be silently accepted. Falling back to
  -- current_setting('role', true) — the actual Postgres role of the current
  -- session, always non-null — and using `is distinct from` (which, unlike
  -- <>, treats NULL as a real, non-matching value instead of propagating it)
  -- closes that gap without changing behavior for any PostgREST-authenticated
  -- caller (where auth.role() already reflects the JWT's role claim).
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
begin
  -- 1. Lock the row (§10 point 1) — this is also what makes concurrent
  --    transitions on the same order serialize instead of racing.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'transition_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_from_status := v_order.status;

  -- Authorization, part 1: the actor must have a real relationship to the
  -- order, proven by the SESSION making the call (auth.uid()/auth.role()),
  -- never by the p_actor_id/p_actor_type arguments alone.
  if p_actor_type = 'customer' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor_id or v_caller_uid is distinct from v_order.customer_id then
      raise exception 'transition_order: actor is not the customer on order %', p_order_id;
    end if;
    -- Authorization, part 2 (this migration's fix): which edges this actor
    -- TYPE may drive, independent of whether the edge is legal for the
    -- order's current status. See file header.
    if p_to_status <> 'cancelled_by_customer' then
      raise exception 'transition_order: actor_type=customer may not drive an order to %— only cancelled_by_customer', p_to_status;
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
    -- No `authenticated`-reachable admin surface exists yet — reserved for
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
      raise exception 'transition_order: actor_type=admin may not drive an order to %— only cancelled_by_platform', p_to_status;
    end if;
  elsif p_actor_type = 'system' then
    -- Reserved for pg_cron / the dispatch orchestrator / capture_payment's
    -- internal call, all of which run with the service-role key.
    if v_caller_role is distinct from 'service_role' then
      raise exception 'transition_order: actor_type=system requires the service-role key';
    end if;
    if p_to_status not in ('placed', 'cancelled_by_platform', 'rider_assigned') then
      raise exception 'transition_order: actor_type=system may not drive an order to %', p_to_status;
    end if;
  else
    raise exception 'transition_order: unknown actor_type %', p_actor_type;
  end if;

  -- 2. Validate against the explicit allowed-transitions table — a second,
  --    independent gate: even an actor type cleared to request p_to_status
  --    in principle still can't skip the state machine (e.g. a vendor
  --    can't request 'preparing' on an order still sitting in 'placed'
  --    without going through 'accepted' first — 'preparing' is only a
  --    legal edge FROM 'accepted').
  if not exists (
    select 1 from order_status_transitions
    where from_status = v_from_status and to_status = p_to_status
  ) then
    raise exception 'transition_order: illegal transition % -> % for order %',
      v_from_status, p_to_status, p_order_id
      using errcode = 'check_violation';
  end if;

  -- 2.5 (this migration, 0035) — THE fix. A transition INTO 'delivered' is
  --     refused unless this order's escrow has already been released. See
  --     file header for the full reasoning, including why this applies
  --     unconditionally to every actor_type with no admin/system override.
  --     verify_delivery_and_release_escrow() inserts exactly this
  --     "<order.code>-escrow"-referenced row BEFORE its own internal call to
  --     transition_order(..., 'delivered', ...) in the same transaction
  --     (0020/0025), so the legitimate path always satisfies this check;
  --     any direct rider/vendor/admin/system call that hasn't gone through
  --     that function never has this row and is refused here.
  if p_to_status = 'delivered' and not exists (
    select 1 from transactions where reference = v_order.code || '-escrow'
  ) then
    raise exception 'transition_order: order % cannot be marked delivered before its escrow has been released — call verify_delivery_and_release_escrow() with the customer''s delivery code instead', p_order_id
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

  -- 4. Insert the order_events row — same transaction, always.
  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (p_order_id, v_from_status, p_to_status, p_actor_type, p_actor_id, p_meta);

  -- 5. Return the new state; a Postgres Changes subscription on `orders`
  --    propagates it over Realtime (§8).
  return v_order;
end;
$$;

comment on function transition_order(uuid, order_status, text, uuid, jsonb) is
  'The only writer of orders.status. Mirrors packages/domain/src/order-state-machine.ts — keep both in sync. §10. Actor identity is derived from auth.uid()/auth.role(), not trusted from p_actor_id/p_actor_type alone (0015), each actor TYPE is further restricted to the specific p_to_status values it is legitimately allowed to request (0018), and a transition INTO ''delivered'' additionally requires this order''s escrow to already be released — i.e. a "<order.code>-escrow" transactions row must already exist — with no admin/system override (0030_require_escrow_release_before_delivered.sql). The only caller that can ever satisfy that last check is verify_delivery_and_release_escrow() (0020/0025), which inserts that row before making its own internal call here.';

-- Grants are unchanged — still callable by `authenticated` for
-- customer/vendor/rider actor types; system/admin actor types are rejected
-- inside the function body for any caller whose role isn't service_role.
revoke execute on function transition_order(uuid, order_status, text, uuid, jsonb) from public;
grant execute on function transition_order(uuid, order_status, text, uuid, jsonb) to authenticated, service_role;
