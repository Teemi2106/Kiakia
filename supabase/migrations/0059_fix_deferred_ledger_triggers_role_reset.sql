-- KiaKia - fixes a live bug found while manually testing the rider app's
-- delivery-code / escrow-release flow end to end: calling
-- verify_delivery_and_release_escrow() as a real rider fails with
-- "permission denied for table ledger_entries" at COMMIT, not at the INSERT
-- that actually writes the row.
--
-- Root cause: ledger_entries has two DEFERRABLE INITIALLY DEFERRED
-- constraint triggers - check_ledger_balance() (0005) and
-- check_customer_wallet_not_negative() (0045) - deliberately deferred so a
-- multi-row insert inside one transaction is only checked once, at commit.
-- Neither trigger function is SECURITY DEFINER.
--
-- verify_delivery_and_release_escrow() IS SECURITY DEFINER, so its own
-- INSERTs into ledger_entries succeed - Postgres elevates the effective role
-- for the duration of that function call. But a DEFERRED trigger does not
-- fire during that call: it fires at COMMIT, which happens AFTER the
-- SECURITY DEFINER function has already returned. By then PostgREST has
-- already reset the connection's role back to the bare `authenticator`
-- role it uses between requests - confirmed directly from the Postgres log
-- for the failing request: `Command: COMMIT`, `User: authenticator`. A
-- plain (SECURITY INVOKER) trigger function fired at that point runs AS
-- authenticator, which correctly has zero grants on ledger_entries per
-- 0034_fix_missing_table_grants.sql - hence "permission denied for table
-- ledger_entries" on COMMIT, not on the INSERT.
--
-- This was never caught by pgTAP (supabase/tests/) because those tests
-- connect directly as a privileged Postgres role and never go through
-- PostgREST's authenticator role-switching at all - the one thing that
-- actually exposes this bug. It would affect every future SECURITY DEFINER
-- write to ledger_entries called through a real client session, not just
-- this one; capture_payment()/refund_order_escrow()/pay_order_from_wallet()
-- were not hit today only because they are not yet exercised through a
-- rider/customer's own authenticated session in this project's history the
-- way this call was.
--
-- Fix: make both trigger functions SECURITY DEFINER themselves. A
-- SECURITY DEFINER function elevates its own effective role for its own
-- execution regardless of what role is active when it happens to fire -
-- immediately or, as here, deferred to commit - so this closes the gap for
-- every current and future writer, not just verify_delivery_and_release_escrow().
-- Each reproduces its prior definition byte for byte except for that one
-- addition, per this repo's "never edit a migration that already shipped"
-- convention (see 0050's own header). Trigger functions take no EXECUTE
-- grant of their own - the trigger mechanism invokes them internally,
-- never as a direct call - so nothing else changes.

create or replace function check_ledger_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  debit_total bigint;
  credit_total bigint;
begin
  select
    coalesce(sum(amount_kobo) filter (where direction = 'debit'), 0),
    coalesce(sum(amount_kobo) filter (where direction = 'credit'), 0)
  into debit_total, credit_total
  from ledger_entries
  where transaction_id = new.transaction_id;

  if debit_total <> credit_total then
    raise exception
      'Ledger imbalance on transaction %: debits=% credits=% - this must page someone, see section 17',
      new.transaction_id, debit_total, credit_total;
  end if;

  return new;
end;
$$;

comment on function check_ledger_balance() is
  'Deferred constraint trigger on ledger_entries: sum(debits) = sum(credits) per transaction_id, checked once at commit. SECURITY DEFINER as of 0059 - a deferred trigger fires after PostgREST has already reset the connection role back to authenticator, so without its own elevated privilege this trigger (and the money-writing SECURITY DEFINER function whose insert it validates) fails with "permission denied for table ledger_entries" on every real client-session call. See 0059''s header for the full mechanism.';

create or replace function check_customer_wallet_not_negative()
returns trigger
language plpgsql
security definer
set search_path = public
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
      'Customer wallet account % would be overdrawn (resulting balance % kobo) - a wallet can never fund more than it holds',
      new.account_id, v_balance
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function check_customer_wallet_not_negative() is
  'Deferred constraint trigger on ledger_entries: a customer wallet account can never go negative, checked once at commit regardless of who wrote the entries or whether they remembered to lock. SECURITY DEFINER as of 0059 - see check_ledger_balance()''s comment and this migration''s header for why a deferred trigger specifically needs this, independent of whatever SECURITY DEFINER function''s insert it is validating.';
