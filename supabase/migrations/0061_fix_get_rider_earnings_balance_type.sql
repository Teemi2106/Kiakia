-- KiaKia - fixes a live bug: every call to get_rider_earnings() fails with
-- "structure of query does not match function result type", so the rider
-- app's Earnings screen has never been able to load for anyone.
--
-- Root cause: get_rider_earnings() (0032_vendor_location_and_rider_reads.sql)
-- declares `returns table (account_kind text, balance_kobo bigint)`, but its
-- body selects `coalesce(b.balance_kobo, 0)` from account_balances
-- (0005_ledger.sql):
--
--   coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end), 0) as balance_kobo
--
-- sum() over a bigint column returns numeric in Postgres, not bigint, so
-- account_balances.balance_kobo is numeric. coalesce(numeric, 0) is still
-- numeric, which does not match the function's declared bigint column - a
-- PL/pgSQL `return query` requires the executed query's column types to
-- match the declared return type exactly, so every call raised regardless
-- of whether the rider had any ledger rows.
--
-- Fix: cast the balance to bigint at the point it leaves the ledger view.
-- Money is stored and returned in whole kobo everywhere else in this schema
-- (amount_kobo, balance_kobo elsewhere are all bigint) - this cast just
-- restores that, and is safe since kobo balances never carry a fractional
-- component. Nothing else about this function changes - create or replace
-- reproduces 0032's definition byte for byte except for that one cast, same
-- convention 0058 used relative to 0044/0057.
--
-- Never edit 0032 directly - it already shipped. This is applied on top,
-- per this repo's established convention (see 0050's own header).

create or replace function get_rider_earnings()
returns table (
  account_kind  text,
  balance_kobo  bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'get_rider_earnings: no authenticated caller';
  end if;

  -- Scoped by owner_id = auth.uid() in the query itself, not merely
  -- checked-then-queried — this can never return another rider's, a
  -- vendor's, or the platform's account balance regardless of how the
  -- function is called. Zero rows (not an error) when the caller has never
  -- had a ledger entry yet (e.g. hasn't completed a delivery) — same
  -- "absence is a normal, non-exceptional state" posture
  -- get_order_tracking()'s NULL rider_lat/rider_lng already takes.
  --
  -- Fixed here: cast to bigint - account_balances.balance_kobo is numeric
  -- (sum() over a bigint column promotes to numeric), which does not match
  -- this function's declared bigint column and made every call fail. See
  -- this migration's header.
  return query
  select a.kind, coalesce(b.balance_kobo, 0)::bigint
  from accounts a
  left join account_balances b on b.account_id = a.id
  where a.owner_type = 'rider' and a.owner_id = auth.uid();
end;
$$;

comment on function get_rider_earnings() is
  'The only path by which a rider can read their own ledger balance(s) — accounts/ledger_entries/account_balances all revoke every grant from authenticated (0007_rls.sql, 0024_lock_down_account_balances_view.sql) by design, since a blanket read grant on any of those would expose every other rider''s, every vendor''s, and the platform''s money. Scoped to `owner_type = ''rider'' and owner_id = auth.uid()` in the query itself. Today this returns at most one row (kind = ''available'' — the only rider-owned account kind any function creates, in verify_delivery_and_release_escrow(), 0020/0022) since no payout-execution flow exists yet to ever populate a rider ''pending_payout'' account; returned as a set rather than fixed columns so a future payout migration adding that kind needs no change here. balance_kobo is cast to bigint (0061) since account_balances.balance_kobo is numeric (sum() over bigint promotes) and the declared return type is bigint - every call failed with "structure of query does not match function result type" before this fix.';

revoke execute on function get_rider_earnings() from public;
grant execute on function get_rider_earnings() to authenticated;
