-- KiaKia - two payment-path defects found by end-to-end QA against the live
-- project: (1) wallet checkout has never worked, (2) a card payment that does
-- not match the order total is booked as if it did and then jams the order.
--
-- 1. WALLET PAYMENT. pay_order_from_wallet() is SECURITY DEFINER and ends by
--    calling transition_order(..., 'system', ...). transition_order() gates the
--    'system' actor on the CALLER holding the service-role key (0018/0050), and
--    a customer paying from their own session never does, so every wallet
--    payment raised "actor_type=system requires the service-role key" and
--    rolled back. Card capture only worked because the webhook IS service role.
--    Fix: split transition_order() into a public gate (the actor checks, kept
--    verbatim) and _transition_order_core() (everything after them - legality
--    table, escrow guard, timestamps, auto-refund, event row). The two
--    payment-driven callers, which have already authorized themselves, call
--    the core directly. The core is granted to nobody; only SECURITY DEFINER
--    functions owned by the same role can reach it, so no client can skip the
--    actor gate.
--
-- 2. AMOUNT MISMATCH. _capture_payment_via_provider() only warned when the paid
--    amount differed from total_kobo, then credited escrow with the paid amount
--    and placed the order. verify_delivery_and_release_escrow() insists escrow
--    holds exactly total_kobo, so the order went through acceptance, dispatch
--    and delivery and then refused to pay anyone out, leaving escrow locked
--    until an admin cancelled it. Now:
--      - paid == total: unchanged.
--      - paid  > total: escrow is credited exactly total_kobo; the excess goes
--                       to the customer's wallet in the same balanced ledger
--                       transaction. The order proceeds normally.
--      - paid  < total: the order is NOT placed. The money that arrived is
--                       booked gateway -> customer wallet (kind 'refund',
--                       idempotent per provider reference so a webhook replay
--                       cannot double-credit), the payments row is left
--                       pending so the customer can retry in full, and an
--                       order_events row records the shortfall.
--    The amount-mismatch warning is gone: it described a state we now refuse
--    to enter.
--
-- Both functions below are reproduced from the LIVE definitions (pg_get_
-- functiondef), not from earlier migrations - see 0070's header for why
-- copying an older migration's body is how these regressions happen.

-- ---------------------------------------------------------------------------
-- transition_order(): internal core + public gate
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._transition_order_core(p_order_id uuid, p_to_status order_status, p_actor_type text, p_actor_id uuid, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order       orders;
  v_from_status order_status;
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
$function$
;

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
as $function$
declare
  v_order       orders;
  v_caller_uid  uuid := auth.uid();
  -- auth.role() is NULL for a direct pg_cron/psql connection with no JWT
  -- claims; comparing NULL <> 'service_role' is NULL, which `if` treats as
  -- false, so a plain `<>` would fail OPEN for exactly the callers that most
  -- need the service-role branches below. coalesce + `is distinct from`
  -- closes that (S1, 0018/0030/0050).
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'transition_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

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

  return _transition_order_core(p_order_id, p_to_status, p_actor_type, p_actor_id, p_meta);
end;
$function$;

-- ---------------------------------------------------------------------------
-- pay_order_from_wallet(): call the core instead of the gated function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pay_order_from_wallet(p_order_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order              orders;
  v_caller             uuid := auth.uid();
  v_wallet_account_id  uuid;
  v_escrow_account_id  uuid;
  v_balance_kobo       bigint;
  v_transaction_id     uuid;
  v_reference          text;
begin
  if v_caller is null then
    raise exception 'pay_order_from_wallet: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'pay_order_from_wallet: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- Not merely "is this person a customer" - is this THEIR order. RLS would
  -- also stop them reading it, but this function is SECURITY DEFINER and so
  -- runs with RLS bypassed; the check has to be explicit here.
  if v_order.customer_id is distinct from v_caller then
    raise exception 'pay_order_from_wallet: order % does not belong to the calling user', p_order_id
      using errcode = 'insufficient_privilege';
  end if;

  -- Same gate the card path enforces implicitly by only ever capturing
  -- against a draft/pending order. Paying twice, or paying an order that is
  -- already live, must be impossible rather than merely unlikely.
  if v_order.status <> 'draft' or v_order.payment_status <> 'pending' then
    raise exception 'pay_order_from_wallet: order % is not awaiting payment (status=%, payment_status=%)',
      p_order_id, v_order.status, v_order.payment_status
      using errcode = 'check_violation';
  end if;

  if v_order.total_kobo <= 0 then
    raise exception 'pay_order_from_wallet: order % has a non-positive total', p_order_id
      using errcode = 'check_violation';
  end if;

  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';
  if v_escrow_account_id is null then
    raise exception 'pay_order_from_wallet: platform escrow account is not seeded';
  end if;

  v_wallet_account_id := _customer_wallet_account_id(v_caller);

  -- THE serialisation point. Balances are derived (0005), so nothing else
  -- stops two concurrent checkouts from both reading the same balance and
  -- both spending it. Every wallet debit takes this same row lock first, so
  -- they queue instead of racing. The constraint trigger in section 2 above
  -- is the backstop if this is ever bypassed.
  perform 1 from accounts where id = v_wallet_account_id for update;

  select coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end), 0)
  into v_balance_kobo
  from ledger_entries
  where account_id = v_wallet_account_id;

  if v_balance_kobo < v_order.total_kobo then
    raise exception 'pay_order_from_wallet: wallet balance % kobo does not cover order total % kobo',
      v_balance_kobo, v_order.total_kobo
      using errcode = 'check_violation';
  end if;

  -- A distinct suffix from capture_payment()'s anchor (which is the bare
  -- order code, via its idempotency_key) so "was this paid from the wallet"
  -- and "was this captured through Monnify" stay independently checkable -
  -- the same reasoning 0031 gives for '-escrow' vs '-refund'. The unique
  -- constraint on transactions.reference is what makes a double-submit a
  -- hard failure rather than a second debit.
  v_reference := v_order.code || '-wallet';

  insert into transactions (kind, reference, order_id, description)
  values ('payment_capture', v_reference, p_order_id, 'Paid from customer wallet')
  returning id into v_transaction_id;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_wallet_account_id, 'debit', v_order.total_kobo, 'payment_capture', p_order_id),
    (v_transaction_id, v_escrow_account_id, 'credit', v_order.total_kobo, 'payment_capture', p_order_id);

  update orders set payment_status = 'paid', payment_method = 'wallet' where id = p_order_id;

  -- 'system', not 'customer', and through the internal core rather than the
  -- public transition_order(): that one gates 'system' on the CALLER holding
  -- the service-role key, which this function's caller (the customer's own
  -- session) never does - it failed every wallet payment with 'actor_type=
  -- system requires the service-role key'. This function has already proven
  -- the caller owns the order and that the payment is booked, so it is the
  -- authorization boundary here, exactly as capture_payment() is for card.
  return _transition_order_core(p_order_id, 'placed', 'system', null, jsonb_build_object(
    'payment_method', 'wallet',
    'wallet_transaction', v_reference,
    'paid_amount_kobo', v_order.total_kobo
  ));
end;
$function$
;

-- ---------------------------------------------------------------------------
-- _capture_payment_via_provider(): exact / over / under payment handling
-- ---------------------------------------------------------------------------


create or replace function _capture_payment_via_provider(
  p_order_id        uuid,
  p_provider_ref    text,
  p_idempotency_key text,
  p_amount_kobo     bigint,
  p_raw             jsonb,
  p_provider        text default 'monnify',
  p_channel         text default null
)
returns orders
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment             payments;
  v_gateway_account_id  uuid;
  v_escrow_account_id   uuid;
  v_wallet_account_id   uuid;
  v_transaction_id      uuid;
  v_order               orders;
  v_excess_kobo         bigint;
  v_underpay_reference  text;
begin
  select * into v_payment from payments where idempotency_key = p_idempotency_key for update;
  if not found then
    raise exception '_capture_payment_via_provider: no payment row found for idempotency_key % - placeOrderAction should have inserted one at checkout time', p_idempotency_key;
  end if;

  if v_payment.status = 'success' then
    if p_provider_ref is distinct from v_payment.provider_ref then
      raise warning '_capture_payment_via_provider: a second payment (provider_ref %) was captured for order % which is already paid via provider_ref % (idempotency_key=%) - funds may need manual reconciliation',
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
    raise exception '_capture_payment_via_provider: order % does not exist', p_order_id;
  end if;

  select id into v_gateway_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'gateway';
  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';

  if v_gateway_account_id is null or v_escrow_account_id is null then
    raise exception '_capture_payment_via_provider: platform gateway/escrow accounts are not seeded';
  end if;

  -- Underpaid: never place the order. Book the money that actually arrived
  -- into the customer's wallet so it is neither lost nor left unrecorded.
  if p_amount_kobo < v_order.total_kobo then
    v_underpay_reference := v_order.code || '-underpay-' || p_provider_ref;

    -- Webhook/redirect replay of the same short payment: already booked.
    if exists (select 1 from transactions where reference = v_underpay_reference) then
      return v_order;
    end if;

    v_wallet_account_id := _customer_wallet_account_id(v_order.customer_id);

    insert into transactions (kind, reference, order_id, description)
    values ('refund', v_underpay_reference, p_order_id, 'Underpaid card payment credited to customer wallet')
    returning id into v_transaction_id;

    insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
    values
      (v_transaction_id, v_gateway_account_id, 'debit',  p_amount_kobo, 'refund', p_order_id),
      (v_transaction_id, v_wallet_account_id,  'credit', p_amount_kobo, 'refund', p_order_id);

    -- payments row stays 'pending' (and keeps its provider_ref) so
    -- initializePaymentForOrder can refresh it for a full-amount retry.
    update payments set raw = p_raw where id = v_payment.id;

    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (p_order_id, v_order.status, v_order.status, 'system', null, jsonb_build_object(
      'underpaid_capture', true,
      'provider', p_provider,
      'provider_ref', p_provider_ref,
      'paid_amount_kobo', p_amount_kobo,
      'expected_total_kobo', v_order.total_kobo,
      'credited_to_wallet_kobo', p_amount_kobo
    ));

    return v_order;
  end if;

  v_excess_kobo := p_amount_kobo - v_order.total_kobo;

  update payments
  set status = 'success', channel = p_channel, raw = p_raw, provider_ref = p_provider_ref
  where id = v_payment.id;

  insert into transactions (kind, reference, order_id, description)
  values ('payment_capture', p_idempotency_key, p_order_id, 'Payment captured via ' || p_provider)
  returning id into v_transaction_id;

  -- One balanced transaction in ONE statement: the gateway debit equals
  -- escrow (exactly the order total, which is what release later insists on)
  -- plus any excess routed to the customer's wallet. A single statement keeps
  -- the balance check satisfied even if the constraint trigger is ever run
  -- immediate rather than deferred.
  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_gateway_account_id, 'debit', p_amount_kobo, 'payment_capture', p_order_id
  union all
  select v_transaction_id, v_escrow_account_id, 'credit', v_order.total_kobo, 'payment_capture', p_order_id
  union all
  select v_transaction_id, _customer_wallet_account_id(v_order.customer_id), 'credit', v_excess_kobo, 'refund', p_order_id
  where v_excess_kobo > 0;

  update orders set payment_status = 'paid', payment_method = p_channel where id = p_order_id;

  return _transition_order_core(p_order_id, 'placed', 'system', null, jsonb_build_object(
    'provider', p_provider,
    'provider_ref', p_provider_ref,
    'paid_amount_kobo', p_amount_kobo,
    'expected_total_kobo', v_order.total_kobo,
    'overpaid_kobo', v_excess_kobo
  ));
end;
$function$;

comment on function _capture_payment_via_provider(uuid, text, text, bigint, jsonb, text, text) is
  'Internal: capture body behind capture_payment(). Exact payment: escrow credited with the order total. Overpayment: escrow gets exactly total_kobo, the excess is credited to the customer wallet in the same balanced transaction. Underpayment: the order is NOT placed - the received amount is credited to the customer wallet (idempotent per provider reference) and the payments row stays pending for a full retry. No authorization of its own - capture_payment() is the only caller. Never grant to authenticated.';

comment on function _transition_order_core(uuid, order_status, text, uuid, jsonb) is
  'Everything transition_order() does AFTER its actor authorization: legality table, escrow-released guard for delivered, timestamps, automatic escrow unwind on cancellation, reserved-meta stripping, order_events row. No caller authorization of its own - only SECURITY DEFINER functions that have already authorized themselves (capture, wallet payment) may call it, which is why it is granted to no role.';

comment on function transition_order(uuid, order_status, text, uuid, jsonb) is
  'The only client-reachable writer of orders.status. Actor identity is derived from auth.uid()/auth.role(), never trusted from p_actor_id/p_actor_type (0015); each actor TYPE may request only specific target statuses, with system/admin requiring the service-role key (0018). After those checks it delegates to _transition_order_core() (0075), which holds the legality table, delivered-needs-escrow guard (0030), auto-refund on cancellation (0041/0042) and the reserved-meta stripping (0057).';

-- Reachable by no client role. SECURITY DEFINER callers run as the function
-- owner, which retains execute regardless of these revokes.
revoke all on function _transition_order_core(uuid, order_status, text, uuid, jsonb) from public, anon, authenticated, service_role;
