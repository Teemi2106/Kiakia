-- KiaKia — customer wallet (v1).
--
-- WHAT THIS IS FOR. Today a cancelled or rejected order takes the long way
-- home: 0041_auto_refund_on_cancellation.sql reverses KiaKia's own ledger
-- (DR platform:escrow / CR platform:gateway), and then the app has to ask
-- Monnify to actually push the money back to the customer's card
-- (0043_monnify_refund_tracking.sql, lib/monnify.ts's initiateRefund()).
-- That round-trip costs a gateway fee, takes days to settle on a card, and
-- has a 'failed' state 0043's own comment says "needs a human, not a blind
-- retry". Crediting a wallet instead is a single ledger row: instant, free,
-- and with no failure mode to reconcile.
--
-- SCOPE OF THIS VERSION, deliberately narrow (product decision, 2026-08-28):
--
--   * Money gets IN one way only — a refunded order. There is no top-up
--     flow, no standalone (order-less) payment, and so `payments.order_id`
--     stays NOT NULL and nothing here touches the Monnify inbound path.
--     The platform therefore never holds a naira it was not already holding
--     in escrow a moment earlier, which keeps this well clear of the
--     stored-value/e-money question a fundable wallet would raise.
--
--   * Money gets OUT two ways — spent on a future order
--     (pay_order_from_wallet() below), or, if a customer would rather have
--     it back on their card, by an admin refunding to the gateway instead
--     (refund_order_escrow(..., p_destination => 'gateway'), which keeps
--     the existing Monnify path intact). There is no self-serve bank
--     withdrawal; that needs Monnify Disbursements plus account
--     verification and is not in this migration.
--
--   * A wallet pays for a WHOLE order or none of it. No wallet+card split,
--     so an order still has exactly one funding source and capture, escrow
--     re-derivation and refund routing all stay single-source.
--
-- LEDGER SHAPE. The wallet is a platform liability to the customer and is a
-- plain double-entry account like every other, so 0005_ledger.sql's
-- `ledger_entries_balance_check` invariant covers it untouched:
--
--   order refunded         DR platform:escrow    CR customer:wallet
--   order paid from wallet DR customer:wallet    CR platform:escrow
--   admin card refund      DR platform:escrow    CR platform:gateway  (unchanged)

-- ---------------------------------------------------------------------------
-- 1. Schema — three widened CHECK constraints, nothing structural.
-- ---------------------------------------------------------------------------

-- `accounts` was written for the three parties that get PAID (0005). A
-- customer is now also an account holder, because money can sit with them.
alter table accounts drop constraint if exists accounts_owner_type_check;
alter table accounts
  add constraint accounts_owner_type_check
  check (owner_type in ('platform', 'vendor', 'rider', 'customer'));

-- Deliberately a distinct kind rather than reusing 'available': for a vendor
-- or rider, 'available' means "earned, withdrawable at payout time" and is
-- read by the payout machinery. A customer wallet is not earnings and must
-- never be swept by a payout run, so it gets a name of its own.
alter table accounts drop constraint if exists accounts_kind_check;
alter table accounts
  add constraint accounts_kind_check
  check (kind in ('escrow', 'available', 'pending_payout', 'revenue', 'gateway', 'wallet'));

-- orders.payment_method's existing values are Monnify channels ('card',
-- 'bank_transfer', 'ussd' — 0004_ordering.sql). 'wallet' is not a channel;
-- it records that this order never touched a payment provider at all.
alter table orders drop constraint if exists orders_payment_method_check;
alter table orders
  add constraint orders_payment_method_check
  check (payment_method in ('card', 'bank_transfer', 'ussd', 'wallet'));

-- ---------------------------------------------------------------------------
-- 2. The negative-balance guard.
-- ---------------------------------------------------------------------------
--
-- THIS IS THE LOAD-BEARING PIECE. 0005's whole design is that balances are
-- derived, never stored ("so a balance can never drift from the transactions
-- that produced it") — which also means there is no column to hang a
-- `check (balance >= 0)` off. Two checkouts submitted at the same instant
-- would each read the same ₦5,000, each debit it, and the platform would
-- have honoured ₦10,000 of credit it never held.
--
-- pay_order_from_wallet() below takes a row lock that serialises those two
-- against each other. This trigger is the second, independent line: even if
-- some future caller forgets the lock, or an admin writes entries by hand,
-- a transaction that would leave a customer wallet below zero cannot commit.
-- Modelled directly on ledger_entries_balance_check (0005) — same
-- `after ... deferrable initially deferred` constraint-trigger shape, so it
-- is evaluated once at COMMIT with every row of the transaction in place,
-- not midway through a legitimate multi-row insert.
--
-- Scoped to customer wallets ONLY, and that scoping is essential rather than
-- an optimisation: platform:gateway is DEBITED by capture_payment() and is
-- expected to carry a negative balance representing money received from the
-- outside world. A blanket non-negative rule would reject every capture.
create or replace function check_customer_wallet_not_negative()
returns trigger
language plpgsql
as $$
declare
  v_balance bigint;
begin
  if not exists (
    select 1 from accounts
    where id = new.account_id and owner_type = 'customer' and kind = 'wallet'
  ) then
    return new;
  end if;

  select coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end), 0)
  into v_balance
  from ledger_entries
  where account_id = new.account_id;

  if v_balance < 0 then
    raise exception
      'Customer wallet account % would be overdrawn (resulting balance % kobo) — a wallet can never fund more than it holds',
      new.account_id, v_balance
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists ledger_entries_wallet_not_negative on ledger_entries;
create constraint trigger ledger_entries_wallet_not_negative
  after insert or update on ledger_entries
  deferrable initially deferred
  for each row execute function check_customer_wallet_not_negative();

comment on trigger ledger_entries_wallet_not_negative on ledger_entries is
  'Structural backstop against a customer wallet being overdrawn. pay_order_from_wallet() already serialises concurrent debits with a row lock; this fires regardless of who wrote the entries or whether they remembered to lock.';

-- ---------------------------------------------------------------------------
-- 3. _customer_wallet_account_id(p_customer_id) — find-or-create.
-- ---------------------------------------------------------------------------
--
-- Wallets are created lazily, on the first refund that needs one, rather
-- than seeded for every signup: an account row that has never held a naira
-- is noise, and `accounts` is joined by the reconciliation surfaces.
--
-- The insert races against itself (two refunds landing for the same customer
-- at once), which the existing `unique (owner_type, owner_id, kind)` on
-- `accounts` already makes safe — `on conflict do nothing` plus a re-select
-- turns the loser of that race into a plain lookup instead of an error.
create or replace function _customer_wallet_account_id(p_customer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  if p_customer_id is null then
    raise exception '_customer_wallet_account_id: customer id is required';
  end if;

  select id into v_account_id
  from accounts
  where owner_type = 'customer' and owner_id = p_customer_id and kind = 'wallet';

  if v_account_id is not null then
    return v_account_id;
  end if;

  insert into accounts (owner_type, owner_id, kind)
  values ('customer', p_customer_id, 'wallet')
  on conflict (owner_type, owner_id, kind) do nothing
  returning id into v_account_id;

  if v_account_id is null then
    select id into v_account_id
    from accounts
    where owner_type = 'customer' and owner_id = p_customer_id and kind = 'wallet';
  end if;

  return v_account_id;
end;
$$;

comment on function _customer_wallet_account_id(uuid) is
  'Internal: returns (creating on first use) the customer''s wallet account id. No authorization of its own — every caller is SECURITY DEFINER and owns its own checks. Never grant to authenticated.';

revoke execute on function _customer_wallet_account_id(uuid) from public, authenticated;
grant execute on function _customer_wallet_account_id(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. _unwind_order_escrow_ledger() — refunds now land in the wallet.
-- ---------------------------------------------------------------------------
--
-- Gains a destination. 'wallet' (the default, so 0042's existing two-argument
-- call inside transition_order() picks it up with no change to that function)
-- credits the customer; 'gateway' is the previous behaviour exactly, kept for
-- the admin "put it back on my card" path, which is what still hands
-- lib/monnify.ts's initiateRefund() something to do.
--
-- The old two-argument function is DROPPED rather than left beside this one:
-- a defaulted third parameter alongside the two-argument original would make
-- `_unwind_order_escrow_ledger(id, reason)` ambiguous and break every
-- existing caller at runtime.
--
-- Everything else — the idempotency anchor, the already-released guard, the
-- ledger-derived amount, the payments.status sync — is reproduced unchanged
-- from 0043.
drop function if exists _unwind_order_escrow_ledger(uuid, text);

create or replace function _unwind_order_escrow_ledger(
  p_order_id    uuid,
  p_reason      text,
  p_destination text default 'wallet'
)
returns text -- 'refunded' | 'already_refunded' | 'already_released' | 'nothing_captured'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order               orders;
  v_refund_reference    text;
  v_release_reference   text;
  v_credit_account_id   uuid;
  v_escrow_account_id   uuid;
  v_transaction_id      uuid;
  v_captured_kobo       bigint;
begin
  if p_destination not in ('wallet', 'gateway') then
    raise exception '_unwind_order_escrow_ledger: unknown refund destination %', p_destination;
  end if;

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

  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';
  if v_escrow_account_id is null then
    raise exception '_unwind_order_escrow_ledger: platform escrow account is not seeded';
  end if;

  if p_destination = 'wallet' then
    v_credit_account_id := _customer_wallet_account_id(v_order.customer_id);
  else
    select id into v_credit_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'gateway';
  end if;

  if v_credit_account_id is null then
    raise exception '_unwind_order_escrow_ledger: no % account available to refund order % into', p_destination, p_order_id;
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
  values (
    'refund',
    v_refund_reference,
    p_order_id,
    coalesce('Escrow refunded to ' || p_destination || ': ' || p_reason, 'Escrow refunded to ' || p_destination)
  )
  returning id into v_transaction_id;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_escrow_account_id, 'debit', v_captured_kobo, 'refund', p_order_id),
    (v_transaction_id, v_credit_account_id, 'credit', v_captured_kobo, 'refund', p_order_id);

  update orders set payment_status = 'refunded' where id = p_order_id;

  -- Only meaningful for an order that was actually paid through Monnify; an
  -- order paid from the wallet has no payments row at all, and this matches
  -- nothing, which is correct rather than an error.
  update payments set status = 'refunded' where idempotency_key = v_order.code and status = 'success';

  return 'refunded';
end;
$$;

comment on function _unwind_order_escrow_ledger(uuid, text, text) is
  'Internal primitive shared by refund_order_escrow() (admin-triggered) and transition_order() (automatic, on rejected_by_vendor/cancelled_by_customer/cancelled_by_platform) — reverses capture_payment()''s ledger entries for an order''s captured-but-unreleased payment. Credits the customer''s wallet by default (instant, no provider involved); pass p_destination => ''gateway'' for the old card-refund behaviour, which the app layer then follows with lib/monnify.ts''s initiateRefund(). No admin-role check — callers own their own authorization. Idempotent. Never grant to authenticated.';

revoke execute on function _unwind_order_escrow_ledger(uuid, text, text) from public, authenticated;
grant execute on function _unwind_order_escrow_ledger(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. refund_order_escrow() — admins can now choose where the money goes.
-- ---------------------------------------------------------------------------
--
-- Same drop-then-create reasoning as above: a defaulted fourth parameter
-- beside the three-parameter original would make the existing call
-- ambiguous. External behaviour is otherwise byte-for-byte 0041's, with
-- p_destination forwarded to the primitive.
--
-- The default is 'wallet' so an admin refunding a stuck order does the fast,
-- free thing by default; 'gateway' is the deliberate act, for a customer who
-- has actually asked for their money back on their card.
drop function if exists refund_order_escrow(uuid, uuid, text);

create or replace function refund_order_escrow(
  p_order_id    uuid,
  p_actor_id    uuid,
  p_reason      text,
  p_destination text default 'wallet'
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order         orders;
  v_caller_role   text := coalesce(auth.role(), current_setting('role', true));
  v_unwind_result text;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'refund_order_escrow: requires the service-role key';
  end if;

  if p_actor_id is null or not exists (
    select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
  ) then
    raise exception 'refund_order_escrow: actor % is not an admin', p_actor_id;
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'refund_order_escrow: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  v_unwind_result := _unwind_order_escrow_ledger(p_order_id, p_reason, p_destination);

  if v_unwind_result = 'already_refunded' then
    select * into v_order from orders where id = p_order_id;
    return v_order;
  end if;

  if v_unwind_result = 'already_released' then
    raise exception 'refund_order_escrow: order % escrow has already been released to vendor/rider/platform — refusing to refund and pay out twice', p_order_id
      using errcode = 'check_violation';
  end if;

  if v_unwind_result = 'nothing_captured' then
    raise exception 'refund_order_escrow: order % has no captured payment held in escrow to refund (payment_status=%)', p_order_id, v_order.payment_status
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from order_status_transitions
    where from_status = v_order.status and to_status = 'cancelled_by_platform'
  ) then
    v_order := transition_order(
      p_order_id, 'cancelled_by_platform', 'admin', p_actor_id,
      jsonb_build_object('reason', p_reason, 'refund_transaction', v_order.code || '-refund', 'refund_destination', p_destination)
    );
  else
    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (
      p_order_id, v_order.status, v_order.status, 'admin', p_actor_id,
      jsonb_build_object('reason', p_reason, 'refund_transaction', v_order.code || '-refund', 'escrow_refunded', true, 'refund_destination', p_destination)
    );
    select * into v_order from orders where id = p_order_id;
  end if;

  return v_order;
end;
$$;

comment on function refund_order_escrow(uuid, uuid, text, text) is
  'Reverses capture_payment()''s ledger entries for an order whose escrow has NOT yet been released (via _unwind_order_escrow_ledger()) — refuses outright if escrow was already released (never pay out AND refund the same order). Credits the customer''s wallet unless p_destination => ''gateway'', which is the card-refund path the app follows with a real Monnify call. Idempotent. Moves the order to cancelled_by_platform if a legal edge exists from its current status; otherwise records the refund on order_events without inventing a status transition. service_role callers only, with a real admin/superadmin user_roles row for p_actor_id. Never grant to authenticated.';

revoke execute on function refund_order_escrow(uuid, uuid, text, text) from public, authenticated;
grant execute on function refund_order_escrow(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. pay_order_from_wallet(p_order_id) — the spend path.
-- ---------------------------------------------------------------------------
--
-- The wallet counterpart of capture_payment(): it moves the order's total
-- from the customer's wallet into platform:escrow and takes the order
-- draft -> placed, so everything downstream (vendor accept, dispatch,
-- delivery-code verification, escrow release, refund-on-cancel) works on a
-- wallet-funded order without knowing or caring that no card was involved.
--
-- Unlike capture_payment() this one IS callable by `authenticated` — it is
-- the customer spending their own balance, not a webhook. Which is exactly
-- why it re-derives everything from the database and trusts no argument but
-- the order id:
--
--   * the caller must be the order's own customer (auth.uid()), not merely
--     signed in;
--   * the amount is orders.total_kobo, never a caller-supplied figure;
--   * the balance is summed from ledger_entries at call time under a lock,
--     never read from a client-side value.
--
-- LOCK ORDER: order row first, then the wallet account row — the same order
-- _unwind_order_escrow_ledger() takes (it locks the order, then reaches the
-- wallet through _customer_wallet_account_id()), so a refund landing at the
-- same moment as a spend cannot deadlock against it.
create or replace function pay_order_from_wallet(p_order_id uuid)
returns orders
language plpgsql
security definer
set search_path = public
as $$
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

  -- Not merely "is this person a customer" — is this THEIR order. RLS would
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
  -- and "was this captured through Monnify" stay independently checkable —
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

  -- 'system', not 'customer': identical to capture_payment()'s own call, and
  -- what 0015's actor-forgery hardening expects from a SECURITY DEFINER
  -- function recording a payment-driven transition.
  return transition_order(p_order_id, 'placed', 'system', null, jsonb_build_object(
    'payment_method', 'wallet',
    'wallet_transaction', v_reference,
    'paid_amount_kobo', v_order.total_kobo
  ));
end;
$$;

comment on function pay_order_from_wallet(uuid) is
  'Pays a draft order in full from the calling customer''s wallet (DR customer:wallet / CR platform:escrow) and takes it draft -> placed, so the rest of the order lifecycle is identical to a card-funded order. Callable by authenticated because it is the customer spending their own balance — it re-derives the caller, the amount and the balance server-side and trusts only the order id. Serialises concurrent debits on the wallet account row; the balance can never go negative.';

revoke execute on function pay_order_from_wallet(uuid) from public;
grant execute on function pay_order_from_wallet(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Customer-facing reads.
-- ---------------------------------------------------------------------------
--
-- 0024_lock_down_account_balances_view.sql revoked account_balances from
-- authenticated outright, and correctly so — it exposes every account on the
-- platform. These two functions are the narrowly-scoped alternative that
-- migration anticipated ("their own narrowly-scoped read policy or RPC"):
-- each answers only for auth.uid()'s own wallet, with no parameter that
-- could point them at anybody else's.

create or replace function get_wallet_balance()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller  uuid := auth.uid();
  v_balance bigint;
begin
  if v_caller is null then
    raise exception 'get_wallet_balance: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  -- A customer who has never had a refund has no wallet account and no
  -- entries; that is a zero balance, not an error, and deliberately does not
  -- create an account as a side effect of merely looking.
  select coalesce(sum(case when e.direction = 'credit' then e.amount_kobo else -e.amount_kobo end), 0)
  into v_balance
  from ledger_entries e
  join accounts a on a.id = e.account_id
  where a.owner_type = 'customer' and a.owner_id = v_caller and a.kind = 'wallet';

  return coalesce(v_balance, 0);
end;
$$;

comment on function get_wallet_balance() is
  'The calling customer''s own wallet balance in kobo, derived from ledger_entries. Takes no arguments by design — there is no way to ask it about another user. Zero for a customer who has never been refunded.';

revoke execute on function get_wallet_balance() from public;
grant execute on function get_wallet_balance() to authenticated, service_role;

create or replace function get_wallet_transactions(p_limit int default 50)
returns table (
  created_at   timestamptz,
  direction    text,
  amount_kobo  bigint,
  entry_type   text,
  order_id     uuid,
  order_code   text,
  description  text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'get_wallet_transactions: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    e.created_at,
    e.direction,
    e.amount_kobo,
    e.entry_type,
    e.order_id,
    o.code,
    t.description
  from ledger_entries e
  join accounts a on a.id = e.account_id
  join transactions t on t.id = e.transaction_id
  left join orders o on o.id = e.order_id
  where a.owner_type = 'customer' and a.owner_id = v_caller and a.kind = 'wallet'
  order by e.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

comment on function get_wallet_transactions(int) is
  'The calling customer''s own wallet ledger, newest first. Same no-arguments-that-identify-a-user design as get_wallet_balance(); p_limit is clamped server-side so a caller cannot ask for an unbounded scan.';

revoke execute on function get_wallet_transactions(int) from public;
grant execute on function get_wallet_transactions(int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. capture_payment() — refuse to credit escrow twice for one order.
-- ---------------------------------------------------------------------------
--
-- A new race exists now that an order has two possible funding sources. A
-- customer could open a Monnify checkout session, then pay the same order
-- from their wallet before the card completes; the wallet debit marks the
-- order paid and moves it to 'placed', and the card payment then lands on an
-- order that is already funded. capture_payment()'s existing idempotency is
-- keyed on the PAYMENTS row ("has this payment already succeeded"), which
-- says nothing about a wallet payment, so it would happily credit escrow a
-- second time.
--
-- Rather than duplicating that whole function here, this adds one guard in
-- front of it: if the order is already paid from the wallet, record the
-- second payment on order_events using the exact 'duplicate_capture_attempt'
-- shape 0017 already established for this class of problem, and return
-- without touching the ledger. The money is still at Monnify and still needs
-- a human — flagged, not silently absorbed, and not double-credited.
--
-- 0017's body moves into _capture_payment_via_provider() unchanged (the same
-- extract-then-delegate move 0041 made with _unwind_order_escrow_ledger), so
-- the provider capture logic — amount-mismatch detection, the existing
-- same-key/different-ref duplicate handling, the draft -> placed transition
-- — has exactly one definition and cannot drift from the guard in front of it.
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
    raise exception '_capture_payment_via_provider: no payment row found for idempotency_key % — placeOrderAction should have inserted one at checkout time', p_idempotency_key;
  end if;

  if v_payment.status = 'success' then
    if p_provider_ref is distinct from v_payment.provider_ref then
      raise warning '_capture_payment_via_provider: a second payment (provider_ref %) was captured for order % which is already paid via provider_ref % (idempotency_key=%) — funds may need manual reconciliation',
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

  v_amount_mismatch := p_amount_kobo <> v_order.total_kobo;
  if v_amount_mismatch then
    raise warning '_capture_payment_via_provider: paid amount % kobo does not match order %''s total of % kobo (idempotency_key=%)',
      p_amount_kobo, p_order_id, v_order.total_kobo, p_idempotency_key;
  end if;

  update payments
  set status = 'success', channel = p_channel, raw = p_raw, provider_ref = p_provider_ref
  where id = v_payment.id;

  select id into v_gateway_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'gateway';
  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';

  if v_gateway_account_id is null or v_escrow_account_id is null then
    raise exception '_capture_payment_via_provider: platform gateway/escrow accounts are not seeded';
  end if;

  insert into transactions (kind, reference, order_id, description)
  values ('payment_capture', p_idempotency_key, p_order_id, 'Payment captured via ' || p_provider)
  returning id into v_transaction_id;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_gateway_account_id, 'debit', p_amount_kobo, 'payment_capture', p_order_id),
    (v_transaction_id, v_escrow_account_id, 'credit', p_amount_kobo, 'payment_capture', p_order_id);

  update orders set payment_status = 'paid', payment_method = p_channel where id = p_order_id;

  return transition_order(p_order_id, 'placed', 'system', null, jsonb_build_object(
    'provider', p_provider,
    'provider_ref', p_provider_ref,
    'amount_mismatch', v_amount_mismatch,
    'paid_amount_kobo', p_amount_kobo,
    'expected_total_kobo', v_order.total_kobo
  ));
end;
$$;

comment on function _capture_payment_via_provider(uuid, text, text, bigint, jsonb, text, text) is
  'Internal: 0017_fix_capture_payment_amount_mismatch.sql''s capture body, extracted unchanged so capture_payment() can guard in front of it without duplicating it. No authorization of its own — capture_payment() is the only caller and owns that. Never grant to authenticated.';

revoke execute on function _capture_payment_via_provider(uuid, text, text, bigint, jsonb, text, text) from public, authenticated;
grant execute on function _capture_payment_via_provider(uuid, text, text, bigint, jsonb, text, text) to service_role;

-- `create or replace` cannot rename an existing parameter (Postgres error
-- 42P13), and this reorders p_provider/p_provider_ref/p_idempotency_key
-- relative to 0017's original — same drop-then-create reasoning as
-- get_rider_offer_details() (0044) and this file's own
-- _unwind_order_escrow_ledger()/refund_order_escrow(). The argument TYPE
-- list (uuid, text, text, bigint, jsonb, text, text) is unchanged from
-- 0017, so this resolves to the existing function regardless of its
-- parameter names.
drop function if exists capture_payment(uuid, text, text, bigint, jsonb, text, text);

create or replace function capture_payment(
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
as $$
declare
  v_order orders;
begin
  select * into v_order from orders where id = p_order_id;

  if found and v_order.payment_method = 'wallet' and v_order.payment_status = 'paid' then
    raise warning 'capture_payment: order % was already paid from the customer wallet — refusing to credit escrow a second time for provider_ref % (idempotency_key=%); this payment needs manual reconciliation',
      p_order_id, p_provider_ref, p_idempotency_key;

    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (p_order_id, v_order.status, v_order.status, 'system', null, jsonb_build_object(
      'duplicate_capture_attempt', true,
      'already_paid_via', 'wallet',
      'new_provider_ref', p_provider_ref,
      'new_amount_kobo', p_amount_kobo
    ));

    -- Mark the payment row itself so it is visible as a real, uncredited
    -- payment rather than sitting at 'pending' forever.
    update payments
    set status = 'success', channel = p_channel, raw = p_raw, provider_ref = p_provider_ref
    where idempotency_key = p_idempotency_key and status = 'pending';

    return v_order;
  end if;

  return _capture_payment_via_provider(
    p_order_id, p_provider_ref, p_idempotency_key, p_amount_kobo, p_raw, p_provider, p_channel
  );
end;
$$;

comment on function capture_payment(uuid, text, text, bigint, jsonb, text, text) is
  'Called only from the Monnify webhook handler via the service-role client. Never grant to authenticated. Refuses to credit escrow for an order already paid from the customer''s wallet (flagged on order_events as a duplicate_capture_attempt, same shape as 0017''s); otherwise delegates unchanged to _capture_payment_via_provider().';

revoke execute on function capture_payment(uuid, text, text, bigint, jsonb, text, text) from public, authenticated;
grant execute on function capture_payment(uuid, text, text, bigint, jsonb, text, text) to service_role;
