-- KiaKia - pay part of an order from the wallet and the rest by card.
--
-- 0045 made the wallet all-or-nothing: an order had exactly one funding source.
-- That is now relaxed. A customer whose wallet cannot cover an order can put
-- whatever it holds towards it and pay the remainder by card.
--
-- THE MONEY MODEL. Three steps, each one balanced ledger transaction:
--
--   1. HOLD (hold_wallet_for_order, at checkout, before the card is charged)
--        DR customer:wallet  CR platform:wallet_hold      entry_type 'wallet_hold'
--      The wallet money is moved out of the spendable balance straight away, so
--      it cannot be spent twice while the customer is on the card page. It does
--      NOT enter escrow yet: escrow only ever holds money for an order that has
--      really been paid. That keeps everything that reads escrow (release
--      insisting escrow == total_kobo, the refund unwind, the money summary)
--      correct with no netting rules.
--
--   2a. CAPTURE (the card payment succeeds - _capture_payment_via_provider)
--        DR platform:gateway   (card amount actually paid)
--        DR platform:wallet_hold (the held part)          entry_type 'payment_capture'
--        CR platform:escrow    (exactly total_kobo)
--        CR customer:wallet    (any card overpayment)
--      One statement, so the transaction balances even if the balance trigger
--      is ever run immediate. Escrow is credited exactly total_kobo, as release
--      requires.
--
--   2b. RELEASE (the card payment never happens)
--        DR platform:wallet_hold  CR customer:wallet      entry_type 'wallet_hold_release'
--      Done when the customer chooses to pay another way, abandons the order,
--      or by a cron sweep after 30 minutes. If a card payment still lands
--      after a release it is simply an underpayment against the full total and
--      is credited to the wallet by the existing 0075 path - nothing is lost.
--
-- orders.wallet_applied_kobo records how much of an order the wallet is
-- funding (held or spent). The hold itself is always re-derived from the
-- ledger and must equal it; a mismatch aborts rather than guessing.
--
-- REFUNDS. The automatic refund on cancellation still credits the whole
-- captured amount to the wallet (instant, as before). An admin "refund to the
-- card" now sends only the card part to platform:gateway and returns the
-- wallet part to the wallet, so Monnify is asked for exactly the card amount.
-- This also fixes a latent hole: a fully wallet-paid order refunded "to the
-- gateway" used to credit the gateway account although Monnify never held
-- that money.
--
-- LOCK ORDER everywhere: order row first, then the wallet account row, then
-- (capture only) the payments row. The previous capture took payments before
-- the order, the reverse of the refund unwind; the order is now locked first.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

alter table accounts drop constraint if exists accounts_kind_check;
alter table accounts
  add constraint accounts_kind_check
  check (kind in ('escrow', 'available', 'pending_payout', 'revenue', 'gateway', 'wallet', 'wallet_hold'));

-- One platform-wide account. unique (owner_type, owner_id, kind) does not
-- protect a NULL owner_id, so the insert guards itself.
insert into accounts (owner_type, owner_id, kind)
select 'platform', null, 'wallet_hold'
where not exists (
  select 1 from accounts where owner_type = 'platform' and owner_id is null and kind = 'wallet_hold'
);

alter table orders
  add column wallet_applied_kobo bigint not null default 0,
  add column wallet_held_at timestamptz;

comment on column orders.wallet_applied_kobo is
  'How much of total_kobo the customer wallet is funding: held while the order is a draft awaiting its card payment, or spent once paid. 0 for a card-only order. A full wallet payment sets it to total_kobo.';
comment on column orders.wallet_held_at is
  'When the wallet hold was taken; null when nothing is held. Drives the 30 minute expiry sweep.';

-- Orders paid entirely from the wallet before this migration: derive from the
-- ledger rather than assume.
update orders o
set wallet_applied_kobo = least(x.paid, o.total_kobo)
from (
  select le.order_id, sum(le.amount_kobo) as paid
  from ledger_entries le
  join accounts a on a.id = le.account_id
  where a.owner_type = 'customer' and a.kind = 'wallet'
    and le.direction = 'debit' and le.entry_type = 'payment_capture'
    and le.order_id is not null
  group by le.order_id
) x
where o.id = x.order_id;

alter table orders
  add constraint orders_wallet_applied_check
  check (wallet_applied_kobo >= 0 and wallet_applied_kobo <= total_kobo);

-- Backstop, like ledger_entries_wallet_not_negative: the hold account (and any
-- one order's share of it) can never be overdrawn, whoever writes the rows.
create or replace function check_wallet_hold_not_negative()
returns trigger
language plpgsql
as $$
declare
  v_balance bigint;
begin
  if not exists (
    select 1 from accounts
    where id = new.account_id and owner_type = 'platform' and owner_id is null and kind = 'wallet_hold'
  ) then
    return new;
  end if;

  select coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end), 0)
  into v_balance
  from ledger_entries
  where account_id = new.account_id;

  if v_balance < 0 then
    raise exception 'The wallet hold account would be overdrawn (resulting balance % kobo)', v_balance
      using errcode = 'check_violation';
  end if;

  if new.order_id is not null then
    select coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end), 0)
    into v_balance
    from ledger_entries
    where account_id = new.account_id and order_id = new.order_id;

    if v_balance < 0 then
      raise exception 'Order % would release more wallet money than it holds (resulting hold % kobo)', new.order_id, v_balance
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ledger_entries_wallet_hold_not_negative on ledger_entries;
create constraint trigger ledger_entries_wallet_hold_not_negative
  after insert or update on ledger_entries
  deferrable initially deferred
  for each row execute function check_wallet_hold_not_negative();

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- The smallest card charge we will ask a provider for. A split that would
-- leave a smaller remainder holds less from the wallet instead. 100 naira.
create or replace function _min_card_charge_kobo()
returns bigint
language sql
immutable
as $$ select 10000::bigint $$;

revoke all on function _min_card_charge_kobo() from public, anon, authenticated;

-- What the ledger says is currently held for one order.
create or replace function _order_wallet_hold_kobo(p_order_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(case when le.direction = 'credit' then le.amount_kobo else -le.amount_kobo end), 0)::bigint
  from ledger_entries le
  join accounts a on a.id = le.account_id
  where le.order_id = p_order_id
    and a.owner_type = 'platform' and a.owner_id is null and a.kind = 'wallet_hold';
$$;

revoke all on function _order_wallet_hold_kobo(uuid) from public, anon, authenticated;
grant execute on function _order_wallet_hold_kobo(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. hold_wallet_for_order(p_order_id)
-- ---------------------------------------------------------------------------
--
-- Returns the kobo now held (0 = nothing held: no wallet, no balance, or an
-- order too small to split). Idempotent: a second call returns the existing
-- hold and moves nothing. Callable by the customer, for their own draft order
-- only; it trusts nothing but the order id.

create or replace function hold_wallet_for_order(p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller            uuid := auth.uid();
  v_order             orders;
  v_wallet_account_id uuid;
  v_hold_account_id   uuid;
  v_balance_kobo      bigint;
  v_hold_kobo         bigint;
  v_transaction_id    uuid;
  v_n                 integer;
begin
  if v_caller is null then
    raise exception 'hold_wallet_for_order: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  perform _assert_active_caller();

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'hold_wallet_for_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.customer_id is distinct from v_caller then
    raise exception 'hold_wallet_for_order: order % does not belong to the calling user', p_order_id
      using errcode = 'insufficient_privilege';
  end if;

  if v_order.status <> 'draft' or v_order.payment_status <> 'pending' then
    raise exception 'hold_wallet_for_order: order % is not awaiting payment (status=%, payment_status=%)',
      p_order_id, v_order.status, v_order.payment_status
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from payments where idempotency_key = v_order.code and status = 'success') then
    raise exception 'hold_wallet_for_order: order % has already been paid by card', p_order_id
      using errcode = 'check_violation';
  end if;

  if v_order.wallet_applied_kobo > 0 then
    return v_order.wallet_applied_kobo;
  end if;

  if v_order.total_kobo - _min_card_charge_kobo() <= 0 then
    return 0;
  end if;

  -- Never create a wallet account just because someone looked.
  select id into v_wallet_account_id
  from accounts
  where owner_type = 'customer' and owner_id = v_caller and kind = 'wallet';
  if v_wallet_account_id is null then
    return 0;
  end if;

  select id into v_hold_account_id
  from accounts where owner_type = 'platform' and owner_id is null and kind = 'wallet_hold';
  if v_hold_account_id is null then
    raise exception 'hold_wallet_for_order: platform wallet_hold account is not seeded';
  end if;

  -- THE serialisation point, exactly as in pay_order_from_wallet(): every
  -- wallet debit takes this row lock before reading the derived balance.
  perform 1 from accounts where id = v_wallet_account_id for update;

  select coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end), 0)
  into v_balance_kobo
  from ledger_entries
  where account_id = v_wallet_account_id;

  v_hold_kobo := least(v_balance_kobo, v_order.total_kobo - _min_card_charge_kobo());
  if v_hold_kobo <= 0 then
    return 0;
  end if;

  select count(*) + 1 into v_n
  from transactions
  where order_id = p_order_id and reference like '%-whold-%' and reference not like '%-release';

  insert into transactions (kind, reference, order_id, description)
  values ('adjustment', v_order.code || '-whold-' || v_n, p_order_id, 'Wallet money held for a card + wallet order')
  returning id into v_transaction_id;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_wallet_account_id, 'debit',  v_hold_kobo, 'wallet_hold', p_order_id),
    (v_transaction_id, v_hold_account_id,   'credit', v_hold_kobo, 'wallet_hold', p_order_id);

  update orders set wallet_applied_kobo = v_hold_kobo, wallet_held_at = now() where id = p_order_id;

  return v_hold_kobo;
end;
$$;

comment on function hold_wallet_for_order(uuid) is
  'Moves up to the customer''s wallet balance (leaving at least the minimum card charge for the card) from the wallet into platform:wallet_hold for their own draft order, and records it on orders.wallet_applied_kobo. Returns the kobo held (0 = nothing). Idempotent. The card is then charged total - wallet_applied_kobo. Serialises on the wallet account row; the balance can never go negative.';

revoke execute on function hold_wallet_for_order(uuid) from public, anon;
grant execute on function hold_wallet_for_order(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Releasing a hold
-- ---------------------------------------------------------------------------

-- Internal: no caller authorisation of its own; the public wrapper and the
-- sweep own that. Safe to call repeatedly.
create or replace function _release_wallet_hold(p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order             orders;
  v_held_kobo         bigint;
  v_wallet_account_id uuid;
  v_hold_account_id   uuid;
  v_transaction_id    uuid;
  v_n                 integer;
  v_reference         text;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception '_release_wallet_hold: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.wallet_applied_kobo = 0 then
    return 0;
  end if;

  -- Once the order is paid the wallet money is escrow, not a hold. Releasing
  -- it here would hand the customer money the order is already using.
  if v_order.status <> 'draft' or v_order.payment_status <> 'pending' then
    raise exception '_release_wallet_hold: order % is no longer awaiting payment (status=%, payment_status=%) - its wallet money is committed',
      p_order_id, v_order.status, v_order.payment_status
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from payments where idempotency_key = v_order.code and status = 'success') then
    raise exception '_release_wallet_hold: order % has already been paid by card', p_order_id
      using errcode = 'check_violation';
  end if;

  v_held_kobo := _order_wallet_hold_kobo(p_order_id);
  if v_held_kobo <> v_order.wallet_applied_kobo then
    raise exception '_release_wallet_hold: order % records % kobo from the wallet but the ledger holds % kobo - refusing to move money until this is reconciled',
      p_order_id, v_order.wallet_applied_kobo, v_held_kobo
      using errcode = 'data_exception';
  end if;

  select id into v_hold_account_id
  from accounts where owner_type = 'platform' and owner_id is null and kind = 'wallet_hold';
  v_wallet_account_id := _customer_wallet_account_id(v_order.customer_id);

  select count(*) into v_n
  from transactions
  where order_id = p_order_id and reference like '%-whold-%' and reference not like '%-release';
  if v_n = 0 then
    raise exception '_release_wallet_hold: order % has no hold transaction to release', p_order_id
      using errcode = 'data_exception';
  end if;

  v_reference := v_order.code || '-whold-' || v_n || '-release';

  insert into transactions (kind, reference, order_id, description)
  values ('adjustment', v_reference, p_order_id, 'Wallet hold released back to the customer')
  returning id into v_transaction_id;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_hold_account_id,   'debit',  v_held_kobo, 'wallet_hold_release', p_order_id),
    (v_transaction_id, v_wallet_account_id, 'credit', v_held_kobo, 'wallet_hold_release', p_order_id);

  update orders set wallet_applied_kobo = 0, wallet_held_at = null where id = p_order_id;

  return v_held_kobo;
end;
$$;

revoke all on function _release_wallet_hold(uuid) from public, anon, authenticated;
grant execute on function _release_wallet_hold(uuid) to service_role;

-- The customer giving the money back to themselves ("pay another way",
-- "abandon this order"). No active-account requirement: getting your own
-- money back is never the thing to block.
create or replace function release_wallet_hold(p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_customer uuid;
begin
  if v_caller is null then
    raise exception 'release_wallet_hold: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  select customer_id into v_customer from orders where id = p_order_id;
  if not found then
    raise exception 'release_wallet_hold: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;
  if v_customer is distinct from v_caller then
    raise exception 'release_wallet_hold: order % does not belong to the calling user', p_order_id
      using errcode = 'insufficient_privilege';
  end if;

  return _release_wallet_hold(p_order_id);
end;
$$;

comment on function release_wallet_hold(uuid) is
  'Returns the wallet money held for the caller''s own unpaid draft order to their wallet. Returns the kobo released (0 if nothing was held). Refuses once the order is paid.';

revoke execute on function release_wallet_hold(uuid) from public, anon;
grant execute on function release_wallet_hold(uuid) to authenticated, service_role;

-- Cron sweep: a hold on an order nobody paid for is returned after 30 minutes.
-- skip locked so a payment being captured right now is left alone; each order
-- in its own sub-transaction so one bad row cannot stop the rest.
create or replace function release_expired_wallet_holds(p_older_than interval default interval '30 minutes')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_released integer := 0;
begin
  if p_older_than is null or p_older_than < interval '1 minute' then
    raise exception 'release_expired_wallet_holds: the age threshold must be at least one minute'
      using errcode = 'check_violation';
  end if;

  for v_id in
    select id from orders
    where wallet_applied_kobo > 0
      and status = 'draft' and payment_status = 'pending'
      and wallet_held_at < now() - p_older_than
    order by wallet_held_at
    limit 200
    for update skip locked
  loop
    begin
      perform _release_wallet_hold(v_id);
      v_released := v_released + 1;
    exception when others then
      raise warning 'release_expired_wallet_holds: could not release the hold on order %: %', v_id, sqlerrm;
    end;
  end loop;

  return v_released;
end;
$$;

comment on function release_expired_wallet_holds(interval) is
  'Returns wallet holds older than p_older_than (default 30 minutes) on still-unpaid draft orders to the customers'' wallets. Returns how many were released. service_role / pg_cron only.';

revoke execute on function release_expired_wallet_holds(interval) from public, anon, authenticated;
grant execute on function release_expired_wallet_holds(interval) to service_role;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'release-expired-wallet-holds',
      '*/5 * * * *',
      'set local role service_role; select release_expired_wallet_holds();'
    );
  else
    raise notice 'pg_cron is not enabled; schedule release_expired_wallet_holds() (every 5 minutes, as service_role) once it is.';
  end if;
exception when others then
  raise notice 'could not schedule release-expired-wallet-holds (%); schedule release_expired_wallet_holds() every 5 minutes as service_role.', sqlerrm;
end;
$cron$;

-- ---------------------------------------------------------------------------
-- 5. pay_order_from_wallet() - full wallet payment (0082 body)
-- ---------------------------------------------------------------------------
--
-- Unchanged except: it refuses an order that already carries a split hold (the
-- caller must release it first, so one order never has two wallet postings),
-- and it records wallet_applied_kobo = total so refunds know the whole order
-- came from the wallet.

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

  perform _assert_active_caller();

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'pay_order_from_wallet: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.customer_id is distinct from v_caller then
    raise exception 'pay_order_from_wallet: order % does not belong to the calling user', p_order_id
      using errcode = 'insufficient_privilege';
  end if;

  if v_order.status <> 'draft' or v_order.payment_status <> 'pending' then
    raise exception 'pay_order_from_wallet: order % is not awaiting payment (status=%, payment_status=%)',
      p_order_id, v_order.status, v_order.payment_status
      using errcode = 'check_violation';
  end if;

  if v_order.wallet_applied_kobo > 0 then
    raise exception 'pay_order_from_wallet: order % already has wallet money held for a split payment - release it first', p_order_id
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

  v_reference := v_order.code || '-wallet';

  insert into transactions (kind, reference, order_id, description)
  values ('payment_capture', v_reference, p_order_id, 'Paid from customer wallet')
  returning id into v_transaction_id;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_wallet_account_id, 'debit', v_order.total_kobo, 'payment_capture', p_order_id),
    (v_transaction_id, v_escrow_account_id, 'credit', v_order.total_kobo, 'payment_capture', p_order_id);

  update orders
  set payment_status = 'paid', payment_method = 'wallet', wallet_applied_kobo = v_order.total_kobo
  where id = p_order_id;

  return _transition_order_core(p_order_id, 'placed', 'system', null, jsonb_build_object(
    'payment_method', 'wallet',
    'wallet_transaction', v_reference,
    'paid_amount_kobo', v_order.total_kobo
  ));
end;
$function$
;

-- ---------------------------------------------------------------------------
-- 6. _capture_payment_via_provider() - the card pays total - wallet_applied
-- ---------------------------------------------------------------------------
--
-- Reproduced from 0075's live definition. Changes: the order is locked first;
-- the amount the card must cover is total - wallet_applied_kobo; the held
-- wallet money is consumed in the same balanced ledger statement; and the
-- payment must belong to the order it is being captured against.

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
  v_hold_account_id     uuid;
  v_wallet_account_id   uuid;
  v_transaction_id      uuid;
  v_order               orders;
  v_wallet_part_kobo    bigint;
  v_expected_card_kobo  bigint;
  v_excess_kobo         bigint;
  v_held_kobo           bigint;
  v_underpay_reference  text;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception '_capture_payment_via_provider: order % does not exist', p_order_id;
  end if;

  select * into v_payment from payments where idempotency_key = p_idempotency_key for update;
  if not found then
    raise exception '_capture_payment_via_provider: no payment row found for idempotency_key % - placeOrderAction should have inserted one at checkout time', p_idempotency_key;
  end if;

  if v_payment.order_id is distinct from p_order_id then
    raise exception '_capture_payment_via_provider: payment % belongs to a different order than %', p_idempotency_key, p_order_id
      using errcode = 'check_violation';
  end if;

  if v_payment.status = 'success' then
    if p_provider_ref is distinct from v_payment.provider_ref then
      raise warning '_capture_payment_via_provider: a second payment (provider_ref %) was captured for order % which is already paid via provider_ref % (idempotency_key=%) - funds may need manual reconciliation',
        p_provider_ref, p_order_id, v_payment.provider_ref, p_idempotency_key;

      insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
      values (p_order_id, v_order.status, v_order.status, 'system', null, jsonb_build_object(
        'duplicate_capture_attempt', true,
        'existing_provider_ref', v_payment.provider_ref,
        'new_provider_ref', p_provider_ref,
        'new_amount_kobo', p_amount_kobo
      ));
    end if;

    return v_order;
  end if;

  select id into v_gateway_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'gateway';
  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';

  if v_gateway_account_id is null or v_escrow_account_id is null then
    raise exception '_capture_payment_via_provider: platform gateway/escrow accounts are not seeded';
  end if;

  v_wallet_part_kobo := v_order.wallet_applied_kobo;
  v_expected_card_kobo := v_order.total_kobo - v_wallet_part_kobo;

  if v_expected_card_kobo <= 0 then
    raise exception '_capture_payment_via_provider: order % is fully funded from the wallet and has nothing for a card to pay', p_order_id
      using errcode = 'check_violation';
  end if;

  -- Underpaid (against what the CARD had to cover): never place the order.
  -- Book what arrived into the customer's wallet so it is neither lost nor
  -- unrecorded. Any wallet hold stays in place for a full-amount retry.
  if p_amount_kobo < v_expected_card_kobo then
    v_underpay_reference := v_order.code || '-underpay-' || p_provider_ref;

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

    update payments set raw = p_raw where id = v_payment.id;

    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (p_order_id, v_order.status, v_order.status, 'system', null, jsonb_build_object(
      'underpaid_capture', true,
      'provider', p_provider,
      'provider_ref', p_provider_ref,
      'paid_amount_kobo', p_amount_kobo,
      'expected_card_kobo', v_expected_card_kobo,
      'expected_total_kobo', v_order.total_kobo,
      'credited_to_wallet_kobo', p_amount_kobo
    ));

    return v_order;
  end if;

  if v_wallet_part_kobo > 0 then
    v_held_kobo := _order_wallet_hold_kobo(p_order_id);
    if v_held_kobo <> v_wallet_part_kobo then
      raise exception '_capture_payment_via_provider: order % records % kobo from the wallet but the ledger holds % kobo - refusing to capture until this is reconciled',
        p_order_id, v_wallet_part_kobo, v_held_kobo
        using errcode = 'data_exception';
    end if;

    select id into v_hold_account_id
    from accounts where owner_type = 'platform' and owner_id is null and kind = 'wallet_hold';
    if v_hold_account_id is null then
      raise exception '_capture_payment_via_provider: platform wallet_hold account is not seeded';
    end if;
  end if;

  v_excess_kobo := p_amount_kobo - v_expected_card_kobo;

  update payments
  set status = 'success', channel = p_channel, raw = p_raw, provider_ref = p_provider_ref
  where id = v_payment.id;

  insert into transactions (kind, reference, order_id, description)
  values ('payment_capture', p_idempotency_key, p_order_id, 'Payment captured via ' || p_provider)
  returning id into v_transaction_id;

  -- One balanced transaction in ONE statement:
  --   debits  = card paid + wallet part held
  --   credits = escrow (exactly total_kobo) + any card overpayment to the wallet
  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_gateway_account_id, 'debit', p_amount_kobo, 'payment_capture', p_order_id
  union all
  select v_transaction_id, v_hold_account_id, 'debit', v_wallet_part_kobo, 'payment_capture', p_order_id
  where v_wallet_part_kobo > 0
  union all
  select v_transaction_id, v_escrow_account_id, 'credit', v_order.total_kobo, 'payment_capture', p_order_id
  union all
  select v_transaction_id, _customer_wallet_account_id(v_order.customer_id), 'credit', v_excess_kobo, 'refund', p_order_id
  where v_excess_kobo > 0;

  update orders set payment_status = 'paid', payment_method = p_channel, wallet_held_at = null where id = p_order_id;

  return _transition_order_core(p_order_id, 'placed', 'system', null, jsonb_build_object(
    'provider', p_provider,
    'provider_ref', p_provider_ref,
    'paid_amount_kobo', p_amount_kobo,
    'expected_total_kobo', v_order.total_kobo,
    'wallet_applied_kobo', v_wallet_part_kobo,
    'expected_card_kobo', v_expected_card_kobo,
    'overpaid_kobo', v_excess_kobo
  ));
end;
$function$;

comment on function _capture_payment_via_provider(uuid, text, text, bigint, jsonb, text, text) is
  'Internal: capture body behind capture_payment(). The card must cover total_kobo - wallet_applied_kobo. Exact: escrow is credited total_kobo, drawing wallet_applied_kobo from platform:wallet_hold and the rest from the gateway. Overpayment: the excess is credited to the customer wallet in the same balanced transaction. Underpayment: the order is NOT placed - the received amount is credited to the customer wallet (idempotent per provider reference), any hold stays, and the payments row stays pending for a full retry. Locks the order before the payment. No authorization of its own - capture_payment() is the only caller. Never grant to authenticated.';

-- ---------------------------------------------------------------------------
-- 7. _unwind_order_escrow_ledger() - refunds know which part was the wallet's
-- ---------------------------------------------------------------------------
--
-- Reproduced from 0045. Destination 'wallet' is unchanged (everything captured
-- goes to the wallet). Destination 'gateway' now credits the gateway only with
-- the CARD part (captured - wallet_applied_kobo) and returns the wallet part to
-- the wallet; an order with no card part cannot go to the gateway at all and
-- goes entirely to the wallet.

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
  v_gateway_account_id  uuid;
  v_wallet_account_id   uuid;
  v_escrow_account_id   uuid;
  v_transaction_id      uuid;
  v_captured_kobo       bigint;
  v_wallet_part_kobo    bigint;
  v_card_part_kobo      bigint;
  v_to_gateway_kobo     bigint;
  v_to_wallet_kobo      bigint;
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

  select coalesce(sum(amount_kobo), 0) into v_captured_kobo
  from ledger_entries
  where order_id = p_order_id
    and account_id = v_escrow_account_id
    and direction = 'credit'
    and entry_type = 'payment_capture';

  if v_captured_kobo = 0 then
    return 'nothing_captured';
  end if;

  v_wallet_part_kobo := least(v_order.wallet_applied_kobo, v_captured_kobo);
  v_card_part_kobo := v_captured_kobo - v_wallet_part_kobo;

  if p_destination = 'gateway' and v_card_part_kobo > 0 then
    v_to_gateway_kobo := v_card_part_kobo;
    v_to_wallet_kobo := v_wallet_part_kobo;
  else
    v_to_gateway_kobo := 0;
    v_to_wallet_kobo := v_captured_kobo;
  end if;

  if v_to_gateway_kobo > 0 then
    select id into v_gateway_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'gateway';
    if v_gateway_account_id is null then
      raise exception '_unwind_order_escrow_ledger: platform gateway account is not seeded';
    end if;
  end if;

  if v_to_wallet_kobo > 0 then
    v_wallet_account_id := _customer_wallet_account_id(v_order.customer_id);
    if v_wallet_account_id is null then
      raise exception '_unwind_order_escrow_ledger: no wallet account available to refund order % into', p_order_id;
    end if;
  end if;

  insert into transactions (kind, reference, order_id, description)
  values (
    'refund',
    v_refund_reference,
    p_order_id,
    coalesce('Escrow refunded to ' || p_destination || ': ' || p_reason, 'Escrow refunded to ' || p_destination)
  )
  returning id into v_transaction_id;

  -- One statement: the escrow debit equals the sum of the credits.
  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_escrow_account_id, 'debit', v_captured_kobo, 'refund', p_order_id
  union all
  select v_transaction_id, v_gateway_account_id, 'credit', v_to_gateway_kobo, 'refund', p_order_id
  where v_to_gateway_kobo > 0
  union all
  select v_transaction_id, v_wallet_account_id, 'credit', v_to_wallet_kobo, 'refund', p_order_id
  where v_to_wallet_kobo > 0;

  update orders set payment_status = 'refunded' where id = p_order_id;

  -- Only an order with a card part has a Monnify payment to mark; a wallet-only
  -- order matches nothing here, which is correct.
  update payments set status = 'refunded' where idempotency_key = v_order.code and status = 'success';

  return 'refunded';
end;
$$;

comment on function _unwind_order_escrow_ledger(uuid, text, text) is
  'Internal primitive shared by refund_order_escrow() (admin) and transition_order() (automatic on cancellation) - reverses an order''s captured-but-unreleased payment out of escrow. Destination wallet (default): everything captured goes to the customer wallet. Destination gateway: only the CARD part (captured - wallet_applied_kobo) goes to platform:gateway, the wallet part returns to the wallet; an order with no card part goes entirely to the wallet. Idempotent. No admin-role check - callers own their authorization. Never grant to authenticated.';

revoke execute on function _unwind_order_escrow_ledger(uuid, text, text) from public, authenticated;
grant execute on function _unwind_order_escrow_ledger(uuid, text, text) to service_role;

-- A refund can now credit BOTH accounts. "gateway" means some of it must still
-- be asked back from the provider; otherwise it went to the wallet.
create or replace function order_refund_destination(p_order_code text)
returns text
language sql
stable
set search_path = public
as $$
  select case
           when bool_or(a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway') then 'gateway'
           when bool_or(a.owner_type = 'customer' and a.kind = 'wallet') then 'wallet'
         end
  from transactions t
  join ledger_entries le on le.transaction_id = t.id and le.direction = 'credit'
  join accounts a on a.id = le.account_id
  where t.reference = p_order_code || '-refund';
$$;

comment on function order_refund_destination(text) is
  'Returns ''gateway'' if the order''s <code>-refund ledger transaction credited platform:gateway (even if part also went to the wallet), ''wallet'' if it only credited the customer wallet, or null if there is none. service_role only.';

-- Exactly how much the provider must send back for an order, from the ledger.
create or replace function order_refund_gateway_kobo(p_order_code text)
returns bigint
language sql
stable
set search_path = public
as $$
  select coalesce(sum(le.amount_kobo), 0)::bigint
  from transactions t
  join ledger_entries le on le.transaction_id = t.id and le.direction = 'credit'
  join accounts a on a.id = le.account_id
  where t.reference = p_order_code || '-refund'
    and a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway';
$$;

comment on function order_refund_gateway_kobo(text) is
  'The kobo of the order''s <code>-refund ledger transaction credited to platform:gateway - the amount to request back from the card provider. 0 if none. service_role only.';

revoke execute on function order_refund_gateway_kobo(text) from public, anon, authenticated;
grant execute on function order_refund_gateway_kobo(text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. admin_money_summary() - count held wallet money
-- ---------------------------------------------------------------------------
--
-- Reproduced from 0091 with two changes: the wallet part of a split payment
-- (a payment_capture debit on platform:wallet_hold) counts as wallet-paid, and
-- the customer wallet float includes money currently held for unpaid orders,
-- because it is still owed to those customers. The reconciliation block is
-- untouched: held money is never in escrow.

create or replace function admin_money_summary(
  p_from  timestamptz default null,
  p_to    timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from  timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_to    timestamptz := coalesce(p_to, 'infinity'::timestamptz);
  v_doc   jsonb;
begin
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception 'admin_money_summary: p_from must be before p_to'
      using errcode = 'check_violation';
  end if;

  with per_acct as (
    select le.account_id,
           sum(case when le.direction = 'credit' then le.amount_kobo else -le.amount_kobo end) as bal,
           sum(le.amount_kobo) filter (where le.direction = 'debit')  as debits_all,
           sum(le.amount_kobo) filter (where le.direction = 'credit') as credits_all,
           -- all time
           sum(le.amount_kobo) filter (where le.direction = 'credit' and le.entry_type = 'payment_capture') as cr_capture_all,
           sum(le.amount_kobo) filter (where le.direction = 'credit' and le.entry_type = 'escrow_release')  as cr_release_all,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'escrow_release')  as dr_release_all,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'refund')          as dr_refund_all,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'payout')          as dr_payout_all,
           -- in window
           sum(case when le.direction = 'credit' then le.amount_kobo else -le.amount_kobo end)
             filter (where le.created_at >= v_from and le.created_at < v_to)                                  as net_w,
           sum(le.amount_kobo) filter (where le.direction = 'credit' and le.entry_type = 'payment_capture'
                                         and le.created_at >= v_from and le.created_at < v_to)               as cr_capture_w,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'payment_capture'
                                         and le.created_at >= v_from and le.created_at < v_to)               as dr_capture_w,
           sum(le.amount_kobo) filter (where le.direction = 'credit' and le.entry_type = 'escrow_release'
                                         and le.created_at >= v_from and le.created_at < v_to)               as cr_release_w,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'escrow_release'
                                         and le.created_at >= v_from and le.created_at < v_to)               as dr_release_w,
           count(*)            filter (where le.direction = 'debit'  and le.entry_type = 'escrow_release'
                                         and le.created_at >= v_from and le.created_at < v_to)               as n_release_w,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'refund'
                                         and le.created_at >= v_from and le.created_at < v_to)               as dr_refund_w,
           sum(le.amount_kobo) filter (where le.direction = 'credit' and le.entry_type = 'refund'
                                         and le.created_at >= v_from and le.created_at < v_to)               as cr_refund_w,
           sum(le.amount_kobo) filter (where le.direction = 'debit'  and le.entry_type = 'payout'
                                         and le.created_at >= v_from and le.created_at < v_to)               as dr_payout_w
    from ledger_entries le
    group by le.account_id
  ),
  roll as (
    select a.owner_type, a.kind, pa.*
    from per_acct pa
    join accounts a on a.id = pa.account_id
  ),
  agg as (
    select
      coalesce(sum(cr_capture_w)  filter (where owner_type = 'platform' and kind = 'escrow'), 0)  as processed_w,
      coalesce(sum(dr_capture_w)  filter (where (owner_type = 'customer' and kind = 'wallet') or (owner_type = 'platform' and kind = 'wallet_hold')), 0)  as wallet_paid_w,
      coalesce(sum(dr_release_w)  filter (where owner_type = 'platform' and kind = 'escrow'), 0)  as gmv_w,
      coalesce(sum(n_release_w)   filter (where owner_type = 'platform' and kind = 'escrow'), 0)  as orders_w,
      coalesce(sum(net_w)         filter (where owner_type = 'platform' and kind = 'revenue'), 0) as platform_w,
      coalesce(sum(cr_release_w)  filter (where owner_type = 'vendor' and kind = 'available'), 0) as vendor_w,
      coalesce(sum(cr_release_w)  filter (where owner_type = 'rider' and kind = 'available'), 0)  as rider_w,
      coalesce(sum(dr_refund_w)   filter (where owner_type = 'platform' and kind = 'escrow'), 0)  as refunded_w,
      coalesce(sum(cr_refund_w)   filter (where owner_type = 'platform' and kind = 'gateway'), 0) as refunded_gateway_w,
      coalesce(sum(dr_payout_w)   filter (where owner_type = 'vendor' and kind = 'available'), 0) as payout_vendor_w,
      coalesce(sum(dr_payout_w)   filter (where owner_type = 'rider' and kind = 'available'), 0)  as payout_rider_w,

      coalesce(sum(bal)           filter (where owner_type = 'platform' and kind = 'escrow'), 0)  as held,
      coalesce(sum(greatest(bal, 0)) filter (where owner_type = 'vendor' and kind = 'available'), 0) as owed_vendors,
      coalesce(sum(greatest(bal, 0)) filter (where owner_type = 'rider' and kind = 'available'), 0)  as owed_riders,
      coalesce(sum(dr_payout_all) filter (where owner_type = 'vendor' and kind = 'available'), 0) as paid_vendors,
      coalesce(sum(dr_payout_all) filter (where owner_type = 'rider' and kind = 'available'), 0)  as paid_riders,
      coalesce(sum(bal)           filter (where (owner_type = 'customer' and kind = 'wallet') or (owner_type = 'platform' and kind = 'wallet_hold')), 0)  as wallet_float,

      coalesce(sum(cr_capture_all) filter (where owner_type = 'platform' and kind = 'escrow'), 0) as captured_all,
      coalesce(sum(dr_refund_all)  filter (where owner_type = 'platform' and kind = 'escrow'), 0) as refunded_all,
      coalesce(sum(cr_release_all) filter (where (owner_type in ('vendor', 'rider') and kind = 'available')
                                              or (owner_type = 'platform' and kind = 'revenue')), 0) as shares_all,
      coalesce(sum(dr_release_all) filter (where owner_type = 'platform' and kind = 'escrow'), 0) as escrow_released_all,
      coalesce(sum(debits_all), 0)  as debits_all,
      coalesce(sum(credits_all), 0) as credits_all
    from roll
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'gross_processed_kobo', processed_w::bigint,
    'gross_processed_card_kobo', (processed_w - wallet_paid_w)::bigint,
    'gross_processed_wallet_kobo', wallet_paid_w::bigint,
    'delivered_gmv_kobo', gmv_w::bigint,
    'delivered_orders', orders_w::bigint,
    'platform_earnings_kobo', platform_w::bigint,
    'vendor_earned_kobo', vendor_w::bigint,
    'rider_earned_kobo', rider_w::bigint,
    'refunded_kobo', refunded_w::bigint,
    'refunded_gateway_kobo', refunded_gateway_w::bigint,
    'refunded_wallet_kobo', (refunded_w - refunded_gateway_w)::bigint,
    'paid_out_to_vendors_window_kobo', payout_vendor_w::bigint,
    'paid_out_to_riders_window_kobo', payout_rider_w::bigint,
    'held_in_escrow_kobo', held::bigint,
    'owed_to_vendors_kobo', owed_vendors::bigint,
    'owed_to_riders_kobo', owed_riders::bigint,
    'paid_out_to_vendors_kobo', paid_vendors::bigint,
    'paid_out_to_riders_kobo', paid_riders::bigint,
    'customer_wallet_float_kobo', wallet_float::bigint,
    'reconciliation', jsonb_build_object(
      'captured_kobo', captured_all::bigint,
      'held_kobo', held::bigint,
      'released_kobo', shares_all::bigint,
      'refunded_kobo', refunded_all::bigint,
      'difference_kobo', (captured_all - held - shares_all - refunded_all)::bigint,
      'ledger_debit_kobo', debits_all::bigint,
      'ledger_credit_kobo', credits_all::bigint,
      'reconciles', (captured_all - held - shares_all - refunded_all) = 0 and debits_all = credits_all
    )
  )
  into v_doc
  from agg;

  return v_doc;
end;
$$;

comment on function admin_money_summary(timestamptz, timestamptz) is
  'Owner-facing money summary derived only from the ledger, as one jsonb document: flows for the window [p_from, p_to) (null = open): gross processed (card + wallet), delivered GMV/orders, platform earnings, vendor/rider earned, refunds split gateway/wallet, payouts; and point-in-time figures: held in escrow, owed to vendors/riders, paid out, customer wallet float. Includes a reconciliation block: captured = held + released shares + refunded, and debits = credits. service_role only.';
